import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index-resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    
    registerTools(server);
    registerResources(server);
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    
    await server.connect(transport);
    
    reply.hijack();
    
    reply.raw.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
