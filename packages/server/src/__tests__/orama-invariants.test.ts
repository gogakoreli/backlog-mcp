/**
 * orama-invariants.test.ts — Architectural invariant tests for ADR-0079.
 *
 * These tests verify the structural guarantees of the Orama native filtering
 * migration. They prove (not claim) that:
 *
 * 1. Enum schema fields are NOT text-searchable (no false positives from metadata)
 * 2. Native `where` filtering produces correct results for status, type, epic_id, parent_id
 * 3. `where` filtering never misses results that match (no over-fetch window problem)
 * 4. `insertMultiple` produces identical search results to sequential inserts
 * 5. `properties` restriction prevents metadata field text matching
 * 6. Combined where + text search works correctly
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '../search/orama-search-service.js';
import type { Entity } from '@backlog-mcp/shared';
import type { Resource } from '../search/types.js';

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return {
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> & { id: string; title: string; content: string }): Resource {
  return { path: 'resources/test.md', ...overrides };
}

let cacheCounter = 0;
function freshCachePath(): string {
  return join(process.cwd(), 'test-data', '.cache', `orama-inv-${++cacheCounter}-${Date.now()}.json`);
}

// ── Invariant 1: Enum fields are NOT text-searchable ────────────────

describe('Invariant: enum fields excluded from text search (ADR-0079)', () => {
  let service: OramaSearchService;

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index([
      makeTask({ id: 'TASK-0001', title: 'Build dashboard', status: 'open' }),
      makeTask({ id: 'TASK-0002', title: 'Fix open issue', status: 'done' }),
      makeTask({ id: 'TASK-0003', title: 'Deploy service', status: 'in_progress', type: 'task' }),
      makeTask({ id: 'EPIC-0001', title: 'Platform epic', type: 'epic' }),
    ]);
  });

  it('searching "open" does NOT match tasks just because status=open', async () => {
    const results = await service.search('open');
    // TASK-0002 has "open" in title ("Fix open issue") — should match
    // TASK-0001 has status=open but "open" is NOT in title/description — should NOT match
    const ids = results.map(r => r.id);
    expect(ids).toContain('TASK-0002'); // title match
    expect(ids).not.toContain('TASK-0001'); // status-only, no text match
  });

  it('searching "epic" does NOT match tasks just because type=epic', async () => {
    const results = await service.search('epic');
    // EPIC-0001 has "epic" in title — should match
    // TASK-0003 has type=task — should NOT match from type field
    const epicResult = results.find(r => r.id === 'EPIC-0001');
    expect(epicResult).toBeDefined();
    // No task should match purely from its type field
    for (const r of results) {
      if (r.task.type === 'task') {
        expect(r.task.title.toLowerCase()).toContain('epic');
      }
    }
  });

  it('searching "in_progress" does NOT match tasks by status value', async () => {
    const results = await service.search('in_progress');
    // No task has "in_progress" in title or description
    expect(results.length).toBe(0);
  });
});

// ── Invariant 2: Native where filtering correctness ─────────────────

describe('Invariant: native where filtering matches old JS filtering (ADR-0079)', () => {
  let service: OramaSearchService;

  const tasks: Entity[] = [
    makeTask({ id: 'TASK-0001', title: 'Auth feature', status: 'open', epic_id: 'EPIC-0001' }),
    makeTask({ id: 'TASK-0002', title: 'Auth bug', status: 'in_progress', epic_id: 'EPIC-0001' }),
    makeTask({ id: 'TASK-0003', title: 'Auth refactor', status: 'done', epic_id: 'EPIC-0002' }),
    makeTask({ id: 'TASK-0004', title: 'Auth test', status: 'blocked', epic_id: 'EPIC-0001', blocked_reason: ['Waiting'] }),
    makeTask({ id: 'EPIC-0001', title: 'Auth epic', type: 'epic' }),
  ];

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(tasks);
  });

  it('status filter: single status', async () => {
    const results = await service.search('auth', { filters: { status: ['open'] } });
    expect(results.every(r => r.task.status === 'open')).toBe(true);
    expect(results.some(r => r.id === 'TASK-0001')).toBe(true);
  });

  it('status filter: multiple statuses', async () => {
    const results = await service.search('auth', { filters: { status: ['open', 'in_progress'] } });
    expect(results.every(r => ['open', 'in_progress'].includes(r.task.status))).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('type filter: task only', async () => {
    const results = await service.search('auth', { filters: { type: 'task' } });
    expect(results.every(r => (r.task.type || 'task') === 'task')).toBe(true);
    expect(results.some(r => r.id === 'EPIC-0001')).toBe(false);
  });

  it('type filter: epic only', async () => {
    const results = await service.search('auth', { filters: { type: 'epic' } });
    expect(results.every(r => r.task.type === 'epic')).toBe(true);
    expect(results.some(r => r.id === 'EPIC-0001')).toBe(true);
  });

  it('epic_id filter', async () => {
    const results = await service.search('auth', { filters: { epic_id: 'EPIC-0001' } });
    for (const r of results) {
      expect(r.task.parent_id ?? r.task.epic_id).toBe('EPIC-0001');
    }
    expect(results.some(r => r.id === 'TASK-0003')).toBe(false); // EPIC-0002
  });

  it('combined status + epic_id filter', async () => {
    const results = await service.search('auth', {
      filters: { status: ['open', 'blocked'], epic_id: 'EPIC-0001' },
    });
    for (const r of results) {
      expect(['open', 'blocked']).toContain(r.task.status);
      expect(r.task.parent_id ?? r.task.epic_id).toBe('EPIC-0001');
    }
  });
});

// ── Invariant 3: parent_id takes precedence over epic_id ────────────

describe('Invariant: parent_id precedence in where filtering (ADR-0079)', () => {
  let service: OramaSearchService;

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index([
      makeTask({ id: 'TASK-0001', title: 'Child task', epic_id: 'EPIC-0001', parent_id: 'FLDR-0001' }),
      makeTask({ id: 'TASK-0002', title: 'Child task two', epic_id: 'EPIC-0001' }),
    ]);
  });

  it('parent_id filter matches task with parent_id set', async () => {
    const results = await service.search('child', { filters: { parent_id: 'FLDR-0001' } });
    expect(results.some(r => r.id === 'TASK-0001')).toBe(true);
    expect(results.some(r => r.id === 'TASK-0002')).toBe(false);
  });

  it('epic_id filter does NOT match task whose parent_id overrides epic_id', async () => {
    const results = await service.search('child', { filters: { epic_id: 'EPIC-0001' } });
    // TASK-0001 has parent_id=FLDR-0001 which overrides epic_id in the index
    expect(results.some(r => r.id === 'TASK-0001')).toBe(false);
    // TASK-0002 has no parent_id, so epic_id is used
    expect(results.some(r => r.id === 'TASK-0002')).toBe(true);
  });
});

// ── Invariant 4: No over-fetch window problem ───────────────────────

describe('Invariant: where filtering has no window limit (ADR-0079)', () => {
  it('finds filtered results beyond what limit*3 would have returned', async () => {
    // Create 50 tasks: 45 status=done, 5 status=open
    // Old code fetched limit*3=30 results, so if all 30 were "done",
    // the 5 "open" tasks would be silently dropped.
    const tasks: Entity[] = [];
    for (let i = 1; i <= 45; i++) {
      tasks.push(makeTask({
        id: `TASK-${String(i).padStart(4, '0')}`,
        title: `Search task number ${i}`,
        status: 'done',
      }));
    }
    for (let i = 46; i <= 50; i++) {
      tasks.push(makeTask({
        id: `TASK-${String(i).padStart(4, '0')}`,
        title: `Search task number ${i}`,
        status: 'open',
      }));
    }

    const service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index(tasks);

    // With limit=10, native where should find open tasks regardless of how many done tasks exist
    const results = await service.search('search task', { limit: 10, filters: { status: ['open'] } });
    expect(results.length).toBe(5);
    expect(results.every(r => r.task.status === 'open')).toBe(true);
  });
});

// ── Invariant 5: insertMultiple produces same results as sequential ─

describe('Invariant: insertMultiple equivalence (ADR-0079)', () => {
  const tasks: Entity[] = [
    makeTask({ id: 'TASK-0001', title: 'Alpha feature', status: 'open' }),
    makeTask({ id: 'TASK-0002', title: 'Beta feature', status: 'in_progress' }),
    makeTask({ id: 'TASK-0003', title: 'Gamma feature', status: 'done' }),
  ];

  it('batch-indexed service returns same search results as sequentially-indexed', async () => {
    // Service 1: uses insertMultiple (via index())
    const batchService = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await batchService.index(tasks);

    // Service 2: uses sequential addDocument
    const seqService = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await seqService.index([]); // init empty
    for (const t of tasks) {
      await seqService.addDocument(t);
    }

    const batchResults = await batchService.search('feature');
    const seqResults = await seqService.search('feature');

    expect(batchResults.length).toBe(seqResults.length);
    expect(batchResults.map(r => r.id).sort()).toEqual(seqResults.map(r => r.id).sort());
  });
});

// ── Invariant 6: searchAll where filtering for docTypes ─────────────

describe('Invariant: searchAll native docType filtering (ADR-0079)', () => {
  let service: OramaSearchService;

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index([
      makeTask({ id: 'TASK-0001', title: 'Search implementation' }),
      makeTask({ id: 'EPIC-0001', title: 'Search epic', type: 'epic' }),
    ]);
    await service.indexResources([
      makeResource({ id: 'res-1', title: 'Search design doc', content: 'Search architecture', path: 'resources/search.md' }),
    ]);
  });

  it('docTypes=["resource"] returns only resources via native where', async () => {
    const results = await service.searchAll('search', { docTypes: ['resource'] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type === 'resource')).toBe(true);
  });

  it('docTypes=["task"] excludes epics and resources', async () => {
    const results = await service.searchAll('search', { docTypes: ['task'] });
    expect(results.every(r => r.type === 'task')).toBe(true);
  });

  it('combined docTypes + status filter', async () => {
    const results = await service.searchAll('search', {
      docTypes: ['task'],
      filters: { status: ['open'] },
    });
    for (const r of results) {
      expect(r.type).toBe('task');
      expect((r.item as Entity).status).toBe('open');
    }
  });
});

// ── Invariant 7: searchResources uses native type filter ────────────

describe('Invariant: searchResources native filtering (ADR-0079)', () => {
  let service: OramaSearchService;

  beforeEach(async () => {
    service = new OramaSearchService({ cachePath: freshCachePath(), hybridSearch: false });
    await service.index([
      makeTask({ id: 'TASK-0001', title: 'Design document review' }),
    ]);
    await service.indexResources([
      makeResource({ id: 'res-1', title: 'Design document', content: 'Architecture overview', path: 'resources/design.md' }),
    ]);
  });

  it('returns only resources, never tasks', async () => {
    const results = await service.searchResources('design document');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.resource).toBeDefined();
      expect(r.resource.path).toBeTruthy();
    }
  });
});
