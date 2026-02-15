/**
 * Token estimation and budgeting for context hydration (ADR-0074, ADR-0075, ADR-0076, ADR-0077, ADR-0078).
 *
 * KNOWN HACK: Uses character-based approximation (1 token ≈ 4 chars).
 * This is within ±20% for English prose — sufficient for budgeting decisions.
 * See ADR-0074 "Known Hacks" section 1 for rationale and future fix path.
 *
 * Phase 5 changes (ADR-0078):
 *   - 12-level priority (added referenced_by entities at priority 7)
 *   - Referenced-by entities are reverse cross-references — slightly lower priority
 *     than forward cross-references because the user didn't create these links FROM
 *     the focal entity, but they're still explicit intentional links.
 */

import type { ContextEntity, ContextResource, ContextActivity, SessionSummary, Fidelity } from './types.js';

// ── Token estimation ─────────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Uses 1 token ≈ 4 characters heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token cost of a ContextEntity at a given fidelity level.
 */
export function estimateEntityTokens(entity: ContextEntity): number {
  let cost = 0;

  // Base: id + title + status + type (always present)
  cost += estimateTokens(entity.id);
  cost += estimateTokens(entity.title);
  cost += estimateTokens(entity.status);
  cost += estimateTokens(entity.type);
  // JSON overhead (keys, punctuation)
  cost += 20;

  if (entity.fidelity === 'reference') {
    return cost;
  }

  // Summary adds: parent_id, timestamps, references
  if (entity.parent_id) cost += estimateTokens(entity.parent_id) + 5;
  if (entity.created_at) cost += estimateTokens(entity.created_at) + 5;
  if (entity.updated_at) cost += estimateTokens(entity.updated_at) + 5;
  if (entity.references?.length) {
    for (const ref of entity.references) {
      cost += estimateTokens(ref.url) + estimateTokens(ref.title || '') + 10;
    }
  }

  if (entity.fidelity === 'summary') {
    return cost;
  }

  // Full adds: description, evidence, blocked_reason
  if (entity.description) cost += estimateTokens(entity.description);
  if (entity.evidence?.length) {
    for (const e of entity.evidence) cost += estimateTokens(e) + 3;
  }
  if (entity.blocked_reason?.length) {
    for (const r of entity.blocked_reason) cost += estimateTokens(r) + 3;
  }

  return cost;
}

/**
 * Estimate token cost of a ContextResource.
 */
export function estimateResourceTokens(resource: ContextResource): number {
  let cost = 0;
  cost += estimateTokens(resource.uri);
  cost += estimateTokens(resource.title);
  cost += estimateTokens(resource.path);
  cost += 15; // JSON overhead

  if (resource.fidelity === 'reference') return cost;
  if (resource.snippet) cost += estimateTokens(resource.snippet);
  if (resource.fidelity === 'summary') return cost;
  if (resource.content) cost += estimateTokens(resource.content);

  return cost;
}

/**
 * Estimate token cost of a ContextActivity entry.
 */
export function estimateActivityTokens(activity: ContextActivity): number {
  return estimateTokens(activity.ts) +
    estimateTokens(activity.tool) +
    estimateTokens(activity.entity_id) +
    estimateTokens(activity.actor) +
    estimateTokens(activity.summary) +
    15;
}

/**
 * Estimate token cost of a SessionSummary.
 */
export function estimateSessionSummaryTokens(session: SessionSummary): number {
  return estimateTokens(session.actor) +
    estimateTokens(session.actor_type) +
    estimateTokens(session.started_at) +
    estimateTokens(session.ended_at) +
    estimateTokens(session.summary) +
    10 + // operation_count number + JSON overhead
    20;  // JSON keys overhead
}

// ── Budgeting ────────────────────────────────────────────────────────

export interface BudgetResult {
  /** Entities to include in the response */
  entities: ContextEntity[];
  /** Resources to include in the response */
  resources: ContextResource[];
  /** Activity entries to include in the response */
  activities: ContextActivity[];
  /** Session summary (null if dropped for budget or not available) */
  sessionSummary: SessionSummary | null;
  /** Total estimated tokens used */
  tokensUsed: number;
  /** Whether items were dropped or downgraded */
  truncated: boolean;
}

/**
 * Downgrade an entity to a lower fidelity level.
 * Returns a new entity with reduced fields.
 * Preserves graph_depth and relevance_score through downgrading.
 */
export function downgradeEntity(entity: ContextEntity, to: Fidelity): ContextEntity {
  if (to === 'reference') {
    return {
      id: entity.id,
      title: entity.title,
      status: entity.status,
      type: entity.type,
      parent_id: entity.parent_id,
      fidelity: 'reference',
      graph_depth: entity.graph_depth,
    };
  }
  if (to === 'summary') {
    return {
      id: entity.id,
      title: entity.title,
      status: entity.status,
      type: entity.type,
      parent_id: entity.parent_id,
      fidelity: 'summary',
      references: entity.references,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
      relevance_score: entity.relevance_score,
      graph_depth: entity.graph_depth,
    };
  }
  return entity;
}

/**
 * Downgrade a resource to a lower fidelity level.
 */
export function downgradeResource(resource: ContextResource, to: Fidelity): ContextResource {
  if (to === 'reference') {
    return {
      uri: resource.uri,
      title: resource.title,
      path: resource.path,
      fidelity: 'reference',
    };
  }
  if (to === 'summary') {
    return {
      uri: resource.uri,
      title: resource.title,
      path: resource.path,
      fidelity: 'summary',
      snippet: resource.snippet,
      relevance_score: resource.relevance_score,
    };
  }
  return resource;
}

