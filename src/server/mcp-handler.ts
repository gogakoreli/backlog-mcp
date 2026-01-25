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
  // GET /mcp - Establish SSE connection
  app.get('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    
    registerTools(server);
    registerResources(server);
    
    const transport = new SSEServerTransport('/mcp/message', reply.raw);
    sessions.set(transport.sessionId, transport);
    
    transport.onclose = () => sessions.delete(transport.sessionId);
    
    await server.connect(transport);
    return reply;
  });
  
  // POST /mcp/message - Handle MCP messages
  app.post('/mcp/message', async (request, reply) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId;
    
    if (!sessionId) {
      return reply.code(400).send({ error: 'Missing sessionId' });
    }
    
    const transport = sessions.get(sessionId);
    if (!transport) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
    return reply;
  });
}
