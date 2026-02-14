# 0074. Agent Context Hydration Architecture

**Date**: 2026-02-14
**Status**: Accepted
**Supersedes**: ADR-0038 Phase 4 vision (backlog_context concept)
**Related**: ADR-0073 (MCP-First Unified Search), ADR-0042 (Hybrid Search), ADR-0065 (Unified Entity Model), ADR-0054 (Operation Logging)

## Vision

backlog-mcp is evolving from a task tracker into a **context engineering platform** — a second brain for humans and AI agents working together. The long-term vision:

1. **Brain dump**: A place where humans and agents capture ideas, decisions, research, and tasks without friction. Information goes in easily and comes out intelligently.

2. **Context engineering first-class citizen**: Agents working on backlog tasks should never need to manually piece together context from multiple tool calls. The system should understand what an agent needs to know and deliver it in a single, structured response — the right information, at the right depth, within token budget.

3. **AI-human co-evolution**: The backlog becomes a shared workspace where human intent (captured as tasks, ADRs, notes) and agent execution (captured as operations, evidence, artifacts) co-evolve. Each session builds on the last. Agents inherit institutional knowledge; humans see agent reasoning.

4. **Memory layer**: Across sessions, agents lose context. The backlog acts as persistent memory — not just "what tasks exist" but "what was the agent working on, what decisions were made, what's the current state of understanding."

## Problem Statement

### The Context Assembly Problem

When an agent begins work on a backlog task, it needs rich context to be effective. Today, this requires **5-10 sequential MCP tool calls** and significant agent reasoning to assemble:

```
Agent wants to work on TASK-0042: "Implement search ranking improvements"

Step 1: backlog_get("TASK-0042")          → task description
Step 2: backlog_get("EPIC-0005")          → parent epic context
Step 3: backlog_list(parent_id="EPIC-0005") → sibling tasks (what else is in this epic?)
Step 4: backlog_search("search ranking")  → related tasks across backlog
Step 5: backlog_get("TASK-0040")          → predecessor task details
Step 6: backlog_get("TASK-0041")          → related task details
Step 7: backlog_get("mcp://backlog/resources/adr/0051-multi-signal-search-ranking.md")
                                          → relevant ADR (if agent even knows it exists)
Step 8: backlog_get("mcp://backlog/resources/adr/0072-normalize-then-multiply-scoring.md")
                                          → another relevant ADR
```

**Problems with this approach:**

1. **Token waste**: Each round-trip costs tokens for the tool call, response parsing, and reasoning. 8 calls × ~500 tokens each = ~4,000 tokens just on plumbing, before the agent does any real work.

2. **Discovery gap**: The agent must *know* that ADR-0051 and ADR-0072 exist to fetch them. It has no way to discover related resources without searching. Even with `backlog_search`, finding the *right* resources requires good query formulation — something agents aren't always good at.

3. **No relational awareness**: The agent doesn't know that TASK-0040 was the predecessor to TASK-0042 unless the description explicitly says so. The graph structure (parent/child, sibling, reference links) is implicit in the data but invisible to the agent.

4. **No temporal context**: The agent doesn't know that TASK-0041 was completed yesterday with evidence "Fixed scoring normalization in PR #47". This temporal context could prevent the agent from re-doing work or making conflicting decisions.

5. **Session amnesia**: If the same agent (or a different agent) worked on this epic last week, all that session context is lost. The agent starts from zero every time.

### The Viewer Integration Problem

The web viewer currently shows tasks in isolation. When a user views TASK-0042, they see its metadata and description — but not the constellation of related context that would help them understand the task's place in the broader work. The context hydration system should power a richer viewer experience:

- "Related items" panel showing connected tasks, resources, and activity
- Context graph visualization (parent → children → resources)
- Temporal view of recent activity on related items

### What We Have Today

The foundation is strong:

| Capability | Status | Location |
|-----------|--------|----------|
| Full-text + semantic search | ✅ Shipped | `OramaSearchService` |
| Parent/child relationships | ✅ Shipped | `parent_id` field on Task |
| Resource indexing + search | ✅ Shipped | `ResourceManager` + search index |
| Operation audit trail | ✅ Shipped | `OperationLogger` + `.cache/operations.jsonl` |
| Real-time events (SSE) | ✅ Shipped | `EventBus` + SSE streaming |
| MCP-first search | ✅ Shipped | `backlog_search` tool (ADR-0073) |
| Unified entity model | ✅ Shipped | 5 substrate types (ADR-0065) |

