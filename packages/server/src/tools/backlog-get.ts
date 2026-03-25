import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { getItems } from '../core/get.js';

export function registerBacklogGetTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_get',
    {
      description: 'Get full details by ID. Accepts task IDs (TASK-0001, EPIC-0002) or MCP resource URIs (mcp://backlog/resources/design.md). Works for any item regardless of status.',
      inputSchema: z.object({
        id: z.union([z.string(), z.array(z.string())]).describe('Task ID (e.g. TASK-0001) or MCP resource URI (e.g. mcp://backlog/resources/file.md). Array for batch fetch.'),
      }),
    },
    async ({ id }) => {
      const ids = Array.isArray(id) ? id : [id];
      if (ids.length === 0) {
        return { content: [{ type: 'text', text: 'Required: id' }], isError: true };
      }
      const result = await getItems(service, { ids });
      // MCP format: join items with separator, show "Not found" for nulls
      const text = result.items
        .map(item => item.content ?? `Not found: ${item.id}`)
        .join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );
}
