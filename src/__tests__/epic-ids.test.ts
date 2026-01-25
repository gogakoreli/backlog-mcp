import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from '../backlog.js';
import { createTask, nextTaskId } from '../schema.js';

describe('Epic ID Generation', () => {
  const testDataDir = join(process.cwd(), 'test-data-epic-ids');

  beforeEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true });
    }
    mkdirSync(testDataDir, { recursive: true });
    storage.init(testDataDir);
  });

  afterEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true });
    }
  });

  it('should generate unique epic IDs even with 20+ tasks', () => {
    // Create 25 regular tasks
    for (let i = 1; i <= 25; i++) {
      const id = nextTaskId(storage.getMaxId(), 'task');
      const task = createTask({ id, title: `Task ${i}` });
      storage.add(task);
    }

    // Create first epic
    const epic1Id = nextTaskId(storage.getMaxId('epic'), 'epic');
    const epic1 = createTask({ id: epic1Id, title: 'Epic 1', type: 'epic' });
    storage.add(epic1);
    expect(epic1.id).toBe('EPIC-0001');

    // Create second epic
    const epic2Id = nextTaskId(storage.getMaxId('epic'), 'epic');
    const epic2 = createTask({ id: epic2Id, title: 'Epic 2', type: 'epic' });
    storage.add(epic2);
    expect(epic2.id).toBe('EPIC-0002');

    // Create third epic
    const epic3Id = nextTaskId(storage.getMaxId('epic'), 'epic');
    const epic3 = createTask({ id: epic3Id, title: 'Epic 3', type: 'epic' });
    storage.add(epic3);
    expect(epic3.id).toBe('EPIC-0003');

    // Verify all epics exist
    expect(storage.get('EPIC-0001')).toBeDefined();
    expect(storage.get('EPIC-0002')).toBeDefined();
    expect(storage.get('EPIC-0003')).toBeDefined();

    // Verify epic titles are correct (not overwritten)
    expect(storage.get('EPIC-0001')?.title).toBe('Epic 1');
    expect(storage.get('EPIC-0002')?.title).toBe('Epic 2');
    expect(storage.get('EPIC-0003')?.title).toBe('Epic 3');
  });

  it('should consider archived tasks when generating IDs', () => {
    // Create and archive an epic
    const epic1Id = nextTaskId(storage.getMaxId('epic'), 'epic');
    const epic1 = createTask({ id: epic1Id, title: 'Epic 1', type: 'epic' });
    storage.add(epic1);
    
    // Archive it by marking as done
    epic1.status = 'done';
    storage.save(epic1);

    // Create 20 regular tasks
    for (let i = 1; i <= 20; i++) {
      const id = nextTaskId(storage.getMaxId(), 'task');
      const task = createTask({ id, title: `Task ${i}` });
      storage.add(task);
    }

    // Create second epic - should be EPIC-0002, not EPIC-0001
    const epic2Id = nextTaskId(storage.getMaxId('epic'), 'epic');
    const epic2 = createTask({ id: epic2Id, title: 'Epic 2', type: 'epic' });
    storage.add(epic2);
    expect(epic2.id).toBe('EPIC-0002');

    // Verify both epics exist
    expect(storage.get('EPIC-0001')).toBeDefined();
    expect(storage.get('EPIC-0002')).toBeDefined();
  });
});
