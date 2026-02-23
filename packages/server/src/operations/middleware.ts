import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { operationLogger } from './logger.js';
import { eventBus } from '../events/index.js';
import type { BacklogEventType } from '../events/index.js';
import { extractResourceId } from './resource-id.js';
import { WRITE_TOOLS, type ToolName } from './types.js';

/** Declarative mapping from write tool to event type. */
const TOOL_EVENT_MAP: Record<ToolName, BacklogEventType> = {
  backlog_create: 'task_created',
  backlog_update: 'task_changed',
  backlog_delete: 'task_deleted',
  write_resource: 'resource_changed',
};

function isWriteTool(name: string): name is ToolName {
  return WRITE_TOOLS.includes(name as ToolName);
}

/**
 * Wrap an MCP server to log tool operations and emit real-time events.
 * Returns a proxy that intercepts registerTool calls.
 */
export function withOperationLogging(server: McpServer): McpServer {
  const originalRegisterTool = server.registerTool.bind(server);

  // Override registerTool to wrap callbacks with logging
  (server as any).registerTool = function(
    name: string,
    config: any,
    callback: (...args: any[]) => any
  ) {
    const wrappedCallback = async (...args: any[]) => {
      const result = await callback(...args);
      const params = args[0] || {};

      // Log operation to disk
      operationLogger.log(name, params, result);

      // Emit real-time event for SSE consumers
      if (isWriteTool(name)) {
        eventBus.emit({
          type: TOOL_EVENT_MAP[name],
          id: extractResourceId(name, params, result) || '',
          tool: name,
          actor: process.env.BACKLOG_ACTOR_NAME || process.env.USER || 'unknown',
          ts: new Date().toISOString(),
        });
      }

      return result;
    };

    return originalRegisterTool(name, config, wrappedCallback as any);
  };

  return server;
}
