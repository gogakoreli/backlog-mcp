import type { Task, Status, TaskType } from '@/storage/schema.js';

/**
 * Resource document for search indexing
 */
export interface Resource {
  id: string;      // MCP URI: mcp://backlog/resources/path/to/file.md
  path: string;    // Relative path: resources/path/to/file.md
  title: string;   // First # heading or filename
  content: string; // Full markdown content
}

/**
 * Document types that can be searched
 */
export type SearchableType = 'task' | 'epic' | 'resource';

/**
 * Search filter options
 */
export interface SearchFilters {
  status?: Status[];
  type?: TaskType;
  epic_id?: string;
  parent_id?: string;
}

/**
 * Search configuration options
 */
export interface SearchOptions {
  filters?: SearchFilters;
  limit?: number;
  /** Field name -> boost factor (e.g., { title: 2 }) */
  boost?: Record<string, number>;
  /** Filter by document types */
  docTypes?: SearchableType[];
  /** Sort mode: 'relevant' (default) or 'recent' */
  sort?: 'relevant' | 'recent';
}

/**
 * A single search result with relevance score
 */
export interface SearchResult {
  id: string;
  score: number;
  task: Task;
}

/**
 * Resource search result
 */
export interface ResourceSearchResult {
  id: string;
  score: number;
  resource: Resource;
}

/**
 * Unified search result with proper types for the /search API.
 * Separates the item from metadata (score, type) for type safety.
 */
export interface UnifiedSearchResult {
  item: Task | Resource;
  score: number;
  type: SearchableType;
}

/**
 * Abstract search service interface.
 * Implementations can use Orama, MiniSearch, Elasticsearch, etc.
 */
export interface SearchService {
  /** Build/rebuild index from tasks */
  index(tasks: Task[]): Promise<void>;

  /** Search tasks by query string */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** Add single document to index */
  addDocument(task: Task): Promise<void>;

  /** Remove document from index */
  removeDocument(id: string): Promise<void>;

  /** Update document in index */
  updateDocument(task: Task): Promise<void>;
}
