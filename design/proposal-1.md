# Proposal 1: Remove batch(), keep microtask coalescing

<name>Microtask-only: remove batch() entirely</name>
<approach>Delete the batch() API and all 25 call sites, relying on the existing microtask coalescing that already handles multi-signal writes.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

## Core idea

The signal system already coalesces multiple synchronous writes into one effect run via `queueMicrotask`. `batch()` is redundant. Remove it.

### Changes

1. **signal.ts**: Remove `batch()`, `batchDepth`, and the `if (batchDepth === 0)` check in `notify()`. Effects always schedule via microtask.
2. **25 call sites**: Remove `batch(() => { ... })` wrappers, leaving the signal writes inline.
3. **url-state.ts**: Remove the `pushing` flag. The `pushUrl` guard (`url.href !== window.location.href`) already prevents echo writes.
4. **Tests**: Remove batch-specific tests. Update cascading effect tests to use `flushEffects()` consistently.
5. **Keep `flushEffects()`**: Remains as a test utility for synchronous assertions.

### Example migration

```typescript
// Before
openResource(path: string) {
  batch(() => {
    this.activePane.value = 'resource';
    this.resourcePath.value = path;
    this.mcpUri.value = null;
    // ...
  });
  this.persist(path);
}

// After
openResource(path: string) {
  this.activePane.value = 'resource';
  this.resourcePath.value = path;
  this.mcpUri.value = null;
  // ...
  this.persist(path);
}
```

<differs>This is the only proposal that completely removes batch() from the API surface. Other proposals retain some form of explicit coalescing mechanism (deprecated batch, flush(), or transaction API). This proposal bets that microtask coalescing is sufficient for ALL use cases.</differs>

## Evaluation

### Product design
Aligns perfectly with the framework's "hard to write wrong" principle (ADR 0001). Removing batch() means one fewer concept for developers to learn. There's no decision to make — writes coalesce automatically.

### UX design (developer experience)
Maximally simple. Write signals, effects run later. No wrapping, no ceremony. The mental model is: "signal writes are instant, effects are deferred."

### Architecture
Cleaner — removes the dual scheduling model. One path: write → notify → microtask → flush. The `batchDepth` counter and synchronous flush path are eliminated.

### Backward compatibility
**Breaking change**: Code that imports and calls `batch()` will fail at compile time. This is intentional — all 25 sites need updating. No silent behavior change.

### Performance implications
- **Slightly better**: Removes the `batchDepth` check on every `notify()` call (one fewer branch per signal write).
- **Slightly different timing**: Effects that previously ran synchronously (inside batch) now run on microtask. For UI updates, this is imperceptible (microtask runs before the browser paints).
- **No bundle size change**: batch() is ~15 lines; removing it saves negligible bytes.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~1 hour: delete batch(), remove 25 wrappers, update tests |
| Risk | 4 | 22/25 sites are provably safe. url-state needs careful verification but has redundant guards |
| Testability | 5 | Existing microtask tests already cover the behavior. Remove batch tests, add explicit "no batch needed" tests |
| Future flexibility | 4 | If synchronous flush is ever needed, `flushEffects()` exists. But it's a test utility, not a public API |
| Operational complexity | 5 | Less code = less to maintain. One scheduling model instead of two |
| Blast radius | 4 | Compile-time errors for all batch() callers. No silent failures. url-state is the only behavioral risk |

**Total: 27/30**

## Pros

- Simplest possible solution — removes code instead of adding it
- Zero new concepts or APIs
- Aligns with TC39 Signals proposal (no built-in batching)
- Eliminates the "should I use batch()?" decision entirely
- Removes 25 unnecessary wrapper calls across the codebase

## Cons

- **No escape hatch for synchronous flush**: If a future pattern genuinely needs effects to run before the next line, there's no public API for it (`flushEffects()` is a test utility)
- **Breaking change**: All 25 call sites must be updated simultaneously (though this is trivial)
- **Subtle timing change**: Effects that ran synchronously inside batch() now run on microtask. For the current codebase this is safe, but future code could be surprised
