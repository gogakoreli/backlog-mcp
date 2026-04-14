import { create, insert, insertMultiple, remove, search, save, load, type Results } from '@orama/orama';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Entity } from '@backlog-mcp/shared';
import type { SearchService, SearchOptions, SearchResult, Resource, ResourceSearchResult, SearchableType, SearchSnippet } from './types.js';
import { EmbeddingService } from './embedding-service.js';
import { compoundWordTokenizer } from './tokenizer.js';
import { generateTaskSnippet, generateResourceSnippet } from './snippets.js';
import {
  type OramaDoc, type OramaDocWithEmbeddings,
  type OramaInstance, type OramaInstanceWithEmbeddings,
  schema, schemaWithEmbeddings,
  INDEX_VERSION, TEXT_PROPERTIES, UNSORTABLE_PROPERTIES, ENUM_FACETS,
  buildWhereClause,
} from './orama-schema.js';
import { minmaxNormalize, linearFusion, applyCoordinationBonus, type ScoredHit } from './scoring.js';

export interface OramaSearchOptions {
  cachePath: string;
  /** Enable hybrid search with local embeddings. Default: true */
  hybridSearch?: boolean;
}

/**
 * Orama-backed search service with independent BM25 + vector retrievers
 * fused via linear combination (ADR-0081).
 *
 * Gracefully falls back to BM25-only if embeddings fail to load.
 * Uses native filtering (ADR-0079), sortBy, facets (ADR-0080).
 */
export class OramaSearchService implements SearchService {
  private db: OramaInstance | OramaInstanceWithEmbeddings | null = null;
  private taskCache = new Map<string, Entity>();
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

  // ── Document conversion ─────────────────────────────────────────

  private getTextForEmbedding(task: Entity): string {
    return `${task.title} ${task.description || ''}`.trim();
  }

