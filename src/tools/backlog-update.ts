import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { STATUSES } from '../storage/schema.js';

export function registerBacklogUpdateTool(server: McpServer) {
  server.registerTool(
    'backlog_update',
    {
      description: 'Update an existing task. For updating task content, use write_resource with `mcp://backlog/tasks/TASK-XXXX.md`.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title'),
        status: z.enum(STATUSES).optional().describe('New status'),
        epic_id: z.union([z.string(), z.null()]).optional().describe('Parent epic ID (null to unlink)'),
        parent_id: z.union([z.string(), z.null()]).optional().describe('Parent ID (null to unlink). Takes precedence over epic_id.'),
        blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
        evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }),
    },
    async ({ id, epic_id, parent_id, ...updates }) => {
      const task = storage.get(id);
      if (!task) return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };

      // parent_id takes precedence over epic_id
      if (parent_id !== undefined) {
        if (parent_id === null) {
          delete task.parent_id;
          delete task.epic_id;
        } else {
          task.parent_id = parent_id;
        }
      } else if (epic_id !== undefined) {
        if (epic_id === null) {
          delete task.epic_id;
          delete task.parent_id;
        } else {
          task.epic_id = epic_id;
          task.parent_id = epic_id;
        }
      }

      Object.assign(task, updates, { updated_at: new Date().toISOString() });
      storage.save(task);
      return { content: [{ type: 'text', text: `Updated ${id}` }] };
    }
  );
}
