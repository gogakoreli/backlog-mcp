import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { STATUSES, TASK_TYPES } from '../storage/schema.js';

export function registerBacklogListTool(server: McpServer) {
  server.registerTool(
    'backlog_list',
    {
      description: 'List tasks from backlog. Returns most recently updated items first. Default: shows only active work (open/in_progress/blocked), limited to 20 items. Use counts=true to check if more items exist beyond the limit.',
      inputSchema: z.object({
        status: z.array(z.enum(STATUSES)).optional().describe('Filter by status. Options: open, in_progress, blocked, done, cancelled. Default: [open, in_progress, blocked]. Pass ["done"] to see completed work.'),
        type: z.enum(TASK_TYPES).optional().describe('Filter by type. Options: task, epic, folder, artifact, milestone. Default: returns all.'),
        epic_id: z.string().optional().describe('Filter tasks belonging to a specific epic. Example: epic_id="EPIC-0001"'),
        parent_id: z.string().optional().describe('Filter items by parent. Example: parent_id="FLDR-0001"'),
        query: z.string().optional().describe('Search across all task fields (title, description, evidence, references, etc.). Case-insensitive substring matching.'),
        counts: z.boolean().optional().describe('Include global counts { total_tasks, total_epics, by_status, by_type } alongside results. Use this to detect if more items exist beyond the limit. Default: false'),
        limit: z.number().optional().describe('Max items to return. Default: 20. Increase if you need to see more items (e.g., limit=100 to list all epics).'),
      }),
    },
    async ({ status, type, epic_id, parent_id, query, counts, limit }) => {
      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      const tasks = await storage.list({ status, type, parent_id: resolvedParent, query, limit });
      const list = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        type: t.type ?? 'task',
        parent_id: t.parent_id ?? t.epic_id,
      }));
      const result: any = { tasks: list };
      if (counts) result.counts = storage.counts();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
