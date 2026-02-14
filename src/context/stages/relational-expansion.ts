/**
 * Stage 2: Relational Expansion (ADR-0074)
 *
 * Traverses the entity graph from the focal point to collect related items:
 *   - Parent entity (if focal has parent_id or epic_id)
 *   - Children (entities whose parent_id matches focal's ID)
 *   - Siblings (entities sharing the same parent, excluding focal)
 *   - Related resources (markdown files in resources/ associated with focal or parent)
 *
 * KNOWN LIMITATION: Depth > 1 not implemented in Phase 1.
 * See ADR-0074 "Known Hacks" section 5.
 *
 * KNOWN HACK: Resource discovery uses path-based heuristic (scanning for
 * files whose path contains the entity ID). See ADR-0074 "Known Hacks" section 2.
 *
 * KNOWN HACK: Sibling fetching loads all children of parent.
 * See ADR-0074 "Known Hacks" section 3.
 */

import type { Task } from '@/storage/schema.js';
import type { Resource } from '@/search/types.js';
import type { ContextEntity, ContextResource } from '../types.js';
import { taskToContextEntity } from './focal-resolution.js';

export interface RelationalExpansionDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Task | undefined;
  /** List tasks with optional parent_id filter */
  listTasks: (filter: { parent_id?: string; limit?: number }) => Task[];
  /** List all resources */
  listResources: () => Resource[];
}

export interface RelationalExpansionResult {
  parent: ContextEntity | null;
  children: ContextEntity[];
  siblings: ContextEntity[];
  related_resources: ContextResource[];
}

/**
 * Convert a Resource to a ContextResource.
 */
function resourceToContextResource(resource: Resource, fidelity: 'full' | 'summary' | 'reference' = 'summary'): ContextResource {
  const ctx: ContextResource = {
    uri: resource.id,
    title: resource.title,
    path: resource.path,
    fidelity,
  };

  if (fidelity === 'reference') return ctx;

  // Summary: include a snippet (first ~120 chars of content)
  if (resource.content) {
    const text = resource.content.trim();
    ctx.snippet = text.length > 120 ? text.slice(0, 120) + '...' : text;
  }

  if (fidelity === 'summary') return ctx;

  // Full: include complete content
  ctx.content = resource.content;

  return ctx;
}

/**
 * Find resources related to a set of entity IDs by path heuristic.
 *
 * Scans resources for paths containing any of the given IDs.
 * Example: TASK-0042 matches resources/TASK-0042/design.md
 *
 * Also matches resources whose path contains the parent's ID,
 * which surfaces epic-level design docs for tasks within that epic.
 */
function findRelatedResources(
  entityIds: string[],
  allResources: Resource[],
): Resource[] {
  if (entityIds.length === 0) return [];

  // Normalize IDs for path matching
  const idSet = new Set(entityIds.map(id => id.toLowerCase()));

  return allResources.filter(r => {
    const pathLower = r.path.toLowerCase();
    return [...idSet].some(id => pathLower.includes(id));
  });
}

/**
 * Expand relational context from a focal entity.
 *
 * @param focalTask - The focal Task (from Stage 1)
 * @param _depth - Expansion depth (Phase 1 only supports depth 1)
 * @param deps - Injected service dependencies
 */
export function expandRelations(
  focalTask: Task,
  _depth: number,
  deps: RelationalExpansionDeps,
): RelationalExpansionResult {
  const parentId = focalTask.parent_id ?? focalTask.epic_id;

  // ── Parent ───────────────────────────────────────────────────────
  let parent: ContextEntity | null = null;
  if (parentId) {
    const parentTask = deps.getTask(parentId);
    if (parentTask) {
      parent = taskToContextEntity(parentTask, 'summary');
    }
  }

  // ── Children (items whose parent is the focal entity) ────────────
  // Use a generous limit — token budgeting will trim later
  const childTasks = deps.listTasks({ parent_id: focalTask.id, limit: 50 });
  const children = childTasks.map(t => taskToContextEntity(t, 'summary'));

  // ── Siblings (same parent, excluding focal) ──────────────────────
  let siblings: ContextEntity[] = [];
  if (parentId) {
    const siblingTasks = deps.listTasks({ parent_id: parentId, limit: 50 });
    siblings = siblingTasks
      .filter(t => t.id !== focalTask.id)
      .map(t => taskToContextEntity(t, 'summary'));
  }

  // ── Related resources ────────────────────────────────────────────
  const resourceIds = [focalTask.id];
  if (parentId) resourceIds.push(parentId);
  const allResources = deps.listResources();
  const matchedResources = findRelatedResources(resourceIds, allResources);
  const related_resources = matchedResources.map(r => resourceToContextResource(r, 'summary'));

  return { parent, children, siblings, related_resources };
}