  private taskToDoc(task: Entity): OramaDoc {
    return {
      id: task.id,
      title: task.title,
      description: task.description || '',
      status: task.status,
      type: task.type || 'task',
      epic_id: task.parent_id ?? task.epic_id ?? '',  // Effective parent for where filtering (ADR-0079)
      evidence: (task.evidence || []).join(' '),
      blocked_reason: (task.blocked_reason || []).join(' '),
      references: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' '),
      path: '',  // Tasks don't have paths
      updated_at: task.updated_at || '',  // ADR-0080
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
      updated_at: '',  // Resources don't have updated_at
    };
  }

  private getResourceTextForEmbedding(resource: Resource): string {
    return `${resource.title} ${resource.content}`.trim();
  }

  private async taskToDocWithEmbeddings(task: Entity): Promise<OramaDocWithEmbeddings> {
    const doc = this.taskToDoc(task);
    const embeddings = await this.embedder!.embed(this.getTextForEmbedding(task));
    return { ...doc, embeddings };
  }

  private async resourceToDocWithEmbeddings(resource: Resource): Promise<OramaDocWithEmbeddings> {
    const doc = this.resourceToDoc(resource);
    const embeddings = await this.embedder!.embed(this.getResourceTextForEmbedding(resource));
    return { ...doc, embeddings };
  }

  // ── Index lifecycle ─────────────────────────────────────────────

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
        version: INDEX_VERSION,
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

  /**
   * Create an Orama instance with the correct schema and components (ADR-0080).
   * Centralizes create() config: tokenizer, unsortableProperties.
   */
  private createOramaInstance(useEmbeddings: boolean) {
    const schemaToUse = useEmbeddings ? schemaWithEmbeddings : schema;
    return create({
      schema: schemaToUse,
      components: { tokenizer: compoundWordTokenizer },
      sort: { unsortableProperties: [...UNSORTABLE_PROPERTIES] },  // ADR-0080: memory optimization
    });
  }

  private async loadFromDisk(): Promise<boolean> {
    try {
      if (!existsSync(this.indexPath)) return false;
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
      // Reject stale index when tokenizer/schema changes
      if ((raw.version ?? 0) !== INDEX_VERSION) return false;

      // Check if cached index has embeddings
      this.hasEmbeddingsInIndex = raw.hasEmbeddings ?? false;
      this.db = await this.createOramaInstance(this.hasEmbeddingsInIndex);
      load(this.db, raw.index);
      this.taskCache = new Map(Object.entries(raw.tasks as Record<string, Entity>));
      this.resourceCache = new Map(Object.entries((raw.resources || {}) as Record<string, Resource>));
      return true;
    } catch {
      return false;
    }
  }

  async index(tasks: Entity[]): Promise<void> {
    // Try loading from disk first
    if (await this.loadFromDisk()) return;

    // Check if embeddings are available for fresh index
    const useEmbeddings = await this.ensureEmbeddings();
    // Build fresh index
    this.db = await this.createOramaInstance(useEmbeddings);
    this.taskCache.clear();
    this.hasEmbeddingsInIndex = useEmbeddings;

    for (const task of tasks) {
      this.taskCache.set(task.id, task);
    }

    if (useEmbeddings) {
      // Sequential: each doc needs async embedding call
      for (const task of tasks) {
        const doc = await this.taskToDocWithEmbeddings(task);
        insert(this.db as OramaInstanceWithEmbeddings, doc);
      }
    } else {
      // Batch insert for BM25-only mode (ADR-0079)
      const docs = tasks.map(t => this.taskToDoc(t));
      insertMultiple(this.db as OramaInstance, docs);
    }
    this.persistToDisk();
  }

  // ── Independent retrievers (ADR-0081) ───────────────────────────

  /**
   * BM25 fulltext retriever — runs Orama in default mode (no `mode` param).
   * Returns raw BM25 scores (unbounded, higher = more relevant).
   */
  private async _executeBM25Search(params: {
    query: string;
    limit: number;
    boost: Record<string, number>;
    where?: Record<string, any>;
    sortBy?: { property: string; order: 'ASC' | 'DESC' };
  }): Promise<Results<OramaDoc | OramaDocWithEmbeddings>> {
    const { query, limit, boost, where, sortBy } = params;
    return search(this.db!, {
      term: query,
      properties: [...TEXT_PROPERTIES],
      limit,
      boost,
      tolerance: 1,
      where,
      facets: ENUM_FACETS,  // ADR-0080: free facet counts
      ...(sortBy ? { sortBy } : {}),
    });
  }

  /**
   * Vector retriever — runs Orama in vector-only mode.
   * Returns similarity scores [0,1]. Returns null if embeddings unavailable.
   */
  private async _executeVectorSearch(params: {
    query: string;
    limit: number;
    where?: Record<string, any>;
  }): Promise<Results<OramaDoc | OramaDocWithEmbeddings> | null> {
    const canUseVector = this.hasEmbeddingsInIndex && (await this.ensureEmbeddings());
    if (!canUseVector) return null;

    const queryVector = await this.embedder!.embed(params.query);
    return search(this.db as OramaInstanceWithEmbeddings, {
      mode: 'vector',
      vector: { value: queryVector, property: 'embeddings' },
      similarity: 0.2,
      limit: params.limit,
      where: params.where,
    });
  }

  /**
   * Run independent retrievers and fuse results via linear combination (ADR-0081).
   *
   * BM25 and vector retrievers run independently. Results are MinMax-normalized
   * per-retriever, then combined: score = 0.7 * norm_bm25 + 0.3 * norm_vector.
   *
   * When embeddings are unavailable, degenerates to pure BM25 ranking.
   * When sortBy is specified (e.g., "recent" mode), skips fusion entirely.
   */
  private async _fusedSearch(params: {
    query: string;
    limit: number;
    boost: Record<string, number>;
    where?: Record<string, any>;
    sortBy?: { property: string; order: 'ASC' | 'DESC' };
  }): Promise<{ hits: Array<{ id: string; score: number }>; bm25Results: Results<OramaDoc | OramaDocWithEmbeddings> }> {
    const { query, limit, boost, where, sortBy } = params;

    // Native sortBy mode (ADR-0080) — skip fusion, use Orama's sort directly
    if (sortBy) {
      const results = await this._executeBM25Search({ query, limit, boost, where, sortBy });
      return {
        hits: results.hits.map(h => ({ id: h.document.id, score: h.score })),
        bm25Results: results,
      };
    }

    // Over-fetch for better fusion coverage
    const fetchLimit = limit * 2;

    // Run retrievers independently
    const [bm25Results, vectorResults] = await Promise.all([
      this._executeBM25Search({ query, limit: fetchLimit, boost, where }),
      this._executeVectorSearch({ query, limit: fetchLimit, where }),
    ]);

    // Extract scored hits for fusion
    const bm25Hits: ScoredHit[] = bm25Results.hits.map(h => ({ id: h.document.id, score: h.score }));
    const vectorHits: ScoredHit[] = vectorResults
      ? vectorResults.hits.map(h => ({ id: h.document.id, score: h.score }))
      : [];

    // MinMax normalize each retriever independently, then fuse
    const fused = linearFusion(minmaxNormalize(bm25Hits), minmaxNormalize(vectorHits));

    // Post-fusion coordination bonus for multi-term queries (ADR-0081)
    const coordinated = applyCoordinationBonus(
      fused, query,
      id => this._getSearchableText(id),
      id => this._getTitle(id),
    );

    return { hits: coordinated.slice(0, limit), bm25Results };
  }

  // ── Search methods ──────────────────────────────────────────────

  /**
   * Get searchable text for a document (task or resource) by ID.
   * Used by post-fusion coordination bonus to check term presence.
   */
  private _getSearchableText(id: string): string {
    const task = this.taskCache.get(id);
    if (task) {
      return [task.title, task.description || '', (task.evidence || []).join(' ')].join(' ');
    }
    const resource = this.resourceCache.get(id);
    if (resource) {
      return [resource.title, resource.content].join(' ');
    }
    return '';
  }

  /** Get title for a document by ID. Used by coordination bonus for title weighting. */
  private _getTitle(id: string): string {
    return this.taskCache.get(id)?.title || this.resourceCache.get(id)?.title || '';
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.db || !query.trim()) return [];

    const limit = options?.limit ?? 20;
    const { hits } = await this._fusedSearch({
      query,
      limit,
      boost: options?.boost ?? { id: 10, title: 3 },
      where: buildWhereClause(options?.filters),
    });

    return hits
      .map(h => ({ id: h.id, score: h.score, task: this.taskCache.get(h.id)! }))
      .filter(h => h.task);
  }

  /**
   * Search all document types with optional type filtering.
   * Returns results sorted by relevance across all types.
   *
   * This is the canonical search method — both MCP tools and HTTP endpoints
   * should call this (via BacklogService.searchUnified). (ADR-0073)
   *
   * ADR-0080: Uses native sortBy for "recent" mode instead of JS post-sort.
   * ADR-0081: Uses independent retrievers + linear fusion for relevance mode.
   */
  async searchAll(query: string, options?: SearchOptions): Promise<Array<{ id: string; score: number; type: SearchableType; item: Entity | Resource; snippet: SearchSnippet }>> {
    if (!this.db || !query.trim()) return [];

    const limit = options?.limit ?? 20;
    const sortMode = options?.sort ?? 'relevant';
    const where = buildWhereClause(options?.filters, options?.docTypes);

    const { hits } = await this._fusedSearch({
      query,
      limit,
      boost: options?.boost ?? { id: 10, title: 3 },
      where,
      ...(sortMode === 'recent' ? { sortBy: { property: 'updated_at', order: 'DESC' as const } } : {}),
    });

    return hits
      .map(h => {
        const task = this.taskCache.get(h.id);
        const resource = this.resourceCache.get(h.id);
        const item = task || resource;
        if (!item) return null;
        const isResource = !task;
        const docType = (isResource ? 'resource' : (item as Entity).type || 'task') as SearchableType;
        const snippet = isResource
          ? generateResourceSnippet(item as Resource, query)
          : generateTaskSnippet(item as Entity, query);
        return { id: h.id, score: h.score, type: docType, item, snippet };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  }

  /**
   * Search for resources only.
   */
  async searchResources(query: string, options?: { limit?: number }): Promise<ResourceSearchResult[]> {
    if (!this.db || !query.trim()) return [];

    const limit = options?.limit ?? 20;
    const { hits } = await this._fusedSearch({
      query,
      limit,
      boost: { title: 2, description: 1 },
      where: { type: { eq: 'resource' } },
    });

    return hits
      .map(h => ({ id: h.id, score: h.score, resource: this.resourceCache.get(h.id)! }))
      .filter(h => h.resource);
  }

  /**
   * Check if hybrid search is currently active.
   */
  isHybridSearchActive(): boolean {
    return this.hasEmbeddingsInIndex && this.embeddingsReady;
  }

  // ── Document CRUD ───────────────────────────────────────────────

  async addDocument(task: Entity): Promise<void> {
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

  async updateDocument(task: Entity): Promise<void> {
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

  // ── Resource CRUD ───────────────────────────────────────────────

  /**
   * Index resources into the search index.
   * Should be called after index() to add resources to existing index.
   */
  async indexResources(resources: Resource[]): Promise<void> {
    if (!this.db) return;

    for (const resource of resources) {
      this.resourceCache.set(resource.id, resource);
    }

    if (this.hasEmbeddingsInIndex && this.embeddingsReady) {
      // Sequential: each doc needs async embedding call
      for (const resource of resources) {
        try {
          const doc = await this.resourceToDocWithEmbeddings(resource);
          insert(this.db as OramaInstanceWithEmbeddings, doc);
        } catch (e: any) {
          if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
            await this.updateResource(resource);
          }
          // Ignore other errors - continue indexing
        }
      }
    } else {
      // Batch insert for BM25-only mode (ADR-0079)
      const docs = resources.map(r => this.resourceToDoc(r));
      try {
        insertMultiple(this.db as OramaInstance, docs);
      } catch {
        // Fallback to individual inserts if batch fails (e.g. duplicates)
        for (const resource of resources) {
          try {
            insert(this.db as OramaInstance, this.resourceToDoc(resource));
          } catch (e: any) {
            if (e?.code === 'DOCUMENT_ALREADY_EXISTS') {
              await this.updateResource(resource);
            }
          }
        }
      }
    }
    this.scheduleSave();
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
