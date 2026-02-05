# 0059. Journal View Epic Grouping and UX Overhaul

**Date**: 2026-02-05
**Status**: Accepted
**Backlog Item**: TASK-0195

## Problem Statement

The journal view shows completed tasks as a flat list without thematic grouping. Users cannot quickly see "what themes did I work on today?" - they see individual tasks but miss the narrative of their work.

## Problem Space

### Why This Problem Exists

The journal was built as MVP in TASK-0187 - functional but not polished. Focus was on getting the data structure right (Completed, In Progress, Created, Updated sections), not the presentation or thematic grouping.

### Who Is Affected

- Users doing standups who want to report by theme/epic
- Users reviewing their work who want to see patterns
- Anyone trying to answer "what did I accomplish?" quickly

### Problem Boundaries

**In scope**: Epic grouping for completed tasks, epic titles display, visual hierarchy improvements, adjacent proposals documentation

**Out of scope**: Weekly/monthly views, export features, activity search (captured as future work)

### Adjacent Problems

1. **Weekly/monthly rollup views**: Users may want to see work across multiple days
2. **Export to markdown**: Users may want to copy journal as standup notes
3. **Activity heatmap**: Visualize productivity patterns over time

Captured for future work, not addressed in this change.

### Problem-Space Map

**Dominant causes**: Journal was MVP, epic grouping wasn't implemented. The `JournalEntry` interface only has `resourceId` and `title`, missing `epicId`.

**Alternative root causes**: Server enrichment only adds `resourceTitle`, not `epicId` or `epicTitle`. The data exists but isn't being passed through.

**What if we're wrong**: If users don't care about epic grouping and just want a flat list, this adds complexity. But the task explicitly requests epic grouping, validating the need.

## Context

### Current State

- `JournalEntry` interface: `{ resourceId, title }` - no epic info
- `aggregateForJournal()` creates flat arrays for each section
- Server enriches operations with `resourceTitle` only
- `OperationEntry` has `epicId?: string` but it's not populated

### Research Findings

- Server already does per-operation enrichment with task lookup
- Adding `epicId` and `epicTitle` to enrichment is minimal change
- Client-side grouping of ~100 operations is fast (proven with day grouping)
- Epic titles are stable (don't change frequently)

### Prior Art

- GitHub activity feeds group by repository
- Jira sprint reports group by epic
- Linear changelogs group by project

## Proposed Solutions

### Option 1: Client-Side Epic Grouping with Batch Fetch `[SHORT-TERM]` `[MEDIUM]`

**Description**: Keep server enrichment minimal. Client fetches epic data separately when rendering journal. Group completed tasks by epicId client-side.

**Differs from others by**:
- vs Option 2: Client does grouping, not server
- vs Option 3: Separate epic fetch, not inline enrichment

**Pros**:
- Server changes minimal
- Client has full control over grouping logic

**Cons**:
- Extra network request for epic data
- Race conditions possible
- More client complexity

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | Need epic fetch, caching, grouping logic |
| Risk | 3 | Extra network request, race conditions |
| Testability | 4 | Grouping logic is pure, testable |
| Future flexibility | 3 | Client-side grouping limits server optimization |
| Operational complexity | 4 | No new endpoints, but more client complexity |
| Blast radius | 4 | Changes in client only |

### Option 2: Server-Side Journal Aggregation Endpoint `[MEDIUM-TERM]` `[HIGH]`

**Description**: Create new `/operations/journal?date=YYYY-MM-DD` endpoint that returns pre-grouped data with epic titles resolved.

**Differs from others by**:
- vs Option 1: Server does all grouping and title resolution
- vs Option 3: New API contract, not enrichment of existing endpoint

**Pros**:
- Clean separation - server handles all aggregation
- Client rendering is simple
- Server can optimize queries

**Cons**:
- New endpoint to maintain
- New API contract to version
- More code overall

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | New endpoint, new data contract |
| Risk | 2 | New API to maintain, versioning concerns |
| Testability | 5 | Server logic fully testable |
| Future flexibility | 5 | Server can optimize, add features |
| Operational complexity | 2 | New endpoint to maintain |
| Blast radius | 2 | Changes span server + client |

### Option 3: Enhanced Server Enrichment `[SHORT-TERM]` `[LOW]`

**Description**: Extend existing `/operations` enrichment to include `epicId` and `epicTitle`. Client groups by epicId using already-available data.

**Differs from others by**:
- vs Option 1: No separate fetch, data comes with operations
- vs Option 2: No new endpoint, extends existing enrichment

**Pros**:
- Minimal server change (extend existing pattern)
- No new endpoints
- Data available for any client-side use
- Fast to implement

**Cons**:
- Two extra storage lookups per operation
- Client still does grouping logic

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | Minimal changes: add 2 fields to enrichment |
| Risk | 4 | Low risk - extends existing pattern |
| Testability | 4 | Enrichment testable, grouping testable |
| Future flexibility | 4 | Data available for any client-side use |
| Operational complexity | 5 | No new systems, extends existing |
| Blast radius | 4 | Small server change, client grouping |

## Decision

**Selected**: Option 3 - Enhanced Server Enrichment

**Rationale**: Highest rubric score (26 vs 21 vs 18). Follows existing enrichment pattern, minimal code changes, no new endpoints. The extra storage lookups are acceptable since we already do one lookup per operation.

**For this decision to be correct, the following must be true**:
- Performance of 2 extra storage lookups per operation is acceptable
- Epic titles don't change frequently (they don't)
- Client-side grouping of ~100 operations is fast enough (proven)

**Trade-offs Accepted**:
- Client does grouping logic (acceptable - keeps server simple)
- Extra storage lookups (acceptable - already doing one per op)

## Consequences

**Positive**:
- Users see completed tasks grouped by epic/theme
- "What did I accomplish?" is answered at a glance
- Minimal code changes, low risk

**Negative**:
- Slightly more data transferred per operation
- Client grouping logic adds complexity

**Risks**:
- Performance with many operations (mitigated: 100 limit exists)

## Implementation Notes

### Server Changes (viewer-routes.ts)
1. Extend enrichment to include `epicId` and `epicTitle`
2. When task has `epic_id`, look up epic to get title

### Client Changes
1. Extend `JournalEntry` to include `epicId?` and `epicTitle?`
2. Modify `aggregateForJournal()` to capture epic info
3. Add `groupByEpic()` function for completed tasks
4. Modify `renderJournal()` to render epic groups
5. Add styles for epic group headers

### Visual Design
```
### ✅ Completed

**EPIC-0002: backlog-mcp 10x**
  • TASK-0187: Activity monitor day grouping
  • TASK-0193: Fix timezone handling

**No Epic**
  • TASK-0142: Fix typo
```

## Adjacent Proposals (Future Work)

### 1. Weekly/Monthly Rollup Views
Add "This Week" and "This Month" navigation. Aggregate completed tasks across multiple days with epic grouping.

### 2. Export to Markdown
"Copy as Markdown" button generating standup-ready format for pasting into Slack/email.

### 3. Activity Heatmap
GitHub-style contribution graph showing activity intensity over time. Click a day to jump to journal.

### 4. "What did I work on this week?" Summary
AI-generated summary grouping work by epic/theme with key accomplishments highlighted.

### 5. Git Commit Integration
Link tasks to git commits, showing commits alongside task operations.

### 6. Activity Search/Filter
Search operations by keyword, filter by tool type or actor.
