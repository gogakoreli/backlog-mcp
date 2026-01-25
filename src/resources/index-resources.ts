import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTasksResource } from './tasks.js';
import { registerTaskByIdResource } from './task-by-id.js';
import { registerTaskAttachedResource } from './task-attached.js';
import { registerResourceFileResource } from './resource-file.js';

export function registerResources(server: McpServer) {
  registerTasksResource(server);
  registerTaskByIdResource(server);
  registerTaskAttachedResource(server);
  registerResourceFileResource(server);
}
