---
title: "Runtime-Clean Worker Bundle — Capability Injection Pattern"
date: 2026-03-26
status: Accepted
---

# 0091. Runtime-Clean Worker Bundle — Capability Injection Pattern

## Problem Statement

`wrangler.jsonc` carries a `nodejs_compat` compatibility flag. This flag should not be needed: the server uses Hono (runtime-agnostic) and the service layer is fully abstracted behind `IBacklogService`. Yet the Worker bundle fails to build without it.

The root cause is two unconditional `node:` imports that sit in the **static import graph** reachable from `worker-entry.ts`:

| File | Import | Used for |
|------|--------|----------|
| `server/hono-app.ts:3` | `import { existsSync, readFileSync } from 'node:fs'` | `/resource` route — serves local filesystem files |
| `tools/backlog-create.ts:1-3` | `node:fs`, `node:path`, `node:os` | `resolveSourcePath()` — reads a local file as task description |

Both are guarded at **runtime** (`if (deps?.resourceManager)`, `if (source_path)`), so they never execute in a Worker. But the bundler performs static analysis: it sees the `import` declarations and includes `node:fs` etc. regardless of whether the code is reachable at runtime. `nodejs_compat` is the polyfill that papers over this.

This is a gap in the existing capability injection architecture, not a fundamental incompatibility with Workers.

---

## Existing Architecture (Context)

`hono-app.ts` already uses a clean capability injection pattern for every other Node.js-only feature:

```
node-server.ts injects:          worker-entry.ts injects:
  staticMiddleware ─────────────── (absent — route not registered)
  resourceManager  ─────────────── (absent — route not registered)
  operationLogger  ─────────────── (absent — D1 db used instead)
  eventBus         ─────────────── (absent — heartbeat-only SSE)
  wrapMcpServer    ─────────────── (absent — no op logging)
```

`hono-app.ts` has zero Node.js imports for all of these. The two leaking imports are simply the two cases that were missed when this pattern was established.

---

## Decision

Extend the existing capability injection pattern to cover the two remaining Node.js-only capabilities:

### 1. `resolveSourcePath` — injected into `ToolDeps`

```typescript
// tools/index.ts
export interface ToolDeps {
  resourceManager?: any;
  operationLogger?: any;
  resolveSourcePath?: (path: string) => string;   // NEW
}
```

- Implementation lives in `src/utils/resolve-source-path.ts` (Node.js-only module with `node:fs`/`node:path`/`node:os`).
- `node-server.ts` imports and injects it.
- `worker-entry.ts` does not inject it — the tool returns a descriptive error if `source_path` is used in cloud mode.
- `backlog-create.ts` removes all `node:` imports. It receives `resolveSourcePath` as `deps?.resolveSourcePath`.

### 2. `readLocalFile` — injected into `AppDeps`

```typescript
// server/hono-app.ts
export interface AppDeps extends ToolDeps {
  // ...existing fields...
  readLocalFile?: (filePath: string) => string | null;  // NEW — Node.js only
}
```

- `node-server.ts` injects a closure over `existsSync`/`readFileSync`.
- `hono-app.ts` removes `import { existsSync, readFileSync } from 'node:fs'` entirely.
- The `/resource` route (already gated on `deps?.resourceManager`) calls `deps.readLocalFile(filePath)` — returns `null` for not-found, replaces the `existsSync` + `readFileSync` pair.

### 3. `wrangler.jsonc` — remove `nodejs_compat`

```jsonc
// Before
"compatibility_flags": ["nodejs_compat"]

// After
// (field removed — no Node.js polyfills needed)
```

---

## Design Principles

### Node.js capabilities are injected, not imported

The invariant: **any file reachable from `worker-entry.ts` must contain zero `node:` imports at the module level.** Node.js-only behaviour is always a capability slot in `AppDeps` or `ToolDeps`, implemented in Node.js entry point files and absent in the Worker entry point.

This is the same principle already applied to `resourceManager`, `operationLogger`, `eventBus`, and `staticMiddleware`. ADR-0091 closes the last two gaps.

### Graceful degradation over silent omission

When a Node.js-only capability is absent in cloud mode, the tool or route returns a clear, honest error rather than silently skipping or hiding the feature. `backlog_create` with `source_path` in cloud mode returns: `"source_path is not supported in cloud mode"`.

### The Hono app is runtime-agnostic by construction

`hono-app.ts` must compile and run on any Hono-supported runtime (Node.js, Cloudflare Workers, Bun, Deno). The only imports allowed at module level are: `hono`, `hono/cors`, `gray-matter`, `@modelcontextprotocol/sdk`, and internal modules that themselves satisfy this constraint.

---

## Consequences

- `nodejs_compat` removed from `wrangler.jsonc` — the Worker bundle is clean without polyfills.
- `resolve-source-path.ts` becomes the single Node.js-only utility, easy to audit.
- `source-path.test.ts` imports `resolveSourcePath` from `utils/resolve-source-path.js` directly.
- No behaviour change in either local or cloud mode.

---

## Future Work — `source_path` in Cloud Mode

### The problem

`source_path` is intentionally local-only: the whole point is that large files (specs, docs, meeting notes) get saved as artifacts **without the agent reading them into context**. The server reads the file directly, bypassing the LLM entirely.

In cloud/remote mode this breaks down — the file is on the user's machine, the server is in Cloudflare. The server cannot reach back to the client's filesystem.

Passing the file content as a tool argument is not an option: it defeats the purpose by materialising the content in the agent's context window.

### Why this is not an MCP protocol problem

The MCP protocol does not need to change. The upload just happens **outside** the MCP tool call, on a separate HTTP channel:

```
1. backlog-mcp upload /docs/spec.md --server https://backlog.workers.dev
   → file bytes go directly local disk → remote server via HTTP POST
   → server stores content, returns: { upload_id: "abc123" }

2. Agent: backlog_create({ title: "Spec", upload_id: "abc123" })
   → server fetches content by id, saves to D1
   → agent never sees file content — context untouched
```

The separation of concerns is intentional: **uploading a file is a user/operator action**, not an agent action — the same way `git add` is separate from `git commit`.

### Local companion pattern

For teams running the MCP server remotely, a **local companion** bridges the gap:

```
Local machine                      Cloudflare Worker
┌──────────────────────┐          ┌─────────────────────┐
│ backlog-mcp (CLI)    │          │ backlog-mcp (server) │
│                      │─upload──▶│ POST /upload         │
│ $ backlog-mcp upload │  bytes   │ → R2 / D1 blob       │
│   /docs/spec.md      │          │ ← upload_id          │
└──────────────────────┘          └─────────────────────┘
         ↓ prints upload_id
         ↓ user tells agent: "create task from upload abc123"
┌──────────────────────┐          ┌─────────────────────┐
│ Agent (LLM)          │──MCP────▶│ backlog_create       │
│ backlog_create(      │  (tiny)  │ (upload_id: abc123)  │
│   upload_id: abc123) │          │ → fetch + save to D1 │
└──────────────────────┘          └─────────────────────┘
```

The companion is just the existing `backlog-mcp` CLI (ADR-0090 Phase 2) with an `upload` subcommand. No new process, no daemon, no sidecar.

### What needs to be built

| Component | Work |
|-----------|------|
| `POST /upload` on Hono server | Store content in D1 or R2, return `upload_id`, TTL-expire unused uploads |
| `backlog_create` accepts `upload_id` | Fetch content from temp storage, save to D1, delete temp entry |
| `backlog-mcp upload <file>` CLI command | HTTP POST to configured server, print `upload_id` |
| Auth | `/upload` must require the same API key as `/mcp` |
