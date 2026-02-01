# 0047. Unified Search API with Proper Types

**Date**: 2026-02-01
**Status**: Accepted
**Backlog Item**: TASK-0159

## Context

The current search API attaches `score` to task objects, creating type impurity:

```typescript
// In BacklogService.list()
return results.map(r => ({ ...r.task, score: r.score }));
```

This was a pragmatic fix (ADR-0044) but creates issues:
- `score` isn't part of the `Task` type
- UI must use `(task as any).score` to access it
- No way to search across different document types with unified ranking

### Current State

- `SearchService.search()` returns `SearchResult[]` with `{ id, score, task }`
- `BacklogService.list()` spreads score onto task object
- `/tasks?q=` endpoint returns `Task[]` with score attached
- Spotlight uses `(task as any).score ?? 1`

## Proposed Solutions

### Option A: New `/search` endpoint alongside `/tasks`

**Description**: Add dedicated `/search` endpoint returning proper `UnifiedSearchResult[]`. Keep `/tasks?q=` unchanged for backward compatibility.

**Pros**:
- Clean REST semantics (separate endpoints for different operations)
- Type-safe (`UnifiedSearchResult` has proper fields)
- Backward compatible
- Extensible for future resource search

**Cons**:
- Two endpoints that handle search
- Spotlight needs to change API call

**Complexity**: Medium

### Option B: Extend `/tasks` with `format=search` param

**Description**: Add `format=search` query param to `/tasks`. Return different shape based on format.

**Pros**:
- Single endpoint
- Backward compatible

**Cons**:
- Conditional return types are confusing
- TypeScript can't express conditional return types cleanly
- Violates single responsibility principle
- `/tasks` returning non-Task objects is semantically wrong

**Complexity**: Medium (but higher cognitive load)

### Option C: Replace `/tasks?q=` with `/search`

**Description**: Remove search from `/tasks`, make `/search` the only search endpoint.

**Pros**:
- Clean separation
- No conditional types

**Cons**:
- **Breaking change** - violates backward compatibility requirement
- Filter bar uses `/tasks?q=`

**Complexity**: Medium code, HIGH migration risk

## Decision

**Selected**: Option A - New `/search` endpoint alongside `/tasks`

**Rationale**:
1. Clean REST design - `/tasks` for listing, `/search` for searching
2. Type-safe - proper `UnifiedSearchResult` type
3. Backward compatible - `/tasks?q=` unchanged
4. Extensible - easy to add resource search later
5. Clear API semantics

**Trade-offs Accepted**:
- Two endpoints handle search (acceptable - different purposes)
- Spotlight migration required (one-time change)

## Consequences

**Positive**:
- Type-safe API - no more `(task as any).score`
- Proper separation of concerns
- Extensible for cross-type search (tasks, epics, resources)
- Clean TypeScript types

**Negative**:
- Slight API surface increase
- Spotlight needs update

**Risks**:
- None significant - additive change

## Implementation Notes

### Type Definition

```typescript
interface UnifiedSearchResult {
  item: Task;
  score: number;
  type: 'task' | 'epic';
}
```

### API

```
GET /search?q=query&types=task,epic&limit=N
```

- `q` (required): Search query
- `types` (optional): Comma-separated list, defaults to all
- `limit` (optional): Max results, defaults to 20

### Scope Control

- Resource search NOT implemented (resources not indexed yet)
- Server-side match snippets NOT implemented (client-side works fine)
- `/tasks?q=` unchanged (backward compatibility)
