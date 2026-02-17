# 0083. Search Service Architectural Review & Next-Generation Search

**Date**: 2026-02-17
**Status**: Proposed

## Context

After building a sophisticated search pipeline (ADR-0079 native filtering, ADR-0080 best practices, ADR-0081 linear fusion), search ranking still produces incorrect results for real-world queries. Specifically:

- **"backlog mcp"** → the "backlog-mcp 10x" epic ranks ~8th instead of 1st
- **"feature store"** → the FeatureStore task is buried; tasks that merely mention "feature" a lot rank higher

The question is whether incremental tuning (weights, boosts, bonuses) will close the gap, or whether the architecture has a fundamental ceiling.

This ADR captures:
1. **Evidence-based root cause analysis** — diagnostic tests tracing the full scoring pipeline
2. Concrete bugs found during code review
3. Analysis of what would produce a magnitude improvement, backed by IR research

## Part 1: Evidence-Based Root Cause Analysis

### Diagnostic methodology

Three diagnostic test suites were written to reproduce the ranking failures:
- `search-ranking-diagnostic.test.ts` — 15-doc realistic dataset, end-to-end ranking
- `search-scoring-decompose.test.ts` — traces raw BM25, MinMax normalization, fusion, and coordination bonus independently
- `search-scaling-diagnostic.test.ts` — scales corpus from 5 to 50 noisy docs to find degradation thresholds

### Finding 1: "feature store" → FeatureStore task ranks DEAD LAST

**Setup**: TASK-0009 (title: "Create YavapaiMFE ownership transfer documentation", description mentions "FeatureStore") + 4 other tasks with "feature" in their titles.

**Full scoring pipeline trace:**

```
Raw BM25 (title:3 boost):
  #1  TASK-0021  raw_bm25=6.09  "Feature prioritization framework"
  #2  TASK-0020  raw_bm25=4.96  "Feature flag cleanup"
  #3  TASK-0022  raw_bm25=4.80  "Implement feature toggle service"
  #4  TASK-0023  raw_bm25=4.05  "Add feature request template"
  #5  TASK-0009  raw_bm25=1.93  "Create YavapaiMFE ownership transfer doc"  ← TARGET

After MinMax normalization:
  #1  TASK-0021  normalized=0.700
  #5  TASK-0009  normalized=0.000  ← LITERALLY ZERO (minimum scorer)

After coordination bonus (+0.5 body, +0.3 title max):
  #1  TASK-0021  final=1.35  (0.70 + 0.65 coord)
  #5  TASK-0009  final=0.50  (0.00 + 0.50 coord)  ← STILL LAST
```

**Why**: TASK-0009 has "FeatureStore" only in description. The compound tokenizer expands it to `["featurestore", "feature", "store"]`, so both query terms match. But TASK-0009's *title* is "Create YavapaiMFE ownership transfer documentation" — no "feature" or "store". Other tasks have "Feature" literally in their TITLE (3x boost) AND happen to mention "store" somewhere in their description ("feature management store", "feature store should persist", etc.).

**The `id: 10` boost has ZERO effect here** — neither "feature" nor "store" appears in any task ID. Confirmed by running with and without the boost: identical scores.

### Finding 2: MinMax normalization annihilates low-BM25-but-relevant documents

When TASK-0009 is the lowest BM25 scorer, MinMax maps it to exactly `0.0000`. The coordination bonus (max +0.8) is the only thing keeping it visible at all. But every OTHER task also gets +0.50 to +0.65 coordination (since they ALL contain both "feature" and "store" in their body text). The bonus provides zero differentiation.

```
TASK-0021: 0.70 (base) + 0.65 (coord) = 1.35  ← irrelevant task wins
TASK-0009: 0.00 (base) + 0.50 (coord) = 0.50  ← relevant task loses
```

### Finding 3: Single-term "feature" → TASK-0009 scores literally 0.0000

```
After MinMax:
  #1  TASK-0022  fused=0.7000  "Implement feature toggle service"
  #5  TASK-0009  fused=0.0000  "Create YavapaiMFE ownership transfer doc"

After coordination (single-term → no bonus applied):
  #5  TASK-0009  final=0.0000  ← completely invisible
```

TASK-0009 matches "feature" via compound expansion in description, but other tasks have "feature" in their TITLE with 3x boost AND higher TF in body. MinMax maps TASK-0009's lowest-BM25-score to zero. No coordination bonus for single-term queries.

### Finding 4: "backlog mcp" holds at #1 with 50 docs, but user reports 8th

