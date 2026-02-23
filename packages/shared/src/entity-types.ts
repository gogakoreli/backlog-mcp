// ============================================================================
// Entity Types & Prefixes
// ============================================================================

export enum EntityType {
  Task = 'task',
  Epic = 'epic',
  Folder = 'folder',
  Artifact = 'artifact',
  Milestone = 'milestone',
}

export const ENTITY_TYPES = Object.values(EntityType);

export const TYPE_PREFIXES: Record<EntityType, string> = {
  [EntityType.Task]: 'TASK',
  [EntityType.Epic]: 'EPIC',
  [EntityType.Folder]: 'FLDR',
  [EntityType.Artifact]: 'ARTF',
  [EntityType.Milestone]: 'MLST',
};

const PREFIX_TO_TYPE: Record<string, EntityType> = Object.fromEntries(
  Object.entries(TYPE_PREFIXES).map(([type, prefix]) => [prefix, type as EntityType]),
) as Record<string, EntityType>;

// ============================================================================
// Status
// ============================================================================

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================================
// ID Utilities
// ============================================================================

const ID_PATTERN = /^(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})$/;

export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function parseEntityId(id: string): { type: EntityType; num: number } | null {
  const match = ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const type = PREFIX_TO_TYPE[match[1]];
  return type ? { type, num: parseInt(match[2], 10) } : null;
}

/** Parse just the numeric portion of an entity ID. */
export function parseEntityNum(id: string): number | null {
  return parseEntityId(id)?.num ?? null;
}

export function formatEntityId(num: number, type: EntityType = EntityType.Task): string {
  return `${TYPE_PREFIXES[type]}-${num.toString().padStart(4, '0')}`;
}

export function nextEntityId(maxId: number, type: EntityType = EntityType.Task): string {
  return formatEntityId(maxId + 1, type);
}

export function getTypeFromId(id: string): EntityType {
  for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
    if (id.startsWith(prefix + '-')) return type as EntityType;
  }
  return EntityType.Task;
}

// ============================================================================
// Core Interfaces
// ============================================================================

export interface Reference {
  url: string;
  title?: string;
}

export interface Entity {
  id: string;
  title: string;
  description?: string;
  status: Status;
  type?: EntityType;
  parent_id?: string;
  epic_id?: string;
  references?: Reference[];
  created_at: string;
  updated_at: string;
  blocked_reason?: string[];
  evidence?: string[];
  // Milestone
  due_date?: string;
  // Artifact
  content_type?: string;
  path?: string;
}
