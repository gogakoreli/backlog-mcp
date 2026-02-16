# ADR-0079: Use Orama Native Filtering and Schema Best Practices

**Status**: Accepted  
**Date**: 2026-02-16  
**Supersedes**: None  
**Related**: ADR-0072 (re-ranking pipeline), ADR-0073 (server-side snippets)

## Context

An audit of `orama-search-service.ts` against Orama v3 API (`@orama/orama ^3.1.18`) revealed several deviations from the library's intended usage patterns. Each problem below cites the specific Orama source or documentation that defines the correct behavior.

### Problem 1: Post-search filtering instead of native `where` clause

Orama's `SearchParamsFullText` interface defines a `where` parameter:

> ```typescript
> where?: Partial<WhereCondition<...>>
> ```
> — [Orama types.ts, SearchParamsFullText](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) (also present on `SearchParamsHybrid` and `SearchParamsVector`)

The `where` clause is evaluated at the index level via `searchByWhereClause()` in Orama's `IIndex` interface, which returns a `Set<InternalDocumentID>` of matching IDs *before* scoring. This means filtered-out documents are never scored or ranked.

Our code ignored `where` entirely — it over-fetched `limit * 3` results, then filtered in JavaScript:

```typescript
// Old: fragile JS post-filtering
results = await search(db, { term: query, limit: limit * 3 });
hits = hits.filter(h => filters.status!.includes(h.task.status));
```

Two problems:
- **Performance**: Orama scores and ranks 3x more documents than needed.
- **Correctness**: If more than `limit * 3` documents match the text query, valid filtered results beyond that window are silently dropped. Proven by invariant test `where filtering has no window limit` (50 tasks, 45 done + 5 open, old code misses the open ones).

### Problem 2: Wrong schema types for filterable fields

Orama defines these schema types ([types.ts](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts)):

> ```typescript
> export type ScalarSearchableType = 'string' | 'number' | 'boolean' | 'enum' | 'geopoint'
> ```

The `where` clause operators differ by type:
- `string` fields: matched as substring/exact text (and are full-text indexed + tokenized)
- `enum` fields: support `eq`, `in`, `nin` operators via `EnumComparisonOperator`:
  > ```typescript
  > export type EnumComparisonOperator = {
  >   eq?: string | number | boolean
  >   in?: (string | number | boolean)[]
  >   nin?: (string | number | boolean)[]
  > }
  > ```
  > — [Orama types.ts, EnumComparisonOperator](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts)

Our `status`, `type`, and `epic_id` were declared as `'string'`, which meant:
1. They were full-text indexed and tokenized — searching "open" matched every task with status=open.
2. They couldn't use `eq`/`in`/`nin` operators for precise filtering.

`enum` is the correct type for low-cardinality filterable fields. Proven by invariant test `enum fields excluded from text search` — after the change, searching "in_progress" returns 0 results (no text match), and searching "open" only matches tasks with "open" in their title/description.

### Problem 3: No `properties` restriction on search

Orama's `SearchParamsFullText` supports:

> ```typescript
> properties?: '*' | FlattenSchemaProperty<T>[]
> ```
> — [Orama types.ts, SearchParamsFullText](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts)

When omitted, Orama searches ALL string-type fields. We weren't passing `properties`, so metadata fields like `path` were text-searched. With the `enum` change, `status`/`type`/`epic_id` are no longer string-type and won't be text-searched, but explicitly listing properties is still good practice.

### Problem 4: No `insertMultiple` for batch indexing