With the diagnostic's noisy-doc corpus (5-50 docs mentioning "backlog" and "mcp"), EPIC-0001 consistently ranks #1. This means the user's real dataset has a different composition — likely including indexed **resources** (ADR docs, markdown files, reference docs) that contain "backlog-mcp" extensively in their full text content.

### Root cause summary

The root causes of ranking failures are (in order of impact):

**1. BM25 cannot distinguish "about X" from "mentions X a lot"** — BM25 is purely statistical (TF × IDF × field length normalization). A task whose SUBJECT is FeatureStore but mentions it once via compound expansion scores 3x lower than a task that has "feature" in its title and "store" incidentally in its description. BM25 has no concept of "aboutness."

**2. MinMax normalization destroys the lowest scorer** — The lowest-BM25 document maps to 0.0 regardless of whether it's actually relevant. This is devastating when the relevant document IS the lowest BM25 scorer (as happens when the query terms are buried in compound words in the description rather than being literal title words).

**3. BM25's title:3 boost rewards the wrong documents** — When the target's title doesn't contain the query terms literally (TASK-0009: "Create YavapaiMFE ownership transfer documentation" for query "feature store"), the 3x title boost flows entirely to irrelevant documents that happen to have "Feature" in their titles.

**4. Additive coordination bonus is equally distributed** — When ALL returned documents contain both query terms (which happens when terms are common), the coordination bonus gives roughly the same boost to everyone, providing zero differentiation.

