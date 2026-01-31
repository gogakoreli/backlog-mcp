# 0038. Comprehensive Search Capability

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0104

## Context

As the backlog grows, finding specific tasks becomes difficult. Users need to search across all task content (not just titles), including descriptions, evidence, references, and other metadata.

### Current State

- `BacklogStorage.list()` supports filtering by: status, type, epic_id, limit
- No text search capability exists
- Viewer has filter buttons for status and type, but no search input
- MCP tool `backlog_list` mirrors storage filters

### Research Findings

1. **Existing filter pattern**: Storage iterates tasks, applies filters sequentially, sorts, slices
2. **Viewer architecture**: URL state → components → API → storage (unidirectional)
3. **Event pattern**: Components dispatch events → main.ts → urlState.set() → notify
4. **Task description recommends**: `matchesQuery(task, query)` helper method in BacklogStorage

## Proposed Solutions

### Option 1: Private Method in BacklogStorage

**Description**: Add `matchesQuery()` as a private method in BacklogStorage class. Add `query` to the filter object.

**Pros**:
- Follows task's explicit suggestion
- Single source of truth for MCP and HTTP
- Easy to extract to separate module in Phase 2
- Consistent with existing filter pattern

**Cons**:
- Method is private, can't be reused elsewhere directly
- Storage class grows slightly (~15 lines)

**Implementation Complexity**: Low

### Option 2: Separate search.ts Module

**Description**: Create `src/storage/search.ts` with exported `matchesQuery()`. Import in BacklogStorage.

**Pros**:
- Immediately reusable
- Easier to test in isolation
- Cleaner separation of concerns

**Cons**:
- Extra file for one function
- Slightly over-engineered for MVP
- YAGNI - don't add abstraction until needed

**Implementation Complexity**: Low-Medium

### Option 3: Consumer-Side Search (HTTP/MCP Layer)

**Description**: Keep storage unchanged. Implement search in MCP tool and HTTP route separately.

**Pros**:
- Storage layer stays simple
- Each consumer can customize behavior

**Cons**:
- Duplicated search logic in two places
- Inconsistent behavior risk
- Must fetch all tasks then filter (inefficient)
- Maintenance nightmare

**Implementation Complexity**: Medium (due to duplication)

## Decision

**Selected**: Option 1 - Private Method in BacklogStorage

**Rationale**:
1. Explicitly recommended by task description
2. Balances simplicity with future extraction capability
3. Consistent with existing filter pattern (status, type, epic_id are all filters)
4. Single source of truth - MCP and HTTP use identical logic
5. Easy to extract to separate module in Phase 2 if SearchService abstraction is needed

**Trade-offs Accepted**:
- Method is private (can extract later when needed)
- Storage class grows by ~15 lines (acceptable)

## Consequences

**Positive**:
- Users can find tasks by searching ANY field content
- Consistent search behavior across MCP tool and web viewer
- Foundation for future semantic/RAG search (Phase 2+)
- Backward compatible - query parameter is optional

**Negative**:
- Linear search performance O(n) - acceptable for ~1000 tasks
- Simple substring matching may miss semantic matches

**Risks**:
- Performance with 10,000+ tasks → Mitigate: defer indexing until needed
- Search quality with substring matching → Mitigate: document as MVP, plan Phase 2

## Implementation Notes

### Search Algorithm

Case-insensitive substring matching across concatenated searchable fields:

```typescript
private matchesQuery(task: Task, query: string): boolean {
  const q = query.toLowerCase();
  const searchable = [
    task.title,
    task.description || '',
    ...(task.evidence || []),
    task.blocked_reason || '',
    ...(task.references || []).map(r => `${r.url} ${r.title || ''}`),
    task.epic_id || ''
  ].join(' ').toLowerCase();
  return searchable.includes(q);
}
```

### API Changes

- **MCP Tool**: Add `query?: string` parameter to `backlog_list`
- **HTTP API**: Add `q` query parameter to `/tasks` endpoint
- **Viewer API**: Add `q` parameter to `fetchTasks()`

### UI Changes

- Add search input to `TaskFilterBar` component
- Debounce input (300ms)
- Persist query in URL (`?q=query`)
- Show result count when searching

### Future Architecture (Phase 2+)

When semantic search is needed:
1. Extract `matchesQuery()` to `SearchService` interface
2. Implement `TextSearchService` (current logic)
3. Implement `VectorSearchService` (embeddings + similarity)
4. Configure via environment or runtime option