**What's missing is the orchestration layer** — something that composes these primitives into a coherent context response, with intelligence about what to include and awareness of token budgets.

## Proposals

### Proposal 1: Context Bundle Tool (Single-Call Monolith)

**Architecture**: A `backlog_context` MCP tool that, given a focal point (task ID or query), performs a fixed traversal pattern and returns a pre-assembled "context bundle" — a flat JSON response with all related entities grouped by relationship type.

```
backlog_context({ task_id: "TASK-0042" })

→ {
    focal: { ...task },
    parent: { ...epic },
    siblings: [ ...tasks ],
    children: [ ...subtasks ],
    resources: [ ...related ADRs, docs ],
    recent_activity: [ ...operations ],
  }
```

**How it works**:
1. Resolve focal entity (task/epic/resource)
2. Fixed-depth traversal: parent → siblings → children → resources → references
3. Fetch recent operations for focal + parent
4. Return everything as a flat structure

**Strengths**:
- Simplest implementation — one function, deterministic output
- Easy for agents to consume (predictable shape)
- Easy for viewer to render (fixed sections)

**Weaknesses**:
- **Rigid**: The traversal pattern is hardcoded. An agent working on an epic needs different context than an agent working on a leaf task. One size doesn't fit all.
- **No semantic enrichment**: Only follows explicit links (parent_id, epic_id, references). Misses semantically related items that aren't directly linked.
- **Token-unaware**: Returns everything regardless of whether it fits in the agent's context window. For a large epic with 30 tasks, the response could exceed useful size.
- **No extensibility**: Adding new context sources (e.g., git history, external APIs) requires modifying the monolithic function.

### Proposal 2: Retrieval-Augmented Context Pipeline (Multi-Stage Modular)

**Architecture**: A pipeline of discrete, composable stages that progressively build a context window. Each stage is an independent module with a clear contract. Stages can be enabled, disabled, or configured per request. The pipeline respects a token budget — earlier stages have higher priority, later stages fill remaining space.

```
backlog_context({
  task_id: "TASK-0042",
  depth: 2,                    // relational expansion hops
  include_semantic: true,      // find semantically similar items
  include_activity: true,      // recent operations
  max_tokens: 4000,            // context window budget
})

Pipeline:
  Stage 1: Focal Resolution     → resolve task, get full content
  Stage 2: Relational Expansion → parent, children, siblings, resources
  Stage 3: Semantic Enrichment  → search for related items not directly linked
  Stage 4: Temporal Overlay     → recent activity on focal + related items
  Stage 5: Token Budgeting      → prioritize, truncate, summarize to fit budget
```

**How it works**:
1. **Stage 1 — Focal Resolution**: Given a task ID, resolve to full task with content. Given a query, find the most relevant entity as focal point. Always succeeds — this is the "seed."

2. **Stage 2 — Relational Expansion**: Traverse the entity graph from the focal point. Configurable depth (default 1). At depth 1: parent + direct children + siblings. At depth 2: grandparent + cousins + nested children. Resources attached to any visited entity are included.

3. **Stage 3 — Semantic Enrichment** (optional): Use `backlog_search` internally to find items semantically related to the focal entity's title + description. Deduplicate against items already found in Stage 2. This catches "soft links" — items that are related but not explicitly connected.

4. **Stage 4 — Temporal Overlay** (optional): Query the operation log for recent activity on the focal entity and its first-degree relations. Surfaces "what changed recently" context — completed siblings, status transitions, evidence added.

5. **Stage 5 — Token Budgeting**: Each item has a cost (estimated in tokens). The pipeline assembles results in priority order (focal > parent > children > siblings > semantic > activity) and truncates to fit within `max_tokens`. Items can be included at different fidelity levels: "full" (all fields), "summary" (id + title + status + snippet), or "reference" (id + title only).

