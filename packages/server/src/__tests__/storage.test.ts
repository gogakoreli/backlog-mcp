import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from '../storage/backlog-service.js';
import { createTask } from '../storage/schema.js';
import { paths } from '../utils/paths.js';

// Mock SearchService to isolate storage tests from search behavior
vi.mock('../search/index.js', () => ({
  OramaSearchService: class {
    static getInstance() { return new this(); }
    async index() {}
    async search() { return []; }
    async addDocument() {}
    async updateDocument() {}
    async removeDocument() {}
  },
}));

const TEST_DATA_DIR = join(process.cwd(), 'test-data');

describe('Storage', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(TEST_DATA_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    vi.restoreAllMocks();
  });

  describe('add', () => {
    it('should create a new task', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test task' });
      await storage.add(task);

      const retrieved = await storage.get(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Test task');
    });
  });

  describe('save', () => {
    it('should update an existing task', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Original' });
      await storage.add(task);

      const updated = { ...task, title: 'Updated' };
      await storage.save(updated);

      const retrieved = await storage.get(task.id);
      expect(retrieved?.title).toBe('Updated');
    });

    it('should throw when saving task with invalid id', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      await expect(storage.save({ ...task, id: undefined as any })).rejects.toThrow('invalid id');
      await expect(storage.save({ ...task, id: '' })).rejects.toThrow('invalid id');
      await expect(storage.save({ ...task, id: 'garbage' })).rejects.toThrow('invalid id');
    });

    it('should archive task when status is done', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      await storage.add(task);

      const updated = { ...task, status: 'done' as const };
      await storage.save(updated);

      // Should not be in active list
      const activeTasks = await storage.list({ status: ['open', 'in_progress', 'blocked'] });
      expect(activeTasks.find(t => t.id === task.id)).toBeUndefined();

      // Should be in archived list
      const archivedTasks = await storage.list({ status: ['done'] });
      expect(archivedTasks.find(t => t.id === task.id)).toBeDefined();
    });
  });

  describe('list', () => {
    it('should list only active tasks by default', async () => {
      const task1 = createTask({ id: 'TASK-0001', title: 'Active' });
      const task2 = createTask({ id: 'TASK-0002', title: 'Done' });

      await storage.add(task1);
      await storage.add(task2);
      await storage.save({ ...task2, status: 'done' });

      const tasks = await storage.list({ status: ['open', 'in_progress', 'blocked'] });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(task1.id);
    });

    it('should respect archivedLimit parameter', async () => {
      const tasks: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const task = createTask({ id: `TASK-${String(i).padStart(4, '0')}`, title: `Task ${i}` });
        tasks.push(task);
      }

      for (const task of tasks) {
        await storage.add(task);
        await storage.save({ ...task, status: 'done' });
      }

      const limited = await storage.list({ status: ['done'], limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('should delete an active task', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      await storage.add(task);

      const deleted = await storage.delete(task.id);
      expect(deleted).toBe(true);
      expect(await storage.get(task.id)).toBeUndefined();
    });

    it('should delete an archived task', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test' });
      await storage.add(task);
      await storage.save({ ...task, status: 'done' });

      const deleted = await storage.delete(task.id);
      expect(deleted).toBe(true);
      expect(await storage.get(task.id)).toBeUndefined();
    });

    it('should return false if task does not exist', async () => {
      const deleted = await storage.delete('TASK-9999');
      expect(deleted).toBe(false);
    });
  });

  describe('getMarkdown', () => {
    it('should preserve description with markdown formatting', async () => {
      const task = createTask({
        id: 'TASK-0001',
        title: 'Test',
        description: '## Heading\n\n- Item 1\n- Item 2'
      });

      await storage.add(task);
      const markdown = await storage.getMarkdown(task.id);

      expect(markdown).toContain('## Heading');
      expect(markdown).toContain('- Item 1');
    });
  });

  describe('counts', () => {
    it('should return counts by status', async () => {
      const task1 = createTask({ id: 'TASK-0001', title: 'Open' });
      const task2 = createTask({ id: 'TASK-0002', title: 'Done' });

      await storage.add(task1);
      await storage.add(task2);
      await storage.save({ ...task2, status: 'done' });

      const counts = await storage.counts();
      expect(counts.by_status.open).toBe(1);
      expect(counts.by_status.done).toBe(1);
    });
  });
});
