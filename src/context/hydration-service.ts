/**
 * ContextHydrationService — Pipeline orchestrator for agent context hydration.
 * ADR-0074 (Phase 1), ADR-0075 (Phase 2).
 *
 * Composes existing services (TaskStorage, SearchService, ResourceManager,
 * OperationLogger) into a multi-stage context pipeline. This service is
 * stateless — it reads from existing stores and does not own any data.
 *
 * Pipeline stages:
 *   Stage 1: Focal Resolution    — resolve task ID or query → full entity
 *   Stage 2: Relational Expansion — parent, children, siblings, resources
 *   Stage 3: Semantic Enrichment  — search for related items not in graph
 *   Stage 4: Temporal Overlay     — recent activity on focal + related
 *   Stage 5: Token Budgeting      — prioritize, truncate to fit budget
 *
 * Phase 2 changes (ADR-0075):
 *   - Pipeline is now async (was sync in Phase 1)
 *   - Stage 3 (semantic enrichment) implemented
 *   - Stage 4 (temporal overlay) implemented
 *   - Query-based focal resolution implemented
 *   - listSync() dependency removed in favor of async list()
 */

import type { Task } from '@/storage/schema.js';
import type { Resource } from '@/search/types.js';
import type { ContextRequest, ContextResponse } from './types.js';
import { resolveFocal, type SearchDeps } from './stages/focal-resolution.js';
import { expandRelations, type RelationalExpansionDeps } from './stages/relational-expansion.js';
import { enrichSemantic, type SemanticEnrichmentDeps } from './stages/semantic-enrichment.js';
import { overlayTemporal, type TemporalOverlayDeps } from './stages/temporal-overlay.js';
import { applyBudget } from './token-budget.js';

export interface HydrationServiceDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Task | undefined;
  /** List tasks with optional filters (synchronous — storage-only, no search) */
  listTasks: (filter: { parent_id?: string; limit?: number }) => Task[];
  /** List all resources from the ResourceManager */
  listResources: () => Resource[];
  /** Search for entities (optional — needed for query-based focal resolution and semantic enrichment) */
  searchUnified?: SemanticEnrichmentDeps['searchUnified'];
  /** Read recent operations (optional — needed for temporal overlay) */
  readOperations?: TemporalOverlayDeps['readOperations'];
}

/**
 * Hydrate context for an agent working on a backlog entity.
 *
 * Phase 2: Now async to support search-based stages.
 *
 * @param request - What the agent wants context for
 * @param deps - Injected service dependencies (for testability)
 * @returns Full context response with metadata, or null if focal entity not found
 */
