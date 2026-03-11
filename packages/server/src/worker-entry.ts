/**
 * Cloudflare Worker entry point for backlog-mcp. ADR-0089.
 * Cloudflare is just hosting — all logic is in hono-app.ts.
 */
import { createApp } from './server/hono-app.js';
import { D1BacklogService } from './storage/d1-backlog-service.js';

export interface WorkerEnv {
  DB: any; // D1Database
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const service = new D1BacklogService(env.DB);
    const app = createApp(service, { db: env.DB });
    return app.fetch(request);
  },
};
