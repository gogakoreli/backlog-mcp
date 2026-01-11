import type { Task } from './schema.js';

export function countTasks(tasks: ReadonlyArray<Task>): Record<Task['status'], number> {
  const counts: Record<Task['status'], number> = {
    open: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  };

  for (const task of tasks) {
    counts[task.status]++;
  }

  return counts;
}