Orama exports `insertMultiple` ([source](https://github.com/oramasearch/orama/blob/main/packages/orama/src/methods/insert.ts)) which handles batch insertion. We were inserting one-by-one in a loop. Proven equivalent by invariant test `insertMultiple equivalence`.

### Problem 5: BM25 parameters

Orama supports tuning BM25 via the `relevance` parameter ([BM25 docs](https://docs.orama.com/docs/orama-js/search/bm25)):

```javascript
relevance: {
  k: 1.2,  // Term frequency saturation. Default 1.2, recommended 1.2–2.0
  b: 0.75, // Length normalization. Default 0.75, recommended ≥0.75
  d: 0.5,  // Frequency normalization lower bound. Default 0.5, recommended 0.5–1.0
}
```

The `b` parameter controls how much document length affects scoring. Higher `b` penalizes long documents more. Our documents vary wildly (short titles vs. long descriptions with concatenated evidence/references). However, we already compensate via field-level `boost` and custom re-ranking (ADR-0072), so changing BM25 defaults without empirical testing risks regressions.

## Decision

### Change 1: Schema — use `enum` for filterable fields

```typescript
const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  status: 'enum',          // was 'string' — enables where: { status: { in: [...] } }
  type: 'enum',            // was 'string' — enables where: { type: { eq: 'resource' } }
  epic_id: 'enum',         // was 'string' — enables where: { epic_id: { eq: 'EPIC-0001' } }
  evidence: 'string',
  blocked_reason: 'string',
  references: 'string',
  path: 'string',
} as const;
```

Bump `INDEX_VERSION` to `3` to force rebuild on existing caches.

### Change 2: Native `where` filtering

Replace all post-search JS filtering with Orama's `where` clause:

```typescript
const where: Record<string, any> = {};
if (filters?.status?.length) where.status = { in: filters.status };
if (filters?.type) where.type = { eq: filters.type };
if (filters?.epic_id) where.epic_id = { eq: filters.epic_id };
if (filters?.parent_id) where.epic_id = { eq: filters.parent_id };
if (docTypes) where.type = { in: docTypes };

search(db, { term: query, where, limit, boost, tolerance: 1 });
```

Also fix `taskToDoc` to store `parent_id ?? epic_id` as the indexed `epic_id` value, matching the old JS filter semantics of `(task.parent_id ?? task.epic_id)`.

Remove the `limit * 3` over-fetch pattern from `searchResources()` and `searchAll()`.

### Change 3: Restrict `properties` on search

```typescript
const TEXT_PROPERTIES = ['id', 'title', 'description', 'evidence', 'blocked_reason', 'references', 'path'];
search(db, { term: query, properties: [...TEXT_PROPERTIES], ... });
```

### Change 4: Use `insertMultiple` for batch indexing

In `index()` and `indexResources()` for BM25-only mode. Keep sequential for hybrid mode (async embeddings per doc).

### Change 5: BM25 `relevance` — keep defaults, document rationale

Keep Orama's BM25 defaults (`k: 1.2, b: 0.75, d: 0.5`). Our existing boost + re-ranking pipeline (ADR-0072) already handles field importance. Add code comment so future engineers know this was intentional, not overlooked.

## Evidence

### Orama API Sources

| Feature | Source | What it defines |
|---------|--------|-----------------|
| `where` clause | [types.ts: SearchParamsFullText.where](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) | Filter parameter on all search modes (fulltext, hybrid, vector) |
| `enum` type + operators | [types.ts: EnumComparisonOperator](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) | `eq`, `in`, `nin` operators for enum fields |
| `properties` restriction | [types.ts: SearchParamsFullText.properties](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) | Limit which fields are text-searched |
| `insertMultiple` | [methods/insert.ts](https://github.com/oramasearch/orama/blob/main/packages/orama/src/methods/insert.ts) | Batch insert API |
| BM25 `relevance` params | [BM25 docs](https://docs.orama.com/docs/orama-js/search/bm25), [types.ts: BM25Params](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) | `k`, `b`, `d` tuning knobs with defaults and recommended ranges |
| `searchByWhereClause` | [types.ts: IIndex.searchByWhereClause](https://github.com/oramasearch/orama/blob/main/packages/orama/src/types.ts) | Returns `Set<InternalDocumentID>` — proves filtering happens before scoring |
| Schema types | [Orama README](https://github.com/oramasearch/orama#usage) | Documents all 10 schema types including `enum` for filterable values |

### Invariant Tests

All behavioral claims are verified by `src/__tests__/orama-invariants.test.ts` (17 tests).

| Claim | Test | What it proves |
|-------|------|----------------|
| Enum fields not text-searchable | `enum fields excluded from text search` (3 tests) | Searching "open" matches title text, NOT status=open. Searching "in_progress" returns 0 results. |
| Native where = correct filtering | `native where filtering matches old JS filtering` (6 tests) | Single status, multi-status, type, epic_id, and combined filters all return correct subsets. |
| parent_id precedence | `parent_id precedence in where filtering` (2 tests) | Task with parent_id=FLDR-0001 is found by parent_id filter, NOT by epic_id filter. |
| No over-fetch window problem | `where filtering has no window limit` (1 test) | 50 tasks (45 done, 5 open), filter status=open → finds all 5. Old limit*3=30 code would have missed them. |
| insertMultiple equivalence | `insertMultiple equivalence` (1 test) | Batch and sequential indexing produce identical search results. |
| searchAll docType filtering | `searchAll native docType filtering` (3 tests) | docTypes=["resource"] returns only resources; combined with status filter works. |
| searchResources isolation | `searchResources native filtering` (1 test) | Never returns tasks, only resources. |

## Consequences

- `INDEX_VERSION` bumps to 3 — existing disk caches auto-rebuild on next start
- Filters are now exact and complete (no missed results from over-fetch window)
- Search no longer produces false positives from metadata field text matching
- Batch indexing is faster for BM25-only mode
- `where` clause works in both fulltext and hybrid modes (confirmed in Orama types)
- Re-ranking pipeline (ADR-0072) continues to work unchanged on top of filtered results
- 17 invariant tests prevent regression on all claims above
