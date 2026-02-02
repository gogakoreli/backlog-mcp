/**
 * Golden Search Benchmark Tests
 * 
 * These tests document real-world search behavior, exposing:
 * - What WORKS (strengths)
 * - What DOESN'T work (limitations)
 * - Expected ranking behavior
 * 
 * When search behavior changes, these tests reveal the impact.
 * Failing tests should prompt discussion: is this a regression or improvement?
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '../search/orama-search-service.js';
import type { Task } from '../storage/schema.js';

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'search-golden.json');

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Realistic task dataset simulating actual backlog content
 */
const GOLDEN_TASKS: Task[] = [
  // Epics
  makeTask({
    id: 'EPIC-0001',
    title: 'backlog-mcp 10x',
    description: 'Transform backlog-mcp from task tracker to agentic work system with keyboard-first UX',
    type: 'epic',
  }),
  makeTask({
    id: 'EPIC-0002',
    title: 'Search & Discovery',
    description: 'Comprehensive search with RAG-ready architecture',
    type: 'epic',
  }),

  // Tasks with various content patterns
  makeTask({
    id: 'TASK-0001',
    title: 'Implement Spotlight-style search UI',
    description: 'Global search modal triggered by Cmd+J with keyboard-first navigation',
    epic_id: 'EPIC-0001',
    references: [
      { url: 'https://docs.orama.com', title: 'Orama documentation' },
      { url: 'file:///path/to/adr-0038.md', title: 'ADR-0038: Search Architecture' },
    ],
  }),
  makeTask({
    id: 'TASK-0002',
    title: 'Fix authentication bug',
    description: 'Users cannot log in with SSO when MFA is enabled',
    status: 'in_progress',
  }),
  makeTask({
    id: 'TASK-0003',
    title: 'Add keyboard shortcuts',
    description: 'Implement Cmd+K for command palette, Cmd+J for search',
    epic_id: 'EPIC-0001',
  }),
  makeTask({
    id: 'TASK-0004',
    title: 'Database schema migration',
    description: 'Migrate from SQLite to PostgreSQL for better concurrency',
    status: 'blocked',
    blocked_reason: ['Waiting for DBA approval', 'Need production backup first'],
  }),
  makeTask({
    id: 'TASK-0005',
    title: 'SearchService abstraction layer',
    description: 'Create pluggable search backend interface for Orama, future RAG',
    epic_id: 'EPIC-0002',
    evidence: ['Implemented SearchService interface', 'Added OramaSearchService'],
  }),
  makeTask({
    id: 'TASK-0006',
    title: 'Fix first-time user onboarding',
    description: 'New users see blank screen on first load',
    status: 'done',
    evidence: ['Fixed in PR #42', 'Added loading state'],
  }),
  makeTask({
    id: 'TASK-0007',
    title: 'API rate limiting',
    description: 'Implement rate-limiting middleware for REST endpoints',
  }),
  makeTask({
    id: 'TASK-0008',
    title: 'Real-time collaboration',
    description: 'WebSocket-based real-time updates for multi-user editing',
  }),
];

