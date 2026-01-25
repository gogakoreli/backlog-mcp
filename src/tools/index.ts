import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBacklogListTool } from './backlog-list.js';
import { registerBacklogGetTool } from './backlog-get.js';
import { registerBacklogCreateTool } from './backlog-create.js';
import { registerBacklogUpdateTool } from './backlog-update.js';
import { registerBacklogDeleteTool } from './backlog-delete.js';

export function registerTools(server: McpServer) {
  registerBacklogListTool(server);
  registerBacklogGetTool(server);
  registerBacklogCreateTool(server);
  registerBacklogUpdateTool(server);
  registerBacklogDeleteTool(server);
}
