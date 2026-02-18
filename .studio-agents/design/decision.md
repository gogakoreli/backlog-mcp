# Decision: Eisenhower Matrix Feature

## Pre-Decision Questions

### Which proposal would I REGRET not doing in 6 months?
Proposal 2 (Two-Axis). In 6 months, if I shipped P1-P4 (Proposal 1), I'd be frustrated that I can't query "show me all urgent tasks" or "show me all important tasks" independently. I'd want to add AI-assisted scoring but have no numeric fields to compute from. I'd want a matrix view but have no axes to plot on. The single enum is a dead end.

### Argue FOR the most ambitious proposal (Proposal 3)
If signal-derived priority worked perfectly, it would be magical: zero friction, instant value on existing tasks, and the system would genuinely tell you "you're working on the wrong thing" without you lifting a finger. The dream of an AI-powered work advisor starts here.

### What's the REAL cost of playing it safe?
Proposal 1 ships in 2 hours but creates technical debt immediately. The P1-P4 enum can't evolve. When we want AI scoring, matrix views, or independent axis queries, we'd need to migrate to two fields anyway. The "safe" choice costs a migration later.

## Self-Critique

### Proposal 2 flaws I need to be honest about
- **Two fields IS more friction than one.** Every time an agent creates a task, it now has two optional fields to consider. Most won't bother unless the tool description is very clear.
- **The threshold (>=3) is arbitrary.** Why not >=2? Why not a continuous gradient instead of hard quadrant boundaries? This will feel wrong for edge cases (urgency=3, importance=2 → Q3 "delegate" — but is that really right?).
- **The 1-5 scale is ambiguous.** What's the difference between urgency 3 and urgency 4? Without clear anchors, different agents will score differently.

### Proposal 3 — why I'm NOT choosing it despite its appeal
The core user problem is "I work on interesting stuff instead of important stuff." This requires HUMAN judgment about what's important. A heuristic that says "this task is important because it's referenced by 5 other tasks" might be wrong — maybe those 5 tasks are all Q4 themselves. Importance is fundamentally subjective. You can't compute it from signals alone.

However, Proposal 3's signal computation is valuable as a SUGGESTION mechanism layered on top of Proposal 2 in the future.

## Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 3 | 2 |
| Risk | 5 | 4 | 2 |
| Testability | 5 | 5 | 3 |
| Future flexibility | 2 | **5** | 3 |
| Operational complexity | 5 | 5 | 3 |
| Blast radius | 5 | 5 | 4 |
| **Total** | **27** | **27** | **17** |

P1 and P2 tie on total score, but P2 wins decisively on future flexibility (5 vs 2) — the most important anchor for a feature that will evolve. P1's advantage is only time-to-ship (5 vs 3), which is a one-time cost.

## Decision

<selected>2</selected>
<selectedname>Two-Axis Urgency × Importance</selectedname>

<rationale>
Proposal 2 wins because:
1. **Preserves the Eisenhower insight** — urgency and importance are independent axes, enabling queries and views impossible with a single field
2. **Future-proof** — numeric fields enable AI scoring, custom thresholds, and evolution to richer frameworks
3. **Right complexity** — more complex than P1 but the complexity buys real capability; less complex than P3 which tries to solve a problem (human judgment) that can't be automated
4. **The extra effort is small** — ~1 day vs ~2 hours. The delta is trivial compared to the capability gained.
5. **Addresses the core problem** — the user needs to SEE that they're working on Q4 when Q1 tasks exist. Two axes + quadrant badges + filter make this visible.
</rationale>

<assumptions>
For this decision to be correct:
1. Users/agents will actually set urgency and importance on at least some tasks (if nobody tags, the feature is dead weight)
2. The 1-5 scale with clear anchor descriptions will produce consistent enough scoring across agents
3. The >=3 threshold for "high" is reasonable (can be tuned later without migration)
4. A matrix view in the viewer is achievable with the current web component framework
</assumptions>

<tradeoffs>
1. More friction than P1 — two fields to set instead of one. Mitigated by: clear tool descriptions with diagnostic questions, optional fields with sensible defaults.
2. More implementation effort than P1 — ~1 day vs ~2 hours. Acceptable for the capability gained.
3. Threshold is arbitrary — >=3 might not feel right. Mitigated by: computed at query time, can change without data migration.
4. No auto-prioritization in v1 — users must manually tag. Mitigated by: Proposal 3's signal computation can be added as a suggestion layer in v2.
</tradeoffs>
