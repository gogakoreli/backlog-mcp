/**
 * Cloudflare Worker entry point for backlog-mcp. ADR-0089.
 * Cloudflare is just hosting — all logic is in hono-app.ts.
 */
import { createApp } from './server/hono-app.js';
import { D1BacklogService } from './storage/d1-backlog-service.js';
import { D1OperationLog } from './operations/d1-operation-log.js';
import { withOperationLogging } from './operations/middleware.js';

export interface WorkerEnv {
  DB: any;            // D1Database
  API_KEY?: string;
  CLIENT_SECRET?: string;
  JWT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ALLOWED_GITHUB_USERNAMES?: string; // comma-separated e.g. "gkoreli,gogakoreli"
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: any): Promise<Response> {
    const service = new D1BacklogService(env.DB);
    const operationLog = new D1OperationLog(env.DB, ctx);

    const app = createApp(service, {
      name: 'backlog-mcp',
      version: '0.47.2',
      db: env.DB,
      apiKey: env.API_KEY,
      clientSecret: env.CLIENT_SECRET,
      jwtSecret: env.JWT_SECRET,
      githubClientId: env.GITHUB_CLIENT_ID,
      githubClientSecret: env.GITHUB_CLIENT_SECRET,
      allowedGithubUsernames: env.ALLOWED_GITHUB_USERNAMES,
      operationLog,
      wrapMcpServer: withOperationLogging(operationLog, {
        actor: { type: 'agent', name: 'claude' },
      }),
    });
    return app.fetch(request);
  },
};
