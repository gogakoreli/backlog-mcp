# 0078. Context Hydration Phase Five — Reverse Cross-References

**Date**: 2026-02-15
**Status**: Accepted
**Supersedes**: ADR-0077 Phase 5 roadmap item (reverse cross-references)
**Related**: ADR-0074 (Phase 1 — Architecture), ADR-0075 (Phase 2 — Semantic + Temporal), ADR-0076 (Phase 3 — Depth 2+ + Session Memory), ADR-0077 (Phase 4 — Cross-Reference Traversal)

## Context

ADR-0077 shipped Phase 4: forward cross-reference traversal. The pipeline follows `references[]` links from the focal entity and its parent to resolve referenced entities. But link awareness was one-directional:

> "If TASK-0041 references TASK-0042 but TASK-0042 does not reference TASK-0041, the link is invisible when viewing TASK-0042's context. The agent working on TASK-0042 doesn't know that TASK-0041 links to it." — ADR-0077, Known Hack #9

This was identified as Priority 1 for Phase 5.

### Why This Matters

References are intentional, human-curated links. They're bidirectional by nature — if TASK-0041 references TASK-0042, that relationship matters from both perspectives:

- **Forward** (viewing TASK-0041): "I reference TASK-0042" — already surfaced in Phase 4
- **Reverse** (viewing TASK-0042): "TASK-0041 references me" — invisible before Phase 5

Real-world scenario: An agent working on TASK-0042 doesn't know that TASK-0041 depends on it. If TASK-0042 is being refactored, the agent might break TASK-0041's assumptions without realizing the dependency exists. Reverse references close this visibility gap.

Semantic enrichment (Stage 3) partially compensates — it may discover TASK-0041 through search if the titles/descriptions overlap. But search is probabilistic and can miss links between semantically dissimilar entities. Reverse cross-references are deterministic: if the link exists in `references[]`, it will be found.

## Decision

Implement Phase 5 with three changes:

### 1. Reverse Reference Index (On-Demand)

**File**: `src/context/stages/cross-reference-traversal.ts`

New function `buildReverseReferenceIndex(allTasks: Task[]): Map<string, string[]>` that scans all tasks' `references[]` fields to build a map: `targetEntityId -> [sourceTaskIds that reference it]`.

**How it works**:
1. Iterate all tasks in the backlog
2. For each task with `references[]`, extract entity IDs from each reference URL (reusing `extractEntityIds()`)
3. For each extracted target ID, add the source task's ID to the reverse index
4. Skip self-references (a task referencing itself)
5. Deduplicate entries (a source with multiple refs to the same target appears once)

**Why on-demand (not persistent)?**

Two approaches were considered:

| Approach | Pros | Cons |
|----------|------|------|
| On-demand O(n) scan | Stateless, no mutation hooks, simple | O(n) per request |
| Persistent index | O(1) per request | Requires mutation hooks in BacklogService, stale index risk |

For backlogs < 1000 tasks, the O(n) scan takes < 5ms. This is well within acceptable latency for a single context request. The persistent index adds complexity (mutation hooks in `BacklogService.add()`, `.save()`, `.delete()`, and `ResourceManager.write()`) that isn't justified yet.

Decision: **On-demand scan for Phase 5**. Document the persistent index as the future fix path for large backlogs.

### 2. Reverse Reference Lookup

**File**: `src/context/stages/cross-reference-traversal.ts`

New function `lookupReverseReferences(focalId, reverseIndex, visited, deps)` that:
1. Queries the reverse index for the focal entity's ID
2. Resolves source entities at summary fidelity
3. Deduplicates against the visited set (same mechanism as forward refs)
4. Caps at 10 entities (same limit as forward refs)
5. Adds resolved IDs to the visited set (for Stage 3 dedup)

**Integration into Stage 2.5**: The existing `traverseCrossReferences()` is extended:
- Forward refs processed first (unchanged from Phase 4)
- Then reverse refs processed, using the same visited set
- Results returned in separate arrays: `cross_referenced` (forward) and `referenced_by` (reverse)