**Strengths**:
- **Modular**: Each stage is an independent, testable module. Adding a new context source is adding a new stage.
- **Configurable**: Agents can request exactly the context they need. Working on a leaf task? Depth 1, semantic on. Reviewing an epic? Depth 2, semantic off, activity on.
- **Token-aware**: Respects context window limits. Returns the most valuable information first, truncates gracefully.
- **Extensible**: Future stages (git history, session memory, proactive suggestions) plug in without restructuring.
- **Phase-friendly**: Stage 1+2 = Phase 1 (immediate value). Stage 3 = Phase 2. Stage 4 = Phase 3. Stage 5 refinement = ongoing.

**Weaknesses**:
- More complex API — agents need to understand configuration options (mitigated with good defaults)
- Pipeline ordering matters — stage interactions need careful design
- More code than Proposal 1 (but each piece is simpler and isolated)

### Proposal 3: Persistent Context Index (Pre-Computed Context Windows)

**Architecture**: Maintain a background-computed "context index" that pre-builds context windows for every entity in the backlog. When an entity changes, its context window and the context windows of all related entities are incrementally updated. The `backlog_context` tool is a fast lookup, not a computation.

```
Context Index (persisted alongside search index):
  TASK-0042:
    context_hash: "a3b2c1"
    parent_context: { EPIC-0005: summary }
    sibling_context: [ TASK-0040: summary, TASK-0041: summary ]
    resource_context: [ ADR-0051: summary, ADR-0072: summary ]
    activity_context: [ "TASK-0041 completed 2h ago", ... ]
    semantic_neighbors: [ TASK-0038: score 0.87, ... ]

backlog_context({ task_id: "TASK-0042" })
→ instant lookup from pre-computed index
```

**How it works**:
1. On startup (or first request), build context windows for all entities
2. On each mutation (via EventBus), incrementally update affected windows
3. Context windows include pre-computed summaries (title + status + snippet)
4. `backlog_context` reads from index, applies token budgeting, returns

**Strengths**:
- **Fastest retrieval**: Context is pre-computed — tool response is a lookup, not a traversal
- **Consistent**: Same entity always gets the same context (until something changes)
- **Offline-friendly**: Context is computed asynchronously, available even during heavy load

**Weaknesses**:
- **Premature optimization**: For a backlog of <500 items, computing context on-demand takes <50ms. Pre-computation adds complexity without measurable latency benefit.
- **Storage overhead**: Each entity's context window is ~2-5KB. At 500 entities, that's ~2.5MB of index data on top of the search index.
- **Update complexity**: A single task status change can affect its own context, its parent's context, and all siblings' contexts. Cascade logic is error-prone.
- **Stale data risk**: If the index update fails or lags, agents get stale context without knowing it.
- **Hardest to debug**: Pre-computed results are opaque — hard to understand why a specific context was assembled.
- **Scales poorly in terms of change propagation**: As the backlog grows, one mutation triggers more and more context window rebuilds.

## Decision

**Proposal 2: Retrieval-Augmented Context Pipeline** — for these reasons:

### 1. Modularity matches the project's evolution pattern
backlog-mcp has consistently evolved through modular additions: SearchService abstraction (ADR-0038), then hybrid search (ADR-0042), then scoring normalization (ADR-0072), then MCP-first search (ADR-0073). Each ADR added a composable capability without restructuring. The pipeline architecture continues this pattern — each stage is a self-contained module that builds on the previous.

### 2. The pipeline naturally maps to development phases
Phase 1 (immediate): Stages 1 + 2 (focal resolution + relational expansion). This alone replaces the 8-call sequence described in the problem statement with a single tool call. Delivers 80% of the value.

Phase 2 (near-term): Stage 3 (semantic enrichment). Leverages the existing `searchAll()` infrastructure — no new search engine needed.

Phase 3 (mid-term): Stage 4 (temporal overlay). Leverages the existing `OperationLogger` — no new storage needed.

Phase 4 (long-term): Stage 5 refinement + session memory + proactive suggestions. Each addition is a new module, not a rewrite.

### 3. Token budgeting is essential, not optional
Agents have finite context windows. Proposal 1 ignores this entirely. Proposal 3 pre-computes fixed windows that may not fit the caller's needs. The pipeline approach lets the caller specify their budget and gets the highest-value information within that budget.

