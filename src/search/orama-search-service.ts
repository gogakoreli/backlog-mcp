import { create, insert, remove, search, save, load, type Orama, type Results, type Tokenizer } from '@orama/orama';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task } from '@/storage/schema.js';
import type { SearchService, SearchOptions, SearchResult, Resource, ResourceSearchResult, SearchableType, SearchSnippet } from './types.js';
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
 * Ranking signal multipliers for re-ranking (ADR-0072, supersedes ADR-0051).
 * Multiple signals combine additively to determine final ranking.
 * 
 * Bonus values are tuned so that:
 * - Title matches rank above description-only matches
 * - Scores are normalized to 0-1 before applying domain signals
 * - Multiplicative factors ensure signals scale with relevance
 * - Title coverage and position amplify Orama's base relevance
 * - Epics get a small boost only when they have strong title matches
 * - Recent items get a boost but don't overwhelm relevance
 */

/**
 * Calculate recency multiplier based on days since last update (ADR-0072).
 * Returns 1.0-1.15 — recent items get a small proportional boost.
 */
function getRecencyMultiplier(updatedAt: string | undefined): number {
  if (!updatedAt) return 1.0;
  const daysSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 1) return 1.15;
  if (daysSinceUpdate < 7) return 1.10;
  if (daysSinceUpdate < 30) return 1.05;
  if (daysSinceUpdate < 90) return 1.02;
  return 1.0;
}

/**
 * Normalize scores to 0-1 range by dividing by the maximum score (ADR-0072).
 * This makes scores magnitude-independent, working identically for
 * BM25-only (unbounded) and hybrid (already 0-1) modes.
 */
function normalizeScores<T extends { score: number }>(results: T[]): T[] {
  if (results.length === 0) return results;
  const maxScore = Math.max(...results.map(r => r.score));
  if (maxScore === 0) return results;
  return results.map(r => ({ ...r, score: r.score / maxScore }));
}

/**
 * Re-rank results using normalize-then-multiply pipeline (ADR-0072).
 * 
 * Stage 1: Normalize Orama scores to 0-1 (divide by max)
 * Stage 2: Apply multiplicative domain signals:
 *   - Title word coverage (prefix-aware): up to 1.5x
 *   - Title starts-with-query: additional +0.3 (up to 1.8x total)
 *   - Epic with title match: ×1.1
 *   - Recency: ×1.0-1.15
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

  // Stage 1: Normalize to 0-1
  const normalized = normalizeScores(results);

  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/);

  // Stage 2: Multiplicative domain signals
  return normalized.map(r => {
    let multiplier = 1.0;

    const title = r.item.title?.toLowerCase() || '';
    const titleWords = title.split(/\W+/).filter(Boolean);

    // Prefix-aware title word matching: "produc" matches "product"
    const matchingQueryWords = queryWords.filter(qw =>
      titleWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw))
    );
    const matchCount = matchingQueryWords.length;

    // Title word coverage: proportion of query words found in title
    const titleCoverage = queryWords.length > 0 ? matchCount / queryWords.length : 0;
    multiplier += titleCoverage * 0.5; // up to 1.5x for perfect coverage

    // Title starts-with-query bonus
    if (queryWords.some(qw => title.startsWith(qw))) {
      multiplier += 0.3; // up to 1.8x total
    }

    // Epic with title match: small proportional boost
    const hasTitleMatch = matchCount > 0 || queryWords.some(qw => title.includes(qw));
    if (r.item.type === 'epic' && hasTitleMatch) {
      multiplier *= 1.1;
    }

    // Recency multiplier
    multiplier *= getRecencyMultiplier(r.item.updated_at);

    return { ...r, score: r.score * multiplier };
  }).sort((a, b) => b.score - a.score);
}

// ── Server-side snippet generation (ADR-0073) ──────────────────────
//
// Generates plain-text snippets server-side so both MCP tools and HTTP
// endpoints return consistent match context. This is the single source
// of truth for snippet generation — the UI's client-side @orama/highlight
// can still be used for HTML rendering, but the server snippet provides
// the canonical match context for MCP tool consumers.

const SNIPPET_WINDOW = 120; // chars of context around match

/**
 * Generate a plain-text snippet for a task, showing where the query matched.
 */
