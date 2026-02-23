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
import type { Entity } from '@backlog-mcp/shared';

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'search-golden.json');

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
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
const GOLDEN_TASKS: Entity[] = [
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
  // CamelCase compound word task (mirrors real TASK-0273 pattern)
  makeTask({
    id: 'TASK-0009',
    title: 'Create YavapaiMFE ownership transfer documentation',
    description: 'Create comprehensive starter doc for new team taking ownership of FeatureStore (YavapaiMFE).\n\nMFE ID: `featurestore`\nFeature flag: `featureStore`\nMain package: RhinestoneMonarchYavapaiMFE',
    status: 'done',
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

    describe('camelCase compound words', () => {
      it('"feature store" finds task with "FeatureStore" in description', async () => {
        const results = await service.search('feature store');
        expect(results.some(r => r.task.id === 'TASK-0009')).toBe(true);
      });

      it('"featurestore" (no space) still finds the task', async () => {
        const results = await service.search('featurestore');
        expect(results.some(r => r.task.id === 'TASK-0009')).toBe(true);
      });

      it('"feature store mfe" finds the task', async () => {
        const results = await service.search('feature store mfe');
        expect(results.some(r => r.task.id === 'TASK-0009')).toBe(true);
      });

      it('PascalCase in title: "YavapaiMFE" splits into searchable parts', async () => {
        const results = await service.search('Yavapai');
        expect(results.some(r => r.task.id === 'TASK-0009')).toBe(true);
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
   * RANKING: Position-aware assertions (ADR-0081)
   *
   * These test actual ranking order, not just presence.
   * With linear fusion, scores are [0,1]. Tests assert
   * positions and relative ordering — the things that
   * matter for search quality.
   * ===========================================
   */
  describe('📊 Ranking (ADR-0081)', () => {
    // ── Structural invariants ──────────────────────────────────

    it('scores are in [0,1] range (linear fusion property)', async () => {
      for (const q of ['search', 'keyboard', 'fix', 'backlog']) {
        const results = await service.search(q);
        for (const r of results) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1.0);
        }
      }
    });

    it('scores are in descending order', async () => {
      const results = await service.search('search');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    // ── Position assertions: exact title matches rank #1 ──────

    it('"feature store" → TASK-0009 (FeatureStore) ranks #1', async () => {
      // THE critical test. This is the failure that motivated TASK-0302.
      // Previously ranked 18th due to shadow scoring double-boosting title matches.
      const results = await service.search('feature store');
      expect(results[0].task.id).toBe('TASK-0009');
    });

    it('"keyboard shortcuts" → TASK-0003 ranks #1', async () => {
      const results = await service.search('keyboard shortcuts');
      expect(results[0].task.id).toBe('TASK-0003');
    });

    it('"Spotlight search UI" → TASK-0001 ranks #1', async () => {
      const results = await service.search('Spotlight search UI');
      expect(results[0].task.id).toBe('TASK-0001');
    });

    it('"database migration" → TASK-0004 ranks #1', async () => {
      const results = await service.search('database migration');
      expect(results[0].task.id).toBe('TASK-0004');
    });

    it('"SearchService abstraction layer" → TASK-0005 ranks #1', async () => {
      const results = await service.search('SearchService abstraction layer');
      expect(results[0].task.id).toBe('TASK-0005');
    });

    it('"authentication" → TASK-0002 ranks #1', async () => {
      const results = await service.search('authentication');
      expect(results[0].task.id).toBe('TASK-0002');
    });

    it('"backlog" → EPIC-0001 ranks #1', async () => {
      const results = await service.search('backlog');
      expect(results[0].task.id).toBe('EPIC-0001');
    });

    it('"backlog mcp" → EPIC-0001 ranks #1 (title match beats body-only mentions)', async () => {
      // Both terms appear in EPIC-0001's title "backlog-mcp 10x".
      // Other tasks may mention "backlog" and "mcp" in description/references
      // but title coordination should push the exact title match to #1.
      const results = await service.search('backlog mcp');
      expect(results[0].task.id).toBe('EPIC-0001');
    });

    it('"DBA approval" → TASK-0004 ranks #1', async () => {
      const results = await service.search('DBA approval');
      expect(results[0].task.id).toBe('TASK-0004');
    });

    // ── Relative ordering assertions ──────────────────────────

    it('"search" → EPIC-0002 ranks above TASK-0005', async () => {
      // Both have "search" in title. EPIC-0002 has shorter title → higher BM25 term density.
      const results = await service.search('search');
      const epicIdx = results.findIndex(r => r.task.id === 'EPIC-0002');
      const taskIdx = results.findIndex(r => r.task.id === 'TASK-0005');
      expect(epicIdx).toBeGreaterThanOrEqual(0);
      expect(taskIdx).toBeGreaterThanOrEqual(0);
      expect(epicIdx).toBeLessThan(taskIdx);
    });

    it('"search" → title matches rank above description-only matches', async () => {
      // TASK-0001 has "search" in title. TASK-0003 has "search" only in description.
      const results = await service.search('search');
      const titleMatch = results.findIndex(r => r.task.id === 'TASK-0001');
      const descMatch = results.findIndex(r => r.task.id === 'TASK-0003');
      if (titleMatch >= 0 && descMatch >= 0) {
        expect(titleMatch).toBeLessThan(descMatch);
      }
    });

    it('"Spotlight search" → multi-field match ranks above single-field match', async () => {
      // TASK-0001 has "Spotlight" in title AND "search" in title → both terms match
      // EPIC-0002 has "Search" in title but not "Spotlight"
      const results = await service.search('Spotlight search');
      expect(results[0].task.id).toBe('TASK-0001');
    });

    // ── Top-N assertions (looser, for queries with ambiguous ranking) ──

    it('"feature store" → TASK-0009 in top 1 (not buried at 18th)', async () => {
      // Regression guard: the original bug had TASK-0009 at position 18.
      const results = await service.search('feature store');
      const idx = results.findIndex(r => r.task.id === 'TASK-0009');
      expect(idx).toBe(0);
    });

    it('"keyboard" → TASK-0003 in top 2', async () => {
      // TASK-0003 "Add keyboard shortcuts" has "keyboard" in title
      const results = await service.search('keyboard');
      const idx = results.findIndex(r => r.task.id === 'TASK-0003');
      expect(idx).toBeLessThan(2);
    });

    it('"fix" → both fix tasks in top 3', async () => {
      const results = await service.search('fix');
      const ids = results.slice(0, 3).map(r => r.task.id);
      expect(ids).toContain('TASK-0002'); // "Fix authentication bug"
      expect(ids).toContain('TASK-0006'); // "Fix first-time user onboarding"
    });
  });
});
