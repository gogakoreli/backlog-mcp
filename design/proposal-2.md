# Proposal 2: Transaction-based auto-coalescing with explicit flush()

<name>Implicit transactions with flush() escape hatch</name>
<approach>Replace batch() with automatic transaction detection — every signal write implicitly starts a transaction that auto-commits on microtask — plus a public flush() API for the rare cases needing synchronous effect execution.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

## Core idea

Instead of removing coalescing control entirely (Proposal 1), restructure the interface contract. The system automatically coalesces all writes within a synchronous block (same as today's microtask behavior), but provides `flush()` as a first-class public API for synchronous effect execution when needed.

The key structural difference: `batch()` is a **wrapping** API (you wrap code in it). `flush()` is a **point** API (you call it when you want effects to run). This changes the ownership model — the caller decides when to flush, not where to batch.

### Changes to signal.ts

```typescript
// REMOVE: batch(), batchDepth

// ADD: flush() as a public API (not just test utility)
/**
 * Synchronously execute all pending effects.
 * Use sparingly — microtask coalescing handles 99% of cases.
 * Typical use: imperative DOM operations that need effects to have run.
 */
export function flush(): void {
  flushPendingEffects();
}

// KEEP: flushEffects() as alias for backward compat in tests
export { flush as flushEffects };
```

### Changes to notify()

```typescript
notify() {
  if (this.disposed) return;
  this.state = NodeState.Dirty;
  pendingEffects.add(this);
  scheduleFlush(); // Always schedule microtask, no batchDepth check
}
```

### Migration pattern

```typescript
// Before: batch() wrapping
batch(() => {
  this.activePane.value = 'resource';
  this.resourcePath.value = path;
  this.mcpUri.value = null;
});

// After: just write signals (microtask handles coalescing)
this.activePane.value = 'resource';
this.resourcePath.value = path;
this.mcpUri.value = null;

// Rare case: need effects to have run before next line
this.activePane.value = 'resource';
this.resourcePath.value = path;
flush(); // effects run NOW
// DOM is updated, safe to read layout
```

### url-state refactor

```typescript
// Before: pushing flag + batch
private readUrl() {
  this.pushing = true;
  batch(() => {
    this.filter.value = params.get('filter') || 'active';
    this.type.value = params.get('type') || 'all';
    this.id.value = params.get('id');
    this.q.value = params.get('q');
  });
  this.pushing = false;
}

// After: remove pushing flag, rely on pushUrl guard
private readUrl() {
  this.filter.value = params.get('filter') || 'active';
  this.type.value = params.get('type') || 'all';
  this.id.value = params.get('id');
  this.q.value = params.get('q');
  // Effect runs on microtask. pushUrl's url.href guard prevents echo.
}
```

<differs>vs Proposal 1: Proposal 1 removes ALL explicit coalescing control. This proposal changes the interface contract from wrapping (batch) to point-in-time (flush), preserving the ability to force synchronous effect execution. Different interface contract and different ownership model — the caller controls timing explicitly rather than implicitly.</differs>

## Evaluation

### Product design
Aligns with "hard to write wrong" — the default (microtask) is always correct. `flush()` is an explicit opt-in for advanced cases, similar to `untrack()` being an explicit opt-in for observer isolation.

### UX design (developer experience)
Better than batch() — no wrapping callback needed. `flush()` is self-documenting: "run pending effects now." The mental model is: "writes coalesce automatically; call flush() if you need effects to have run."

### Architecture
Cleaner than current dual model. Removes `batchDepth` counter and nested batch tracking. `flush()` is a simple "drain the queue" operation, not a state machine transition.

The key architectural improvement: `flush()` is idempotent and stateless. Calling it when no effects are pending is a no-op. Calling it multiple times is safe. `batch()` has nesting semantics that `flush()` doesn't need.

### Backward compatibility
**Breaking change**: `batch()` is removed. But `flush()` provides a migration path for any code that genuinely needed synchronous flush:
```typescript
// batch(() => { a.value = 1; b.value = 2; });
// becomes:
a.value = 1; b.value = 2; flush();
```

### Performance implications
- Same as Proposal 1 for the common case (microtask coalescing)
- `flush()` is synchronous when called, same cost as batch()'s flush
- No new overhead — `flush()` is just `flushPendingEffects()` made public

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | ~2 hours: remove batch, add flush export, update 25 sites, update docs |
| Risk | 5 | Lower risk than Proposal 1 because flush() provides an escape hatch for unforeseen timing needs |
| Testability | 5 | flush() IS flushEffects() — tests work identically. No new test patterns needed |
| Future flexibility | 5 | flush() handles any future need for synchronous effects without reintroducing batch() |
| Operational complexity | 5 | Less code than current. flush() is simpler than batch() (no nesting, no depth counter) |
| Blast radius | 4 | Same as Proposal 1 — compile-time errors for batch() callers, no silent failures |

**Total: 28/30**

## Pros

- Removes batch() ceremony from 25 call sites
- Preserves synchronous flush capability via simpler API
- `flush()` is idempotent, stateless, and self-documenting
- No nesting semantics to reason about
- Natural migration path: `batch(() => { ...writes... })` → `...writes...; flush()`
- Aligns with TC39 model (framework controls scheduling, provides flush mechanism)

## Cons

- `flush()` is still a manual API — developers must know when to use it
- Risk of `flush()` proliferation (developers using it "just in case", recreating the batch() problem)
- Slightly more API surface than Proposal 1 (flush is public, not just test utility)
- The name `flush()` could be confused with DOM flushing or stream flushing
