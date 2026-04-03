import { Hono } from 'hono';
import { cors } from 'hono/cors';
import matter from 'gray-matter';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { GitHub } from 'arctic';
import type { IBacklogService } from '../storage/service-types.js';
import { registerTools, type ToolDeps } from '../tools/index.js';
// Note: paths.ts and operations/index.ts are NOT imported here — they pull in
// Node.js modules (import.meta.url, fs, path) that break the Workers bundle.
// name/version and the MCP server wrapper are injected via AppDeps.

export interface AppDeps extends ToolDeps {
  // Server identity — passed explicitly to avoid importing paths.ts in Workers
  name?: string;
  version?: string;
  dataDir?: string;
  // Auth secrets — injected from entry points (process.env in Node.js, env bindings in Workers)
  apiKey?: string;                   // direct Bearer token (Claude Desktop / programmatic)
  clientSecret?: string;             // OAuth client_secret (Claude.ai web connector)
  jwtSecret?: string;                // internal JWT signing key (never exposed to clients)
  // GitHub OAuth — replaces API key form with "Sign in with GitHub"
  githubClientId?: string;           // GitHub OAuth App client ID
  githubClientSecret?: string;       // GitHub OAuth App client secret
  allowedGithubUsernames?: string;   // comma-separated allowlist e.g. "gkoreli,gogakoreli"
  // Node.js-only
  wrapMcpServer?: (server: McpServer) => McpServer; // e.g. withOperationLogging
  staticMiddleware?: any;  // result of serveStatic({ root: '...' }) from @hono/node-server/serve-static
  eventBus?: any;          // for SSE push
  readLocalFile?: (filePath: string) => string | null;  // injected by node-server.ts; absent in Worker
  // Operation log — one of these is provided
  operationLogger?: any;   // local: OperationLogger instance
  db?: any;                // cloud: D1 database for operations queries
}