export async function hydrateContext(
  request: ContextRequest,
  deps: HydrationServiceDeps,
): Promise<ContextResponse | null> {
  const maxTokens = request.max_tokens ?? 4000;
  const depth = Math.min(request.depth ?? 1, 3);
  const includeRelated = request.include_related ?? true;
  const includeActivity = request.include_activity ?? true;
  const stagesExecuted: string[] = [];

  // ── Stage 1: Focal Resolution ──────────────────────────────────
  const searchDeps: SearchDeps | undefined = deps.searchUnified ? {
    search: async (query: string) => {
      const results = await deps.searchUnified!(query, { types: ['task', 'epic'], limit: 1 });
      return results.map(r => ({ item: r.item as Task, score: r.score }));
    },
  } : undefined;

  const focalResult = await resolveFocal(request, deps.getTask, searchDeps);
  if (!focalResult) return null;
  stagesExecuted.push('focal_resolution');

  const { focal, focalTask, resolved_from } = focalResult;

  // ── Stage 2: Relational Expansion ──────────────────────────────
  const expansionDeps: RelationalExpansionDeps = {
    getTask: deps.getTask,
    listTasks: deps.listTasks,
    listResources: deps.listResources,
  };
  const expansion = expandRelations(focalTask, depth, expansionDeps);
  stagesExecuted.push('relational_expansion');

  // ── Stage 3: Semantic Enrichment ───────────────────────────────
  let semanticEntities: ContextResponse['related'] = [];
  let semanticResources: ContextResponse['related_resources'] = [];

  if (includeRelated && deps.searchUnified) {
    // Build the set of IDs already in context (for deduplication)
    const existingIds = new Set<string>([focal.id]);
    if (expansion.parent) existingIds.add(expansion.parent.id);
    for (const c of expansion.children) existingIds.add(c.id);
    for (const s of expansion.siblings) existingIds.add(s.id);

    const existingResourceUris = new Set<string>(
      expansion.related_resources.map(r => r.uri),
    );

    const enrichment = await enrichSemantic(
      focalTask,
      existingIds,
      existingResourceUris,
      { searchUnified: deps.searchUnified },
    );
    semanticEntities = enrichment.related_entities;
    semanticResources = enrichment.related_resources;
    stagesExecuted.push('semantic_enrichment');
  }

  // ── Stage 4: Temporal Overlay ──────────────────────────────────
  let activity: ContextResponse['activity'] = [];

  if (includeActivity && deps.readOperations) {
    // Query activity for focal + parent + children (focused set)
    const activityEntityIds = [focal.id];
    if (expansion.parent) activityEntityIds.push(expansion.parent.id);
    for (const c of expansion.children) activityEntityIds.push(c.id);

    activity = overlayTemporal(
      activityEntityIds,
      { readOperations: deps.readOperations },
      20,
    );
    stagesExecuted.push('temporal_overlay');
  }

  // ── Stage 5: Token Budgeting ───────────────────────────────────
  // Combine path-matched and semantic resources for budgeting
  const allResources = [...expansion.related_resources, ...semanticResources];

  const budget = applyBudget(
    focal,
    expansion.parent,
    expansion.children,
    expansion.siblings,
    semanticEntities,
    allResources,
    activity,
    maxTokens,
  );
  stagesExecuted.push('token_budgeting');

  // Separate budget entities back into their roles
  const budgetedFocal = budget.entities[0]!;
  let idx = 1;
  let budgetedParent: ContextResponse['parent'] = null;
  if (expansion.parent && idx < budget.entities.length) {
    const candidate = budget.entities[idx]!;
    if (candidate.id === expansion.parent.id) {
      budgetedParent = candidate;
      idx++;
    }
  }

  // Use sets for role separation
  const childIds = new Set(expansion.children.map(c => c.id));
  const siblingIds = new Set(expansion.siblings.map(s => s.id));
  const semanticIds = new Set(semanticEntities.map(r => r.id));

  const budgetedChildren: ContextResponse['children'] = [];
  const budgetedSiblings: ContextResponse['siblings'] = [];
  const budgetedRelated: ContextResponse['related'] = [];

  for (let i = idx; i < budget.entities.length; i++) {
    const e = budget.entities[i]!;
    if (childIds.has(e.id)) {
      budgetedChildren.push(e);
    } else if (siblingIds.has(e.id)) {
      budgetedSiblings.push(e);
    } else if (semanticIds.has(e.id)) {
      budgetedRelated.push(e);
    }
  }

  const totalItems = 1 + // focal
    (budgetedParent ? 1 : 0) +
    budgetedChildren.length +
    budgetedSiblings.length +
    budget.resources.length +
    budgetedRelated.length +
    budget.activities.length;

  return {
    focal: budgetedFocal,
    parent: budgetedParent,
    children: budgetedChildren,
    siblings: budgetedSiblings,
    related_resources: budget.resources,
    related: budgetedRelated,
    activity: budget.activities,
    metadata: {
      depth,
      total_items: totalItems,
      token_estimate: budget.tokensUsed,
      truncated: budget.truncated,
      stages_executed: stagesExecuted,
      focal_resolved_from: resolved_from,
    },
  };
}
