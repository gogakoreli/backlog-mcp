# Verification: Problem Understanding Completeness

## Dominant causes — verified?

YES. The dual scheduling model (microtask + synchronous batch) is clearly identified in the code. The `batchDepth` counter and `scheduleFlush()` / `flushPendingEffects()` functions are the exact mechanism. The 25 call sites are exhaustively cataloged with their patterns.

## Alternative root causes — verified?

YES. The url-state `pushing` flag pattern is the only alternative cause that creates a genuine timing dependency. All other sites use batch() defensively without needing synchronous flush.

One additional alternative cause worth noting: **developer cargo-culting**. Once batch() appeared in SplitPaneState (the first migrated service), subsequent migrations copied the pattern without questioning whether it was needed. This is a social/process cause, not a technical one, but it explains why 22 unnecessary batch() calls exist.

## "What if we're wrong" — verified?

YES. Two scenarios considered:

1. **Hidden timing dependencies**: Searched all 25 sites for code after batch() that reads signals, DOM state, or effect results. Found none except url-state's `pushing` flag, which has a redundant guard.

2. **Future need for synchronous flush**: Acknowledged. The mitigation is to keep `flushEffects()` as a test utility and document it as available for rare imperative cases. This is strictly less API surface than `batch()`.

## Additional verification: untrack() as url-state fix

Verified that `untrack()` exists in signal.ts and is already used by component.ts for observer isolation. The url-state refactor would use it to prevent the URL-sync effect from tracking signal reads during `readUrl()`:

```typescript
// Instead of:
this.pushing = true;
batch(() => { ...set signals... });
this.pushing = false;

// Use:
untrack(() => {
  this.filter.value = params.get('filter') || 'active';
  // ...
});
```

Wait — `untrack()` prevents signal READS from being tracked, not signal WRITES from triggering effects. The url-state problem is about preventing the effect from running during writes, not about tracking.

Actually, the real fix is simpler: just remove batch() and let the effect run on microtask. By then, the URL already reflects the new state, so `pushUrl`'s guard (`url.href !== window.location.href`) prevents any actual URL push. The `pushing` flag becomes unnecessary.

Let me verify this by tracing the flow:
1. User navigates (popstate fires)
2. `readUrl()` runs: sets 4 signal values synchronously
3. Without batch(): effects are scheduled for microtask
4. `readUrl()` returns
5. Microtask fires: URL-sync effect runs
6. Effect reads signal values (which match the URL we just read from)
7. Effect calls `pushUrl()` which compares `url.href !== window.location.href`
8. URLs match → no-op

The only edge case: if `readUrl()` normalizes values (e.g., `params.get('filter') || 'active'` when filter param is absent). The URL would be `?` (no filter param) but the signal would be `'active'`. `pushUrl` would then add `?filter=active` to the URL... but wait, `pushUrl` has `set('filter', f, 'active')` which DELETES the param when value equals default. So the URL stays the same. ✅

**Verified: removing batch() from url-state is safe. The `pushing` flag and batch() can both be removed.**

<ready>YES — Problem space is fully mapped. All 25 call sites analyzed. The dominant cause (unnecessary dual scheduling) and alternative cause (url-state timing dependency) are both verified. The "what if wrong" scenarios have been investigated and mitigated. Ready to propose solutions.</ready>
