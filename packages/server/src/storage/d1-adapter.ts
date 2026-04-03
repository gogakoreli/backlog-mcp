import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { TYPE_PREFIXES } from '@backlog-mcp/shared';
import type { AsyncStorageAdapter, ListFilter } from './storage-adapter.js';

// Minimal D1 API surface typed here to enable generic calls without
// requiring @cloudflare/workers-types at Node.js compile time.
// The actual runtime object provided by the Cloudflare Worker satisfies this interface.

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
 * A row as returned from D1 SELECT queries.
 */
interface TaskRow {
  id: string;
  type: string;
  title: string;
  status: string;
  epic_id: string | null;
  parent_id: string | null;
  blocked_reason: string | null; // JSON array serialised as string
  evidence: string | null;       // JSON array serialised as string
  references: string | null;     // JSON array serialised as string
  due_date: string | null;
  content_type: string | null;
  path: string | null;
  body: string | null;           // markdown body / description
  created_at: string;
  updated_at: string;
}

interface CountRow {
  type: string;
  status: string;
  count: number;
}

interface MaxIdRow {
  id: string;
}


// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function rowToEntity(row: TaskRow): Entity {
  const entity: Entity = {
    id: row.id,
    title: row.title,
    status: row.status as Status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (row.type && row.type !== 'task') {
    entity.type = row.type as EntityType;
  }
  if (row.epic_id) entity.epic_id = row.epic_id;
  if (row.parent_id) entity.parent_id = row.parent_id;
  if (row.due_date) entity.due_date = row.due_date;
  if (row.content_type) entity.content_type = row.content_type;
  if (row.path) entity.path = row.path;
  if (row.body) entity.description = row.body.trim();

  if (row.blocked_reason) {
    try { entity.blocked_reason = JSON.parse(row.blocked_reason); } catch { /* ignore */ }
  }
  if (row.evidence) {
    try { entity.evidence = JSON.parse(row.evidence); } catch { /* ignore */ }
  }
  if (row.references) {
    try { entity.references = JSON.parse(row.references); } catch { /* ignore */ }
  }

  return entity;
}

function toNull<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

// ──────────────────────────────────────────────────────────────────────────────
// D1StorageAdapter
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cloudflare D1 storage adapter.
 * Implements AsyncStorageAdapter — all methods return Promises.
 * Designed for use inside Cloudflare Workers (no Node.js APIs).
 *
 * FTS5 (full-text search) is kept in sync via db.batch() atomic operations.
 */
export class D1StorageAdapter implements AsyncStorageAdapter {
  constructor(private readonly db: D1Database) {}

  // ── Read operations ──────────────────────────────────────────────────────

  async get(id: string): Promise<Entity | undefined> {
    const row = await this.db
      .prepare('SELECT * FROM tasks WHERE id = ? LIMIT 1')
      .bind(id)
      .first<TaskRow>();
    return row ? rowToEntity(row) : undefined;
  }

  async getMarkdown(id: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT body FROM tasks WHERE id = ? LIMIT 1')
      .bind(id)
      .first<{ body: string | null }>();
    return row?.body ?? null;
  }

  async list(filter?: ListFilter): Promise<Entity[]> {
    const { status, type, epic_id, parent_id, limit = 20 } = filter ?? {};

    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (status && status.length > 0) {
      const placeholders = status.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...status);
    }

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    // parent_id takes precedence over epic_id (mirrors TaskStorage behaviour)
    if (parent_id) {
      conditions.push('(parent_id = ? OR epic_id = ?)');
      params.push(parent_id, parent_id);
    } else if (epic_id) {
      conditions.push('(parent_id = ? OR epic_id = ?)');
      params.push(epic_id, epic_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<TaskRow>();

    return (result.results ?? []).map(rowToEntity);
  }

  // ── Write operations ─────────────────────────────────────────────────────

  async add(task: Entity): Promise<void> {
    const body = toNull(task.description);

    await this.db
      .prepare(
        `INSERT INTO tasks
          (id, type, title, status, epic_id, parent_id,
           blocked_reason, evidence, "references",
           due_date, content_type, path, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        task.id,
        task.type ?? 'task',
        task.title,
        task.status,
        toNull(task.epic_id),
        toNull(task.parent_id),
        task.blocked_reason ? JSON.stringify(task.blocked_reason) : null,
        task.evidence ? JSON.stringify(task.evidence) : null,
        task.references ? JSON.stringify(task.references) : null,
        toNull(task.due_date),
        toNull(task.content_type),
        toNull(task.path),
        body,
        task.created_at,
        task.updated_at,
      )
      .run();

    await this.syncFts('insert', task.id);
  }

  async save(task: Entity): Promise<void> {
    const body = toNull(task.description);

    await this.db
      .prepare(
        `UPDATE tasks SET
          type = ?, title = ?, status = ?, epic_id = ?, parent_id = ?,
          blocked_reason = ?, evidence = ?, "references" = ?,
          due_date = ?, content_type = ?, path = ?, body = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        task.type ?? 'task',
        task.title,
        task.status,
        toNull(task.epic_id),
        toNull(task.parent_id),
        task.blocked_reason ? JSON.stringify(task.blocked_reason) : null,
        task.evidence ? JSON.stringify(task.evidence) : null,
        task.references ? JSON.stringify(task.references) : null,
        toNull(task.due_date),
        toNull(task.content_type),
        toNull(task.path),
        body,
        task.updated_at,
        task.id,
      )
      .run();

    await this.syncFts('update', task.id);
  }

  async delete(id: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT id FROM tasks WHERE id = ? LIMIT 1')
      .bind(id)
      .first<{ id: string }>();

    if (!row) return false;

    // Sync FTS before deleting — rowid lookup requires the row to still exist
    await this.syncFts('delete', id);
    await this.db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();

    return true;
  }

  // ── Aggregates ───────────────────────────────────────────────────────────

  async counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }> {
    const result = await this.db
      .prepare('SELECT type, status, COUNT(*) as count FROM tasks GROUP BY type, status')
      .all<CountRow>();

    const by_status: Record<Status, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };
    const by_type: Record<string, number> = {};
    let total_tasks = 0;
    let total_epics = 0;

