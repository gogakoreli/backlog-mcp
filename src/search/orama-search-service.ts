import { create, insert, remove, search, type Orama, type Results } from '@orama/orama';
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

/**
 * Orama-backed search service implementation.
 */
export class OramaSearchService implements SearchService {
  private db: OramaInstance | null = null;
  private taskCache = new Map<string, Task>();

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

  async index(tasks: Task[]): Promise<void> {
    this.db = await create({ schema });
    this.taskCache.clear();

    for (const task of tasks) {
      this.taskCache.set(task.id, task);
      await insert(this.db, this.taskToDoc(task));
    }
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
    await insert(this.db, this.taskToDoc(task));
  }

  async removeDocument(id: string): Promise<void> {
    if (!this.db) return;
    this.taskCache.delete(id);
    await remove(this.db, id);
  }

  async updateDocument(task: Task): Promise<void> {
    await this.removeDocument(task.id);
    await this.addDocument(task);
  }
}