**Why focal-only (not parent)?**
Forward refs are collected from focal + parent. For reverse refs, we only check who references the focal entity — not who references the parent. Rationale:
- "Who references my parent?" is tangential context. The parent's reverse refs are the parent's business.
- Including parent reverse refs would double the noise without proportional signal gain.
- Agents can request the parent's context separately if needed.

### 3. Token Budget Priority Extension

**File**: `src/context/token-budget.ts`

The budget priority order is extended from 11 levels (Phase 4) to 12 levels:

```
Priority  1: Focal entity            — always full fidelity, never dropped
Priority  2: Parent entity           — always summary fidelity, never dropped
Priority  3: Session summary         — high value, tells agent about last session
Priority  4: Children                — summary, downgrade to reference if needed
Priority  5: Siblings                — summary, downgrade to reference if needed
Priority  6: Cross-referenced        — summary, downgrade to reference if needed
Priority  7: Referenced-by           — summary, downgrade to reference if needed  <-- NEW
Priority  8: Ancestors               — reference fidelity, structural breadcrumb
Priority  9: Descendants             — reference fidelity, structural awareness
Priority 10: Related (semantic)      — summary, downgrade to reference if needed
Priority 11: Resources               — summary, downgrade to reference if needed
Priority 12: Activity                — fixed cost, drop entries if needed
```

**Why referenced-by at priority 7 (after cross-referenced, before ancestors)?**

Forward cross-references (priority 6) are links the user/agent explicitly created FROM the focal entity. They represent the focal entity's perspective: "I depend on these." Referenced-by entities (priority 7) are links others created TO the focal entity. They represent external perspectives: "these depend on me."

Both are explicit intentional links, but forward refs are slightly higher signal because the user created them while authoring the focal entity — they're more likely to be immediately relevant to the current work. Referenced-by entities provide awareness ("others depend on you") but may be less actionable in the moment.

## Type System Changes

### `ContextResponse` gains `referenced_by`

```typescript
interface ContextResponse {
  // ... existing fields ...
  referenced_by: ContextEntity[];  // Entities whose references[] point to focal
}
```

### `CrossReferenceTraversalResult` gains `referenced_by`

```typescript
interface CrossReferenceTraversalResult {
  cross_referenced: ContextEntity[];  // Forward: focal references these
  referenced_by: ContextEntity[];     // Reverse: these reference focal (NEW)
}
```

### `CrossReferenceTraversalDeps` gains optional `listTasks`

```typescript
interface CrossReferenceTraversalDeps {
  getTask: (id: string) => Task | undefined;
  listTasks?: (filter: { parent_id?: string; limit?: number }) => Task[];  // NEW (optional)
}
```

When `listTasks` is not provided, reverse references are disabled (graceful degradation). This preserves backward compatibility with existing tests that only pass `getTask`.

## Dependency Injection (Extended)

The `HydrationServiceDeps` interface is unchanged from Phase 4. The existing `listTasks` dependency is now also passed to Stage 2.5 for reverse reference index building. No new dependencies needed.

## MCP Tool Changes

The `backlog_context` tool description is updated to mention reverse references. Response now includes a `referenced_by` field when non-empty.

## Known Hacks and Limitations

### Inherited from Phase 1/2/3/4

1. **Token estimation remains character-based** — `Math.ceil(text.length / 4)`. Unchanged.
2. **Resource discovery uses path heuristic for Stage 2** — unchanged.
3. **Sibling fetching loads all children of parent** — unchanged.
4. **Session boundary is a time-gap heuristic (30 min)** — unchanged.
5. **Session summary only covers focal entity** — unchanged.
6. **Descendants use flat list** — unchanged.
7. **BFS descendant limit per parent is 50** — unchanged.
8. **Entity ID extraction uses regex scan over entire URL string** — unchanged.
9. **Forward references only** — **RESOLVED in Phase 5**. Reverse references now implemented.
10. **Visited set reconstruction in hydration service** — unchanged.
11. **Parent task re-lookup for references collection** — unchanged.

### New in Phase 5

12. **Reverse reference index is built on-demand via O(n) scan**

