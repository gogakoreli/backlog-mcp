import type { IBacklogService } from '../storage/service-types.js';
import type { Operation } from '../resources/types.js';
import { applyOperation } from '../resources/operations.js';
import { NotFoundError, type EditParams, type EditResult } from './types.js';

export async function editItem(service: IBacklogService, params: EditParams): Promise<EditResult> {
  const { id, operation } = params;
  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  try {
    const newBody = applyOperation(task.description ?? '', operation as Operation);
    await service.save({ ...task, description: newBody, updated_at: new Date().toISOString() });
    return { success: true, message: `Successfully applied ${operation.type} to ${id}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