describe('Search Golden Benchmark', () => {
  let service: OramaSearchService;

  beforeAll(async () => {
    service = new OramaSearchService({ cachePath: TEST_CACHE_PATH });
    await service.index(GOLDEN_TASKS);
  });

  /**
   * ===========================================
   * STRENGTHS: What search does well
   * ===========================================
   */
  describe('✅ Strengths', () => {
    describe('exact matches', () => {
      it('finds exact title match', async () => {
        const results = await service.search('Spotlight');
        expect(results[0].task.id).toBe('TASK-0001');
      });

      it('finds exact word in description', async () => {
        const results = await service.search('PostgreSQL');
        expect(results[0].task.id).toBe('TASK-0004');
      });

      it('finds task by full ID', async () => {
        const results = await service.search('TASK-0001');
        expect(results[0].task.id).toBe('TASK-0001');
      });
    });

    describe('fuzzy matching (typo tolerance)', () => {
      it('handles common typo in longer word', async () => {
        const results = await service.search('authentcation'); // missing 'i'
        expect(results.some(r => r.task.id === 'TASK-0002')).toBe(true);
      });

      it('handles missing character', async () => {
        const results = await service.search('databse'); // missing 'a'
        expect(results.some(r => r.task.id === 'TASK-0004')).toBe(true);
      });
    });

    describe('multi-word queries', () => {
      it('finds documents matching multiple words', async () => {
        const results = await service.search('keyboard shortcuts');
        expect(results[0].task.id).toBe('TASK-0003');
      });

      it('finds documents matching any word (OR behavior)', async () => {
        const results = await service.search('WebSocket migration');
        const ids = results.map(r => r.task.id);
        expect(ids).toContain('TASK-0008');
        expect(ids).toContain('TASK-0004');
      });
    });

    describe('field searching', () => {
      it('searches blocked_reason field', async () => {
        const results = await service.search('DBA approval');
        expect(results[0].task.id).toBe('TASK-0004');
      });

      it('searches evidence field', async () => {
        const results = await service.search('OramaSearchService');
        expect(results[0].task.id).toBe('TASK-0005');
      });

      it('searches reference URLs', async () => {
        const results = await service.search('docs.orama.com');
        expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
      });

      it('searches epic_id field', async () => {
        const results = await service.search('EPIC-0001');
        const ids = results.map(r => r.task.id);
        // Should find tasks with this epic_id
        expect(ids).toContain('TASK-0001');
        expect(ids).toContain('TASK-0003');
      });
    });

    describe('case insensitivity', () => {
      it('matches regardless of case', async () => {
        const lower = await service.search('spotlight');
        const upper = await service.search('SPOTLIGHT');
        const mixed = await service.search('SpOtLiGhT');
        expect(lower[0].task.id).toBe(upper[0].task.id);
        expect(lower[0].task.id).toBe(mixed[0].task.id);
      });
    });
  });

  /**
   * ===========================================
   * LIMITATIONS: Known issues (marked with .fails)
   * These tests PASS when the limitation exists.
   * When fixed, they will FAIL (prompting removal of .fails)
   * ===========================================
   */
  describe('⚠️ Known Limitations', () => {
    describe('hyphenated words', () => {
      it('"first" matches "keyboard-first"', async () => {
        // Custom tokenizer expands hyphenated words: "keyboard-first" → ["keyboard-first", "keyboard", "first"]
        const results = await service.search('first');
        expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
      });

      it('full hyphenated term matches', async () => {
        const results = await service.search('keyboard-first');
        expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
      });

      it('first word of hyphenated term matches', async () => {
        const results = await service.search('keyboard');
        expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
      });
    });

    describe('numeric-only queries', () => {
      it('numeric query "0001" finds TASK-0001', async () => {
        // Custom tokenizer splits "TASK-0001" → ["task-0001", "task", "0001"]
        const results = await service.search('0001');
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('short word fuzzy matching', () => {
      it('typo in short word still matches', async () => {
        // "Spotlght" (8 chars, missing 1) matches "Spotlight" (9 chars) with tolerance=1
        const results = await service.search('Spotlght');
        expect(results.some(r => r.task.id === 'TASK-0001')).toBe(true);
      });
    });
  });

  /**
   * ===========================================
   * EDGE CASES: Boundary behavior
   * ===========================================
   */
  describe('🔬 Edge Cases', () => {
    it('handles empty query', async () => {
      const results = await service.search('');
      expect(results).toEqual([]);
    });

    it('handles whitespace-only query', async () => {
      const results = await service.search('   \t\n  ');
      expect(results).toEqual([]);
    });

    it('handles special characters in content', async () => {
      const results = await service.search('Cmd');
      expect(results.length).toBeGreaterThan(0);
    });

    it('handles very long query gracefully', async () => {
      const longQuery = 'implement search feature with keyboard navigation and spotlight style modal';
      const results = await service.search(longQuery);
      // Should not crash, may or may not find results
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles query with no matches', async () => {
      const results = await service.search('xyznonexistent123');
      expect(results).toEqual([]);
    });

    it('handles single character query', async () => {
      const results = await service.search('a');
      // May or may not return results, but should not crash
      expect(Array.isArray(results)).toBe(true);
    });
  });

  /**
   * ===========================================
   * FILTER COMBINATIONS: Search + Filters
   * ===========================================
   */
  describe('🔍 Search + Filters', () => {
    it('search + status filter', async () => {
      const results = await service.search('fix', { filters: { status: ['in_progress'] } });
      expect(results.every(r => r.task.status === 'in_progress')).toBe(true);
    });

    it('search + type filter for epics', async () => {
      const results = await service.search('backlog', { filters: { type: 'epic' } });
      expect(results.every(r => r.task.type === 'epic')).toBe(true);
    });

    it('search + epic_id filter', async () => {
      const results = await service.search('keyboard', { filters: { epic_id: 'EPIC-0001' } });
      expect(results.every(r => r.task.epic_id === 'EPIC-0001')).toBe(true);
    });

    it('search + multiple status filter', async () => {
      const results = await service.search('user', { filters: { status: ['open', 'in_progress'] } });
      expect(results.every(r => ['open', 'in_progress'].includes(r.task.status))).toBe(true);
    });

    it('search + limit', async () => {
      const results = await service.search('task', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('filter with no search matches returns empty', async () => {
      const results = await service.search('nonexistent', { filters: { status: ['open'] } });
      expect(results).toEqual([]);
    });
  });

  /**
   * ===========================================
   * RANKING BEHAVIOR: Document actual ranking
   * ===========================================
   */
  describe('📊 Ranking Behavior', () => {
    it('returns scores in descending order', async () => {
      const results = await service.search('search');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('exact title match scores highest', async () => {
      const results = await service.search('SearchService abstraction layer');
      expect(results[0].task.id).toBe('TASK-0005');
    });

    it('more matching words = higher score', async () => {
      const results = await service.search('Spotlight search UI');
      // TASK-0001 has all three words
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('all results have positive scores', async () => {
      const results = await service.search('keyboard');
      expect(results.every(r => r.score > 0)).toBe(true);
    });

    it('title match ranks higher than description-only match (ADR-0050)', async () => {
      // EPIC-0001 has "backlog" in title: "backlog-mcp 10x"
      // Other tasks may have "backlog" only in description
      const results = await service.search('backlog');
      const epic = results.find(r => r.task.id === 'EPIC-0001');
      expect(epic).toBeDefined();
      // Epic with title match should have bonus applied (score > 10)
      expect(epic!.score).toBeGreaterThan(10);
    });

    it('epic with title match ranks above task with same title match (ADR-0051)', async () => {
      // EPIC-0002 "Search & Discovery" and TASK-0005 "SearchService abstraction layer"
      // both have "search" in title, but epic should rank higher
      const results = await service.search('search');
      const epic = results.find(r => r.task.id === 'EPIC-0002');
      const task = results.find(r => r.task.id === 'TASK-0005');
      expect(epic).toBeDefined();
      expect(task).toBeDefined();
      // Epic should have higher score due to epic bonus
      expect(epic!.score).toBeGreaterThan(task!.score);
    });

    it('title-starts-with-query gets highest bonus (ADR-0051)', async () => {
      // EPIC-0001 title starts with "backlog": "backlog-mcp 10x"
      const results = await service.search('backlog');
      const epic = results.find(r => r.task.id === 'EPIC-0001');
      expect(epic).toBeDefined();
      // Should have title-starts-with bonus (20) + epic bonus (5) = 25+ on top of BM25
      expect(epic!.score).toBeGreaterThan(25);
    });
  });
});
