import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { nextTaskId, createTask, TASK_TYPES } from '../storage/schema.js';

export function resolveSourcePath(sourcePath: string): string {
  const expanded = sourcePath.startsWith('~') ? sourcePath.replace('~', homedir()) : sourcePath;
  const resolved = resolve(expanded);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  return readFileSync(resolved, 'utf-8');
}

export function registerBacklogCreateTool(server: McpServer) {
  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new item in the backlog.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description in markdown'),
        source_path: z.string().optional().describe('Local file path to read as description. Mutually exclusive with description — provide one or the other. Server reads the file directly.'),
        type: z.enum(TASK_TYPES).optional().describe('Type: task (default) or epic'),
        epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
        parent_id: z.string().optional().describe('Parent ID (any entity). Supports subtasks (task→task), epic membership, folder organization, milestone grouping.'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }).refine(
        (data) => !(data.description && data.source_path),
        { message: 'Cannot provide both description and source_path — use one or the other' },
      ),
    },
    async ({ title, description, source_path, type, epic_id, parent_id, references }) => {
      let resolvedDescription = description;
      if (source_path) {
        try {
          resolvedDescription = resolveSourcePath(source_path);
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `Error reading source_path: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }

      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      const id = nextTaskId(storage.getMaxId(type), type);
      const task = createTask({ id, title, description: resolvedDescription, type, parent_id: resolvedParent, references });
      // Write epic_id too for backward compat when caller used epic_id
      if (epic_id && !parent_id) task.epic_id = epic_id;
      storage.add(task);
      return { content: [{ type: 'text', text: `Created ${task.id}` }] };
    }
  );
}
