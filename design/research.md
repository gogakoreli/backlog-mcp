# Research: Eliminate explicit batch() — automatic signal coalescing

## Task

TASK-0280: Can the signal system automatically coalesce updates without developer intervention, eliminating the need for explicit `batch()` calls?

## Current Architecture

### Dual scheduling model

The signal system (`viewer/framework/signal.ts`) already has **two** coalescing mechanisms:

1. **Microtask coalescing** (implicit, always active): When `batchDepth === 0`, each signal write calls `scheduleFlush()` which uses `queueMicrotask(flushPendingEffects)`. A `flushScheduled` flag ensures only one microtask is queued. Multiple synchronous writes → one effect run on the next microtask.

2. **Explicit `batch()`** (developer-invoked): Increments `batchDepth`, suppressing microtask scheduling. At the outermost `batch()` exit, `flushPendingEffects()` runs **synchronously**.

The critical difference: `batch()` provides **synchronous** flush semantics. Without it, effects run on the **next microtask**.

### Signal write → effect execution flow

```
signal.value = X
  → Object.is check (skip if same)
  → notifyObservers()
    → effect.notify()
      → pendingEffects.add(effect)
      → if batchDepth === 0: scheduleFlush() [queueMicrotask]
      → if batchDepth > 0: do nothing (batch will flush)
```

### Existing test proof

The test "batches multiple synchronous writes into one effect run" (signal.test.ts:267) proves microtask coalescing already works without `batch()`:
```typescript
a.value = 1; b.value = 2; c.value = 3;
flushEffects(); // just one re-run for all three
```

## Analysis of all 25 batch() call sites

### Pattern A: Atomic state transition (15 sites)

**SplitPaneState** — 5 sites (`openResource`, `openMcpResource`, `openActivity`, `close`, `setHeaderWithUris`):
Each method sets 6-8 signals representing a coherent pane state. Example:
```typescript
batch(() => {
  this.activePane.value = 'resource';
  this.resourcePath.value = path;
  this.mcpUri.value = null;
  // ...5 more signals
});
this.persist(path); // reads no signals, just writes localStorage
```
**Microtask-safe?** YES. `persist()` doesn't read signals. No code after batch() depends on effects having run.

**breadcrumb** — 1 site: Sets `scopeId` + `selectedTaskId` together.
**backlog-app** — 1 site: Sets `scopeId` + `selectedTaskId` together.
**Microtask-safe?** YES. No code after batch() reads effect results.

**app-state.selectTask** — 1 site: Sets `selectedTaskId` + derives scope.
**Microtask-safe?** YES. `deriveScope` writes to `scopeId` signal, which is another synchronous write that coalesces.

**activity-panel.setMode** — 1 site: Sets `mode` + `expandedOpId`.
**Microtask-safe?** YES.

### Pattern B: Async result grouping (4 sites)

**resource-viewer** — 4 sites: After `await fetch()`, sets `data` + `loadState` or `errorMessage` + `loadState`.
```typescript
batch(() => {
  data.value = json;
  loadState.value = 'loaded';
});
```
**Microtask-safe?** YES. These are in async callbacks. No synchronous code after batch() depends on effects.

### Pattern C: URL ↔ signal sync (1 site) ⚠️

**url-state.readUrl** — 1 site:
```typescript
this.pushing = true;
batch(() => {
  this.filter.value = params.get('filter') || 'active';
  this.type.value = params.get('type') || 'all';
  this.id.value = params.get('id');
  this.q.value = params.get('q');
});
this.pushing = false;
```

The effect that syncs signals → URL checks `this.pushing`:
```typescript
effect(() => {
  const f = this.filter.value;
  // ...read all signals...
  if (this.pushing) return;
  this.pushUrl(f, t, id, q);
});
```

**Microtask-safe?** CONDITIONALLY. Without batch(), the effect runs on microtask when `this.pushing` is already `false`. However, `pushUrl` has a guard: `if (url.href !== window.location.href)` — since we just read FROM the URL, the values match, making it a no-op. But the `pushing` flag exists to avoid even this comparison. This site needs refactoring (e.g., use `untrack()` instead of a flag).

