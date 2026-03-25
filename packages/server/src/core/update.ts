import type { IBacklogService } from '../storage/service-types.js';
import { NotFoundError, type UpdateParams, type UpdateResult } from './types.js';

export async function updateItem(service: IBacklogService, params: UpdateParams): Promise<UpdateResult> {
  const { id, epic_id, parent_id, due_date, content_type, ...updates } = params;

  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  // parent_id takes precedence over epic_id
  if (parent_id !== undefined) {
    if (parent_id === null) {
      delete task.parent_id;
      delete task.epic_id;
    } else {
      task.parent_id = parent_id;
    }
  } else if (epic_id !== undefined) {
    if (epic_id === null) {
      delete task.epic_id;
      delete task.parent_id;
    } else {
      task.epic_id = epic_id;
      task.parent_id = epic_id;
    }
  }

  // Nullable type-specific fields: null clears, string sets
  for (const [key, val] of Object.entries({ due_date, content_type })) {
    if (val === null) delete (task as any)[key];
    else if (val !== undefined) (task as any)[key] = val;
  }

  Object.assign(task, updates, { updated_at: new Date().toISOString() });
  await service.save(task);
  return { id };
}
