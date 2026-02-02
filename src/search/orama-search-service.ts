import { create, insert, remove, search, save, load, type Orama, type Results, type Tokenizer } from '@orama/orama';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task } from '@/storage/schema.js';
import type { SearchService, SearchOptions, SearchResult, Resource, ResourceSearchResult, SearchableType } from './types.js';
import { EmbeddingService, EMBEDDING_DIMENSIONS } from './embedding-service.js';

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
  path: string;  // For resources: relative path
};

type OramaDocWithEmbeddings = OramaDoc & {
  embeddings: number[];
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
  path: 'string',
} as const;

const schemaWithEmbeddings = {
  ...schema,
  embeddings: `vector[${EMBEDDING_DIMENSIONS}]`,
} as const;

type OramaInstance = Orama<typeof schema>;
type OramaInstanceWithEmbeddings = Orama<typeof schemaWithEmbeddings>;

export interface OramaSearchOptions {
  cachePath: string;
  /** Enable hybrid search with local embeddings. Default: true */
  hybridSearch?: boolean;
}

/**
 * Custom tokenizer that expands hyphenated words while preserving originals.
 */
const hyphenAwareTokenizer: Tokenizer = {
  language: 'english',
  normalizationCache: new Map(),
  tokenize(input: string): string[] {
    if (typeof input !== 'string') return [];
    const tokens = input.toLowerCase().split(/[^a-z0-9'-]+/gi).filter(Boolean);
    const expanded: string[] = [];
    for (const token of tokens) {
      expanded.push(token);
      if (token.includes('-')) {
        expanded.push(...token.split(/-+/).filter(Boolean));
      }
    }
    return [...new Set(expanded)];
  },
};

/**
 * Ranking signal bonus values for re-ranking (ADR-0051).
 * Multiple signals combine additively to determine final ranking.
 * 
 * Bonus values are tuned so that:
 * - Title matches rank above description-only matches
 * - Title-starts-with-query gets highest priority (strongest signal)
 * - Matching more query words gives additional bonus
 * - Epics get a small boost only when they have strong title matches
 * - Recent items get a boost but don't overwhelm relevance
 */
const RANKING_BONUS = {
  // Title match bonuses (highest priority)
  TITLE_STARTS_WITH: 20,  // Title starts with query (strongest signal)
  TITLE_EXACT_WORD: 10,   // Query appears as standalone word in title
  TITLE_PARTIAL: 3,       // Query appears as substring in title (compound word)
  // Multi-word match bonus
  MULTI_WORD_MATCH: 8,    // Per additional query word matched in title
  // Type importance bonus - only applied with title match
  EPIC_WITH_TITLE_MATCH: 5,  // Epics with title match get extra boost
  // Recency bonuses (decayed by age)
  RECENCY_TODAY: 5,       // Updated today
  RECENCY_WEEK: 3,        // Updated this week
  RECENCY_MONTH: 2,       // Updated this month
  RECENCY_QUARTER: 1,     // Updated this quarter
};

/**
 * Calculate recency bonus based on days since last update.
 */
function getRecencyBonus(updatedAt: string | undefined): number {
  if (!updatedAt) return 0;
  const daysSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 1) return RANKING_BONUS.RECENCY_TODAY;
  if (daysSinceUpdate < 7) return RANKING_BONUS.RECENCY_WEEK;
  if (daysSinceUpdate < 30) return RANKING_BONUS.RECENCY_MONTH;
  if (daysSinceUpdate < 90) return RANKING_BONUS.RECENCY_QUARTER;
  return 0;
}

/**
 * Re-rank results using multiple signals: title match quality, type importance, recency.
 * Adds fixed bonuses to ensure important items rank appropriately.
 * 
 * @param results - Search results with score and item (task or resource)
 * @param query - Original search query
 * @returns Re-ranked results sorted by adjusted score
 */
function rerankWithSignals<T extends { score: number; item: { title?: string; type?: string; updated_at?: string } }>(
  results: T[],
  query: string
): T[] {
  if (!query.trim()) return results;
  
  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/);
  
  return results.map(r => {
    let bonus = 0;
    
    // Title match bonus - check in order of strength
    const title = r.item.title?.toLowerCase() || '';
    const titleWords = title.split(/\W+/).filter(Boolean);
    
    // Count how many query words match in title
    const matchingQueryWords = queryWords.filter(qw => titleWords.includes(qw));
    const matchCount = matchingQueryWords.length;
    
    // Strongest: title starts with query (e.g., "Backlog MCP" for query "backlog")
    const titleStartsWithQuery = queryWords.some(qw => title.startsWith(qw));
    
    // Strong: query word appears as standalone word in title
    const hasExactMatch = matchCount > 0;
    
    // Weak: query appears as substring in title (compound word)
    const hasPartialMatch = !hasExactMatch && queryWords.some(qw => title.includes(qw));
    
    // Track if we have any title match for epic bonus
    const hasTitleMatch = titleStartsWithQuery || hasExactMatch || hasPartialMatch;
    
    if (titleStartsWithQuery) {
      bonus += RANKING_BONUS.TITLE_STARTS_WITH;
    } else if (hasExactMatch) {
      bonus += RANKING_BONUS.TITLE_EXACT_WORD;
    } else if (hasPartialMatch) {
      bonus += RANKING_BONUS.TITLE_PARTIAL;
    }
    
    // Multi-word match bonus: reward matching more query words in title
    // Only count additional words beyond the first match
    if (matchCount > 1) {
      bonus += (matchCount - 1) * RANKING_BONUS.MULTI_WORD_MATCH;
    }
    
    // Type importance bonus - only for epics WITH title match
    // This prevents epics from ranking above tasks when they only match in description
    if (r.item.type === 'epic' && hasTitleMatch) {
      bonus += RANKING_BONUS.EPIC_WITH_TITLE_MATCH;
    }
    
    // Recency bonus
    bonus += getRecencyBonus(r.item.updated_at);
    
    return { ...r, score: r.score + bonus };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Orama-backed search service with optional hybrid search (BM25 + vector).
 * Gracefully falls back to BM25-only if embeddings fail to load.
 */
export class OramaSearchService implements SearchService {
  private db: OramaInstance | OramaInstanceWithEmbeddings | null = null;
  private taskCache = new Map<string, Task>();
  private resourceCache = new Map<string, Resource>();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly cachePath: string;

  // Embedding state
  private readonly hybridEnabled: boolean;
  private embedder: EmbeddingService | null = null;
  private embeddingsReady = false;
  private embeddingsInitPromise: Promise<boolean> | null = null;
  private hasEmbeddingsInIndex = false;

  constructor(options: OramaSearchOptions) {
    this.cachePath = options.cachePath;
    this.hybridEnabled = options.hybridSearch ?? true;
  }

  private get indexPath(): string {
    return this.cachePath;
  }

  /**
   * Lazy-load embedding service. Returns true if embeddings are available.
   */
  private async ensureEmbeddings(): Promise<boolean> {
    if (!this.hybridEnabled) return false;
    if (this.embeddingsReady) return true;
    if (this.embeddingsInitPromise) return this.embeddingsInitPromise;

    this.embeddingsInitPromise = (async () => {
      try {
        this.embedder = new EmbeddingService();
        await this.embedder.init();
        this.embeddingsReady = true;
        return true;
      } catch (e) {
        // Graceful fallback - embeddings unavailable, use BM25 only
        this.embedder = null;
        this.embeddingsReady = false;
        return false;
      }
    })();

    return this.embeddingsInitPromise;
  }

  private getTextForEmbedding(task: Task): string {
    return `${task.title} ${task.description || ''}`.trim();
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
      path: '',  // Tasks don't have paths
    };
  }

  private resourceToDoc(resource: Resource): OramaDoc {
    return {
      id: resource.id,
      title: resource.title,
      description: resource.content,  // Full content for search
      status: '',
      type: 'resource',
      epic_id: '',
      evidence: '',
      blocked_reason: '',
      references: '',
      path: resource.path,
    };
  }

  private getResourceTextForEmbedding(resource: Resource): string {
    return `${resource.title} ${resource.content}`.trim();
  }

  private async resourceToDocWithEmbeddings(resource: Resource): Promise<OramaDocWithEmbeddings> {
    const doc = this.resourceToDoc(resource);
    const text = this.getResourceTextForEmbedding(resource);
    const embeddings = await this.embedder!.embed(text);
    return { ...doc, embeddings };
  }

  private async taskToDocWithEmbeddings(task: Task): Promise<OramaDocWithEmbeddings> {
    const doc = this.taskToDoc(task);
    const text = this.getTextForEmbedding(task);
    const embeddings = await this.embedder!.embed(text);
    return { ...doc, embeddings };
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
      const serialized = JSON.stringify({
        index: data,
        tasks: Object.fromEntries(this.taskCache),
        resources: Object.fromEntries(this.resourceCache),
        hasEmbeddings: this.hasEmbeddingsInIndex,
      });
      writeFileSync(this.indexPath, serialized);
    } catch {
      // Ignore persistence errors - index will rebuild on next start
    }
  }

  private async loadFromDisk(): Promise<boolean> {
    try {
      if (!existsSync(this.indexPath)) return false;
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf-8'));

      // Check if cached index has embeddings
      this.hasEmbeddingsInIndex = raw.hasEmbeddings ?? false;

      const schemaToUse = this.hasEmbeddingsInIndex ? schemaWithEmbeddings : schema;
      this.db = await create({ schema: schemaToUse, components: { tokenizer: hyphenAwareTokenizer } });
      load(this.db, raw.index);
      this.taskCache = new Map(Object.entries(raw.tasks as Record<string, Task>));
      this.resourceCache = new Map(Object.entries((raw.resources || {}) as Record<string, Resource>));
      return true;
    } catch {
      return false;
    }
  }

  async index(tasks: Task[]): Promise<void> {
    // Try loading from disk first
    if (await this.loadFromDisk()) return;

    // Check if embeddings are available for fresh index
    const useEmbeddings = await this.ensureEmbeddings();

    // Build fresh index
    const schemaToUse = useEmbeddings ? schemaWithEmbeddings : schema;
    this.db = await create({ schema: schemaToUse, components: { tokenizer: hyphenAwareTokenizer } });
    this.taskCache.clear();
    this.hasEmbeddingsInIndex = useEmbeddings;

    for (const task of tasks) {
      this.taskCache.set(task.id, task);
      if (useEmbeddings) {
        const doc = await this.taskToDocWithEmbeddings(task);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, this.taskToDoc(task));
      }
    }
    this.persistToDisk();
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = options?.limit ?? 20;
    const boost = options?.boost ?? { id: 10, title: 2 };

    // Determine if we can use hybrid search
    const canUseHybrid = this.hasEmbeddingsInIndex && (await this.ensureEmbeddings());

    let results: Results<OramaDoc | OramaDocWithEmbeddings>;

    if (canUseHybrid) {
      // Hybrid search: BM25 + vector
      const queryVector = await this.embedder!.embed(query);
      results = await search(this.db as OramaInstanceWithEmbeddings, {
        term: query,
        mode: 'hybrid',
        vector: {
          value: queryVector,
          property: 'embeddings',
        },
        // Prioritize BM25 (exact/fuzzy matches) over vector (semantic)
        // This ensures exact matches rank highest while semantic matches are still found
        hybridWeights: { text: 0.8, vector: 0.2 },
        similarity: 0.2, // Low threshold to catch semantic matches
        limit,
        boost,
        tolerance: 1,
      });
    } else {
      // BM25 only
      results = await search(this.db, {
        term: query,
        limit,
        boost,
        tolerance: 1,
      });
    }

    let hits = results.hits.map(hit => ({
      id: hit.document.id,
      score: hit.score,
      task: this.taskCache.get(hit.document.id)!,
    }));

    // Apply filters post-search
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

    // Re-rank with multiple signals: title match, type importance, recency (ADR-0051)
    const reranked = rerankWithSignals(
      hits.map(h => ({ score: h.score, item: h.task })),
      query
    );
    hits = reranked.map((r, i) => ({
      id: hits.find(h => h.task === r.item)!.id,
      score: r.score,
      task: r.item,
    }));

    return hits.slice(0, limit);
  }

  async addDocument(task: Task): Promise<void> {
    if (!this.db) return;
    this.taskCache.set(task.id, task);

    try {
      if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
        const doc = await this.taskToDocWithEmbeddings(task);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, this.taskToDoc(task));
      }
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

    if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
      const doc = await this.taskToDocWithEmbeddings(task);
      await insert(this.db as OramaInstanceWithEmbeddings, doc);
    } else {
      await insert(this.db as OramaInstance, this.taskToDoc(task));
    }
    this.scheduleSave();
  }

  /**
   * Check if hybrid search is currently active.
   */
  isHybridSearchActive(): boolean {
    return this.hasEmbeddingsInIndex && this.embeddingsReady;
  }

  /**
   * Index resources into the search index.
   * Should be called after index() to add resources to existing index.
   */
  async indexResources(resources: Resource[]): Promise<void> {
    if (!this.db) return;

    for (const resource of resources) {
      this.resourceCache.set(resource.id, resource);
      try {
        if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
          const doc = await this.resourceToDocWithEmbeddings(resource);
          await insert(this.db as OramaInstanceWithEmbeddings, doc);
        } else {
          await insert(this.db as OramaInstance, this.resourceToDoc(resource));
        }
      } catch (e: any) {
        if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
          // Update existing resource
          await this.updateResource(resource);
        }
        // Ignore other errors - continue indexing
      }
    }
    this.scheduleSave();
  }

  /**
   * Search for resources only.
   */
  async searchResources(query: string, options?: { limit?: number }): Promise<ResourceSearchResult[]> {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = options?.limit ?? 20;
    const boost = { title: 2, description: 1 };

    const canUseHybrid = this.hasEmbeddingsInIndex && (await this.ensureEmbeddings());

    let results: Results<OramaDoc | OramaDocWithEmbeddings>;

    if (canUseHybrid) {
      const queryVector = await this.embedder!.embed(query);
      results = await search(this.db as OramaInstanceWithEmbeddings, {
        term: query,
        mode: 'hybrid',
        vector: { value: queryVector, property: 'embeddings' },
        hybridWeights: { text: 0.8, vector: 0.2 },
        similarity: 0.2,
        limit: limit * 3,  // Fetch more to filter
        boost,
        tolerance: 1,
      });
    } else {
      results = await search(this.db, {
        term: query,
        limit: limit * 3,
        boost,
        tolerance: 1,
      });
    }

    // Filter to resources only
    let resourceHits = results.hits
      .filter(hit => hit.document.type === 'resource')
      .map(hit => ({
        id: hit.document.id,
        score: hit.score,
        resource: this.resourceCache.get(hit.document.id)!,
      }))
      .filter(h => h.resource);

    // Re-rank with multiple signals (ADR-0051) - resources don't have type/recency, just title
    const reranked = rerankWithSignals(
      resourceHits.map(h => ({ score: h.score, item: h.resource })),
      query
    );
    resourceHits = reranked.map(r => ({
      id: (r.item as Resource).id,
      score: r.score,
      resource: r.item as Resource,
    }));

    return resourceHits.slice(0, limit);
  }

  /**
   * Search all document types with optional type filtering.
   * Returns results sorted by relevance across all types.
   */
  async searchAll(query: string, options?: SearchOptions): Promise<Array<{ id: string; score: number; type: SearchableType; item: Task | Resource }>> {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = options?.limit ?? 20;
    const docTypes = options?.docTypes;
    const boost = options?.boost ?? { id: 10, title: 2 };

    const canUseHybrid = this.hasEmbeddingsInIndex && (await this.ensureEmbeddings());

    let results: Results<OramaDoc | OramaDocWithEmbeddings>;

    if (canUseHybrid) {
      const queryVector = await this.embedder!.embed(query);
      results = await search(this.db as OramaInstanceWithEmbeddings, {
        term: query,
        mode: 'hybrid',
        vector: { value: queryVector, property: 'embeddings' },
        hybridWeights: { text: 0.8, vector: 0.2 },
        similarity: 0.2,
        limit: limit * 3,
        boost,
        tolerance: 1,
      });
    } else {
      results = await search(this.db, {
        term: query,
        limit: limit * 3,
        boost,
        tolerance: 1,
      });
    }

    let hits = results.hits.map(hit => {
      const docType = hit.document.type as SearchableType;
      const isResource = docType === 'resource';
      return {
        id: hit.document.id,
        score: hit.score,
        type: docType,
        item: isResource 
          ? this.resourceCache.get(hit.document.id)! 
          : this.taskCache.get(hit.document.id)!,
      };
    }).filter(h => h.item);

    // Filter by document types if specified
    if (docTypes?.length) {
      hits = hits.filter(h => docTypes.includes(h.type));
    }

    // Apply task-specific filters
    const filters = options?.filters;
    if (filters) {
      hits = hits.filter(h => {
        if (h.type === 'resource') return true;  // Resources don't have these filters
        const task = h.item as Task;
        if (filters.status?.length && !filters.status.includes(task.status)) return false;
        if (filters.type && (task.type || 'task') !== filters.type) return false;
        if (filters.epic_id && task.epic_id !== filters.epic_id) return false;
        return true;
      });
    }

    // Re-rank with multiple signals: title match, type importance, recency (ADR-0051)
    hits = rerankWithSignals(hits, query);

    return hits.slice(0, limit);
  }

  async addResource(resource: Resource): Promise<void> {
    if (!this.db) return;
    this.resourceCache.set(resource.id, resource);

    try {
      if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
        const doc = await this.resourceToDocWithEmbeddings(resource);
        await insert(this.db as OramaInstanceWithEmbeddings, doc);
      } else {
        await insert(this.db as OramaInstance, this.resourceToDoc(resource));
      }
    } catch (e: any) {
      if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
        await this.updateResource(resource);
        return;
      }
      throw e;
    }
    this.scheduleSave();
  }

  async removeResource(id: string): Promise<void> {
    if (!this.db) return;
    this.resourceCache.delete(id);
    try {
      await remove(this.db, id);
      this.scheduleSave();
    } catch {
      // Ignore if document doesn't exist
    }
  }

  async updateResource(resource: Resource): Promise<void> {
    await this.removeResource(resource.id);
    this.resourceCache.set(resource.id, resource);

    if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
      const doc = await this.resourceToDocWithEmbeddings(resource);
      await insert(this.db as OramaInstanceWithEmbeddings, doc);
    } else {
      await insert(this.db as OramaInstance, this.resourceToDoc(resource));
    }
    this.scheduleSave();
  }
}
