# 0038. Comprehensive Search Capability

**Date**: 2026-01-31
**Status**: Accepted
**Master Epic**: EPIC-0019 (Search & RAG: Intelligent Context for Agents)
**Backlog Items**: TASK-0104, TASK-0141, TASK-0142, TASK-0145, TASK-0146, TASK-0147, TASK-0159, TASK-0160, EPIC-0018

## Context

As the backlog grows, finding specific tasks becomes difficult. Users need to search across all task content with fuzzy matching, typo tolerance, and relevance ranking.

### Requirements

1. Full-text search across all task fields
2. Fuzzy matching (typo tolerance)
3. Relevance ranking (title matches > description matches)
4. Filter compatibility (search + status/type/epic filters)
5. Future RAG/vector search path without library swaps
6. Zero vendor lock-in via abstraction layer

### Research Findings (TASK-0141)

Evaluated 6 JS search libraries (see research artifact):
- **MiniSearch**: Good but no RAG path
- **Orama**: Full-text + vector + RAG, native TypeScript, zero deps ✅ Selected
- **FlexSearch**: TypeScript issues, stale maintenance
- **Fuse.js**: Fuzzy-only, no indexing
- **Lunr.js**: Dated, no active development
- **DIY**: 1500+ lines, weeks of work

## Decision

**Selected**: SearchService abstraction with Orama backend

### Architecture (Final)

```
┌─────────────────────────────────────────────────────────┐
│                    BacklogService                        │
│  (orchestrates storage + search, exposed to MCP tools)  │
└─────────────┬─────────────────────────┬─────────────────┘
              │                         │
┌─────────────▼─────────────┐ ┌─────────▼─────────────────┐
│      TaskStorage          │ │      SearchService        │
│  (pure file I/O)          │ │  (pure search + persist)  │
│  - read/write markdown    │ │  - index/search/persist   │
│  - no search knowledge    │ │  - configured via options │
└───────────────────────────┘ └───────────────────────────┘
```

### SearchService Interface

```typescript
interface SearchService {
  index(tasks: Task[]): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  addDocument(task: Task): Promise<void>;
  removeDocument(id: string): Promise<void>;
  updateDocument(task: Task): Promise<void>;
}

interface SearchOptions {
  filters?: { status?: Status[]; type?: TaskType; epic_id?: string };
  limit?: number;
  boost?: Record<string, number>;
}

interface SearchResult {
  id: string;
  score: number;
  task: Task;
}
```

### Why Orama

| Requirement | Orama Capability |
|-------------|------------------|
| Fuzzy search | ✅ Built-in typo tolerance |
| Prefix search | ✅ "auth" → "authentication" |
| Field boosting | ✅ title: 2x weight |
| Relevance ranking | ✅ BM25 algorithm |
| TypeScript | ✅ Native (written in TS) |
| Zero dependencies | ✅ |
| Bundle size | ~2KB |
| Vector search | ✅ Built-in |
| RAG pipeline (future) | ✅ Built-in |
| License | Apache 2.0 |

### Production Proof

- Deno Documentation: 5,856 docs indexed
- Framework plugins: Docusaurus, VitePress, Astro
- GitHub: 10.1k stars, 106 contributors

## Implementation Summary

All phases complete. Total: 161 tests passing.

| Phase | Description | Status | Task |
|-------|-------------|--------|------|
| 1 | SearchService Foundation | ✅ Complete | TASK-0142 |
| 2 | Integration & Persistence | ✅ Complete | TASK-0142 |
| 2.5 | Architecture Decoupling | ✅ Complete | TASK-0145 |
| 3 | Hybrid Search (BM25 + Vector) | ✅ Complete | TASK-0146 |
| 3.5 | Hyphen-Aware Tokenizer | ✅ Complete | TASK-0147 |
| 3.75 | UI Layer (Filter Bar + Spotlight) | ✅ Complete | TASK-0144, TASK-0148 |
| 3.8 | Unified Search API | ✅ Complete | TASK-0159 |
| 3.9 | Resource Search Integration | ✅ Complete | TASK-0160 |
| 4 | RAG / Context Hydration | 🔲 Future | TASK-0143 |

### Phase 1: SearchService Foundation (Complete)

