# 0084. Eisenhower Matrix: Two-Axis Priority Model

**Date**: 2026-02-17
**Status**: Proposed
**Backlog Item**: (to be created)

## Context

backlog-mcp has no concept of task priority. All tasks are equal — the only ordering is by recency (updated_at or created_at). When a user or agent asks "what should I work on next?", the system can only list tasks chronologically. It cannot distinguish between a critical bug causing data loss and a nice-to-have UI polish task.

The user identified a specific productivity anti-pattern: gravitating toward intellectually stimulating work while procrastinating on high-impact work. The system makes this invisible — there's no signal that says "you're working on the wrong thing."

The Eisenhower Matrix is the simplest effective prioritization framework: two independent axes (urgency × importance) producing four quadrants (Do Now, Schedule, Delegate, Park).

## Decision

Add two independent numeric fields to the Task schema: `urgency` (1-5) and `importance` (1-5). Derive the Eisenhower quadrant at query time from these values.

### Schema

```typescript
interface Task {
  // ... existing fields
  urgency?: number;    // 1=no time pressure, 5=critical/blocking/deadline
  importance?: number; // 1=nice-to-have, 5=directly impacts goals/results
}
```

### Quadrant Computation

```typescript
type Quadrant = 'q1' | 'q2' | 'q3' | 'q4';

function getQuadrant(urgency: number, importance: number): Quadrant {
  const urgent = urgency >= 3;
  const important = importance >= 3;
  if (urgent && important) return 'q1';   // Do now
  if (!urgent && important) return 'q2';  // Schedule
  if (urgent && !important) return 'q3';  // Quick-handle
  return 'q4';                             // Park
}
```

### Priority Score (for sorting)

```typescript
function getPriorityScore(urgency: number, importance: number): number {
  return urgency + importance; // Higher = do first
}
```

### Tool Integration

- `backlog_create` / `backlog_update`: Accept optional `urgency` (1-5) and `importance` (1-5)
- `backlog_list`: Add `quadrant` filter (q1/q2/q3/q4) and `priority` sort option
- Tool descriptions include diagnostic questions to guide consistent scoring

### Viewer Integration

- Quadrant badge on task items (color-coded)
- Quadrant filter buttons in filter bar
- Priority sort option in sort dropdown

## Alternatives Considered

### 1. Single Priority Field (P1-P4)
One enum field mapping directly to quadrants. Simplest possible change but loses the core Eisenhower insight: urgency and importance are independent axes. Can't query "all urgent tasks" or "all important tasks" independently. No path to numeric AI scoring. Rejected for lack of future flexibility.

### 2. Signal-Derived Priority (No Manual Tagging)
Compute urgency/importance from existing signals (blocking chains, age, keywords). Zero friction but removes human judgment. The core problem ("I work on interesting stuff instead of important stuff") requires human judgment about what's important — heuristics can't know that. Rejected as primary approach but valuable as a future suggestion layer.

## Consequences

### Positive
- Users and agents can express and query priority on two independent axes
- Computed quadrant provides the Eisenhower Matrix view without storing redundant data
- Numeric fields enable future AI-assisted scoring
- Threshold (>=3) can be tuned without data migration
- Fully backward compatible — both fields are optional

### Negative
- More friction than a single field — two values to set per task
- The 1-5 scale requires clear anchor descriptions for consistency
- The >=3 threshold is somewhat arbitrary
- No auto-prioritization in v1 — manual tagging only

### Risks
- If users/agents don't tag tasks, the feature provides no value. Mitigated by: clear tool descriptions, optional fields, and future signal-based suggestions.
