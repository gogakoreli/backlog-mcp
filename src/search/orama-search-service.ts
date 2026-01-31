import { create, insert, remove, search, save, load, type Orama, type Results } from '@orama/orama';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task } from '@/storage/schema.js';
import type { SearchService, SearchOptions, SearchResult } from './types.js';

type OramaDoc = {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  epic_id: string;
  evidence: string;
  blocked_reason: string;
  references: string;
};

const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  status: 'string',
  type: 'string',
  epic_id: 'string',
  evidence: 'string',
  blocked_reason: 'string',
  references: 'string',
} as const;

type OramaInstance = Orama<typeof schema>;

export interface OramaSearchOptions {
  cachePath: string;
}

/**
 * Orama-backed search service implementation with disk persistence.
 * Configured via options - no hardcoded paths.
 */
export class OramaSearchService implements SearchService {
  private db: OramaInstance | null = null;
  private taskCache = new Map<string, Task>();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly cachePath: string;

  constructor(options: OramaSearchOptions) {
    this.cachePath = options.cachePath;
  }

  private get indexPath(): string {
    return this.cachePath;
  }

  private taskToDoc(task: Task): OramaDoc {
    return {
      id: task.id,
      title: task.title,
      description: task.description || '',
      status: task.status,
      type: task.type || 'task',
      epic_id: task.epic_id || '',
      evidence: (task.evidence || []).join(' '),
      blocked_reason: (task.blocked_reason || []).join(' '),
      references: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' '),
    };
  }

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.persistToDisk(), 1000);
  }

  private persistToDisk(): void {
    if (!this.db) return;
    try {
      const dir = dirname(this.indexPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = save(this.db);
      const serialized = JSON.stringify({ index: data, tasks: Object.fromEntries(this.taskCache) });
      writeFileSync(this.indexPath, serialized);
    } catch {
      // Ignore persistence errors - index will rebuild on next start
    }
  }

  private async loadFromDisk(): Promise<boolean> {
    try {
      if (!existsSync(this.indexPath)) return false;
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
      this.db = await create({ schema });
      load(this.db, raw.index);
      this.taskCache = new Map(Object.entries(raw.tasks as Record<string, Task>));
      return true;
    } catch {
      return false;
    }
  }

  async index(tasks: Task[]): Promise<void> {
    // Try loading from disk first
    if (await this.loadFromDisk()) return;

    // Build fresh index
    this.db = await create({ schema });
    this.taskCache.clear();
    for (const task of tasks) {
      this.taskCache.set(task.id, task);
      await insert(this.db, this.taskToDoc(task));
    }
    this.persistToDisk();
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = options?.limit ?? 20;
    const boost = options?.boost ?? { title: 2 };

    const results: Results<OramaDoc> = await search(this.db, {
      term: query,
      limit,
      boost,
      tolerance: 1,
    });

    let hits = results.hits.map(hit => ({
      id: hit.document.id,
      score: hit.score,
      task: this.taskCache.get(hit.document.id)!,
    }));

    // Apply filters post-search (Orama filters are for exact match, we need flexible filtering)
    const filters = options?.filters;
    if (filters) {
      if (filters.status?.length) {
        hits = hits.filter(h => filters.status!.includes(h.task.status));
      }
      if (filters.type) {
        hits = hits.filter(h => (h.task.type || 'task') === filters.type);
      }
      if (filters.epic_id) {
        hits = hits.filter(h => h.task.epic_id === filters.epic_id);
      }
    }

    return hits.slice(0, limit);
  }

  async addDocument(task: Task): Promise<void> {
    if (!this.db) return;
    this.taskCache.set(task.id, task);
    try {
      await insert(this.db, this.taskToDoc(task));
    } catch (e: any) {
      if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
        await this.updateDocument(task);
        return;
      }
      throw e;
    }
    this.scheduleSave();
  }

  async removeDocument(id: string): Promise<void> {
    if (!this.db) return;
    this.taskCache.delete(id);
    try {
      await remove(this.db, id);
      this.scheduleSave();
    } catch {
      // Ignore if document doesn't exist
    }
  }

  async updateDocument(task: Task): Promise<void> {
    await this.removeDocument(task.id);
    this.taskCache.set(task.id, task);
    await insert(this.db!, this.taskToDoc(task));
    this.scheduleSave();
  }
}
