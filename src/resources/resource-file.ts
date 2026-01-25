import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readMcpResource } from './resource-reader.js';

export function registerResourceFileResource(server: McpServer) {
  server.registerResource(
    'Resource File',
    'mcp://backlog/resources/{path}',
    { description: 'Read a resource file', mimeType: 'text/plain' },
    async (uri: URL) => {
      const resource = await readMcpResource(uri.toString());
      return { contents: [{ uri: uri.toString(), mimeType: resource.mimeType, text: resource.content }] };
    }
  );
}
