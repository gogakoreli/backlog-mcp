import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog.js';

export function registerBacklogDeleteTool(server: McpServer) {
  server.registerTool(
    'backlog_delete',
    {
      description: 'Delete a task permanently.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id }) => {
      storage.delete(id);
      return { content: [{ type: 'text', text: `Deleted ${id}` }] };
    }
  );
}
