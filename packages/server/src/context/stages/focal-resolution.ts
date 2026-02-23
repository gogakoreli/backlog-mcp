/**
 * Stage 1: Focal Resolution (ADR-0074, ADR-0075)
 *
 * Resolves the focal entity — the primary entity the context is built around.
 * Given a task ID, returns the full entity with all fields.
 * Given a query string, searches for the best matching entity (Phase 2).
 */

import type { Entity } from '@backlog-mcp/shared';
import { EntityType } from '@backlog-mcp/shared';
import type { ContextEntity, ContextRequest } from '../types.js';

/**
 * Convert a Task to a full-fidelity ContextEntity.
 */
export function taskToContextEntity(task: Entity, fidelity: 'full' | 'summary' | 'reference' = 'full'): ContextEntity {
  const entity: ContextEntity = {
    id: task.id,
    title: task.title,
    status: task.status,
    type: task.type ?? EntityType.Task,
    fidelity,
  };

  const parentId = task.parent_id ?? task.epic_id;
  if (parentId) entity.parent_id = parentId;

  if (fidelity === 'reference') return entity;

  // Summary and full: include timestamps and references
  entity.created_at = task.created_at;
  entity.updated_at = task.updated_at;
  if (task.references?.length) entity.references = task.references;

  if (fidelity === 'summary') return entity;

  // Full: include description, evidence, blocked_reason
  if (task.description) entity.description = task.description;
  if (task.evidence?.length) entity.evidence = task.evidence;
  if (task.blocked_reason?.length) entity.blocked_reason = task.blocked_reason;

  return entity;
}

export interface FocalResolutionResult {
  focal: ContextEntity;
  /** The raw Task object, needed by subsequent stages */
  focalTask: Entity;
  /** How the focal was resolved */
  resolved_from: 'id' | 'query';
}

export interface SearchDeps {
  /** Search for entities matching a query. Returns top results ordered by relevance. */
  search: (query: string) => Promise<Array<{ item: Entity; score: number }>>;
}

/**
 * Resolve the focal entity from a ContextRequest.
 *
 * Supports two resolution modes:
 *   1. ID-based (task_id): Direct lookup — O(1), deterministic.
 *   2. Query-based (query): Search for best match — async, returns top result.
 *
 * @param request - The context request (must have task_id or query)
 * @param getTask - Injected dependency: look up a task by ID
 * @param searchDeps - Optional search dependencies for query-based resolution
 * @returns The focal entity at full fidelity, or null if not found
 */
export async function resolveFocal(
  request: ContextRequest,
  getTask: (id: string) => Entity | undefined,
  searchDeps?: SearchDeps,
): Promise<FocalResolutionResult | null> {
  if (request.task_id) {
    const task = getTask(request.task_id);
    if (!task) return null;
    return {
      focal: taskToContextEntity(task, 'full'),
      focalTask: task,
      resolved_from: 'id',
    };
  }

  if (request.query && searchDeps) {
    const results = await searchDeps.search(request.query);
    if (results.length === 0) return null;

    // Use the top search result as focal entity
    const topResult = results[0]!;
    return {
      focal: taskToContextEntity(topResult.item, 'full'),
      focalTask: topResult.item,
      resolved_from: 'query',
    };
  }

  return null;
}