### 4. Semantic enrichment closes the discovery gap
Proposal 1's rigid traversal only follows explicit links. The pipeline's semantic enrichment stage (Stage 3) uses the existing hybrid search to find "soft links" — items that are related by meaning but not by explicit reference. This is where the RAG in "RAG augmentation" actually happens.

### 5. Proposal 3 is premature for current scale
With <500 entities, on-demand traversal takes <50ms. Pre-computation adds storage, update-cascade complexity, and stale-data risk for negligible latency gain. If the backlog grows past 10K entities, we can add caching at the pipeline level (memoize individual stage results) without architectural changes.

### 6. Viewer UI integration is natural
The pipeline's staged output maps directly to viewer UI sections:
- Stage 1 (focal) → Task Detail pane (existing)
- Stage 2 (relational) → "Related Items" section (new: parent breadcrumb, children list, sibling list, attached resources)
- Stage 3 (semantic) → "See Also" section (new: semantically related items)
- Stage 4 (temporal) → Activity panel (existing, enhanced: cross-entity activity)

The viewer can call the same `GET /context?task_id=X` endpoint (thin HTTP adapter, same pattern as ADR-0073) and render each section independently.

## Phase 1 Implementation (This PR)

Phase 1 delivers Stages 1 + 2 of the pipeline: **Focal Resolution + Relational Expansion**.

### New Service: `ContextHydrationService`

Location: `src/context/hydration-service.ts`

The service is a stateless orchestrator that composes existing services (TaskStorage, OramaSearchService, ResourceManager, OperationLogger) into a context pipeline. It does not own any data — it reads from existing stores.

```typescript
interface ContextRequest {
  task_id?: string;       // Focal point: task/epic/folder/artifact/milestone ID
  query?: string;         // Alternative: natural language query → resolve to focal entity
  depth?: number;         // Relational expansion hops (default: 1, max: 3)
  include_related?: boolean;   // Stage 3: semantic enrichment (default: false, Phase 2)
  include_activity?: boolean;  // Stage 4: temporal overlay (default: false, Phase 3)
  max_tokens?: number;    // Token budget (default: 4000)
}

interface ContextResponse {
  focal: ContextEntity;                    // The primary entity
  parent?: ContextEntity;                  // Parent entity (if exists)
  children: ContextEntity[];               // Direct children
  siblings: ContextEntity[];               // Siblings (same parent)
  related_resources: ContextResource[];    // Resources linked to focal or parent
  related?: ContextEntity[];               // Semantic matches (Phase 2)
  activity?: ContextActivity[];            // Recent operations (Phase 3)
  metadata: {
    depth: number;
    total_items: number;
    token_estimate: number;
    truncated: boolean;
    stages_executed: string[];
  };
}
```

### New MCP Tool: `backlog_context`

Location: `src/tools/backlog-context.ts`

Thin adapter (same pattern as `backlog_search` in ADR-0073) that translates Zod-validated input into a `ContextHydrationService` call.

```typescript
// Tool parameters
{
  task_id?: string;         // Focal entity ID
  query?: string;           // Natural language focal resolution
  depth?: number;           // 1-3, default 1
  max_tokens?: number;      // Token budget, default 4000
}

// Response (Phase 1): structured context bundle
{
  focal: { id, title, status, type, description },
  parent: { id, title, status, type } | null,
  children: [{ id, title, status, type }],
  siblings: [{ id, title, status, type }],
  related_resources: [{ uri, title, snippet }],
  metadata: { depth, total_items, token_estimate, truncated, stages_executed }
}
```

### New HTTP Endpoint: `GET /context`

Location: `src/server/viewer-routes.ts` (extended)

Thin HTTP adapter for the viewer UI, same pattern as `GET /search`.

```
GET /context?task_id=TASK-0042&depth=1
```

### Token Estimation

Phase 1 uses a simple character-based estimator (1 token ≈ 4 characters for English text). This is a **known approximation** — sufficient for budgeting purposes. Future phases may use a proper tokenizer if precision matters.

