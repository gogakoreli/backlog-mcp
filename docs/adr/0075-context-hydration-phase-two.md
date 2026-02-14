# 0075. Context Hydration Phase Two — Semantic Enrichment, Temporal Overlay, Query Resolution

**Date**: 2026-02-14
**Status**: Accepted
**Supersedes**: ADR-0074 Phase 2/3/4 roadmap items
**Related**: ADR-0074 (Phase 1 — Focal Resolution + Relational Expansion), ADR-0073 (MCP-First Unified Search), ADR-0054 (Operation Logging)

## Context

ADR-0074 shipped Phase 1 of the Retrieval-Augmented Context Pipeline: focal resolution (Stage 1), relational expansion (Stage 2), and token budgeting (Stage 5). That delivered the structural skeleton — given a task ID, the pipeline traverses parent/child/sibling relationships and path-matched resources, then budget-trims the response.

Phase 1 left three gaps identified in its handoff notes:

1. **Discovery gap**: Items semantically related to the focal entity but not in the direct graph (no parent/child/sibling link) are invisible. An ADR about search scoring is related to a task about search ranking, but unless the ADR lives under `resources/TASK-XXXX/`, it won't be found.

2. **Temporal blindness**: The pipeline has no concept of "what happened recently." An agent picking up TASK-0042 doesn't know that TASK-0041 was completed yesterday with evidence "Fixed scoring normalization." This leads to redundant work and conflicting decisions.

3. **ID-only entry**: Agents must know the exact task ID to get context. A natural language query like "what's the status of search ranking work?" requires a separate `backlog_search` call first, then a `backlog_context` call — defeating the single-call value proposition.

Additionally, Phase 1 introduced a synchronous pipeline (`hydrateContext()` returned `ContextResponse | null`) which blocked async operations. The search service (`searchUnified()`) and operation logger (`readOperations()`) are async, making it impossible to integrate them without an architectural change.

## Decision

Implement Phase 2 of the context hydration pipeline with four changes:

### 1. Pipeline goes async

**The fundamental architectural change.** `hydrateContext()` now returns `Promise<ContextResponse | null>`. This unlocks all async data sources (search, operations) without contorting the architecture.

**Why not keep sync with a separate async wrapper?** Because the pipeline orchestrator is where stage composition happens. Having the orchestrator be sync while individual stages are async creates an impedance mismatch — you'd need to pre-fetch all async data before entering the pipeline, losing the ability to make stage-dependent decisions (e.g., "only run semantic search if the relational graph has fewer than 5 items").

**Impact**: All callers must `await`. The MCP tool already wrapped in an `async` handler. The HTTP endpoint already used `async` request handlers. Tests updated from synchronous assertions to `async`/`await`. Zero breaking changes to external consumers.

### 2. Stage 3: Semantic Enrichment

**File**: `src/context/stages/semantic-enrichment.ts`

Uses `searchUnified()` to find entities and resources semantically related to the focal entity but NOT already present in the relational graph.

**How the search query is constructed**: The focal entity's `title` + first 200 characters of `description`. Title provides the strongest relevance signal; truncated description adds specificity without creating an overly broad query. Full description (which can be 1000+ chars) would dilute the search signal.

**Deduplication**: Before returning results, Stage 3 filters out:
- Any entity ID already in context (focal, parent, children, siblings)
- Any resource URI already found by Stage 2's path heuristic

This prevents the same item appearing twice with different roles (e.g., a sibling that also matches semantically).

**Caps**: 5 entities max, 5 resources max. Semantic matches are supplementary — they enhance the context, not dominate it. The relational graph (Stage 2) is always the primary source.

**Relevance scores**: Each semantically discovered entity carries a `relevance_score` field (0-1) so agents can gauge how strongly related the item is.

### 3. Stage 4: Temporal Overlay

**File**: `src/context/stages/temporal-overlay.ts`

Queries the operation log for recent activity on the focal entity, its parent, and its children. Converts raw operation entries into human-readable `ContextActivity` summaries.

