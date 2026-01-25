import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storage } from '../storage/backlog.js';

export function registerTasksResource(server: McpServer) {
  server.registerResource(
    'All Tasks',
    'mcp://backlog/tasks',
    { description: 'List of all tasks', mimeType: 'application/json' },
    async () => {
      const tasks = storage.list({});
      return { contents: [{ uri: 'mcp://backlog/tasks', mimeType: 'application/json', text: JSON.stringify(tasks, null, 2) }] };
    }
  );
}
