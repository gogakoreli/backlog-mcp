/**
 * Stage 2.5: Cross-Reference Traversal (ADR-0077, ADR-0078)
 *
 * Follows explicit `references[]` links in both directions:
 *   - Forward: focal → referenced entities (Phase 4, ADR-0077)
 *   - Reverse: who references focal? (Phase 5, ADR-0078)
 *
 * Forward references: parses entity IDs from focal's (and parent's)
 * references[] URLs and resolves the linked entities.
 *
 * Reverse references: scans all tasks in the backlog to find entities whose
 * references[] contain the focal entity's ID, then resolves those entities.
 *
 * Design decisions:
 *   - Forward refs collected from focal + parent. Reverse refs collected
 *     for focal only (not parent) to avoid noise explosion. Parent reverse
 *     refs are the parent's business; they'd add tangential context.
 *   - Reverse index built on-demand via O(n) scan of all tasks.
 *     Acceptable for backlogs < 1000 entities (< 5ms scan time).
 *   - Both forward and reverse refs returned at summary fidelity.
 *   - Separate arrays: `cross_referenced` (forward) and `referenced_by` (reverse).
 *     This gives agents clear semantics: "you reference these" vs "these reference you".
 *   - Both dedup against the visited set. An entity found via forward ref
 *     won't also appear in reverse ref.
 *
 * KNOWN HACK: Entity ID extraction uses a regex scan over the entire URL
 * string. This could produce false positives for URLs that happen to contain
 * ID-like patterns (e.g., "TASK-0001" in a commit message URL). In practice
 * this is rare and the dedup against existing entities prevents most issues.
 * See ADR-0077 "Known Hacks" section.
 *
 * KNOWN HACK: Reverse reference index is built on-demand via O(n) scan of
 * all tasks at query time. For large backlogs (>1000 tasks), this could add
 * latency. See ADR-0078 "Known Hacks" section.
 * Future fix: persistent reverse index updated on mutations via BacklogService hooks.
 *
 * KNOWN HACK: Reverse references only checked for the focal entity, not
 * parent or siblings. This keeps noise low but misses "who references my
 * parent?" context. See ADR-0078 "Known Hacks" section.
 */

import type { Entity, Reference } from '@backlog-mcp/shared';
import type { ContextEntity } from '../types.js';
import { taskToContextEntity } from './focal-resolution.js';

// Pattern matches entity IDs like TASK-0042, EPIC-0005, FLDR-0001, etc.
// Used to extract entity references from arbitrary URL strings.
const ENTITY_ID_PATTERN = /\b(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})\b/g;

export interface CrossReferenceTraversalDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Entity | undefined;
  /** List tasks with optional filters. Called with {} to get all tasks for reverse index. */
  listTasks?: (filter: { parent_id?: string; limit?: number }) => Entity[];
}

export interface CrossReferenceTraversalResult {
  /** Entities referenced by the focal entity (and optionally parent) — forward direction */
  cross_referenced: ContextEntity[];
  /** Entities whose references[] point to the focal entity — reverse direction (Phase 5) */
  referenced_by: ContextEntity[];
}

/**
 * Extract entity IDs from a reference URL.
 *
 * Handles:
 *   - Direct IDs: "TASK-0041" → ["TASK-0041"]
 *   - URLs with IDs: "https://example.com/TASK-0041" → ["TASK-0041"]
 *   - Multiple IDs: "TASK-0041 and EPIC-0005" → ["TASK-0041", "EPIC-0005"]
 *   - Resource URIs: "mcp://backlog/resources/..." → [] (no entity ID)
 *   - Plain URLs: "https://github.com/org/repo" → [] (no entity ID)
 */
export function extractEntityIds(url: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state (global flag means we must reset)
  ENTITY_ID_PATTERN.lastIndex = 0;

  while ((match = ENTITY_ID_PATTERN.exec(url)) !== null) {
    ids.push(match[0]);
  }

  return ids;
}

/**
 * Collect unique entity IDs from a set of references.
 * Deduplicates and excludes IDs already in the visited set.
 */
