# 0040. Search Storage Decoupling

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0145

## Context

BacklogStorage and SearchService are tightly coupled:
- Storage instantiates and orchestrates search via `OramaSearchService.getInstance()`
- SearchService imports `paths` module (storage concern leaking into search)
- No clear boundaries, hard to test in isolation
- Violates single responsibility principle

### Current State

```
BacklogStorage
├── imports OramaSearchService
├── manages search lifecycle (searchReady flag)
├── routes list() to search when query provided
└── calls search.addDocument/updateDocument/removeDocument

OramaSearchService
├── imports paths (storage concern)
├── singleton pattern (getInstance)
└── uses paths.backlogDataDir for index location
```

### Research Findings

- storage.test.ts mocks SearchService entirely - tests are isolated
- search.test.ts creates instances directly (`new OramaSearchService()`)
- The coupling is in the import of `paths` and the singleton orchestration
- Clean separation would allow swapping search implementations easily

## Proposed Solutions

### Option 1: Dependency Injection

Pass SearchService instance to BacklogStorage constructor.

**Pros**:
- Simple change
- Testable

**Cons**:
- Still couples storage to search interface
- Doesn't address paths import in SearchService

**Implementation Complexity**: Low

### Option 2: Event-Based Decoupling

Storage emits events, search subscribes.

**Pros**:
- Fully decoupled
- Extensible

**Cons**:
- Over-engineered for current needs
- Harder to debug
- Async complexity

**Implementation Complexity**: High

### Option 3: Composition Layer

Extract pure TaskStorage, configure SearchService via options, compose in BacklogService.

**Pros**:
- Clear separation of concerns
- Each component testable in isolation
- SearchService becomes reusable (no hardcoded paths)
- Single orchestration point (BacklogService)

**Cons**:
- More files to maintain
- Slightly more indirection

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 3 - Composition Layer

**Rationale**: Provides cleanest separation while maintaining simplicity. TaskStorage handles pure file I/O, SearchService handles pure search with configurable cache path, BacklogService orchestrates both. This makes each component independently testable and reusable.

**Trade-offs Accepted**:
- Additional file (task-storage.ts)
- One more layer of indirection

## Consequences

**Positive**:
- SearchService no longer imports storage concerns
- TaskStorage has no search knowledge
- Clear boundaries enable independent testing
- SearchService can be reused with different cache paths

**Negative**:
- Three files instead of two
- Developers must understand composition pattern

**Risks**:
- Breaking existing tests (mitigated by keeping same API surface)
- Performance regression (mitigated by same underlying implementation)

## Implementation Notes

Target architecture:
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

Files:
- `src/storage/task-storage.ts` - Pure file I/O
- `src/storage/backlog-service.ts` - Composition layer
- `src/search/orama-search-service.ts` - Updated with options constructor
