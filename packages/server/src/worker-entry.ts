/**
 * Cloudflare Worker entry point for backlog-mcp. ADR-0089.
 * Cloudflare is just hosting — all logic is in hono-app.ts.
 */
import { createApp } from './server/hono-app.js';
import { D1BacklogService } from './storage/d1-backlog-service.js';

export interface WorkerEnv {
  DB: any;            // D1Database
  API_KEY?: string;
  CLIENT_SECRET?: string;
  JWT_SECRET?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const service = new D1BacklogService(env.DB);
    const app = createApp(service, {
      name: 'backlog-mcp',
      version: '0.46.0',
      db: env.DB,
      apiKey: env.API_KEY,
      clientSecret: env.CLIENT_SECRET,
      jwtSecret: env.JWT_SECRET,
    });
    return app.fetch(request);
  },
};