**Files created:**
```
src/search/
├── types.ts              # Interface + types
├── orama-search-service.ts  # Orama implementation
└── index.ts              # Barrel export
```

**Indexed fields with boosting:**
- `title` (boost: 2.0)
- `description` (boost: 1.0)
- `evidence` (boost: 1.0)
- `blocked_reason` (boost: 1.0)
- `references` (boost: 0.5)
- `epic_id` (boost: 1.0)

### Phase 2: Integration & Persistence (Complete)

- Wired SearchService into BacklogStorage
- Replaced simple `matchesQuery` with Orama search
- Maintained backward compatibility (empty query = no search)
- Added disk persistence to `.cache/search-index.json`
- MCP tool: `backlog_list` accepts `query` parameter
- HTTP API: `/tasks` accepts `q` query parameter
- Viewer UI: search input in filter bar + spotlight search (Cmd+J)

### Phase 2.5: Architecture Decoupling (Complete) - TASK-0145

**Problem**: BacklogStorage and SearchService were tightly coupled.

**Solution**: Composition layer architecture:
- Created `TaskStorage` for pure file I/O (no search knowledge)
- Updated `SearchService` to take `{ cachePath }` config (no paths import)
- Created `BacklogService` composing both with singleton pattern

**ADR**: 0040-search-storage-decoupling.md

### Phase 3: Hybrid Search with Local Embeddings (Complete) - TASK-0146

**Goal**: Maximum search resilience without external API dependencies.

**Implementation:**
- Added `@huggingface/transformers` for local ML inference
- Created `EmbeddingService` with lazy model loading
- Default model: `Xenova/all-MiniLM-L6-v2` (~23MB, cached in `~/.cache/huggingface`)
- Enabled hybrid search mode: BM25 (exact/fuzzy) + Vector (semantic)
- Configured hybrid weights: text 0.8, vector 0.2 (prioritizes exact matches)
- Graceful fallback to BM25-only if embeddings fail

**Results:**
| Query | BM25 alone | + Vector |
|-------|------------|----------|
| "authentication" | ✅ | ✅ |
| "login" | ❌ | ✅ finds auth tasks |
| "user can't access" | ❌ | ✅ finds auth tasks |

**Trade-offs accepted:**
- First run: ~5s model download (cached after)
- Memory: +50-80MB for embedding model
- Index size: ~1.5KB per task additional

**ADR**: 0042-hybrid-search-local-embeddings.md

### Phase 3.5: Hyphen-Aware Tokenizer (Complete) - TASK-0147

**Problem**: Default Orama tokenizer kept hyphenated words as single tokens, so "first" wouldn't match "keyboard-first".

**Solution**: Custom tokenizer that expands hyphenated words while preserving originals:
- `"keyboard-first"` → `["keyboard-first", "keyboard", "first"]`

**Bonus fixes:**
- Numeric queries: `"0001"` now finds `TASK-0001`
- Short word fuzzy matching now works

**ADR**: 0041-hyphen-aware-tokenizer.md

### UI Layer Architecture (Complete) - TASK-0144, TASK-0148, TASK-0161

The search capability is exposed through a single unified UI:

#### Spotlight Search (Primary Search UI)

- **Component**: `spotlight-search.ts`
- **Use case**: Discovery (find any task quickly, keyboard-driven)
- **Trigger**: `Cmd+J` (macOS) / `Ctrl+J` (Windows/Linux), or click search button in filter bar
- **Behavior**: Modal overlay with rich result previews
- **Results**: Direct navigation to selected task/epic/resource
- **API**: `/search?q=query&limit=10`

#### Filter Bar (Status/Type Filtering Only)

- **Component**: `task-filter-bar.ts`
- **Use case**: Filter visible tasks by status (Active/Completed/All) and type (Tasks/Epics/All)
- **Search**: Removed in TASK-0161 - replaced with button that opens Spotlight
- **Design**: Search button shows platform-aware shortcut (⌘J on Mac, Ctrl+J on Windows/Linux)

**Design Rationale** (Updated TASK-0161):
- **Single search entry point**: Spotlight is the only search UI
- **Filter bar focuses on filtering**: Status and type filters, not search
- **Reduced confusion**: Users no longer wonder which search to use
- **Richer UX**: Spotlight provides previews, keyboard nav, cross-type search