/**
 * Apply token budget to a set of context items.
 *
 * Priority order (highest first) — Phase 5, ADR-0078:
 *   1. Focal entity (never dropped, always full fidelity)
 *   2. Parent entity (never dropped, summary fidelity)
 *   3. Session summary (high priority — tells agent what happened last)
 *   4. Children (summary, downgrade to reference if needed)
 *   5. Siblings (summary, downgrade to reference if needed)
 *   6. Cross-referenced entities (summary, downgrade to reference if needed)
 *   7. Referenced-by entities (summary, downgrade to reference if needed)  ← NEW
 *   8. Ancestors (reference fidelity — breadcrumb context)
 *   9. Descendants (reference fidelity — structural awareness)
 *  10. Semantically related entities (summary, downgrade to reference if needed)
 *  11. Resources (summary, downgrade to reference if needed)
 *  12. Activity (fixed cost, drop entries if needed)
 *
 * Items are first tried at their current fidelity. If the budget is
 * exceeded, lower-priority items are downgraded before higher-priority
 * items are dropped.
 */
export function applyBudget(
  focal: ContextEntity,
  parent: ContextEntity | null,
  children: ContextEntity[],
  siblings: ContextEntity[],
  crossReferenced: ContextEntity[],
  referencedBy: ContextEntity[],
  ancestors: ContextEntity[],
  descendants: ContextEntity[],
  related: ContextEntity[],
  resources: ContextResource[],
  activities: ContextActivity[],
  sessionSummary: SessionSummary | null,
  maxTokens: number,
): BudgetResult {
  let tokensUsed = 0;
  let truncated = false;

  const result: BudgetResult = {
    entities: [],
    resources: [],
    activities: [],
    sessionSummary: null,
    tokensUsed: 0,
    truncated: false,
  };

  // Metadata overhead estimate
  const metadataOverhead = 50;
  tokensUsed += metadataOverhead;

  // 1. Focal (always included, always full)
  const focalCost = estimateEntityTokens(focal);
  tokensUsed += focalCost;
  result.entities.push(focal);

  // 2. Parent (always included if present, summary)
  if (parent) {
    const parentCost = estimateEntityTokens(parent);
    tokensUsed += parentCost;
    result.entities.push(parent);
  }

  // 3. Session summary (high priority — tells agent about last session)
  if (sessionSummary) {
    const sessionCost = estimateSessionSummaryTokens(sessionSummary);
    if (tokensUsed + sessionCost <= maxTokens) {
      tokensUsed += sessionCost;
      result.sessionSummary = sessionSummary;
    } else {
      truncated = true;
    }
  }

  // Helper: try to fit an entity at current fidelity, then reference
  function tryFitEntity(entity: ContextEntity): boolean {
    const cost = estimateEntityTokens(entity);
    if (tokensUsed + cost <= maxTokens) {
      tokensUsed += cost;
      result.entities.push(entity);
      return true;
    }
    // Try reference fidelity
    const ref = downgradeEntity(entity, 'reference');
    const refCost = estimateEntityTokens(ref);
    if (tokensUsed + refCost <= maxTokens) {
      tokensUsed += refCost;
      result.entities.push(ref);
      truncated = true;
      return true;
    }
    truncated = true;
    return false;
  }

  // 4. Children at summary fidelity
  for (const child of children) {
    if (!tryFitEntity(child)) break;
  }

  // 5. Siblings at summary fidelity
  for (const sibling of siblings) {
    if (!tryFitEntity(sibling)) break;
  }

  // 6. Cross-referenced entities at summary fidelity (Phase 4, ADR-0077)
  for (const xref of crossReferenced) {
    if (!tryFitEntity(xref)) break;
  }

  // 7. Referenced-by entities at summary fidelity (Phase 5, ADR-0078)
  for (const refBy of referencedBy) {
    if (!tryFitEntity(refBy)) break;
  }

  // 8. Ancestors (already at reference fidelity from expansion)
  for (const ancestor of ancestors) {
    if (!tryFitEntity(ancestor)) break;
  }

  // 9. Descendants (already at reference fidelity from expansion)
  for (const descendant of descendants) {
    if (!tryFitEntity(descendant)) break;
  }

  // 10. Semantically related entities at summary fidelity
  for (const rel of related) {
    if (!tryFitEntity(rel)) break;
  }

  // 11. Resources at summary fidelity
  for (const resource of resources) {
    const cost = estimateResourceTokens(resource);
    if (tokensUsed + cost <= maxTokens) {
      tokensUsed += cost;
      result.resources.push(resource);
    } else {
      const ref = downgradeResource(resource, 'reference');
      const refCost = estimateResourceTokens(ref);
      if (tokensUsed + refCost <= maxTokens) {
        tokensUsed += refCost;
        result.resources.push(ref);
        truncated = true;
      } else {
        truncated = true;
        break;
      }
    }
  }

  // 12. Activity entries
  for (const act of activities) {
    const cost = estimateActivityTokens(act);
    if (tokensUsed + cost <= maxTokens) {
      tokensUsed += cost;
      result.activities.push(act);
    } else {
      truncated = true;
      break;
    }
  }

  result.tokensUsed = tokensUsed;
  result.truncated = truncated;
  return result;
}
