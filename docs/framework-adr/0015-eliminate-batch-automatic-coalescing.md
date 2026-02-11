# 0015. Eliminate explicit batch() — automatic signal coalescing

**Date**: 2026-02-11
**Status**: Proposed
**Backlog Item**: TASK-0280

## Context

The signal system (`viewer/framework/signal.ts`) has a dual scheduling model:

1. **Microtask coalescing** (implicit): When `batchDepth === 0`, signal writes schedule effect execution via `queueMicrotask`. Multiple synchronous writes coalesce into one effect run.
2. **Explicit `batch()`**: Wraps a block of writes and flushes effects synchronously at the outermost `batch()` exit.

There are 25 `batch()` call sites across 8 files (split-pane-state, resource-viewer, activity-panel, breadcrumb, backlog-app, app-state, url-state, plus tests). Analysis of all 25 sites reveals:

- **22 sites** use `batch()` defensively — microtask coalescing already handles them correctly. No code after the `batch()` call depends on effects having run.
- **1 site** (url-state) uses `batch()` for synchronous flush timing, but has a redundant guard (`pushUrl` compares `url.href !== window.location.href`) that makes the timing dependency unnecessary.
- **9 sites** are tests that test `batch()` behavior itself.

`batch()` conflates two concerns: (1) coalescing multiple writes into one effect run, and (2) controlling WHEN effects execute. Concern #1 is already handled by microtask scheduling. Concern #2 is needed in 0 of 25 production call sites.

## Decision

Remove `batch()` from the public API. Replace it with `flush()` — a simpler, point-in-time API for synchronous effect execution.

### What changes

1. **Remove from signal.ts**: `batch()` function, `batchDepth` counter, and the `if (batchDepth === 0)` branch in `notify()`.
2. **Add to signal.ts**: `flush()` as a public export (rename existing `flushEffects()` test utility).
3. **Remove from 25 call sites**: Unwrap `batch(() => { ... })` to plain signal writes.
4. **Refactor url-state.ts**: Remove `pushing` flag. The `pushUrl` URL comparison guard prevents echo writes.
5. **Update tests**: Remove batch-specific tests. Add explicit "microtask coalescing without batch" tests.
6. **Update ADR 0002**: Remove batch invariant (invariant 5). Update effect scheduling documentation.

### What stays the same

- Microtask coalescing behavior (already works, unchanged)
- `flushEffects()` as a test utility (aliased to `flush()`)
- Synchronous read-after-write for computed signals (pull semantics, unaffected)
- Effect loop detection (`MAX_EFFECT_RERUNS` / `LOOP_WINDOW_MS`)

### New API

```typescript
/**
 * Synchronously execute all pending effects.
 *
 * In normal usage, effects run automatically on the next microtask.
 * Use flush() only when you need effects to have executed before
 * the next line — e.g., imperative DOM measurement after state change.
 *
 * flush() is idempotent: calling it with no pending effects is a no-op.
 */
export function flush(): void {
  flushPendingEffects();
}

// Backward compat alias for tests
export { flush as flushEffects };
```

### Migration examples

```typescript
// Pattern A: Atomic state transition (15 sites)
// Before:
batch(() => {
  this.activePane.value = 'resource';
  this.resourcePath.value = path;
  this.mcpUri.value = null;
});
this.persist(path);

// After:
this.activePane.value = 'resource';
this.resourcePath.value = path;
this.mcpUri.value = null;
this.persist(path);

// Pattern B: Async result grouping (4 sites)
// Before:
batch(() => { data.value = json; loadState.value = 'loaded'; });

// After:
data.value = json;
loadState.value = 'loaded';

// Pattern C: URL sync (1 site)
// Before:
this.pushing = true;
batch(() => {
  this.filter.value = params.get('filter') || 'active';
  this.type.value = params.get('type') || 'all';
  this.id.value = params.get('id');
  this.q.value = params.get('q');
});
this.pushing = false;

// After:
this.filter.value = params.get('filter') || 'active';
this.type.value = params.get('type') || 'all';
this.id.value = params.get('id');
this.q.value = params.get('q');
// pushing flag removed — pushUrl's URL comparison guard prevents echo
```

## Alternatives considered

### Alternative 1: Remove batch() entirely, no flush()

Remove `batch()` and keep `flushEffects()` as a test-only utility. No public API for synchronous effect execution.

**Rejected because**: If a future pattern genuinely needs synchronous effects (imperative focus management, DOM measurement after state change), there would be no public API for it. Making `flush()` public costs nothing and prevents this scenario.

### Alternative 2: Watcher-based effect scheduling (TC39-aligned)

Restructure the effect system to separate "dirty notification" from "effect execution" using a Watcher pattern aligned with the TC39 Signals proposal.

**Rejected because**: Over-engineered for the immediate problem. The Watcher pattern is the right long-term direction but wrong timing — TC39 Signals is Stage 1, we have 16 components, and the scheduling flexibility is speculative. `flush()` is compatible with a future Watcher refactor (`flush()` would become `defaultWatcher.flush()`).

## Assumptions

For this decision to be correct:

1. **Microtask coalescing is sufficient for all current UI update patterns.** Verified: 22/25 sites are provably safe (no code after batch reads effect results). The remaining 3 have redundant guards.

2. **The url-state `pushing` flag can be safely removed.** Verified by tracing the flow: `readUrl()` sets signals from URL params → effect runs on microtask → `pushUrl` compares URLs → they match (we just read from the URL) → no-op. The `set()` helper in `pushUrl` also deletes params that match defaults, preventing URL drift.

3. **`flush()` will not be overused.** Mitigable with documentation ("use sparingly"), code review, and potentially a lint rule that flags `flush()` calls.

4. **No existing code reads DOM state immediately after `batch()` expecting effects to have updated the DOM.** Verified: no such pattern found in any of the 25 call sites.

## Consequences

### Positive

- Removes 25 unnecessary `batch()` wrappers across the codebase
- Eliminates the "should I use batch()?" decision for developers
- Simplifies signal.ts: removes `batchDepth` counter, nested batch tracking, and dual scheduling paths
- One scheduling model instead of two (microtask only, with flush() escape hatch)
- `flush()` is simpler than `batch()`: no wrapping callback, no nesting semantics, idempotent
- Aligns with TC39 Signals direction (no built-in batching, framework controls scheduling)

### Negative

- Breaking change: all `batch()` imports fail at compile time (intentional, easy to fix)
- Effects that previously ran synchronously (inside batch) now run on microtask — imperceptible for UI but a timing change
- `flush()` could be misused as a new form of batch() if developers don't understand microtask coalescing

### Risks

- **url-state echo writes**: If `pushUrl`'s URL comparison guard has edge cases we haven't identified, removing the `pushing` flag could cause URL flickering. Mitigation: thorough testing of URL round-trip scenarios (popstate, programmatic navigation, default value normalization).
- **Future timing dependencies**: New code might depend on synchronous effect execution without realizing it. Mitigation: `flush()` exists as escape hatch; document the microtask model clearly.

## Implementation plan

| Step | What | Risk |
|------|------|------|
| 1 | Add `flush()` export to signal.ts, alias `flushEffects` | None — additive |
| 2 | Remove `batchDepth`, `batch()`, and the `if (batchDepth === 0)` branch | Low — simplification |
| 3 | Remove `batch()` from all 25 call sites | Low — mechanical |
| 4 | Refactor url-state: remove `pushing` flag | Medium — timing change |
| 5 | Update tests: remove batch tests, add microtask coalescing tests | Low |
| 6 | Update ADR 0002 implementation notes | Low |
| 7 | Run full test suite, verify viewer behavior | Verification |
