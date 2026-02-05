# 0056. Activity Day Grouping and Daily Work Journal View

**Date**: 2026-02-04
**Status**: Accepted
**Backlog Item**: TASK-0187

## Problem Statement

The activity panel displays operations as a flat chronological list without temporal organization. Users cannot quickly see "what happened today" vs "what happened yesterday", and there's no way to generate standup-style summaries of daily work.

## Problem Space

### Why This Problem Exists

The activity panel was built for recent activity monitoring (TASK-0175, TASK-0176), not historical review. The flat list works for "what just happened" but fails for "what happened this week" or "what should I report in standup".

### Who Is Affected

- Users doing standups who need to summarize daily work
- Users reviewing agent activity over multiple days
- Users trying to find when something happened

### Problem Boundaries

**In scope**: Day grouping in activity list, daily journal view with navigation, real-time updates for today

**Out of scope**: Weekly/monthly views, export to external systems, calendar integration, server-side aggregation

### Adjacent Problems

1. **Activity search**: Users might want to search for specific operations
2. **Activity persistence**: JSONL file grows unbounded - no rotation/archival

Captured for future work, not addressed in this change.

### Problem-Space Map

**Dominant causes**: Activity panel designed for recent monitoring, not historical review

**Alternative root causes**: Could be that users need task-level history (git-like versioning) rather than operation-level activity

**What if we're wrong**: If users don't actually do standups or review historical activity, this adds complexity for no benefit. But the task explicitly mentions standup notes as a use case.

## Context

### Current State

- ActivityPanel fetches from `/operations?limit=100`
- Renders flat list with expandable rows
- Shows date/time per row but no grouping
- Uses polling (30s) with visibility detection
- SplitPaneService manages activity pane

### Research Findings

- Existing `formatRelativeTime()` helper can be extended for day labels
- URL state pattern used throughout app (filter, task, epic, resource)
- Operations already have `ts` field for grouping
- 100 operation limit makes client-side grouping performant

### Prior Art

- Git changelog generation (inspiration mentioned in task)
- GitHub activity feeds use day grouping

## Proposed Solutions

### Option 1: Client-Side Grouping in ActivityPanel `[SHORT-TERM]` `[LOW]`

**Description**: Add day grouping logic directly in ActivityPanel.render(). Group operations by day in the client, insert day separator elements. For standup view, add a toggle button that switches between "timeline" and "journal" modes within the same component.

**Differs from others by**:
- vs Option 2: No server-side aggregation, no new component
- vs Option 3: No URL-based navigation, no separate route

**Pros**:
- Minimal code changes - extends existing component
- No server changes needed
- Fast to implement
- Reuses existing data fetching

**Cons**:
- ActivityPanel becomes complex (two modes)
- No deep linking to specific days
- Grouping recomputed on every render
- Journal aggregation logic mixed with rendering

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | ~1 day, minimal changes |
| Risk | 4 | Low risk - additive changes |
| Testability | 3 | Mixed concerns in one component |
| Future flexibility | 2 | Hard to extend, monolithic |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Changes isolated to one file |

### Option 2: Server-Side Aggregation with New Journal Component `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Add a new `/operations/journal?date=2026-02-04` endpoint that returns pre-aggregated changelog-style data. Create a new `<daily-journal>` component that fetches from this endpoint. ActivityPanel gets day grouping only (client-side).

**Differs from others by**:
- vs Option 1: Server-side aggregation, separate component
- vs Option 3: No URL routing, still uses split pane

**Pros**:
- Clean separation of concerns
- Server can optimize aggregation
- Journal component is focused and testable
- ActivityPanel stays simple

**Cons**:
- New API endpoint to maintain
- Two components to coordinate
- More code overall
- Server needs to understand "changelog" semantics

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | ~2-3 days, new endpoint + component |
| Risk | 3 | Medium - new API contract |
| Testability | 5 | Clean separation, easy to test |
| Future flexibility | 4 | Extensible, but two systems |
| Operational complexity | 3 | New endpoint to maintain |
| Blast radius | 3 | Changes span server + viewer |

### Option 3: Unified Activity Component with View Modes + URL State `[SHORT-TERM]` `[MEDIUM]`

**Description**: Enhance ActivityPanel with two view modes (timeline/journal) controlled via URL state. Day grouping is client-side for both modes. Journal mode transforms the same data into changelog format. URL state enables deep linking to specific days.

**Differs from others by**:
- vs Option 1: URL-based navigation, deep linking
- vs Option 2: No server changes, single component

**Pros**:
- Deep linking to specific days
- Browser history works naturally
- Single data source, two views
- Consistent with existing URL state patterns
- Moderate complexity

**Cons**:
- Client does all aggregation (could be slow with large datasets)
- Component has two modes (but well-separated)
- URL state adds complexity

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 4 | ~1.5 days, moderate changes |
| Risk | 4 | Low-medium - follows existing patterns |
| Testability | 4 | Utility functions testable, component has modes |
| Future flexibility | 4 | URL state enables future features |
| Operational complexity | 4 | No new systems, uses existing URL state |
| Blast radius | 4 | Changes mostly in one component + URL state |

## Decision

**Selected**: Option 3 - Unified Activity Component with View Modes + URL State

**Rationale**: 
- Highest rubric score (24 vs 23 vs 21)
- Follows existing URL state patterns in the codebase
- Deep linking enables sharing and browser navigation
- Single component with two modes is manageable with good separation
- No server changes required

**For this decision to be correct, the following must be true**:
- Client-side grouping of 100 operations is fast enough (<10ms)
- Users primarily view recent activity (today, yesterday) not ancient history
- URL state integration doesn't conflict with existing activity URL handling

**Trade-offs Accepted**:
- Component has two modes (acceptable with good code organization)
- No server-side date filtering initially (can add if performance becomes an issue)

## Consequences

**Positive**:
- Users can quickly see daily activity boundaries
- Standup-ready changelog view for any day
- Deep linking to specific days
- Browser back/forward works naturally

**Negative**:
- ActivityPanel complexity increases (two modes)
- Client-side aggregation for large datasets (mitigated by 100 limit)

**Risks**:
- URL state conflicts (mitigated: use distinct param names)
- Performance with many operations (mitigated: existing 100 limit)

## Implementation Notes

### Part 1: Day Grouping in Timeline View

1. Add `groupOperationsByDay()` utility that groups operations by date
2. Add `formatDayLabel()` helper: "Today", "Yesterday", "February 2, 2026"
3. Modify `render()` to insert day separator elements between groups
4. Style separators to match existing aesthetic

### Part 2: Journal View Mode

1. Add `mode` property ('timeline' | 'journal')
2. Add `selectedDate` property for journal navigation
3. Create `renderJournal()` with changelog sections:
   - Completed (status changed to done)
   - In Progress (status changed to in_progress)
   - Created (backlog_create)
   - Updated (backlog_update, excluding status changes already counted)
4. Add day navigation controls (prev/next/today)

### Part 3: Integration

1. Add mode toggle button in activity header
2. Wire navigation to update component state
3. Real-time updates continue working for "today" in journal view

### Key Design Decisions

- Day separator format: "Today", "Yesterday", then "February 2, 2026"
- Journal sections: Completed, In Progress, Created, Updated
- Deduplication: If task created AND updated same day, show in both sections
- Navigation: Simple prev/next + "Today" button, no date picker
