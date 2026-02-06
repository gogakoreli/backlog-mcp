import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { storage } from '../storage/backlog-service.js';
import { resourceManager } from '../resources/manager.js';
import { paths } from '../utils/paths.js';
import { operationLogger } from '../operations/index.js';
import { eventBus } from '../events/index.js';
import type { BacklogEvent } from '../events/index.js';

const SSE_HEARTBEAT_MS = 30_000;

export function registerViewerRoutes(app: FastifyInstance) {
  // Static files - serve from dist/viewer (built assets)
  app.register(fastifyStatic, {
    root: paths.viewerDist,
    prefix: '/',
  });

  // List tasks
  app.get('/tasks', async (request) => {
    const { filter, limit, q } = request.query as { filter?: string; limit?: string; q?: string };
    
    const statusMap: Record<string, any> = {
      active: { status: ['open', 'in_progress', 'blocked'] },
      completed: { status: ['done', 'cancelled'] },
      all: {},
    };
    
    const filterConfig = statusMap[filter || 'active'] || statusMap.active;
    const tasks = await storage.list({ 
      ...filterConfig, 
      query: q || undefined,
      limit: limit ? parseInt(limit) : 10000 
    });
    
    return tasks;
  });

  // Unified search API - returns proper SearchResult[] with item, score, type
  app.get('/search', async (request, reply) => {
    const { q, types, limit, sort } = request.query as { q?: string; types?: string; limit?: string; sort?: string };
    
    if (!q) {
      return reply.code(400).send({ error: 'Missing required query parameter: q' });
    }
    
    const typeFilter = types 
      ? types.split(',').filter((t): t is 'task' | 'epic' | 'resource' => 
          t === 'task' || t === 'epic' || t === 'resource')
      : undefined;
    
    const sortMode = sort === 'recent' ? 'recent' : 'relevant';
    
    const results = await storage.searchUnified(q, {
      types: typeFilter?.length ? typeFilter : undefined,
      limit: limit ? parseInt(limit) : 20,
      sort: sortMode,
    });
    
    return results;
  });

  // Get single task
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = storage.get(id);
    
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    
    // Include raw markdown for copy button
    const raw = storage.getMarkdown(id);
    
    // Resolve parent title
    const parentId = task.parent_id ?? task.epic_id;
    let parentTitle: string | undefined;
    if (parentId) {
      const parent = storage.get(parentId);
      parentTitle = parent?.title;
    }
    
    return { ...task, raw, parentTitle };
  });

  // System status
  app.get('/api/status', async () => {
    const tasks = await storage.list({ limit: 10000 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3030;
    
    return {
      version: paths.getVersion(),
      port,
      dataDir: paths.backlogDataDir,
      taskCount: tasks.length,
      uptime: Math.floor(process.uptime())
    };
  });

  // Open task in editor
  app.get('/open/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = storage.getFilePath(id);
    
    if (!filePath) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    
    exec(`open "${filePath}"`);
    return { status: 'Opening...' };
  });

  // Resource proxy
  app.get('/resource', async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    
    if (!filePath) {
      return reply.code(400).send({ error: 'Missing path parameter' });
    }
    
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found', path: filePath });
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
      
      return {
        content: bodyContent,
        frontmatter,
        type: mimeMap[ext] || 'text/plain',
        path: filePath,
        fileUri: `file://${filePath}`,
        mcpUri: resourceManager.toUri(filePath),
        ext
      };
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to read file', message: error.message });
    }
  });

  // MCP resource proxy
  app.get('/mcp/resource', async (request, reply) => {
    const { uri } = request.query as { uri?: string };
    
    if (!uri || !uri.startsWith('mcp://backlog/')) {
      return reply.code(400).send({ error: 'Invalid MCP URI' });
    }
    
    try {
      const resource = resourceManager.read(uri);
      const filePath = resourceManager.resolve(uri);
      const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
      
      return {
        content: resource.content,
        frontmatter: resource.frontmatter || {},
        type: resource.mimeType,
        path: filePath,
        fileUri: `file://${filePath}`,
        mcpUri: uri,
        ext
      };
    } catch (error: any) {
      return reply.code(404).send({ error: 'Resource not found', uri, message: error.message });
    }
  });

  // Open resource in viewer
  app.get('/open', async (request, reply) => {
    const { uri } = request.query as { uri?: string };
    
    if (!uri) {
      return reply.code(400).send({ error: 'Missing uri parameter' });
    }
    
    return reply.redirect(`/?resource=${encodeURIComponent(uri)}`);
  });

  // Operations API - recent activity (enriched with task titles and epic info)
  app.get('/operations', async (request) => {
    const { limit, task, date } = request.query as { limit?: string; task?: string; date?: string };
    
    const operations = operationLogger.read({
      limit: limit ? parseInt(limit) : (date ? 1000 : 50), // Higher limit when filtering by date
      taskId: task || undefined,
      date: date || undefined,
    });
    
    // Enrich operations with task titles and epic info
    // Use in-request cache to avoid duplicate storage lookups
    const taskCache = new Map<string, { title?: string; epicId?: string }>();
    const epicCache = new Map<string, string | undefined>();
    
    const enriched = operations.map(op => {
      if (op.resourceId) {
        if (!taskCache.has(op.resourceId)) {
          const taskData = storage.get(op.resourceId);
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
            const epicData = storage.get(cached.epicId);
            epicCache.set(cached.epicId, epicData?.title);
          }
          epicTitle = epicCache.get(cached.epicId);
        }
        
        return { ...op, resourceTitle: cached.title, epicId: cached.epicId, epicTitle };
      }
      return op;
    });
    
    return enriched;
  });

  // Operation count for a specific task (for badge)
  app.get('/operations/count/:taskId', async (request) => {
    const { taskId } = request.params as { taskId: string };
    return { count: operationLogger.countForTask(taskId) };
  });

  // SSE endpoint for real-time viewer updates
  app.get('/events', (request, reply) => {
    const lastEventId = request.headers['last-event-id'] as string | undefined;

    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Replay missed events if client reconnected with Last-Event-ID
    if (lastEventId) {
      const seq = parseInt(lastEventId, 10);
      if (!isNaN(seq)) {
        const missed = eventBus.replaySince(seq);
        for (const event of missed) {
          raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      }
    }

    // Send initial connected event
    raw.write(`: connected\n\n`);

    // Subscribe to new events
    const onEvent = (event: BacklogEvent) => {
      raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    eventBus.subscribe(onEvent);

    // Heartbeat to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      raw.write(`: heartbeat\n\n`);
    }, SSE_HEARTBEAT_MS);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      eventBus.unsubscribe(onEvent);
    });
  });
}
