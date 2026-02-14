# 0073. MCP-First Unified Search Architecture

**Date**: 2026-02-14
**Status**: Accepted
**Supersedes**: None (consolidates ADR-0038 Phase 4 vision, ADR-0047 Unified Search API)
**Related**: ADR-0038 (Comprehensive Search), ADR-0047 (Unified Search API), ADR-0042 (Hybrid Search), ADR-0072 (Scoring)

## Problem Statement

The current architecture has a **dual-path problem**: the MCP server and the web viewer UI consume search through different channels with different capabilities, creating divergence:

```
Before (Dual Path):

┌──────────────────┐         ┌──────────────────┐
│  LLM Agent       │         │  Web Viewer UI    │
│  (MCP Client)    │         │  (Browser)        │
└────────┬─────────┘         └────────┬──────────┘
         │                            │
         │ backlog_list(query=...)     │ GET /search?q=...
         │ (limited: no types,        │ (full: types, sort,
         │  no sort, no resources,    │  resources, scores)
         │  no scores)                │
         ▼                            ▼
┌──────────────────┐         ┌──────────────────┐
│  BacklogService   │         │  BacklogService   │
│  .list(query)     │         │  .searchUnified() │
└──────────────────┘         └──────────────────┘
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│              OramaSearchService                  │
│  (shared, but accessed via different methods)    │
└─────────────────────────────────────────────────┘
```

### Specific Problems

1. **MCP tool `backlog_list` has limited search**: The `query` parameter does basic search through `storage.list()` — it lacks type filtering, sort modes, resource search, relevance scores, and cross-type ranking. Agents get inferior search compared to the UI.

2. **UI bypasses MCP**: The viewer calls HTTP endpoints (`/search`, `/tasks`) directly, not through MCP tools. This means the UI and MCP are not using the same interface — they share the same *backend service* but consume it differently.

3. **No dedicated search tool for MCP**: Search is an afterthought parameter on `backlog_list`. Agents can't perform discovery-oriented searches (across tasks, epics, AND resources) the way the UI's spotlight can.

4. **Resources are invisible to agents**: Resources (markdown files in `resources/`) are searchable via the UI spotlight but have no MCP tool exposure. Agents cannot discover or search resources.

5. **No context hydration for agents**: ADR-0038 Phase 4 envisioned a `backlog_context` tool for RAG-powered context retrieval, but the current architecture provides no path for agents to get semantically relevant context — they must manually piece together information from multiple `backlog_list` and `backlog_get` calls.

## Decision

Establish the **backlog MCP server as the single source of truth** for all search and retrieval capabilities. The web viewer UI must consume the same search capabilities that the MCP server exposes — either by calling MCP tools directly or by calling shared service methods that are identical to what the MCP tools use internally.

### Architecture: MCP-First with Shared Service Core

```
After (Unified Path):

┌──────────────────┐         ┌──────────────────┐
│  LLM Agent       │         │  Web Viewer UI    │
│  (MCP Client)    │         │  (Browser)        │
└────────┬─────────┘         └────────┬──────────┘
         │                            │
         │ backlog_search(...)        │ GET /search?q=...
         │ backlog_list(...)          │ GET /tasks?...
         │ backlog_get(...)           │ GET /tasks/:id
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│        Shared Service Core (BacklogService)      │
│                                                  │
│  searchUnified(query, opts) ← SINGLE METHOD      │
│  list(filters)              ← filtering only     │
│  get(id)                    ← task by ID         │
│  getResource(uri)           ← resource by URI    │
│  isHybridSearchActive()     ← diagnostics        │
│                                                  │
│  Same method, same options, same results         │
│  regardless of whether caller is MCP or HTTP     │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│          OramaSearchService.searchAll()           │
│  • BM25 + Vector Hybrid Search                    │
│  • Normalize-Then-Multiply Scoring (ADR-0072)     │
│  • Server-side snippet generation                 │
│  • Tasks + Epics + Resources unified index        │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│              Data Layer                          │
│  TaskStorage (markdown files)                    │
│  ResourceManager (resource files)                │
│  .cache/search-index.json (persistence)          │
└─────────────────────────────────────────────────┘
```

### Design Principles

1. **MCP is source of truth**: Every capability the UI offers must be available through an MCP tool. If the UI can do it, agents can do it.

2. **Shared service core**: Both MCP tools and HTTP endpoints call the same `BacklogService` methods with the same parameters. No forked code paths.

