import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { operationLogger } from './logger.js';
import { eventBus } from '../events/index.js';
import { extractResourceId } from './resource-id.js';
import { WRITE_TOOLS } from './types.js';

/** Map tool names to event types for the EventBus. */
function toolToEventType(tool: string): 'task_changed' | 'task_created' | 'task_deleted' | 'resource_changed' {
  switch (tool) {
    case 'backlog_create': return 'task_created';
    case 'backlog_delete': return 'task_deleted';
    case 'write_resource': return 'resource_changed';
    default: return 'task_changed';
  }
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
      if (WRITE_TOOLS.includes(name as any)) {
        eventBus.emit({
          type: toolToEventType(name),
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