#### Spotlight Implementation Details

**Client-side highlighting** (ADR-0039):
- Uses `@orama/highlight` (~2KB) for snippet generation
- Same accuracy as server-side without backend changes
- Rejected server-side (more code) and regex (inaccurate for fuzzy matching)

**Component architecture** (ADR-0039):
- Single component (~200 lines), no sub-components
- Rejected over-engineering (search-input, search-results, search-result-item)
- Minimal code principle applied

**Navigation state** (ADR-0043):
- Sets both `task` and `epic` URL params on selection
- Ensures sidebar shows correct epic expanded with task selected
- Escape key uses `stopPropagation()` to prevent global handler from firing

**Score display** (ADR-0043, ADR-0044):
- Normalized percentage badge (0-100%)
- Score attached to task object in API response: `{ ...task, score }`
- Trade-off: Type impurity accepted for pragmatic benefit

**Rich snippets** (ADR-0043, ADR-0045):
- ~200 chars context, multi-line display (2-3 lines)
- Rendered as HTML via `<span>` (not markdown via `<md-block>`)
- Shows hit count ("N matches") and matched field name
- Rejected md-block (wrong abstraction - expects markdown, but snippet is HTML)

**Keyboard navigation**:
- `↑`/`↓`: Navigate results
- `Enter`: Select highlighted result
- `Escape`: Close modal (with stopPropagation)

**Visual design**:
- 700px wide, 500px results height
- Type icons reused from `task-badge` component
- Task/Epic IDs displayed prominently
- Status badges and relevance scores shown

### Phase 3.8: Unified Search API (Complete) - TASK-0159

**Problem**: Score was attached to task object (type impurity):
```typescript
return results.map(r => ({ ...r.task, score: r.score }));  // score not in Task type
```

**Solution**: New `/search` endpoint with proper types:
```typescript
interface UnifiedSearchResult {
  item: Task | Resource;
  score: number;
  type: 'task' | 'epic' | 'resource';
}
```

**API**: `GET /search?q=query&types=task,epic,resource&limit=N`

**Benefits**:
- Type-safe API, no `(task as any).score` hacks
- Enables cross-type ranking (task vs epic vs resource)
- Extensible to new document types

**Backward compatible**: `/tasks?q=` still works.

**ADR**: 0047-unified-search-api.md

### Phase 3.9: Resource Search Integration (Complete) - TASK-0160

**Problem**: Resources (markdown files in `resources/`) were not searchable - only managed by ResourceManager for file I/O.

**Solution**: Single Orama index with `docType` field for unified relevance ranking:
- Added `Resource` type and `SearchableType` to types
- Added `list()` method to ResourceManager for scanning resources directory
- Extended OramaSearchService with `indexResources()`, `searchAll()`, resource CRUD methods
- Resources get hybrid search (BM25 + vectors) using same embedding model as tasks
- Updated Spotlight to render resources with 📄 icon

**Resource schema**:
```typescript
interface Resource {
  id: string;      // MCP URI: mcp://backlog/resources/path/to/file.md
  path: string;    // Relative path
  title: string;   // First # heading or filename
  content: string; // Full markdown content
}
```

**UI**: Resources appear in Spotlight with file icon, selecting opens resource pane.

**Trade-offs accepted**:
- Resources have empty task-specific fields (status, epic_id) - acceptable overhead
- Index rebuild required on schema change - one-time cost
- Limited to `resources/` directory for MVP - agent artifacts not yet searchable

**ADR**: 0048-resource-search-integration.md

### Phase 4: RAG / Context Hydration (Future) - TASK-0143

**Vision**: Transform backlog-mcp from task tracker into intelligent context provider for LLM agents.

#### Problem Statement

LLM agents working with backlog-mcp need **relevant context** to make good decisions. Currently, agents must manually fetch tasks, read descriptions, and piece together context. This is inefficient and error-prone.

**Context Engineering** (as defined by Andrej Karpathy) is:
> "The delicate art and science of filling the context window with just the right information for the next step."

backlog-mcp should become a **context hydration service** - automatically providing agents with the most relevant tasks, history, and knowledge for their current work.