3. **HTTP endpoints are thin adapters**: The HTTP routes in `viewer-routes.ts` translate query params to service calls — they add no logic of their own.

4. **`backlog_list` stays for filtering**: The existing `backlog_list` tool retains its role for status/type/parent filtering. Its `query` parameter continues to work but for discovery-oriented search, agents should use `backlog_search`.

5. **Server-side snippets**: Snippet generation lives in the search service so all consumers (MCP and HTTP) get consistent match context.

## Implementation (Complete)

### Phase 1: `backlog_search` MCP Tool — ✅ Done

**New MCP tool**: `backlog_search` registered in `src/tools/backlog-search.ts`

```typescript
// Tool parameters
{
  query: string;              // Required — search query
  types?: SearchableType[];   // Filter: task, epic, resource
  status?: Status[];          // Filter: open, in_progress, etc.
  parent_id?: string;         // Scope to parent epic/folder
  sort?: 'relevant' | 'recent';
  limit?: number;             // 1-100, default 20
  include_content?: boolean;  // Full description/content
  include_scores?: boolean;   // Relevance scores
}

// Response shape
{
  results: [...],
  total: number,
  query: string,              // Echo for agent context
  search_mode: 'hybrid' | 'bm25'
}
```

**Implementation decision — `backlog_search` calls `storage.searchUnified()`**: This is the same method that `GET /search` uses. The tool is a thin adapter that translates Zod-validated input into the shared service call.

**Implementation decision — Response shaping in the tool**: The MCP tool shapes the response (selecting which fields to include based on `include_content` and `include_scores`) rather than adding a separate response-shaping layer in BacklogService. This keeps the service generic while allowing each consumer (MCP tool, HTTP endpoint) to shape its output.

### Phase 2: Server-Side Snippet Generation — ✅ Done

**New type**: `SearchSnippet` in `src/search/types.ts`

```typescript
interface SearchSnippet {
  field: string;            // Which field matched (title, description, etc.)
  text: string;             // Plain-text excerpt (~120 chars)
  matched_fields: string[]; // All fields with matches
}
```

**New functions**: `generateTaskSnippet()` and `generateResourceSnippet()` exported from `src/search/orama-search-service.ts`

**Implementation decision — Snippet generation lives in OramaSearchService, not BacklogService**: Snippets are generated inside `searchAll()` because that's where we have both the query and the full item data. This makes snippets always present in `searchAll()` results — consumers can't accidentally skip them.

**Implementation decision — Plain-text snippets (not HTML)**: The server generates plain-text snippets. The UI's client-side `@orama/highlight` library continues to handle HTML rendering with `<mark>` tags. This is intentional:

- MCP tool consumers (LLM agents) need plain text, not HTML
- The UI has richer rendering needs (highlight colors, DOMPurify) that are best done client-side
- Server snippets serve as a canonical fallback — the UI could adopt them to reduce client computation

### Phase 3: Resource Access via MCP — ✅ Done

**Extended tool**: `backlog_get` now accepts MCP resource URIs in addition to task IDs.

```
backlog_get({ id: "TASK-0001" })           → task markdown
backlog_get({ id: "mcp://backlog/resources/design.md" })  → resource content
backlog_get({ id: ["TASK-0001", "mcp://backlog/resources/design.md"] })  → batch
```

**Implementation decision — Extend `backlog_get` vs new tool**: We extended `backlog_get` rather than creating a separate `backlog_read_resource` tool because:
- Task IDs and MCP URIs are unambiguous (different formats)
- Reduces tool surface area (agents have fewer tools to reason about)
- Batch fetch naturally supports mixing tasks and resources

**New BacklogService method**: `getResource(uri)` delegates to `resourceManager.read(uri)` with error handling.

### Phase 4: HTTP Endpoint Alignment — ✅ Done (Already Aligned)

**Key insight**: The `GET /search` endpoint was already a thin adapter calling `storage.searchUnified()`. Since we enhanced `searchUnified()` to include snippets, the HTTP response now automatically includes them — no code change needed in `viewer-routes.ts`.

**Extended `searchUnified()` signature**: Now accepts `status` and `parent_id` filters directly, aligning with the `backlog_search` tool's capabilities:

```typescript
async searchUnified(query: string, options?: {
  types?: SearchableType[];
  limit?: number;
  sort?: 'relevant' | 'recent';
  status?: Status[];     // NEW — task/epic status filter
  parent_id?: string;    // NEW — scope to parent
}): Promise<UnifiedSearchResult[]>
```