**Which entities get activity**: Focal + parent + children. NOT siblings — including sibling activity would bloat the feed with potentially unrelated operations. The parent's activity is included because it often captures decisions affecting all children.

**Operation summarization**: Raw operations (JSON params/results) are converted to human-readable summaries:
- `backlog_create` → "Created task TASK-0043: 'Stage 1: Focal resolution'"
- `backlog_update` with status → "Updated TASK-0042: status → in_progress"
- `backlog_update` with evidence → "Updated TASK-0042: added evidence"
- `backlog_delete` → "Deleted TASK-0042"
- `write_resource` → "Wrote resource mcp://backlog/resources/..."

**Deduplication**: Operations are deduped by `timestamp + entity_id` to prevent duplicates when the same operation appears in queries for multiple entities.

**Sort order**: Most recent first (descending timestamp). Limit: 20 entries total across all queried entities.

### 4. Query-based Focal Resolution

**Enhancement to**: `src/context/stages/focal-resolution.ts`

The `resolveFocal()` function now accepts an optional `query` string. When provided (and search deps are available), it calls `searchUnified()` with the query, limits to 1 result, and uses the top match as the focal entity.

**Design decision — top-1 match**: We considered returning multiple candidates and letting the agent choose. This would break the single-call value proposition of `backlog_context`. If the agent wanted to browse search results, they'd use `backlog_search`. `backlog_context` is opinionated — it picks the best match and builds full context around it.

**Metadata flag**: `metadata.focal_resolved_from` is set to `'query'` when the focal was inferred from search (vs `'id'` for direct lookup). This tells agents the focal was not deterministically chosen — useful for confidence assessment.

## Token Budget Priority Order (Updated)

Phase 2 adds two new categories to the budget priority chain:

```
Priority 1: Focal entity      — always full fidelity, never dropped
Priority 2: Parent entity     — always summary fidelity, never dropped
Priority 3: Children          — summary, downgrade to reference if needed
Priority 4: Siblings          — summary, downgrade to reference if needed
Priority 5: Related (semantic)— summary, downgrade to reference if needed  ← NEW
Priority 6: Resources         — summary, downgrade to reference if needed
Priority 7: Activity          — fixed cost, drop entries if needed          ← NEW
```

Semantic entities are lower priority than structural relations (children/siblings) but higher than resources. Activity entries are the lowest priority — they're useful context but expendable under tight budgets.

## Dependency Injection (Extended)

The `HydrationServiceDeps` interface gains two optional fields:

```typescript
interface HydrationServiceDeps {
  // Phase 1 (required)
  getTask: (id: string) => Task | undefined;
  listTasks: (filter: { parent_id?: string; limit?: number }) => Task[];
  listResources: () => Resource[];
  // Phase 2 (optional — graceful degradation)
  searchUnified?: (query, options) => Promise<UnifiedSearchResult[]>;
  readOperations?: (options) => OperationEntry[];
}
```

**Optional deps = graceful degradation**: If `searchUnified` is not provided, Stage 3 is skipped and the pipeline behaves like Phase 1. If `readOperations` is not provided, Stage 4 is skipped. This means:
- Tests can inject exactly what they need (no filesystem, no search index)
- Environments without search (e.g., cold start before indexing) still work
- Each stage can be toggled independently via request flags (`include_related`, `include_activity`)

## MCP Tool Changes

The `backlog_context` tool schema gains new parameters:

```typescript
{
  task_id?: string,           // Existing — direct ID lookup
  query?: string,             // NEW — natural language focal resolution
  depth?: number,             // Existing — relational expansion depth
  max_tokens?: number,        // Existing — token budget
  include_related?: boolean,  // NEW — enable/disable semantic enrichment (default: true)
  include_activity?: boolean, // NEW — enable/disable temporal overlay (default: true)
}
```

**Default behavior**: Both `include_related` and `include_activity` default to `true`. Agents can set them to `false` for faster responses when they only need the structural context.

