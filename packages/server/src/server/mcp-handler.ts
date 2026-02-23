import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from '@/tools/index.js';
import { resourceManager } from '@/resources/manager.js';
import { paths } from '@/utils/paths.js';
import { withOperationLogging } from '@/operations/index.js';

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    const server = withOperationLogging(new McpServer({ 
      name: paths.packageJson.name, 
      version: paths.getVersion() 
    }));
    
    registerTools(server);
    resourceManager.registerResource(server);
    resourceManager.registerWriteTool(server);
    
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
