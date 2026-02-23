/**
 * Stage 2: Relational Expansion (ADR-0074, ADR-0076)
 *
 * Traverses the entity graph from the focal point to collect related items:
 *   - Ancestors (parent, grandparent, etc. up to requested depth)
 *   - Children (entities whose parent_id matches focal's ID)
 *   - Grandchildren (children of children, at depth 2+)
 *   - Siblings (entities sharing the same parent, excluding focal)
 *   - Related resources (markdown files in resources/ associated with visited entities)
 *
 * Phase 3 changes (ADR-0076):
 *   - Depth 2+ now implemented with recursive traversal
 *   - Visited-set cycle detection prevents infinite loops from circular parent refs
 *   - Entities carry `graph_depth` indicating how many hops from focal
 *   - Ancestor chain traversal (grandparent, great-grandparent)
 *   - Grandchildren included at depth 2+
 *   - Resource discovery scans all visited entity IDs
 *
 * KNOWN HACK: Resource discovery uses path-based heuristic (scanning for
 * files whose path contains the entity ID). See ADR-0074 "Known Hacks" section 2.
 * Semantic enrichment (Stage 3) supplements this with search-based discovery.
 *
 * KNOWN HACK: Sibling fetching loads all children of parent.
 * See ADR-0074 "Known Hacks" section 3.
 */

import type { Entity } from '@backlog-mcp/shared';
import type { Resource } from '@/search/types.js';
import type { ContextEntity, ContextResource } from '../types.js';
import { taskToContextEntity } from './focal-resolution.js';

export interface RelationalExpansionDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Entity | undefined;
  /** List tasks with optional parent_id filter */
  listTasks: (filter: { parent_id?: string; limit?: number }) => Entity[];
  /** List all resources */
  listResources: () => Resource[];
}

export interface RelationalExpansionResult {
  parent: ContextEntity | null;
  children: ContextEntity[];
  siblings: ContextEntity[];
  /** Ancestor chain beyond direct parent (grandparent, great-grandparent). Ordered closest-first. */
  ancestors: ContextEntity[];
  /** Children of children (depth 2+). Grouped flat, each carries graph_depth. */
  descendants: ContextEntity[];
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
 * Traverse ancestor chain (parent → grandparent → ...) up to maxHops.
 * Uses visited set for cycle detection.
 *
 * Returns ancestors in order: [parent, grandparent, great-grandparent, ...]
 */
function traverseAncestors(
  startTask: Entity,
  maxHops: number,
  visited: Set<string>,
  getTask: (id: string) => Entity | undefined,
): { ancestors: Array<{ task: Entity; depth: number }>; parentTask: Entity | null } {
  const ancestors: Array<{ task: Entity; depth: number }> = [];
  let current = startTask;
  let parentTask: Entity | null = null;

  for (let hop = 1; hop <= maxHops; hop++) {
    const pid = current.parent_id ?? current.epic_id;
    if (!pid || visited.has(pid)) break;

    const ancestor = getTask(pid);
    if (!ancestor) break;

    visited.add(pid);
    ancestors.push({ task: ancestor, depth: hop });

    if (hop === 1) parentTask = ancestor;
    current = ancestor;
  }

  return { ancestors, parentTask };
}

/**
 * Collect descendants (children, grandchildren, etc.) up to maxDepth hops below focal.
 * Uses visited set for cycle detection.
 *
 * Returns descendants grouped by depth level.
 */
function collectDescendants(
  focalId: string,
  maxDepth: number,
  visited: Set<string>,
  listTasks: (filter: { parent_id?: string; limit?: number }) => Entity[],
): { children: Entity[]; deepDescendants: Array<{ task: Entity; depth: number }> } {
  const children: Entity[] = [];
  const deepDescendants: Array<{ task: Entity; depth: number }> = [];

  // BFS by depth level
  let currentLevel = [focalId];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextLevel: string[] = [];

    for (const parentId of currentLevel) {
      const childTasks = listTasks({ parent_id: parentId, limit: 50 });

      for (const child of childTasks) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);

        if (depth === 1) {
          children.push(child);
        } else {
          deepDescendants.push({ task: child, depth });
        }

        nextLevel.push(child.id);
      }
    }

    currentLevel = nextLevel;
    if (currentLevel.length === 0) break;
  }

  return { children, deepDescendants };
}

/**
 * Expand relational context from a focal entity.
 *
 * Phase 3 (ADR-0076): Now supports depth > 1 with recursive traversal
 * and cycle detection via visited set.
 *
 * @param focalTask - The focal Task (from Stage 1)
 * @param depth - Expansion depth (1-3). Controls how many hops in each direction.
 * @param deps - Injected service dependencies
 */
export function expandRelations(
  focalTask: Entity,
  depth: number,
  deps: RelationalExpansionDeps,
): RelationalExpansionResult {
  // Visited set for cycle detection — prevents infinite loops from
  // circular parent_id references (which can occur from data bugs)
  const visited = new Set<string>([focalTask.id]);

  // ── Ancestors (parent, grandparent, ...) ────────────────────────
  const { ancestors: ancestorTasks, parentTask } = traverseAncestors(
    focalTask,
    depth,
    visited,
    deps.getTask,
  );

  const parent: ContextEntity | null = parentTask
    ? taskToContextEntity(parentTask, 'summary')
    : null;

  // Ancestors beyond direct parent (depth 2+)
  const ancestors: ContextEntity[] = ancestorTasks
    .filter(a => a.depth > 1)
    .map(a => {
      const entity = taskToContextEntity(a.task, 'reference');
      entity.graph_depth = a.depth;
      return entity;
    });

  // ── Descendants (children, grandchildren, ...) ──────────────────
  const { children: childTasks, deepDescendants } = collectDescendants(
    focalTask.id,
    depth,
    visited,
    deps.listTasks,
  );

  const children = childTasks.map(t => taskToContextEntity(t, 'summary'));

  const descendants: ContextEntity[] = deepDescendants.map(d => {
    const entity = taskToContextEntity(d.task, 'reference');
    entity.graph_depth = d.depth;
    return entity;
  });

  // ── Siblings (same parent, excluding focal) ──────────────────────
  const parentId = focalTask.parent_id ?? focalTask.epic_id;
  let siblings: ContextEntity[] = [];
  if (parentId) {
    const siblingTasks = deps.listTasks({ parent_id: parentId, limit: 50 });
    siblings = siblingTasks
      .filter(t => t.id !== focalTask.id && !visited.has(t.id))
      .map(t => taskToContextEntity(t, 'summary'));
    // Mark siblings as visited to prevent resource duplication
    for (const s of siblingTasks) visited.add(s.id);
  }

  // ── Related resources ────────────────────────────────────────────
  // Scan all visited entity IDs for path-based resource matches
  // At depth 2+, this surfaces resources for grandparent, grandchildren, etc.
  const resourceIds = [focalTask.id];
  if (parentId) resourceIds.push(parentId);
  for (const a of ancestorTasks) resourceIds.push(a.task.id);
  // Include child IDs for resource discovery (but not all descendants to avoid noise)
  for (const c of childTasks) resourceIds.push(c.id);

  const allResources = deps.listResources();
  const matchedResources = findRelatedResources(resourceIds, allResources);
  const related_resources = matchedResources.map(r => resourceToContextResource(r, 'summary'));

  return { parent, children, siblings, ancestors, descendants, related_resources };
}
