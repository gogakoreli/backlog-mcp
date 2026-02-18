# Proposal 3: Computed Priority from Signals (No Manual Tagging)

<name>Signal-Derived Priority</name>
<approach>Instead of adding fields for users to fill in, compute urgency and importance scores automatically from existing task signals (blocking chains, age, epic alignment, status, keywords) and expose the computed quadrant as a read-only view.</approach>
<timehorizon>[ALTERNATIVE]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Different ownership model — priority is system-computed, not user-assigned. No new schema fields at all. vs Proposal 2: Different data-flow — instead of storing urgency/importance and computing quadrant, this computes everything at query time from existing data. No manual input required.</differs>

## Design

### No Schema Change
Zero new fields on Task. Priority is computed at query/display time from existing signals.

### Priority Computation Service
```typescript
interface PriorityScore {
  urgency: number;    // 0-10 computed
  importance: number; // 0-10 computed
  quadrant: Quadrant;
  signals: string[];  // explanations: ["blocks 3 tasks", "open 45 days", "under strategic epic"]
}

function computePriority(task: Task, allTasks: Task[]): PriorityScore {
  let urgency = 0, importance = 0;
  const signals: string[] = [];

  // Urgency signals
  if (task.status === 'blocked') { urgency += 2; signals.push('blocked'); }
  if (task.blocked_reason?.length) { urgency += 1; }
  const blockedByThis = allTasks.filter(t => t.blocked_reason?.some(r => r.includes(task.id)));
  if (blockedByThis.length > 0) { urgency += blockedByThis.length * 2; signals.push(`blocks ${blockedByThis.length} tasks`); }
  const ageDays = (Date.now() - new Date(task.created_at).getTime()) / 86400000;
  if (ageDays > 30) { urgency += 2; signals.push(`open ${Math.round(ageDays)} days`); }
  if (task.due_date) {
    const daysUntilDue = (new Date(task.due_date).getTime() - Date.now()) / 86400000;
    if (daysUntilDue < 7) { urgency += 3; signals.push(`due in ${Math.round(daysUntilDue)} days`); }
  }

  // Importance signals
  const refCount = allTasks.filter(t => t.references?.some(r => r.url.includes(task.id))).length;
  if (refCount > 2) { importance += refCount; signals.push(`referenced by ${refCount} tasks`); }
  if (task.type === 'epic') { importance += 3; signals.push('epic'); }
  // Keyword heuristics
  const text = (task.title + ' ' + (task.description ?? '')).toLowerCase();
  if (/\b(bug|fix|broken|crash|error|race condition|data loss)\b/.test(text)) {
    urgency += 2; importance += 2; signals.push('bug/fix keywords');
  }

  return {
    urgency: Math.min(urgency, 10),
    importance: Math.min(importance, 10),
    quadrant: deriveQuadrant(urgency, importance),
    signals,
  };
}
```

### Tool Changes
- `backlog_list`: Add `quadrant` filter and `priority` sort — computed on the fly
- Response includes computed `quadrant` and `signals` per task
- No changes to `backlog_create` or `backlog_update` — no new input fields

### Viewer Changes
- Same as Proposal 2: quadrant badges, filter buttons, priority sort
- Bonus: hover over badge shows signal explanations ("blocks 3 tasks, open 45 days")
- Matrix view possible but scores are less stable (change as tasks are updated)

## Evaluation

### Product design
Addresses the "what if manual tagging is too much friction" concern directly — zero friction because there's nothing to tag. But it removes human judgment from the equation. The user might disagree with the computed priority ("this task isn't actually urgent just because it's old").

### UX design
Zero-friction for input. But the computed scores may feel opaque or wrong. Users can't override the system's judgment without a manual override mechanism (which brings us back to Proposal 2). Signal explanations help transparency.

### Architecture
More complex than Proposals 1-2. Requires computing priority across all tasks (O(n²) for blocking chain analysis). Must be recomputed on every list/filter request or cached and invalidated on task changes. Adds a new service layer.

### Backward compatibility
Fully backward compatible — no schema changes at all.

### Performance
O(n²) worst case for blocking chain analysis on every list request. For hundreds of tasks this is fine (<50ms). For thousands, would need caching.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | ~2-3 days. Signal computation logic, testing heuristics, tuning weights. |
| Risk | 2 | High risk of "wrong" priorities. Heuristics are hard to get right. Users may disagree with computed scores. |
| Testability | 3 | Signal functions are testable, but "is this the right priority?" is subjective. Hard to write golden tests. |
| Future flexibility | 3 | Can add more signals, but can't incorporate human judgment without adding manual fields (converges to Proposal 2). |
| Operational complexity | 3 | Computation on every request. Needs caching strategy for large backlogs. |
| Blast radius | 4 | Read-only computation — if wrong, tasks still work. But wrong priorities could mislead agents. |

## Pros
- Zero friction — no manual tagging required
- Works immediately on existing tasks with no data entry
- Signal explanations provide transparency ("why is this Q1?")
- Addresses the "what if users don't tag" concern completely

## Cons
- Heuristics are fragile and opinionated — "old task" ≠ "urgent task"
- Users can't override computed priority without adding manual fields (converges to Proposal 2)
- O(n²) computation on every request
- Keyword matching is brittle ("fix" in "prefix" is a false positive)
- No way to express "this is important to ME" — importance is inferred, not stated
- The core user problem ("I work on interesting stuff instead of important stuff") requires HUMAN judgment about what's important — a heuristic can't know that
