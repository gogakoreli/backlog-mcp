import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { STATUSES } from '@backlog-mcp/shared';
import { updateItem, NotFoundError } from '../core/index.js';

export function registerBacklogUpdateTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_update',
    {
      description: 'Update an existing item. For editing the markdown body, use write_resource with str_replace.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title'),
        status: z.enum(STATUSES).optional().describe('New status'),
        epic_id: z.union([z.string(), z.null()]).optional().describe('Parent epic ID (null to unlink)'),
        parent_id: z.union([z.string(), z.null()]).optional().describe('Parent ID (null to unlink). Takes precedence over epic_id.'),
        blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
        evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
        due_date: z.union([z.string(), z.null()]).optional().describe('Due date for milestones (ISO 8601). Null to clear.'),
        content_type: z.union([z.string(), z.null()]).optional().describe('Content type for artifacts (e.g. text/markdown). Null to clear.'),
      }),
    },
    async (params) => {
      try {
        const result = await updateItem(service, params);
        return { content: [{ type: 'text', text: `Updated ${result.id}` }] };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return { content: [{ type: 'text', text: `Task ${params.id} not found` }], isError: true };
        }
        throw error;
      }
    }
  );
}