#### Use Cases

1. **Task Discovery**: "What tasks are related to authentication?" → Returns semantically similar tasks, not just keyword matches
2. **Context for New Work**: "I'm working on search feature" → Returns related tasks, past decisions (ADRs), blockers, dependencies
3. **Historical Learning**: "How did we solve caching before?" → Returns past tasks with evidence, linked artifacts
4. **Dependency Awareness**: "What might block this task?" → Returns blocked tasks in same epic, related open issues

#### Three-Layer Context Architecture

Based on context engineering research, we need three layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTEXT HYDRATION API                     │
│  GET /context?query=...&task_id=...&mode=...                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  SEMANTIC   │  │   GRAPH     │  │  TEMPORAL   │         │
│  │   SEARCH    │  │  RELATIONS  │  │   MEMORY    │         │
│  │             │  │             │  │             │         │
│  │ Vector      │  │ Epic→Task   │  │ Recent      │         │
│  │ embeddings  │  │ Task→Task   │  │ activity    │         │
│  │ Hybrid      │  │ References  │  │ Agent       │         │
│  │ search      │  │ Dependencies│  │ sessions    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         ↓                ↓                ↓                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              CONTEXT COMPOSER                        │   │
│  │  Ranks, filters, compresses → optimal context window │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Layer 1: Semantic Search** (already implemented in Phase 3)
- Full-text search: Find tasks by keywords, descriptions
- Vector search: Find semantically similar tasks
- Hybrid search: Combine both for best results

**Layer 2: Graph Relations** (planned)
- Epic → Task relationships
- Task → Task references
- Artifact links (ADRs, research docs)
- Implicit dependencies (same epic, similar tags)

**Layer 3: Temporal Memory** (planned)
- Recent agent activity (what was just worked on)
- Session context (current focus area)
- Historical patterns (how similar tasks were resolved)

#### MCP Tool Design: backlog_context

```typescript
interface BacklogContextParams {
  // What the agent is working on
  query?: string           // Natural language query
  task_id?: string         // Current task context
  
  // What kind of context to retrieve
  mode?: 'related' | 'dependencies' | 'history' | 'all'
  
  // Filtering
  epic_id?: string         // Scope to epic
  status?: Status[]        // Filter by status
  
  // Output control
  limit?: number           // Max results (default: 10)
  include_content?: boolean // Include full descriptions
}

interface ContextResult {
  // Primary results
  tasks: Task[]
  
  // Relevance metadata
  scores: Record<string, number>  // task_id → relevance score
  
  // Graph context
  related_epics?: Epic[]
  linked_artifacts?: Reference[]
  
  // Suggested actions
  suggestions?: string[]  // "You might also want to check TASK-0042"
}
```

**Example: Agent Starting New Work**
```
Agent: backlog_context(query: "search implementation", mode: "related")

Response: {
  tasks: [
    { id: "TASK-0104", title: "Add search capability...", score: 0.95 },
    { id: "TASK-0142", title: "SearchService abstraction...", score: 0.92 }
  ],
  linked_artifacts: [
    { url: "mcp://backlog/.../search-research.md", title: "Search research" }
  ],
  suggestions: [
    "TASK-0142 is a dependency for TASK-0104",
    "Research artifact contains architecture decisions"
  ]
}
```

#### Orama RAG Capabilities

Orama provides built-in RAG support that will power Phase 4:

**Answer Engine**:
- Takes search hits, builds prompt, calls LLM via SecureProxy
- Prompt templates with `{{hits}}`, `{{question}}`, `{{metadata}}` placeholders
- Token budgeting to prevent context window overflow
- Streaming answers (token-by-token)

**AnswerSession API**:
```typescript
import { AnswerSession } from '@orama/orama'

const session = new AnswerSession(db, {
  systemPrompt: 'You are a task management assistant...',
  promptTemplate: 'Context:\n{{hits}}\n\nQuestion: {{question}}\nAnswer:',
  tokenBudget: 1800,
  events: { onStateChange: console.log }
})

const answer = await session.ask({ term: 'blocked auth tasks' })
// Returns: "There are 2 blocked tasks related to auth: TASK-0042..."
```

