import type { IBacklogService } from '../storage/service-types.js';
import type { DeleteParams, DeleteResult } from './types.js';

export async function deleteItem(service: IBacklogService, params: DeleteParams): Promise<DeleteResult> {
  const deleted = await service.delete(params.id);
  return { id: params.id, deleted };
}
