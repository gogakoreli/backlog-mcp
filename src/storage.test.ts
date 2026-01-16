import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addTask, getTask, saveTask, listTasks, deleteTask, taskExists } from '../src/storage.js';
import { createTask } from '../src/schema.js';

const TEST_DATA_DIR = join(process.cwd(), 'test-data');

describe('Storage', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  const options = { dataDir: TEST_DATA_DIR };

  describe('addTask', () => {
    it('should create a new task', () => {
      const task = createTask({ title: 'Test task' }, []);
      addTask(task, options);

      const retrieved = getTask(task.id, options);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Test task');
    });

    it('should throw if task ID already exists in active', () => {
      const task = createTask({ title: 'Test task' }, []);
      addTask(task, options);

      expect(() => addTask(task, options)).toThrow('already exists');
    });

    it('should throw if task ID already exists in archive', () => {
      const task = createTask({ title: 'Test task' }, []);
      addTask(task, options);

      // Archive the task
      const updated = { ...task, status: 'done' as const };
      saveTask(updated, options);

      // Try to add task with same ID
      const newTask = createTask({ title: 'New task' }, []);
      newTask.id = task.id; // Force same ID

      expect(() => addTask(newTask, options)).toThrow('already exists');
    });
  });

  describe('saveTask', () => {
    it('should update an existing task', () => {
      const task = createTask({ title: 'Original' }, []);
      addTask(task, options);

      const updated = { ...task, title: 'Updated' };
      saveTask(updated, options);

      const retrieved = getTask(task.id, options);
      expect(retrieved?.title).toBe('Updated');
    });

    it('should archive task when status is done', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      const updated = { ...task, status: 'done' as const };
      saveTask(updated, options);

      // Should not be in active list
      const activeTasks = listTasks(undefined, options);
      expect(activeTasks.find(t => t.id === task.id)).toBeUndefined();

      // Should be in archived list
      const archivedTasks = listTasks({ status: ['done'] }, options);
      expect(archivedTasks.find(t => t.id === task.id)).toBeDefined();
    });

    it('should archive task when status is cancelled', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      const updated = { ...task, status: 'cancelled' as const };
      saveTask(updated, options);

      const activeTasks = listTasks(undefined, options);
      expect(activeTasks.find(t => t.id === task.id)).toBeUndefined();

      const archivedTasks = listTasks({ status: ['cancelled'] }, options);
      expect(archivedTasks.find(t => t.id === task.id)).toBeDefined();
    });
  });

  describe('listTasks', () => {
    it('should list only active tasks by default', () => {
      const existing = listTasks(undefined, options);
      const task1 = createTask({ title: 'Active' }, existing);
      const task2 = createTask({ title: 'Done' }, [...existing, task1]);
      
      addTask(task1, options);
      addTask(task2, options);
      saveTask({ ...task2, status: 'done' }, options);

      const tasks = listTasks(undefined, options);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(task1.id);
    });

    it('should include archived tasks when filtering by done status', () => {
      const existing = listTasks(undefined, options);
      const task1 = createTask({ title: 'Active' }, existing);
      const task2 = createTask({ title: 'Done' }, [...existing, task1]);
      
      addTask(task1, options);
      addTask(task2, options);
      saveTask({ ...task2, status: 'done' }, options);

      const tasks = listTasks({ status: ['done'] }, options);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(task2.id);
    });

    it('should respect archived_limit parameter', () => {
      const existing = listTasks(undefined, options);
      // Create 5 done tasks
      const tasks: any[] = [];
      for (let i = 0; i < 5; i++) {
        const task = createTask({ title: `Task ${i}` }, [...existing, ...tasks]);
        tasks.push(task);
      }

      for (const task of tasks) {
        addTask(task, options);
        saveTask({ ...task, status: 'done' }, options);
      }

      const limited = listTasks({ status: ['done'], archivedLimit: 3 }, options);
      expect(limited).toHaveLength(3);
    });
  });

  describe('deleteTask', () => {
    it('should delete an active task', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      deleteTask(task.id, options);
      expect(taskExists(task.id, options)).toBe(false);
    });

    it('should delete an archived task', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);
      saveTask({ ...task, status: 'done' }, options);

      deleteTask(task.id, options);
      expect(taskExists(task.id, options)).toBe(false);
    });

    it('should throw if task does not exist', () => {
      expect(() => deleteTask('TASK-9999', options)).toThrow('not found');
    });
  });

  describe('taskExists', () => {
    it('should return true for active task', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      expect(taskExists(task.id, options)).toBe(true);
    });

    it('should return true for archived task', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);
      saveTask({ ...task, status: 'done' }, options);

      expect(taskExists(task.id, options)).toBe(true);
    });

    it('should return false for non-existent task', () => {
      expect(taskExists('TASK-9999', options)).toBe(false);
    });
  });

  describe('markdown format', () => {
    it('should preserve description with markdown formatting', () => {
      const task = createTask({ 
        title: 'Test',
        description: '## Heading\n\n- Item 1\n- Item 2\n\n```js\ncode();\n```'
      }, []);
      
      addTask(task, options);
      const retrieved = getTask(task.id, options);
      
      expect(retrieved?.description).toContain('## Heading');
      expect(retrieved?.description).toContain('- Item 1');
      expect(retrieved?.description).toContain('```js');
    });

    it('should handle tasks without description', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      const retrieved = getTask(task.id, options);
      expect(retrieved?.description).toBeUndefined();
    });

    it('should reject invalid frontmatter (missing required fields)', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      // Manually corrupt the file
      const filePath = join(TEST_DATA_DIR, 'tasks', `${task.id}.md`);
      writeFileSync(filePath, '---\nrandom: field\n---\nContent', 'utf-8');

      // Should return undefined due to validation error (filtered out)
      const retrieved = getTask(task.id, options);
      expect(retrieved).toBeUndefined();
    });

    it('should reject invalid status values', () => {
      const task = createTask({ title: 'Test' }, []);
      addTask(task, options);

      // Manually corrupt the file with invalid status
      const filePath = join(TEST_DATA_DIR, 'tasks', `${task.id}.md`);
      const content = `---
id: ${task.id}
title: Test
status: invalid_status
created_at: '2024-01-01T00:00:00Z'
updated_at: '2024-01-01T00:00:00Z'
---
Content`;
      writeFileSync(filePath, content, 'utf-8');

      // Should return undefined due to validation error (filtered out)
      const retrieved = getTask(task.id, options);
      expect(retrieved).toBeUndefined();
    });
  });
});
