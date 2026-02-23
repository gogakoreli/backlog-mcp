import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '../search/orama-search-service.js';
import type { Entity } from '@backlog-mcp/shared';

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return {
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'search-index.json');

describe('OramaSearchService', () => {
  let service: OramaSearchService;

  const tasks: Entity[] = [
    makeTask({ id: 'TASK-0001', title: 'Implement authentication', description: 'Add OAuth2 login flow' }),
    makeTask({ id: 'TASK-0002', title: 'Fix login bug', description: 'Users cannot authenticate with SSO' }),
    makeTask({ id: 'TASK-0003', title: 'Add search feature', description: 'Full-text search for tasks', status: 'in_progress' }),
    makeTask({ id: 'EPIC-0001', title: 'User Management Epic', type: 'epic' }),
    makeTask({ id: 'TASK-0004', title: 'Database migration', epic_id: 'EPIC-0001', status: 'blocked', blocked_reason: ['Waiting for DBA approval'] }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: TEST_CACHE_PATH });
    await service.index(tasks);
  });

  describe('search', () => {
    it('finds tasks by title', async () => {
      const results = await service.search('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('finds tasks by description', async () => {
      const results = await service.search('OAuth2');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('handles typos with fuzzy search', async () => {
      const results = await service.search('authentcation'); // typo
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
    });

    it('boosts title matches over description', async () => {
      const results = await service.search('login');
      // TASK-0002 has "login" in title, TASK-0001 has "login" in description
      expect(results[0].task.id).toBe('TASK-0002');
    });

    it('returns empty array for empty query', async () => {
      const results = await service.search('');
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace query', async () => {
      const results = await service.search('   ');
      expect(results).toEqual([]);
    });

    it('searches blocked_reason field', async () => {
      const results = await service.search('DBA approval');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.id).toBe('TASK-0004');
    });
  });

  describe('filters', () => {
    it('filters by status', async () => {
      const results = await service.search('search', { filters: { status: ['in_progress'] } });
      expect(results.length).toBe(1);
      expect(results[0].task.id).toBe('TASK-0003');
    });

    it('filters by type', async () => {
      const results = await service.search('management', { filters: { type: 'epic' } });
      expect(results.length).toBe(1);
      expect(results[0].task.id).toBe('EPIC-0001');
    });

    it('filters by epic_id', async () => {
      const results = await service.search('migration', { filters: { epic_id: 'EPIC-0001' } });
      expect(results.length).toBe(1);
      expect(results[0].task.id).toBe('TASK-0004');
    });

    it('respects limit option', async () => {
      const results = await service.search('task', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('document operations', () => {
    it('adds new document to index', async () => {
      const newTask = makeTask({ id: 'TASK-0005', title: 'New feature request' });
      await service.addDocument(newTask);

      const results = await service.search('feature request');
      expect(results.some(r => r.task.id === 'TASK-0005')).toBe(true);
    });

    it('removes document from index', async () => {
      await service.removeDocument('TASK-0001');

      const results = await service.search('authentication');
      expect(results.some(r => r.task.id === 'TASK-0001')).toBe(false);
    });

    it('updates document in index', async () => {
      const updated = { ...tasks[0], title: 'Updated authentication system' };
      await service.updateDocument(updated);

      const results = await service.search('Updated authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.title).toBe('Updated authentication system');
    });
  });

  describe('edge cases', () => {
    it('handles search before index', async () => {
      const freshService = new OramaSearchService({ cachePath: TEST_CACHE_PATH });
      const results = await freshService.search('test');
      expect(results).toEqual([]);
    });

    it('handles special characters in query', async () => {
      const results = await service.search('OAuth2 (login)');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