### Pattern D: Test infrastructure (7 sites)

**signal.test.ts** — 7 sites: Testing batch() behavior itself.
**invariants.test.ts** — 2 sites: Testing batch nesting invariant.
**Microtask-safe?** N/A — these test batch() itself and would be removed/updated.

### Summary

| Pattern | Sites | Microtask-safe? | Action needed |
|---------|-------|-----------------|---------------|
| A: Atomic state transition | 15 | ✅ Yes | Remove batch() wrapper |
| B: Async result grouping | 4 | ✅ Yes | Remove batch() wrapper |
| C: URL sync timing | 1 | ⚠️ Needs refactor | Replace `pushing` flag with `untrack()` |
| D: Tests | 9 | N/A | Update/remove tests |

**22 of 25 sites can drop batch() with zero behavior change.** Only url-state needs a small refactor.

## External research: How other frameworks handle this

### TC39 Signals Proposal

The TC39 proposal explicitly does NOT include `batch()` or `effect()`. Key design decisions:
- Writes are synchronous and immediately reflected
- `Watcher.notify()` runs synchronously during `.set()` but CANNOT read/write signals
- Effect scheduling is left entirely to frameworks
- The example `effect()` implementation uses `queueMicrotask`
- No built-in batching — laziness of computed signals provides natural coalescing

The proposal's FAQ states: "Writes to state Signals are reflected immediately... However, the laziness inherent in this mechanism means that, in practice, the calculations may happen in a batched way."

### Preact Signals

Preact Signals use automatic batching internally. Signal writes within the same synchronous block are coalesced. No explicit `batch()` is needed for normal usage. Effects are scheduled automatically via microtask.

### SolidJS

SolidJS has `batch()` but effects are already batched by default. `createEffect` runs after the current synchronous execution completes. The `batch()` function exists for cases where you need to ensure multiple writes are seen as atomic by synchronous reads of derived values.

### Angular Signals

Angular's `effect()` runs in a microtask by default (via `Zone.js` or the newer zoneless approach). No explicit batch needed. The framework handles scheduling.

### Common pattern across frameworks

All modern signal frameworks converge on: **writes are synchronous, effect execution is deferred**. The only question is the deferral mechanism (microtask, requestAnimationFrame, framework-specific scheduler).

## Framework constraints (ADR 0001)

Relevant constraints:
- "No runtime scheduler" — but microtask-based coalescing is already in use and accepted
- "No virtual DOM" — not relevant to this change
- Synchronous read-after-write semantics — MUST be preserved (computed values must reflect writes immediately when read)

The ADR 0001 constraint about "no runtime scheduler" was written to prevent React-style fiber/concurrent mode scheduling. `queueMicrotask` is a single deferred flush, not a scheduler. It's already used in the codebase and accepted.

## Key files examined

- `viewer/framework/signal.ts` — current batch/effect implementation (280 lines)
- `viewer/framework/signal.test.ts` — batch tests (9 test cases)
- `viewer/framework/invariants.test.ts` — batch nesting invariant test
- `viewer/services/split-pane-state.ts` — 5 batch() sites (atomic state transitions)
- `viewer/services/url-state.ts` — 1 batch() site (URL sync timing, needs refactor)
- `viewer/services/app-state.ts` — 1 batch() site (coordinated update)
- `viewer/components/resource-viewer.ts` — 4 batch() sites (async results)
- `viewer/components/activity-panel.ts` — 1 batch() site (mode switch)
- `viewer/components/breadcrumb.ts` — 1 batch() site (navigation)
- `viewer/components/backlog-app.ts` — 1 batch() site (navigation)
- `docs/framework-adr/0001-web-component-framework.md` — framework constraints
- `docs/framework-adr/0002-implementation-notes.md` — implementation invariants

<insight>The system already does automatic coalescing via microtask scheduling. batch() is redundant for 22 of 25 call sites. The only site that depends on synchronous flush timing (url-state) can be refactored to use untrack(). The real question isn't "how to add automatic coalescing" — it's "how to safely remove the synchronous flush that batch() provides."</insight>
