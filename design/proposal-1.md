# Proposal 1: Boost Tuning + Prefix Matching

<name>Boost Tuning + Prefix Matching</name>
<approach>Increase Orama's title boost from 2x to 8x and add prefix matching to the reranker's title comparison, keeping the additive reranker otherwise unchanged.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>This proposal keeps the existing additive reranker architecture intact. It only changes two parameters/behaviors: the Orama boost value and the title word comparison logic. No normalization, no multiplicative scoring, no architectural change.</differs>

## Changes

### 1. Increase title boost
```ts
// Before
const boost = options?.boost ?? { id: 10, title: 2 };
// After
const boost = options?.boost ?? { id: 10, title: 8 };
```

### 2. Add prefix matching to reranker
```ts
// Before
const matchingQueryWords = queryWords.filter(qw => titleWords.includes(qw));
// After
const matchingQueryWords = queryWords.filter(qw =>
  titleWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw))
);
```

## Evaluation

### Product design
Aligns with product vision — task management search should prioritize title matches. Users name tasks intentionally; search should respect that.

### UX design
No UI changes. Search results will be more intuitive — title matches rank higher.

### Architecture
No architectural change. The fundamental magnitude mismatch remains — this just shifts the balance point so title matches are stronger in Orama's base scoring.

### Backward compatibility
Golden tests may need score threshold adjustments (tests checking `score > 25` etc.) since higher boost changes absolute scores. No API changes.

### Performance
Zero performance impact. Same code paths, different constants.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | Two-line change, 30 minutes including test updates |
| Risk | 3 | Higher boost may over-prioritize title for queries where description match is more relevant |
| Testability | 4 | Easy to test with golden tests, but hard to verify "no regressions" across all query patterns |
| Future flexibility | 2 | Doesn't address root cause; will need revisiting when score distributions change |
| Operational complexity | 5 | No operational changes |
| Blast radius | 4 | Only affects search ranking, not data or API |

## Pros
- Extremely fast to implement
- Low risk of introducing bugs
- Immediately improves the specific example in the task (EPIC-0002 vs EPIC-0018)
- Prefix matching fixes the fuzzy gap

## Cons
- Doesn't solve the fundamental magnitude problem — just moves the threshold
- With boost=8, title matches may dominate TOO much for queries where description relevance matters
- Additive reranker bonuses still fight BM25 at different magnitudes
- Hybrid mode still has the 0-1 vs fixed-bonus mismatch
- No principled way to tune — it's trial and error
