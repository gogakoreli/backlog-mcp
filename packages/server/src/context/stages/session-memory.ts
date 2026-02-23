/**
 * Stage 3.5: Session Memory (ADR-0076)
 *
 * Derives "last work session" context from the operation log.
 * A session is a cluster of operations by the same actor within a
 * configurable time window (default: 30 minutes between operations).
 *
 * This solves the "session amnesia" problem — when a new agent picks
 * up a task, it doesn't know what the previous agent (or human) did.
 * Session memory surfaces:
 *   - Who last worked on this entity
 *   - When they started and stopped
 *   - How many operations they performed
 *   - A human-readable summary of what they did
 *
 * Design decisions:
 *   - Only surfaces the MOST RECENT session (not full history — that's
 *     Stage 4 Temporal Overlay's job). One session = focused context.
 *   - Session boundary: 30-minute gap between operations by the same actor.
 *     This heuristic works well for agent sessions (which are continuous)
 *     and human sessions (which have natural breaks).
 *   - Summary is derived from operation types, not raw params. This keeps
 *     summaries concise and readable.
 *
 * KNOWN HACK: Session boundary is a simple time-gap heuristic (30 min).
 * Real session tracking would require explicit session IDs in the operation log.
 * See ADR-0076 "Known Hacks" section for future fix path.
 */

import type { SessionSummary } from '../types.js';

export interface SessionOperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  actor: { type: string; name: string };
}

export interface SessionMemoryDeps {
  /** Read recent operations for an entity. */
  readOperations: (options: { taskId?: string; limit?: number }) => SessionOperationEntry[];
}

/** Time gap (ms) that defines session boundary. Operations farther apart than this are separate sessions. */
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Derive the most recent work session for an entity from its operation log.
 *
 * @param entityId - The entity to check session history for
 * @param deps - Injected operation logger dependency
 * @returns Summary of the last session, or null if no operations exist
 */
export function deriveSessionSummary(
  entityId: string,
  deps: SessionMemoryDeps,
): SessionSummary | null {
  // Fetch recent operations for this entity (sorted most-recent-first by convention)
  const ops = deps.readOperations({ taskId: entityId, limit: 50 });
  if (ops.length === 0) return null;

  // Operations are sorted descending by timestamp. The most recent op defines
  // the session we want to describe.
  const mostRecent = ops[0]!;
  const sessionActor = mostRecent.actor;

  // Walk backwards from most recent to find session boundary:
  // Same actor, operations within SESSION_GAP_MS of each other
  const sessionOps: SessionOperationEntry[] = [mostRecent];

  for (let i = 1; i < ops.length; i++) {
    const op = ops[i]!;
    const prev = ops[i - 1]!;

    // Different actor = session boundary
    if (op.actor.name !== sessionActor.name) break;

    // Time gap too large = session boundary
    const gap = new Date(prev.ts).getTime() - new Date(op.ts).getTime();
    if (gap > SESSION_GAP_MS) break;

    sessionOps.push(op);
  }

  // Build summary from session operations
  const summary = buildSessionSummary(entityId, sessionOps);

  return {
    actor: sessionActor.name,
    actor_type: sessionActor.type as 'user' | 'agent',
    started_at: sessionOps[sessionOps.length - 1]!.ts,
    ended_at: sessionOps[0]!.ts,
    operation_count: sessionOps.length,
    summary,
  };
}

/**
 * Build a human-readable summary of a session's operations.
 */
function buildSessionSummary(entityId: string, ops: SessionOperationEntry[]): string {
  // Count operation types
  const counts: Record<string, number> = {};
  const statusChanges: string[] = [];
  let addedEvidence = false;
  let createdEntity = false;

  for (const op of ops) {
    counts[op.tool] = (counts[op.tool] || 0) + 1;

    if (op.tool === 'backlog_update' && op.params.status) {
      statusChanges.push(op.params.status as string);
    }
    if (op.tool === 'backlog_update' && op.params.add_evidence) {
      addedEvidence = true;
    }
    if (op.tool === 'backlog_create') {
      createdEntity = true;
    }
  }

  const parts: string[] = [];

  if (createdEntity) {
    parts.push(`Created ${entityId}`);
  }

  if (statusChanges.length > 0) {
    // Show the final status (most recent is first in the original ops array,
    // but statusChanges is built in reverse-chronological order)
    parts.push(`status → ${statusChanges[0]}`);
  }

  if (addedEvidence) {
    parts.push('added evidence');
  }

  const updateCount = counts['backlog_update'] || 0;
  const resourceCount = counts['write_resource'] || 0;

  if (updateCount > 0 && !statusChanges.length && !addedEvidence) {
    parts.push(`${updateCount} update${updateCount > 1 ? 's' : ''}`);
  }

  if (resourceCount > 0) {
    parts.push(`wrote ${resourceCount} resource${resourceCount > 1 ? 's' : ''}`);
  }

  if (parts.length === 0) {
    return `${ops.length} operation${ops.length > 1 ? 's' : ''} on ${entityId}`;
  }

  return parts.join(', ');
}
