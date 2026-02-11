# Decision: Eliminate explicit batch()

## Pre-decision questions

### 1. Which proposal would I REGRET not doing in 6 months?

Proposal 2 (flush() escape hatch). In 6 months, if we went with Proposal 1 (no escape hatch) and hit a case where synchronous effect execution is genuinely needed (e.g., imperative focus management, measuring DOM after state change), we'd have to either: (a) tell developers to use `await` microtask, which is awkward in synchronous code, or (b) add flush() anyway, which is what Proposal 2 gives us now.

I would NOT regret skipping Proposal 3. The Watcher pattern is architecturally elegant but solves a problem we don't have (custom per-context scheduling). With 16 components, the scheduling flexibility is speculative.

### 2. Argue FOR the most ambitious proposal (Proposal 3)

If Proposal 3 works, we get:
- Perfect TC39 alignment — when native Signals ship, our Watcher maps directly
- Per-context scheduling — DOM updates on rAF, data updates on microtask
- The cleanest separation of concerns in the reactive system
- A foundation that scales to 100+ components without scheduling bottlenecks

The upside is real but distant. TC39 Signals is Stage 1. We have 16 components. The scheduling bottleneck doesn't exist yet.

### 3. What's the REAL cost of playing it safe?

Playing it safe (Proposal 1 or 2) means:
- We keep the current effect self-scheduling model
- If TC39 Signals ships, we'd need to refactor the effect system anyway
- We miss the opportunity to build scheduling flexibility now

But the cost is low because:
- TC39 Signals is years away from shipping
- The refactor from Proposal 2 → Proposal 3 is incremental (add Watcher, move scheduling out of effect)
- We're not painting ourselves into a corner — flush() is compatible with a future Watcher

## Self-critique

### Proposal 1 critique
- "No escape hatch" sounds clean but is actually a bet that we'll NEVER need synchronous flush. That's a strong claim. The url-state analysis proves we don't need it TODAY, but "never" is a long time.
- Making `flushEffects()` a "test utility" while it's actually the only way to get synchronous effects is dishonest API design. If it's useful, make it public.

### Proposal 2 critique
- `flush()` could become the new `batch()` — developers using it "just in case" everywhere. But this is mitigable with documentation and lint rules.
- The name `flush()` is generic. `flushEffects()` is more descriptive. But `flush()` is shorter and the signal module context makes it unambiguous.
- Is this really structurally different from Proposal 1? Both remove batch() and rely on microtask. The only difference is whether flush() is public. That's a small delta. But it's the RIGHT delta — it addresses Proposal 1's main weakness.

### Proposal 3 critique
- Over-engineered for the problem. We're removing 25 batch() calls, not redesigning the reactive system.
- Introduces a new concept (Watcher) for a benefit (custom scheduling) that's speculative.
- Higher risk for the same user-facing outcome (batch() is gone).
- The TC39 alignment argument is weak — the proposal may change significantly before shipping.

## Rubric comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 4 | 2 |
| Risk | 4 | 5 | 3 |
| Testability | 5 | 5 | 5 |
| Future flexibility | 4 | 5 | 5 |
| Operational complexity | 5 | 5 | 4 |
| Blast radius | 4 | 4 | 3 |
| **Total** | **27** | **28** | **22** |

## Decision

<selected>2</selected>
<selectedname>Implicit transactions with flush() escape hatch</selectedname>

<rationale>
Proposal 2 wins because it solves the immediate problem (remove 25 batch() calls) while preserving an escape hatch (flush()) for unforeseen timing needs. It scores highest on the rubric (28/30), with the critical advantage over Proposal 1 being lower risk (5 vs 4) and higher future flexibility (5 vs 4).

The key insight: the difference between Proposal 1 and 2 is tiny in implementation (~1 line: export flush vs keep it internal) but significant in API contract. Making flush() public costs nothing and prevents the scenario where we need synchronous effects but have no public API for it.

Proposal 3 is the right long-term direction but wrong timing. The Watcher pattern can be added later as an incremental refactor on top of Proposal 2's foundation. flush() is compatible with a future Watcher — it would simply become `defaultWatcher.flush()`.
</rationale>

<assumptions>
For this decision to be correct:
1. Microtask coalescing is sufficient for all current UI update patterns (verified: 22/25 sites are provably safe, remaining 3 have redundant guards)
2. The url-state `pushing` flag can be safely removed because `pushUrl`'s URL comparison guard prevents echo writes (verified by tracing the flow)
3. `flush()` will NOT be overused — developers will treat it as an escape hatch, not a default pattern (mitigable with documentation and code review)
4. No existing code reads DOM state immediately after batch() expecting effects to have updated the DOM (verified: no such pattern found in any of the 25 sites)
</assumptions>

<tradeoffs>
Trade-offs we are accepting:
1. `flush()` adds one public API function — slightly more surface area than Proposal 1's zero-addition approach
2. Effects that previously ran synchronously (inside batch) now run on microtask — imperceptible for UI but a timing change
3. We're not pursuing TC39 Watcher alignment now — this is deferred, not abandoned
4. The `pushing` flag removal in url-state relies on `pushUrl`'s URL comparison guard, which is a secondary defense rather than a primary one
</tradeoffs>
