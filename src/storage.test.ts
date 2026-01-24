import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from '../src/backlog.js';
import { createTask } from '../src/schema.js';

const TEST_DATA_DIR = join(process.cwd(), 'test-data');

describe('Storage', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    storage.init(TEST_DATA_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('add', () => {
    it('should create a new task', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test task' });
      storage.add(task);

      const retrieved = storage.get(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Test task');
    });
  });

  describe('save', () => {
    it('should update an existing task', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Original' });
      storage.add(task);

      const updated = { ...task, title: 'Updated' };
      storage.save(updated);

      const retrieved = storage.get(task.id);
      expect(retrieved?.title).toBe('Updated');
    });

    it('should archive task when status is done', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      storage.add(task);

      const updated = { ...task, status: 'done' as const };
      storage.save(updated);

      // Should not be in active list
      const activeTasks = storage.list({ status: ['open', 'in_progress', 'blocked'] });
      expect(activeTasks.find(t => t.id === task.id)).toBeUndefined();

      // Should be in archived list
      const archivedTasks = storage.list({ status: ['done'] });
      expect(archivedTasks.find(t => t.id === task.id)).toBeDefined();
    });
  });

  describe('list', () => {
    it('should list only active tasks by default', () => {
      const task1 = createTask({ id: 'TASK-0001', title: 'Active' });
      const task2 = createTask({ id: 'TASK-0002', title: 'Done' });
      
      storage.add(task1);
      storage.add(task2);
      storage.save({ ...task2, status: 'done' });

      const tasks = storage.list({ status: ['open', 'in_progress', 'blocked'] });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(task1.id);
    });

    it('should respect archivedLimit parameter', () => {
      const tasks: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const task = createTask({ id: `TASK-${String(i).padStart(4, '0')}`, title: `Task ${i}` });
        tasks.push(task);
      }

      for (const task of tasks) {
        storage.add(task);
        storage.save({ ...task, status: 'done' });
      }

      const limited = storage.list({ status: ['done'], limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('should delete an active task', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      storage.add(task);

      const deleted = storage.delete(task.id);
      expect(deleted).toBe(true);
      expect(storage.get(task.id)).toBeUndefined();
    });

    it('should delete an archived task', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      storage.add(task);
      storage.save({ ...task, status: 'done' });

      const deleted = storage.delete(task.id);
      expect(deleted).toBe(true);
      expect(storage.get(task.id)).toBeUndefined();
    });

    it('should return false if task does not exist', () => {
      const deleted = storage.delete('TASK-9999');
      expect(deleted).toBe(false);
    });
  });

  describe('getMarkdown', () => {
    it('should preserve description with markdown formatting', () => {
      const task = createTask({ 
        id: 'TASK-0001',
        title: 'Test',
        description: '## Heading\n\n- Item 1\n- Item 2'
      });
      
      storage.add(task);
      const markdown = storage.getMarkdown(task.id);
      
      expect(markdown).toContain('## Heading');
      expect(markdown).toContain('- Item 1');
    });
  });

  describe('counts', () => {
    it('should return counts by status', () => {
      const task1 = createTask({ id: 'TASK-0001', title: 'Open' });
      const task2 = createTask({ id: 'TASK-0002', title: 'Done' });
      
      storage.add(task1);
      storage.add(task2);
      storage.save({ ...task2, status: 'done' });

      const counts = storage.counts();
      expect(counts.by_status.open).toBe(1);
      expect(counts.by_status.done).toBe(1);
    });
  });
});
