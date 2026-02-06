// ============================================================================
// Task ID
// ============================================================================

export const TASK_TYPES = ['task', 'epic', 'folder', 'artifact', 'milestone'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TYPE_PREFIXES: Record<TaskType, string> = {
  task: 'TASK',
  epic: 'EPIC',
  folder: 'FLDR',
  artifact: 'ARTF',
  milestone: 'MLST',
};

const PREFIX_TO_TYPE: Record<string, TaskType> = Object.fromEntries(
  Object.entries(TYPE_PREFIXES).map(([type, prefix]) => [prefix, type as TaskType])
) as Record<string, TaskType>;

const ID_PATTERN = /^(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})$/;

export function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function parseTaskId(id: string): number | null {
  const match = ID_PATTERN.exec(id);
  return match?.[2] ? parseInt(match[2], 10) : null;
}

export function parseTaskIdWithType(id: string): { type: TaskType; num: number } | null {
  const match = ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const type = PREFIX_TO_TYPE[match[1]];
  return type ? { type, num: parseInt(match[2], 10) } : null;
}

export function formatTaskId(num: number, type?: TaskType): string {
  const prefix = TYPE_PREFIXES[type ?? 'task'];
  return `${prefix}-${num.toString().padStart(4, '0')}`;
}

export function nextTaskId(maxId: number, type?: TaskType): string {
  return formatTaskId(maxId + 1, type);
}

// ============================================================================
// Status
// ============================================================================

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================================
// Task
// ============================================================================

export interface Reference {
  url: string;
  title?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: Status;
  type?: TaskType;
  epic_id?: string;
  parent_id?: string;
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

// ============================================================================
// Factory
// ============================================================================

export interface CreateTaskInput {
  id: string;
  title: string;
  description?: string;
  type?: TaskType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  due_date?: string;
  content_type?: string;
  path?: string;
}

export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: input.id,
    title: input.title,
    status: 'open',
    created_at: now,
    updated_at: now,
  };
  if (input.description) task.description = input.description;
  if (input.type) task.type = input.type;
  if (input.epic_id) task.epic_id = input.epic_id;
  if (input.parent_id) task.parent_id = input.parent_id;
  if (input.references?.length) task.references = input.references;
  if (input.due_date) task.due_date = input.due_date;
  if (input.content_type) task.content_type = input.content_type;
  if (input.path) task.path = input.path;
  return task;
}
