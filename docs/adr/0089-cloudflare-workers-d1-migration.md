# 0089. Cloudflare Workers + D1 Migration — Serverless, Free, Edge

**Date**: 2026-03-10
**Status**: Accepted — Phases 1–4 complete (Hono migration done)

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

The viewer is a Vanilla-TS SPA built with esbuild (not Vite). It calls a set of REST endpoints on the server — **not** the MCP protocol endpoint. For cloud deployment, the Worker must expose these REST routes.

#### REST endpoints the viewer calls

| Path | Used by |
|---|---|
| `GET /tasks?filter=&q=&limit=` | Task list + search |
| `GET /tasks/:id` | Task detail (returns task + `raw` markdown + `children[]` + `parentTitle`) |
| `GET /operations?limit=&task=` | Activity panel |
| `GET /operations/count/:taskId` | Badge count |
| `GET /events` | SSE stream for real-time updates |
| `GET /api/status` | System info modal |
| `GET /search?q=` | Unified search (spotlight) |

#### API URL — build-time injection

The viewer uses esbuild's `define` feature to inject the API base URL at build time. The viewer checks a build-time constant before falling back to localhost:

```typescript
// utils/api.ts
declare const __API_URL__: string;
export const API_URL =
  (typeof __API_URL__ !== 'undefined' && __API_URL__)
    ? __API_URL__
    : `http://localhost:${window.location.port || 3030}`;
```

```js
// build.mjs — define block added
define: {
  '__API_URL__': JSON.stringify(process.env.API_URL || ''),
}
```

For **local mode** (`npm run dev`): no env var → falls back to `http://localhost:<port>` (unchanged behaviour).
For **Pages build**: set `API_URL=https://backlog-mcp.gogakoreli.workers.dev` → inlined at compile time.

#### CORS

Since the Pages domain (`backlog-mcp.pages.dev`) and Worker domain (`backlog-mcp.workers.dev`) differ, all Worker REST responses must include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept
```
Handle `OPTIONS` preflight with 204.

#### SSE in Workers (heartbeat only — no push)

Cloudflare Workers are stateless. There is no in-process event bus. The `/events` endpoint returns a `ReadableStream` SSE response that emits a heartbeat every 30 seconds but no change events. The viewer's `BacklogEvents` client connects successfully; it just never receives `task_changed`/`task_created` events.

This means the cloud viewer is **pull-only** in Phase 3 — it does not auto-refresh when an agent mutates a task. Durable Objects would enable real-time push (Phase 4).

#### Cloudflare Pages setup

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @backlog-mcp/viewer build` |
| Output directory | `packages/viewer/dist` |
| Root directory | `/` (monorepo root) |
| Env var | `API_URL=https://backlog-mcp.gogakoreli.workers.dev` |

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

---

## Implementation Notes (Phase 3 — completed 2026-03-10)

Phase 3 connects the web viewer to the deployed Worker. Two work streams: **Worker REST API** and **viewer API URL injection**.

### Worker REST API (`worker-api-routes.ts`)

A new file `packages/server/src/worker-api-routes.ts` handles all viewer REST routes:

```
GET /tasks?filter=(active|completed|all)&q=&limit=       → D1BacklogService.list() / search()
GET /tasks/:id                                            → get + children query + parentTitle
GET /operations?limit=&task=                             → SELECT FROM operations
GET /operations/count/:taskId                            → COUNT(*) WHERE task_id = ?
GET /events                                              → ReadableStream SSE, heartbeat only
GET /api/status                                          → {version, taskCount, mode: 'cloudflare-worker'}
GET /search?q=&types=&limit=                             → D1BacklogService.searchUnified()
OPTIONS *                                                → CORS preflight 204
```

All responses include CORS headers (`Access-Control-Allow-Origin: *`).

`worker-entry.ts` is updated to dispatch to `handleApiRequest()` for paths other than `/mcp` and `/health`.

### Viewer API URL

`packages/viewer/utils/api.ts` replaces the hardcoded `http://localhost:PORT` with a build-time constant `__API_URL__` that falls back to localhost. `build.mjs` adds the `define` block, reading `process.env.API_URL`.

### Files created / modified

