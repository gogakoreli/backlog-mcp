// ============================================================================
// Task ID
// ============================================================================

const TASK_ID_PATTERN = /^TASK-(\d{4,})$/;

export function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && TASK_ID_PATTERN.test(id);
}

export function parseTaskId(id: string): number | null {
  const match = TASK_ID_PATTERN.exec(id);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

export function formatTaskId(num: number): string {
  return `TASK-${num.toString().padStart(4, '0')}`;
}

export function nextTaskId(existingTasks: ReadonlyArray<{ id: string }>): string {
  let maxNum = 0;
  for (const task of existingTasks) {
    const num = parseTaskId(task.id);
    if (num !== null && num > maxNum) {
      maxNum = num;
    }
  }
  return formatTaskId(maxNum + 1);
}

// ============================================================================
// Status
// ============================================================================

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================================
// Task
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: Status;
  created_at: string;
  updated_at: string;
  blocked_reason?: string;
  evidence?: string[];
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateTaskInput {
  id?: string;
  title: string;
  description?: string;
}

export function createTask(
  input: CreateTaskInput,
  existingTasks: ReadonlyArray<{ id: string }> = []
): Task {
  const now = new Date().toISOString();
  return {
    id: input.id ?? nextTaskId(existingTasks),
    title: input.title,
    description: input.description,
    status: 'open',
    created_at: now,
    updated_at: now,
  };
}
