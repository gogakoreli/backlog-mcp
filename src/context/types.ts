/**
 * Types for the agent context hydration pipeline (ADR-0074, ADR-0075).
 *
 * The pipeline assembles context for agents working on backlog tasks.
 * Each stage adds a layer of context; token budgeting ensures the
 * response fits within the agent's context window.
 */

import type { Task, Status, TaskType } from '@/storage/schema.js';

// ── Request ──────────────────────────────────────────────────────────

export interface ContextRequest {
  /** Focal entity ID (e.g. TASK-0042, EPIC-0005). Mutually exclusive with query. */
  task_id?: string;
  /** Natural language query to resolve into a focal entity (Phase 2, ADR-0075). */
  query?: string;
  /** Relational expansion depth. 1 = direct relations. Default: 1, max: 3. */
  depth?: number;
  /** Enable semantic enrichment (Stage 3). Default: true for Phase 2. */
  include_related?: boolean;
  /** Enable temporal overlay (Stage 4). Default: true for Phase 2. */
  include_activity?: boolean;
  /** Token budget for the entire response. Default: 4000. */
  max_tokens?: number;
}

// ── Response entities ────────────────────────────────────────────────

export type Fidelity = 'full' | 'summary' | 'reference';

export interface ContextEntity {
  id: string;
  title: string;
  status: Status;
  type: TaskType;
  parent_id?: string;
  fidelity: Fidelity;
  /** Present when fidelity is 'full' */
  description?: string;
  /** Present when fidelity is 'full' and entity has evidence */
  evidence?: string[];
  /** Present when fidelity is 'full' and entity has blocked_reason */
  blocked_reason?: string[];
  /** Present when fidelity is 'full' or 'summary' and entity has references */
  references?: { url: string; title?: string }[];
  created_at?: string;
  updated_at?: string;
  /** Relevance score from semantic search. Present only for semantically discovered entities. */
  relevance_score?: number;
}

export interface ContextResource {
  uri: string;
  title: string;
  /** Path relative to data directory */
  path: string;
  fidelity: Fidelity;
  /** Brief excerpt. Present at 'summary' and 'full' fidelity. */
  snippet?: string;
  /** Full content. Present at 'full' fidelity only. */
  content?: string;
  /** Relevance score from semantic search. Present only for semantically discovered resources. */
  relevance_score?: number;
}

export interface ContextActivity {
  ts: string;
  tool: string;
  entity_id: string;
  actor: string;
  summary: string;
}

// ── Response ─────────────────────────────────────────────────────────

export interface ContextResponse {
  /** The primary entity the context is built around */
  focal: ContextEntity;
  /** Parent entity (if focal has a parent) */
  parent: ContextEntity | null;
  /** Direct children of the focal entity */
  children: ContextEntity[];
  /** Siblings (same parent as focal, excluding focal itself) */
  siblings: ContextEntity[];
  /** Resources related to the focal entity or its parent */
  related_resources: ContextResource[];
  /** Semantically related entities not in the direct graph (Stage 3, ADR-0075). */
  related: ContextEntity[];
  /** Recent operations on focal and related items (Stage 4, ADR-0075). */
  activity: ContextActivity[];
  /** Pipeline execution metadata */
  metadata: ContextMetadata;
}

export interface ContextMetadata {
  depth: number;
  total_items: number;
  /** Estimated token count for the response */
  token_estimate: number;
  /** Whether items were dropped or downgraded to fit the token budget */
  truncated: boolean;
  /** Which pipeline stages were executed */
  stages_executed: string[];
  /** How the focal entity was resolved: 'id' (direct lookup) or 'query' (search-based). */
  focal_resolved_from?: 'id' | 'query';
}