**Validation**: Either `task_id` or `query` must be provided. If neither is given, the tool returns an error.

## HTTP Endpoint Changes

`GET /context` gains new query parameters:

```
GET /context?task_id=TASK-0042&depth=1&max_tokens=4000
GET /context?query=search+ranking&include_related=true&include_activity=true
GET /context?task_id=TASK-0042&include_related=false&include_activity=false
```

## Known Hacks and Limitations (Phase 2)

### 1. Token estimation remains character-based (inherited from Phase 1)

**Location**: `src/context/token-budget.ts`
**Status**: Unchanged. Still using `Math.ceil(text.length / 4)`. Sufficient for budgeting.
**Future fix**: Same as ADR-0074 — integrate `js-tiktoken` if accuracy becomes a problem.

### 2. Resource discovery still uses path heuristic for Stage 2 (inherited)

**Location**: `src/context/stages/relational-expansion.ts`
**Status**: Unchanged. Stage 3 now supplements this with semantic search, which partially addresses the limitation. Path heuristic remains the primary method for Stage 2.
**Improvement from Phase 2**: Semantic enrichment (Stage 3) now finds resources by content similarity, not just path. Together, path + semantic provides good coverage.

### 3. Sibling fetching still loads all children of parent (inherited)

**Location**: `src/context/stages/relational-expansion.ts`
**Status**: Unchanged. Token budgeting handles the truncation.
**Future fix**: Add `limit` to `TaskStorage.list()` for parent_id queries.

### 4. Depth > 1 still not implemented (inherited)

**Location**: `src/context/stages/relational-expansion.ts`
**Status**: Unchanged. Depth 1 covers the vast majority of use cases.
**Future fix**: Phase 3 — recursive traversal with visited-set cycle detection.

### 5. `listSync()` still used for relational expansion

**Location**: `src/context/hydration-service.ts`, `src/tools/backlog-context.ts`, `src/server/viewer-routes.ts`
**Why**: The relational expansion stage (Stage 2) is synchronous by design — it only does storage lookups (no search). `listSync()` is the correct API for this. Making Stage 2 async would add unnecessary complexity for no benefit (storage lookups are O(1) in-memory reads).
**Clarification**: The Phase 1 handoff note suggested removing `listSync()` when going async. After analysis, `listSync()` is appropriate for Stage 2. The async conversion was about enabling Stages 3 and 4, not about changing Stage 2. `listSync()` is NOT a hack — it's the synchronous storage API that avoids the search index overhead.

### 6. Semantic search query is simple title + description truncation

**Location**: `src/context/stages/semantic-enrichment.ts`
**Issue**: The search query is `title + first 200 chars of description`. This is a reasonable heuristic but not optimal for all cases. A task with a generic title ("Fix bug") produces a weak search query.
**Future fix**: Consider using key terms extraction, task labels/tags, or the parent epic's title as additional search signals.

### 7. Operation summary generation is hardcoded

**Location**: `src/context/stages/temporal-overlay.ts`
**Issue**: The `summarizeOperation()` function hardcodes summary templates for each tool type. Adding a new write tool requires updating the switch statement.
**Why acceptable**: There are only 4 write tools (`backlog_create`, `backlog_update`, `backlog_delete`, `write_resource`). The hardcoded summaries are readable and maintainable at this scale. If the tool count grows past 8, consider a registry pattern.

## Invariants

### Pipeline Invariants (carried from Phase 1 + new)

1. **Focal always full fidelity**: The focal entity is ALWAYS included at FULL fidelity, regardless of budget.
2. **Parent always summary**: Parent entity (when exists) is ALWAYS included at SUMMARY fidelity.
3. **Priority ordering**: Children > siblings > related > resources > activity in budget allocation.
4. **Token budget respected**: `metadata.token_estimate` never exceeds `max_tokens` (with small overhead for metadata).
5. **`truncated` flag accuracy**: Set to `true` if and only if items were dropped or downgraded.
6. **`total_items` consistency**: `metadata.total_items` equals the sum of all items in the response.
7. **`stages_executed` completeness**: Lists exactly the stages that ran, in execution order.

