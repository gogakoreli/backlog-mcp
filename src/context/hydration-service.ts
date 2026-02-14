/**
 * ContextHydrationService — Pipeline orchestrator for agent context hydration (ADR-0074).
 *
 * Composes existing services (TaskStorage, ResourceManager, OperationLogger)
 * into a multi-stage context pipeline. This service is stateless — it reads
 * from existing stores and does not own any data.
 *
 * Pipeline stages (Phase 1):
 *   Stage 1: Focal Resolution    — resolve task ID → full entity
 *   Stage 2: Relational Expansion — parent, children, siblings, resources
 *
 * Future stages (not yet implemented):
 *   Stage 3: Semantic Enrichment  — search for related items (Phase 2)
 *   Stage 4: Temporal Overlay     — recent activity (Phase 3)
 *   Stage 5: Token Budget Refinement — smarter compression (ongoing)
 */

import type { Task } from '@/storage/schema.js';
import type { Resource } from '@/search/types.js';
import type { ContextRequest, ContextResponse } from './types.js';
import { resolveFocal } from './stages/focal-resolution.js';
import { expandRelations, type RelationalExpansionDeps } from './stages/relational-expansion.js';
import { applyBudget } from './token-budget.js';

export interface HydrationServiceDeps {
  /** Look up a task by ID */
  getTask: (id: string) => Task | undefined;
  /** List tasks with optional filters */
  listTasks: (filter: { parent_id?: string; limit?: number }) => Task[];
  /** List all resources from the ResourceManager */
  listResources: () => Resource[];
}

/**
 * Hydrate context for an agent working on a backlog entity.
 *
 * @param request - What the agent wants context for
 * @param deps - Injected service dependencies (for testability)
 * @returns Full context response with metadata, or null if focal entity not found
 */
export function hydrateContext(
  request: ContextRequest,
  deps: HydrationServiceDeps,
): ContextResponse | null {
  const maxTokens = request.max_tokens ?? 4000;
  const depth = Math.min(request.depth ?? 1, 3);
  const stagesExecuted: string[] = [];

  // ── Stage 1: Focal Resolution ──────────────────────────────────
  const focalResult = resolveFocal(request, deps.getTask);
  if (!focalResult) return null;
  stagesExecuted.push('focal_resolution');

  const { focal, focalTask } = focalResult;

  // ── Stage 2: Relational Expansion ──────────────────────────────
  const expansionDeps: RelationalExpansionDeps = {
    getTask: deps.getTask,
    listTasks: deps.listTasks,
    listResources: deps.listResources,
  };
  const expansion = expandRelations(focalTask, depth, expansionDeps);
  stagesExecuted.push('relational_expansion');

  // ── Stage 3: Semantic Enrichment (Phase 2 — not yet implemented)
  const related: typeof expansion.children = [];

  // ── Stage 4: Temporal Overlay (Phase 3 — not yet implemented)
  const activity: ContextResponse['activity'] = [];

  // ── Stage 5: Token Budgeting ───────────────────────────────────
  const budget = applyBudget(
    focal,
    expansion.parent,
    expansion.children,
    expansion.siblings,
    expansion.related_resources,
    activity,
    maxTokens,
  );
  stagesExecuted.push('token_budgeting');

  // Separate budget entities back into their roles
  // Budget entities are in order: [focal, parent?, ...children, ...siblings]
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

  // Children IDs set for separation
  const childIds = new Set(expansion.children.map(c => c.id));
  const siblingIds = new Set(expansion.siblings.map(s => s.id));

  const budgetedChildren: ContextResponse['children'] = [];
  const budgetedSiblings: ContextResponse['siblings'] = [];

  for (let i = idx; i < budget.entities.length; i++) {
    const e = budget.entities[i]!;
    if (childIds.has(e.id)) {
      budgetedChildren.push(e);
    } else if (siblingIds.has(e.id)) {
      budgetedSiblings.push(e);
    }
  }

  const totalItems = 1 + // focal
    (budgetedParent ? 1 : 0) +
    budgetedChildren.length +
    budgetedSiblings.length +
    budget.resources.length +
    related.length +
    budget.activities.length;

  return {
    focal: budgetedFocal,
    parent: budgetedParent,
    children: budgetedChildren,
    siblings: budgetedSiblings,
    related_resources: budget.resources,
    related,
    activity: budget.activities,
    metadata: {
      depth,
      total_items: totalItems,
      token_estimate: budget.tokensUsed,
      truncated: budget.truncated,
      stages_executed: stagesExecuted,
    },
  };
}
