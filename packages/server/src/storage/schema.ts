/**
 * schema.ts — Server-only factory for creating entities.
 *
 * Types and ID utilities live in @backlog-mcp/shared.
 */
import type { Entity, EntityType, Reference } from '@backlog-mcp/shared';

export interface CreateTaskInput {
  id: string;
  title: string;
  description?: string;
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  due_date?: string;
  content_type?: string;
  path?: string;
}

export function createTask(input: CreateTaskInput): Entity {
  const now = new Date().toISOString();
  const task: Entity = {
    id: input.id,
    title: input.title,
    status: 'open',
    created_at: now,
    updated_at: now,
  };
  if (input.description) task.description = input.description;
  if (input.type) task.type = input.type;
  if (input.epic_id) task.epic_id = input.epic_id;
  if (input.parent_id) task.parent_id = input.parent_id;
  if (input.references?.length) task.references = input.references;
  if (input.due_date) task.due_date = input.due_date;
  if (input.content_type) task.content_type = input.content_type;
  if (input.path) task.path = input.path;
  return task;
}
