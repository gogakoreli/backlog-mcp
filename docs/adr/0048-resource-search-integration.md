# 0048. Resource Search Integration in Spotlight

**Date**: 2026-02-01
**Status**: Accepted
**Backlog Item**: TASK-0160
**Epic**: EPIC-0019 (Search & RAG)

## Context

Spotlight search currently only indexes tasks and epics. Resources (markdown files in `$BACKLOG_DATA_DIR/resources/`) are managed by ResourceManager for file I/O but are NOT searchable. Users cannot discover resources through the unified search interface.

### Current State

- `OramaSearchService` indexes tasks with schema: id, title, description, status, type, epic_id, evidence, blocked_reason, references
- `BacklogService.searchUnified()` returns `UnifiedSearchResult[]` with `type: 'task' | 'epic'`
- `ResourceManager` has `read()`, `write()`, `resolve()`, `toUri()` but NO `list()` method
- Spotlight component renders task/epic results only

### Requirements

1. Resources indexed in SearchService on startup
2. Resources appear in Spotlight search results alongside tasks/epics
3. Hybrid search (BM25 + vector) works for resources
4. Resource selection opens resource pane
5. Minimal changes to existing task search infrastructure

## Proposed Solutions

### Option A: Separate Orama Index for Resources

Create a new `ResourceSearchService` class with its own Orama index.

**Pros**:
- Clean separation of concerns
- Independent schema optimized for resources
- No risk of breaking existing task search

**Cons**:
- Code duplication (similar index/search/persist logic)
- Two indexes to maintain
- Complex result merging in `searchUnified()`
- Higher memory footprint

**Implementation Complexity**: Medium-High

### Option B: Single Index with docType Field (SELECTED)

Extend existing Orama schema with a `docType` field to distinguish document types.

**Pros**:
- Single index = simpler architecture
- Unified relevance ranking across all content types
- Shared embeddings infrastructure
- Minimal code changes
- Natural BM25+vector scoring across types

**Cons**:
- Resources have empty task-specific fields (status, epic_id, etc.)
- Schema change requires index rebuild on upgrade

**Implementation Complexity**: Low-Medium

### Option C: Treat Resources as Special Tasks

Add resources as tasks with `type='resource'`.

**Pros**:
- Minimal schema changes
- Reuses all existing infrastructure

**Cons**:
- Semantic mismatch - resources aren't tasks
- Pollutes task listings
- Confusing data model

**Implementation Complexity**: Low but BAD design

## Decision

**Selected**: Option B - Single Index with docType Field

### Rationale

1. **Unified Relevance**: Single index means Orama naturally ranks all document types together by relevance
2. **Minimal Changes**: Extends existing infrastructure rather than duplicating it
3. **Shared Embeddings**: Resources get hybrid search (BM25 + vector) using same embedding model
4. **Backward Compatible**: Existing task search API unchanged

### Trade-offs Accepted

- Resources have empty task-specific fields (acceptable overhead)
- Index rebuild required on schema change (one-time cost)
- Limited to `resources/` directory for MVP (can extend later)

## Implementation

### Schema Extension

```typescript
// Add docType to existing schema
const schema = {
  id: 'string',
  title: 'string',
  description: 'string',  // For resources: full content
  status: 'string',       // Empty for resources
  type: 'string',         // 'task' | 'epic' | 'resource'
  epic_id: 'string',      // Empty for resources
  evidence: 'string',
  blocked_reason: 'string',
  references: 'string',
  path: 'string',         // NEW: relative path for resources
};
```

### Resource Type

```typescript
interface Resource {
  id: string;      // MCP URI: mcp://backlog/resources/path/to/file.md
  path: string;    // Relative path: resources/path/to/file.md
  title: string;   // First # heading or filename
  content: string; // Full markdown content
}
```

### Files Changed

1. **src/search/types.ts**: Add `Resource` interface, extend `UnifiedSearchResult.type`
2. **src/search/orama-search-service.ts**: Add `path` field, resource indexing methods
3. **src/resources/manager.ts**: Add `list()` method
4. **src/storage/backlog-service.ts**: Load resources, update `searchUnified()`
5. **src/server/viewer-routes.ts**: Accept `types=resource` parameter
6. **viewer/components/spotlight-search.ts**: Render resource results

### Title Extraction

```typescript
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : filename.replace(/\.md$/, '');
}
```

### Resource Discovery Scope

MVP: Only `$BACKLOG_DATA_DIR/resources/**/*.md`

Future: Could extend to agent artifacts (`{agent-name}/**/artifact.md`)

## Consequences

**Positive**:
- Resources discoverable through unified search
- Semantic search finds related resources ("caching" → "LRU implementation")
- Consistent UX - resources feel like first-class search results
- Single search call returns all content types

**Negative**:
- Index size increases (minimal impact for <1000 docs)
- Resources have empty task fields (acceptable)
- No automatic refresh on resource changes (manual rebuild)

## References

- ADR-0038: Comprehensive Search Capability (master search ADR)
- TASK-0159: Unified Search API
- Orama docs: https://docs.orama.com/
