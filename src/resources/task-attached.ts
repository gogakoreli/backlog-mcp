import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readMcpResource } from './resource-reader.js';

export function registerTaskAttachedResource(server: McpServer) {
  server.registerResource(
    'Task-Attached Resource',
    'mcp://backlog/resources/{taskId}/{filename}',
    { description: 'Task-attached resources (ADRs, design docs, etc.)' },
    async (uri: URL) => {
      const { content, mimeType } = await readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType, text: content }] };
    }
  );
}