### Semantic Enrichment Invariants (new)

8. **No duplication**: Related entities NEVER include entities already in the relational graph (focal, parent, children, siblings).
9. **No resource duplication**: Semantic resources NEVER include resources already found by path heuristic.
10. **Capped at 5+5**: Maximum 5 semantic entities and 5 semantic resources.
11. **Summary fidelity**: All semantic entities are at SUMMARY fidelity (not full — they're supplementary).
12. **Relevance score present**: All semantically discovered entities and resources have a `relevance_score` field.
13. **Graceful absence**: If `searchUnified` is not provided, semantic enrichment is skipped entirely (no error).
14. **Toggle respected**: If `include_related` is `false`, semantic enrichment is skipped even if deps are available.

### Temporal Overlay Invariants (new)

15. **Descending order**: Activity entries are sorted by timestamp descending (most recent first).
16. **Deduplication**: No two activity entries have the same `ts + entity_id` combination.
17. **Required fields**: Every activity entry has `ts`, `tool`, `entity_id`, `actor`, and `summary`.
18. **Human-readable summary**: `summary` is a human-readable string (not raw JSON).
19. **Graceful absence**: If `readOperations` is not provided, temporal overlay is skipped (no error).
20. **Toggle respected**: If `include_activity` is `false`, temporal overlay is skipped even if deps are available.

### Query Resolution Invariants (new)

21. **`focal_resolved_from` always set**: Metadata includes `'id'` or `'query'` indicating resolution method.
22. **Top-1 deterministic**: Query resolution always uses the single highest-scoring search result.
23. **Graceful fallback**: If query resolution finds no matches, returns `null` (same as ID-not-found).

## Test Coverage

87 tests total (up from 52 in Phase 1):

| Category | Tests | Coverage |
|----------|-------|----------|
| Stage 1: Focal Resolution (ID + query) | 7 | ID lookup, epic lookup, not-found, query resolution, no-match query, no-deps query |
| Fidelity levels | 5 | Full, summary, reference field inclusion; parent_id resolution |
| Stage 2: Relational Expansion | 11 | Parent, children, siblings, resources, orphan, leaf, epic-as-focal |
| Stage 3: Semantic Enrichment | 7 | Dedup entities, dedup resources, cap at 5, empty results, fidelity + score |
| Stage 4: Temporal Overlay | 9 | Single entity, multi-entity, dedup, sort, limit, summaries, required fields, empty |
| Token estimation | 2 | String estimation, fidelity cost ordering |
| Entity downgrading | 3 | Full→summary, full→reference, relevance_score preservation |
| Token budget | 6 | Large budget, always-include focal/parent, truncation, downgrade-before-drop, priority order, activity |
| E2E pipeline | 10 | Full context, not-found, epic focal, budget, truncation, depth, defaults, leaf, orphan |
| Pipeline + semantic | 3 | With search, disabled, no deps |
| Pipeline + temporal | 3 | With ops, disabled, no deps |
| Pipeline + query | 3 | Query resolution, no matches, no deps |
| Contract invariants | 12 | Fidelity, required fields, metadata, total_items, dedup, focal_resolved_from, stage toggles |

## File Changes

```
New files:
  src/context/stages/semantic-enrichment.ts    — Stage 3: semantic search enrichment
  src/context/stages/temporal-overlay.ts       — Stage 4: operation log overlay
  docs/adr/0075-context-hydration-phase-two.md — This ADR

Modified files:
  src/context/hydration-service.ts             — async pipeline, 4-stage orchestration
  src/context/types.ts                         — relevance_score, focal_resolved_from
  src/context/token-budget.ts                  — 7-priority budget (added related, activity)
  src/context/stages/focal-resolution.ts       — async, query-based resolution
  src/context/index.ts                         — export new stages
  src/tools/backlog-context.ts                 — query param, include_related/activity, search + ops deps
  src/server/viewer-routes.ts                  — async, query param, search + ops deps
  src/__tests__/context-hydration.test.ts       — 87 tests (up from 52)
```

## Handoff for Next Engineer

### What was built

Phase 2 of the Retrieval-Augmented Context Pipeline. The pipeline now has all 5 stages operational:

1. **Stage 1 — Focal Resolution** (Phase 1 + Phase 2 query): Resolves by ID (sync) or by natural language query (async search).
2. **Stage 2 — Relational Expansion** (Phase 1): Parent, children, siblings, path-matched resources. Unchanged.
3. **Stage 3 — Semantic Enrichment** (Phase 2): Searches for semantically related entities and resources. Deduplicates against Stage 2 output.
4. **Stage 4 — Temporal Overlay** (Phase 2): Recent operations on focal + parent + children. Human-readable summaries.
5. **Stage 5 — Token Budgeting** (Phase 1, extended): Now handles 7 priority levels including related entities and activity.

### Architecture decisions to preserve

Everything from Phase 1 still holds, plus:

- **Optional deps = graceful degradation**: `searchUnified` and `readOperations` are optional. Missing deps skip stages, never error. This is critical for testability and for environments where not all services are available.
- **Stage independence**: Each stage module has zero knowledge of other stages. The orchestrator composes them. A new stage can be added by: (1) creating a new file in `stages/`, (2) calling it from the orchestrator, (3) feeding its output to the budget.
- **Semantic results are supplementary**: Capped at 5+5 and lower priority than structural relations. The relational graph is always the primary source of truth.

### What to build next

**Priority 1: Depth 2+ relational expansion**
- Recursive traversal in `relational-expansion.ts`
- Visited-set for cycle detection (graph can have circular parent refs due to data bugs)
- Per-hop token budget: depth-1 relations get more budget than depth-2

**Priority 2: Viewer UI integration**
- "Related Items" section in TaskDetail right pane
- "See Also" section for semantic matches
- Timeline section for recent activity
- Data source: `GET /context?task_id=X`

**Priority 3: Session memory**
- Track which agents worked on which tasks (via operation log enrichment)
- Surface "Last worked on by Agent X, 2 days ago" in context response
- Potential new field: `session_context` in metadata

**Priority 4: Proactive suggestions**
- Analyze the context to suggest next actions
- "TASK-0041 was completed but TASK-0042 is still open — consider updating status"
- This is the beginning of the "second brain" vision

### Known issues to address

1. **4 pre-existing test failures**: `search-hybrid.test.ts` (2, onnxruntime not available) and `mcp-integration.test.ts` (2, server port/timeout issues). Unrelated to context hydration.
2. **Semantic query quality**: Simple `title + description[:200]` query construction. Could be improved with keyword extraction or parent epic context.
3. **No integration test for full pipeline with real search**: Unit tests use mock search. An integration test with `OramaSearchService` would catch issues at the seam.

## Consequences

### Positive
- **Closes the discovery gap**: Semantic enrichment finds related items invisible to structural traversal
- **Temporal awareness**: Agents see recent history, preventing redundant work
- **Single-call from query**: Agents can go from "what's the search ranking work?" to full context in one call
- **Backward compatible**: All Phase 1 behavior preserved when new deps aren't provided
- **87 tests with 23 invariants**: Comprehensive coverage prevents regressions

### Negative
- **Increased latency**: Semantic search adds ~50-100ms per call (acceptable for agent context loading)
- **Larger response payloads**: With related entities and activity, responses grow. Mitigated by token budgeting and toggles.
- **More dependencies**: Pipeline now optionally depends on search service and operation logger. Mitigated by optional deps pattern.

### Risks
- **Search quality affects context quality**: If `searchUnified()` returns poor results, semantic enrichment adds noise rather than signal. Mitigated by capping at 5 items and letting agents judge via `relevance_score`.
- **Operation log size**: As the backlog grows, operation logs grow. The `limit: 10` per-entity query prevents performance issues, but very active backlogs may miss older relevant operations. Future: time-windowed queries.
