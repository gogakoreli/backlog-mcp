# 0060. Activity Summary System

**Date**: 2026-02-04
**Status**: Accepted
**Backlog Item**: TASK-0197, TASK-0198

## Problem Statement

Users want to answer "What did I accomplish?" at different time scales (today, yesterday, this week) without manually synthesizing raw activity data. The activity panel shows operations but doesn't tell a story.

## Problem Space

### Why This Problem Exists

- Activity data is captured but not synthesized into summaries
- No MCP interface for agents to access activity data programmatically
- No persistence layer for summaries
- UI shows raw data, not insights

### Who Is Affected

- Users doing standups, reports, or retrospectives
- Agents that could help synthesize but can't access the data
- Anyone who wants quick answers to "what did I do?"

### Problem Boundaries

**In scope:**
- Expose activity via MCP tool
- Persist summaries as MCP resources
- Show summaries in UI

**Out of scope:**
- Auto-generating summaries (agent does this)
- Complex analytics
- Time tracking

### Adjacent Problems

1. **No activity search/filter** - Can't find specific operations by keyword
2. **No export format** - Can't copy journal as markdown for standup
3. **No weekly/monthly rollups** - Only daily view exists in journal

### Problem-Space Map

**Dominant causes**: Activity data exists but isn't exposed to agents or persisted as summaries

**Alternative root causes**: Maybe the journal view itself should be smarter with template-based summaries?

**What if we're wrong**: If users don't want AI summaries, they still benefit from MCP tool for programmatic access and summary resources for manual notes

## Context

### Current State

- Activity panel exists with timeline and journal views
- Journal view shows: Completed, In Progress, Created, Updated sections
- Completed section groups by epic (TASK-0195)
- Server enriches operations with resourceTitle, epicId, epicTitle
- Data available via `/operations` HTTP endpoint
- No MCP tool exposes activity data
- No summary resource type exists

### Research Findings

- `aggregateForJournal()` function already aggregates operations
- `groupByEpic()` function groups entries by epic
- Server-side enrichment provides task/epic titles
- Operations log has timestamps, tools, params - all needed for summaries

### Prior Art

- GitHub contribution graphs show activity intensity
- Standup tools like Geekbot ask "what did you do yesterday?"
- Time tracking tools generate weekly reports

## Proposed Solutions

### Option 1: Minimal MCP Tool Only `[SHORT-TERM]` `[LOW]`

**Description**: Add `backlog_activity` tool that returns activity data. No summary storage, no UI changes. Agent can call this, synthesize, and use `write_resource` to store wherever they want.

**Differs from others by**:
- vs Option 2: No dedicated summary resource type, agent decides where to store
- vs Option 3: No UI integration, summaries are just regular resources

**Pros**:
- Minimal code change
- Flexible - agent decides format and storage
- Ships fast

**Cons**:
- No standard location for summaries
- UI doesn't know about summaries
- Agent must figure out storage conventions

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | Just one new tool, reuse existing logic |
| Risk | 5 | Low risk - additive change only |
| Testability | 5 | Easy to test - input period, verify output |
| Future flexibility | 3 | Can add storage later, but no foundation |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Only affects activity queries |

### Option 2: Full Summary System `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Add `backlog_activity` tool + dedicated `summaries/` resource type + UI integration. Summaries stored with schema, UI shows them contextually in journal view.

**Differs from others by**:
- vs Option 1: Dedicated summary storage with schema, UI knows about summaries
- vs Option 3: Summaries are separate resources, not embedded in operations log

**Pros**:
- Clean separation: activity data vs summaries
- UI can show summaries contextually
- Searchable summary history
- Standard format for all summaries

**Cons**:
- More code to write
- New resource type to maintain
- UI complexity increases

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | Multiple components: tool, storage, UI |
| Risk | 3 | New resource type, UI changes |
| Testability | 4 | Each component testable |
| Future flexibility | 5 | Clean foundation for weekly/monthly, export |
| Operational complexity | 3 | New resource type to maintain |
| Blast radius | 4 | Summary bugs don't affect core tasks |

### Option 3: Embedded Summary in Operations `[LONG-TERM]` `[HIGH]`

**Description**: Store summaries as special operation entries in the operations log itself. Operations log becomes single source of truth for both activity AND summaries.

**Differs from others by**:
- vs Option 1: Summaries are first-class, not ad-hoc resources
- vs Option 2: No separate storage - summaries live in operations log

**Pros**:
- Single data model
- Summaries appear naturally in timeline
- No new storage layer

**Cons**:
- Mixes concerns (operations vs summaries)
- Operations log grows with non-operation data
- Harder to query summaries separately
- Breaking change to operations schema

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | Schema changes, migration needed |
| Risk | 2 | Breaking change, mixed concerns |
| Testability | 3 | Harder to test summaries separately |
| Future flexibility | 2 | Locked into operations schema |
| Operational complexity | 2 | Operations log becomes complex |
| Blast radius | 2 | Operations log is critical path |

## Decision

**Selected**: Option 2 - Full Summary System (phased delivery)

**Rationale**: 
- Option 1 scores highest on rubric but doesn't address the full vision ("show up nicely in the activity bar")
- Option 2 is the only option that delivers the complete user experience
- Option 3 mixes concerns inappropriately - summaries are derived artifacts, not operations

**Phased delivery**:
- Phase A (TASK-0197): Ship `backlog_activity` tool first - enables immediate use
- Phase B (TASK-0198): Add summary resource type + UI integration

**For this decision to be correct, the following must be true**:
- Users actually want AI-generated summaries (not just raw data)
- Summaries are valuable enough to persist (not throwaway)
- UI integration adds value over storing as regular resources

**Trade-offs Accepted**:
- More total work than Option 1
- UI complexity increases
- But: Delivers the full vision

## Consequences

**Positive**:
- Agents can query activity data programmatically
- Summaries persist as searchable history
- UI shows summaries contextually
- Foundation for weekly/monthly rollups, export

**Negative**:
- New resource type to maintain
- UI state management complexity
- Two-phase delivery means partial functionality initially

**Risks**:
- Users may not use AI summaries → Mitigated: tool still useful for programmatic access
- Summary storage grows unbounded → Mitigated: can add pruning later

## Implementation Notes

### Phase A: backlog_activity tool

```typescript
backlog_activity({
  period: "today" | "yesterday" | "week" | "month" | { from: string, to: string }
})
```

Returns:
```typescript
{
  period: { from: string, to: string },
  stats: { tasksCompleted, tasksCreated, tasksUpdated, epicsWorkedOn },
  journal: { completed, inProgress, created, updated },
  byEpic: { [epicId]: { title, completed, inProgress, created } }
}
```

### Phase B: Summary resources

Storage: `$BACKLOG_DATA_DIR/summaries/`
- Daily: `YYYY-MM-DD.md`
- Weekly: `YYYY-WNN.md`
- Monthly: `YYYY-MM.md`

Frontmatter:
```yaml
type: summary
period: day | week | month
date: YYYY-MM-DD
generated_at: ISO timestamp
generated_by: claude | manual
```

UI: Summary card at top of journal view when summary exists for displayed day.