### Phase 5: Context Hydration — Deferred (Future)

Building on the `backlog_search` foundation, implement the context hydration API from ADR-0038 Phase 4. The `backlog_search` tool provides the retrieval layer; `backlog_context` will add graph relations, temporal memory, and context compression.

## Documented Hacks & Known Issues

### 1. `backlog_list` still has a separate search code path

**Location**: `BacklogService.list()` in `src/storage/backlog-service.ts`

**Issue**: When `list()` is called with a `query`, it calls `this.search.search()` (the task-only search method) instead of `searchUnified()`. This is the legacy dual-path that ADR-0073 aims to eliminate.

**Why it exists**: `backlog_list` is the original MCP tool for filtering tasks. Adding a `query` parameter was a pragmatic early decision (pre-ADR-0047). Changing `list()` to use `searchUnified()` would change its return type from `Task[]` to `UnifiedSearchResult[]`, which is a breaking change for all `backlog_list` consumers.

**Impact**: Agents using `backlog_list(query=...)` get inferior search (no resources, no type filtering, no snippets) compared to `backlog_search`. This is documented in both tool descriptions so agents know to prefer `backlog_search` for discovery.

**Future fix**: Deprecate the `query` parameter on `backlog_list` and remove it in a major version. All search should go through `backlog_search`.

### 2. Dual snippet generation (server + client)

**Location**: Server in `orama-search-service.ts`, client in `viewer/components/spotlight-search.ts`

**Issue**: Snippets are generated in two places: the server generates plain-text snippets via `generateTaskSnippet()`/`generateResourceSnippet()`, while the UI's spotlight search generates HTML snippets client-side via `@orama/highlight`.

**Why it exists**: The client-side highlighting predates server snippets (ADR-0039). We can't remove client-side highlighting without degrading the UI experience (it produces richer HTML with `<mark>` tags and trimmed context windows).

**Impact**: Redundant computation — the server generates a snippet that the UI ignores in favor of its own. No functional impact, but violates DRY.

**Future fix**: The UI could consume server-provided snippets and add HTML wrapping client-side, eliminating the `@orama/highlight` dependency. This would reduce the viewer bundle size by ~2KB.

### 3. `storage.list()` score injection hack

**Location**: `BacklogService.list()` line 64 in `backlog-service.ts`

```typescript
return results.map(r => ({ ...r.task, score: r.score }));
```

**Issue**: This spreads `score` onto the `Task` object, creating a type impurity (`score` is not in the `Task` interface). This was documented in ADR-0047 as a known issue.

**Impact**: Consumers must use `(task as any).score` to access the score. The `backlog_search` tool avoids this entirely by returning structured `{ results, total, query }` with scores in their own field.

**Future fix**: Remove when `backlog_list`'s `query` parameter is deprecated.

### 4. Post-search filtering instead of indexed filtering

**Location**: `OramaSearchService.searchAll()` in `orama-search-service.ts`

**Issue**: Status, type, epic_id, and parent_id filters are applied AFTER Orama returns results, not during the Orama query. This means Orama may return results that get filtered out, potentially reducing the effective result count below the requested limit.

**Why it exists**: Orama's native enum filtering requires schema changes and adds complexity. Post-search filtering is simpler and works well for our dataset size (<10K items).

**Impact**: A search for `query=X&status=open&limit=20` might return fewer than 20 results even if 20+ open items match, because Orama returned 60 results (limit*3) and only N were open.

**Mitigation**: The `limit * 3` overfetch multiplier (line 672) compensates. For datasets <10K items, this is sufficient.

**Future fix**: Use Orama's `where` clause for indexed filtering when dataset size grows past 10K.

## Alternatives Considered

### Option 1: UI Calls MCP Tools Directly

Make the web viewer act as an MCP client, calling `backlog_search` through the MCP protocol instead of HTTP endpoints.

**Rejected because:**
- Adds significant complexity (MCP client in browser, WebSocket/SSE transport)
- Higher latency (MCP protocol overhead for every search)
- The shared service core achieves the same goal (same code path) without the protocol overhead
- HTTP endpoints are natural for browser clients

### Option 2: GraphQL Unified API

Replace both MCP tools and HTTP endpoints with a GraphQL API that serves both.

