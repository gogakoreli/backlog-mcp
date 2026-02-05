# 0057. Activity Panel Timezone Fix, Mode Persistence, and Task Titles

**Date**: 2026-02-05
**Status**: Accepted
**Backlog Item**: TASK-0193

## Problem Statement

The activity panel has timezone bugs causing operations to appear on wrong days, doesn't persist view mode across sessions, and shows only task IDs without titles making it hard to understand what tasks are about.

## Problem Space

### Why This Problem Exists

1. **Timezone bug**: `getDateKey()` uses `toISOString().split('T')[0]` which converts to UTC before extracting the date. An operation at 11pm PST on Feb 4 shows as Feb 5 (UTC).

2. **No persistence**: Activity mode (timeline/journal) was implemented without localStorage persistence - an oversight from TASK-0187.

3. **Missing titles**: Operation logging only captures task ID in `resourceId`. For `backlog_update` operations, the title isn't in params, so we can't display it.

4. **Flat timeline**: Operations are shown chronologically without task grouping, making it hard to see all activity for a specific task.

### Who Is Affected

- Users in non-UTC timezones see operations grouped under wrong days
- Users lose their preferred view mode on page refresh
- Users can't quickly understand what tasks were worked on without clicking through

### Problem Boundaries

**In scope**: Timezone fix, localStorage persistence, task title display, task grouping in timeline

**Out of scope**: Date library adoption, server-side date filtering, operation search

### Problem-Space Map

**Dominant causes**: 
- `toISOString()` converts to UTC before string extraction
- Mode state not persisted
- Operation records don't include task titles

**Alternative root causes**: Could be that users need task-level history rather than operation-level activity

**What if we're wrong**: If users don't care about titles or grouping, we're adding complexity. But the task explicitly requests these features.

## Context

### Current State

- `getDateKey()` returns UTC date, not local date
- Activity mode resets to 'timeline' on page load
- Journal view shows task IDs without titles for updates/completed/in-progress
- Timeline shows flat chronological list within each day

### Research Findings

- Native Date methods (`getFullYear()`, `getMonth()`, `getDate()`) return local time values
- Existing localStorage pattern uses simple key-value with `backlog:*` prefix
- Operations endpoint can be enriched with task data from storage
- 100 operation limit makes client-side grouping performant

### Prior Art

- ADR 0056 implemented day grouping and journal view
- Existing localStorage usage in split-pane.ts and resize.ts

## Proposed Solutions

### Option 1: Client-Only Fixes `[SHORT-TERM]` `[LOW]`

**Description**: Fix timezone with local date methods. Add localStorage persistence. For titles, fetch `/tasks?limit=200` once on load and build ID→title map. Group by task client-side.

**Differs from others by**:
- vs Option 2: No server changes, client fetches task list separately
- vs Option 3: No operation logging changes

**Pros**:
- No server changes
- Fast to implement
- Works immediately

**Cons**:
- Extra API call to fetch all tasks
- Title map could be stale if tasks updated during session
- Doesn't scale well with many tasks

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | ~2-3 hours, all client-side |
| Risk | 4 | Low risk, but extra API call could fail |
| Testability | 4 | Client logic testable |
| Future flexibility | 2 | Title map approach doesn't scale |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Changes isolated to viewer |

### Option 2: Server Enrichment `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Fix timezone with local date methods. Add localStorage persistence. Modify `/operations` endpoint to join with task storage and include titles in response. Group by task client-side.

**Differs from others by**:
- vs Option 1: Server provides enriched data in single call
- vs Option 3: No operation logging changes, titles looked up at read time

**Pros**:
- Single API call returns everything needed
- Server can efficiently join data
- Titles always current (looked up at read time)
- Clean separation of concerns

**Cons**:
- Server change required
- Slightly more complex endpoint
- Lookup for each operation (mitigated by small dataset)

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 4 | ~4-5 hours, server + client changes |
| Risk | 4 | Low risk, additive server change |
| Testability | 5 | Clean separation, endpoint testable |
| Future flexibility | 5 | Endpoint can be extended with more fields |
| Operational complexity | 4 | Slight increase in endpoint complexity |
| Blast radius | 3 | Changes span server + viewer |

### Option 3: Store Title in Operations `[LONG-TERM]` `[HIGH]`

**Description**: Fix timezone with local date methods. Add localStorage persistence. Modify operation logging to capture task title at write time. Existing operations won't have titles (graceful degradation). Group by task client-side.

**Differs from others by**:
- vs Option 1: Title stored in operation record, not fetched separately
- vs Option 2: Title captured at operation time, not looked up at read time

**Pros**:
- Title captured at operation time (historical accuracy)
- No joins needed at read time
- Fast reads

**Cons**:
- Existing operations have no titles (incomplete data)
- Title at operation time might differ from current title
- More storage per operation
- Requires changes to operation logging

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | ~1 day, logging changes + testing |
| Risk | 2 | Existing data incomplete |
| Testability | 4 | Logging testable |
| Future flexibility | 3 | Locked to title at operation time |
| Operational complexity | 2 | More storage, incomplete historical data |
| Blast radius | 2 | Changes span logging, storage, viewer |

## Decision

**Selected**: Option 2 - Server Enrichment

**Rationale**: 
- Highest rubric score (25 vs 24 vs 15)
- Single API call provides all needed data
- Titles are always current (not stale)
- Clean separation - server enriches, client displays
- No migration or incomplete data issues

**For this decision to be correct, the following must be true**:
- Task storage lookup is fast enough for 100 operations
- Most operations have resourceId (task ID)
- Users prefer current titles over historical titles

**Trade-offs Accepted**:
- Server change required (acceptable - additive change)
- Title lookup per operation (acceptable - small dataset, fast storage)

## Consequences

**Positive**:
- Operations grouped by user's local date
- View mode persists across sessions
- Task titles visible everywhere
- Timeline grouped by task for better UX

**Negative**:
- Server endpoint slightly more complex
- Additional storage lookups per request

**Risks**:
- Performance with many operations (mitigated: 100 limit)
- Deleted tasks have no title (mitigated: show ID as fallback)

## Implementation Notes

### Part 1: Timezone Fix

Replace `getDateKey()` to use local date methods:
```typescript
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

### Part 2: Mode Persistence

- Storage key: `backlog:activity-mode`
- Read in `connectedCallback()`, write in `setMode()`

### Part 3: Server Enrichment

Modify `/operations` endpoint to enrich with task titles:
```typescript
const enriched = operations.map(op => {
  if (op.resourceId) {
    const task = storage.get(op.resourceId);
    return { ...op, resourceTitle: task?.title };
  }
  return op;
});
```

### Part 4: Task Grouping in Timeline

Within each day group, group operations by resourceId, ordered by most recent operation in each group.
