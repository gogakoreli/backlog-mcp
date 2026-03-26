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
  if (due_date === null) delete task.due_date;
  else if (due_date !== undefined) task.due_date = due_date;

  if (content_type === null) delete task.content_type;
  else if (content_type !== undefined) task.content_type = content_type;

  Object.assign(task, updates, { updated_at: new Date().toISOString() });
  await service.save(task);
  return { id };
}
