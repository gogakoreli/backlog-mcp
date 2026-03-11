import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { IBacklogService } from '../storage/service-types.js';
import { registerTools, type ToolDeps } from '../tools/index.js';
import { withOperationLogging } from '../operations/index.js';
import { paths } from '../utils/paths.js';

export interface AppDeps extends ToolDeps {
  // Node.js-only
  staticMiddleware?: any;  // result of serveStatic({ root: '...' }) from @hono/node-server/serve-static
  eventBus?: any;          // for SSE push
  // Operation log — one of these is provided
  operationLogger?: any;   // local: OperationLogger instance
  db?: any;                // cloud: D1 database for operations queries
}

export function createApp(service: IBacklogService, deps?: AppDeps): Hono {
  const app = new Hono();
  app.use('*', cors());

  // Auth (optional API key for MCP)
  app.use('/mcp/*', async (c, next) => {
    if (process.env.API_KEY) {
      const auth = c.req.header('authorization');
      if (auth !== `Bearer ${process.env.API_KEY}`) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    return next();
  });

  // Health
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Version
  app.get('/version', (c) => c.json(paths.getVersion()));

  // MCP endpoint — WebStandardStreamableHTTPServerTransport works on Node.js + Workers
  app.all('/mcp', async (c) => {
    let server = new McpServer({ name: paths.packageJson.name, version: paths.getVersion() });
    // Apply operation logging when operationLogger is available (local Node.js mode)
    if (deps?.operationLogger) {
      server = withOperationLogging(server);
    }
    registerTools(server, service, deps);
    if (deps?.resourceManager) {
      deps.resourceManager.registerResource(server);
      deps.resourceManager.registerWriteTool(server);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // ── Viewer REST API ─────────────────────────────────────────────────────────

  // GET /tasks
  app.get('/tasks', async (c) => {
    const filterParam = c.req.query('filter') ?? 'active';
    const q = c.req.query('q');
    const limit = parseInt(c.req.query('limit') ?? '10000', 10);

    const statusMap: Record<string, string[] | undefined> = {
      active: ['open', 'in_progress', 'blocked'],
      completed: ['done', 'cancelled'],
      all: undefined,
    };
    const status = statusMap[filterParam] as any;

    const results = await service.list({ status, query: q || undefined, limit });
    return c.json(results);
  });

  // GET /tasks/:id
  app.get('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const task = await service.get(id);
    if (!task) return c.json({ error: 'Not found' }, 404);

    const raw = await service.getMarkdown(id);
    const children = await service.list({ parent_id: id, limit: 1000 });
    let parentTitle: string | undefined;
    const parentId = task.parent_id || task.epic_id;
    if (parentId) {
      const parent = await service.get(parentId);
      parentTitle = parent?.title;
    }

    return c.json({ ...task, raw, parentTitle, children });
  });

  // GET /search
  app.get('/search', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing required query param: q' }, 400);
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const types = c.req.query('types')?.split(',');
    const sort = c.req.query('sort');
    const results = await service.searchUnified(q, { types: types as Array<'task' | 'epic' | 'resource'> | undefined, sort, limit });
    return c.json(results);
  });

  // GET /api/status
  app.get('/api/status', async (c) => {
    const counts = await service.counts();
    return c.json({
      version: paths.getVersion(),
      mode: deps?.db ? 'cloudflare-worker' : 'local',
      taskCount: counts.total_tasks + counts.total_epics,
    });
  });

  // ── Operations ──────────────────────────────────────────────────────────────

  // GET /operations/count/:taskId  (must be before /operations)
  app.get('/operations/count/:taskId', async (c) => {
    const taskId = c.req.param('taskId');
    if (deps?.operationLogger) {
      return c.json({ count: deps.operationLogger.countForTask(taskId) });
    }
    if (deps?.db) {
      const row = await deps.db.prepare('SELECT COUNT(*) as count FROM operations WHERE task_id = ?').bind(taskId).first() as { count: number } | null;
      return c.json({ count: row?.count ?? 0 });
    }
    return c.json({ count: 0 });
  });

  // GET /operations
  app.get('/operations', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const taskFilter = c.req.query('task');
    const date = c.req.query('date');
    const tz = c.req.query('tz');

    if (deps?.operationLogger) {
      // Local mode: operationLogger.read() returns enriched data with sync storage.get() calls.
      // Since service.get() is now async, we do the enrichment here with async lookups.
      const operations = deps.operationLogger.read({
        limit: date ? 1000 : limit, // Higher limit when filtering by date
        taskId: taskFilter || undefined,
        date: date || undefined,
        tzOffset: tz != null ? parseInt(tz) : undefined,
      });

      // Enrich operations with task titles and epic info
      const taskCache = new Map<string, { title?: string; epicId?: string }>();
      const epicCache = new Map<string, string | undefined>();

      const enriched = await Promise.all(operations.map(async (op: any) => {
        if (op.resourceId) {
          if (!taskCache.has(op.resourceId)) {
            const taskData = await service.get(op.resourceId);
            taskCache.set(op.resourceId, {
              title: taskData?.title,
              epicId: taskData?.parent_id ?? taskData?.epic_id,
            });
          }
          const cached = taskCache.get(op.resourceId)!;

          // Resolve epic title if task has an epic
          let epicTitle: string | undefined;
          if (cached.epicId) {
            if (!epicCache.has(cached.epicId)) {
              const epicData = await service.get(cached.epicId);
              epicCache.set(cached.epicId, epicData?.title);
            }
            epicTitle = epicCache.get(cached.epicId);
          }

          return { ...op, resourceTitle: cached.title, epicId: cached.epicId, epicTitle };
        }
        return op;
      }));

      return c.json(enriched);
    }

    if (deps?.db) {
      type OpRow = { id: number; ts: string; tool: string; actor: string; resource_id: string | null; task_id: string | null; params: string | null; result: string | null };
      const { results: ops } = await deps.db.prepare('SELECT * FROM operations WHERE (task_id = ? OR ? IS NULL) ORDER BY id DESC LIMIT ?').bind(taskFilter ?? null, taskFilter ?? null, limit).all() as { results: OpRow[] };

      const titleCache = new Map<string, string | undefined>();
      const enriched = await Promise.all(ops.map(async (op: OpRow) => {
        let resourceTitle: string | undefined;
        let epicId: string | undefined;
        let epicTitle: string | undefined;

        if (op.task_id) {
          if (!titleCache.has(op.task_id)) {
            const entity = await service.get(op.task_id);
            titleCache.set(op.task_id, entity?.title);
            if (entity?.epic_id) {
              if (!titleCache.has(entity.epic_id)) {
                const epic = await service.get(entity.epic_id);
                titleCache.set(entity.epic_id, epic?.title);
              }
              epicId = entity.epic_id;
              epicTitle = titleCache.get(entity.epic_id);
            }
          } else {
            resourceTitle = titleCache.get(op.task_id);
          }
          if (!resourceTitle) {
            resourceTitle = titleCache.get(op.task_id);
          }
        }

        return { ...op, params: tryParseJson(op.params), result: tryParseJson(op.result), resourceTitle, epicId, epicTitle };
      }));

      return c.json(enriched);
    }

    return c.json([]);
  });

  // ── SSE events ──────────────────────────────────────────────────────────────
  app.get('/events', (c) => {
    if (deps?.eventBus) {
      // Node.js: live push via eventBus
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      writer.write(enc.encode(': connected\n\n'));

      const onEvent = (event: any) => {
        writer.write(enc.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)).catch(() => {});
      };
      deps.eventBus.subscribe(onEvent);

      const heartbeat = setInterval(() => {
        writer.write(enc.encode(': heartbeat\n\n')).catch(() => clearInterval(heartbeat));
      }, 30000);

      // Cleanup when client disconnects
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        deps.eventBus!.unsubscribe(onEvent);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    // Cloud/stateless: heartbeat only
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(': connected\n\n'));
        const id = setInterval(() => {
          try { controller.enqueue(enc.encode(': heartbeat\n\n')); } catch { clearInterval(id); }
        }, 30000);
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  });

  // ── Node.js-only routes (filesystem) ────────────────────────────────────────
  if (deps?.staticMiddleware || deps?.resourceManager) {
    // Resource proxy — serves local filesystem resources
    if (deps?.resourceManager) {
      app.get('/resource', async (c) => {
        const filePath = c.req.query('path');

        if (!filePath) {
          return c.json({ error: 'Missing path parameter' }, 400);
        }

        if (!existsSync(filePath)) {
          return c.json({ error: 'File not found', path: filePath }, 404);
        }

        try {
          const content = readFileSync(filePath, 'utf-8');
          const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
          const mimeMap: Record<string, string> = {
            md: 'text/markdown',
            ts: 'text/typescript',
            js: 'text/javascript',
            json: 'application/json',
            txt: 'text/plain',
          };

          let frontmatter = {};
          let bodyContent = content;

          // Parse frontmatter for markdown files
          if (ext === 'md') {
            const parsed = matter(content);
            frontmatter = parsed.data;
            bodyContent = parsed.content;
          }

          return c.json({
            content: bodyContent,
            frontmatter,
            type: mimeMap[ext] || 'text/plain',
            path: filePath,
            fileUri: `file://${filePath}`,
            mcpUri: deps.resourceManager.toUri(filePath),
            ext,
          });
        } catch (error: any) {
          return c.json({ error: 'Failed to read file', message: error.message }, 500);
        }
      });

      // MCP resource proxy — resolves mcp://backlog/ URIs to filesystem content
      app.get('/mcp/resource', async (c) => {
        const uri = c.req.query('uri');

        if (!uri || !uri.startsWith('mcp://backlog/')) {
          return c.json({ error: 'Invalid MCP URI' }, 400);
        }

        try {
          const resource = deps.resourceManager.read(uri);
          const filePath = deps.resourceManager.resolve(uri);
          const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';

          return c.json({
            content: resource.content,
            frontmatter: resource.frontmatter || {},
            type: resource.mimeType,
            path: filePath,
            fileUri: `file://${filePath}`,
            mcpUri: uri,
            ext,
          });
        } catch (error: any) {
          return c.json({ error: 'Resource not found', uri, message: error.message }, 404);
        }
      });

      app.get('/open', (c) => {
        const uri = c.req.query('uri');
        if (!uri) return c.json({ error: 'Missing uri' }, 400);
        return c.redirect(`/?resource=${encodeURIComponent(uri)}`);
      });

      app.get('/open/:id', async (c) => {
        const id = c.req.param('id');
        const filePath = service.getFilePath?.(id);
        if (!filePath) return c.json({ error: 'Task not found' }, 404);
        const { exec } = await import('node:child_process');
        exec(`open "${filePath}"`);
        return c.json({ status: 'Opening...' });
      });
    }

    // Shutdown (local only)
    app.post('/shutdown', (c) => {
      setTimeout(() => process.exit(0), 500);
      return c.text('Shutting down...');
    });
  }

  // Static files — must be LAST (fallthrough for SPA)
  // Only registered in Node.js mode. In cloud mode Pages serves static files.
  if (deps?.staticMiddleware) {
    app.use('/*', deps.staticMiddleware);
  }

  return app;
}

function tryParseJson(value: string | null): unknown {
  if (!value) return value;
  try { return JSON.parse(value); } catch { return value; }
}
