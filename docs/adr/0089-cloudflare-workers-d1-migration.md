# 0089. Cloudflare Workers + D1 Migration — Serverless, Free, Edge

**Date**: 2026-03-10
**Status**: Proposed

## Context

backlog-mcp currently runs as a local process with filesystem storage (markdown files under `~/.backlog`). This works well for single-machine use but has two limitations:

1. **Single-device**: The MCP server is only reachable from the machine running it.
2. **Process lifecycle**: The server must be running (`npx backlog-mcp`) for any MCP client to connect.

The monorepo restructure (ADR-0088) separated the codebase into `packages/shared`, `packages/server`, and `packages/viewer`. This creates a natural seam for deploying the server package independently of the local filesystem.

The goal is to support **both** deployment modes without forking the codebase:

- **Local mode**: filesystem storage, Orama search, local embeddings, JSONL operation log — unchanged for existing users.
- **Cloud mode**: D1 storage, D1 FTS5 search, Workers AI embeddings, D1 operation log — always-on, any device.

Three subsystems beyond raw task storage are affected: the **Orama search index**, the **local embeddings service**, and the **operation log**. Each needs a cloud equivalent. The only code change required for local mode is formalizing existing implicit abstractions.

---

## Decision

### 1. Storage Abstraction Layer

Introduce a `StorageAdapter` interface that both the existing filesystem implementation and the new D1 implementation satisfy. `BacklogService` and `TaskStorage` bind to this interface only.

```typescript
// packages/server/src/storage/storage-adapter.ts
export interface StorageAdapter {
  get(id: string): Promise<Entity | undefined>;
  getMarkdown(id: string): Promise<string | null>;
  list(filter?: ListFilter): Promise<Entity[]>;
  add(task: Entity): Promise<void>;
  save(task: Entity): Promise<void>;
  delete(id: string): Promise<boolean>;
  counts(): Promise<AggregateStats>;
  getMaxId(type?: EntityType): Promise<number>;
}

export interface ListFilter {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  limit?: number;
}
```

`TaskStorage` → `FilesystemStorageAdapter implements StorageAdapter` (behaviour unchanged).
New: `D1StorageAdapter implements StorageAdapter`.

### 2. Search Abstraction Layer

Similarly, introduce a `SearchAdapter` interface so the server is not hardwired to Orama:

```typescript
export interface SearchAdapter {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  index(tasks: Entity[]): Promise<void>;
  onWrite(task: Entity): Promise<void>;   // called after add/save
  onDelete(id: string): Promise<void>;    // called after delete
}
```

`OramaSearchService` already satisfies this shape. A new `D1SearchAdapter` implements it using FTS5 queries.

### 3. ORM: Drizzle over raw SQL

**Use Drizzle ORM** (`drizzle-orm/d1`) for the `D1StorageAdapter`.

| Factor | Raw SQL | Drizzle |
|---|---|---|
| Bundle size overhead | 0 | ~31 KB gzip (limit is 3 MB free / 10 MB paid) |
| Type safety | Manual | Schema-derived, full inference |
| D1 batch API | `env.DB.batch([...])` manually | `db.batch([...])` with typed tuple results |
| Migrations | Hand-written SQL files | `drizzle-kit generate` → `wrangler d1 migrations apply` |
| Local dev | `wrangler dev` | Same + Drizzle Studio |
| FTS5 / raw SQL escape hatch | Always | `db.run(sql.raw(...))` or raw `env.DB.prepare()` |

At ~10 SQL operations and <1000 rows there is no performance argument for raw SQL. Drizzle's 31 KB overhead is irrelevant against the Worker bundle limit. Prisma is **not** an option — it is in Preview for D1, heavier, and has known bundle-size issues on Workers.

### 4. D1 Schema

