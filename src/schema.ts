// ============================================================================
// Task ID
// ============================================================================

const TASK_ID_PATTERN = /^TASK-(\d{4,})$/;
const EPIC_ID_PATTERN = /^EPIC-(\d{4,})$/;

export function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && (TASK_ID_PATTERN.test(id) || EPIC_ID_PATTERN.test(id));
}

export function parseTaskId(id: string): number | null {
  const match = TASK_ID_PATTERN.exec(id) || EPIC_ID_PATTERN.exec(id);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

export function formatTaskId(num: number, type?: 'task' | 'epic'): string {
  const prefix = type === 'epic' ? 'EPIC' : 'TASK';
  return `${prefix}-${num.toString().padStart(4, '0')}`;
}

export function nextTaskId(maxId: number, type?: 'task' | 'epic'): string {
  return formatTaskId(maxId + 1, type);
}

// ============================================================================
// Status
// ============================================================================

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

export const TASK_TYPES = ['task', 'epic'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

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
  references?: Reference[];
  created_at: string;
  updated_at: string;
  blocked_reason?: string[];
  evidence?: string[];
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
  references?: Reference[];
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
  if (input.references?.length) task.references = input.references;
  return task;
}
