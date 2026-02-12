# Decision: Search Ranking Architecture (TASK-0285)

## Comparison Matrix

| Anchor | P1: Boost Tuning | P2: Normalize+Multiply | P3: Unified Hook |
|--------|:-:|:-:|:-:|
| Time-to-ship | 5 | 3 | 2 |
| Risk | 3 | 4 | 2 |
| Testability | 4 | 5 | 3 |
| Future flexibility | 2 | 5 | 3 |
| Operational complexity | 5 | 5 | 5 |
| Blast radius | 4 | 4 | 3 |
| **Total** | **23** | **26** | **18** |

## Honest Self-Critique

### Which proposal would I regret not doing in 6 months?
Proposal 2. In 6 months, if we ship Proposal 1, we'll be back here tuning boost values again when the dataset grows or content patterns change. The magnitude problem doesn't go away — it just moves. Proposal 2 eliminates the class of problem permanently.

### Argue FOR the most ambitious (Proposal 3)
If it works, we'd have the cleanest architecture: one scoring system, no coordination problem, no magnitude mismatch. Every signal in one formula. But the afterSearch hook is undocumented, synchronous-only, and couples us tightly to Orama's internals. The theoretical elegance doesn't justify the practical risks.

### What's the REAL cost of playing it safe (Proposal 1)?
We'd ship faster but accumulate technical debt. Every future search improvement would need to account for the magnitude mismatch. New domain signals would need careful tuning against BM25's unpredictable range. We'd spend more time debugging ranking issues than we saved by shipping fast.

### Self-critique of Proposal 2
- The normalization step (divide by max) means if the top result changes, all relative scores shift. This is fine for ranking (relative order is what matters) but makes absolute score thresholds in tests meaningless.
- Multiplier values (0.5 for title coverage, 0.3 for starts-with, 1.1 for epic) are still somewhat arbitrary — but they're bounded and their effects are predictable, unlike additive bonuses on unbounded scores.
- There's a risk of over-engineering: maybe Proposal 1's boost=8 is "good enough" for our use case. But "good enough" is how we got here in the first place.

## Decision

<selected>2</selected>
<selectedname>Normalize-Then-Multiply Pipeline</selectedname>

<rationale>
Proposal 2 wins on merit across the most important dimensions:

1. **Solves the root cause** — Normalization eliminates the magnitude mismatch permanently, not just for current data. Proposal 1 only shifts the threshold.

2. **Best future flexibility (5/5)** — New domain signals = new multiplier. No magnitude concerns ever again. This matters because search ranking is iterative — we'll keep tuning.

3. **Best testability (5/5)** — Normalized scores are predictable. Each multiplier is independently testable. Proposal 3 requires full Orama instances for testing.

4. **Reasonable effort** — ~2-3 hours of implementation. Not much more than Proposal 1 when you account for the test updates both require.

5. **Clean architecture** — Clear separation: Orama owns text relevance, reranker owns domain amplification. The normalization boundary is the interface contract.

Proposal 1 is tempting for speed but doesn't solve the problem — it just makes it less visible for current data. Proposal 3 is theoretically elegant but practically risky (undocumented hook API, sync-only, tight coupling).
</rationale>

<assumptions>
For this decision to be correct:
1. Min-max normalization (divide by max) produces stable enough relative rankings — the top result's score doesn't fluctuate wildly between similar queries
2. Multiplicative factors in the 1.0-2.0 range provide enough dynamic range to differentiate domain signals
3. Orama's BM25 with boost=5 for title produces a reasonable base ranking that normalization preserves
4. The golden test suite adequately covers the ranking behaviors we care about
</assumptions>

<tradeoffs>
1. More code change than Proposal 1 (rewrite reranker + normalization + test updates)
2. Golden tests need score threshold updates (scores change from 0-100+ to 0-2 range)
3. Absolute scores become less meaningful (but relative ranking is what matters)
4. Still two systems (Orama + reranker) — but now they cooperate instead of competing
</tradeoffs>