```sql
-- Main entity table
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,  -- TASK-0001, EPIC-0001, etc.
  type           TEXT NOT NULL,     -- task | epic | folder | artifact | milestone
  title          TEXT NOT NULL,
  status         TEXT DEFAULT 'open',
  epic_id        TEXT,
  parent_id      TEXT,
  blocked_reason TEXT,              -- JSON.stringify(string[])
  evidence       TEXT,              -- JSON.stringify(string[])
  references     TEXT,              -- JSON.stringify(Reference[])
  due_date       TEXT,
  content_type   TEXT,
  path           TEXT,
  body           TEXT,              -- markdown content (was file body)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_tasks_status     ON tasks(status);
CREATE INDEX idx_tasks_epic       ON tasks(epic_id);
CREATE INDEX idx_tasks_parent     ON tasks(parent_id);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);

-- FTS5 for full-text search — content table avoids data duplication
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  id   UNINDEXED,
  title,
  body,
  content='tasks',
  content_rowid='rowid'
);

-- Operation log (replaces .internal/operations.jsonl)
CREATE TABLE operations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  tool        TEXT    NOT NULL,
  actor       TEXT,
  resource_id TEXT,
  task_id     TEXT,        -- extracted field, indexed for fast filter
  params      TEXT,        -- JSON.stringify(Record<string, unknown>)
  result      TEXT         -- JSON.stringify(unknown)
);

CREATE INDEX idx_operations_task_id ON operations(task_id);
CREATE INDEX idx_operations_ts      ON operations(ts DESC);
```

### 5. FTS5 Sync (no triggers in D1)

D1 does **not** support `CREATE TRIGGER`. FTS5 must be kept in sync via application-level dual writes inside `db.batch()`:

```typescript
// Every add/save call in D1StorageAdapter
await db.batch([
  db.insert(tasks).values(row),
  db.run(sql`INSERT INTO tasks_fts(rowid, title, body) VALUES (${rowid}, ${title}, ${body})`),
]);

// Every delete call
await db.batch([
  db.delete(tasks).where(eq(tasks.id, id)),
  db.run(sql`INSERT INTO tasks_fts(tasks_fts, rowid) VALUES ('delete', ${rowid})`),
]);
```

Because `db.batch()` is atomic (rolls back on any failure), the FTS index and main table stay consistent.

### 6. Operation Log → D1 `operations` Table

The JSONL file at `.backlog/.internal/operations.jsonl` becomes an `operations` table in D1. The schema is above. Key patterns:

- **Writes are non-blocking**: use `ctx.waitUntil()` so the log insert does not add latency to the MCP tool response.
- **`task_id` is extracted at write time** as an indexed column (not via `json_extract()` on every read).
- **`params` and `result` are stored as `JSON.stringify()`** — D1 has no native JSON type; TEXT with manual serialization is the correct pattern.
- Existing query patterns map directly: filter by `task_id` (indexed), filter by `ts` range (indexed), `COUNT(*)` for badge counts, `ORDER BY id DESC LIMIT 50` for recent feed.

```typescript
// Non-blocking log write
ctx.waitUntil(
  env.DB.prepare(
    'INSERT INTO operations (ts,tool,actor,resource_id,task_id,params,result) VALUES (?,?,?,?,?,?,?)'
  ).bind(ts, tool, actor, resourceId, taskId, JSON.stringify(params), JSON.stringify(result)).run()
);
```

### 7. Search: Orama → D1 FTS5 (cloud), Orama (local)

**Local mode**: Orama stays as-is. No changes.

**Cloud mode**: Replace Orama with D1 FTS5. Do not attempt to run Orama inside a Worker.

Why not Orama-in-Worker:
- Orama's persistence plugin uses dpack (Node.js Transform streams) — the binary format is broken in Workers. The JSON format (`persist(db, "json")`) works but must be stored externally (KV, R2).
- Loading from KV on every cold start: ~20–80 ms CPU + I/O, plus module-level caching that Cloudflare explicitly warns cannot be relied on.
- Cache invalidation: every task write must also update the KV-stored index — an extra round-trip with eventual consistency.

D1 FTS5 eliminates all of this: it is always-on, always consistent with the main table (via batch writes), and requires no index loading.

**D1 FTS5 search query:**
```sql
SELECT t.*, fts.rank
FROM tasks t
JOIN tasks_fts fts ON t.rowid = fts.rowid
WHERE tasks_fts MATCH ?
ORDER BY fts.rank   -- BM25, built into FTS5
LIMIT ?;
```

### 8. Embeddings / RAG: local transformers.js → Workers AI (cloud)

**Local mode**: `@huggingface/transformers` + `Xenova/all-MiniLM-L6-v2` stays as-is.

**Cloud mode**: Use **Cloudflare Workers AI** + **Vectorize**.

Why local transformers.js cannot run in Workers:
- `@huggingface/transformers` unpacks to ~48 MB; Workers bundle limit is 3 MB (free) / 10 MB (paid).
- Model weights (~23 MB ONNX) cannot be bundled. Loading from R2 at runtime means 23 MB of weights on every cold start — impractical within the CPU time budget.