**Rejected because:**
- Adds heavy dependency (GraphQL server, schema, resolvers)
- MCP protocol is the standard for LLM agent communication — we shouldn't replace it
- Over-engineering for our scale

### Option 3: Keep Dual-Path, Just Add Search to backlog_list

Extend `backlog_list` with all the search options (types, sort, scores) instead of creating a new tool.

**Rejected because:**
- `backlog_list` is already complex with 7 parameters
- Listing and searching are conceptually different operations (filtering vs. discovery)
- Overloaded tools confuse LLM agents — they work better with clear, focused tools
- Doesn't solve resource search or snippet generation

## Consequences

### Positive

- **Parity**: Agents get the same search quality as the UI — type filtering, sort modes, cross-type search, relevance scores
- **Single source of truth**: One search implementation, one ranking algorithm, one index — no divergence possible
- **Agent empowerment**: Dedicated search tool with clear semantics for LLM agents
- **Resource discovery**: Agents can find and access resources for the first time
- **Foundation for RAG**: `backlog_search` provides the retrieval layer that `backlog_context` (Phase 4) will build on
- **Maintainability**: Changes to search logic automatically apply to both MCP and UI

### Negative

- **New tool surface**: `backlog_search` adds one more MCP tool (6 total → 7). Acceptable given the distinct use case.
- **Server-side snippets**: Additional computation per search result (~0.1ms per item, negligible).
- **Migration period**: Both `backlog_list(query=...)` and `backlog_search(query=...)` support search. Documented in tool descriptions to avoid agent confusion.

### Risks

- **LLM tool confusion**: Agents might not know when to use `backlog_search` vs `backlog_list(query=...)`. Mitigation: clear tool descriptions. `backlog_list` describes itself for filtering, `backlog_search` describes itself for discovery.
- **Snippet quality**: Server-side plain-text snippets are less rich than client-side HTML snippets. Mitigation: UI continues using `@orama/highlight` for rendering; server snippets are the canonical fallback.

## Success Criteria

- [x] `backlog_search` MCP tool registered and functional
- [x] `backlog_search` uses the same `searchUnified()` method as `/search` HTTP endpoint
- [x] Agents can search across tasks, epics, AND resources via MCP
- [x] Results include type, status, and optional scores/snippets
- [x] Resources are readable via `backlog_get` (supports MCP URIs)
- [x] All existing tests continue to pass (506/506)
- [x] 27 new invariant tests verify architectural guarantees

## Test Coverage

27 invariant tests in `src/__tests__/mcp-search-invariants.test.ts`:

| Invariant | Tests | Verifies |
|-----------|-------|----------|
| searchAll returns snippets | 4 | Every result has snippet.field, snippet.text, snippet.matched_fields |
| Snippet generation correctness | 10 | Title/description/evidence/blocked_reason matching, multi-field reporting, truncation, fallback |
| Type filtering | 4 | docTypes=task/epic/resource work correctly, no filter returns all |
| Sort modes | 2 | recent=by updated_at, relevant=by score |
| Snippet determinism | 2 | Same input → same output |
| SearchSnippet contract | 1 | Runtime type verification |
| Edge cases | 4 | Empty query, whitespace, missing fields don't crash |

## File Changes

```
src/
├── tools/
│   ├── backlog-search.ts     # NEW — backlog_search MCP tool
│   ├── backlog-get.ts        # MODIFIED — supports resource URIs
│   └── index.ts              # MODIFIED — registers backlog_search
├── search/
│   ├── types.ts              # MODIFIED — added SearchSnippet type
│   ├── orama-search-service.ts  # MODIFIED — snippet generation, searchAll returns snippets
│   └── index.ts              # MODIFIED — exports SearchSnippet
├── storage/
│   └── backlog-service.ts    # MODIFIED — searchUnified extended, getResource, isHybridSearchActive
└── __tests__/
    └── mcp-search-invariants.test.ts  # NEW — 27 invariant tests

docs/adr/
└── 0073-mcp-first-unified-search-architecture.md  # THIS FILE
```

## Related Work

- **ADR-0038**: Comprehensive search capability (established OramaSearchService, SearchService abstraction)
- **ADR-0042**: Hybrid search with local embeddings (BM25 + vector search)
- **ADR-0047**: Unified search API (created `/search` endpoint with `UnifiedSearchResult` type)
- **ADR-0072**: Normalize-then-multiply scoring (current ranking algorithm)
- **ADR-0048**: Resource search integration (resources in search index)