**5. The `id: 10` boost is a separate problem** — It IS a design issue (any query containing "task" or "epic" matches every document's ID), but it is NOT the cause of the user's specific "backlog mcp" and "feature store" failures. Neither "backlog", "mcp", "feature", nor "store" appear in any document IDs.

---

## Part 2: Code Review Findings

### Critical (correctness bugs)

#### 2.1 Missing `await` on `insert` in `indexResources` (orama-search-service.ts:494, 511)

```typescript
// Line 494 — fire-and-forget, can silently fail
insert(this.db as OramaInstanceWithEmbeddings, doc);

// Compare with addDocument (line 438) which correctly awaits
await insert(this.db as OramaInstanceWithEmbeddings, doc);
```

Orama's `insert` returns a Promise. Without `await`, insert failures are silently swallowed and resources may not appear in search results.

#### 2.2 `updateDocument` / `updateResource` are not atomic (orama-search-service.ts:463-474)

The pattern is `remove → re-set cache → insert`. If `insert` throws (e.g., embedding service error), the document has been removed from the Orama index but restored in `taskCache`. The index and cache are now inconsistent — `_getSearchableText()` sees the document but `search()` doesn't find it.

#### 2.3 `search()` method contradicts ADR-0079 (orama-search-service.ts:346-360)

The `search()` method (task-only) runs `_fusedSearch` without restricting `type` in the `where` clause, then filters to tasks in JS at line 358-359 (`.filter(h => h.task)`). This is the exact post-search JS filtering pattern that ADR-0079 was created to eliminate. Unlike `searchAll()` and `searchResources()` which correctly use native filtering.

### Important (design issues)

#### 2.4 `id` field boosted 10x creates noise for ID-prefix queries

```typescript
boost: options?.boost ?? { id: 10, title: 3 },
```

Since `id` is in `TEXT_PROPERTIES`, every document with IDs like `TASK-0001`, `EPIC-0002` are text-searchable with a 10x boost. Any query containing "task" or "epic" heavily matches every document of that type through the ID field. This is a real problem for queries like "what tasks are blocked" or "show me epics", even though it's NOT the cause of the "feature store" / "backlog mcp" ranking failures.

#### 2.5 Snippet generation doesn't use the compound tokenizer (snippets.ts:57)

```typescript
const hasMatch = queryWords.some(w => valueLower.includes(w));
```

The search engine uses `compoundWordTokenizer` to split "FeatureStore" → ["featurestore", "feature", "store"]. But snippet generation uses naive substring matching. Searching "FeatureStore" will not find a snippet match in text containing "Feature Store" (two words), even though Orama returned the document as a hit.

#### 2.6 Silent filter override in `buildWhereClause` (orama-schema.ts:81-84)

If both `filters.type` and `docTypes` are set, `docTypes` silently overwrites `filters.type`. Not documented, can produce confusing results.

#### 2.7 Index load doesn't validate embedding configuration (orama-search-service.ts:191-193)

If the cached index was built with `hybridSearch: false` but the current instance has `hybridSearch: true`, the loaded BM25-only index is used as-is. The system silently runs in BM25 mode despite the caller expecting hybrid search.

### Minor (quality-of-life)

#### 2.8 `SearchService` interface is dead code (types.ts:90-105)

The interface declares 5 methods but `OramaSearchService` implements ~15 public methods. Not used for polymorphism anywhere.

#### 2.9 Synchronous file I/O in `persistToDisk` (orama-search-service.ts:140-157)

`writeFileSync` blocks the Node.js event loop. For a Fastify server under load, this causes latency spikes proportional to index size.

#### 2.10 Empty catch blocks throughout

`persistToDisk`, `loadFromDisk`, `removeDocument`, `removeResource` all silently swallow errors.

#### 2.11 Score range is unbounded and undocumented

After coordination bonus, scores range [0, ~1.8]. The MCP tool doesn't document the range.

---

## Part 3: What Would Produce a Magnitude Improvement

### The fundamental problem

BM25 is a **bag-of-words** model designed for long-document retrieval. It has three blind spots that are devastating for short-text backlog search:

1. **No phrase/proximity awareness** — "feature store" as adjacent terms in a title is scored identically to "feature" and "store" appearing 50 words apart in a description. BM25 doesn't know they form a compound concept.

2. **No "aboutness" signal** — A document ABOUT FeatureStore that mentions it once scores lower than a document that happens to mention "feature" 5 times. BM25 confuses frequency with relevance.

3. **No navigational query handling** — When a user searches "backlog mcp", they're navigating to a specific item (the epic). BM25 treats this identically to an informational query ("find everything about backlog and mcp"). [Navigational queries account for ~30% of all searches](https://mirasvit.com/blog/three-types-of-search-queries-navigational-informational-transactional.html).

### Improvement 1: Exact/phrase title match override (immediate, highest ROI)

**The insight**: When all query terms appear as a contiguous phrase (or near-phrase) in a document's title, that document should rank first. This is how Typesense, Algolia, and every production search system works — [Typesense prioritizes exact title matches by default](https://typesense.org/docs/guide/ranking-and-relevance.html).

**Implementation**: Before BM25 scoring, check if the query is a substring of any document title (after tokenization). If so, pin that document to the top with a score override.

```
if title.tokenized.includes(query.tokenized as phrase) → score = MAX_SCORE
```

This would fix:
- "backlog mcp" → EPIC-0001 "backlog-mcp 10x" matches as phrase → #1
- "feature store" with exact phrase match would require the title to actually contain it (won't fix TASK-0009 directly — see cross-encoder below)

**Evidence**: Typesense's `prioritize_exact_match=true` (default) handles this. Their ranking uses a multi-signal tie-breaking algorithm: frequency → typo distance → proximity → field weight. This is fundamentally different from BM25's single-score approach.

### Improvement 2: Cross-encoder re-ranking (highest magnitude, evidence-backed)

**What it does**: A cross-encoder reads `(query, document)` as a single sequence through a transformer, computing a joint relevance score. Unlike BM25 (which counts tokens) or bi-encoders (which compare independent embeddings), cross-encoders UNDERSTAND relationships.

**Evidence from benchmarks**:

| Method | MS MARCO MRR@10 | BEIR nDCG@10 | Source |
|--------|----------------|--------------|--------|
| BM25 baseline | ~35.85 | Competitive zero-shot | [MS MARCO paper](https://arxiv.org/pdf/2105.04021) |
| BM25 + cross-encoder (MiniLM) | ~38-40+ | +39% over BM25 | [Elastic Rerank](https://www.elastic.co/search-labs/blog/elastic-semantic-reranker-part-2) |
| BM25 + dense + reranker | — | +48% over single-method | [Pinecone analysis](https://www.emergentmind.com/topics/cross-encoders) |
| monoT5-3B re-ranking | Marginal in-domain | +4 nDCG over best bi-encoders | [Rosa et al. 2022](https://arxiv.org/pdf/2212.06121) |

**Why it fixes the exact problem**: For "feature store", a cross-encoder would read the query alongside "Create comprehensive starter doc for new team taking ownership of FeatureStore (YavapaiMFE)" and UNDERSTAND that this document IS about FeatureStore. BM25 can't see this because the title doesn't contain the terms.

**Local Node.js implementation**: Available via [Transformers.js v3](https://huggingface.co/blog/transformersjs-v3) with ONNX Runtime. Models:
- `cross-encoder/ms-marco-MiniLM-L-6-v2` — ~22MB, general purpose
- `jinaai/jina-reranker-v2-base-multilingual` — [has explicit Transformers.js example](https://huggingface.co/jinaai/jina-reranker-v2-base-multilingual)
- Shallow models (2-4 layers) run on CPU with negligible latency for 20-50 documents

**Architecture**: Standard retrieve-then-rerank pattern:
```
Stage 1 (retrieval):  BM25 + vector → top 50 candidates  (fast, ~10ms)
Stage 2 (re-ranking): cross-encoder scores top 50         (~100-200ms)
Stage 3 (return):     top 20 from re-ranked results
```

### Improvement 3: Replace MinMax normalization for BM25-only mode

**The problem proven by diagnostics**: MinMax maps the lowest BM25 scorer to 0.0. When the relevant document IS the lowest scorer (as with TASK-0009), it becomes invisible to all downstream scoring.

**Options**:
- **Rank-based normalization**: Score by position (1st gets 1.0, 2nd gets 0.95, etc.) instead of by value. Eliminates the "3x BM25 gap → 0.0 score" problem.
- **Skip normalization in BM25-only mode**: When vector search is unavailable, normalization serves no purpose (nothing to fuse). Just use raw BM25 + coordination.
- **BM25+ variant**: [BM25+ ensures matched terms always contribute a positive score](https://en.wikipedia.org/wiki/Okapi_BM25#BM25+), which combined with rank-based normalization prevents the "zero score" problem.

### Improvement 4: Query understanding (intent → structured query)

When a user searches "blocked tasks about database", the system should decompose this into:
```json
{ "filters": { "status": ["blocked"] }, "query": "database" }
```

This is not a text search problem — it's classification/extraction. A rule-based parser for the small vocabulary (5 statuses, 5 types, "recent", "my", "blocked") would handle 80% of cases with zero dependencies.

---

## Decision

### Immediate fixes (Part 2 bugs)

1. Add missing `await` to `insert` calls in `indexResources`
2. Make `updateDocument`/`updateResource` atomic (catch insert failure, re-add old doc)
3. Add `type` filter to `search()` method's `where` clause
4. Remove `id` from `TEXT_PROPERTIES` and from the default boost
5. Use compound tokenizer in snippet generation
6. Document the `buildWhereClause` override behavior
7. Validate embedding config on disk load

### Architecture evolution (Part 3 improvements — in priority order)

8. **Exact/phrase title match override** — pin documents whose title matches the query as a phrase to the top of results. Lowest effort, fixes navigational queries immediately.
9. **Cross-encoder re-ranking** — add as Stage 2 behind feature flag. Use `cross-encoder/ms-marco-MiniLM-L-6-v2` via Transformers.js ONNX. This is the single highest-impact improvement, backed by benchmark evidence showing +39-48% quality gains.
10. **Fix MinMax normalization** — replace with rank-based normalization or skip in BM25-only mode to prevent zero-score annihilation.
11. **Query intent parser** — rule-based extraction of status/type/sort from natural language queries.
12. Re-evaluate coordination bonus after #8 and #9 are in place (may become redundant).

## Consequences

### Positive
- Fixes concrete bugs that cause inconsistent index state
- Exact title match handles the ~30% of queries that are navigational
- Cross-encoder re-ranking addresses the fundamental "aboutness" ceiling
- Fixes the MinMax zero-score problem that buries relevant documents

### Negative
- Cross-encoder adds ~100-200ms latency per search (acceptable for interactive use)
- Cross-encoder model is an additional ~22MB dependency
- Exact title match is a heuristic — needs careful handling of partial/prefix matches
- Two-stage retrieval is more complex to debug than single-stage

### Neutral
- ADR-0081 (linear fusion) remains the Stage 1 architecture. This ADR adds stages on top.
- The `id: 10` boost IS a problem but is NOT the primary cause of the reported ranking failures. It's being fixed as a separate cleanup item.

## References

- Diagnostic test evidence: `src/__tests__/search-ranking-diagnostic.test.ts`, `search-scoring-decompose.test.ts`, `search-scaling-diagnostic.test.ts`
- [Cross-Encoders for Re-Ranking (SBERT docs)](https://www.sbert.net/examples/cross_encoder/applications/README.html)
- [MS MARCO cross-encoder models](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2)
- [Elastic Rerank: +39% over BM25 on BEIR](https://www.elastic.co/search-labs/blog/elastic-semantic-reranker-part-2)
- [Typesense ranking: exact match prioritization](https://typesense.org/docs/guide/ranking-and-relevance.html)
- [Navigational queries: ~30% of all searches](https://mirasvit.com/blog/three-types-of-search-queries-navigational-informational-transactional.html)
- [Jina Reranker v2 with Transformers.js](https://huggingface.co/jinaai/jina-reranker-v2-base-multilingual)
- [BM25+ for short text](https://en.wikipedia.org/wiki/Okapi_BM25#BM25+)
- ADR-0079: Orama native filtering
- ADR-0080: Orama search best practices
- ADR-0081: Independent retrievers with linear fusion