**Workers AI replacement**: `@cf/baai/bge-small-en-v1.5`
- **384 dimensions** — identical to the current MiniLM-L6-v2. Existing vector similarity scores are comparable; re-embedding existing tasks is straightforward.
- Zero bundle overhead — model is hosted by Cloudflare, called via binding.
- Free tier: ~10,000 neurons/day. Embedding 1,000 tasks bulk ≈ 50,000–100,000 neurons one-time; daily incremental (a few new tasks) stays well within free tier.

**Vectorize** stores and queries the 384-dim vectors alongside metadata:

```typescript
// At task write time
const { data: [vector] } = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
  text: [task.title + ' ' + task.body],
});
await env.VECTORIZE.upsert([{ id: task.id, values: vector }]);

// At search time — hybrid: FTS5 for keyword, Vectorize for semantic, fuse results
const { data: [queryVec] } = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [query] });
const { matches } = await env.VECTORIZE.query(queryVec, { topK: 20 });
```

The hybrid search fusion (BM25 + vector, currently Orama's linear combination) is replicated in application code using D1 FTS5 results and Vectorize results.

### 9. Worker Entry Point

```typescript
// packages/server/src/worker-entry.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const storage = new D1StorageAdapter(env.DB);
    const search  = new D1SearchAdapter(env.DB, env.AI, env.VECTORIZE);
    const opLog   = new D1OperationLog(env.DB, ctx);
    return createMcpFetchHandler(request, { storage, search, opLog });
  }
};

interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}
```

### 10. wrangler.jsonc

```jsonc
{
  "name": "backlog-mcp",
  "main": "packages/server/src/worker-entry.ts",
  "compatibility_date": "2025-01-01",
  "d1_databases": [{ "binding": "DB", "database_name": "backlog", "database_id": "<from wrangler d1 create>" }],
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "backlog-tasks" }]
}
```

### 11. Web Viewer (Cloudflare Pages)

| Setting | Value |
|---|---|
| Build command | `pnpm --filter viewer build` |
| Output directory | `packages/viewer/dist` |
| Env var | `VITE_MCP_URL=https://backlog-mcp.<account>.workers.dev` |

Pages auto-deploys on every push to `main`.

---

## Storage Backend Decision: D1 vs KV

**KV is disqualified.** Three hard blockers:

1. **No filtering or ordering**: `WHERE status = 'open'` requires hand-rolled index keys (`index:status:open → [...]`) updated atomically alongside the task — impossible in KV (no transactions). Each mutation becomes 3–6 writes with no atomicity; a mid-sequence crash corrupts the index.
2. **No full-text search**: Not possible in KV without an external service.
3. **Eventual consistency (up to 60 seconds)**: An AI agent that writes a task and immediately lists may not see its own write — a correctness failure for MCP tool chains.

KV's free write limit (1,000/day) is also 200× lower than D1's (100,000/day). With index maintenance writes, KV's budget is consumed at 3–6× the rate of actual mutations.

**D1 is correct** for structured, filterable, searchable application data. Every query pattern in backlog-mcp maps to a single SQL statement. Strong consistency from the primary. FTS5 native. Time Travel for safety.

---

## D1 Best Practices (applied here)

- **Use `db.batch()` for all multi-step writes** — it is the only atomic operation D1 exposes. FTS5 sync must live in the same batch as the main-table write.
- **Always append `LIMIT 1` when using `.first()`** — D1 does not inject it automatically; without it the full result set is fetched and only the first row returned.
- **Never pass `undefined` to `.bind()`** — causes `D1_TYPE_ERROR`. Validate and coerce all inputs before binding.
- **JSON columns are `TEXT`** — always `JSON.stringify()` before insert, `JSON.parse()` after read. D1/SQLite has no native JSON type.
- **Use indexed columns for frequent filter fields** — prefer `task_id TEXT` over `json_extract(params, '$.taskId')` on hot query paths.
- **Use `ctx.waitUntil()` for non-critical writes** — operation log inserts should not block the MCP response.
- **Use Drizzle migrations** (`drizzle-kit generate` + `wrangler d1 migrations apply`) — version-controlled, repeatable, applied identically locally and in production.
- **Inspect local D1 with any SQLite browser** — `.wrangler/state/v3/d1/` is a real SQLite file during `wrangler dev`.

## D1 Gotchas and Anti-Patterns

- **Triggers don't exist in D1** — any pattern relying on `CREATE TRIGGER` for FTS5 sync or audit logging will silently fail. All sync must be application-level in `db.batch()`.
- **`DB.exec(rawSql)` is for migrations only** — no parameter binding, SQL injection risk, worse performance. Never use it for runtime queries.
- **Booleans become integers** — `true` → `1`, `false` → `0` in SQLite. Cast back in application code when reading.
- **`json_extract()` in WHERE is unindexed** — use a stored generated column or a real column for fields you filter on frequently.
- **FTS5 virtual tables are excluded from `wrangler d1 export`** — always rebuild FTS index from main table after a restore; never rely on exported FTS state.
- **Prepared statements don't persist across Worker invocations** — Workers are stateless; `DB.prepare()` just stores a string client-side. Don't try to cache prepared statements in module scope as a performance trick.
- **Max 100 bound parameters per statement** — decompose bulk inserts into batches.
- **D1 does not support BigInt** — IDs and numbers must be within `Number.MAX_SAFE_INTEGER`. Task IDs are TEXT, so this is not an issue here.
- **Orama binary persistence format breaks in Workers** — `@orama/plugin-data-persistence` in `"binary"` mode uses Node.js Transform streams (dpack). The `"json"` format works but adds operational complexity. Avoid running Orama in cloud mode entirely; use D1 FTS5 instead.
- **`@huggingface/transformers` cannot run in Workers** — 48 MB package, 23 MB model weights; both exceed Worker bundle and startup budget. Use Workers AI binding instead.

---

## What Changes vs. What Doesn't

| Item | Local (current + future) | Cloud (new) | Effort |
|---|---|---|---|
| MCP transport | HTTP Streamable | HTTP Streamable | None |
| Storage interface | Formalized `StorageAdapter` | Same interface, D1 impl | Refactor |
| Task storage | Filesystem (markdown files) | D1 (Drizzle + SQL) | New adapter |
| Search interface | Formalized `SearchAdapter` | Same interface, FTS5 impl | Refactor |
| Full-text search | Orama BM25 (in-process) | D1 FTS5 BM25 | New adapter |
| Embeddings | `@huggingface/transformers` local | Workers AI bge-small-en-v1.5 | New service |
| Vector store | Orama in-process vectors | Cloudflare Vectorize | New binding |
| Operation log | JSONL file | D1 `operations` table | New adapter |
| Deployment | `npx backlog-mcp` | `wrangler deploy` | One-time |
| Web viewer | `localhost:3030` | Cloudflare Pages | Connect repo |
| Cost | Free (local) | $0/month | None |

---

## Implementation Order

1. **Formalize `StorageAdapter` and `SearchAdapter` interfaces** — extract from `TaskStorage` and `OramaSearchService`. No behaviour change for local mode.
2. **Write `D1StorageAdapter`** — Drizzle schema, all CRUD methods, FTS5 dual-writes via `db.batch()`. Test locally with `wrangler dev`.
3. **Write `D1SearchAdapter`** — FTS5 queries with BM25 ranking, Vectorize integration for hybrid mode.
4. **Write `D1OperationLog`** — mirrors `OperationStorage` against the `operations` table. Use `ctx.waitUntil()` for non-blocking writes.
5. **Add `worker-entry.ts`** — wires D1/AI/Vectorize bindings from `env` into the adapters.
6. **Add `wrangler.jsonc`** — D1, AI, Vectorize bindings. Run `wrangler d1 create backlog` + `wrangler d1 migrations apply --remote`.
7. **Deploy Worker** — `wrangler deploy`. Verify `/mcp` with MCP Inspector.
8. **Deploy viewer to Pages** — connect repo, set build command and `VITE_MCP_URL`.
9. **Migrate existing data (optional)** — script reads `~/.backlog` markdown + JSONL, inserts into D1. One-time.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cold start latency | Workers cold starts ~5ms — no container delay. D1 queries add ~20ms wall-clock. |
| D1 cross-region latency | Create D1 in region nearest to primary user. Read replication (beta) eliminates read hops. |
| CPU limit (10ms free) | CPU limit is CPU-only; I/O (D1, KV) does not count. MCP ops well under 2ms CPU each. |
| FTS5 / main table divergence | All writes use `db.batch()` — atomic by definition. No partial sync possible. |
| AI agent bulk mutation | D1 Time Travel: 7-day PITR on Free plan. Full restore from any point. |
| Vectorize cold index | Re-embed all tasks once at setup via a migration script. Incremental updates on every write. |
| Workers AI free tier | 10K neurons/day. Daily incremental use (a few tasks) is ~1% of budget. |
| SSE / long-lived connections | Workers support SSE. Streamable HTTP confirmed by Cloudflare's own MCP docs. |

---

---

## Implementation Notes (Phase 1 — completed 2026-03-10)

Phase 1 implements the storage abstraction layer and D1 adapter. No existing behaviour was changed; all new files are additive.

### Files created

| File | Purpose |
|---|---|
| `packages/server/src/storage/storage-adapter.ts` | `StorageAdapter` (sync) and `AsyncStorageAdapter` (Promise-based) interfaces + `ListFilter` |
| `packages/server/src/storage/filesystem-adapter.ts` | `FilesystemStorageAdapter implements StorageAdapter` — thin delegate over existing `TaskStorage` |
| `packages/server/src/storage/d1-adapter.ts` | `D1StorageAdapter implements AsyncStorageAdapter` — full D1 implementation with FTS5 sync |
| `packages/server/src/operations/d1-operation-log.ts` | `D1OperationLog` — mirrors `OperationStorage` against D1 `operations` table |
| `packages/server/src/worker-entry.ts` | Cloudflare Worker fetch handler (health-check placeholder; MCP wiring deferred) |
| `packages/server/migrations/0001_initial.sql` | Full D1 schema: tasks + tasks_fts + operations + all indexes |
| `packages/server/wrangler.jsonc` | Wrangler config for the server package |

### Interface split: sync vs async

`TaskStorage` is synchronous (Node.js `fs` API). `BacklogService` depends on sync access (`listSync`, `counts`). Making the interface async would require `await`-ing every call throughout the existing codebase — a large, risky refactor.

**Decision**: two interfaces side-by-side.
- `StorageAdapter` — sync, implemented by `FilesystemStorageAdapter`. Used by all existing local-mode code unchanged.
- `AsyncStorageAdapter` — Promise-based, implemented by `D1StorageAdapter`. Used only by the Worker entry point and future D1-aware service layer.

This avoids touching any existing code while providing a clean async interface for cloud mode.

### D1 type declarations (no extra package)

`@cloudflare/workers-types` is not installed in the server package (it's a Node.js project). Rather than install it or use `any`, a minimal structural interface is declared locally in `d1-adapter.ts`:

```typescript
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
```

This is exactly the surface used by `D1StorageAdapter`. TypeScript resolves generics correctly. When `wrangler deploy` runs, the actual Cloudflare runtime object satisfies this interface structurally. No friction, no package bloat.

### `getMaxId` without regex

SQL has no `REGEXP` operator in standard SQLite (it's an optional extension, disabled in D1). The D1 `getMaxId` implementation uses `id LIKE 'PREFIX-%'` to narrow the result set, then parses the numeric suffix in TypeScript — the same approach the filesystem implementation uses on filenames.

### FTS5 sync via `db.batch()`

Every mutating operation on the `tasks` table performs FTS5 sync in the same atomic batch:

- **`add`**: `INSERT INTO tasks` + `INSERT INTO tasks_fts ... SELECT FROM tasks WHERE id=?`
- **`save`**: `UPDATE tasks` + FTS5 delete-by-rowid + FTS5 re-insert
- **`delete`**: FTS5 delete-by-rowid first (needs the row to exist), then `DELETE FROM tasks`

The delete order matters — FTS5 delete reads the current row to get the content before the main table row is removed. Both statements must be in the same batch.

### Operation log writes are non-blocking

`D1OperationLog.append()` is synchronous by interface (to match `OperationStorage`). Internally it calls `ctx.waitUntil(db.prepare(...).run())` — the D1 write happens after the HTTP response is sent. The MCP tool response latency is unaffected.

### Worker entry point is a placeholder

`worker-entry.ts` instantiates `D1StorageAdapter` and `D1OperationLog` but returns a health-check JSON response. Full MCP endpoint wiring requires either:
- Porting the Fastify server to the Workers runtime (Fastify has no official Workers adapter), or
- Replacing Fastify with a lightweight Workers-native router (Hono, itty-router) for cloud mode only.

This is Phase 2 work. The adapter layer is complete and tested; the HTTP wiring is the remaining gap.

---

## Implementation Notes (Phase 2 — completed 2026-03-10)

Phase 2 wires the full MCP endpoint in the Worker and deploys it.

**Live endpoint**: `https://backlog-mcp.gogakoreli.workers.dev/mcp`
**D1 database ID**: `a6364201-aa49-42c0-b905-324451bdab43`

### Files created / modified

| File | Action |
|---|---|
| `packages/server/src/storage/d1-backlog-service.ts` | Created — per-request D1-backed service (mirrors `BacklogService` shape, no singleton) |
| `packages/server/src/tools/worker-tools.ts` | Created — all 6 MCP tools wired to `D1BacklogService`; zero Node.js imports |
| `packages/server/src/worker-entry.ts` | Updated — full MCP endpoint via `WebStandardStreamableHTTPServerTransport` |
| `packages/server/wrangler.jsonc` | Updated — real `database_id` filled in |
| `packages/server/migrations/0001_initial.sql` | Fixed — `"references"` quoted (SQLite reserved word) |

### No Fastify needed — `WebStandardStreamableHTTPServerTransport`

The MCP SDK ships `WebStandardStreamableHTTPServerTransport` (`@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`) which takes a Web `Request` and returns a Web `Response`. It runs on any Fetch API runtime: Node.js 18+, Cloudflare Workers, Deno, Bun. No Fastify, no Hono, no router needed — the transport handles routing itself.

```typescript
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless mode — correct for Workers
  enableJsonResponse: true,
});
await server.connect(transport);
return transport.handleRequest(request);
```

### Tool injection via `D1BacklogService`

Rather than modifying every existing tool file (which all import a filesystem singleton), worker-specific registrations live in `worker-tools.ts`. The function accepts a `D1BacklogService` instance and registers the same 6 tools (`backlog_list`, `backlog_get`, `backlog_create`, `backlog_update`, `backlog_delete`, `backlog_search`) with identical Zod schemas and output shapes.

The existing tool files are untouched. Both modes register the same tool names — the injection point is the `registerWorkerTools(server, service)` call in the Worker entry point vs `registerTools(server)` in the Node.js path.

### Gotchas discovered in Phase 2

**`references` is a SQLite reserved keyword.**
`CREATE TABLE ... references TEXT` fails with `SQLITE_ERROR: near "references": syntax error`. Fix: quote as `"references"` in DDL. References to the column in `INSERT`/`SELECT`/`UPDATE` statements work without quoting (SQLite only errors on unquoted reserved words in DDL position). The migration file is fixed; the adapter SQL is unaffected.

**`WebStandardStreamableHTTPServerTransport` requires `Accept: application/json, text/event-stream`.**
Requests without this header receive a `-32000 Not Acceptable` JSON-RPC error. This is correct per the MCP spec — real clients (Claude Desktop, Claude.ai, MCP Inspector) send the header. Plain `curl` without the header will fail; add `-H "Accept: application/json, text/event-stream"` when testing manually.

**`source_path` omitted from cloud `backlog_create`.**
The filesystem implementation of `backlog_create` accepts a `source_path` param that calls `resolveSourcePath()`, which uses `node:fs` and `node:os`. These are unavailable in the Worker. The cloud tool omits `source_path` entirely — tasks are created without a filesystem source reference.

**`counts()` sync vs async.**
`BacklogService.counts()` is synchronous (iterates files). `D1BacklogService.counts()` is `async`. The worker tool must `await service.counts()` where the original called it inline. A subtle difference to watch when writing future cloud tools.

**No Orama, no embeddings in Worker.**
`worker-tools.ts` and `worker-entry.ts` import nothing from `@orama/orama`, `@huggingface/transformers`, `fastify`, `gray-matter`, or any `node:*` module. `backlog_search` in cloud mode uses `D1StorageAdapter.search()` (FTS5 `MATCH`) instead of Orama's hybrid BM25+vector pipeline. Vector search via Vectorize is Phase 3.

---

## Consequences

**Positive**
- Always-on: no local process; any device connects via HTTPS.
- Multi-device: any MCP client (Claude Desktop, Claude.ai, etc.) works from any machine.
- Zero infra to manage.
- Free: well within all Cloudflare free tier limits for personal use.
- Durable: D1 is replicated; Time Travel for recovery; Vectorize for semantic search at no ongoing cost.
- Both modes coexist: local filesystem for existing users, D1 for cloud — same codebase, different adapters injected at startup.

**Negative / Accepted trade-offs**
- Cloudflare lock-in for cloud deployment: D1, Workers AI, Vectorize are Cloudflare-specific. The `StorageAdapter`/`SearchAdapter` interfaces isolate this to the adapters only.
- FTS5 sync is application-level: no triggers means dual-writes in every mutation. Mitigated by `db.batch()` atomicity — not operationally complex, just explicit.
- `wrangler d1 export` excludes FTS5 virtual tables: restore process must rebuild FTS from main table. Documented in runbook.
- Workers AI embedding adds a network call per task write in cloud mode: latency is within Workers I/O budget and does not count against CPU time.
