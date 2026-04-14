// Types
export type { SearchService, SearchOptions, SearchFilters, SearchResult, UnifiedSearchResult, SearchSnippet, Resource, ResourceSearchResult, SearchableType } from './types.js';

// Orama implementation
export { OramaSearchService, type OramaSearchOptions } from './orama-search-service.js';

// Orama schema + helpers
export { schema, schemaWithEmbeddings, INDEX_VERSION, TEXT_PROPERTIES, UNSORTABLE_PROPERTIES, ENUM_FACETS, buildWhereClause, type OramaDoc, type OramaDocWithEmbeddings, type OramaInstance, type OramaInstanceWithEmbeddings } from './orama-schema.js';

// Embeddings
export { EmbeddingService, EMBEDDING_DIMENSIONS } from './embedding-service.js';

// Snippets
export { generateTaskSnippet, generateResourceSnippet } from './snippets.js';

// Scoring
export { minmaxNormalize, linearFusion, applyCoordinationBonus, DEFAULT_WEIGHTS, type ScoredHit } from './scoring.js';

// Tokenizer
export { compoundWordTokenizer, splitCamelCase } from './tokenizer.js';
