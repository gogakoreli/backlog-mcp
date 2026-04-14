import type { SearchOptions } from './types.js';
import { EMBEDDING_DIMENSIONS } from './embedding-service.js';

// ── Orama document types ────────────────────────────────────────────

export type OramaDoc = {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  epic_id: string;
  evidence: string;
  blocked_reason: string;
  references: string;
  path: string;
  updated_at: string;  // ADR-0080: for native sortBy
};

export type OramaDocWithEmbeddings = OramaDoc & {
  embeddings: number[];
};

// ── Orama schema definitions ────────────────────────────────────────

export const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  status: 'enum',
  type: 'enum',
  epic_id: 'enum',
  evidence: 'string',
  blocked_reason: 'string',
  references: 'string',
  path: 'string',
  updated_at: 'string',  // ADR-0080: enables native sortBy for "recent" mode
} as const;

export const schemaWithEmbeddings = {
  ...schema,
  embeddings: `vector[${EMBEDDING_DIMENSIONS}]`,
} as const;

export type OramaInstance = import('@orama/orama').Orama<typeof schema>;
export type OramaInstanceWithEmbeddings = import('@orama/orama').Orama<typeof schemaWithEmbeddings>;

/** Bump when tokenizer or schema changes to force index rebuild. */
export const INDEX_VERSION = 4;  // ADR-0080: added updated_at, unsortableProperties

// ── Search constants ────────────────────────────────────────────────

/**
 * Text-searchable properties (ADR-0079). Excludes enum fields (status, type, epic_id)
 * which are filtered via `where` clause, not full-text searched.
 * Also excludes updated_at which is only used for sorting.
 */
export const TEXT_PROPERTIES = ['id', 'title', 'description', 'evidence', 'blocked_reason', 'references', 'path'] as const;

/**
 * Properties that should NOT have sort indexes (ADR-0080).
 * Only `updated_at` needs a sort index for native "recent" mode.
 */
export const UNSORTABLE_PROPERTIES = ['id', 'title', 'description', 'evidence', 'blocked_reason', 'references', 'path'] as const;

/**
 * Facet configuration for enum fields (ADR-0080).
 * Orama returns counts per value automatically for enum facets.
 */
export const ENUM_FACETS = { status: {}, type: {}, epic_id: {} } as const;

// ── Where clause builder ────────────────────────────────────────────

/**
 * Build Orama `where` clause from SearchOptions filters and docTypes (ADR-0079).
 * Returns undefined if no filters apply (Orama treats undefined where as no filter).
 */
export function buildWhereClause(filters?: SearchOptions['filters'], docTypes?: import('./types.js').SearchableType[]): Record<string, any> | undefined {
  const where: Record<string, any> = {};
  if (filters?.status?.length) where.status = { in: filters.status };
  if (filters?.type) where.type = { eq: filters.type };
  if (filters?.epic_id) where.epic_id = { eq: filters.epic_id };
  if (filters?.parent_id) where.epic_id = { eq: filters.parent_id };
  if (docTypes?.length) where.type = { in: docTypes };
  return Object.keys(where).length > 0 ? where : undefined;
}
