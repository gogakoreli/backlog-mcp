# Proposal 3: Unified Scoring Function via afterSearch Hook

<name>Unified Scoring via afterSearch Hook</name>
<approach>Replace the two-system architecture entirely by using Orama's afterSearch hook to inject a single unified scoring function that computes final scores from scratch using both text signals and domain signals in one pass.</approach>
<timehorizon>[LONG-TERM]</timehorizon>
<effort>[HIGH]</effort>

<differs>vs Proposal 1: Completely different ownership model — instead of Orama scoring + external reranker, scoring happens inside Orama's pipeline via hook. vs Proposal 2: Different data-flow — Proposal 2 is a two-stage pipeline (normalize → multiply). This is a single-stage replacement where the hook overwrites Orama's scores entirely with a custom formula.</differs>

## Design

### Register afterSearch Hook at DB Creation

```ts
const db = await create({
  schema,
  components: { tokenizer: hyphenAwareTokenizer },
  afterSearch: [unifiedScorer],
});
```

### Unified Scorer

The afterSearch hook receives `(db, params, language, results)` where `results` is the mutable Results object. We rewrite all hit scores:

```ts
function unifiedScorer(db, params, language, results) {
  const query = params.term?.toLowerCase().trim() || '';
  if (!query) return;
  
  const queryWords = query.split(/\s+/);
  
  for (const hit of results.hits) {
    const doc = hit.document;
    const title = doc.title?.toLowerCase() || '';
    const titleWords = title.split(/\W+/).filter(Boolean);
    
    // Component 1: Orama's BM25 as base (already computed)
    const bm25Base = hit.score;
    
    // Component 2: Title coverage ratio (0-1)
    const matchingWords = queryWords.filter(qw =>
      titleWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw))
    );
    const titleCoverage = queryWords.length > 0 ? matchingWords.length / queryWords.length : 0;
    
    // Component 3: Title position signal
    const startsWithQuery = queryWords.some(qw => title.startsWith(qw));
    const positionBonus = startsWithQuery ? 0.3 : 0;
    
    // Component 4: Domain signals
    const isEpic = doc.type === 'epic';
    const epicFactor = (isEpic && titleCoverage > 0) ? 1.1 : 1.0;
    const recencyFactor = computeRecency(doc);
    
    // Unified formula: weighted combination
    // BM25 provides base relevance, title coverage amplifies it
    const titleSignal = titleCoverage + positionBonus;  // 0 to 1.3
    hit.score = bm25Base * (1 + titleSignal * 2) * epicFactor * recencyFactor;
  }
  
  // Re-sort by new scores
  results.hits.sort((a, b) => b.score - a.score);
}
```

### No External Reranker

The `rerankWithSignals()` function is deleted entirely. All scoring logic lives in the afterSearch hook. The `search()` and `searchAll()` methods just return Orama's results directly.

## Evaluation

### Product design
Strong alignment — single scoring system means predictable, debuggable rankings. But the tight coupling to Orama's hook API is a product risk if we ever switch search engines.

### UX design
No UI changes. Results should be the most predictable of all three proposals since there's no two-system interaction.

### Architecture
Mixed. Eliminates the two-system problem entirely (good). But couples domain logic into Orama's hook system (bad). The hook receives document objects, not Task objects, so we lose type safety and access to fields not in the index (like `updated_at` for recency — we'd need to index it or use a cache lookup).

### Backward compatibility
Same score-range concerns as Proposal 2. Additionally, the afterSearch hook runs synchronously in Orama's pipeline, so we can't do async operations (like cache lookups) inside it.

### Performance
Slightly better than Proposal 2 — one scoring pass instead of two. But the difference is negligible for result sets of 20-100 items.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | Significant refactor: delete reranker, implement hook, handle cache access for task metadata, update all callers |
| Risk | 2 | Hook API is undocumented; synchronous constraint limits what signals we can use; tight Orama coupling |
| Testability | 3 | Hook is testable in isolation, but testing requires Orama instance (integration test, not unit test) |
| Future flexibility | 3 | Easy to add signals to the formula, but locked into Orama's hook contract |
| Operational complexity | 5 | No operational changes |
| Blast radius | 3 | Touches more code paths; hook errors could break all search, not just ranking |

## Pros
- Eliminates the two-system problem entirely — one scoring formula
- No magnitude mismatch possible — single system controls all scores
- Slightly better performance (one pass)
- Cleaner mental model: "search = Orama + our scorer"

## Cons
- Tight coupling to Orama's undocumented afterSearch hook API
- Hook is synchronous — can't access async data (task cache for recency, type info)
- Loses type safety (hook receives OramaDoc, not Task)
- Need to index additional fields (updated_at, type) or maintain parallel cache lookup
- Higher blast radius — hook errors break all search
- Harder to test (requires full Orama instance)
- If we ever switch from Orama, all scoring logic must be rewritten
