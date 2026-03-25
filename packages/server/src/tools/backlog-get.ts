import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { getItems, type GetItem } from '../core/index.js';

/** MCP transport formatting — core returns raw data, we present it */
function formatItem(item: GetItem): string {
  if (item.content === null) return `Not found: ${item.id}`;
  if (item.resource) {
    const header = `# Resource: ${item.id}\nMIME: ${item.resource.mimeType}`;
    const fm = item.resource.frontmatter ? `\nFrontmatter: ${JSON.stringify(item.resource.frontmatter)}` : '';
    return `${header}${fm}\n\n${item.resource.content}`;
  }
  return item.content;
}

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
      const text = result.items.map(formatItem).join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );
}
