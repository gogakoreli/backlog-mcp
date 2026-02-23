/**
 * Types for operation logging.
 */

export interface Actor {
  type: 'user' | 'agent';
  name: string;
  delegatedBy?: string;
  taskContext?: string;
}

export type ToolName = 'backlog_create' | 'backlog_update' | 'backlog_delete' | 'write_resource';

export interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  actor: Actor;
}

export interface OperationFilter {
  taskId?: string;
  date?: string; // YYYY-MM-DD - filter by local date
  tzOffset?: number; // Client timezone offset in minutes (e.g. -480 for PST)
  limit?: number;
}

export const WRITE_TOOLS: ToolName[] = ['backlog_create', 'backlog_update', 'backlog_delete', 'write_resource'];