**Context Engineering Techniques**:
- Result pinning: Mark docs as "pinned" - always injected at top of context
- Relevance weighting: Adjust BM25/QPS blend for optimal retrieval
- Token budgeting: Auto-truncate/summarize to fit context window
- Multi-turn hydration: Keep session alive, each turn gets fresh hits
- Streaming + more context: Interleaved search if model needs more

**Native MCP Integration**:
- OramaCloud auto-exposes MCP server per project
- AI assistants query/retrieve via MCP standard
- Supported clients: ChatGPT, Cursor, any MCP-compatible interface

#### Technical Considerations

**Performance**:
- Context retrieval: <50ms (hybrid search + graph traversal)
- Graph relations: O(n) where n = related tasks (typically <20)
- Temporal memory: O(1) lookup from session cache

**Storage**:
- Graph relations: Stored in task metadata (no additional storage)
- Session context: In-memory cache, cleared after timeout
- Historical patterns: Derived from existing task data

**Context Window Management**:
Following context engineering best practices:
- **Compress**: Summarize long descriptions before returning
- **Select**: Return only most relevant tasks (ranked by score)
- **Isolate**: Separate semantic results from graph results
- **Budget**: Enforce token limits to prevent overflow

#### Success Criteria

- [ ] `backlog_context` MCP tool implemented
- [ ] `/context` HTTP endpoint available
- [ ] Semantic search returns relevant tasks (not just keyword matches)
- [ ] Graph relations included in context (epic, references)
- [ ] Context is ranked by relevance score
- [ ] Results are compressed to fit context windows
- [ ] Documentation explains context hydration concept

#### Future Vision

backlog-mcp becomes the **memory layer** for LLM agents:
- Agents ask "what should I work on?" → backlog provides prioritized context
- Agents ask "what did we decide?" → backlog retrieves past ADRs
- Agents ask "what's blocking progress?" → backlog surfaces dependencies
- Agents complete work → backlog learns from patterns

This transforms backlog-mcp from a task tracker into an **intelligent context provider** for agentic workflows.

See TASK-0143 for full design specification.

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Initial index (1k tasks) | <100ms | One-time on startup |
| BM25 search | <5ms | In-memory |
| Hybrid search (BM25 + vector) | <50ms | Includes embedding generation |
| Add/update document | <10ms | Incremental index update |
| First embedding model load | ~5s | One-time download, cached after |

**Memory footprint:**
- Orama index: ~100KB for 1k tasks
- Embedding model: +50-80MB when loaded
- Vector storage: ~1.5KB per task

## Test Coverage

161 tests across 3 test files:
- `search.test.ts` - Unit tests for OramaSearchService
- `search-golden.test.ts` - Golden benchmark tests (real-world queries)
- `search-hybrid.test.ts` - Semantic search verification

## Known Limitations

1. **No stemming** - Custom tokenizer trades stemming for hyphen handling. "running" won't match "run".
2. **In-memory index** - Acceptable for <10k tasks. Would need external search service for larger scale.
3. **Post-search filtering** - Filters applied after Orama search, not during. Works fine for current scale.
4. **First-run latency** - ~5s model download on first semantic search (cached after).

## Consequences

**Positive:**
- Fuzzy search finds tasks despite typos
- Semantic search finds related content ("login" → "authentication")
- Relevance ranking surfaces best matches first
- Abstraction allows backend swap without code changes
- Clean architecture: TaskStorage + SearchService composed by BacklogService
- Clear path to RAG without library replacement

**Negative:**
- Additional dependencies (@orama/orama ~2KB, @huggingface/transformers ~23MB model)
- Index rebuilt on startup (fast: <100ms for 1k tasks)
- Memory overhead for embeddings (~50-80MB)

