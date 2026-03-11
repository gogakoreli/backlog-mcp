/**
 * D1-backed operation log for Cloudflare Workers.
 * Mirrors OperationStorage but persists to a D1 `operations` table.
 * All writes use ctx.waitUntil() so they are non-blocking.
 */

import type { OperationEntry, OperationFilter } from './types.js';

// Minimal D1 API surface typed here to enable generic calls without
// requiring @cloudflare/workers-types at Node.js compile time.

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

/**
 * Minimal subset of the Cloudflare Workers ExecutionContext needed here.
 */
interface WorkerExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

interface OperationRow {
  id: number;
  ts: string;
  tool: string;
  actor: string | null;
  resource_id: string | null;
  task_id: string | null;
  params: string | null;
  result: string | null;
}

function rowToEntry(row: OperationRow): OperationEntry {
  return {
    ts: row.ts,
    tool: row.tool,
    actor: row.actor ? JSON.parse(row.actor) : { type: 'user', name: 'unknown' },
    resourceId: row.resource_id ?? undefined,
    params: row.params ? JSON.parse(row.params) : {},
    result: row.result ? JSON.parse(row.result) : null,
  };
}

export class D1OperationLog {
  constructor(
    private readonly db: D1Database,
    private readonly ctx: WorkerExecutionContext,
  ) {}

  /**
   * Append an operation entry to D1. Fire-and-forget via waitUntil.
   */
  append(entry: OperationEntry): void {
    const taskId: string | null =
      typeof (entry.params as any)?.id === 'string'
        ? (entry.params as any).id
        : null;

    this.ctx.waitUntil(
      this.db
        .prepare(
          'INSERT INTO operations (ts, tool, actor, resource_id, task_id, params, result) VALUES (?,?,?,?,?,?,?)'
        )
        .bind(
          entry.ts,
          entry.tool,
          JSON.stringify(entry.actor),
          entry.resourceId ?? null,
          taskId,
          JSON.stringify(entry.params),
          JSON.stringify(entry.result),
        )
        .run(),
    );
  }

  /**
   * Query operations with optional filtering. Returns most-recent-first.
   */
  async query(filter: OperationFilter = {}): Promise<OperationEntry[]> {
    const { taskId, date, limit = 50 } = filter;

    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (taskId) {
      conditions.push('task_id = ?');
      params.push(taskId);
    }

    if (date) {
      // ts is an ISO string; slice(0,10) gives YYYY-MM-DD
      conditions.push("substr(ts, 1, 10) = ?");
      params.push(date);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM operations ${where} ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<OperationRow>();

    return (result.results ?? []).map(rowToEntry);
  }

  /**
   * Count operations for a specific task (e.g. for badge display).
   */
  async countForTask(taskId: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM operations WHERE task_id = ?')
      .bind(taskId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}