**Location**: `src/context/stages/cross-reference-traversal.ts`, `buildReverseReferenceIndex()`
**Issue**: Every context request triggers a full scan of all tasks to build the reverse reference index. For backlogs < 1000 tasks, this is fast (< 5ms). For backlogs > 1000 tasks, latency could become noticeable.
**Why acceptable**: The MCP server targets small-to-medium backlogs. Premature optimization with persistent indices would add mutation hook complexity (BacklogService.add/save/delete, ResourceManager.write) and stale-index risks.
**Future fix**: Build a persistent reverse reference index as a `ReverseReferenceService`:
  - Initialize at startup by scanning all tasks
  - Update incrementally on `task_created`, `task_changed`, `task_deleted` events via EventBus subscription
  - Store as: `Map<string, Set<string>>` (targetId -> sourceIds)
  - Invalidate entries when a task's `references` field changes
  - Expose `getReversReferences(entityId): string[]` query method
  - Add as optional dep to `HydrationServiceDeps`

13. **Reverse references only checked for focal entity (not parent)**

**Location**: `src/context/stages/cross-reference-traversal.ts`, `traverseCrossReferences()`
**Issue**: Forward references are collected from focal + parent, but reverse references are only checked for the focal entity. If TASK-0099 references EPIC-0005 (the focal's parent), this isn't surfaced in the focal's context.
**Why acceptable**: Parent reverse references add tangential noise. "Someone references my epic" is rarely actionable for work on a specific task. The parent's context can be requested separately.
**Future fix**: Add `include_parent_reverse_refs` option to `ContextRequest` for callers who want broader awareness.

14. **Bidirectional links deduplicate to forward**

**Location**: `src/context/stages/cross-reference-traversal.ts`, `traverseCrossReferences()`
**Issue**: If TASK-0042 references TASK-0080 (forward) and TASK-0080 references TASK-0042 (reverse), TASK-0080 appears only in `cross_referenced` (forward), not in `referenced_by`. The visited set from the forward pass prevents the same entity from appearing in both arrays.
**Why acceptable**: This is correct behavior — an entity should appear in exactly one role. Forward refs are processed first (higher priority), so bidirectional links consistently resolve to forward. The agent sees the entity in context regardless of direction.
**Future fix**: Consider adding a `bidirectional: true` flag on entities that have both forward and reverse links, so agents know the relationship goes both ways.

## Invariants

### Phase 1+2+3+4 Invariants (carried forward)

1-47: All invariants from ADR-0077 carry forward unchanged.

### Reverse Cross-Reference Invariants (new)

48. **Referenced-by entities are summary fidelity**: All entities in `referenced_by` have `fidelity: 'summary'`.
49. **Referenced-by entities do not duplicate relational graph**: No entity ID in `referenced_by` also appears in focal, parent, children, siblings, ancestors, or descendants.
50. **Referenced-by entities do not duplicate forward cross-referenced**: No entity ID in `referenced_by` also appears in `cross_referenced`.
51. **Referenced-by entities do not duplicate semantic related**: No entity ID in `referenced_by` also appears in `related`.
52. **No entity in multiple roles (extended)**: A given entity ID appears in at most one of: focal, parent, children, siblings, cross_referenced, referenced_by, ancestors, descendants, related.
53. **Referenced-by capped at 10**: `referenced_by.length <= 10`.
54. **referenced_by is always an array**: Never `undefined` — empty array `[]` when no reverse references found.
55. **stages_executed correctness**: `cross_reference_traversal` appears in `stages_executed` if at least one forward OR reverse reference was resolved.
56. **total_items includes referenced_by**: `metadata.total_items` counts `referenced_by.length`.
57. **Budget priority ordering**: Referenced-by entities are budgeted after forward cross-referenced and before ancestors.
58. **Reverse index excludes self-references**: A task referencing itself does not appear in its own reverse reference index entry.
59. **Bidirectional dedup**: If entity X appears in `cross_referenced` (forward), it does not also appear in `referenced_by` (reverse).
60. **Graceful degradation**: If `listTasks` is not provided to Stage 2.5, reverse references are disabled (empty `referenced_by`).

## Test Coverage

191 tests total (up from 155 in Phase 4):

| Category | Tests | Coverage |
|----------|-------|---------|
| Stage 1: Focal Resolution (ID + query) | 7 | ID lookup, epic lookup, not-found, query resolution |
| Fidelity levels | 5 | Full, summary, reference |
| Stage 2: Relational Expansion | 11 | Parent, children, siblings, resources, orphan, leaf, epic |
| Stage 3: Semantic Enrichment | 7 | Dedup, caps, fidelity, scores |
| Stage 4: Temporal Overlay | 9 | Multi-entity, dedup, sort, summaries |
| Token estimation | 2 | String, fidelity ordering |
| Entity downgrading | 3 | Full->summary, full->reference, relevance_score |
| Token budget (Phase 1/2) | 7 | Budget allocation, priority, truncation |
| E2E pipeline | 12 | Full context, not-found, epic, budget, leaf, orphan, depth, new fields |
| Pipeline + semantic | 3 | With/without search |
| Pipeline + temporal | 3 | With/without ops |
| Pipeline + query | 3 | Query resolution |
| Contract invariants (Phase 1/2) | 13 | Fidelity, fields, metadata, dedup |
| Phase 3: Depth 2+ | 11 | Depth 1/2/3, ancestors, descendants, cycles, resources, pipeline |
| Phase 3: Session Memory | 10 | Session derivation, boundaries, gaps, summaries, pipeline |
| Phase 3: Token budget | 6 | Priority levels, session budget, graph_depth preservation |
| Phase 3: Contract invariants | 10 | Fidelity, graph_depth, uniqueness, ordering, total_items |
| Phase 4: extractEntityIds | 7 | Direct ID, URL, multiple, plain URL, resource URI, all prefixes, digit count |
| Phase 4: traverseCrossReferences | 9 | Resolution, fidelity, dedup, visited mutation, self-ref, no-refs, parent refs, non-existent, cap |
| Phase 4: Pipeline integration | 7 | Populated, empty, relational dedup, semantic dedup, stages_executed, parent refs |
| Phase 4: Token budget | 3 | Large budget, priority after siblings, priority before ancestors |
| Phase 4: Contract invariants | 6 | Summary fidelity, no relational dupes, no semantic dupes, uniqueness, total_items, always-array |
| **Phase 5: buildReverseReferenceIndex** | **7** | Target mapping, self-ref exclusion, no-refs, duplicate refs, URL extraction, multi-target, no-reverse |
| **Phase 5: lookupReverseReferences** | **6** | Fidelity, dedup, visited mutation, empty, cap, non-existent source |
| **Phase 5: traverseCrossReferences with reverse** | **4** | Both directions, listTasks absent, dedup forward vs reverse, relational dedup |
| **Phase 5: Pipeline integration** | **8** | Populated, empty, relational dedup, semantic dedup, stages_executed, reverse-only, bidirectional |
| **Phase 5: Token budget** | **4** | Large budget, after forward xrefs, before ancestors, ordering |
| **Phase 5: Contract invariants** | **8** | Summary fidelity, relational dedup, forward dedup, semantic dedup, uniqueness, total_items, always-array, cap |

## File Changes

```
Modified files:
  src/context/stages/cross-reference-traversal.ts  — buildReverseReferenceIndex, lookupReverseReferences, reverse ref integration
  src/context/types.ts                              — referenced_by field on ContextResponse
  src/context/hydration-service.ts                  — Pass listTasks to Stage 2.5, handle referenced_by
  src/context/token-budget.ts                       — 12-level priority, referenced_by at priority 7
  src/context/index.ts                              — Export new functions
  src/tools/backlog-context.ts                      — referenced_by in MCP output
  src/__tests__/context-hydration.test.ts           — 191 tests (up from 155)

New files:
  docs/adr/0078-context-hydration-phase-five.md     — This ADR
```

## Long-Term Architecture Vision

### Where We Are (After Phase 5)

The context hydration pipeline is now a mature 7-stage system with full bidirectional link awareness:

```
Request -> Stage 1 (Focal) -> Stage 2 (Relational, depth 1-3) ->
           Stage 2.5 (Forward + Reverse Cross-References) -> Stage 3 (Semantic) ->
           Stage 3.5 (Session Memory) -> Stage 4 (Temporal) ->
           Stage 5 (Token Budget) -> Response
```

Key strengths:
- **Bidirectional link awareness**: Both "you reference these" and "these reference you" are surfaced
- **Five orthogonal context dimensions**: structural, explicit links (bidirectional), semantic, temporal, session
- **Deterministic reverse references**: Unlike semantic search, reverse refs never miss an explicit link
- **12-level token-aware priority**: Graceful degradation from focal to activity
- **191 tests with 60 invariants**: Comprehensive regression prevention
- **Stateless pipeline**: No persistent state, all computed on-demand from existing stores

### What's Missing for Long-Term Resilience

1. **Persistent reverse reference index**: The on-demand O(n) scan works for small backlogs but won't scale to 10,000+ entities. A persistent index maintained via EventBus subscriptions would make reverse refs O(1).

2. **Explicit dependency graph**: The Task schema still has no `depends_on` or `blocks` field. Cross-references partially compensate (blocking tasks often appear in `references[]`), but a proper dependency graph would enable:
   - Blocking chain visualization: "TASK-0042 -> blocked by TASK-0041 (in_progress)"
   - Automatic unblock detection: "TASK-0041 done -> TASK-0042 may be unblockable"
   - Critical path analysis across the backlog

3. **Multi-entity session correlation**: Session memory covers only the focal entity. A cross-entity session timeline would show: "In the last session, claude worked on TASK-0042, updated TASK-0043, and wrote resource TASK-0042/notes.md."

4. **Proactive suggestions**: The pipeline is descriptive but not prescriptive. Analyzing context to suggest next actions:
   - "TASK-0041 was completed — consider unblocking TASK-0042"
   - "All children of EPIC-0005 are done — epic may be completable"
   - "TASK-0080 references you and was recently updated — check if it impacts your work"

5. **Viewer UI integration**: Rich context panels in the web viewer:
   - "Referenced By" panel showing reverse cross-references
   - "Cross-References" panel showing forward links
   - "Timeline" with session memory overlay
   - "Related Items" (semantic) as a discovery section

6. **Reference type classification**: All references are parsed identically. Adding `reference_type` to `Reference` schema would enable smarter traversal:
   - `entity_ref`: TASK-0041 -> resolve entity
   - `resource_ref`: mcp://backlog/resources/doc.md -> link to resource
   - `external_url`: https://github.com/... -> display as link, don't traverse
   - `dependency`: TASK-0041 -> resolve with blocking semantics

7. **Pre-computed context cache**: For high-frequency access patterns, memoize stage results. Invalidate on mutation via EventBus. Would benefit repeated context requests for the same entity within a session.

## Handoff for Next Engineer

### What was built

Phase 5 of the Retrieval-Augmented Context Pipeline. The pipeline now has bidirectional cross-reference awareness:

1. **Stage 1 — Focal Resolution**: Unchanged.
2. **Stage 2 — Relational Expansion**: Unchanged.
3. **Stage 2.5 — Cross-Reference Traversal** (**Extended in Phase 5**):
   - Forward refs (Phase 4): Follows `references[]` from focal + parent
   - Reverse refs (**Phase 5 new**): Scans all tasks to find who references the focal entity
   - Returns separate arrays: `cross_referenced` (forward) and `referenced_by` (reverse)
4. **Stage 3 — Semantic Enrichment**: Unchanged. Dedup now includes referenced_by IDs.
5. **Stage 3.5 — Session Memory**: Unchanged.
6. **Stage 4 — Temporal Overlay**: Unchanged.
7. **Stage 5 — Token Budgeting** (**Extended in Phase 5**): 12-level priority with referenced_by at priority 7.

### Architecture decisions to preserve

Everything from Phases 1-4 still holds, plus:

- **Separate arrays for forward and reverse**: `cross_referenced` and `referenced_by` are distinct fields. Don't merge them — agents need to know the direction of the link.
- **Focal-only reverse refs**: Only the focal entity's reverse refs are checked. Don't extend to parent without good reason — it adds noise.
- **On-demand index building**: The reverse index is rebuilt each request. This is intentional — keeping it stateless avoids mutation hook complexity. Only optimize when backlogs exceed 1000 entities.
- **Forward-first dedup**: When a link is bidirectional (A refs B and B refs A), the entity appears in `cross_referenced` (forward), not `referenced_by`. Forward refs are processed first (higher priority).
- **Visited set threading**: The visited set flows through: Stage 2 -> forward refs -> reverse refs -> Stage 3. This ensures no entity appears in multiple roles.

### What to build next

**Priority 1: Explicit dependency graph**
- Add `depends_on: string[]` and `blocks: string[]` fields to Task schema
- New traversal logic in Stage 2 or 2.5 to follow dependency chains
- Surface blocking chain: "TASK-0042 -> blocked by TASK-0041 (status: in_progress)"
- Higher priority than cross-references (blocking relationships are critical context)
- Start with `blocked_reason` analysis: many tasks already have "blocked by TASK-XXXX" strings

**Priority 2: Persistent reverse reference index**
- Build `ReverseReferenceService` class
- Subscribe to EventBus for `task_created`, `task_changed`, `task_deleted`
- Initialize at startup by scanning all tasks
- Incrementally update on mutations (diff old vs new references)
- Add as optional dep to `HydrationServiceDeps`
- Only needed when backlogs exceed ~1000 entities

**Priority 3: Viewer UI integration**
- "Referenced By" panel showing `referenced_by` entities
- "Cross-References" panel showing `cross_referenced` entities
- Merge with existing task detail view
- Show relationship direction with visual indicators

**Priority 4: Multi-entity session correlation**
- Extend `deriveSessionSummary()` to accept multiple entity IDs
- Correlate operations across focal + children + cross-referenced + referenced_by
- Show unified session timeline: "In one session, claude touched 4 related entities"

**Priority 5: Proactive suggestions**
- Analyze context to generate actionable suggestions
- New `suggestions: string[]` array in ContextResponse
- Start with: blocking chain detection, completion detection, stale reference detection
- Position as priority 3 in token budget (after session summary)

### Known issues to address

1. **4 pre-existing test failures**: `search-hybrid.test.ts` (2, onnxruntime) and `mcp-integration.test.ts` (2, server port/timeout). Unrelated to context hydration.
2. **O(n) reverse index scan**: Acceptable for small backlogs but document the threshold (~1000 tasks) where persistent index becomes worthwhile.
3. **Parent reverse refs not included**: Deliberately omitted for noise reduction. May reconsider if agent feedback indicates they're useful.
4. **Bidirectional dedup favors forward**: Entity appearing in both forward and reverse resolves to forward only. Consider adding a flag to indicate bidirectionality.

## Consequences

### Positive
- **Bidirectional link awareness**: Agents now see both "what I reference" and "who references me"
- **Deterministic discovery**: Unlike semantic search, reverse refs never miss an explicit link
- **Zero new dependencies**: Reuses existing `listTasks` and `getTask` — no new infrastructure
- **Graceful degradation**: When `listTasks` not available, reverse refs are simply disabled
- **191 tests with 60 invariants**: Comprehensive coverage prevents regressions
- **Backward compatible**: Existing callers get empty `referenced_by: []` with no code changes

### Negative
- **O(n) scan per request**: Each context request scans all tasks. Mitigated by small backlog sizes.
- **12-level budget priority**: More levels means more edge cases. Mitigated by comprehensive tests.
- **Referenced-by can surface tangential entities**: An entity referencing the focal for historical reasons may not be currently relevant. Mitigated by summary fidelity (low token cost) and the 10-entity cap.

### Risks
- **Large backlogs**: For backlogs > 1000 entities, the O(n) scan could add 10-50ms latency. The persistent index (Priority 2 in next-steps) would resolve this.
- **Reference churn**: Frequently updated references cause the reverse index to be slightly stale within a single request (built at request time from current state). This is actually fine — there's no persistent index to get stale.
