/**
 * Core function types — transport-agnostic.
 *
 * Design contracts:
 * - All operations take a single params object (consistent signature)
 * - NotFoundError: thrown when a required entity doesn't exist (update, edit)
 * - ValidationError: thrown for invalid input (create with both desc+source_path, empty search query)
 * - get: returns null per missing entity (not-found is a normal outcome for reads)
 * - delete: returns { id, deleted } so caller knows if it existed
 * - edit: returns { success, error? } for operation failures (expected outcome, not exceptional)
 */
import type { Status, EntityType, Reference } from '@backlog-mcp/shared';

// ── Errors ──

export class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── List ──

export interface ListParams {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  query?: string;
  counts?: boolean;
  limit?: number;
}

export interface ListItem {
  id: string;
  title: string;
  status: Status;
  type: string;
  parent_id?: string;
}

export interface ListResult {
  tasks: ListItem[];
  counts?: {
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
}

// ── Get ──

export interface GetParams {
  ids: string[];
}

export interface GetItem {
  id: string;
  content: string | null;
}

export interface GetResult {
  items: GetItem[];
}

// ── Create ──

export interface CreateParams {
  title: string;
  description?: string;
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
}

export interface CreateResult {
  id: string;
}

// ── Update ──

export interface UpdateParams {
  id: string;
  title?: string;
  status?: Status;
  epic_id?: string | null;
  parent_id?: string | null;
  blocked_reason?: string[];
  evidence?: string[];
  references?: Reference[];
  due_date?: string | null;
  content_type?: string | null;
}

export interface UpdateResult {
  id: string;
}

// ── Delete ──

export interface DeleteParams {
  id: string;
}

export interface DeleteResult {
  id: string;
  deleted: boolean;
}

// ── Search ──

export interface SearchParams {
  query: string;
  types?: Array<'task' | 'epic' | 'resource'>;
  status?: Status[];
  parent_id?: string;
  sort?: 'relevant' | 'recent';
  limit?: number;
  include_content?: boolean;
  include_scores?: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  type: string;
  status?: Status;
  parent_id?: string;
  path?: string;
  snippet?: string;
  matched_fields?: string[];
  score?: number;
  description?: string;
  content?: string;
}

export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  query: string;
  search_mode: string;
}

// ── Edit (body operations) ──

export interface EditOperation {
  type: 'str_replace' | 'insert' | 'append';
  old_str?: string;
  new_str?: string;
  insert_line?: number;
}

export interface EditParams {
  id: string;
  operation: EditOperation;
}

export interface EditResult {
  success: boolean;
  message?: string;
  error?: string;
}