function collectReferencedIds(
  references: Reference[],
  visited: Set<string>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const ref of references) {
    const extracted = extractEntityIds(ref.url);
    for (const id of extracted) {
      if (!visited.has(id) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

/**
 * Build a reverse reference index from all tasks.
 *
 * Scans every task's `references[]` field to build a map:
 *   targetEntityId → [sourceTaskIds that reference it]
 *
 * KNOWN HACK: This is an O(n) scan where n = total tasks in the backlog.
 * For backlogs < 1000 tasks, this is fast (< 5ms). For larger backlogs,
 * a persistent index maintained on mutations would be more efficient.
 * See ADR-0078 "Known Hacks" section.
 *
 * @param allTasks - All tasks in the backlog
 * @returns Map from target entity ID to array of source entity IDs
 */
export function buildReverseReferenceIndex(allTasks: Entity[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const task of allTasks) {
    if (!task.references?.length) continue;

    for (const ref of task.references) {
      const targetIds = extractEntityIds(ref.url);
      for (const targetId of targetIds) {
        // Don't index self-references
        if (targetId === task.id) continue;

        let sources = index.get(targetId);
        if (!sources) {
          sources = [];
          index.set(targetId, sources);
        }
        // Avoid duplicate entries from multiple refs pointing to same target
        if (!sources.includes(task.id)) {
          sources.push(task.id);
        }
      }
    }
  }

  return index;
}

/**
 * Look up reverse references for a focal entity.
 *
 * Given a reverse reference index, finds entities that reference the focal
 * entity and resolves them at summary fidelity.
 *
 * @param focalId - The focal entity ID to look up reverse refs for
 * @param reverseIndex - Pre-built reverse reference index
 * @param visited - Set of entity IDs already in context. Mutated: resolved IDs are added.
 * @param deps - Injected service dependencies
 * @returns Entities that reference the focal entity, at summary fidelity
 */
export function lookupReverseReferences(
  focalId: string,
  reverseIndex: Map<string, string[]>,
  visited: Set<string>,
  deps: Pick<CrossReferenceTraversalDeps, 'getTask'>,
): ContextEntity[] {
  const sourceIds = reverseIndex.get(focalId);
  if (!sourceIds || sourceIds.length === 0) return [];

  const referenced_by: ContextEntity[] = [];
  const MAX_REVERSE_REFS = 10;

  for (const sourceId of sourceIds) {
    if (referenced_by.length >= MAX_REVERSE_REFS) break;
    if (visited.has(sourceId)) continue;

    const task = deps.getTask(sourceId);
    if (!task) continue; // Source entity no longer exists — skip

    visited.add(sourceId);
    referenced_by.push(taskToContextEntity(task, 'summary'));
  }

  return referenced_by;
}

/**
 * Traverse cross-references from the focal entity and optionally its parent.
 *
 * Phase 5 (ADR-0078): Now supports both forward and reverse references.
 *
 * @param focalTask - The focal Task (from Stage 1)
 * @param parentTask - The parent Task (from Stage 2), or null
 * @param visited - Set of entity IDs already in context (from Stages 1-2). Mutated: resolved IDs are added.
 * @param deps - Injected service dependencies
 * @returns Forward cross-referenced entities and reverse referenced-by entities, both at summary fidelity
 */
export function traverseCrossReferences(
  focalTask: Entity,
  parentTask: Entity | null,
  visited: Set<string>,
  deps: CrossReferenceTraversalDeps,
): CrossReferenceTraversalResult {
  // ── Forward references (Phase 4) ───────────────────────────────
  // Collect references from focal and parent
  const allRefs: Reference[] = [];

  if (focalTask.references?.length) {
    allRefs.push(...focalTask.references);
  }
  if (parentTask?.references?.length) {
    allRefs.push(...parentTask.references);
  }

  const cross_referenced: ContextEntity[] = [];
  const MAX_CROSS_REFS = 10;

  if (allRefs.length > 0) {
    // Extract unique entity IDs not already in context
    const referencedIds = collectReferencedIds(allRefs, visited);

    // Resolve each referenced entity
    // Cap at 10 to prevent reference explosion from heavily-linked entities
    for (const id of referencedIds) {
      if (cross_referenced.length >= MAX_CROSS_REFS) break;

      const task = deps.getTask(id);
      if (!task) continue; // Reference points to non-existent entity — skip silently

      visited.add(id);
      cross_referenced.push(taskToContextEntity(task, 'summary'));
    }
  }

  // ── Reverse references (Phase 5, ADR-0078) ─────────────────────
  // Build reverse index and look up who references the focal entity.
  // Only check reverse refs for focal (not parent) to keep noise low.
  let referenced_by: ContextEntity[] = [];

  if (deps.listTasks) {
    const allTasks = deps.listTasks({});
    const reverseIndex = buildReverseReferenceIndex(allTasks);
    referenced_by = lookupReverseReferences(focalTask.id, reverseIndex, visited, deps);
  }

  return { cross_referenced, referenced_by };
}
