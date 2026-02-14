/**
 * Stage 3: Semantic Enrichment (ADR-0075)
 *
 * Uses search to find entities and resources semantically related to the focal
 * entity but NOT already present in the relational graph (Stage 2 output).
 *
 * This is the "RAG" in Retrieval-Augmented Context — it discovers soft links
 * between items that are conceptually related but not explicitly connected
 * through parent/child/sibling relationships.
 *
 * Design decisions:
 *   - Uses focal entity's title + first 200 chars of description as search query.
 *     This balances relevance (title is the strongest signal) with specificity
 *     (description adds context). Full description would create too broad a query.
 *   - Deduplicates against all entities already collected in Stages 1-2 to avoid
 *     showing the same item twice with different roles.
 *   - Limits to 10 results max — semantic matches are supplementary, not primary.
 *   - Separates task/epic results from resource results for cleaner budgeting.
 */

import type { Task } from '@/storage/schema.js';
import type { Resource } from '@/search/types.js';
import type { ContextEntity, ContextResource } from '../types.js';
import { taskToContextEntity } from './focal-resolution.js';

export interface SemanticEnrichmentDeps {
  /** Search for entities and resources matching a query. */
  searchUnified: (query: string, options?: {
    types?: Array<'task' | 'epic' | 'resource'>;
    limit?: number;
  }) => Promise<Array<{
    item: Task | Resource;
    score: number;
    type: 'task' | 'epic' | 'resource';
  }>>;
}

export interface SemanticEnrichmentResult {
  /** Semantically related tasks/epics not in the relational graph */
  related_entities: ContextEntity[];
  /** Semantically related resources not found by path heuristic */
  related_resources: ContextResource[];
}

/**
 * Build a search query from the focal entity.
 * Uses title + truncated description for specificity without noise.
 */
function buildSearchQuery(focalTask: Task): string {
  let query = focalTask.title;
  if (focalTask.description) {
    const descSnippet = focalTask.description.slice(0, 200).trim();
    if (descSnippet) {
      query += ' ' + descSnippet;
    }
  }
  return query;
}

/**
 * Convert a search result Resource to a ContextResource at summary fidelity.
 */
function searchResourceToContextResource(resource: Resource, score: number): ContextResource {
  const ctx: ContextResource = {
    uri: resource.id,
    title: resource.title,
    path: resource.path,
    fidelity: 'summary',
    relevance_score: score,
  };

  if (resource.content) {
    const text = resource.content.trim();
    ctx.snippet = text.length > 120 ? text.slice(0, 120) + '...' : text;
  }

  return ctx;
}

/**
 * Find semantically related entities and resources.
 *
 * @param focalTask - The focal Task (from Stage 1)
 * @param existingIds - Set of entity IDs already in the context (from Stages 1-2)
 * @param existingResourceUris - Set of resource URIs already in the context
 * @param deps - Injected search dependency
 */
export async function enrichSemantic(
  focalTask: Task,
  existingIds: Set<string>,
  existingResourceUris: Set<string>,
  deps: SemanticEnrichmentDeps,
): Promise<SemanticEnrichmentResult> {
  const query = buildSearchQuery(focalTask);

  const results = await deps.searchUnified(query, {
    types: ['task', 'epic', 'resource'],
    limit: 20, // Fetch more than needed to account for deduplication
  });

  const related_entities: ContextEntity[] = [];
  const related_resources: ContextResource[] = [];

  for (const result of results) {
    if (result.type === 'resource') {
      const resource = result.item as Resource;
      if (existingResourceUris.has(resource.id)) continue;
      if (related_resources.length >= 5) continue; // Cap semantic resources
      related_resources.push(searchResourceToContextResource(resource, result.score));
    } else {
      // task or epic
      const task = result.item as Task;
      if (existingIds.has(task.id)) continue;
      if (related_entities.length >= 5) continue; // Cap semantic entities
      const entity = taskToContextEntity(task, 'summary');
      entity.relevance_score = result.score;
      related_entities.push(entity);
    }
  }

  return { related_entities, related_resources };
}
