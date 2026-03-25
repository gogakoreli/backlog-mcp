---
title: "CLI Tool and Core Function Extraction"
date: 2026-03-26
status: Accepted
---

# 0090. CLI Tool and Core Function Extraction

## Problem Statement

All business logic lives inside MCP tool registration callbacks (`src/tools/*.ts`), tightly coupled to the MCP SDK. This means no CLI access, no reuse from HTTP routes, and testing requires MCP server mocking.

## Decision

Extract business logic into `src/core/` — standalone functions that take `IBacklogService` + typed params and return typed results. MCP tools and CLI commands become thin transport wrappers.

```
MCP Client → src/tools/*.ts (thin wrapper) ──┐
                                              ├──→ src/core/*.ts (business logic) → IBacklogService
CLI User   → src/cli/commands/*.ts (thin)  ──┘
```

## Design Principles

### 1. Core is pure business logic — no I/O, no transport

Core functions never touch the filesystem, network, or MCP SDK. `resolveSourcePath` (filesystem read) lives in the MCP transport layer, not core. This enables Workers/D1 compatibility (ADR-0089).

### 2. Consistent error contract

Two error classes with clear semantics:

| Error | When | Used by |
|-------|------|---------|
| `NotFoundError` | Required entity doesn't exist | `updateItem`, `editItem` |
| `ValidationError` | Invalid input | `getItems` (empty ids), `searchItems` (empty query) |

For reads, not-found is a normal outcome — `getItems` returns `{ id, content: null }` per missing entity instead of throwing. For deletes, `deleteItem` returns `{ id, deleted: boolean }` so the caller knows if the item existed.

Edit operations return `{ success: false, error }` for operation failures (str_replace not found, non-unique match) — these are expected outcomes, not exceptions.

### 3. Consistent signatures — single params object

Every core function takes `(service, params)` where params is a typed object:

```typescript
listItems(service, { status, type, limit })
getItems(service, { ids })
createItem(service, { title, description, type, parent_id })
updateItem(service, { id, status, title, parent_id })
deleteItem(service, { id })
searchItems(service, { query, types, status, limit })
editItem(service, { id, operation })
```

No mixed signatures (separate `id` arg vs embedded in params). Consistent for both human reasoning and code generation.

### 4. Transport formats, core returns data

Core returns structured types. Transport decides presentation:
- `getItems` returns `Array<{ id, content: string | null }>` — MCP joins with `---` separators and shows "Not found: X" for nulls. CLI could show a table.
- `listItems` returns `{ tasks: ListItem[], counts? }` — MCP serializes to JSON. CLI could show a formatted list.

### 5. Backward compatibility via re-export

`resolveSourcePath` moved from `core/create.ts` to `tools/backlog-create.ts` but existing tests (`source-path.test.ts`) import from the tools path — no breakage.

## Core Functions

| File | Function | Returns | Throws |
|------|----------|---------|--------|
| `core/list.ts` | `listItems` | `{ tasks: ListItem[], counts? }` | — |
| `core/get.ts` | `getItems` | `{ items: Array<{ id, content: string \| null }> }` | `ValidationError` (empty ids) |
| `core/create.ts` | `createItem` | `{ id }` | — |
| `core/update.ts` | `updateItem` | `{ id }` | `NotFoundError` |
| `core/delete.ts` | `deleteItem` | `{ id, deleted: boolean }` | — |
| `core/search.ts` | `searchItems` | `{ results, total, query, search_mode }` | `ValidationError` (empty query) |
| `core/edit.ts` | `editItem` | `{ success, message?, error? }` | `NotFoundError` |

`backlog-context` was NOT extracted — it already delegates to `hydrateContext()` which has 191 tests. The core function IS `hydrateContext`.

## MCP Wrapper Pattern

Each tool follows this pattern:

```typescript
// Happy path — core returns data, wrapper formats for MCP
async (params) => {
  const result = await listItems(service, params);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// With error handling — transport catches typed errors
async (params) => {
  try {
    const result = await updateItem(service, params);
    return { content: [{ type: 'text', text: `Updated ${result.id}` }] };
  } catch (error) {
    if (error instanceof NotFoundError)
      return { content: [{ type: 'text', text: `Task ${params.id} not found` }], isError: true };
    throw error;
  }
}

// Transport-specific I/O — resolved before calling core
async ({ source_path, ...params }) => {
  let description = params.description;
  if (source_path) description = resolveSourcePath(source_path); // fs read in transport
  const result = await createItem(service, { ...params, description });
  return { content: [{ type: 'text', text: `Created ${result.id}` }] };
}
```

## Invariant Test Coverage

48 tests in `src/__tests__/core-invariants.test.ts` using a mock `IBacklogService` — no filesystem, no MCP SDK. Each test verifies a behavioral contract that must hold regardless of transport.

| Suite | Count | Key Invariants |
|-------|-------|---------------|
| `listItems` | 6 | Normalized shape, parent_id/epic_id precedence, counts toggle, filter passthrough |
| `getItems` | 7 | Structured items, null for missing, batch order preserved, resource URIs, ValidationError on empty, mixed found/not-found |
| `createItem` | 7 | Sequential ID, type-specific prefix, parent precedence, epic_id backward compat, pre-resolved description |
| `updateItem` | 10 | NotFoundError, parent/epic precedence, null clears both, epic_id sets parent_id, nullable fields, updated_at |
| `deleteItem` | 2 | Returns `deleted: true` when existed, `deleted: false` when not |
| `searchItems` | 8 | ValidationError on empty, optional scores/content, snippets, hybrid mode, filter passthrough |
| `editItem` | 8 | All 3 operations, NotFoundError, `{ success: false }` for op errors, empty description, updated_at |

## CLI Design (Phase 2 — Planned)

| MCP Tool | CLI Command | Notes |
|----------|-------------|-------|
| `backlog_list` | `backlog-mcp list` | Default: active items |
| `backlog_get` | `backlog-mcp get <id...>` | Positional args |
| `backlog_create` | `backlog-mcp create <title>` | `--source` resolves file in CLI layer |
| `backlog_update` | `backlog-mcp update <id>` | Fields as flags |
| `backlog_delete` | `backlog-mcp delete <id>` | `--force` skips confirmation |
| `backlog_search` | `backlog-mcp search <query>` | Query as positional |
| `backlog_context` | `backlog-mcp context <id>` | Calls `hydrateContext` directly |
| `write_resource` | `backlog-mcp edit <id>` | More natural CLI name |

Commander.js for CLI framework. Direct filesystem access via `BacklogService.getInstance()` — no running server needed. Human-readable default, `--json` flag for machine-readable.

## Regression Verification

- Before extraction: 456 passing, 24 failing (pre-existing)
- After Phase 1 (mechanical extraction): 504 passing (+48 invariant tests), 24 failing
- After Phase 1.5 (design fixes): 513 passing (+9 viewer-routes now passing), 24 failing
- Zero regressions introduced by our changes
