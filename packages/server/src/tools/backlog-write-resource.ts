import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { editItem, NotFoundError } from '../core/index.js';

export function registerWriteResourceTool(server: McpServer, service: IBacklogService): void {
  server.registerTool(
    'write_resource',
    {
      description: `Edit the markdown body of an existing task or epic. All entity creation goes through backlog_create.
 * The \`append\` command will add content to the end of the body, automatically adding a newline if needed.
 Notes for using the \`str_replace\` command:
 * The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original body. Be mindful of whitespaces!
 * If the \`old_str\` parameter is not unique in the body, the replacement will not be performed. Include enough context to make it unique.
 * The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
      inputSchema: z.object({
        id: z.string().describe('Task or epic ID, e.g. TASK-0001 or EPIC-0002'),
        operation: z.object({
          type: z.enum(['str_replace', 'insert', 'append']).describe('Operation type'),
          old_str: z.string().optional().describe('str_replace: exact string to replace'),
          new_str: z.string().optional().describe('str_replace/insert/append: replacement or new content'),
          insert_line: z.number().optional().describe('insert: line number to insert after'),
        }).describe('Operation to apply to the body'),
      }),
    },
    async ({ id, operation }) => {
      try {
        const result = await editItem(service, { id, operation });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Task not found: ${id}` }) }] };
        }
        throw error;
      }
    }
  );
}
