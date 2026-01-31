# 0042. Hybrid Search with Local Embeddings

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0146

## Context

Current BM25 keyword search misses semantically related content. Users searching "login" won't find tasks about "authentication". We need hybrid search combining exact matching with semantic understanding - fully local, no external APIs.

### Current State

- OramaSearchService uses BM25 full-text search with fuzzy matching
- Schema: id, title, description, status, type, epic_id, evidence, blocked_reason, references (all strings)
- Disk persistence to `.cache/search-index.json`
- SearchService interface is clean and stable

### Requirements

1. Local-only - No external API dependencies
2. Hybrid search - BM25 (exact/fuzzy) + Vector (semantic) combined
3. Resilient - Finds content even with different phrasing
4. Fast - Search latency <50ms acceptable
5. Offline - Works without network after initial model download

### Research Findings

**Orama Capabilities:**
- Native support for `mode: 'hybrid'` in search()
- Schema supports `vector[N]` type for embeddings
- `@orama/plugin-embeddings` available but uses TensorFlow.js

**Embedding Options:**
1. `@orama/plugin-embeddings` + TensorFlow.js - Official but heavy (~150MB+)
2. `@huggingface/transformers` - Lighter (~23MB model), pure JS/WASM

## Proposed Solutions

### Option 1: Official Orama Plugin with TensorFlow.js

**Description**: Use `@orama/plugin-embeddings` with `@tensorflow/tfjs-node` backend.

**Pros**:
- Official Orama solution, well-integrated
- Automatic embedding generation at insert/search time
- 512-dimensional vectors

**Cons**:
- TensorFlow.js is heavy (~150MB+ with native bindings)
- Native compilation required (can fail on some systems)
- Less control over model selection
- Cross-platform issues with native bindings

**Implementation Complexity**: Low-Medium

### Option 2: Manual Embeddings with transformers.js

**Description**: Use `@huggingface/transformers` to manually generate embeddings, store in Orama's vector field.

**Pros**:
- Lightweight (~23MB model vs 150MB+ TF)
- Pure JS/WASM, no native compilation
- More control over model selection
- Better cross-platform compatibility
- Model cached in ~/.cache/huggingface

**Cons**:
- More code to write (manual embedding generation)
- Must generate embeddings at both insert AND search time
- No automatic integration

**Implementation Complexity**: Medium

### Option 3: Graceful Degradation with Optional Embeddings

**Description**: Same as Option 2 but with graceful fallback to BM25 if embeddings fail to load.

**Pros**:
- All benefits of Option 2
- Never breaks existing functionality
- Lazy loading minimizes startup impact
- Works offline after first model download
- Can be disabled if causing issues

**Cons**:
- More complex state management
- First search with embeddings is slow (~5s model load)
- Index may have mix of docs with/without embeddings during transition

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 3 - Graceful Degradation with transformers.js

**Rationale**: 
- TensorFlow.js native bindings are a maintenance burden and cross-platform risk
- Graceful degradation ensures stability - search never breaks, just loses semantic capability
- Lazy loading is the right pattern for optional heavy features
- `@huggingface/transformers` is lighter, pure JS, and well-maintained

**Trade-offs Accepted**:
- First search is slow (~5s model download, cached after)
- Memory: +50-80MB for embedding model in memory
- Index size: ~1.5KB per task additional (384-dim vectors)
- Slightly more complex implementation

## Consequences

**Positive**:
- Semantic search finds related content ("login" → "authentication")
- Exact matches still rank highest (hybrid mode)
- Graceful fallback ensures stability
- Lightweight dependency
- Cross-platform compatibility

**Negative**:
- First-run model download (~5s, ~23MB)
- Memory overhead when embeddings active
- Larger index files

**Risks**:
- Model download fails on first run → Mitigated by graceful fallback to BM25
- Embeddings quality insufficient → Can swap models later (configurable)
- Performance regression → Lazy loading, only activates on search

## Implementation Notes

**Dependencies:**
- `@huggingface/transformers` (successor to @xenova/transformers)

**Model:**
- `Xenova/all-MiniLM-L6-v2` (~23MB, 384-dim vectors)
- Cached in ~/.cache/huggingface by default

**Files to modify:**
- `src/search/embedding-service.ts` (new) - Embedding generation
- `src/search/orama-search-service.ts` - Add hybrid search support
- `src/__tests__/search.test.ts` - Add semantic search tests

**Schema change:**
```typescript
const schema = {
  // ... existing fields
  embeddings: 'vector[384]'  // New field for embeddings
}
```

**Search modes:**
- No embeddings available → BM25 only (current behavior)
- Embeddings available → Hybrid mode (BM25 + vector)
