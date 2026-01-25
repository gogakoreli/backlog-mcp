import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index-resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

const sessions = new Map<string, SSEServerTransport>();

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    if (request.method === 'GET') {
      // Establish SSE connection
      const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
      
      registerTools(server);
      registerResources(server);
      
      const transport = new SSEServerTransport('/mcp/message', reply.raw);
      sessions.set(transport.sessionId, transport);
      
      transport.onclose = () => sessions.delete(transport.sessionId);
      
      await server.connect(transport);
      return reply;
    }
    
    if (request.method === 'POST') {
      // Handle MCP message
      const url = new URL(request.url, `http://${request.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');
      
      if (!sessionId) {
        return reply.code(400).send('Missing sessionId');
      }
      
      const transport = sessions.get(sessionId);
      if (!transport) {
        return reply.code(404).send('Session not found');
      }
      
      const message = request.body;
      await transport.send(message as any);
      return reply.code(202).send();
    }
    
    return reply.code(405).send('Method not allowed');
  });
}
