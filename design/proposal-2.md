# Proposal 2: Normalize-Then-Multiply Pipeline

<name>Normalize-Then-Multiply Pipeline</name>
<approach>Normalize Orama's raw scores to 0-1 range, then apply multiplicative domain signal factors instead of additive bonuses, creating a two-stage pipeline where Orama owns text relevance and the reranker owns domain amplification.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Fundamentally different data-flow. Proposal 1 keeps additive bonuses on raw scores (same architecture, different constants). This proposal introduces a normalization boundary between Orama and the reranker, changing the interface contract from "raw score + bonus" to "normalized score × multiplier". The reranker becomes magnitude-independent.</differs>

## Design

### Two-Stage Pipeline

```
Stage 1: Orama BM25 (or hybrid) → raw scores
         ↓ normalize to 0-1 (divide by max)
Stage 2: Reranker multiplies by domain signals
         ↓ final scores
```

### Stage 1: Orama with Higher Title Boost

```ts
const boost = { id: 10, title: 5 };  // moderate increase (not as aggressive as Proposal 1)
```

Title boost of 5x (up from 2x) — enough to make Orama's ranking better as a baseline, but we don't need to go to 8x because the reranker will handle the rest proportionally.

### Normalization

```ts
function normalizeScores<T extends { score: number }>(results: T[]): T[] {
  if (results.length === 0) return results;
  const maxScore = Math.max(...results.map(r => r.score));
  if (maxScore === 0) return results;
  return results.map(r => ({ ...r, score: r.score / maxScore }));
}
```

After normalization, the best Orama result has score=1.0. All others are proportional. This works identically for BM25-only (unbounded → 0-1) and hybrid mode (already 0-1 → stays 0-1).

### Stage 2: Multiplicative Reranker

```ts
function rerankWithSignals(results, query) {
  // ... title matching logic with prefix support ...
  
  let multiplier = 1.0;
  
  // Title word coverage: how many query words appear in title
  const titleMatchRatio = matchCount / queryWords.length;
  multiplier += titleMatchRatio * 0.5;  // up to 1.5x for perfect title match
  
  // Title-starts-with bonus
  if (titleStartsWithQuery) multiplier += 0.3;  // up to 1.8x total
  
  // Epic with title match
  if (isEpic && hasTitleMatch) multiplier *= 1.1;
  
  // Recency
  multiplier *= getRecencyMultiplier(updated_at);  // 1.0-1.15
  
  return { ...r, score: r.score * multiplier };
}
```

### Prefix Matching (same as Proposal 1)

```ts
const matchingQueryWords = queryWords.filter(qw =>
  titleWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw))
);
```

## Evaluation

### Product design
Strong alignment. The pipeline model matches how users think: "find relevant things" (Orama) then "prioritize by what matters to me" (domain signals). Clean mental model.

### UX design
No UI changes. Results will be more predictable — the same query will produce consistent rankings regardless of document content length.

### Architecture
Clean separation of concerns. Orama owns text relevance. Reranker owns domain amplification. The normalization boundary makes them composable. New domain signals can be added as multipliers without worrying about magnitude.

### Backward compatibility
Score values change (now 0-2 range instead of 0-100+). Golden tests checking absolute score thresholds need updating. API contract unchanged.

### Performance
Negligible overhead. One extra pass to find max score (O(n)), then division per result. Total: O(n) additional work on top of existing O(n) reranking.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | ~2-3 hours: rewrite reranker, update normalization, fix golden tests |
| Risk | 4 | Well-understood approach (min-max normalization is standard); main risk is tuning multiplier values |
| Testability | 5 | Normalized scores are predictable and testable; multipliers are independent and unit-testable |
| Future flexibility | 5 | New domain signals = new multiplier. Score magnitude never matters again. |
| Operational complexity | 5 | No operational changes |
| Blast radius | 4 | Only affects search ranking, not data or API |

## Pros
- Solves the fundamental magnitude problem — scores are always 0-1 before reranking
- Works identically for BM25-only and hybrid modes
- Multiplicative signals are composable and independent
- Easy to add new domain signals (just add a multiplier)
- Principled tuning: each multiplier has a clear range and meaning

## Cons
- More code change than Proposal 1
- Golden test score thresholds all need updating
- Multiplier values need tuning (but they're bounded and predictable)
- Normalization by max score means if the top result changes, all relative scores shift
