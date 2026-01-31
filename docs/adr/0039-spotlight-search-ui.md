# 0039. Spotlight-Style Search UI

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0144

## Context

The backlog viewer needs a powerful, keyboard-driven search experience similar to macOS Spotlight. Users should press `Cmd+J` to instantly search across all indexed content with highlighted match snippets.

### Requirements

1. Keyboard shortcut (`Cmd+J` / `Ctrl+J`) opens floating modal
2. Search across tasks, epics (resources future)
3. Show WHY results matched (highlighted snippets)
4. Keyboard navigation (↑/↓/Enter)
5. Navigate to selected item on selection

### Current State

- `OramaSearchService` already indexes tasks with fuzzy search
- `/tasks?q=query` endpoint returns search results with scores
- Existing modal pattern in `system-info-modal.ts`
- `urlState` manages URL state and component communication

## Proposed Solutions

### Option 1: Client-Side Highlighting with @orama/highlight

**Description**: Use existing search API. Add `@orama/highlight` package to viewer for client-side snippet generation.

**Architecture**:
```
viewer/components/spotlight-search.ts  # Single component
├── Modal overlay with input
├── Debounced fetch to /tasks?q=query
├── @orama/highlight for snippet generation
└── Keyboard navigation + selection
```

**Pros**:
- No backend changes required
- Same highlighting library as Orama uses internally
- Fast to implement
- ~2KB bundle increase (negligible)

**Cons**:
- Highlighting happens client-side (minor latency)
- Need full task data to generate snippets

**Implementation Complexity**: Low

### Option 2: Server-Side Highlighting

**Description**: Extend `SearchService` to return match positions. Create new `/api/search` endpoint.

**Architecture**:
```
src/search/types.ts        # Add matches[] to SearchResult
src/search/orama-*.ts      # Use @orama/highlight server-side
src/server/viewer-routes.ts # New /api/search endpoint
viewer/components/spotlight-search.ts
```

**Pros**:
- Server handles all search logic
- Reusable by MCP tools
- Consistent highlighting

**Cons**:
- More backend changes
- New endpoint to maintain
- Same accuracy as Option 1

**Implementation Complexity**: Medium

### Option 3: Simple Regex Highlighting (No Library)

**Description**: Use regex to find query terms in result text. No additional dependencies.

**Pros**:
- Zero dependencies
- Simplest implementation

**Cons**:
- Doesn't match Orama's fuzzy matching logic
- May highlight wrong text (user sees result but not why it matched)
- Inaccurate for typo-tolerant searches

**Implementation Complexity**: Low (but poor accuracy)

## Decision

**Selected**: Option 1 - Client-Side Highlighting with @orama/highlight

**Rationale**:
1. Same accuracy as server-side (both use @orama/highlight)
2. No backend changes = faster delivery
3. 2KB bundle increase is acceptable
4. Existing `/tasks?q=query` API already returns full task data

**Trade-offs Accepted**:
- Client-side highlighting adds minor latency (~5ms)
- Resources not searchable yet (not in current index)

## Consequences

**Positive**:
- Users get Spotlight-like search experience
- Keyboard-driven workflow for power users
- Accurate "why it matched" snippets

**Negative**:
- Additional dependency (@orama/highlight ~2KB)
- Resources require separate indexing (future work)

**Risks**:
- Performance with large result sets → Mitigated by 10 result limit

## Implementation Notes

**Component Structure**: Single `spotlight-search.ts` component. No sub-components needed - over-engineering for a modal with input + list.

**Keyboard Handling**:
- `Cmd/Ctrl+J`: Open modal (in main.ts)
- `Escape`: Close modal
- `↑/↓`: Navigate results
- `Enter`: Select highlighted result

**Snippet Generation**:
1. For each result, check fields in priority order: title, description, evidence, blocked_reason, references
2. Use `@orama/highlight` to find matches
3. Show first matching field with trimmed snippet (~100 chars)

**Navigation**:
- Task/Epic: `urlState.set({ task: id })` + close modal
- Resource (future): Dispatch `resource-open` event

**Styling**: Match existing dark theme. Use existing `.modal-overlay` pattern from system-info-modal.