Each entity has three fidelity levels:
- **full**: All fields including description/content (~200-2000 tokens)
- **summary**: id + title + status + type + snippet (~50-100 tokens)
- **reference**: id + title only (~10-20 tokens)

The pipeline fills the token budget by including entities at decreasing fidelity:
1. Focal entity: always "full"
2. Parent: "summary"
3. Children: "summary" (up to budget)
4. Siblings: "summary" (up to budget)
5. Resources: "summary" with snippet (up to budget)
6. Overflow items: "reference" only

### File Structure

```
src/
├── context/
│   ├── hydration-service.ts       # Pipeline orchestrator
│   ├── types.ts                   # ContextRequest, ContextResponse, etc.
│   ├── stages/
│   │   ├── focal-resolution.ts    # Stage 1: resolve focal entity
│   │   └── relational-expansion.ts # Stage 2: traverse relationships
│   ├── token-budget.ts            # Token estimation and budgeting
│   └── index.ts                   # Exports
├── tools/
│   └── backlog-context.ts         # MCP tool (thin adapter)
└── __tests__/
    └── context-hydration.test.ts  # Pipeline tests
```

## Known Hacks and Limitations (Phase 1)

### 1. Token estimation is character-based approximation

**Location**: `src/context/token-budget.ts`

**Issue**: Using `Math.ceil(text.length / 4)` as token estimate. Real tokenizers (tiktoken, etc.) produce different counts especially for code, special characters, and non-English text.

**Why**: Adding a tokenizer dependency (tiktoken is ~4MB) for budgeting purposes is overkill. The estimate is within ±20% for English prose, which is sufficient for "should I include this item" decisions.

**Future fix**: If agents report context responses exceeding their windows, integrate a proper tokenizer. Consider `js-tiktoken` (~200KB) as a lighter alternative.

### 2. Resource discovery uses filename-based heuristic

**Location**: `src/context/stages/relational-expansion.ts`

**Issue**: Related resources are found by scanning `resources/` for files whose path contains the focal task's ID or parent's ID. This misses resources that are related by content but not by naming convention.

**Why**: Phase 1 focuses on explicit relationships. Semantic resource discovery requires Stage 3 (search-based enrichment), which is Phase 2.

**Future fix**: Phase 2's semantic enrichment stage will use `searchAll()` to find resources by content similarity, not just path matching.

### 3. Sibling fetching loads all children of parent

**Location**: `src/context/stages/relational-expansion.ts`

**Issue**: To find siblings, we call `storage.list({ parent_id: parentId })` which loads all tasks under the parent. For a large epic with 100+ tasks, this is wasteful.

**Why**: TaskStorage has no `list({ parent_id, limit })` that returns a subset. Adding limit support to list requires changes to the filtering logic.

**Future fix**: Add `limit` parameter to `TaskStorage.list()` for parent_id queries. Or use search index for "tasks under parent X" queries.

### 4. No `query`-based focal resolution yet

**Location**: `src/context/stages/focal-resolution.ts`

**Issue**: Phase 1 only supports `task_id` as focal input. The `query` parameter (natural language → resolve to best matching entity) is accepted but not implemented.

**Why**: Query-based resolution requires deciding between "return the top search result" (brittle) vs "return multiple candidates and let the agent choose" (breaks single-call value proposition). This needs more design thought.

**Future fix**: Phase 2 will implement query-based focal resolution. Likely approach: use `searchAll()` to find top match, return it as focal with `metadata.focal_resolved_from = "query"` flag so agents know the focal was inferred.

### 5. Depth > 1 not implemented in Phase 1

**Location**: `src/context/stages/relational-expansion.ts`

**Issue**: The `depth` parameter is accepted (1-3) but Phase 1 only implements depth 1 (direct parent, children, siblings). Depth 2+ (grandparent, cousins, nested children) requires recursive traversal.

**Why**: Depth 1 covers the vast majority of use cases. Multi-hop traversal adds complexity around cycle detection and exponential growth.

**Future fix**: Phase 2 will implement depth 2+ with visited-set cycle detection and per-hop token budgeting.

## Viewer UI Integration (Future)

The context hydration API naturally maps to viewer UI enhancements:

