import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BacklogEventType } from '../events/index.js';
import { extractResourceId } from './resource-id.js';
import { WRITE_TOOLS, type ToolName, type IOperationLog, type Actor, type OperationEntry } from './types.js';

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

export interface OperationLoggingOptions {
  /**
   * Actor to attribute operations to.
   * Defaults to reading BACKLOG_ACTOR_* env vars (local mode).
   */
  actor?: Actor;
  /**
   * Optional event bus for real-time SSE push.
   * Omit in cloud mode where stateless Workers have no persistent bus.
   */
  eventBus?: { emit: (event: any) => void };
}

/**
 * Factory that returns an MCP server wrapper which logs write operations
 * and optionally emits real-time events.
 *
 * Accepts any IOperationLog implementation — works identically for
 * local (JSONL) and cloud (D1) deployments.
 *
 * Usage:
 *   // Local Node.js
 *   wrapMcpServer: withOperationLogging(operationLogger, { eventBus })
 *
 *   // Cloudflare Workers
 *   wrapMcpServer: withOperationLogging(new D1OperationLog(db, ctx))
 */
export function withOperationLogging(
  log: IOperationLog,
  opts: OperationLoggingOptions = {},
): (server: McpServer) => McpServer {
  const actor: Actor = opts.actor ?? {
    type: (process.env.BACKLOG_ACTOR_TYPE as 'user' | 'agent') || 'user',
    name: process.env.BACKLOG_ACTOR_NAME || process.env.USER || 'unknown',
    delegatedBy: process.env.BACKLOG_DELEGATED_BY,
    taskContext: process.env.BACKLOG_TASK_CONTEXT,
  };

  return (server: McpServer): McpServer => {
    const originalRegisterTool = server.registerTool.bind(server);

    (server as any).registerTool = function(
      name: string,
      config: any,
      callback: (...args: any[]) => any,
    ) {
      const wrappedCallback = async (...args: any[]) => {
        const result = await callback(...args);

        if (isWriteTool(name)) {
          const params = args[0] || {};
          const entry: OperationEntry = {
            ts: new Date().toISOString(),
            tool: name,
            params,
            result,
            resourceId: extractResourceId(name, params, result),
            actor,
          };

          log.append(entry);

          opts.eventBus?.emit({
            type: TOOL_EVENT_MAP[name],
            id: entry.resourceId || '',
            tool: name,
            actor: actor.name,
            ts: entry.ts,
          });
        }

        return result;
      };

      return originalRegisterTool(name, config, wrappedCallback as any);
    };

    return server;
  };
}
