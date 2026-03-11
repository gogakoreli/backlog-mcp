import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IBacklogService } from '../storage/service-types.js';
import { registerBacklogListTool } from './backlog-list.js';
import { registerBacklogGetTool } from './backlog-get.js';
import { registerBacklogCreateTool } from './backlog-create.js';
import { registerBacklogUpdateTool } from './backlog-update.js';
import { registerBacklogDeleteTool } from './backlog-delete.js';
import { registerBacklogSearchTool } from './backlog-search.js';
import { registerBacklogContextTool } from './backlog-context.js';

export interface ToolDeps {
  resourceManager?: any;
  operationLogger?: any;
}

export function registerTools(server: McpServer, service: IBacklogService, deps?: ToolDeps): void {
  registerBacklogListTool(server, service);
  registerBacklogGetTool(server, service);
  registerBacklogCreateTool(server, service);
  registerBacklogUpdateTool(server, service);
  registerBacklogDeleteTool(server, service);
  registerBacklogSearchTool(server, service);
  if (deps?.resourceManager && deps?.operationLogger) {
    registerBacklogContextTool(server, service, { resourceManager: deps.resourceManager, operationLogger: deps.operationLogger });
  }
}
