# Decision: Unified URL State

## Pre-Decision Questions

### Which proposal would I REGRET not doing in 6 months?
Proposal 2. Proposal 1 is a band-aid that will need to be redone. Proposal 3 is over-engineered for a viewer that's still evolving — we'd be building a state machine for a problem that custom events handle fine. Proposal 2 solves the actual problem cleanly without over-abstracting.

### Argue FOR the most ambitious proposal (3)
If the router works, every future navigation feature (deep linking, history management, analytics, undo) becomes trivial to add. The state machine is perfectly testable. No more debugging event chains where listener A fires before listener B. It's the "right" architecture for a complex SPA.

### What's the REAL cost of playing it safe (Proposal 1)?
We'd ship a renamed version of the same broken model. Sidebar drilling still pollutes browser history. The `_scope` param is a code smell that signals "we know this shouldn't be here." We'd need to redo this work within weeks when the UX issues persist.

## Self-Critique

**Proposal 1**: Solves nothing. It's renaming, not fixing. The only value is backward compat redirect, which all proposals include.

**Proposal 2**: The auto-scoping logic (deriving sidebar scope from `?id=`) adds complexity. When `?id=` points to a leaf, we need to know its parent — but task-list already has `allTasks` loaded, so this is available synchronously. The real risk is the arrow vs click distinction in task-item: users need clear visual affordance. But the current `→` icon already exists and just needs to become a separate click target.

**Proposal 3**: Over-engineered. The viewer is a lightweight vanilla TS app — introducing a centralized router is bringing SPA framework patterns to a non-framework app. The event-based model works fine for the current complexity level. The router would be the only service with this pattern, creating inconsistency.

## Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 3 | 2 |
| Risk | 5 | 3 | 2 |
| Testability | 4 | 4 | 5 |
| Future flexibility | 2 | 5 | 5 |
| Operational complexity | 5 | 5 | 4 |
| Blast radius | 5 | 3 | 2 |
| **Total** | **26** | **23** | **20** |

P1 scores highest but doesn't solve the problem. P2 is the sweet spot — it solves the problem completely with acceptable risk. P3 is the best architecture but the cost/risk isn't justified for this scope.

## Decision

<selected>2</selected>
<selectedname>Dual-State Split</selectedname>

<rationale>Proposal 2 is the only option that actually solves the stated problem (separating navigation from browsing) while fitting the codebase's existing patterns (event-based, lightweight services). Proposal 1 is a rename that doesn't fix the UX issues. Proposal 3 introduces a new architectural pattern that's inconsistent with the rest of the viewer and over-engineered for the current scope. Proposal 2 adds one small service (SidebarScope), renames one event, and modifies the existing url-state — all within the established patterns.</rationale>

<assumptions>
1. localStorage is reliable enough for sidebar scope (it is — all modern browsers)
2. Task-list has access to allTasks for parent resolution (it does — already loaded)
3. The arrow icon in task-item can be made a separate click target without major CSS rework
4. Users won't miss browser back/forward for sidebar drilling (task spec says this is desired)
</assumptions>

<tradeoffs>
1. More files to change than Proposal 1 (9 files vs ~3)
2. Auto-scoping adds a small amount of logic to backlog-app
3. localStorage scope can become stale if a container is deleted (acceptable — scope resets to root)
4. Arrow vs click distinction requires clear visual design (the → icon already exists)
</tradeoffs>