| File | Action |
|---|---|
| `packages/server/src/worker-api-routes.ts` | Created — REST API handler for viewer: `/tasks`, `/tasks/:id`, `/operations`, `/operations/count/:taskId`, `/events`, `/api/status`, `/search` |
| `packages/server/src/worker-entry.ts` | Updated — dispatches to `handleApiRequest()` before MCP block |
| `packages/viewer/utils/api.ts` | Updated — `API_URL` uses build-time `__API_URL__` constant with localhost fallback |
| `packages/viewer/build.mjs` | Updated — `define: { '__API_URL__': JSON.stringify(process.env.API_URL || '') }` |
| `wrangler.jsonc` (root) | Deleted — was a placeholder with wrong DB ID, caused Pages warnings; deploy via `packages/server/` |

**Live viewer**: `https://backlog-mcp-viewer.pages.dev`

### Key decisions / gotchas for Phase 3

- **`/tasks/:id` children**: done with a second `D1BacklogService.list({ parent_id: id })` call — no join needed.
- **`/operations` enrichment**: for each op with a `task_id`, fetch the task title and epic title from D1 via `service.get()` calls. Use a `Map` cache within the request to avoid duplicate lookups.
- **SSE**: `ReadableStream` with 30s `setInterval` heartbeat. Workers support long-lived streaming responses; the heartbeat interval is I/O (not CPU), so it doesn't count against the 10ms CPU budget.
- **No static file serving in Worker**: the Worker is pure API. Pages serves the built HTML/JS/CSS.
- **CORS preflight**: `OPTIONS *` → 204 + CORS headers. Every JSON response also carries `Access-Control-Allow-Origin: *` to avoid preflight for cross-origin GETs.
- **`/search` returns `SearchResult[]`**: uses `service.searchUnified()` (returns `{ item, score, type }[]`) — not `service.list()` which returns `Entity[]`. The viewer's spotlight uses this format.
- **Build-time URL injection**: `API_URL=https://backlog-mcp.gogakoreli.workers.dev node build.mjs` bakes the URL into the bundle. No runtime env vars in the browser. Local mode with no `API_URL` set defaults to `http://localhost:3030`.
- **Pages project created via**: `wrangler pages project create backlog-mcp-viewer --production-branch main`
- **Pages deploy command**: `API_URL=https://backlog-mcp.gogakoreli.workers.dev npx wrangler pages deploy packages/viewer/dist --project-name backlog-mcp-viewer --commit-dirty=true`

---

---

## Phase 4 — Hono Migration (replaces Fastify)

### Problem with Phases 1–3

Phases 1–3 retrofitted cloud deployment onto an existing Fastify server. Fastify uses Node.js `http.IncomingMessage`/`ServerResponse` primitives which don't exist in the Workers runtime. The result was a parallel set of Worker-specific files:

- `worker-tools.ts` — 340-line duplicate of all 6 MCP tools, only to swap the service instance
- `worker-api-routes.ts` — duplicate of all viewer REST routes for Workers
- `worker-handlers.ts` — band-aid shared layer on top of the above duplicates

Cloudflare infrastructure had leaked into the application logic. A change to list filtering or search behavior required updates in two places.

### Root cause: singleton import

Every local tool file imports the filesystem service directly:
```typescript
import { storage } from '../storage/backlog-service.js'; // hardwired to filesystem
```
Because this module-level singleton exists, the tools are coupled to one concrete storage implementation. Swapping it for cloud mode required copying the entire tool file — hence `worker-tools.ts`.

### Decision: replace Fastify with Hono

**Hono** is a Fastify-equivalent web framework built on Web standard `Request`/`Response`. It runs identically on Node.js (`@hono/node-server`), Cloudflare Workers, Bun, and Deno. The same `app.get('/tasks', ...)` code works everywhere.

This enables the target architecture:

```
src/
  app.ts                ← single Hono app (all routes, service-injected)
  node-server.ts        ← Node.js entry: serve(app, port) + signals
  worker-entry.ts       ← Worker entry: export default { fetch: app.fetch }
  tools/index.ts        ← registerTools(server, service) — no singleton
```

**Deleted entirely**: `worker-tools.ts`, `worker-api-routes.ts`, `worker-handlers.ts`, `server/fastify-server.ts`, `server/viewer-routes.ts`, `server/mcp-handler.ts`, `middleware/auth.ts`

### Why not Fastify on a non-Workers host?

