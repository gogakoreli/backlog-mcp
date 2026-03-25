---
title: "CLI Tool and Core Function Extraction"
date: 2026-03-26
status: Accepted
---

# 0090. CLI Tool and Core Function Extraction

## Problem Statement

All business logic lives inside MCP tool registration callbacks (`src/tools/*.ts`). These functions are tightly coupled to the MCP SDK — they take `McpServer`, define zod schemas inline, and return MCP-formatted `{ content: [{ type: 'text', text: ... }] }` responses.

Consequences of this coupling:
- No CLI access — users without MCP clients can't interact with their backlog
- No reuse — HTTP routes in `hono-app.ts` duplicate logic instead of calling shared functions
- Testing requires MCP server mocking — can't unit test business logic in isolation
- Adding any new transport (WebSocket, REST, CLI) means duplicating all business logic

## Problem Space

- **Who's affected**: Users who want CLI access (scripting, debugging, quick edits), developers testing operations, HTTP route handlers that duplicate logic
- **Root cause**: Transport-coupled business logic — "what to do" is entangled with "how to receive the request"
- **Constraint**: Must not break existing MCP behavior — tools must continue to work identically
- **What if we're wrong**: If CLI adoption is zero, we still benefit from testable core functions and cleaner MCP wrappers — the extraction pays for itself

## Context

### Architecture Before Extraction

```
MCP Client → McpServer.registerTool() → inline callback (business logic + MCP formatting)
                                              ↓
                                        IBacklogService (storage)
```

Each tool file exported a single `registerXxxTool(server, service)` function with business logic embedded in the callback:

| Tool | Embedded Logic |
|------|---------------|
| `backlog-create` | `source_path` filesystem resolution, `nextEntityId()` generation, `parent_id`/`epic_id` precedence |
| `backlog-update` | `parent_id`/`epic_id` precedence with null-clearing, nullable field handling (`due_date`, `content_type`) |
| `backlog-get` | Resource URI detection (`mcp://backlog/`), batch fetch with `---` separators, frontmatter formatting |
| `backlog-search` | Result formatting with optional scores/content/snippets, hybrid search mode detection |
| `backlog-context` | Already well-factored — delegates to `hydrateContext()` (191 existing tests) |
| `write_resource` | Delegates to `applyOperation()` for str_replace/insert/append on task body |

### Existing CLI

Only server management commands: `serve`, `status`, `stop`, `version`, bridge mode. Zero task operations.

## Proposed Solutions

### Option 1: Extract to `src/core/` — Standalone Tool Functions (Selected)

Create `src/core/` with one file per operation. Each exports a pure function taking typed input + `IBacklogService`, returning typed output (plain objects, not MCP content format).

