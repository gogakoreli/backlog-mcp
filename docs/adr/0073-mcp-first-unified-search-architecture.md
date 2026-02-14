# 0073. MCP-First Unified Search Architecture

**Date**: 2026-02-14
**Status**: Proposed
**Supersedes**: None (consolidates ADR-0038 Phase 4 vision, ADR-0047 Unified Search API)
**Related**: ADR-0038 (Comprehensive Search), ADR-0047 (Unified Search API), ADR-0042 (Hybrid Search), ADR-0072 (Scoring)

## Problem Statement

The current architecture has a **dual-path problem**: the MCP server and the web viewer UI consume search through different channels with different capabilities, creating divergence:

```
Current Architecture (Dual Path):

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
Target Architecture:

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
│              Shared Service Core                 │
│  BacklogService + OramaSearchService             │
│                                                  │
│  searchUnified(query, options) ← SINGLE METHOD   │
│  list(filters)                ← filtering only   │
│  get(id)                      ← single item      │
│  getResources(query)          ← resource access   │
│                                                  │
│  Same method, same options, same results         │
│  regardless of whether caller is MCP or HTTP     │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│              OramaSearchService                  │
│  BM25 + Vector Hybrid Search                     │
│  Normalize-Then-Multiply Scoring (ADR-0072)      │
│  Tasks + Epics + Resources unified index         │
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

### New MCP Tool: `backlog_search`

A dedicated search tool that exposes the full search capabilities available in the OramaSearchService:

```typescript
interface BacklogSearchParams {
  // Required
  query: string;              // Natural language or keyword query

  // Filtering
  types?: ('task' | 'epic' | 'resource')[];  // Default: all types
  status?: Status[];          // Filter by status (tasks/epics only)
  parent_id?: string;         // Scope to parent (epic/folder)

  // Ranking
  sort?: 'relevant' | 'recent';  // Default: relevant

  // Output
  limit?: number;             // Default: 20, max: 100
  include_content?: boolean;  // Include full description/content. Default: false
  include_scores?: boolean;   // Include relevance scores. Default: false
}

interface BacklogSearchResult {
  results: {
    id: string;
    title: string;
    type: 'task' | 'epic' | 'resource';
    status?: string;           // For tasks/epics
    parent_id?: string;        // For tasks
    path?: string;             // For resources
    score?: number;            // When include_scores=true
    snippet?: string;          // Matched context (plain text, ~100 chars)
    description?: string;      // When include_content=true
  }[];
  total: number;               // Total matches (may exceed limit)
  query: string;               // Echo back for agent reference
  search_mode: 'hybrid' | 'bm25';  // Which mode was used
}
```

### Design Principles

1. **MCP is source of truth**: Every capability the UI offers must be available through an MCP tool. If the UI can do it, agents can do it.

2. **Shared service core**: Both MCP tools and HTTP endpoints call the same `BacklogService` methods with the same parameters. No forked code paths.

3. **HTTP endpoints are thin adapters**: The HTTP routes in `viewer-routes.ts` translate query params to service calls — they add no logic of their own.

4. **`backlog_list` stays for filtering**: The existing `backlog_list` tool retains its role for status/type/parent filtering. Its `query` parameter continues to work but for discovery-oriented search, agents should use `backlog_search`.

5. **Server-side snippets**: Move snippet generation to the server so MCP tool responses include meaningful context. Currently snippets are generated client-side in spotlight-search.ts using `@orama/highlight`. The server should return a plain-text snippet with the matched context for each result.

## Implementation Plan

### Phase 1: `backlog_search` MCP Tool

Create the new search tool that wraps `BacklogService.searchUnified()`:

**Files:**
- `src/tools/backlog-search.ts` — New tool registration
- `src/tools/index.ts` — Register the new tool
- `src/storage/backlog-service.ts` — Add server-side snippet generation

**Behavior:**
- Calls `storage.searchUnified(query, options)` — the same method the `/search` HTTP endpoint uses
- Returns structured results with optional scores and snippets
- Supports all filter/sort/type options
- Includes `search_mode` indicator so agents know if semantic search is active

### Phase 2: HTTP Endpoint Alignment

Ensure HTTP endpoints are pure thin adapters over the shared service:

**Current state (already good):**
- `GET /search` → `storage.searchUnified(q, options)` ✅
- `GET /tasks` → `storage.list(filters)` ✅

**Needed alignment:**
- Server-side snippet generation added in Phase 1 should also be used by `/search` so the UI can optionally consume server-generated snippets instead of generating them client-side

### Phase 3: Resource Access via MCP

Resources are currently only accessible via the `write_resource` tool (for creating/updating) and via internal HTTP endpoints. Add read access:

**Option A (Recommended)**: Extend `backlog_get` to accept resource IDs
- `backlog_get({ id: "mcp://backlog/resources/design/architecture.md" })`
- Returns resource content as markdown

**Option B**: Dedicated `backlog_read_resource` tool
- Separate tool for resource read operations
- More explicit but increases tool surface area

**Decision**: Option A — extend `backlog_get`. Resource IDs are already namespaced (MCP URIs), so there's no ambiguity. This keeps the tool surface minimal.

### Phase 4: Context Hydration (Future)

Building on the `backlog_search` foundation, implement the context hydration API from ADR-0038 Phase 4:

- `backlog_context` tool for retrieving semantically relevant context
- Graph relations (epic→task, references, dependencies)
- Temporal memory (recent activity, session context)
- Context composer that ranks and compresses results for LLM context windows

This phase is deferred but the `backlog_search` tool provides the foundation.

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
- **Server-side snippets**: Additional computation per search result. Mitigated by keeping it optional (`include_content` flag).
- **Migration period**: Both `backlog_list(query=...)` and `backlog_search(query=...)` will support search. Need documentation clarity on when to use which.

### Risks

- **LLM tool confusion**: Agents might not know when to use `backlog_search` vs `backlog_list(query=...)`. Mitigation: clear tool descriptions. `backlog_list` describes itself for filtering, `backlog_search` describes itself for discovery.
- **Snippet quality**: Server-side plain-text snippets may be less rich than client-side HTML snippets. Mitigation: UI can continue using client-side `@orama/highlight` for HTML rendering while consuming server snippets as fallback.

## Migration Path

1. **Phase 1 (immediate)**: Ship `backlog_search` tool. No breaking changes.
2. **Phase 2 (next)**: Add server-side snippets to `/search` endpoint. UI can adopt gradually.
3. **Phase 3 (next)**: Extend `backlog_get` for resources. No breaking changes.
4. **Phase 4 (future)**: `backlog_context` builds on `backlog_search`. No breaking changes.

Each phase is independently shippable and backward compatible.

## Success Criteria

- [ ] `backlog_search` MCP tool registered and functional
- [ ] `backlog_search` uses the same `searchUnified()` method as `/search` HTTP endpoint
- [ ] Agents can search across tasks, epics, AND resources via MCP
- [ ] Results include type, status, and optional scores/snippets
- [ ] Resources are readable via `backlog_get`
- [ ] All existing tests continue to pass
- [ ] New tests cover `backlog_search` tool registration and parameter handling

## Related Work

- **ADR-0038**: Comprehensive search capability (established OramaSearchService, SearchService abstraction)
- **ADR-0042**: Hybrid search with local embeddings (BM25 + vector search)
- **ADR-0047**: Unified search API (created `/search` endpoint with `UnifiedSearchResult` type)
- **ADR-0072**: Normalize-then-multiply scoring (current ranking algorithm)
- **ADR-0048**: Resource search integration (resources in search index)