### Phase 1 Viewer (can be built now)
- **Related Items section** in TaskDetail right pane: shows parent (breadcrumb, already exists), children (list), siblings (list)
- **Attached Resources section**: shows resources found for this task
- Data source: `GET /context?task_id=X`

### Phase 2 Viewer
- **"See Also" section**: semantically related items from Stage 3
- **Context graph mini-map**: visual graph of focal → related entities

### Phase 3 Viewer
- **Timeline section**: recent activity on focal + related items (extends existing ActivityPanel)
- **Session memory indicator**: "Last worked on by Agent X, 2 days ago"

## Alternatives Considered

(See Proposals 1 and 3 above for full details)

**Proposal 1 (Context Bundle Monolith)** rejected because: rigid traversal pattern, no token awareness, no extensibility for future stages.

**Proposal 3 (Persistent Context Index)** rejected because: premature optimization for current scale (<500 entities), update-cascade complexity, stale-data risk, harder to debug.

## Consequences

### Positive
- **Single-call context**: Agents replace 5-10 tool calls with one `backlog_context` call
- **Token-aware**: Response fits within specified budget — no context window overflow
- **Modular pipeline**: Each stage is independently testable and deployable
- **Viewer-ready**: HTTP endpoint enables rich context UI in the viewer
- **Foundation for memory**: The pipeline architecture extends naturally to session memory, proactive suggestions, and agent personalization

### Negative
- **New tool surface**: `backlog_context` adds one more MCP tool (7 total → 8). The tool description clearly differentiates it from `backlog_search`.
- **Service complexity**: `ContextHydrationService` adds a new orchestration layer. Mitigated by keeping it stateless and using existing services.

### Risks
- **Agent confusion**: Agents may not know when to use `backlog_context` vs `backlog_search` vs `backlog_get`. Mitigation: tool descriptions make the purpose clear — context is for "I'm about to work on X, give me everything I need", search is for "find things matching Q", get is for "give me the raw content of X".
- **Token budget accuracy**: Character-based estimation may over/under-estimate. Mitigation: conservative defaults (4000 tokens) and the `truncated` flag lets agents know they didn't get everything.

## Success Criteria

Phase 1:
- [x] `backlog_context` MCP tool registered and functional
- [x] Stage 1 (focal resolution) resolves any entity type
- [x] Stage 2 (relational expansion) returns parent, children, siblings, resources
- [x] Token budgeting truncates gracefully with `truncated` flag
- [x] `GET /context` HTTP endpoint for viewer
- [x] Comprehensive tests for pipeline, stages, and token budgeting (52 tests)
- [x] All existing tests continue to pass (585 pass, 4 pre-existing failures in search-hybrid.test.ts unrelated to this change)

## File Changes

```
New files:
  src/context/types.ts                          # ContextRequest, ContextResponse, ContextEntity, etc.
  src/context/token-budget.ts                   # Token estimation, budgeting, entity downgrading
  src/context/stages/focal-resolution.ts        # Stage 1: resolve focal entity from task_id
  src/context/stages/relational-expansion.ts    # Stage 2: parent, children, siblings, resources
  src/context/hydration-service.ts              # Pipeline orchestrator
  src/context/index.ts                          # Public exports
  src/tools/backlog-context.ts                  # MCP tool (thin adapter)
  src/__tests__/context-hydration.test.ts       # 52 tests: stages, budget, pipeline, contracts
  docs/adr/0074-agent-context-hydration-architecture.md  # This ADR

Modified files:
  src/tools/index.ts                            # Register backlog_context tool
  src/storage/backlog-service.ts                # Added listSync() for synchronous access
  src/server/viewer-routes.ts                   # Added GET /context endpoint
```

## Handoff for Next Engineer

### What was built
Phase 1 of the Retrieval-Augmented Context Pipeline (Proposal 2 from this ADR). This delivers Stages 1 + 2:

1. **Stage 1 — Focal Resolution** (`src/context/stages/focal-resolution.ts`): Resolves a task/epic ID into a full-fidelity `ContextEntity`. The function `taskToContextEntity()` converts between `Task` (storage layer) and `ContextEntity` (context layer) at three fidelity levels: `full`, `summary`, `reference`.

