import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog.js';
import { STATUSES } from '../storage/schema.js';

export function registerBacklogUpdateTool(server: McpServer) {
  server.registerTool(
    'backlog_update',
    {
      description: 'Update an existing task.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description (replaces entire content). For appending/editing sections, use write_resource tool instead'),
        status: z.enum(STATUSES).optional().describe('New status'),
        epic_id: z.union([z.string(), z.null()]).optional().describe('Parent epic ID (null to unlink)'),
        blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
        evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }),
    },
    async ({ id, ...updates }) => {
      const task = storage.get(id);
      if (!task) return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };
      Object.assign(task, updates, { updated_at: new Date().toISOString() });
      storage.save(task);
      return { content: [{ type: 'text', text: `Updated ${id}` }] };
    }
  );
}
