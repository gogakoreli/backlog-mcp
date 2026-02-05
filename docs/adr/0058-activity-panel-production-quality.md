# 0058. Activity Panel Production Quality Refactor

**Date**: 2026-02-05
**Status**: Accepted
**Backlog Item**: TASK-0194

## Problem Statement

The activity panel (TASK-0187, TASK-0193) was built with shortcuts for MVP delivery. It works but has technical debt, performance issues, and UX gaps that need addressing for production quality.

## Problem Space

### Why This Problem Exists

Time pressure during MVP delivery led to:
- Inline date utilities instead of shared modules
- Magic numbers instead of named constants
- Duplicated logic between similar functions
- No tests for pure functions
- No error handling for date parsing
- O(n) storage lookups in server enrichment

### Who Is Affected

- **Users**: UX issues make activity harder to scan (no date context, weak visual hierarchy)
- **Developers**: No tests means changes are risky, inline code harder to maintain
- **Performance**: O(n) lookups will degrade with more operations

### Problem Boundaries

**In scope**:
- Date utilities extraction and testing
- Error handling for malformed dates
- Server enrichment optimization
- UX improvements (collapse/expand, date+time, epic badges, sticky headers)

**Out of scope**:
- Major architectural changes
- New features beyond acceptance criteria
- External date library adoption (evaluated and rejected)

### Adjacent Problems

1. **No viewer tests exist** - This task creates the first viewer tests, establishing patterns
2. **No shared date utilities in viewer** - Creates reusable infrastructure for future components

### Problem-Space Map

**Dominant causes**: Time pressure during MVP, lack of shared utility patterns

**Alternative root causes**: Viewer codebase is young, patterns not yet established

**What if we're wrong**: If inline code is fine, extraction adds complexity. But these are pure functions used in multiple places - extraction is clearly beneficial.

## Context

### Current State

`activity-panel.ts` (~500 lines) contains:
- 6 inline date functions: `getLocalDateKey`, `getTodayKey`, `formatDayLabel`, `formatDateForNav`, `getPrevDay`, `getNextDay`
- Magic number `86400000` for milliseconds per day
- Duplicated today/yesterday checks in `formatDayLabel` and `formatDateForNav`
- Pure functions `groupByDay`, `groupByTask`, `aggregateForJournal` with no tests
- No error handling for date parsing

Server enrichment (`viewer-routes.ts`):
```typescript
const enriched = operations.map(op => {
  if (op.resourceId) {
    const taskData = storage.get(op.resourceId);  // Disk read per operation!
    return { ...op, resourceTitle: taskData?.title };
  }
  return op;
});
```

### Research Findings

**Date library evaluation**:
- `date-fns`: Tree-shakeable but adds dependency for ~20 lines of code
- `dayjs`: Smaller but less tree-shakeable
- Native `Intl.DateTimeFormat`: Zero dependency, already used in current code

**Decision**: Use native APIs. The codebase philosophy is "Keep viewer lightweight - No heavy frameworks, vanilla TS only". Our date needs are simple.

**Server performance analysis**:
- With 100 operations, if 50 are for the same task, we do 50 disk reads
- A simple in-request Map cache eliminates duplicates
- This is a 5-line fix, not a major refactor

### Prior Art

- `viewer/utils/` has existing utility patterns (api.ts, url-state.ts)
- Server tests exist in `src/storage.test.ts`
- No viewer component tests exist yet

## Proposed Solutions

### Option 1: Minimal Surgical Fix `[SHORT-TERM]` `[LOW]`

**Description**: Extract utilities, add constants, fix duplicates, add tests. No UX changes.

**Differs from others by**:
- vs Option 2: No UX changes, just code quality
- vs Option 3: No server-side changes, client-only

**Pros**:
- Fastest to ship
- Lowest risk
- Addresses technical debt

**Cons**:
- Doesn't address UX issues (fails acceptance criteria)
- Doesn't fix server performance
- Incomplete solution

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | 2-3 hours, straightforward extraction |
| Risk | 5 | Pure refactor, no behavior change |
| Testability | 5 | Adding tests is the point |
| Future flexibility | 3 | Utilities reusable, but UX debt remains |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Contained to activity panel |

### Option 2: Full Client-Side Refactor + UX `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Option 1 + all UX improvements (collapse/expand, date+time, epic badges, sticky headers).

**Differs from others by**:
- vs Option 1: Includes all UX improvements
- vs Option 3: Server enrichment unchanged (still O(n))

**Pros**:
- Complete UX solution
- Better user experience
- Still mostly client-only changes

**Cons**:
- More complex implementation
- Server still has O(n) lookups
- Epic badge requires `epic_id` from server

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | 4-6 hours, more UI work |
| Risk | 4 | UI changes need visual testing |
| Testability | 4 | UI harder to test than pure functions |
| Future flexibility | 4 | Clean utilities + good UX foundation |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Activity panel + styles |

### Option 3: Full Stack Refactor with Cache `[MEDIUM-TERM]` `[HIGH]`

**Description**: Option 2 + server-side optimization with persistent cache and TTL.

**Differs from others by**:
- vs Option 1: Full solution including server
- vs Option 2: Adds cache infrastructure

**Pros**:
- Complete solution
- Better performance at scale
- Future-proof

**Cons**:
- Cache invalidation complexity
- Over-engineering for current scale
- More testing needed

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | 6-8 hours, cache infrastructure |
| Risk | 3 | Cache invalidation is hard |
| Testability | 3 | Cache behavior harder to test |
| Future flexibility | 5 | Clean architecture, scalable |
| Operational complexity | 2 | Cache management overhead |
| Blast radius | 3 | Server + client changes |

## Decision

**Selected**: Option 2 + Simple In-Request Cache

**Rationale**: 
- Option 1 fails acceptance criteria (UX items are required)
- Option 3 over-engineers the server solution
- Option 2 meets all requirements
- Adding a simple Map cache within the request handler (not persistent) fixes the O(n) issue with minimal complexity

**For this decision to be correct, the following must be true**:
- The UX improvements are actually wanted (confirmed: in acceptance criteria)
- A simple in-request Map cache is sufficient (yes: no need for TTL/persistence)
- Native date APIs are sufficient (yes: our needs are simple)

**Trade-offs Accepted**:
- No external date library (acceptable: our needs are simple)
- In-request cache only (acceptable: persistent cache is premature optimization)

## Consequences

**Positive**:
- Clean, tested date utilities for reuse
- Better UX with collapse/expand, date context, epic badges
- Server performance fixed for duplicate task lookups
- First viewer tests establish patterns

**Negative**:
- More code to maintain (but well-tested)
- CSS complexity increases (but organized)

**Risks**:
- Sticky headers may have browser compatibility issues → Test in major browsers
- Collapse state not persisted → Acceptable for now, can add localStorage later

## Implementation Notes

1. Create `viewer/utils/date.ts` with `MS_PER_DAY`, safe parsing, consolidated format functions
2. Create tests before refactoring (TDD approach)
3. Server: Add `Map<string, Task>` cache within request handler, include `epic_id` in response
4. CSS: Use `position: sticky` for day separators
5. Collapse: Default to 5 items, "Show more/less" toggle
