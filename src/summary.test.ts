import { describe, expect, it } from 'vitest';
import type { Task } from './schema.js';
import { countTasks } from './summary.js';

function makeTask(id: string, status: Task['status']): Task {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    id,
    title: 'Test',
    status,
    created_at: now,
    updated_at: now,
  };
}

describe('countTasks', () => {
  it('counts only the provided tasks', () => {
    const tasks = [
      makeTask('TASK-0001', 'open'),
      makeTask('TASK-0002', 'open'),
      makeTask('TASK-0003', 'blocked'),
    ];

    const counts = countTasks(tasks);

    expect(counts.open).toBe(2);
    expect(counts.blocked).toBe(1);
    expect(counts.in_progress).toBe(0);
    expect(counts.done).toBe(0);
    expect(counts.cancelled).toBe(0);
  });
});
