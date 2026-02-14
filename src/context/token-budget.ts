/**
 * Token estimation and budgeting for context hydration (ADR-0074).
 *
 * KNOWN HACK: Uses character-based approximation (1 token ≈ 4 chars).
 * This is within ±20% for English prose — sufficient for budgeting decisions.
 * See ADR-0074 "Known Hacks" section 1 for rationale and future fix path.
 */

import type { ContextEntity, ContextResource, ContextActivity, Fidelity } from './types.js';

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

// ── Budgeting ────────────────────────────────────────────────────────

export interface BudgetResult {
  /** Entities to include in the response */
  entities: ContextEntity[];
  /** Resources to include in the response */
  resources: ContextResource[];
  /** Activity entries to include in the response */
  activities: ContextActivity[];
  /** Total estimated tokens used */
  tokensUsed: number;
  /** Whether items were dropped or downgraded */
  truncated: boolean;
}

/**
 * Downgrade an entity to a lower fidelity level.
 * Returns a new entity with reduced fields.
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
    };
  }
  return resource;
}

/**
 * Apply token budget to a set of context items.
 *
 * Priority order (highest first):
 *   1. Focal entity (never dropped, always full fidelity)
 *   2. Parent entity (never dropped, summary fidelity)
 *   3. Children (summary, downgrade to reference if needed)
 *   4. Siblings (summary, downgrade to reference if needed)
 *   5. Resources (summary, downgrade to reference if needed)
 *   6. Activity (fixed cost, drop entries if needed)
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
  resources: ContextResource[],
  activities: ContextActivity[],
  maxTokens: number,
): BudgetResult {
  let tokensUsed = 0;
  let truncated = false;

  const result: BudgetResult = {
    entities: [],
    resources: [],
    activities: [],
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

  // 3. Children at summary fidelity
  for (const child of children) {
    const cost = estimateEntityTokens(child);
    if (tokensUsed + cost <= maxTokens) {
      tokensUsed += cost;
      result.entities.push(child);
    } else {
      // Try reference fidelity
      const ref = downgradeEntity(child, 'reference');
      const refCost = estimateEntityTokens(ref);
      if (tokensUsed + refCost <= maxTokens) {
        tokensUsed += refCost;
        result.entities.push(ref);
        truncated = true;
      } else {
        truncated = true;
        break; // No more room for children
      }
    }
  }

  // 4. Siblings at summary fidelity
  for (const sibling of siblings) {
    const cost = estimateEntityTokens(sibling);
    if (tokensUsed + cost <= maxTokens) {
      tokensUsed += cost;
      result.entities.push(sibling);
    } else {
      const ref = downgradeEntity(sibling, 'reference');
      const refCost = estimateEntityTokens(ref);
      if (tokensUsed + refCost <= maxTokens) {
        tokensUsed += refCost;
        result.entities.push(ref);
        truncated = true;
      } else {
        truncated = true;
        break;
      }
    }
  }

  // 5. Resources at summary fidelity
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

  // 6. Activity entries
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
