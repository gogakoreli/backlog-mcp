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

### 2. Strict type safety — zero `any`

- Core layer: zero `any` types. All params, results, and errors are fully typed.
- `IBacklogService` interface: uses `UnifiedSearchResult`, `ResourceContent`, `ListFilter` — no `any` placeholders.
- `Entity` fields accessed via typed properties, not `as any` casts. Nullable fields (`due_date`, `content_type`) use explicit typed assignments.
- `EditOperation` maps to the `Operation` discriminated union from `resources/types.ts`.
- Only legitimate `Record<string, unknown>` is YAML frontmatter — genuinely arbitrary key-value data.

### 3. Consistent error contract

| Error | When | Used by |
|-------|------|---------|
| `NotFoundError` | Required entity doesn't exist | `updateItem`, `editItem` |
| `ValidationError` | Invalid input | `getItems` (empty ids), `searchItems` (empty query) |

- Reads: not-found is normal — `getItems` returns `{ id, content: null }` per missing entity.
- Deletes: `deleteItem` returns `{ id, deleted: boolean }` so caller knows if item existed.
- Edits: `{ success: false, error }` for operation failures (expected outcomes, not exceptions).

### 4. Consistent signatures — single params object

Every core function takes `(service, params)` where params is a typed object. No mixed signatures.

### 5. Transport formats, core returns data

Core returns structured types. Transport decides presentation:
- `getItems` returns `Array<{ id, content, resource? }>` — MCP joins with separators and formats resource headers. CLI could render differently.
- `listItems` returns `{ tasks: ListItem[], counts? }` — MCP serializes to JSON. CLI could show a table.

### 6. Backward compatibility via re-export

`resolveSourcePath` moved to MCP transport but re-exported from `tools/backlog-create.ts` for existing test imports.

## Core Functions (Phase 1 — Complete)

| File | Function | Returns | Throws |
|------|----------|---------|--------|
| `core/list.ts` | `listItems` | `{ tasks: ListItem[], counts? }` | — |
| `core/get.ts` | `getItems` | `{ items: GetItem[] }` | `ValidationError` |
| `core/create.ts` | `createItem` | `{ id }` | — |
| `core/update.ts` | `updateItem` | `{ id }` | `NotFoundError` |
| `core/delete.ts` | `deleteItem` | `{ id, deleted }` | — |
| `core/search.ts` | `searchItems` | `{ results, total, query, search_mode }` | `ValidationError` |
| `core/edit.ts` | `editItem` | `{ success, message?, error? }` | `NotFoundError` |

`backlog-context` was NOT extracted — already delegates to `hydrateContext()` (191 tests).

## MCP Wrapper Pattern

```typescript
// Happy path
async (params) => {
  const result = await listItems(service, params);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// Typed error handling
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

// Transport-specific I/O before calling core
async ({ source_path, ...params }) => {
  let description = params.description;
  if (source_path) description = resolveSourcePath(source_path);
  const result = await createItem(service, { ...params, description });
  return { content: [{ type: 'text', text: `Created ${result.id}` }] };
}
```

## Invariant Tests (48)

| Suite | Count | Key Invariants |
|-------|-------|---------------|
| `listItems` | 6 | Normalized shape, parent_id/epic_id precedence, counts toggle, filter passthrough |
| `getItems` | 7 | Structured items, null for missing, batch order, resource URIs with metadata, ValidationError on empty |
| `createItem` | 7 | Sequential ID, type-specific prefix, parent precedence, epic_id backward compat |
| `updateItem` | 10 | NotFoundError, parent/epic precedence, null clears both, nullable fields, updated_at |
| `deleteItem` | 2 | `deleted: true` when existed, `deleted: false` when not |
| `searchItems` | 8 | ValidationError on empty, optional scores/content, hybrid mode, filter passthrough |
| `editItem` | 8 | All 3 operations, NotFoundError, `{ success: false }` for op errors, updated_at |

## CLI (Phase 2 — Next)

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
- After Phase 1 complete: 513 passing, 24 failing (same pre-existing)
- Typecheck: zero new errors (3 pre-existing in hono-app.ts OAuth code)
- Zero `any` in core/ and service-types.ts
