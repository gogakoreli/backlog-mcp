import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { TaskStorage } from './task-storage.js';
import type { StorageAdapter, ListFilter } from './storage-adapter.js';

/**
 * Thin wrapper around TaskStorage that implements StorageAdapter.
 * Used in local/filesystem mode (the default).
 * Every method delegates directly to the underlying TaskStorage instance.
 */
export class FilesystemStorageAdapter implements StorageAdapter {
  private storage: TaskStorage;

  constructor(storage?: TaskStorage) {
    this.storage = storage ?? new TaskStorage();
  }

  get(id: string): Entity | undefined {
    return this.storage.get(id);
  }

  getMarkdown(id: string): string | null {
    return this.storage.getMarkdown(id);
  }

  list(filter?: ListFilter): Entity[] {
    return this.storage.list(filter);
  }

  add(task: Entity): void {
    return this.storage.add(task);
  }

  save(task: Entity): void {
    return this.storage.save(task);
  }

  delete(id: string): boolean {
    return this.storage.delete(id);
  }

  counts(): {
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  } {
    return this.storage.counts();
  }

  getMaxId(type?: EntityType): number {
    return this.storage.getMaxId(type);
  }

  iterateTasks(): Iterable<Entity> {
    return this.storage.iterateTasks();
  }
}