2. **Stage 2 — Relational Expansion** (`src/context/stages/relational-expansion.ts`): Traverses the entity graph from the focal point. Finds parent (via `parent_id` / `epic_id`), children (via `listTasks({ parent_id: focalId })`), siblings (children of parent, excluding focal), and resources (path-based heuristic matching focal and parent IDs).

3. **Token Budget** (`src/context/token-budget.ts`): Character-based token estimation with priority-ordered budget allocation. Focal and parent are always included. Children, siblings, and resources are included in priority order, downgraded from `summary` to `reference` fidelity before being dropped entirely.

4. **Pipeline Orchestrator** (`src/context/hydration-service.ts`): Stateless function `hydrateContext()` that runs stages 1→2→budget and returns a `ContextResponse`. Uses dependency injection for all data access — fully testable without filesystem.

5. **MCP Tool** (`src/tools/backlog-context.ts`): Thin adapter calling `hydrateContext()` with injected deps from `storage` and `resourceManager`.

6. **HTTP Endpoint** (`src/server/viewer-routes.ts`): `GET /context?task_id=X&depth=1&max_tokens=4000` — thin adapter for viewer UI consumption.

### Architecture decisions to preserve
- **Dependency injection everywhere**: The pipeline receives `getTask`, `listTasks`, `listResources` as injected functions. This is critical for testability and for future extensibility (swap data sources without changing pipeline).
- **Fidelity levels**: The `full`/`summary`/`reference` trichotomy is the core of token budgeting. All entity and resource types flow through these levels.
- **Stateless pipeline**: `hydrateContext()` is a pure function (given the same deps and request, same output). No caching, no mutable state. This is intentional — caching should be added at the caller level if needed, not inside the pipeline.
- **Stage separation**: Each stage is a separate module with its own types. Future stages (semantic enrichment, temporal overlay) should follow this pattern.

### What to build next (Phase 2)

**Priority 1: Stage 3 — Semantic Enrichment**
- File: `src/context/stages/semantic-enrichment.ts`
- Use `BacklogService.searchUnified()` to find semantically related items not directly linked in the graph
- Deduplicate against items already found in Stage 2
- This requires making the pipeline async (currently sync) since `searchUnified()` is async
- Populate the `related` array in `ContextResponse`

**Priority 2: Query-based focal resolution**
- Enhance `focal-resolution.ts` to accept a `query` string
- Use `searchUnified()` to find the best match as focal entity
- Add `metadata.focal_resolved_from: 'query' | 'id'` to tell agents the focal was inferred

**Priority 3: Depth 2+ relational expansion**
- Add recursive traversal to `relational-expansion.ts`
- Implement visited-set for cycle detection
- Add per-hop token budgeting (closer hops get more budget)

**Priority 4: Stage 4 — Temporal Overlay**
- File: `src/context/stages/temporal-overlay.ts`
- Query `OperationLogger.read()` for recent activity on focal + related entities
- Format into `ContextActivity[]` with human-readable summaries
- Populate the `activity` array in `ContextResponse`

**Priority 5: Viewer UI integration**
- Add "Related Items" section to `task-detail.ts` component
- Call `GET /context?task_id=X` when a task is selected
- Render children, siblings, and resources as clickable links
- Consider a "Context" tab in the right pane alongside the existing Detail/Activity tabs

### Known issues to address
1. **Pipeline is synchronous**: Stage 3 (semantic enrichment) and Stage 4 (temporal overlay via async OperationLogger queries) will require making `hydrateContext()` async. The MCP tool already wraps it in an async handler, but the HTTP endpoint and tests will need updating.
2. **`listSync()` on BacklogService**: Added for Phase 1 to avoid async complexity. When the pipeline goes async in Phase 2, switch to using the existing async `list()` method instead.
3. **Resource discovery heuristic**: Path-based matching (e.g., `resources/TASK-0042/`) is a temporary solution. Phase 2 should use semantic search for resource discovery, with path-matching as a supplementary signal.
4. **Pre-existing test failures**: 4 tests in `search-hybrid.test.ts` fail because onnxruntime is not available in the test environment. These are not related to context hydration and predate this work.
