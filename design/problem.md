# Problem Articulation: Eliminate explicit batch()

## Problem statement

<core>Developers must manually wrap multi-signal updates in `batch(() => { ... })` to prevent redundant effect runs. This is a leaky abstraction — the signal system already coalesces updates via microtask scheduling, making batch() redundant for 22 of 25 call sites. The 3 remaining sites depend on batch()'s synchronous flush semantics, which is a timing coupling that should be eliminated through better patterns.</core>

## Why does this problem exist?

The signal system was designed with a dual scheduling model:

1. **Microtask coalescing** (implicit): Multiple synchronous signal writes naturally coalesce because effects are deferred to the next microtask via `queueMicrotask`.
2. **Explicit `batch()`**: Wraps a block of writes and flushes effects synchronously at the end.

`batch()` exists because the original design assumed developers need synchronous effect execution after multi-signal updates. In practice, this is almost never needed — the microtask delay is invisible for UI updates, and no code after a `batch()` call reads effect results (with one exception: url-state's `pushing` flag pattern).

The result: developers use `batch()` defensively ("just in case"), creating 25 call sites of unnecessary ceremony. New contributors see `batch()` everywhere and assume it's required, perpetuating the pattern.

## Who is affected?

- **Component/service authors**: Must remember to use `batch()` when writing multiple signals. Forgetting it doesn't cause visible bugs (microtask coalescing handles it), but creates anxiety about "doing it wrong."
- **AI code generation**: LLMs see `batch()` in training data and reproduce it everywhere, even when unnecessary. This inflates code and obscures intent.
- **Framework maintainers**: Must document, test, and maintain the `batch()` API and its interaction with microtask scheduling.

## Root causes

<dominant>The dominant root cause is that batch() conflates two concerns: (1) coalescing multiple writes into one effect run, and (2) controlling WHEN effects execute (synchronous vs deferred). Concern #1 is already handled by microtask scheduling. Concern #2 is only needed in 1 out of 25 call sites.</dominant>

<alternative>An alternative root cause: the url-state service uses a mutable flag (`this.pushing`) to prevent effect re-entrancy during URL reads. This imperative flag creates a timing dependency on synchronous effect execution, which is the only reason batch()'s synchronous flush matters. If url-state used `untrack()` instead, the timing dependency disappears entirely.</alternative>

## What if our understanding is wrong?

<whatifwrong>If there are call sites we haven't identified that depend on synchronous flush semantics — e.g., code that reads DOM state after batch() expecting effects to have updated the DOM — then removing batch() would cause subtle timing bugs. However, our analysis of all 25 sites shows no such pattern. The only timing-sensitive site (url-state) has a redundant guard (`pushUrl` checks `url.href !== window.location.href`).

Another risk: if future code patterns emerge that genuinely need synchronous effect execution (e.g., imperative focus management after state change), removing batch() entirely would force developers to use `flushEffects()` or `await` microtask, which is less ergonomic.</whatifwrong>

## Constraints

1. **Synchronous read-after-write MUST be preserved**: `a.value = 1; computed.value` must return the updated value. This is a computed pull, not an effect — unaffected by this change.
2. **ADR 0001: no runtime scheduler**: `queueMicrotask` is already accepted (it's in use). No new scheduling mechanism should be introduced.
3. **Zero external dependencies**: Solution must be pure TypeScript.
4. **Backward compatibility**: Existing components must not break. Migration can be incremental.
5. **Test infrastructure**: `flushEffects()` must continue to work for synchronous test assertions.

## Adjacent problems

1. **Effect loop detection timing**: The current loop detector (`MAX_EFFECT_RERUNS` / `LOOP_WINDOW_MS`) counts runs within a time window. If effects always run on microtask, the timing characteristics change slightly. The detector should still work but may need tuning.

2. **Cascading effects in tests**: The implementation note (ADR 0002) documents that "cascading effects need multiple flushes in tests." If batch() is removed, this behavior becomes the ONLY model, making it more important to document clearly.

## Scope

This is a design task producing an ADR with recommendation. Implementation scope:
- Modify `signal.ts` (remove or deprecate `batch()`)
- Refactor url-state.ts (replace `pushing` flag)
- Update 25 call sites (remove `batch()` wrappers)
- Update tests (remove batch-specific tests, add microtask coalescing tests)
- Update ADR 0002 implementation notes

Out of scope:
- Changing computed evaluation semantics
- Changing the push-pull hybrid model
- Adding new reactive primitives
