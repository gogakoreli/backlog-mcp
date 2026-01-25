import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog.js';
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
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links with optional titles'),
      }),
    },
    async ({ title, description, type, epic_id, references }) => {
      const id = nextTaskId(storage.getMaxId(type), type);
      const task = createTask({ id, title, description, type, epic_id, references });
      storage.add(task);
      return { content: [{ type: 'text', text: `Created ${task.id}` }] };
    }
  );
}
