/**
 * D1BacklogService — per-request service layer backed by D1StorageAdapter.
 *
 * This is the cloud counterpart of BacklogService (which is a filesystem singleton).
 * Unlike BacklogService, D1BacklogService is NOT a singleton — a new instance is
 * created for each incoming Worker request.
 *
 * ADR-0089 Phase 2: wire up the Cloudflare Worker MCP endpoint.
 */

import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { D1StorageAdapter } from './d1-adapter.js';
import type { IBacklogService } from './service-types.js';

export class D1BacklogService implements IBacklogService {
  private storage: D1StorageAdapter;

  constructor(db: any) {
    this.storage = new D1StorageAdapter(db);
  }

  async get(id: string): Promise<Entity | undefined> {
    return this.storage.get(id);
  }

  async getMarkdown(id: string): Promise<string | null> {
    return this.storage.getMarkdown(id);
  }

  async list(filter?: {
    status?: Status[];
    type?: EntityType;
    epic_id?: string;
    parent_id?: string;
    query?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const { query, ...storageFilter } = filter ?? {};
    if (query) {
      // Use FTS5 search in D1StorageAdapter
      return this.storage.search(query, storageFilter.limit);
    }
    return this.storage.list(storageFilter);
  }

  async add(task: Entity): Promise<void> {
    return this.storage.add(task);
  }

  async save(task: Entity): Promise<void> {
    return this.storage.save(task);
  }

  async delete(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }

  async counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }> {
    return this.storage.counts();
  }

  async getMaxId(type?: EntityType): Promise<number> {
    return this.storage.getMaxId(type);
  }

  // Simplified searchUnified for cloud mode — returns task/epic entities only
  async searchUnified(
    query: string,
    options?: { limit?: number; status?: Status[] },
  ): Promise<Array<{ item: Entity; score: number; type: 'task' | 'epic' }>> {
    const results = await this.storage.search(query, options?.limit ?? 20);
    return results.map((task) => ({
      item: task,
      score: (task as any).score ?? 1,
      type: (task.type === 'epic' ? 'epic' : 'task') as 'task' | 'epic',
    }));
  }
}
