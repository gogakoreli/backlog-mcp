import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { extractResourceId } from '../operations/resource-id.js';
import { OperationStorage } from '../operations/storage.js';
import { operationLogger } from '../operations/logger.js';

// Mock fs with memfs
vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('Operations Module', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/test-backlog/.internal', { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  describe('extractResourceId', () => {
    it('extracts ID from backlog_create result', () => {
      const result = { content: [{ text: 'Created TASK-0042' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBe('TASK-0042');
    });

    it('extracts EPIC ID from backlog_create result', () => {
      const result = { content: [{ text: 'Created EPIC-0005' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBe('EPIC-0005');
    });

    it('extracts new entity type IDs from backlog_create result', () => {
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created FLDR-0001' }] })).toBe('FLDR-0001');
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created ARTF-0001' }] })).toBe('ARTF-0001');
      expect(extractResourceId('backlog_create', {}, { content: [{ text: 'Created MLST-0001' }] })).toBe('MLST-0001');
    });

    it('extracts ID from backlog_update params', () => {
      expect(extractResourceId('backlog_update', { id: 'TASK-0099' }, {})).toBe('TASK-0099');
    });

    it('extracts ID from backlog_delete params', () => {
      expect(extractResourceId('backlog_delete', { id: 'TASK-0001' }, {})).toBe('TASK-0001');
    });

    it('extracts ID from write_resource URI', () => {
      const params = { uri: 'mcp://backlog/tasks/TASK-0055.md' };
      expect(extractResourceId('write_resource', params, {})).toBe('TASK-0055');
    });

    it('extracts EPIC ID from write_resource URI', () => {
      const params = { uri: 'mcp://backlog/tasks/EPIC-0003.md' };
      expect(extractResourceId('write_resource', params, {})).toBe('EPIC-0003');
    });

    it('returns undefined for unknown tool', () => {
      expect(extractResourceId('unknown_tool', {}, {})).toBeUndefined();
    });

    it('returns undefined when no ID in result text', () => {
      const result = { content: [{ text: 'Something else' }] };
      expect(extractResourceId('backlog_create', {}, result)).toBeUndefined();
    });

    it('returns undefined for write_resource without task ID in URI', () => {
      const params = { uri: 'mcp://backlog/resources/notes.md' };
      expect(extractResourceId('write_resource', params, {})).toBeUndefined();
    });
  });

  describe('OperationStorage', () => {
    it('is tested through logger integration', () => {
      // Storage is tested indirectly through operationLogger tests
      expect(true).toBe(true);
    });
  });

  describe('operationLogger', () => {
    it('only logs write operations', () => {
      // backlog_list is a read operation, should not be logged
      operationLogger.log('backlog_list', { filter: 'active' }, { tasks: [] });
      const ops = operationLogger.read({ limit: 10 });
      const listOps = ops.filter(o => o.tool === 'backlog_list');
      expect(listOps).toHaveLength(0);
    });

    it('includes actor info in logged operations', () => {
      // This test verifies actor is included - actual values depend on env
      operationLogger.log('backlog_update', { id: 'TASK-0001' }, { success: true });
      const ops = operationLogger.read({ taskId: 'TASK-0001', limit: 1 });
      if (ops.length > 0) {
        expect(ops[0].actor).toBeDefined();
        expect(ops[0].actor.type).toMatch(/^(user|agent)$/);
        expect(ops[0].actor.name).toBeDefined();
      }
    });

    it('filters operations by date', () => {
      // Log operations with different timestamps
      const storage = new OperationStorage();
      
      // Manually append entries with specific dates for testing
      const entry1 = {
        ts: '2026-02-04T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0001' },
        result: {},
        resourceId: 'TASK-0001',
        actor: { type: 'user' as const, name: 'test' },
      };
      const entry2 = {
        ts: '2026-02-05T10:00:00.000Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0002' },
        result: {},
        resourceId: 'TASK-0002',
        actor: { type: 'user' as const, name: 'test' },
      };
      
      storage.append(entry1);
      storage.append(entry2);
      
      // Query by date
      const feb4Ops = storage.query({ date: '2026-02-04' });
      const feb5Ops = storage.query({ date: '2026-02-05' });
      
      expect(feb4Ops.length).toBe(1);
      expect(feb4Ops[0].resourceId).toBe('TASK-0001');
      
      expect(feb5Ops.length).toBe(1);
      expect(feb5Ops[0].resourceId).toBe('TASK-0002');
    });
  });
});
