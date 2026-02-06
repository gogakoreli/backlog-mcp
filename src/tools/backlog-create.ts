import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { nextTaskId, createTask, TASK_TYPES } from '../storage/schema.js';

export function registerBacklogCreateTool(server: McpServer) {
  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new task in the backlog.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description in markdown'),
        type: z.enum(TASK_TYPES).optional().describe('Type: task (default) or epic'),
        epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
        parent_id: z.string().optional().describe('Parent ID (any entity). Supports subtasks (task→task), epic membership, folder organization, milestone grouping.'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }),
    },
    async ({ title, description, type, epic_id, parent_id, references }) => {
      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      const id = nextTaskId(storage.getMaxId(type), type);
      const task = createTask({ id, title, description, type, parent_id: resolvedParent, references });
      // Write epic_id too for backward compat when caller used epic_id
      if (epic_id && !parent_id) task.epic_id = epic_id;
      storage.add(task);
      return { content: [{ type: 'text', text: `Created ${task.id}` }] };
    }
  );
}