**Trade-offs Accepted:**
- In-memory index (acceptable for <10k tasks)
- Post-search filtering (simpler than Orama's enum filters)
- Local embeddings over API (offline-first, no external dependencies)

## File Structure (Final)

```
src/
├── search/
│   ├── types.ts                 # SearchService interface
│   ├── orama-search-service.ts  # Orama + hybrid search implementation
│   ├── embedding-service.ts     # Local embeddings via transformers.js
│   └── index.ts                 # Barrel export
├── storage/
│   ├── task-storage.ts          # Pure file I/O
│   ├── backlog-service.ts       # Composition layer (singleton)
│   └── schema.ts                # Task types
└── __tests__/
    ├── search.test.ts           # Unit tests
    ├── search-golden.test.ts    # Golden benchmark tests
    └── search-hybrid.test.ts    # Semantic search tests
```

## Technical Specifications

### Orama Schema

```typescript
// BM25-only schema
const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  status: 'string',      // Note: string, not enum (post-search filtering)
  type: 'string',        // Note: string, not enum (post-search filtering)
  epic_id: 'string',
  evidence: 'string',    // Array joined with space
  blocked_reason: 'string', // Array joined with space
  references: 'string',  // Flattened: "{title} {url}" joined
};

// With embeddings (hybrid mode)
const schemaWithEmbeddings = {
  ...schema,
  embeddings: 'vector[384]',  // 384 dimensions, not 512
};
```

### Search Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `boost.id` | 10 | Task ID searches rank highest |
| `boost.title` | 2 | Title matches more relevant than body |
| `tolerance` | 1 | Typo tolerance (1 edit distance) |
| `hybridWeights.text` | 0.8 | Prioritize exact/fuzzy matches |
| `hybridWeights.vector` | 0.2 | Semantic as secondary signal |
| `similarity` | 0.2 | Low threshold to catch semantic matches |
| `limit` | 20 | Default result limit |

### Embedding Model

| Property | Value |
|----------|-------|
| Model ID | `Xenova/all-MiniLM-L6-v2` |
| Dimensions | 384 |
| Size | ~23MB |
| Cache location | `~/.cache/huggingface` |
| Pooling | mean |
| Normalization | true |

### Persistence Format

Index persisted to `.cache/search-index.json`:
```json
{
  "index": { /* Orama serialized index */ },
  "tasks": { "TASK-0001": { /* Task object */ }, ... },
  "hasEmbeddings": true
}
```

- Debounced save: 1000ms after last change
- Auto-rebuild if cache missing or corrupted

### Graceful Degradation

```
Startup:
  1. Try load from disk cache
  2. If cache has embeddings → use hybrid mode
  3. If no cache → check if embeddings available
     - Success → build hybrid index
     - Failure → build BM25-only index

Search:
  - If hasEmbeddingsInIndex && embeddingsReady → hybrid search
  - Otherwise → BM25 only (never fails)
```

`isHybridSearchActive()` method available to check current mode.

## Audit Notes

### Inconsistencies Found During Triage

1. **Vector dimensions**: Research artifact mentions 512-dim (from Orama plugin-embeddings), but implementation uses 384-dim (from all-MiniLM-L6-v2). **384 is correct.**

2. **Package naming**: Research mentions `@xenova/transformers`, implementation uses `@huggingface/transformers`. **Same package, renamed.** HuggingFace acquired Xenova's work.

3. **Schema types**: Research shows `status: 'enum'`, implementation uses `status: 'string'`. **String is intentional** - enables post-search filtering without Orama enum complexity.

4. **Test counts in artifacts**: TASK-0145 (113), TASK-0147 (146), TASK-0146 (156). These reflect point-in-time counts as tests were added. **Current: 156 tests.**

### Research Artifact Note

The research artifact (`search-research-2026-01-31/artifact.md`) contains a "REVISED RECOMMENDATION" section that supersedes the initial MiniSearch recommendation. The final decision was Orama, which is correctly reflected in this ADR.

## Related ADRs

- **0038** (this): Comprehensive search capability (master ADR)
- **0039**: Spotlight-style search UI
- **0040**: Search storage decoupling
- **0041**: Hyphen-aware tokenizer
- **0042**: Hybrid search with local embeddings
- **0043**: Spotlight search UX improvements
- **0044**: Search API relevance scores
- **0045**: Fix spotlight snippet display
- **0047**: Unified search API
- **0048**: Resource search integration

## References

- Research artifact: `mcp://backlog/backlog-mcp-engineer/search-research-2026-01-31/artifact.md`
- Orama docs: https://docs.orama.com/
- Orama GitHub: https://github.com/oramasearch/orama
- Hugging Face Transformers.js: https://huggingface.co/docs/transformers.js
