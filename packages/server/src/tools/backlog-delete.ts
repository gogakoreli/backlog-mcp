import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';

export function registerBacklogDeleteTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_delete',
    {
      description: 'Delete an item permanently.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id }) => {
      await service.delete(id);
      return { content: [{ type: 'text', text: `Deleted ${id}` }] };
    }
  );
}
