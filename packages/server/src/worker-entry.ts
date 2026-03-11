/**
 * Cloudflare Worker entry point for backlog-mcp.
 *
 * Serves the MCP endpoint backed by D1 storage using
 * WebStandardStreamableHTTPServerTransport — natively compatible with Cloudflare
 * Workers (no Node.js shims required).
 *
 * ADR-0089 Phase 2.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { D1BacklogService } from './storage/d1-backlog-service.js';
import { D1OperationLog } from './operations/d1-operation-log.js';
import { registerWorkerTools } from './tools/worker-tools.js';

export interface WorkerEnv {
  /** Cloudflare D1 database binding (configured in wrangler.jsonc) */
  DB: any; // D1Database
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', mode: 'cloudflare-worker' }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      const service = new D1BacklogService(env.DB);
      // D1OperationLog is instantiated for potential future audit logging
      void new D1OperationLog(env.DB, ctx);

      const server = new McpServer({ name: 'backlog-mcp', version: '0.46.0' });
      registerWorkerTools(server, service);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
        enableJsonResponse: true,
      });

      await server.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
