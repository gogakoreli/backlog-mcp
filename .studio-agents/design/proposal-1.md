# Proposal 1: Single Priority Field

<name>Single Priority Field (P1-P4)</name>
<approach>Add one `priority` field to Task that maps directly to Eisenhower quadrants: P1 (do now), P2 (schedule), P3 (delegate), P4 (park).</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>This proposal uses a single enum field instead of two independent axes. The quadrant IS the data — there's no computation. Simplest possible schema change.</differs>

## Design

### Schema Change
```typescript
export const PRIORITIES = ['p1', 'p2', 'p3', 'p4'] as const;
export type Priority = (typeof PRIORITIES)[number];

interface Task {
  // ... existing fields
  priority?: Priority; // p1=urgent+important, p2=important, p3=urgent, p4=neither
}
```

### Tool Changes
- `backlog_create`: Add optional `priority` param
- `backlog_update`: Add optional `priority` param (nullable to clear)
- `backlog_list`: Add `priority` filter, add `priority` sort option
- `backlog_search`: Include priority in results

### Viewer Changes
- Priority badge on task items (color-coded: red=P1, yellow=P2, blue=P3, gray=P4)
- Filter bar: add priority filter buttons (P1/P2/P3/P4)
- Sort option: "Priority" (P1 first)

### What It Doesn't Do
- No 2x2 matrix view
- No independent urgency/importance axes
- No AI suggestions
- No computed priority from signals

## Evaluation

### Product design
Partially aligned. Solves the "what should I work on" question but loses the Eisenhower insight of independent urgency × importance axes. Users can't ask "show me all urgent tasks regardless of importance."

### UX design
Simple and familiar — P1-P4 is a pattern users know from Todoist and other tools. Easy to understand. But the mapping (P1=urgent+important, P3=urgent+not-important) is non-obvious and must be memorized.

### Architecture
Minimal change. One optional field, one enum. Fits existing patterns perfectly (like `status` and `type`).

### Backward compatibility
Fully backward compatible. Field is optional, defaults to undefined (unset).

### Performance
Zero impact. One more field in YAML frontmatter.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~2 hours. Schema + tools + basic viewer badge. |
| Risk | 5 | Trivial change, optional field, no breaking changes. |
| Testability | 5 | Simple enum field — easy to test all values. |
| Future flexibility | 2 | Locked into 4 quadrants. Can't add granularity without migration. Can't query by urgency or importance independently. |
| Operational complexity | 5 | No new infrastructure. Just a field. |
| Blast radius | 5 | If it fails, nothing else breaks. Field is optional. |

## Pros
- Fastest to ship
- Simplest mental model for agents ("set priority to p1")
- No migration needed for existing tasks
- Familiar P1-P4 pattern

## Cons
- Loses the core Eisenhower insight: urgency and importance are independent axes
- Can't filter "all urgent tasks" or "all important tasks" independently
- P3 vs P4 distinction is confusing (what's "urgent but not important" in a personal backlog?)
- No path to AI-assisted prioritization (no numeric scores to compute from)
- Single dimension — can't evolve to RICE or other frameworks later
