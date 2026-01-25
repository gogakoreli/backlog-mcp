import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storage } from '../storage/backlog.js';

export function registerTaskByIdResource(server: McpServer) {
  server.registerResource(
    'Task by ID',
    'mcp://backlog/tasks/{taskId}/file',
    { description: 'Get a specific task', mimeType: 'text/markdown' },
    async (uri: URL) => {
      const match = uri.toString().match(/mcp:\/\/backlog\/tasks\/([^/]+)\/file/);
      if (!match || !match[1]) throw new Error('Invalid URI');
      const markdown = storage.getMarkdown(match[1]);
      if (!markdown) throw new Error('Task not found');
      return { contents: [{ uri: uri.toString(), mimeType: 'text/markdown', text: markdown }] };
    }
  );
}
