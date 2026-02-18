# Proposal 2: Two-Axis Priority Model

<name>Two-Axis Urgency × Importance</name>
<approach>Add two independent numeric fields (`urgency: 1-5`, `importance: 1-5`) to Task, with a computed quadrant derived from thresholds, enabling independent filtering on each axis and a 2x2 matrix view.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Different data model (two independent numeric fields vs one enum), different data-flow (quadrant is computed at query time, not stored), different interface contract (agents set urgency and importance separately, enabling richer queries like "show all urgent tasks" regardless of importance).</differs>

## Design

### Schema Change
```typescript
interface Task {
  // ... existing fields
  urgency?: number;    // 1 (low) to 5 (critical). Undefined = unset.
  importance?: number; // 1 (low) to 5 (critical). Undefined = unset.
}
```

Quadrant is computed, not stored:
```typescript
type Quadrant = 'q1' | 'q2' | 'q3' | 'q4' | null;

function getQuadrant(task: Task): Quadrant {
  if (task.urgency == null || task.importance == null) return null;
  const urgent = task.urgency >= 3;
  const important = task.importance >= 3;
  if (urgent && important) return 'q1';   // Do now
  if (!urgent && important) return 'q2';  // Schedule
  if (urgent && !important) return 'q3';  // Delegate/quick-handle
  return 'q4';                             // Park/drop
}
```

Priority score for sorting (higher = do first):
```typescript
function getPriorityScore(task: Task): number {
  const u = task.urgency ?? 0;
  const i = task.importance ?? 0;
  return u + i; // Simple sum. Q1 tasks (high both) sort first.
}
```

### Tool Changes

**backlog_create**: Add optional `urgency` (1-5) and `importance` (1-5)
**backlog_update**: Add optional `urgency` and `importance` (nullable to clear)
**backlog_list**: 
  - Add `quadrant` filter (q1/q2/q3/q4)
  - Add `priority` sort option (sorts by urgency+importance descending)
  - Response includes `quadrant` field on each task
**backlog_context**: Include quadrant in task context output

### Viewer Changes

**Task badges**: Color-coded quadrant indicator (🔴 Q1, 🟡 Q2, 🔵 Q3, ⚪ Q4)
**Filter bar**: Add quadrant filter buttons (Q1/Q2/Q3/Q4 or "Do Now"/"Schedule"/"Delegate"/"Park")
**Sort dropdown**: Add "Priority" option
**Task detail**: Show urgency and importance as small indicators in metadata
**Matrix view** (stretch): A 2x2 grid view where tasks are placed by their urgency/importance coordinates

### Agent Tool Description Enhancement
```
urgency: 1-5 scale. 1=no time pressure, 5=critical/blocking/deadline imminent.
  Ask: "If this doesn't get done this week, what breaks?"
importance: 1-5 scale. 1=nice-to-have, 5=directly impacts goals/team/evaluation.
  Ask: "Does this materially affect goals or results?"
```

## Evaluation

### Product design
Strongly aligned. Preserves the core Eisenhower insight: urgency and importance are independent dimensions. Users can ask "show me all important tasks" or "show me all urgent tasks" — queries impossible with a single priority field. The numeric scale (1-5) also enables future AI scoring.

### UX design
Slightly more complex than P1-P4 — users must set two values instead of one. But the payoff is richer: the matrix view makes priority relationships visible at a glance. The quadrant labels ("Do Now", "Schedule", "Delegate", "Park") are intuitive. Agent tool descriptions include the diagnostic questions ("If this doesn't get done, what breaks?") to guide consistent scoring.

### Architecture
Clean separation: data (urgency/importance) vs computation (quadrant/priority score) vs presentation (badges/matrix). The quadrant function is pure — easy to test, easy to change thresholds later. No new services or infrastructure.

### Backward compatibility
Fully backward compatible. Both fields are optional. Tasks without urgency/importance have `quadrant: null` and sort last in priority ordering.

### Performance
Negligible. Two more numbers in YAML frontmatter. Quadrant computation is O(1) per task.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | ~1 day. Schema + tools + viewer badges + filter + sort. Matrix view is stretch. |
| Risk | 4 | Low risk — optional fields, no breaking changes. Minor risk: threshold (>=3) might not feel right for all users. |
| Testability | 5 | Pure functions for quadrant/priority. Easy to test all combinations. |
| Future flexibility | 5 | Numeric fields enable AI scoring, custom thresholds, RICE-like extensions. Two axes can evolve independently. |
| Operational complexity | 5 | No new infrastructure. Just fields + computation. |
| Blast radius | 5 | Optional fields. If broken, tasks still work without priority. |

## Pros
- Preserves the Eisenhower insight: independent urgency × importance axes
- Enables queries impossible with single field ("all urgent tasks", "all important tasks")
- Numeric scores enable future AI-assisted prioritization
- Computed quadrant means the threshold can be tuned without data migration
- Natural path to matrix view in viewer
- Agent descriptions include diagnostic questions for consistent scoring

## Cons
- More complex than P1-P4 — two fields to set instead of one
- Threshold choice (>=3 = high) is somewhat arbitrary
- Without a matrix view, the two-axis model is harder to visualize than a simple P1-P4 list
- Agents must understand two dimensions, not one
