import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from '../storage/backlog-service.js';
import {
  ENTITY_TYPES,
  TYPE_PREFIXES,
  isValidEntityId,
  parseEntityNum,
  parseEntityId,
  formatEntityId,
  nextEntityId,
} from '@backlog-mcp/shared';
import { createTask } from '../storage/schema.js';
import { paths } from '../utils/paths.js';

// Mock SearchService
vi.mock('../search/index.js', () => ({
  OramaSearchService: class {
    static getInstance() { return new this(); }
    async index() {}
    async search() { return []; }
    async searchAll() { return []; }
    async addDocument() {}
    async updateDocument() {}
    async removeDocument() {}
  },
}));

const TEST_DATA_DIR = join(process.cwd(), 'test-data-substrates');

describe('Substrates Backend', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(TEST_DATA_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Schema: ID validation and formatting
  // ========================================================================

  describe('schema - ID utilities', () => {
    it('should validate all 5 prefix types', () => {
      expect(isValidEntityId('TASK-0001')).toBe(true);
      expect(isValidEntityId('EPIC-0001')).toBe(true);
      expect(isValidEntityId('FLDR-0001')).toBe(true);
      expect(isValidEntityId('ARTF-0001')).toBe(true);
      expect(isValidEntityId('MLST-0001')).toBe(true);
      expect(isValidEntityId('NOPE-0001')).toBe(false);
    });

    it('should parse IDs for all prefixes', () => {
      expect(parseEntityNum('TASK-0042')).toBe(42);
      expect(parseEntityNum('FLDR-0007')).toBe(7);
      expect(parseEntityNum('ARTF-0100')).toBe(100);
      expect(parseEntityNum('MLST-0003')).toBe(3);
      expect(parseEntityNum('NOPE-0001')).toBeNull();
    });

    it('should parse ID with type info', () => {
      expect(parseEntityId('FLDR-0005')).toEqual({ type: 'folder', num: 5 });
      expect(parseEntityId('ARTF-0010')).toEqual({ type: 'artifact', num: 10 });
      expect(parseEntityId('MLST-0001')).toEqual({ type: 'milestone', num: 1 });
      expect(parseEntityId('TASK-0001')).toEqual({ type: 'task', num: 1 });
      expect(parseEntityId('EPIC-0002')).toEqual({ type: 'epic', num: 2 });
      expect(parseEntityId('NOPE-0001')).toBeNull();
    });

    it('should format IDs for all types', () => {
      expect(formatEntityId(1, 'folder')).toBe('FLDR-0001');
      expect(formatEntityId(1, 'artifact')).toBe('ARTF-0001');
      expect(formatEntityId(1, 'milestone')).toBe('MLST-0001');
      expect(formatEntityId(42, 'task')).toBe('TASK-0042');
      expect(formatEntityId(3, 'epic')).toBe('EPIC-0003');
    });

    it('should have all 5 types in ENTITY_TYPES', () => {
      expect(ENTITY_TYPES).toEqual(['task', 'epic', 'folder', 'artifact', 'milestone']);
    });

    it('should have correct prefix mapping', () => {
      expect(TYPE_PREFIXES).toEqual({
        task: 'TASK',
        epic: 'EPIC',
        folder: 'FLDR',
        artifact: 'ARTF',
        milestone: 'MLST',
      });
    });
  });

  // ========================================================================
  // Storage: creating and listing new entity types
  // ========================================================================

  describe('storage - new entity types', () => {
    it('should create and retrieve a folder', () => {
      const id = nextEntityId(storage.getMaxId('folder'), 'folder');
      expect(id).toBe('FLDR-0001');
      const task = createTask({ id, title: 'My Folder', type: 'folder' });
      storage.add(task);
      const retrieved = storage.get('FLDR-0001');
      expect(retrieved?.title).toBe('My Folder');
      expect(retrieved?.type).toBe('folder');
    });

    it('should create and retrieve an artifact', () => {
      const id = nextEntityId(storage.getMaxId('artifact'), 'artifact');
      expect(id).toBe('ARTF-0001');
      const task = createTask({ id, title: 'Design Doc', type: 'artifact', content_type: 'text/markdown', path: '/docs/design.md' });
      storage.add(task);
      const retrieved = storage.get('ARTF-0001');
      expect(retrieved?.content_type).toBe('text/markdown');
      expect(retrieved?.path).toBe('/docs/design.md');
    });

    it('should create and retrieve a milestone', () => {
      const id = nextEntityId(storage.getMaxId('milestone'), 'milestone');
      expect(id).toBe('MLST-0001');
      const task = createTask({ id, title: 'Q1 Release', type: 'milestone', due_date: '2026-03-31T00:00:00Z' });
      storage.add(task);
      const retrieved = storage.get('MLST-0001');
      expect(retrieved?.due_date).toBe('2026-03-31T00:00:00Z');
    });

    it('should generate independent IDs per type', () => {
      // Create items of different types
      storage.add(createTask({ id: 'TASK-0001', title: 'Task 1' }));
      storage.add(createTask({ id: 'FLDR-0001', title: 'Folder 1', type: 'folder' }));
      storage.add(createTask({ id: 'ARTF-0001', title: 'Artifact 1', type: 'artifact' }));

      // Each type's max ID is independent
      expect(storage.getMaxId('task')).toBe(1);
      expect(storage.getMaxId('folder')).toBe(1);
      expect(storage.getMaxId('artifact')).toBe(1);
      expect(storage.getMaxId('milestone')).toBe(0);

      // Next IDs are correct
      expect(nextEntityId(storage.getMaxId('task'), 'task')).toBe('TASK-0002');
      expect(nextEntityId(storage.getMaxId('folder'), 'folder')).toBe('FLDR-0002');
      expect(nextEntityId(storage.getMaxId('milestone'), 'milestone')).toBe('MLST-0001');
    });
  });

  // ========================================================================
  // Storage: parent_id filtering
  // ========================================================================

  describe('storage - parent_id', () => {
    it('should filter by parent_id', async () => {
      storage.add(createTask({ id: 'FLDR-0001', title: 'Folder', type: 'folder' }));
      storage.add(createTask({ id: 'TASK-0001', title: 'Child 1', parent_id: 'FLDR-0001' }));
      storage.add(createTask({ id: 'TASK-0002', title: 'Child 2', parent_id: 'FLDR-0001' }));
      storage.add(createTask({ id: 'TASK-0003', title: 'Orphan' }));

      const children = await storage.list({ parent_id: 'FLDR-0001' });
      expect(children).toHaveLength(2);
      expect(children.map(t => t.id).sort()).toEqual(['TASK-0001', 'TASK-0002']);
    });

    it('should filter by parent_id falling back to epic_id', async () => {
      // Old-style task with only epic_id
      const task = createTask({ id: 'TASK-0001', title: 'Old task', epic_id: 'EPIC-0001' });
      storage.add(task);

      // New-style task with parent_id
      const task2 = createTask({ id: 'TASK-0002', title: 'New task', parent_id: 'EPIC-0001' });
      storage.add(task2);

      const children = await storage.list({ parent_id: 'EPIC-0001' });
      expect(children).toHaveLength(2);
    });

    it('should support subtasks (task parented to task)', async () => {
      storage.add(createTask({ id: 'TASK-0001', title: 'Parent task' }));
      storage.add(createTask({ id: 'TASK-0002', title: 'Subtask 1', parent_id: 'TASK-0001' }));
      storage.add(createTask({ id: 'TASK-0003', title: 'Subtask 2', parent_id: 'TASK-0001' }));

      const subtasks = await storage.list({ parent_id: 'TASK-0001' });
      expect(subtasks).toHaveLength(2);
    });
  });

  // ========================================================================
  // Backward compatibility: epic_id still works
  // ========================================================================

  describe('backward compatibility - epic_id', () => {
    it('should still filter by epic_id', async () => {
      storage.add(createTask({ id: 'EPIC-0001', title: 'Epic', type: 'epic' }));
      storage.add(createTask({ id: 'TASK-0001', title: 'Task in epic', epic_id: 'EPIC-0001' }));

      const tasks = await storage.list({ epic_id: 'EPIC-0001' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('TASK-0001');
    });

    it('should still create tasks with epic_id', () => {
      const task = createTask({ id: 'TASK-0001', title: 'Test', epic_id: 'EPIC-0001' });
      expect(task.epic_id).toBe('EPIC-0001');
      storage.add(task);
      const retrieved = storage.get('TASK-0001');
      expect(retrieved?.epic_id).toBe('EPIC-0001');
    });

    it('should still generate epic IDs correctly', () => {
      storage.add(createTask({ id: 'EPIC-0001', title: 'Epic 1', type: 'epic' }));
      const nextId = nextEntityId(storage.getMaxId('epic'), 'epic');
      expect(nextId).toBe('EPIC-0002');
    });
  });

  // ========================================================================
  // Counts
  // ========================================================================

  describe('counts - by_type', () => {
    it('should count all entity types', () => {
      storage.add(createTask({ id: 'TASK-0001', title: 'Task' }));
      storage.add(createTask({ id: 'EPIC-0001', title: 'Epic', type: 'epic' }));
      storage.add(createTask({ id: 'FLDR-0001', title: 'Folder', type: 'folder' }));
      storage.add(createTask({ id: 'ARTF-0001', title: 'Artifact', type: 'artifact' }));
      storage.add(createTask({ id: 'MLST-0001', title: 'Milestone', type: 'milestone' }));

      const counts = storage.counts();
      expect(counts.by_type).toEqual({
        task: 1,
        epic: 1,
        folder: 1,
        artifact: 1,
        milestone: 1,
      });
      // total_tasks counts non-epics (backward compat)
      expect(counts.total_tasks).toBe(4);
      expect(counts.total_epics).toBe(1);
    });
  });
});
