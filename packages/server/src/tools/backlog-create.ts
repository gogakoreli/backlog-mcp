import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { ENTITY_TYPES } from '@backlog-mcp/shared';
import { createItem } from '../core/create.js';

/**
 * Resolve a local file path to its content.
 * This is a transport concern — the core never touches the filesystem.
 */
export function resolveSourcePath(sourcePath: string): string {
  const expanded = sourcePath.startsWith('~') ? sourcePath.replace('~', homedir()) : sourcePath;
  const resolved = resolve(expanded);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  return readFileSync(resolved, 'utf-8');
}

export function registerBacklogCreateTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new item in the backlog.',
      inputSchema: z.object({
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description in markdown'),
        source_path: z.string().optional().describe('Local file path to read as description. Mutually exclusive with description — provide one or the other. Server reads the file directly.'),
        type: z.enum(ENTITY_TYPES).optional().describe('Type: task (default) or epic'),
        epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
        parent_id: z.string().optional().describe('Parent ID (any entity). Supports subtasks (task→task), epic membership, folder organization, milestone grouping.'),
        references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)'),
      }).refine(
        (data) => !(data.description && data.source_path),
        { message: 'Cannot provide both description and source_path — use one or the other' },
      ),
    },
    async ({ source_path, ...params }) => {
      try {
        // Transport resolves source_path to description before calling core
        let description = params.description;
        if (source_path) {
          description = resolveSourcePath(source_path);
        }
        const result = await createItem(service, { ...params, description });
        return { content: [{ type: 'text', text: `Created ${result.id}` }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );
}