export function createApp(service: IBacklogService, deps?: AppDeps): Hono {
  const app = new Hono();
  app.use('*', cors());

  // Auth middleware — accepts OAuth JWT (Claude.ai web) or direct API key (Claude Desktop)
  // Secrets: injected via deps (Workers env bindings) or process.env fallback (Node.js)
  app.use('/mcp/*', async (c, next) => {
    const apiKey = deps?.apiKey ?? process.env.API_KEY;
    const jwtSecret = deps?.jwtSecret ?? process.env.JWT_SECRET;
    if (!apiKey && !jwtSecret) return next(); // auth not configured

    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    if (jwtSecret) {
      const payload = await verifyJWT(token, jwtSecret);
      if (payload) return next();
    }
    if (apiKey && token === apiKey) return next();

    return c.json({ error: 'Unauthorized' }, 401);
  });

  // OAuth 2.0 discovery (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      grant_types_supported: ['authorization_code', 'client_credentials'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    });
  });

  // OAuth 2.0 authorization endpoint — shows auth options page.
  // Displays "Sign in with GitHub" button and/or API key form depending on config.
  app.get('/authorize', (c) => {
    const githubClientId = deps?.githubClientId ?? process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = deps?.githubClientSecret ?? process.env.GITHUB_CLIENT_SECRET;
    const apiKey = deps?.apiKey ?? process.env.API_KEY;
    const githubEnabled = !!(githubClientId && githubClientSecret);

    const q = (name: string) => c.req.query(name) ?? '';
    const error = c.req.query('error');

    // Preserve all OAuth params in the GitHub start link
    const oauthParams = new URLSearchParams({
      response_type: q('response_type'),
      client_id: q('client_id'),
      redirect_uri: q('redirect_uri'),
      code_challenge: q('code_challenge'),
      code_challenge_method: q('code_challenge_method'),
      state: q('state'),
      scope: q('scope'),
    }).toString();

    const githubButton = githubEnabled ? `
    <a href="/oauth/github/start?${oauthParams}" class="github-btn">
      <svg height="20" viewBox="0 0 16 16" width="20" fill="currentColor" style="vertical-align:middle;margin-right:8px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Sign in with GitHub
    </a>` : '';

    const divider = githubEnabled && apiKey ? `<div class="divider"><span>or</span></div>` : '';

    const apiKeyForm = apiKey ? `
    <form method="POST" action="/authorize">
      <input type="hidden" name="response_type" value="${q('response_type')}">
      <input type="hidden" name="client_id" value="${q('client_id')}">
      <input type="hidden" name="redirect_uri" value="${q('redirect_uri')}">
      <input type="hidden" name="code_challenge" value="${q('code_challenge')}">
      <input type="hidden" name="code_challenge_method" value="${q('code_challenge_method')}">
      <input type="hidden" name="state" value="${q('state')}">
      <input type="hidden" name="scope" value="${q('scope')}">
      <label for="password">API Key</label>
      <input type="password" id="password" name="password" autofocus placeholder="Your API key">
      ${error ? `<p class="error">Invalid API key. Try again.</p>` : ''}
      <button type="submit">Authorize with API Key</button>
    </form>` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize — backlog-mcp</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 1.3rem; margin-bottom: 4px; }
    p { color: #555; font-size: 0.95rem; margin-bottom: 24px; }
    label { display: block; font-size: 0.9rem; margin-bottom: 6px; font-weight: 500; }
    input[type=password] { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
    button, .github-btn { display: flex; align-items: center; justify-content: center; margin-top: 16px; width: 100%; padding: 11px; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; text-decoration: none; box-sizing: border-box; }
    button { background: #2563eb; color: #fff; }
    button:hover { background: #1d4ed8; }
    .github-btn { background: #24292e; color: #fff; }
    .github-btn:hover { background: #1a1e22; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #999; font-size: 0.85rem; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
    .error { color: #dc2626; font-size: 0.9rem; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Authorize backlog-mcp</h1>
  <p><strong>${q('client_id') || 'A client'}</strong> is requesting access to your backlog.</p>
  ${githubButton}
  ${divider}
  ${apiKeyForm}
</body>
</html>`;
    return c.html(html);
  });

  // GitHub OAuth start — redirects to GitHub with signed state JWT carrying OAuth params.
  // Separated from GET /authorize so the auth page is always shown first.
  app.get('/oauth/github/start', async (c) => {
    const githubClientId = deps?.githubClientId ?? process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = deps?.githubClientSecret ?? process.env.GITHUB_CLIENT_SECRET;
    const jwtSecret = deps?.jwtSecret ?? process.env.JWT_SECRET;

    if (!githubClientId || !githubClientSecret || !jwtSecret) {
      return c.html(authErrorPage('GitHub OAuth is not configured on this server.'), 500);
    }

    const q = (name: string) => c.req.query(name) ?? '';
    const origin = new URL(c.req.url).origin;
    const now = Math.floor(Date.now() / 1000);
    const stateToken = await signJWT({
      type: 'github_state',
      redirect_uri: q('redirect_uri'),
      code_challenge: q('code_challenge'),
      code_challenge_method: q('code_challenge_method'),
      client_state: q('state'),
      client_id: q('client_id'),
      iat: now,
      exp: now + 600, // 10 minutes to complete GitHub auth
    }, jwtSecret);
    const github = new GitHub(githubClientId, githubClientSecret, `${origin}/oauth/github/callback`);
    return c.redirect(github.createAuthorizationURL(stateToken, []).toString());
  });

  // GitHub OAuth callback — exchanges GitHub code for identity, checks allowlist,
  // then issues our own short-lived auth code JWT (same as the API key path).
  app.get('/oauth/github/callback', async (c) => {
    const githubClientId = deps?.githubClientId ?? process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = deps?.githubClientSecret ?? process.env.GITHUB_CLIENT_SECRET;
    const allowedGithubUsernames = deps?.allowedGithubUsernames ?? process.env.ALLOWED_GITHUB_USERNAMES ?? '';
    const jwtSecret = deps?.jwtSecret ?? process.env.JWT_SECRET;

    if (!githubClientId || !githubClientSecret || !jwtSecret) {
      return c.html(authErrorPage('GitHub OAuth is not configured on this server.'), 500);
    }

    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    const errorParam = c.req.query('error');

    if (errorParam) {
      return c.html(authErrorPage(`GitHub denied access: ${errorParam}`), 400);
    }
    if (!code || !stateParam) {
      return c.html(authErrorPage('Missing code or state from GitHub callback.'), 400);
    }

    // Verify our signed state JWT — prevents CSRF and recovers original OAuth params
    const statePayload = await verifyJWT(stateParam, jwtSecret);
    if (!statePayload || statePayload['type'] !== 'github_state') {
      return c.html(authErrorPage('Invalid or expired state. Please start the authorization flow again.'), 400);
    }

    // Exchange GitHub authorization code for access token (arctic handles this)
    const origin = new URL(c.req.url).origin;
    const github = new GitHub(githubClientId, githubClientSecret, `${origin}/oauth/github/callback`);
    let githubAccessToken: string;
    try {
      const tokens = await github.validateAuthorizationCode(code);
      githubAccessToken = tokens.accessToken();
    } catch {
      return c.html(authErrorPage('Failed to exchange authorization code with GitHub. Please try again.'), 400);
    }

    // Fetch GitHub user profile — only need the username
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        'User-Agent': 'backlog-mcp',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!userResp.ok) {
      return c.html(authErrorPage('Failed to fetch GitHub user info. Please try again.'), 502);
    }
    const ghUser = await userResp.json() as { login: string };

    // Check allowlist (case-insensitive — GitHub usernames are case-insensitive)
    const allowed = allowedGithubUsernames.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length === 0 || !allowed.includes(ghUser.login.toLowerCase())) {
      return c.html(authErrorPage(`GitHub account "${ghUser.login}" is not authorized to access this server.`), 403);
    }

    // Issue our short-lived auth code JWT (identical to the API key flow)
    const now = Math.floor(Date.now() / 1000);
    const authCode = await signJWT({
      type: 'auth_code',
      iss: origin,
      redirect_uri: statePayload['redirect_uri'] as string,
      code_challenge: statePayload['code_challenge'] as string,
      code_challenge_method: statePayload['code_challenge_method'] as string,
      iat: now,
      exp: now + 300, // 5 minutes
    }, jwtSecret);

    const callbackUrl = new URL(statePayload['redirect_uri'] as string);
    callbackUrl.searchParams.set('code', authCode);
    if (statePayload['client_state']) {
      callbackUrl.searchParams.set('state', statePayload['client_state'] as string);
    }
    return c.redirect(callbackUrl.toString());
  });

  app.post('/authorize', async (c) => {
    const body = await c.req.parseBody();
    const apiKey = deps?.apiKey ?? process.env.API_KEY;
    const jwtSecret = deps?.jwtSecret ?? process.env.JWT_SECRET;

    if (!apiKey || !jwtSecret) {
      return c.json({ error: 'server_error', error_description: 'Auth not configured' }, 500);
    }

    if (body['password'] !== apiKey) {
      // Re-show form with error, preserving all OAuth params
      const params = new URLSearchParams({
        response_type: body['response_type'] as string || '',
        client_id: body['client_id'] as string || '',
        redirect_uri: body['redirect_uri'] as string || '',
        code_challenge: body['code_challenge'] as string || '',
        code_challenge_method: body['code_challenge_method'] as string || '',
        state: body['state'] as string || '',
        scope: body['scope'] as string || '',
        error: '1',
      });
      return c.redirect(`/authorize?${params}`);
    }

    const redirectUri = body['redirect_uri'] as string;
    const state = body['state'] as string;
    const codeChallenge = body['code_challenge'] as string;
    const codeChallengeMethod = body['code_challenge_method'] as string;

    // Issue a short-lived auth code as a signed JWT (stateless — no KV needed)
    const now = Math.floor(Date.now() / 1000);
    const authCode = await signJWT({
      type: 'auth_code',
      iss: new URL(c.req.url).origin,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      iat: now,
      exp: now + 300, // 5 minutes
    }, jwtSecret);

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', authCode);
    if (state) callbackUrl.searchParams.set('state', state);
    return c.redirect(callbackUrl.toString());
  });

  // OAuth 2.0 token endpoint — authorization_code + client_credentials grants
  app.post('/oauth/token', async (c) => {
    const body = await c.req.parseBody();
    const grantType = body['grant_type'] as string;
    const jwtSecret = deps?.jwtSecret ?? process.env.JWT_SECRET;

    if (!jwtSecret) {
      return c.json({ error: 'server_error', error_description: 'OAuth not configured' }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;
    const origin = new URL(c.req.url).origin;

    if (grantType === 'authorization_code') {
      const code = body['code'] as string;
      const codeVerifier = body['code_verifier'] as string;
      const redirectUri = body['redirect_uri'] as string;

      if (!code || !codeVerifier) {
        return c.json({ error: 'invalid_request' }, 400);
      }

      // Verify auth code JWT
      const authCodePayload = await verifyJWT(code, jwtSecret);
      if (!authCodePayload || authCodePayload['type'] !== 'auth_code') {
        return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400);
      }

      // Verify redirect_uri matches what was used during authorization
      if (authCodePayload['redirect_uri'] !== redirectUri) {
        return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      }

      // Verify PKCE: SHA256(code_verifier) base64url == code_challenge
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
      const computed = b64url(hash);
      if (computed !== authCodePayload['code_challenge']) {
        return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      }

      const accessToken = await signJWT({
        iss: origin, aud: 'backlog-mcp', sub: body['client_id'] as string || 'claude',
        iat: now, exp: now + expiresIn, scope: 'mcp',
      }, jwtSecret);

      return c.json({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn });
    }

    if (grantType === 'client_credentials') {
      const clientSecret = deps?.clientSecret ?? process.env.CLIENT_SECRET;
      if (!clientSecret || body['client_secret'] !== clientSecret) {
        return c.json({ error: 'invalid_client' }, 401);
      }
      const accessToken = await signJWT({
        iss: origin, aud: 'backlog-mcp', sub: body['client_id'] as string || 'backlog-mcp-client',
        iat: now, exp: now + expiresIn, scope: 'mcp',
      }, jwtSecret);
      return c.json({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn });
    }

    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Health
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Version
  app.get('/version', (c) => c.json(deps?.version ?? '0.0.0'));

  // MCP endpoint — WebStandardStreamableHTTPServerTransport works on Node.js + Workers
  app.all('/mcp', async (c) => {
    let server = new McpServer({ name: deps?.name ?? 'backlog-mcp', version: deps?.version ?? '0.0.0' });
    // Apply operation logging when operationLogger is available (local Node.js mode)
    if (deps?.wrapMcpServer) {
      server = deps.wrapMcpServer(server);
    }
    registerTools(server, service, deps);
    if (deps?.resourceManager) {
      deps.resourceManager.registerResource(server);
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
  const startTime = Date.now();
  app.get('/api/status', async (c) => {
    const counts = await service.counts();
    return c.json({
      version: deps?.version ?? '0.0.0',
      mode: deps?.db ? 'cloudflare-worker' : 'local',
      taskCount: counts.total_tasks + counts.total_epics,
      dataDir: deps?.dataDir,
      port: parseInt(c.req.header('host')?.split(':')[1] ?? '0'),
      uptime: Math.floor((Date.now() - startTime) / 1000),
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

        const content = deps.readLocalFile!(filePath);
        if (content === null) {
          return c.json({ error: 'File not found', path: filePath }, 404);
        }

        try {
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

function authErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth Error — backlog-mcp</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;color:#111;}h1{font-size:1.3rem;color:#dc2626;}p{color:#555;font-size:0.95rem;}</style></head><body><h1>Authorization Failed</h1><p>${message}</p></body></html>`;
}

function tryParseJson(value: string | null): unknown {
  if (!value) return value;
  try { return JSON.parse(value); } catch { return value; }
}

// ── JWT helpers — Web Crypto API (Node.js 18+, Cloudflare Workers, Bun, Deno) ──

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const key = await hmacKey(secret, 'sign');
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(input)));
  return `${input}.${sig}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const key = await hmacKey(secret, 'verify');
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
