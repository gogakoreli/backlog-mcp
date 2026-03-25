import type { EntityType } from '@backlog-mcp/shared';
import { nextEntityId } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import { createTask } from '../storage/schema.js';
import type { CreateParams, CreateResult } from './types.js';

/**
 * Create a new backlog item.
 *
 * Note: source_path resolution is a transport concern — MCP and CLI
 * resolve the file and pass the content as `description`. Core never
 * touches the filesystem.
 */
export async function createItem(service: IBacklogService, params: CreateParams): Promise<CreateResult> {
  const { title, description, type, epic_id, parent_id, references } = params;

  const resolvedParent = parent_id ?? epic_id;
  const id = nextEntityId(await service.getMaxId(type as EntityType), type as EntityType);
  const task = createTask({ id, title, description, type, parent_id: resolvedParent, references });
  if (epic_id && !parent_id) task.epic_id = epic_id;
  await service.add(task);
  return { id: task.id };
}
