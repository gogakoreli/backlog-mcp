import { join } from 'node:path';
import type { Task, Status, TaskType } from './schema.js';
import { TaskStorage } from './task-storage.js';
import { OramaSearchService, type UnifiedSearchResult, type SearchableType } from '../search/index.js';
import { resourceManager } from '../resources/manager.js';
import { paths } from '../utils/paths.js';

/**
 * Composes TaskStorage + SearchService + ResourceManager.
 * Orchestrates storage operations and search index updates.
 */
class BacklogService {
  private static instance: BacklogService;
  private taskStorage = new TaskStorage();
  private search: OramaSearchService;
  private searchReady = false;

  private constructor() {
    this.search = new OramaSearchService({
      cachePath: join(paths.backlogDataDir, '.cache', 'search-index.json'),
    });
  }

  static getInstance(): BacklogService {
    if (!BacklogService.instance) {
      BacklogService.instance = new BacklogService();
    }
    return BacklogService.instance;
  }

  private async ensureSearchReady(): Promise<void> {
    if (this.searchReady) return;
    // Index tasks first
    await this.search.index(Array.from(this.taskStorage.iterateTasks()));
    // Then index resources
    const resources = resourceManager.list();
    if (resources.length > 0) {
      await this.search.indexResources(resources);
    }
    this.searchReady = true;
  }

  getFilePath(id: string): string | null {
    return this.taskStorage.getFilePath(id);
  }

  get(id: string): Task | undefined {
    return this.taskStorage.get(id);
  }

  getMarkdown(id: string): string | null {
    return this.taskStorage.getMarkdown(id);
  }

  async list(filter?: { status?: Status[]; type?: TaskType; epic_id?: string; query?: string; limit?: number }): Promise<Task[]> {
    const { query, ...storageFilter } = filter ?? {};

    if (query) {
      await this.ensureSearchReady();
      const results = await this.search.search(query, {
        filters: { status: storageFilter.status, type: storageFilter.type, epic_id: storageFilter.epic_id },
        limit: storageFilter.limit,
      });
      return results.map(r => ({ ...r.task, score: r.score }));
    }

    return this.taskStorage.list(storageFilter);
  }

  /**
   * Search with proper typed results. Returns UnifiedSearchResult[] with item, score, type.
   * Supports searching tasks, epics, and resources.
   */
  async searchUnified(query: string, options?: {
    types?: SearchableType[];
    limit?: number;
    sort?: 'relevant' | 'recent';
  }): Promise<UnifiedSearchResult[]> {
    await this.ensureSearchReady();
    
    const results = await this.search.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      sort: options?.sort,
    });
    
    return results.map(r => ({
      item: r.item,
      score: r.score,
      type: r.type,
    }));
  }

  add(task: Task): void {
    this.taskStorage.add(task);
    if (this.searchReady) this.search.addDocument(task);
  }

  save(task: Task): void {
    this.taskStorage.save(task);
    if (this.searchReady) this.search.updateDocument(task);
  }

  delete(id: string): boolean {
    const deleted = this.taskStorage.delete(id);
    if (deleted && this.searchReady) this.search.removeDocument(id);
    return deleted;
  }

  counts(): { total_tasks: number; total_epics: number; by_status: Record<Status, number> } {
    return this.taskStorage.counts();
  }

  getMaxId(type?: 'task' | 'epic'): number {
    return this.taskStorage.getMaxId(type);
  }
}

export { BacklogService };
export const storage = BacklogService.getInstance();
