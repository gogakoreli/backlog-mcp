# Proposal 3: Watcher-based effect scheduling (TC39-aligned)

<name>Watcher-based lazy effects with framework-controlled scheduling</name>
<approach>Restructure the effect system to separate "dirty notification" from "effect execution" using a Watcher pattern aligned with the TC39 Signals proposal, making effects demand-driven rather than automatically scheduled.</approach>
<timehorizon>[LONG-TERM]</timehorizon>
<effort>[HIGH]</effort>

## Core idea

Proposals 1 and 2 both keep the current data flow: signal write → notify → schedule effect on microtask. The effect system owns its own scheduling. This proposal inverts that ownership: effects don't schedule themselves. Instead, a **Watcher** receives dirty notifications and the **framework** (component/template layer) decides when to execute effects.

This is the model the TC39 Signals proposal uses. The `Watcher.notify()` callback runs synchronously during `.set()` but cannot read/write signals — it just records that something changed. The framework then decides when to actually run effects (microtask, rAF, after all event handlers, etc.).

### Architecture change

```
CURRENT (effect owns scheduling):
  signal.set() → notify() → pendingEffects.add() → scheduleFlush()
  microtask → flushPendingEffects() → runEffect()

PROPOSED (framework owns scheduling):
  signal.set() → notify() → watcher.onDirty() [sync, no reads/writes]
  framework decides → watcher.flush() → runEffect()
```

### New primitives

```typescript
// signal.ts — effects no longer self-schedule
interface EffectNode extends ReactiveNode {
  // ... same as today, but notify() does NOT call scheduleFlush()
  notify() {
    this.state = NodeState.Dirty;
    // Instead of scheduling, notify the watcher
    effectWatcher.markDirty(this);
  }
}

// watcher.ts — new module, ~40 lines
export class EffectWatcher {
  private dirty = new Set<EffectNode>();
  private scheduled = false;
  private onNotify: () => void;

  constructor(onNotify: () => void) {
    this.onNotify = onNotify;
  }

  markDirty(effect: EffectNode) {
    this.dirty.add(effect);
    if (!this.scheduled) {
      this.scheduled = true;
      this.onNotify(); // framework decides what to do
    }
  }

  flush() {
    this.scheduled = false;
    const effects = [...this.dirty];
    this.dirty.clear();
    for (const effect of effects) {
      if (!effect.disposed) runEffect(effect);
    }
  }

  get hasPending(): boolean {
    return this.dirty.size > 0;
  }
}

// Default watcher uses microtask (same behavior as today)
export const defaultWatcher = new EffectWatcher(() => {
  queueMicrotask(() => defaultWatcher.flush());
});
```

### Framework integration

```typescript
// component.ts — components can use custom scheduling
component('task-list', (props) => {
  // Effects created in this setup use the component's watcher
  // which flushes on requestAnimationFrame for batched DOM updates
  // ...
});

// For non-component effects (services, standalone):
// Default watcher uses microtask (identical to current behavior)
```

### What this enables

1. **No batch() needed**: The watcher naturally coalesces — `markDirty()` is called N times, `flush()` runs once.
2. **Framework-controlled timing**: Components could flush on rAF for visual updates, services flush on microtask for data updates.
3. **TC39 alignment**: When native Signals ship, the Watcher maps directly to `Signal.subtle.Watcher`.
4. **Testability**: `watcher.flush()` replaces both `batch()` and `flushEffects()` with one concept.

### Migration

```typescript
// Before: batch() for coalescing
batch(() => {
  this.activePane.value = 'resource';
  this.resourcePath.value = path;
});

// After: just write signals. Watcher handles coalescing.
this.activePane.value = 'resource';
this.resourcePath.value = path;
// Effects run when the watcher flushes (microtask by default)

// For tests:
defaultWatcher.flush(); // replaces flushEffects()
```

<differs>vs Proposal 1: Proposal 1 removes batch() but keeps the same data flow (effects self-schedule via microtask). This proposal changes the ownership model — effects don't schedule themselves, a Watcher mediates between dirty notification and execution. vs Proposal 2: Proposal 2 adds flush() as an escape hatch on the existing system. This proposal restructures the effect system around a Watcher that IS the scheduling mechanism, making flush() a method on the watcher rather than a global function.</differs>

## Evaluation

### Product design
Strong alignment with the framework's long-term vision. ADR 0001 mentions "enable JS frameworks to do their own scheduling" as a design principle. The Watcher pattern makes scheduling explicit and controllable. Also positions the framework for TC39 Signals interop.

### UX design (developer experience)
For component authors: identical to Proposal 1 — just write signals, effects run automatically. The Watcher is invisible to most developers.

For framework maintainers: more powerful — can customize scheduling per context (microtask for services, rAF for DOM updates, synchronous for tests).

### Architecture
The cleanest separation of concerns:
- **signal.ts**: Pure reactive graph (no scheduling)
- **watcher.ts**: Scheduling policy (pluggable)
- **component.ts**: Framework-specific scheduling decisions

This matches the TC39 proposal's architecture where `Signal.State` and `Signal.Computed` are pure, and `Signal.subtle.Watcher` handles the scheduling bridge.

### Backward compatibility
**Breaking change**: `batch()` removed. `flushEffects()` replaced by `defaultWatcher.flush()` (or aliased for backward compat). Effect creation API unchanged — `effect()` still works the same way from the developer's perspective.

### Performance implications
- **Slightly better**: One fewer branch per notify() (no batchDepth check)
- **Potentially better for DOM**: If components use rAF-based watcher, DOM updates batch across multiple signal changes within a frame
- **Slightly more memory**: One Watcher object per scheduling context (negligible — likely just 1-2 watchers total)
- **~40 lines added** for watcher.ts, ~15 lines removed from signal.ts (batch code)

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | ~1-2 days: new watcher module, refactor effect scheduling, update all tests, update component integration |
| Risk | 3 | Restructuring effect scheduling touches the most critical code path. Thorough testing required |
| Testability | 5 | Watcher.flush() is the single test primitive. No microtask awaiting needed. Cleaner than current flushEffects() |
| Future flexibility | 5 | TC39-aligned. Custom scheduling per context. Foundation for rAF-based DOM batching |
| Operational complexity | 4 | One new module (watcher.ts, ~40 lines). But the scheduling model is more explicit and easier to reason about |
| Blast radius | 3 | Changes the core effect execution path. If watcher has a bug, all effects are affected |

**Total: 22/30**

## Pros

- Cleanest architectural separation (reactive graph vs scheduling policy)
- TC39 Signals alignment — positions for future native interop
- Enables per-context scheduling (microtask for services, rAF for DOM)
- Single test primitive (`watcher.flush()`) replaces both `batch()` and `flushEffects()`
- No batch(), no flush() — scheduling is the watcher's job, not the developer's

## Cons

- Highest implementation effort and risk — touches the core effect execution path
- Over-engineered for the immediate problem (removing 25 batch() calls)
- Introduces a new concept (Watcher) that framework maintainers must understand
- rAF-based scheduling for components is speculative — no proven need yet
- The current codebase has ~16 components; the scheduling flexibility may never be needed
- TC39 Signals proposal is still Stage 1 — the API may change significantly
