import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '../search/orama-search-service.js';
import type { Entity } from '@backlog-mcp/shared';

/**
 * Semantic/Hybrid search tests.
 * These tests verify that hybrid search finds semantically related content.
 * 
 * Note: First run downloads the embedding model (~23MB), which takes ~5s.
 * Subsequent runs use cached model.
 */

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return {
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'hybrid-search-index.json');

describe('Hybrid Search (Semantic)', () => {
  let service: OramaSearchService;

  // Tasks designed to test semantic similarity
  const tasks: Entity[] = [
    makeTask({
      id: 'TASK-0001',
      title: 'Implement user authentication',
      description: 'Add OAuth2 and SSO support for secure user access',
    }),
    makeTask({
      id: 'TASK-0002',
      title: 'Fix CI/CD pipeline',
      description: 'Deployment automation is failing on staging environment',
    }),
    makeTask({
      id: 'TASK-0003',
      title: 'Database performance optimization',
      description: 'Query response times are too slow, need indexing improvements',
    }),
    makeTask({
      id: 'TASK-0004',
      title: 'Add user profile page',
      description: 'Users should be able to view and edit their account settings',
    }),
    makeTask({
      id: 'TASK-0005',
      title: 'Implement rate limiting',
      description: 'Protect API endpoints from abuse and DDoS attacks',
    }),
  ];

  beforeAll(async () => {
    // Use fresh index to ensure embeddings are generated
    service = new OramaSearchService({ cachePath: TEST_CACHE_PATH, hybridSearch: true });
    await service.index(tasks);
  }, 60000); // 60s timeout for model download on first run

  describe('semantic similarity', () => {
    it('finds "authentication" task when searching "login"', async () => {
      const results = await service.search('login');
      // "login" is semantically related to "authentication"
      const authTask = results.find(r => r.task.id === 'TASK-0001');
      expect(authTask).toBeDefined();
    });

    it('finds "CI/CD" task when searching "deployment"', async () => {
      const results = await service.search('deployment issues');
      const cicdTask = results.find(r => r.task.id === 'TASK-0002');
      expect(cicdTask).toBeDefined();
    });

    it('finds "database" task when searching "slow queries"', async () => {
      const results = await service.search('slow queries');
      const dbTask = results.find(r => r.task.id === 'TASK-0003');
      expect(dbTask).toBeDefined();
    });

    it('finds "rate limiting" task when searching "API security"', async () => {
      const results = await service.search('API security');
      const rateLimitTask = results.find(r => r.task.id === 'TASK-0005');
      expect(rateLimitTask).toBeDefined();
    });

    it('finds "profile" task when searching "account settings"', async () => {
      const results = await service.search('account settings');
      const profileTask = results.find(r => r.task.id === 'TASK-0004');
      expect(profileTask).toBeDefined();
    });
  });

  describe('exact matches still rank high', () => {
    it('exact title match ranks first', async () => {
      const results = await service.search('authentication');
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('exact description match is found', async () => {
      const results = await service.search('OAuth2');
      expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
    });
  });

  describe('graceful degradation', () => {
    it('works with hybrid search disabled', async () => {
      const bm25Service = new OramaSearchService({
        cachePath: join(process.cwd(), 'test-data', '.cache', 'bm25-only-index.json'),
        hybridSearch: false,
      });
      await bm25Service.index(tasks);

      // Should still find exact matches
      const results = await bm25Service.search('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task.id).toBe('TASK-0001');
    });
  });

  describe('isHybridSearchActive', () => {
    it('returns true when embeddings are loaded', () => {
      expect(service.isHybridSearchActive()).toBe(true);
    });

    it('returns false when hybrid search is disabled', async () => {
      const bm25Service = new OramaSearchService({
        cachePath: join(process.cwd(), 'test-data', '.cache', 'bm25-check-index.json'),
        hybridSearch: false,
      });
      await bm25Service.index(tasks);
      expect(bm25Service.isHybridSearchActive()).toBe(false);
    });
  });
});
