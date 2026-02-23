/**
 * Operation logger - thin orchestration layer.
 * Coordinates storage, resource ID extraction, and actor info.
 */

import { OperationStorage } from './storage.js';
import { extractResourceId } from './resource-id.js';
import type { Actor, OperationEntry, OperationFilter } from './types.js';
import { WRITE_TOOLS } from './types.js';

// Read actor info from environment at module load
const actor: Actor = {
  type: (process.env.BACKLOG_ACTOR_TYPE as 'user' | 'agent') || 'user',
  name: process.env.BACKLOG_ACTOR_NAME || process.env.USER || 'unknown',
  delegatedBy: process.env.BACKLOG_DELEGATED_BY,
  taskContext: process.env.BACKLOG_TASK_CONTEXT,
};

class OperationLogger {
  private storage: OperationStorage;

  constructor() {
    this.storage = new OperationStorage();
  }

  /**
   * Log a tool operation. Only logs write operations.
   */
  log(tool: string, params: Record<string, unknown>, result: unknown): void {
    if (!WRITE_TOOLS.includes(tool as any)) return;

    const entry: OperationEntry = {
      ts: new Date().toISOString(),
      tool,
      params,
      result,
      resourceId: extractResourceId(tool, params, result),
      actor,
    };

    this.storage.append(entry);
  }

  /**
   * Read recent operations, optionally filtered by task ID.
   */
  read(options: OperationFilter = {}): OperationEntry[] {
    return this.storage.query(options);
  }

  /**
   * Count operations for a specific task (for badge display).
   */
  countForTask(taskId: string): number {
    return this.storage.countForTask(taskId);
  }
}

export const operationLogger = new OperationLogger();

// Re-export types for convenience
export type { Actor, OperationEntry, OperationFilter } from './types.js';