Fastify could run on Railway/Fly.io/Render with filesystem storage — no Workers needed. But:
- Free-tier Node.js hosts have cold starts or sleep on inactivity (Render spins down after 15 min)
- D1 is only accessible via Workers bindings — using a non-Workers host means abandoning D1 (and needing Turso or Neon instead)
- Hono achieves always-on Workers + D1 without any duplication — same benefit, no cost

### MCP transport unification

Phases 1–2 used two different transports:
- Local: `StreamableHTTPServerTransport` — Node.js `IncomingMessage`/`ServerResponse`
- Cloud: `WebStandardStreamableHTTPServerTransport` — Web `Request`/`Response`

With Hono, both modes use `WebStandardStreamableHTTPServerTransport` (Hono exposes `c.req.raw` as a Web `Request` on all platforms). One transport, two entry points.

### Service injection pattern

`registerTools(server: McpServer, service: IBacklogService)` accepts any implementation of a shared async interface. No singleton import in tool files.

```typescript
// Node.js entry
registerTools(server, BacklogService.getInstance())

// Worker entry
registerTools(server, new D1BacklogService(env.DB))
```

`BacklogService` wraps its sync methods (`counts`, `get`, `getMarkdown`) in `Promise.resolve()` to satisfy the async interface without behaviour change.

### Node.js vs cloud feature matrix

| Feature | Local (Node.js) | Cloud (Workers + Pages) |
|---|---|---|
| `GET /resource`, `GET /mcp/resource` | Reads local filesystem files | Not available — no filesystem |
| `GET /events` SSE | Live push via `eventBus` | Heartbeat-only `ReadableStream` (no Durable Objects) |
| Static file serving | `serveStatic` from `@hono/node-server` | Served by Cloudflare Pages |
| `backlog_context` MCP tool | Full — resourceManager + operationLogger | Full — service-injected, adapters differ |
| All other MCP tools | Full | Full — same `registerTools()` call, different `IBacklogService` adapter |

**Notes:**
- Resources (`/resource`, `/mcp/resource`) are needed by the viewer UI to display ADRs and design docs linked to tasks. These are filesystem-local concepts — cloud tasks reference external URLs or D1-stored content instead.
- SSE is critical for the viewer UI auto-refresh (no manual reload when an agent mutates tasks). In Workers, real-time push requires Durable Objects (future work). Local mode delivers full SSE push.
- `backlog_context` uses `service.getSync?.(id)` (optional sync lookup) for its synchronous hydration path. In cloud mode, the optional is absent and the async path runs. All functionality is preserved via the `IBacklogService` abstraction.
- `GET /open/:id` (open file in OS editor) was removed — confirmed dead code, not used by any client.

The app factory accepts an optional `deps` object: `createApp(service, { eventBus?, resourceManager?, operationLogger?, staticMiddleware?, wrapMcpServer? })`. Routes that require deps are only registered when deps are provided.

### Distilled insights

- **Hono should have been the starting point** — any project targeting Workers + Node.js should default to Hono over Fastify. Fastify is the wrong choice when multi-runtime deployment is a requirement.
- **Service injection beats module singletons** — `import { storage } from '...'` in tools files is an anti-pattern for testability and multi-runtime support. Always inject via function parameter.
- **One MCP transport** — `WebStandardStreamableHTTPServerTransport` works in Node.js 18+, Workers, Bun, Deno. Use it everywhere. `StreamableHTTPServerTransport` is Node.js-only and should be considered legacy.
- **Cloudflare = entry point only** — the only Cloudflare-specific code is `worker-entry.ts` (~10 lines) and the D1/storage adapters. All application logic is runtime-agnostic.

---

## Phase 5 — OAuth 2.0 (Client Credentials)

### Problem

Claude.ai's web connector UI only accepts OAuth credentials (Client ID + Client Secret). A raw Bearer token (API key) cannot be configured there. The pre-Phase-5 server only supported `Authorization: Bearer <API_KEY>`, blocking Claude.ai web integration.

### Why not reuse API_KEY as the access token?

The naive shortcut — validate `client_secret`, then return `client_secret` as the access token — is an anti-pattern:
- **No token lifetime**: the secret never expires without a full rotation
- **No separation of concerns**: interception of an access token exposes the long-lived credential
- **Not OAuth**: tools that inspect the token (e.g. introspection, audit logs) get the raw secret

