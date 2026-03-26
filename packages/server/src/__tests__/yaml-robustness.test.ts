import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storage } from '../storage/backlog-service.js';
import { createTask } from '../storage/schema.js';
import { paths } from '../utils/paths.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = '/test/backlog';

describe('YAML Robustness', () => {
  beforeEach(() => {
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(TEST_DIR);
    mkdirSync(join(TEST_DIR, 'tasks'), { recursive: true });
  });

  describe('reading tasks with special characters', () => {
    it('should handle titles with colons', async () => {
      const task = createTask({
        id: 'TASK-0001',
        title: 'Design: My Feature'
      });
      await storage.add(task);

      const retrieved = await storage.get('TASK-0001');
      expect(retrieved?.title).toBe('Design: My Feature');
    });

    it('should not break list() when one file has malformed YAML', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Valid Task' });
      await storage.add(task);

      writeFileSync(
        join(TEST_DIR, 'tasks', 'TASK-0002.md'),
        '---\nid: TASK-0002\ntitle: Bad: Unquoted: Colons: Everywhere\nstatus: open\n---\n'
      );

      const tasks = await storage.list();
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.find(t => t.id === 'TASK-0001')).toBeDefined();
    });

    it('should not break counts() when one file has malformed YAML', async () => {
      const task = createTask({ id: 'TASK-0001', title: 'Valid Task' });
      await storage.add(task);

      writeFileSync(
        join(TEST_DIR, 'tasks', 'TASK-0002.md'),
        '---\nid: TASK-0002\ntitle: Bad: Unquoted\nstatus: open\n---\n'
      );

      const counts = await storage.counts();
      expect(counts.total_tasks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('writing tasks with special characters', () => {
    it('should properly escape titles with colons when writing', async () => {
      const task = createTask({
        id: 'TASK-0001',
        title: 'Design: Architecture: Overview'
      });
      await storage.add(task);

      const raw = await storage.getMarkdown('TASK-0001');
      expect(raw).toContain("title: 'Design: Architecture: Overview'");
    });

    it('should properly escape titles with quotes when writing', async () => {
      const task = createTask({
        id: 'TASK-0001',
        title: "Task with 'single' and \"double\" quotes"
      });
      await storage.add(task);

      const retrieved = await storage.get('TASK-0001');
      expect(retrieved?.title).toBe("Task with 'single' and \"double\" quotes");
    });
  });
});
