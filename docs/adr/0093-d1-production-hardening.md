---
title: "D1 Production Hardening — FTS5 Resilience + IOperationLog Abstraction"
date: 2026-04-03
status: Accepted
---

# 0093. D1 Production Hardening — FTS5 Resilience + IOperationLog Abstraction

## Context

After the initial Cloudflare Workers + D1 deployment (ADR-0089), two production failures
surfaced:

1. **`SQLITE_CORRUPT_VTAB`** — FTS5 full-text search virtual table corruption on write operations
2. **Empty operations log** — the audit/activity log was completely empty in cloud mode despite MCP tool calls succeeding

Both were silent regressions introduced during the D1 migration that only appeared under
real usage.

---

## Problem 1: SQLITE_CORRUPT_VTAB

### Root cause

`D1Adapter.save()` executed a batch of three statements in the wrong order:

```
BEFORE (broken):
  1. UPDATE tasks SET ...          ← writes NEW values to the main table
  2. DELETE FROM tasks_fts WHERE   ← FTS reads the row to determine what to delete... but row is ALREADY updated
  3. INSERT INTO tasks_fts VALUES  ← inserts NEW values again
```

Step 2 is the bug: the FTS5 `DELETE` triggers a read of the current row to update its index.
By the time it runs, the `UPDATE` has already changed the row. The FTS index records a
deletion of the NEW values instead of the OLD values, leaving the OLD values stranded in
the index. Over time, repeated saves desynchronize the FTS index from the main table until
SQLite detects the inconsistency and raises `SQLITE_CORRUPT_VTAB`.

### Fix: reorder the batch

```
AFTER (correct):
  1. DELETE FROM tasks_fts WHERE   ← FTS reads OLD values (row not yet updated)
  2. UPDATE tasks SET ...          ← writes NEW values
  3. INSERT INTO tasks_fts VALUES  ← indexes NEW values
```

The FTS delete must happen before the row is mutated so it captures what needs to be removed.

### Fix: decouple FTS sync into a separate method with auto-rebuild

A private `syncFts(op, id)` method handles FTS maintenance for `add()`, `save()`, and `delete()`.
If FTS sync fails for any reason, it catches the error silently (the main table write succeeded).

The `search()` method has three-tier resilience:
1. **FTS query** — normal path
2. **Auto-rebuild + retry** — if FTS fails with a corruption error, drop and recreate the
   `tasks_fts` table from the main table, then retry the search
3. **LIKE fallback** — if rebuild also fails, fall back to `WHERE title LIKE ?` so the app
   stays functional even with an unrecoverable FTS table

### Why FTS5, not Orama?

Orama's local embedding model (`Xenova/all-MiniLM-L6-v2`) is 23 MB. Cloudflare Workers
have a 1 MB (free) / 10 MB (paid) script size limit. The model cannot be bundled into or
fetched at runtime by a Worker. FTS5 is the correct search backend for cloud mode — it
runs natively in SQLite/D1 with zero bundle impact. Local mode continues to use Orama with
BM25 + vector hybrid search (ADR-0042).

---

## Problem 2: Empty Operations Log in Cloud Mode

### Root cause

`D1OperationLog` was defined in `src/operations/d1-operation-log.ts` but was never
instantiated or injected anywhere. `worker-entry.ts` did not create a `D1OperationLog`
instance, did not pass `wrapMcpServer`, and the operations HTTP endpoints fell through to
a `return c.json([])` default. All MCP tool calls in cloud mode ran unlogged and the
operations table stayed empty.

The local `operationLogger` (JSONL-backed) had always worked because it was a singleton
imported directly. The D1 equivalent was a dead artifact.

### Fix: IOperationLog interface + factory wrapper

**`IOperationLog` interface** (`src/operations/types.ts`):
```typescript
export interface IOperationLog {
  append(entry: OperationEntry): void;
  query(filter?: OperationFilter): Promise<OperationEntry[]>;
  countForTask(taskId: string): Promise<number>;
}
```

Both implementations satisfy this interface:
- `OperationLogger` (local) — JSONL file, synchronous reads, implemented `IOperationLog`
- `D1OperationLog` (cloud) — D1 table, `ctx.waitUntil()` for fire-and-forget writes

**`withOperationLogging` refactored to a factory**:

```typescript
// Before: coupled to singletons
import { operationLogger } from '../operations/logger.js';
import { eventBus } from '../events/index.js';

// After: pure factory, works for any IOperationLog
export function withOperationLogging(
  log: IOperationLog,
  opts: OperationLoggingOptions = {},
): (server: McpServer) => McpServer
```

The factory wraps `server.registerTool` to intercept write operations (`backlog_create`,
`backlog_update`, `backlog_delete`, `write_resource`), append to the log, and optionally
emit SSE events.

**`AppDeps` updated**: `operationLogger?: any` + raw D1 SQL in HTTP routes replaced by
`operationLog?: IOperationLog`. Both local and cloud modes use the same HTTP endpoint code.

**Wiring**:

```typescript
// worker-entry.ts (cloud)
const operationLog = new D1OperationLog(env.DB, ctx);
createApp(service, {
  operationLog,
  wrapMcpServer: withOperationLogging(operationLog, {
    actor: { type: 'agent', name: 'claude' },
  }),
});

// node-server.ts (local)
createApp(service, {
  operationLog: operationLogger,
  wrapMcpServer: withOperationLogging(operationLogger, { eventBus }),
});
```

### ctx.waitUntil() for D1 writes

`D1OperationLog.append()` calls `ctx.waitUntil(db.prepare(...).bind(...).run())`.
This schedules the D1 write as a background task that completes after the HTTP response
is sent. The MCP tool call is not blocked by the log write, and the write is not dropped
when the response completes (Workers would otherwise terminate execution).

---

## Architecture after hardening

```
Local mode:
  withOperationLogging(operationLogger, { eventBus })
    → OperationLogger implements IOperationLog
    → JSONL file (append) + in-memory index (query)
    → eventBus.emit() for SSE push to viewer

Cloud mode:
  withOperationLogging(new D1OperationLog(db, ctx))
    → D1OperationLog implements IOperationLog
    → ctx.waitUntil(db write) — non-blocking
    → no eventBus (stateless Workers, no persistent SSE)

hono-app.ts:
  GET /operations         → deps.operationLog.query(filter)
  GET /operations/count/:id → deps.operationLog.countForTask(id)
  (single code path for both environments)
```

---

## Consequences

- FTS5 corruption is fixed at the root cause; three-tier resilience ensures search never
  hard-fails even if FTS becomes unrecoverable
- Operations log works in cloud mode; MCP tool calls are now audited
- `IOperationLog` is the extension point for future backends (e.g. R2, Durable Objects)
- `hono-app.ts` no longer contains raw D1 SQL for operations — cleaner separation
- `withOperationLogging` is a pure function (no module-level side effects) — testable in isolation
