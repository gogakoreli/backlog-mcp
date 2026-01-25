import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog.js';

export function registerBacklogGetTool(server: McpServer) {
  server.registerTool(
    'backlog_get',
    {
      description: 'Get full task details by ID. Works for any task regardless of status.',
      inputSchema: z.object({
        id: z.union([z.string(), z.array(z.string())]).describe('Task ID like TASK-0001, or array for batch fetch'),
      }),
    },
    async ({ id }) => {
      const taskIds = Array.isArray(id) ? id : [id];
      if (taskIds.length === 0) {
        return { content: [{ type: 'text', text: 'Required: id' }], isError: true };
      }
      const results = taskIds.map((tid) => storage.getMarkdown(tid) || `Not found: ${tid}`);
      return { content: [{ type: 'text', text: results.join('\n\n---\n\n') }] };
    }
  );
}
