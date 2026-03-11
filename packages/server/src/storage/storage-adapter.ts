import type { Entity, Status, EntityType } from '@backlog-mcp/shared';

export interface ListFilter {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  limit?: number;
}

/**
 * Synchronous storage adapter interface.
 * Implemented by FilesystemStorageAdapter for local/filesystem mode.
 */
export interface StorageAdapter {
  get(id: string): Entity | undefined;
  getMarkdown(id: string): string | null;
  list(filter?: ListFilter): Entity[];
  add(task: Entity): void;
  save(task: Entity): void;
  delete(id: string): boolean;
  counts(): {
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  };
  getMaxId(type?: EntityType): number;
  iterateTasks(): Iterable<Entity>;
}

/**
 * Async storage adapter interface.
 * Implemented by D1StorageAdapter for Cloudflare Workers / cloud mode.
 * All methods return Promises to allow async I/O.
 */
export interface AsyncStorageAdapter {
  get(id: string): Promise<Entity | undefined>;
  getMarkdown(id: string): Promise<string | null>;
  list(filter?: ListFilter): Promise<Entity[]>;
  add(task: Entity): Promise<void>;
  save(task: Entity): Promise<void>;
  delete(id: string): Promise<boolean>;
  counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }>;
  getMaxId(type?: EntityType): Promise<number>;
  search(query: string, limit?: number): Promise<Entity[]>;
}