    for (const row of result.results ?? []) {
      const t = row.type ?? 'task';
      const s = row.status as Status;
      const n = row.count;

      by_status[s] = (by_status[s] ?? 0) + n;
      by_type[t] = (by_type[t] ?? 0) + n;

      if (t === 'epic') {
        total_epics += n;
      } else {
        total_tasks += n;
      }
    }

    return { total_tasks, total_epics, by_status, by_type };
  }

  async getMaxId(type?: EntityType): Promise<number> {
    const resolvedType: EntityType = type ?? ('task' as EntityType);
    const prefix = TYPE_PREFIXES[resolvedType];

    const row = await this.db
      .prepare(
        "SELECT id FROM tasks WHERE type = ? AND id LIKE ? ORDER BY id DESC LIMIT 1"
      )
      .bind(resolvedType, `${prefix}-%`)
      .first<MaxIdRow>();

    if (!row?.id) return 0;

    // Extract numeric portion: e.g. "TASK-0042" → 42
    const num = parseInt(row.id.split('-')[1] ?? '0', 10);
    return isNaN(num) ? 0 : num;
  }

  // ── Full-text search ─────────────────────────────────────────────────────

  async search(query: string, limit = 20): Promise<Entity[]> {
    try {
      const result = await this.db
        .prepare(
          `SELECT t.* FROM tasks t
           JOIN tasks_fts f ON t.rowid = f.rowid
           WHERE tasks_fts MATCH ?
           ORDER BY bm25(tasks_fts)
           LIMIT ?`
        )
        .bind(query, limit)
        .all<TaskRow>();
      return (result.results ?? []).map(rowToEntity);
    } catch {
      // FTS index is corrupt or unavailable — attempt a rebuild then retry once
      try {
        await this.db.prepare("INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')").run();
        const result = await this.db
          .prepare(
            `SELECT t.* FROM tasks t
             JOIN tasks_fts f ON t.rowid = f.rowid
             WHERE tasks_fts MATCH ?
             ORDER BY bm25(tasks_fts)
             LIMIT ?`
          )
          .bind(query, limit)
          .all<TaskRow>();
        return (result.results ?? []).map(rowToEntity);
      } catch {
        // Rebuild failed — fall back to LIKE search so the app stays functional
        const like = `%${query}%`;
        const result = await this.db
          .prepare(
            `SELECT * FROM tasks WHERE title LIKE ? OR body LIKE ? ORDER BY updated_at DESC LIMIT ?`
          )
          .bind(like, like, limit)
          .all<TaskRow>();
        return (result.results ?? []).map(rowToEntity);
      }
    }
  }

  // ── FTS5 sync ────────────────────────────────────────────────────────────

  // Keeps the FTS index in sync after writes. Separated from the main write
  // so FTS failures never block task operations. Attempts a full rebuild if
  // an individual sync fails (e.g. after a crash left the index inconsistent).
  private async syncFts(op: 'insert' | 'update' | 'delete', id: string): Promise<void> {
    try {
      if (op === 'insert') {
        await this.db
          .prepare('INSERT INTO tasks_fts(rowid, id, title, body) SELECT rowid, id, title, body FROM tasks WHERE id = ?')
          .bind(id)
          .run();
      } else if (op === 'update') {
        await this.db.batch([
          this.db
            .prepare("INSERT INTO tasks_fts(tasks_fts, rowid, id, title, body) SELECT 'delete', rowid, id, title, body FROM tasks WHERE id = ?")
            .bind(id),
          this.db
            .prepare('INSERT INTO tasks_fts(rowid, id, title, body) SELECT rowid, id, title, body FROM tasks WHERE id = ?')
            .bind(id),
        ]);
      } else {
        await this.db
          .prepare("INSERT INTO tasks_fts(tasks_fts, rowid, id, title, body) SELECT 'delete', rowid, id, title, body FROM tasks WHERE id = ?")
          .bind(id)
          .run();
      }
    } catch {
      // Individual sync failed — rebuild the entire index to restore consistency
      try {
        await this.db.prepare("INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')").run();
      } catch { /* ignore — search will self-heal on next query */ }
    }
  }
}
