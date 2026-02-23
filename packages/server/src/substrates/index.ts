/**
 * Substrate Registry — Zod-validated entity schemas with relationship constraints.
 *
 * Imports canonical types from @backlog-mcp/shared.
 * Adds server-side concerns: Zod validation, validParents, schema hints.
 *
 * See ADR 0065 for design rationale.
 */
import { z } from 'zod';
import { EntityType, ENTITY_TYPES, STATUSES, TYPE_PREFIXES } from '@backlog-mcp/shared';

// ============================================================================
// Base Schema (shared by all)
// ============================================================================

const BaseSchema = z.object({
  id: z.string(),
  type: z.enum(ENTITY_TYPES),
  title: z.string().min(1),
  parent_id: z.string().optional(),
  description: z.string().optional(),
  references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ============================================================================
// Substrate Schemas
// ============================================================================

export const TaskSchema = BaseSchema.extend({
  type: z.literal('task'),
  status: z.enum(STATUSES).default('open'),
  blocked_reason: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
});

export const EpicSchema = BaseSchema.extend({
  type: z.literal('epic'),
  status: z.enum(STATUSES).default('open'),
});

export const FolderSchema = BaseSchema.extend({
  type: z.literal('folder'),
});

export const ArtifactSchema = BaseSchema.extend({
  type: z.literal('artifact'),
  content_type: z.string().optional(),
  path: z.string().optional(),
});

export const MilestoneSchema = BaseSchema.extend({
  type: z.literal('milestone'),
  due_date: z.string().datetime().optional(),
  status: z.enum(['open', 'done']).default('open'),
});

// ============================================================================
// Substrate Registry
// ============================================================================

export interface SubstrateConfig {
  prefix: string;
  schema: z.ZodSchema;
  validParents: EntityType[];
  hint: string;
}

export const SUBSTRATES: Record<EntityType, SubstrateConfig> = {
  task: {
    prefix: TYPE_PREFIXES[EntityType.Task],
    schema: TaskSchema,
    validParents: [EntityType.Task, EntityType.Epic, EntityType.Folder, EntityType.Milestone],
    hint: 'Work item. status: open→in_progress→done. parent_id → task (=subtask), epic, folder, or milestone.',
  },
  epic: {
    prefix: TYPE_PREFIXES[EntityType.Epic],
    schema: EpicSchema,
    validParents: [EntityType.Folder, EntityType.Milestone],
    hint: 'Groups related tasks. status: open→in_progress→done. parent_id → folder or milestone.',
  },
  folder: {
    prefix: TYPE_PREFIXES[EntityType.Folder],
    schema: FolderSchema,
    validParents: [EntityType.Folder],
    hint: 'Organizes items. Set parent_id on other items to put them here. Can nest.',
  },
  artifact: {
    prefix: TYPE_PREFIXES[EntityType.Artifact],
    schema: ArtifactSchema,
    validParents: [EntityType.Task, EntityType.Epic, EntityType.Folder],
    hint: 'File or resource. Attach to task/epic/folder via parent_id. Optional: content_type, path.',
  },
  milestone: {
    prefix: TYPE_PREFIXES[EntityType.Milestone],
    schema: MilestoneSchema,
    validParents: [EntityType.Folder],
    hint: 'Target date for deliverables. due_date for deadline. Tasks/epics can belong via parent_id.',
  },
};

// ============================================================================
// Type Inference
// ============================================================================

export type Task = z.infer<typeof TaskSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;

export type Entity = Task | Epic | Folder | Artifact | Milestone;

// ============================================================================
// Schema Hints (first-encounter learning)
// ============================================================================

const seenTypes = new Set<EntityType>();

export function getSchemaHintOnce(type: EntityType): string {
  if (seenTypes.has(type)) return '';
  seenTypes.add(type);
  return `\n\n_Schema: **${type}** - ${SUBSTRATES[type].hint}_`;
}

export function resetSeenTypes(): void {
  seenTypes.clear();
}

// ID Utilities — import directly from @backlog-mcp/shared