- MCP tools become thin wrappers: parse zod → call core → wrap in `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
- CLI commands become thin wrappers: parse args → call core → format for terminal

**Pros**: Clean hexagonal architecture, independently testable, guaranteed MCP/CLI parity, HTTP routes can reuse
**Cons**: 8 new files, return types to define, two layers of thin wrapper

### Option 2: Refactor In-Place in `src/tools/`

Export both standalone function and MCP registration from each tool file.

**Pros**: Less file movement
**Cons**: Mixed concerns in `src/tools/`, confusing imports (CLI importing from `tools/` suggests MCP dependency)

### Option 3: Enhance IBacklogService

Move all business logic into service methods.

**Pros**: Simplest — no new layer
**Cons**: Fatal flaw — service is a storage abstraction. Adding presentation logic (formatting search results, batch get with separators) violates SRP. `write_resource` applies text operations, not storage.

## Decision

**Selected**: Option 1 — Extract to `src/core/`

**Rationale**: Creates a clean boundary between "what the system does" (core) and "how you talk to it" (MCP, CLI, HTTP). The hexagonal/ports-and-adapters pattern. The "boilerplate" concern proved minimal in practice — each MCP wrapper is 5-10 lines.

**Assumptions that must hold**:
- Core functions depend only on `IBacklogService` (and deps for context) — no MCP SDK imports
- Return types are simple enough that both MCP (JSON) and CLI (text) can format them trivially
- The extraction doesn't change any observable behavior for existing MCP clients

## Architecture After Extraction (Phase 1 — Implemented)

```
MCP Client → src/tools/*.ts (thin wrapper) ──┐
                                              ├──→ src/core/*.ts (business logic) → IBacklogService
CLI User   → src/cli/commands/*.ts (thin)  ──┘
```

### Core Functions Implemented

| File | Function | Signature | Key Logic |
|------|----------|-----------|-----------|
| `core/list.ts` | `listItems()` | `(service, ListParams) → ListResult` | parent_id/epic_id precedence, optional counts |
| `core/get.ts` | `getItems()` | `(service, string[]) → GetResult` | Resource URI detection, batch with separators |
| `core/create.ts` | `createItem()` | `(service, CreateParams) → CreateResult` | ID generation, source_path resolution, parent precedence |
| `core/update.ts` | `updateItem()` | `(service, id, UpdateParams) → UpdateResult` | Null-clearing, parent/epic precedence, nullable fields |
| `core/delete.ts` | `deleteItem()` | `(service, id) → DeleteResult` | Delegates to service |
| `core/search.ts` | `searchItems()` | `(service, SearchParams) → SearchResult` | Result formatting, hybrid mode detection |
| `core/write.ts` | `writeBody()` | `(service, WriteParams) → WriteResult` | str_replace/insert/append via `applyOperation()` |
| `core/types.ts` | Types + `NotFoundError` | — | All param/result types, shared error class |

### What Was NOT Extracted

- `backlog-context` — already delegates to `hydrateContext()` which has 191 tests. The core function IS `hydrateContext`. No wrapper needed.
- `resolveSourcePath` — moved to `core/create.ts` but re-exported from `tools/backlog-create.ts` for backward compat (`source-path.test.ts` imports it)

### MCP Wrapper Pattern (Evidence)

Each refactored tool follows this pattern (example: `backlog-list.ts`):

```typescript
async (params) => {
  const result = await listItems(service, params);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
```

Error-handling tools add a try/catch for `NotFoundError`:

```typescript
async ({ id, ...params }) => {
  try {
    const result = await updateItem(service, id, params);
    return { content: [{ type: 'text', text: `Updated ${result.id}` }] };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };
    }
    throw error;
  }
}
```

### Regression Verification

- **Before**: 456 passing, 24 failing (pre-existing — storage/substrate/yaml tests with async/await issues)
- **After**: 504 passing (+48 new invariant tests), 24 failing (identical pre-existing)
- **Zero regressions** from the extraction

### Invariant Test Coverage (48 tests)

Tests in `src/__tests__/core-invariants.test.ts` use a mock `IBacklogService` — no filesystem, no MCP SDK. Each test verifies a behavioral contract that must hold regardless of transport.

| Suite | Count | Key Invariants |
|-------|-------|---------------|
| `listItems` | 8 | Normalized output shape, parent_id/epic_id precedence in filter, counts toggle, filter passthrough |
| `getItems` | 6 | Single/batch fetch, resource URI handling, "Not found" for missing, empty array error |
| `createItem` | 7 | Sequential ID generation, type-specific prefixes (EPIC-, FLDR-, etc.), parent precedence, epic_id backward compat, source_path mutual exclusion |
| `updateItem` | 10 | NotFoundError, parent/epic precedence, null clears both fields, epic_id sets parent_id, nullable due_date/content_type, updated_at timestamp |
| `deleteItem` | 1 | Delegates to service, returns ID |
| `searchItems` | 7 | Empty query error, optional scores/content, snippet inclusion, hybrid mode detection, filter passthrough |
| `writeBody` | 7 | All 3 operation types, NotFoundError, operation errors (not found, non-unique), empty description, updated_at |

## CLI Design (Phase 2 — Planned)

### Command Mapping

| MCP Tool | CLI Command | Notes |
|----------|-------------|-------|
| `backlog_list` | `backlog-mcp list` | Default: active items |
| `backlog_get` | `backlog-mcp get <id...>` | Positional args for IDs |
| `backlog_create` | `backlog-mcp create <title>` | Title as positional arg |
| `backlog_update` | `backlog-mcp update <id>` | ID as positional, fields as flags |
| `backlog_delete` | `backlog-mcp delete <id>` | Confirmation prompt (unless --force) |
| `backlog_search` | `backlog-mcp search <query>` | Query as positional |
| `backlog_context` | `backlog-mcp context <id>` | ID as positional |
| `write_resource` | `backlog-mcp edit <id>` | More natural CLI name for body editing |

### Design Decisions

- **Commander.js** for CLI framework — auto-generated help, subcommand routing, type coercion. ~50KB, acceptable for CLI UX.
- **Direct filesystem access** — CLI reads from same `BACKLOG_DATA_DIR` via `BacklogService.getInstance()`. No running server needed. Same pattern as `git` reading `.git/` directly.
- **Human-readable default output**, `--json` flag for machine-readable — CLI primary audience is humans debugging/scripting
- **Integrated into existing bin entry** — Commander routes known subcommands, falls through to existing bridge/serve/status logic for unknown commands

### Bundling

- `commander` goes in `dependencies` (needed at runtime by CLI)
- No tsdown config changes — `src/core/` and `src/cli/commands/` already covered by `src/**/*.ts` entry pattern
- `commander` is a Node.js module, so `skipNodeModulesBundle: true` externalizes it correctly

## Consequences

**Positive**:
- Every MCP operation available from CLI — 1:1 mapping
- Core functions independently testable (48 invariant tests prove this)
- HTTP routes can reuse core functions (future cleanup of `hono-app.ts`)
- Clean layer boundaries: core → tools (MCP) / commands (CLI) / routes (HTTP)

**Negative**:
- More files to maintain (8 core + 8 CLI commands + types)
- Commander.js dependency added to published package
- One extra function call in MCP path (wrapper → core → service)

**Risks and Mitigations**:
- CLI service instantiation conflicting with running server → mitigated: `TaskStorage` uses simple `readFileSync`/`writeFileSync`, no file locks
- Commander conflicting with existing arg parsing → mitigated: Commander only activates for registered subcommands, unrecognized args fall through to existing `if/else` chain
