# Proposal 3: Centralized Navigation Router

<name>Centralized Navigation Router</name>
<approach>Replace the distributed event-based navigation with a single NavigationRouter service that owns all state transitions, resolves entity types, and coordinates URL, sidebar scope, and detail pane as a unified state machine.</approach>
<timehorizon>[LONG-TERM]</timehorizon>
<effort>[HIGH]</effort>

<differs>vs Proposal 1: Different ownership model — a single router owns all navigation state instead of components dispatching events that multiple listeners react to independently. vs Proposal 2: Different interface contract — components call `router.navigate(id)` or `router.scope(id)` instead of dispatching custom events; the router coordinates all side effects centrally.</differs>

## Design

### New Module: `viewer/services/navigation-router.ts`
A state machine that owns:
- `viewedId: string | null` — what's in the detail pane (synced to `?id=`)
- `scopeId: string | null` — sidebar container (synced to localStorage)
- `resolvedEntity: Task | null` — cached entity data for the viewed item

Methods:
- `navigate(id)` — sets viewedId, auto-resolves entity type, auto-scopes sidebar, pushes URL
- `scope(id)` — sets scopeId only, updates localStorage, no URL change
- `goHome()` — clears both
- `subscribe(listener)` — components subscribe to state changes

The router fetches entity data to determine type (container vs leaf) and parent, then coordinates all downstream updates in a single synchronous batch.

### Component Interface
Components no longer dispatch navigation events. They call the router directly:
```typescript
import { router } from '../services/navigation-router.js';
// In task-item click handler:
router.navigate(taskId);
// In arrow click handler:
router.scope(containerId);
// In breadcrumb click:
router.scope(containerId);
```

### State Flow
```
User action → router.navigate(id) → {
  1. Fetch entity if needed
  2. Determine type (container/leaf)
  3. Update URL (?id=)
  4. Update localStorage scope
  5. Notify subscribers (detail pane, sidebar, breadcrumb)
}
```

All side effects happen in one place. No event chains, no race conditions.

### url-state.ts
Simplified to a thin URL read/write utility. No longer the central state manager. The router owns the coordination.

## Evaluation

- **Product design**: Fully aligned — same UX as Proposal 2 but with stronger guarantees
- **UX design**: Same end-user experience, but transitions are atomic (no flash of inconsistent state)
- **Architecture**: Excellent — single source of truth, no distributed event coordination bugs
- **Backward compatibility**: Same redirect approach as Proposal 2
- **Performance**: Slightly better — single render cycle per navigation instead of cascading event handlers

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | Major refactor of navigation model, all components change interface |
| Risk | 2 | Large surface area change, new abstraction may have unforeseen edge cases |
| Testability | 5 | Router is a pure state machine, trivially unit-testable |
| Future flexibility | 5 | Adding new navigation behaviors (deep links, history, undo) is centralized |
| Operational complexity | 4 | Simpler mental model but more code to write initially |
| Blast radius | 2 | Every component's navigation code changes — if router breaks, everything breaks |

## Pros
- Single source of truth for all navigation state
- No distributed event coordination bugs
- Atomic state transitions (no intermediate inconsistent states)
- Easy to add features: history, undo, deep linking, analytics
- Highly testable state machine

## Cons
- Highest implementation effort
- Introduces a new architectural pattern (service-based vs event-based)
- Over-engineered for the current problem scope
- All components need interface changes (not just event name changes)
- Risk of the router becoming a god object
