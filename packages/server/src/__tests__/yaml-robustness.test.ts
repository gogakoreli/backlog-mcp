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
    it('should handle titles with colons', () => {
      // Create task with colon in title via the API
      const task = createTask({ 
        id: 'TASK-0001', 
        title: 'Design: My Feature' 
      });
      storage.add(task);
      
      // Should be able to read it back
      const retrieved = storage.get('TASK-0001');
      expect(retrieved?.title).toBe('Design: My Feature');
    });

    it('should not break list() when one file has malformed YAML', async () => {
      // Create a valid task
      const task = createTask({ id: 'TASK-0001', title: 'Valid Task' });
      storage.add(task);
      
      // Manually create a malformed YAML file
      writeFileSync(
        join(TEST_DIR, 'tasks', 'TASK-0002.md'),
        '---\nid: TASK-0002\ntitle: Bad: Unquoted: Colons: Everywhere\nstatus: open\n---\n'
      );
      
      // list() should not throw - should skip bad file and return valid tasks
      const tasks = await storage.list();
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.find(t => t.id === 'TASK-0001')).toBeDefined();
    });

    it('should not break counts() when one file has malformed YAML', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Valid Task' });
      storage.add(task);
      
      writeFileSync(
        join(TEST_DIR, 'tasks', 'TASK-0002.md'),
        '---\nid: TASK-0002\ntitle: Bad: Unquoted\nstatus: open\n---\n'
      );
      
      // counts() should not throw
      const counts = storage.counts();
      expect(counts.total_tasks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('writing tasks with special characters', () => {
    it('should properly escape titles with colons when writing', () => {
      const task = createTask({ 
        id: 'TASK-0001', 
        title: 'Design: Architecture: Overview' 
      });
      storage.add(task);
      
      // Read raw markdown to verify escaping
      const raw = storage.getMarkdown('TASK-0001');
      expect(raw).toContain("title: 'Design: Architecture: Overview'");
    });

    it('should properly escape titles with quotes when writing', () => {
      const task = createTask({ 
        id: 'TASK-0001', 
        title: "Task with 'single' and \"double\" quotes" 
      });
      storage.add(task);
      
      const retrieved = storage.get('TASK-0001');
      expect(retrieved?.title).toBe("Task with 'single' and \"double\" quotes");
    });
  });
});