Proper OAuth issues a **short-lived signed token** (JWT) that is distinct from the credential used to obtain it.

### Decision: OAuth 2.0 Authorization Code + PKCE with HS256 JWT

Claude.ai web uses **Authorization Code + PKCE** (not Client Credentials). When a user adds a custom connector, Claude.ai redirects to `/authorize` on the MCP server. The user logs in there, and Claude.ai exchanges the resulting code for an access token.

**Authorization Code + PKCE flow (Claude.ai web):**
```
Claude.ai → GET /authorize?response_type=code&code_challenge=<S256>&...
           Server shows HTML form — user enters API key to approve
           User submits → Server validates key, issues signed auth code JWT (5min TTL)
          ← 302 redirect to claude.ai/api/mcp/auth_callback?code=<auth_code>
Claude.ai → POST /oauth/token { grant_type=authorization_code, code, code_verifier, redirect_uri }
           Server: verifyJWT(auth_code) + SHA256(code_verifier) == code_challenge (PKCE)
          ← { access_token: <JWT>, expires_in: 3600 }
Claude.ai → POST /mcp { Authorization: Bearer <JWT> }  ← MCP requests
```

**Client Credentials flow (kept for Claude Desktop / programmatic access):**
```
Client → POST /oauth/token { grant_type=client_credentials, client_secret }
        ← { access_token: <JWT>, expires_in: 3600 }
```

**Discovery** — `/.well-known/oauth-authorization-server` (RFC 8414) advertises both endpoints. Claude.ai auto-discovers the authorization endpoint from this.

### Stateless auth codes — no KV needed

The auth code is a short-lived JWT (5min) signed with `JWT_SECRET`, containing `code_challenge` and `redirect_uri`. Token exchange verifies:
1. JWT signature + expiry
2. `redirect_uri` matches what was used during authorization
3. PKCE: `SHA256(code_verifier)` base64url == `code_challenge`

No server-side state storage required. Works in stateless Workers without KV.

### Secrets — three separate concerns

| Secret | Purpose | Who sees it |
|---|---|---|
| `API_KEY` | Direct Bearer auth (Claude Desktop) + authorization form password | Operator only |
| `CLIENT_SECRET` | Client credentials grant (programmatic) | OAuth client only |
| `JWT_SECRET` | Signs auth codes + access tokens — never exposed | Never leaves server |

Rotating `JWT_SECRET` invalidates all outstanding tokens. Rotating `API_KEY` requires re-authorization via the form. These operations are independent.

### Auth middleware — dual-path

```
Authorization: Bearer <token>
  → verifyJWT(token, JWT_SECRET)  — OAuth path (Claude.ai, client credentials)
  → token === API_KEY             — direct Bearer path (Claude Desktop)
  → 401 if neither passes
```

If neither `API_KEY` nor `JWT_SECRET` is configured, auth is disabled (local dev mode).

### JWT implementation — Web Crypto API

`crypto.subtle` (HMAC-SHA256 + SHA-256 for PKCE) is available natively in Node.js 18+, Cloudflare Workers, Bun, and Deno. No JWT library needed.

### Claude.ai connector setup

- **URL**: `https://backlog-mcp.gogakoreli.workers.dev/mcp`
- Claude.ai auto-discovers `/authorize` via `/.well-known/oauth-authorization-server`
- User enters `API_KEY` in the authorization form to approve

### Distilled insights

- **Claude.ai uses Authorization Code + PKCE, not Client Credentials** — the web connector UI redirects to `/authorize` on the MCP server, not `/oauth/token` directly. Client Credentials is for programmatic/machine access only.
- **Stateless auth codes via signed JWTs** — embedding `code_challenge` + `redirect_uri` in the auth code JWT eliminates KV dependency while preserving full PKCE security.
- **Access token ≠ client secret** — returning the client secret as the access token removes all security properties OAuth provides.
- **Web Crypto API is sufficient** — `crypto.subtle` covers HMAC-SHA256 (JWT signing) and SHA-256 (PKCE), no library needed, portable across all runtimes.
- **Two secrets, three jobs** — `API_KEY` doubles as the authorization form password and direct Bearer credential. `JWT_SECRET` is server-internal only.
- **Dual-path auth is additive** — Claude Desktop (direct Bearer) and Claude.ai web (OAuth JWT) coexist; neither breaks the other.

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
