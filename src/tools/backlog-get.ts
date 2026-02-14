import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';

/**
 * Detect if an ID is an MCP resource URI (vs a task ID like TASK-0001).
 * Resource URIs start with "mcp://backlog/".
 */
function isResourceUri(id: string): boolean {
  return id.startsWith('mcp://backlog/');
}

/**
 * Fetch a single item — task (by ID) or resource (by MCP URI).
 * Returns the content as a string, or a "Not found" message.
 *
 * ADR-0073: backlog_get now supports resource URIs, making resources
 * accessible to agents via the same tool they use for tasks.
 */
function fetchItem(id: string): string {
  if (isResourceUri(id)) {
    const resource = storage.getResource(id);
    if (!resource) return `Not found: ${id}`;
    // Return resource with metadata header for agent context
    const header = `# Resource: ${id}\nMIME: ${resource.mimeType}`;
    const frontmatterStr = resource.frontmatter
      ? `\nFrontmatter: ${JSON.stringify(resource.frontmatter)}`
      : '';
    return `${header}${frontmatterStr}\n\n${resource.content}`;
  }

  return storage.getMarkdown(id) || `Not found: ${id}`;
}

export function registerBacklogGetTool(server: McpServer) {
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
      const results = ids.map(fetchItem);
      return { content: [{ type: 'text', text: results.join('\n\n---\n\n') }] };
    }
  );
}
