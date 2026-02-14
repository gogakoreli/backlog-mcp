/**
 * Stage 4: Temporal Overlay (ADR-0075)
 *
 * Surfaces recent activity on the focal entity and its first-degree relations.
 * This tells agents "what changed recently" — preventing re-work, surfacing
 * completed predecessor tasks, and providing temporal context for decisions.
 *
 * Uses OperationLogger.read() to fetch recent operations, then converts
 * them into human-readable ContextActivity summaries.
 *
 * Design decisions:
 *   - Queries activity for focal entity + parent + children (not siblings,
 *     to keep the activity feed focused and within token budget).
 *   - Limits to 20 most recent operations across all queried entities.
 *   - Generates human-readable summaries from operation params (e.g.,
 *     "Updated TASK-0042 status to done" instead of raw JSON).
 *   - Deduplicates by timestamp+entity to avoid showing the same op twice.
 */

import type { ContextActivity } from '../types.js';

export interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  actor: { type: string; name: string };
}

export interface TemporalOverlayDeps {
  /** Read recent operations, optionally filtered by task ID. */
  readOperations: (options: { taskId?: string; limit?: number }) => OperationEntry[];
}

/**
 * Generate a human-readable summary of an operation.
 */
function summarizeOperation(op: OperationEntry): string {
  const entityId = op.resourceId || 'unknown';

  switch (op.tool) {
    case 'backlog_create': {
      const title = (op.params.title as string) || '';
      const type = (op.params.type as string) || 'task';
      return `Created ${type} ${entityId}${title ? `: "${title}"` : ''}`;
    }
    case 'backlog_update': {
      const updates: string[] = [];
      if (op.params.status) updates.push(`status → ${op.params.status}`);
      if (op.params.title) updates.push(`title → "${op.params.title}"`);
      if (op.params.add_evidence) updates.push(`added evidence`);
      if (op.params.set_blocked) updates.push(`blocked: "${op.params.set_blocked}"`);
      if (op.params.clear_blocked) updates.push(`unblocked`);
      if (updates.length > 0) {
        return `Updated ${entityId}: ${updates.join(', ')}`;
      }
      return `Updated ${entityId}`;
    }
    case 'backlog_delete':
      return `Deleted ${entityId}`;
    case 'write_resource': {
      const uri = (op.params.uri as string) || '';
      return `Wrote resource ${uri || entityId}`;
    }
    default:
      return `${op.tool} on ${entityId}`;
  }
}

/**
 * Collect recent activity for focal and related entities.
 *
 * @param entityIds - IDs to query activity for (focal + parent + children)
 * @param deps - Injected operation logger dependency
 * @param limit - Max total activity entries to return
 */
export function overlayTemporal(
  entityIds: string[],
  deps: TemporalOverlayDeps,
  limit: number = 20,
): ContextActivity[] {
  // Collect operations across all relevant entities
  const seen = new Set<string>(); // Dedup key: ts + entity_id
  const allOps: Array<{ op: OperationEntry; entityId: string }> = [];

  for (const entityId of entityIds) {
    const ops = deps.readOperations({ taskId: entityId, limit: 10 });
    for (const op of ops) {
      const key = `${op.ts}:${op.resourceId || entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allOps.push({ op, entityId: op.resourceId || entityId });
    }
  }

  // Sort by timestamp descending (most recent first)
  allOps.sort((a, b) => b.op.ts.localeCompare(a.op.ts));

  // Convert to ContextActivity and limit
  return allOps.slice(0, limit).map(({ op, entityId }) => ({
    ts: op.ts,
    tool: op.tool,
    entity_id: entityId,
    actor: op.actor.name,
    summary: summarizeOperation(op),
  }));
}
