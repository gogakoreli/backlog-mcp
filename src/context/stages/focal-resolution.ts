/**
 * Stage 1: Focal Resolution (ADR-0074)
 *
 * Resolves the focal entity — the primary entity the context is built around.
 * Given a task ID, returns the full entity with all fields.
 *
 * KNOWN LIMITATION: query-based focal resolution (natural language → entity)
 * is not implemented in Phase 1. See ADR-0074 "Known Hacks" section 4.
 */

import type { Task } from '@/storage/schema.js';
import type { ContextEntity, ContextRequest } from '../types.js';

/**
 * Convert a Task to a full-fidelity ContextEntity.
 */
export function taskToContextEntity(task: Task, fidelity: 'full' | 'summary' | 'reference' = 'full'): ContextEntity {
  const entity: ContextEntity = {
    id: task.id,
    title: task.title,
    status: task.status,
    type: task.type || 'task',
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
  focalTask: Task;
}

/**
 * Resolve the focal entity from a ContextRequest.
 *
 * @param request - The context request (must have task_id)
 * @param getTask - Injected dependency: look up a task by ID
 * @returns The focal entity at full fidelity, or null if not found
 */
export function resolveFocal(
  request: ContextRequest,
  getTask: (id: string) => Task | undefined,
): FocalResolutionResult | null {
  if (request.task_id) {
    const task = getTask(request.task_id);
    if (!task) return null;
    return {
      focal: taskToContextEntity(task, 'full'),
      focalTask: task,
    };
  }

  // query-based resolution: Phase 2 (not yet implemented)
  // See ADR-0074 "Known Hacks" section 4.
  return null;
}
