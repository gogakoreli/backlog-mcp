import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { operationLogger } from './logger.js';

/**
 * Wrap an MCP server to log tool operations.
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
      // args[0] is the params object for tool callbacks
      operationLogger.log(name, args[0] || {}, result);
      return result;
    };

    return originalRegisterTool(name, config, wrappedCallback as any);
  };

  return server;
}
