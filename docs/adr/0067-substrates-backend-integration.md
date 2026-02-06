# 0067. Substrates Backend Integration

**Date**: 2026-02-06
**Status**: Accepted
**Backlog Item**: TASK-0255

## Problem Statement

The substrate registry (`src/substrates/index.ts`) defines 5 entity types with `parent_id`, but the storage layer, schema, and MCP tools only understand task/epic with `epic_id`. Two parallel type systems exist that need unification.

## Problem Space

### Why This Problem Exists

ADR 0065 designed the unified entity model and the substrate registry was built, but integration into the actual storage/tool layer was deferred. The v2 create tool was built but never registered. Result: a "design island" disconnected from the working system.

### Who Is Affected

- LLM agents: Cannot create folders, artifacts, or milestones. Cannot use parent_id for subtasks.
- Users: Limited to flat task/epic hierarchy.

### Problem Boundaries

**In scope**: schema.ts, task-storage.ts, backlog-service.ts, MCP tools (create/list/update), viewer-routes.ts, search filters, delete v2 tool.

**Out of scope**: Migration script, viewer UI for new types, substrate Zod validation at write time.

### Problem-Space Map

**Dominant cause**: Incremental development - substrate registry built first, integration deferred.

**Alternative root cause**: The substrate design might need revision before integration. (Rejected: ADR 0065 is sound, the types and relationships are well-defined.)

**What if we're wrong**: If the 5 entity types prove insufficient or the parent_id model is flawed, we'll have spread the problem deeper. Mitigated by keeping epic_id backward compat.

## Context

### Current State

- `schema.ts`: `TaskType = 'task' | 'epic'`, `Task` interface with `epic_id`
- `substrates/index.ts`: 5 types, `parent_id`, Zod schemas, ID utilities - nothing uses it
- `backlog-create-v2.ts`: Exists but unregistered, casts to `any`

### Research Findings

- Storage layer uses `gray-matter` for markdown files - type-agnostic, will work with new fields
- Search service indexes `epic_id` in filters - needs `parent_id` support
- `SearchableType` is `'task' | 'epic' | 'resource'` - new types map to existing search patterns
- All 244 existing tests pass

## Proposed Solutions

### Option 1: Inline Expansion `[SHORT-TERM]` `[LOW]`

Expand schema.ts directly with all 5 types, prefixes, and parent_id. Keep schema.ts as the single source of truth for the storage layer. Don't couple to substrates module.

**Differs from others by**:
- vs Option 2: No new import dependencies, schema.ts self-contained
- vs Option 3: Additive changes only, no module restructuring

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | Smallest change set |
| Risk | 4 | Simple additive, low breakage chance |
| Testability | 4 | Same patterns, more cases |
| Future flexibility | 2 | Minor prefix duplication with substrates |
| Operational complexity | 5 | No new modules |
| Blast radius | 4 | Contained to listed files |

### Option 2: Schema Delegates to Substrates `[MEDIUM-TERM]` `[MEDIUM]`

schema.ts imports type constants and prefix map from substrates/index.ts. Adapter pattern.

**Differs from others by**:
- vs Option 1: New import dependency on substrates module
- vs Option 3: Keeps schema.ts as adapter, doesn't eliminate it

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | Slightly more wiring |
| Risk | 3 | Cross-module coupling risk |
| Testability | 4 | Same patterns |
| Future flexibility | 4 | Single source of truth |
| Operational complexity | 4 | One new import path |
| Blast radius | 3 | Import chain changes |

### Option 3: Full Substrate Replacement `[LONG-TERM]` `[HIGH]`

Replace schema.ts with substrates. Storage uses Entity type directly.

**Differs from others by**:
- vs Option 1: Complete rewrite vs additive
- vs Option 2: Eliminates schema.ts entirely

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 1 | Massive rewrite |
| Risk | 1 | Every file changes |
| Testability | 3 | Many test rewrites |
| Future flexibility | 5 | Cleanest architecture |
| Operational complexity | 2 | New patterns everywhere |
| Blast radius | 1 | Touches everything |

## Decision

**Selected**: Option 1 - Inline Expansion

**Rationale**: Task directive is "evolve existing v1 tools." Option 1 is most aligned - additive changes to schema.ts, minimal blast radius, backward compatible. The substrate registry remains as Zod validation source of truth; schema.ts defines the storage interface.

**For this decision to be correct**:
1. The 5 entity types and prefixes are stable
2. Backward compatibility with epic_id matters more than architectural purity
3. Minor prefix duplication is acceptable

**Trade-offs Accepted**:
- Prefix definitions in both schema.ts and substrates/index.ts
- Future type additions require updating both files

## Implementation Notes

- `parent_id` takes precedence over `epic_id` when both present
- `epic_id` remains as alias in all tools for backward compat
- New types (folder, artifact, milestone) use same storage mechanism (markdown + frontmatter)
- Search filters extended to support `parent_id`
- `getMaxId` uses prefix map to find correct pattern per type