export function generateTaskSnippet(task: Task, query: string): SearchSnippet {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: task.title },
    { name: 'description', value: task.description || '' },
    { name: 'evidence', value: (task.evidence || []).join(' ') },
    { name: 'blocked_reason', value: (task.blocked_reason || []).join(' ') },
    { name: 'references', value: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' ') },
  ];
  return generateSnippetFromFields(fields, query);
}

/**
 * Generate a plain-text snippet for a resource.
 */
export function generateResourceSnippet(resource: Resource, query: string): SearchSnippet {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: resource.title },
    { name: 'content', value: resource.content },
  ];
  return generateSnippetFromFields(fields, query);
}

/**
 * Core snippet generation: finds the first field containing a query match,
 * extracts a window of context around it, and lists all matched fields.
 */
function generateSnippetFromFields(
  fields: { name: string; value: string }[],
  query: string,
): SearchSnippet {
  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  const matchedFields: string[] = [];
  let firstField = '';
  let firstText = '';

  for (const { name, value } of fields) {
    if (!value) continue;
    const valueLower = value.toLowerCase();

    // Check if any query word appears in this field
    const hasMatch = queryWords.some(w => valueLower.includes(w));
    if (!hasMatch) continue;

    matchedFields.push(name);

    if (!firstField) {
      firstField = name;
      // Find first query word position and extract window
      let earliestPos = valueLower.length;
      for (const w of queryWords) {
        const pos = valueLower.indexOf(w);
        if (pos !== -1 && pos < earliestPos) earliestPos = pos;
      }

      const windowStart = Math.max(0, earliestPos - 30);
      const windowEnd = Math.min(value.length, windowStart + SNIPPET_WINDOW);
      let text = value.slice(windowStart, windowEnd).trim();

      // Add ellipsis if we truncated
      if (windowStart > 0) text = '...' + text;
      if (windowEnd < value.length) text = text + '...';

      // Collapse whitespace for clean output
      firstText = text.replace(/\s+/g, ' ');
    }
  }

  if (!firstField) {
    // No match found — fallback to title
    return { field: 'title', text: fields[0]?.value || '', matched_fields: [] };
  }

  return { field: firstField, text: firstText, matched_fields: matchedFields };
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
    const boost = options?.boost ?? { id: 10, title: 5 };

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
        hits = hits.filter(h => (h.task.parent_id ?? h.task.epic_id) === filters.epic_id);
      }
      if (filters.parent_id) {
        hits = hits.filter(h => (h.task.parent_id ?? h.task.epic_id) === filters.parent_id);
      }
    }

    // Re-rank with normalize-then-multiply pipeline (ADR-0072)
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

    // Re-rank with normalize-then-multiply pipeline (ADR-0072) - resources have title for matching
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
   *
   * This is the canonical search method — both MCP tools and HTTP endpoints
   * should call this (via BacklogService.searchUnified). (ADR-0073)
   */
  async searchAll(query: string, options?: SearchOptions): Promise<Array<{ id: string; score: number; type: SearchableType; item: Task | Resource; snippet: SearchSnippet }>> {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = options?.limit ?? 20;
    const docTypes = options?.docTypes;
    const boost = options?.boost ?? { id: 10, title: 5 };
    const sortMode = options?.sort ?? 'relevant';

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
      const item = isResource
        ? this.resourceCache.get(hit.document.id)!
        : this.taskCache.get(hit.document.id)!;
      // Generate server-side snippet (ADR-0073)
      const snippet = item
        ? (isResource
            ? generateResourceSnippet(item as Resource, query)
            : generateTaskSnippet(item as Task, query))
        : { field: 'title', text: '', matched_fields: [] };
      return {
        id: hit.document.id,
        score: hit.score,
        type: docType,
        item,
        snippet,
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
        if (filters.epic_id && (task.parent_id ?? task.epic_id) !== filters.epic_id) return false;
        if (filters.parent_id && (task.parent_id ?? task.epic_id) !== filters.parent_id) return false;
        return true;
      });
    }

    // Sort based on mode
    if (sortMode === 'recent') {
      // Sort by updated_at descending (most recent first)
      hits.sort((a, b) => {
        const aDate = (a.item as Task).updated_at || '';
        const bDate = (b.item as Task).updated_at || '';
        return bDate.localeCompare(aDate);
      });
    } else {
      // Re-rank with normalize-then-multiply pipeline (ADR-0072)
      hits = rerankWithSignals(hits, query);
    }

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
