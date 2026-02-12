# Research: Search Ranking Architecture (TASK-0285)

## Current Architecture

### Two Competing Scoring Systems

1. **Orama BM25** — produces base scores across all indexed fields
2. **`rerankWithSignals()`** — adds fixed-point bonuses on top

### Orama BM25 Internals (v3.1.18)

Formula: `idf * (d + tf * (k+1)) / (tf + k * (1 - b + b * fieldLength / avgFieldLength))`
- Default params: k=1.2, b=0.75, d=0.5
- Configurable via `relevance` search option: `{ k, b, d }`

Score accumulation across fields:
```
docScore = Σ(BM25(field, term) × boost[field])  // for each field, for each query term
```

When a term matches in multiple fields, scores are additive. When multiple query terms match, scores accumulate with a 1.5x multiplier for documents matching multiple terms.

### Current Boost Configuration
```ts
const boost = { id: 10, title: 2 };  // all other fields default to 1
```

Title matches are only 2x description matches — far too low for task management search.

### Reranker Bonuses (Fixed Additive)
```
TITLE_STARTS_WITH: 20
TITLE_EXACT_WORD: 10
TITLE_PARTIAL: 3
MULTI_WORD_MATCH: 8 per additional word
EPIC_WITH_TITLE_MATCH: 5
RECENCY: 1-5
```
Max possible bonus: ~49 points (starts-with + 4 extra words + epic + recency)

### The Magnitude Mismatch

BM25 scores are **unbounded** — they depend on IDF, TF, document length, and field count. For our dataset:
- Short documents, rare terms: BM25 ≈ 1-5
- Long documents, common terms: BM25 ≈ 10-50+
- With boost=2 on title: title contribution ≈ 2-10

The reranker's fixed bonuses (max ~49) sometimes dominate (small BM25 scores) and sometimes get overwhelmed (large BM25 scores). This is the root cause of unpredictable ranking.

### Hybrid Mode Makes It Worse

In hybrid mode, Orama internally normalizes BM25 scores to 0-1 (min-max normalization), then blends with vector scores: `text * 0.8 + vector * 0.2`. Final scores are 0-1. The reranker then adds 5-49 points on top of 0-1 scores, meaning **the reranker ALWAYS dominates in hybrid mode** — the opposite problem from BM25-only mode.

## Orama's Available Knobs

| Knob | What it does | Useful? |
|------|-------------|---------|
| `boost` per field | Multiplicative factor on BM25 per field | ✅ Yes — primary lever for title importance |
| `relevance: {k, b, d}` | BM25 parameters | ⚠️ Global only, not per-field |
| `tolerance` | Fuzzy matching (Levenshtein distance) | ✅ Already using (=1) |
| `beforeSearch` / `afterSearch` hooks | Modify params or results | ⚠️ No per-field score access |
| `threshold` | Min keyword match ratio | ✅ Already using default |

Orama does NOT support: custom scoring functions, per-field BM25 params, score normalization API, or function-score queries.

<insight>The fundamental problem is that additive bonuses on unbounded scores create unpredictable behavior. Normalizing scores to 0-1 first, then applying multiplicative domain signals, makes the two systems work together instead of fighting. The reranker should amplify Orama's relevance signal, not compete with it.</insight>
