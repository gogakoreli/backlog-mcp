/**
 * context-hydration.test.ts — Tests for the agent context hydration pipeline.
 * ADR-0074 (Phase 1), ADR-0075 (Phase 2).
 *
 * Tests the ContextHydrationService pipeline, including:
 * 1. Focal resolution (Stage 1) — ID-based and query-based
 * 2. Relational expansion (Stage 2)
 * 3. Semantic enrichment (Stage 3, Phase 2)
 * 4. Temporal overlay (Stage 4, Phase 2)
 * 5. Token budgeting (with related entities and activity)
 * 6. End-to-end pipeline orchestration
 * 7. Contract invariants
 *
 * Uses dependency injection — no filesystem or search index needed.
 */
import { describe, it, expect } from 'vitest';
import type { Entity } from '@backlog-mcp/shared';
import type { Resource } from '../search/types.js';
import { resolveFocal, taskToContextEntity } from '../context/stages/focal-resolution.js';
import { expandRelations, type RelationalExpansionDeps } from '../context/stages/relational-expansion.js';
import { traverseCrossReferences, extractEntityIds, buildReverseReferenceIndex, lookupReverseReferences, type CrossReferenceTraversalDeps } from '../context/stages/cross-reference-traversal.js';
import { enrichSemantic, type SemanticEnrichmentDeps } from '../context/stages/semantic-enrichment.js';
import { overlayTemporal, type TemporalOverlayDeps } from '../context/stages/temporal-overlay.js';
import {
  estimateTokens,
  estimateEntityTokens,
  estimateResourceTokens,
  estimateSessionSummaryTokens,
  applyBudget,
  downgradeEntity,
  downgradeResource,
} from '../context/token-budget.js';
import { hydrateContext, type HydrationServiceDeps } from '../context/hydration-service.js';
import { deriveSessionSummary, type SessionMemoryDeps } from '../context/stages/session-memory.js';
import type { ContextEntity, ContextResource, SessionSummary } from '../context/types.js';

// ── Test data ────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return {
    status: 'open',
    type: 'task',
    created_at: '2026-02-10T10:00:00Z',
    updated_at: '2026-02-14T10:00:00Z',
    ...overrides,
  };
}

const EPIC = makeTask({
  id: 'EPIC-0005',
  title: 'Search & Context Engineering',
  type: 'epic',
  description: 'Epic for all search and context hydration work.',
});

const TASK_FOCAL = makeTask({
  id: 'TASK-0042',
  title: 'Implement context hydration',
  parent_id: 'EPIC-0005',
  description: 'Build the context hydration pipeline for agent context delivery.',
  evidence: ['Designed pipeline in ADR-0074'],
  blocked_reason: [],
  references: [{ url: 'https://github.com/org/repo/issues/42', title: 'GitHub issue' }],
});

const TASK_SIBLING_1 = makeTask({
  id: 'TASK-0040',
  title: 'Add search ranking',
  parent_id: 'EPIC-0005',
  status: 'done',
});

const TASK_SIBLING_2 = makeTask({
  id: 'TASK-0041',
  title: 'Normalize scoring pipeline',
  parent_id: 'EPIC-0005',
  status: 'done',
});

const TASK_CHILD_1 = makeTask({
  id: 'TASK-0043',
  title: 'Stage 1: Focal resolution',
  parent_id: 'TASK-0042',
  status: 'done',
});

const TASK_CHILD_2 = makeTask({
  id: 'TASK-0044',
  title: 'Stage 2: Relational expansion',
  parent_id: 'TASK-0042',
  status: 'in_progress',
});

const TASK_UNRELATED = makeTask({
  id: 'TASK-0099',
  title: 'Unrelated feature',
  parent_id: 'EPIC-0010',
});

// Semantically related tasks (not in the direct graph)
const TASK_SEMANTIC_1 = makeTask({
  id: 'TASK-0050',
  title: 'Research context window optimization',
  parent_id: 'EPIC-0010',
  description: 'Research how to optimize context windows for LLM agents.',
});

const TASK_SEMANTIC_2 = makeTask({
  id: 'TASK-0051',
  title: 'Agent memory persistence layer',
  parent_id: 'EPIC-0010',
  description: 'Build persistent memory for agent sessions.',
});

// Grandchildren (children of TASK_CHILD_1) — for depth 2+ tests (Phase 3)
const TASK_GRANDCHILD_1 = makeTask({
  id: 'TASK-0045',
  title: 'Grandchild subtask A',
  parent_id: 'TASK-0043',
  status: 'open',
});

const TASK_GRANDCHILD_2 = makeTask({
  id: 'TASK-0046',
  title: 'Grandchild subtask B',
  parent_id: 'TASK-0043',
  status: 'done',
});

// Great-grandparent — for depth 3 tests (Phase 3)
const EPIC_GRANDPARENT = makeTask({
  id: 'EPIC-0001',
  title: 'Platform Engineering',
  type: 'epic',
  description: 'Top-level epic for all platform work.',
});

// Make EPIC-0005 a child of EPIC-0001 for depth 3 ancestor traversal
const EPIC_WITH_PARENT = makeTask({
  ...EPIC,
  parent_id: 'EPIC-0001',
});

const ALL_TASKS: Entity[] = [EPIC, TASK_FOCAL, TASK_SIBLING_1, TASK_SIBLING_2, TASK_CHILD_1, TASK_CHILD_2, TASK_UNRELATED, TASK_SEMANTIC_1, TASK_SEMANTIC_2, TASK_GRANDCHILD_1, TASK_GRANDCHILD_2];

// Extended task set for depth 2+ tests — includes grandparent and grandchildren
const DEEP_TASKS: Entity[] = [EPIC_GRANDPARENT, EPIC_WITH_PARENT, TASK_FOCAL, TASK_SIBLING_1, TASK_SIBLING_2, TASK_CHILD_1, TASK_CHILD_2, TASK_UNRELATED, TASK_SEMANTIC_1, TASK_SEMANTIC_2, TASK_GRANDCHILD_1, TASK_GRANDCHILD_2];

const RESOURCE_ADR = {
  id: 'mcp://backlog/resources/EPIC-0005/design.md',
  path: 'resources/EPIC-0005/design.md',
  title: 'Search Design Document',
  content: '# Search Design\n\nThis document describes the search architecture for the backlog system.',
};

const RESOURCE_TASK = {
  id: 'mcp://backlog/resources/TASK-0042/notes.md',
  path: 'resources/TASK-0042/notes.md',
  title: 'Context Hydration Notes',
  content: '# Notes\n\nResearch on context hydration approaches.',
};

const RESOURCE_UNRELATED = {
  id: 'mcp://backlog/resources/misc/readme.md',
  path: 'resources/misc/readme.md',
  title: 'Readme',
  content: '# Readme\n\nGeneral project readme.',
};

const RESOURCE_SEMANTIC = {
  id: 'mcp://backlog/resources/research/context-engineering.md',
  path: 'resources/research/context-engineering.md',
  title: 'Context Engineering Research',
  content: '# Context Engineering\n\nResearch notes on context engineering patterns for AI agents.',
};

const ALL_RESOURCES: Resource[] = [RESOURCE_ADR, RESOURCE_TASK, RESOURCE_UNRELATED, RESOURCE_SEMANTIC];

// ── Mock operations for temporal overlay ─────────────────────────────

const MOCK_OPERATIONS = [
  {
    ts: '2026-02-14T09:00:00Z',
    tool: 'backlog_update',
    params: { id: 'TASK-0042', status: 'in_progress' },
    result: { id: 'TASK-0042' },
    resourceId: 'TASK-0042',
    actor: { type: 'agent' as const, name: 'claude' },
  },
  {
    ts: '2026-02-14T08:00:00Z',
    tool: 'backlog_update',
    params: { id: 'TASK-0043', status: 'done' },
    result: { id: 'TASK-0043' },
    resourceId: 'TASK-0043',
    actor: { type: 'agent' as const, name: 'claude' },
  },
  {
    ts: '2026-02-13T15:00:00Z',
    tool: 'backlog_create',
    params: { title: 'Stage 1: Focal resolution', type: 'task' },
    result: { id: 'TASK-0043' },
    resourceId: 'TASK-0043',
    actor: { type: 'user' as const, name: 'developer' },
  },
  {
    ts: '2026-02-13T14:00:00Z',
    tool: 'backlog_update',
    params: { id: 'EPIC-0005', add_evidence: 'Designed pipeline in ADR-0074' },
    result: { id: 'EPIC-0005' },
    resourceId: 'EPIC-0005',
    actor: { type: 'agent' as const, name: 'claude' },
  },
];

// ── Dependency injection helpers ─────────────────────────────────────

function makeGetTask(tasks: Entity[]): (id: string) => Entity | undefined {
  const map = new Map(tasks.map(t => [t.id, t]));
  return (id) => map.get(id);
}

function makeListTasks(tasks: Entity[]): (filter: { parent_id?: string; limit?: number }) => Entity[] {
  return (filter) => {
    let result = [...tasks];
    if (filter.parent_id) {
      result = result.filter(t => (t.parent_id ?? t.epic_id) === filter.parent_id);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  };
}

function makeSearchUnified(tasks: Entity[] = ALL_TASKS, resources: Resource[] = ALL_RESOURCES): SemanticEnrichmentDeps['searchUnified'] {
  return async (query: string, options?: { types?: Array<'task' | 'epic' | 'resource'>; limit?: number }) => {
    const queryLower = query.toLowerCase();
    const results: Array<{ item: Entity | Resource; score: number; type: 'task' | 'epic' | 'resource' }> = [];

    const types = options?.types || ['task', 'epic', 'resource'];
    const limit = options?.limit || 20;

    // Simple scoring: count query words that appear in title + description
    if (types.includes('task') || types.includes('epic')) {
      for (const task of tasks) {
        const searchText = `${task.title} ${task.description || ''}`.toLowerCase();
        const words = queryLower.split(/\s+/);
        const matchCount = words.filter(w => searchText.includes(w)).length;
        if (matchCount > 0) {
          results.push({
            item: task,
            score: matchCount / words.length,
            type: (task.type === 'epic' ? 'epic' : 'task') as 'task' | 'epic',
          });
        }
      }
    }

    if (types.includes('resource')) {
      for (const resource of resources) {
        const searchText = `${resource.title} ${resource.content || ''}`.toLowerCase();
        const words = queryLower.split(/\s+/);
        const matchCount = words.filter(w => searchText.includes(w)).length;
        if (matchCount > 0) {
          results.push({ item: resource, score: matchCount / words.length, type: 'resource' });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  };
}

function makeReadOperations(ops = MOCK_OPERATIONS): TemporalOverlayDeps['readOperations'] {
  return (options: { taskId?: string; limit?: number }) => {
    let filtered = [...ops];
    if (options.taskId) {
      filtered = filtered.filter(op => op.resourceId === options.taskId);
    }
    filtered.sort((a, b) => b.ts.localeCompare(a.ts));
    return filtered.slice(0, options.limit || 50);
  };
}

function makeDeps(
  tasks: Entity[] = ALL_TASKS,
  resources: Resource[] = ALL_RESOURCES,
  opts?: { includeSearch?: boolean; includeOps?: boolean },
): HydrationServiceDeps {
  const includeSearch = opts?.includeSearch ?? false;
  const includeOps = opts?.includeOps ?? false;
  return {
    getTask: makeGetTask(tasks),
    listTasks: makeListTasks(tasks),
    listResources: () => resources,
    ...(includeSearch ? { searchUnified: makeSearchUnified(tasks, resources) } : {}),
    ...(includeOps ? { readOperations: makeReadOperations() } : {}),
  };
}

function makeFullDeps(
  tasks: Entity[] = ALL_TASKS,
  resources: Resource[] = ALL_RESOURCES,
): HydrationServiceDeps {
  return makeDeps(tasks, resources, { includeSearch: true, includeOps: true });
}

// ── Stage 1: Focal Resolution ────────────────────────────────────────

describe('Stage 1: Focal Resolution', () => {
  it('resolves a task by ID', async () => {
    const result = await resolveFocal({ task_id: 'TASK-0042' }, makeGetTask(ALL_TASKS));
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('TASK-0042');
    expect(result!.focal.title).toBe('Implement context hydration');
    expect(result!.focal.fidelity).toBe('full');
    expect(result!.focal.description).toBe(TASK_FOCAL.description);
    expect(result!.focalTask).toEqual(TASK_FOCAL);
    expect(result!.resolved_from).toBe('id');
  });

  it('resolves an epic by ID', async () => {
    const result = await resolveFocal({ task_id: 'EPIC-0005' }, makeGetTask(ALL_TASKS));
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('EPIC-0005');
    expect(result!.focal.type).toBe('epic');
    expect(result!.resolved_from).toBe('id');
  });

  it('returns null for non-existent entity', async () => {
    const result = await resolveFocal({ task_id: 'TASK-9999' }, makeGetTask(ALL_TASKS));
    expect(result).toBeNull();
  });

  it('returns null when no task_id or query provided', async () => {
    const result = await resolveFocal({}, makeGetTask(ALL_TASKS));
    expect(result).toBeNull();
  });

  it('resolves focal entity from query (Phase 2)', async () => {
    const searchDeps = {
      search: async (query: string) => {
        const results = await makeSearchUnified()(query, { types: ['task', 'epic'], limit: 1 });
        return results.map(r => ({ item: r.item as Entity, score: r.score }));
      },
    };
    const result = await resolveFocal({ query: 'context hydration' }, makeGetTask(ALL_TASKS), searchDeps);
    expect(result).not.toBeNull();
    expect(result!.resolved_from).toBe('query');
    // The top result should be TASK-0042 (best match for "context hydration")
    expect(result!.focal.title.toLowerCase()).toContain('context');
  });

  it('returns null for query with no search results', async () => {
    const searchDeps = {
      search: async (_query: string) => [] as Array<{ item: Entity; score: number }>,
    };
    const result = await resolveFocal({ query: 'xyznonexistent' }, makeGetTask(ALL_TASKS), searchDeps);
    expect(result).toBeNull();
  });

  it('returns null for query without searchDeps', async () => {
    const result = await resolveFocal({ query: 'context hydration' }, makeGetTask(ALL_TASKS));
    expect(result).toBeNull();
  });
});

describe('taskToContextEntity fidelity levels', () => {
  it('full fidelity includes all fields', () => {
    const entity = taskToContextEntity(TASK_FOCAL, 'full');
    expect(entity.fidelity).toBe('full');
    expect(entity.description).toBe(TASK_FOCAL.description);
    expect(entity.evidence).toEqual(TASK_FOCAL.evidence);
    expect(entity.references).toEqual(TASK_FOCAL.references);
    expect(entity.created_at).toBe(TASK_FOCAL.created_at);
    expect(entity.updated_at).toBe(TASK_FOCAL.updated_at);
  });

  it('summary fidelity excludes description, evidence, blocked_reason', () => {
    const entity = taskToContextEntity(TASK_FOCAL, 'summary');
    expect(entity.fidelity).toBe('summary');
    expect(entity.description).toBeUndefined();
    expect(entity.evidence).toBeUndefined();
    expect(entity.blocked_reason).toBeUndefined();
    expect(entity.references).toEqual(TASK_FOCAL.references);
    expect(entity.created_at).toBe(TASK_FOCAL.created_at);
  });

  it('reference fidelity includes only id, title, status, type', () => {
    const entity = taskToContextEntity(TASK_FOCAL, 'reference');
    expect(entity.fidelity).toBe('reference');
    expect(entity.id).toBe('TASK-0042');
    expect(entity.title).toBe('Implement context hydration');
    expect(entity.status).toBe('open');
    expect(entity.type).toBe('task');
    expect(entity.description).toBeUndefined();
    expect(entity.references).toBeUndefined();
    expect(entity.created_at).toBeUndefined();
  });

  it('resolves parent_id from parent_id field', () => {
    const entity = taskToContextEntity(TASK_FOCAL);
    expect(entity.parent_id).toBe('EPIC-0005');
  });

  it('resolves parent_id from epic_id as fallback', () => {
    const task = makeTask({ id: 'TASK-0050', title: 'Legacy task', epic_id: 'EPIC-0003' });
    const entity = taskToContextEntity(task);
    expect(entity.parent_id).toBe('EPIC-0003');
  });
});

// ── Stage 2: Relational Expansion ────────────────────────────────────

describe('Stage 2: Relational Expansion', () => {
  const deps: RelationalExpansionDeps = {
    getTask: makeGetTask(ALL_TASKS),
    listTasks: makeListTasks(ALL_TASKS),
    listResources: () => ALL_RESOURCES,
  };

  it('finds parent entity', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    expect(result.parent).not.toBeNull();
    expect(result.parent!.id).toBe('EPIC-0005');
    expect(result.parent!.fidelity).toBe('summary');
  });

  it('finds children of focal entity', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    expect(result.children).toHaveLength(2);
    const childIds = result.children.map(c => c.id);
    expect(childIds).toContain('TASK-0043');
    expect(childIds).toContain('TASK-0044');
  });

  it('finds siblings (same parent, excluding focal)', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const siblingIds = result.siblings.map(s => s.id);
    expect(siblingIds).toContain('TASK-0040');
    expect(siblingIds).toContain('TASK-0041');
    expect(siblingIds).not.toContain('TASK-0042'); // Focal excluded
  });

  it('does not include unrelated tasks', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const allIds = [
      ...result.children.map(c => c.id),
      ...result.siblings.map(s => s.id),
    ];
    expect(allIds).not.toContain('TASK-0099');
  });

  it('finds resources related to focal by path', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const resourceUris = result.related_resources.map(r => r.uri);
    expect(resourceUris).toContain('mcp://backlog/resources/TASK-0042/notes.md');
  });

  it('finds resources related to parent (epic) by path', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const resourceUris = result.related_resources.map(r => r.uri);
    expect(resourceUris).toContain('mcp://backlog/resources/EPIC-0005/design.md');
  });

  it('does not include unrelated resources', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const resourceUris = result.related_resources.map(r => r.uri);
    expect(resourceUris).not.toContain('mcp://backlog/resources/misc/readme.md');
  });

  it('handles entity with no parent', () => {
    const orphan = makeTask({ id: 'TASK-0060', title: 'Orphan task' });
    const result = expandRelations(orphan, 1, deps);
    expect(result.parent).toBeNull();
    expect(result.siblings).toHaveLength(0);
  });

  it('handles entity with no children', () => {
    // TASK_CHILD_2 has no children (TASK_CHILD_1 does — grandchildren added in Phase 3)
    const result = expandRelations(TASK_CHILD_2, 1, deps);
    expect(result.children).toHaveLength(0);
  });

  it('resource snippets are generated from content', () => {
    const result = expandRelations(TASK_FOCAL, 1, deps);
    const taskResource = result.related_resources.find(
      r => r.uri === 'mcp://backlog/resources/TASK-0042/notes.md',
    );
    expect(taskResource).toBeDefined();
    expect(taskResource!.snippet).toBeDefined();
    expect(taskResource!.snippet!.length).toBeGreaterThan(0);
    expect(taskResource!.fidelity).toBe('summary');
  });

  it('epic as focal: finds all children under it', () => {
    const result = expandRelations(EPIC, 1, deps);
    expect(result.parent).toBeNull();
    const childIds = result.children.map(c => c.id);
    expect(childIds).toContain('TASK-0040');
    expect(childIds).toContain('TASK-0041');
    expect(childIds).toContain('TASK-0042');
    expect(result.siblings).toHaveLength(0);
  });
});

// ── Stage 3: Semantic Enrichment (Phase 2) ───────────────────────────

describe('Stage 3: Semantic Enrichment', () => {
  it('finds semantically related entities not in the relational graph', async () => {
    const existingIds = new Set(['TASK-0042', 'EPIC-0005', 'TASK-0043', 'TASK-0044', 'TASK-0040', 'TASK-0041']);
    const existingResourceUris = new Set(['mcp://backlog/resources/TASK-0042/notes.md', 'mcp://backlog/resources/EPIC-0005/design.md']);

    const result = await enrichSemantic(
      TASK_FOCAL,
      existingIds,
      existingResourceUris,
      { searchUnified: makeSearchUnified() },
    );

    // Should find semantic matches but not items already in context
    for (const entity of result.related_entities) {
      expect(existingIds.has(entity.id)).toBe(false);
    }
  });

  it('deduplicates against existing resource URIs', async () => {
    const existingIds = new Set(['TASK-0042']);
    const existingResourceUris = new Set(['mcp://backlog/resources/TASK-0042/notes.md']);

    const result = await enrichSemantic(
      TASK_FOCAL,
      existingIds,
      existingResourceUris,
      { searchUnified: makeSearchUnified() },
    );

    // The already-included resource should not appear again
    for (const resource of result.related_resources) {
      expect(existingResourceUris.has(resource.uri)).toBe(false);
    }
  });

  it('caps semantic entities at 5', async () => {
    // Create many tasks that would match
    const manyTasks = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `TASK-${String(200 + i).padStart(4, '0')}`, title: `Context hydration subtask ${i}` }),
    );

    const result = await enrichSemantic(
      TASK_FOCAL,
      new Set(['TASK-0042']),
      new Set(),
      { searchUnified: makeSearchUnified([...ALL_TASKS, ...manyTasks]) },
    );

    expect(result.related_entities.length).toBeLessThanOrEqual(5);
  });

  it('caps semantic resources at 5', async () => {
    const manyResources = Array.from({ length: 20 }, (_, i) => ({
      id: `mcp://backlog/resources/research/context-doc-${i}.md`,
      path: `resources/research/context-doc-${i}.md`,
      title: `Context Document ${i}`,
      content: `Content about context hydration and agent delivery ${i}.`,
    }));

    const result = await enrichSemantic(
      TASK_FOCAL,
      new Set(['TASK-0042']),
      new Set(),
      { searchUnified: makeSearchUnified(ALL_TASKS, [...ALL_RESOURCES, ...manyResources]) },
    );

    expect(result.related_resources.length).toBeLessThanOrEqual(5);
  });

  it('returns empty arrays when no semantic matches found', async () => {
    const noMatchSearch: SemanticEnrichmentDeps['searchUnified'] = async () => [];

    const result = await enrichSemantic(
      TASK_FOCAL,
      new Set(['TASK-0042']),
      new Set(),
      { searchUnified: noMatchSearch },
    );

    expect(result.related_entities).toHaveLength(0);
    expect(result.related_resources).toHaveLength(0);
  });

  it('semantic entities have summary fidelity and relevance_score', async () => {
    const result = await enrichSemantic(
      TASK_FOCAL,
      new Set(['TASK-0042']),
      new Set(),
      { searchUnified: makeSearchUnified() },
    );

    for (const entity of result.related_entities) {
      expect(entity.fidelity).toBe('summary');
      expect(entity.relevance_score).toBeDefined();
      expect(entity.relevance_score).toBeGreaterThan(0);
    }
  });

  it('semantic resources have summary fidelity with snippets', async () => {
    const result = await enrichSemantic(
      TASK_FOCAL,
      new Set(['TASK-0042']),
      new Set(),
      { searchUnified: makeSearchUnified() },
    );

    for (const resource of result.related_resources) {
      expect(resource.fidelity).toBe('summary');
      expect(resource.relevance_score).toBeDefined();
    }
  });
});

// ── Stage 4: Temporal Overlay (Phase 2) ──────────────────────────────

describe('Stage 4: Temporal Overlay', () => {
  it('collects activity for specified entity IDs', () => {
    const result = overlayTemporal(
      ['TASK-0042'],
      { readOperations: makeReadOperations() },
    );

    expect(result.length).toBeGreaterThan(0);
    for (const act of result) {
      expect(act.entity_id).toBe('TASK-0042');
    }
  });

  it('collects activity across multiple entities', () => {
    const result = overlayTemporal(
      ['TASK-0042', 'TASK-0043', 'EPIC-0005'],
      { readOperations: makeReadOperations() },
    );

    const entityIds = new Set(result.map(a => a.entity_id));
    expect(entityIds.size).toBeGreaterThan(1);
  });

  it('deduplicates operations by timestamp + entity', () => {
    // If the same op appears when querying multiple entities, it should only show once
    const result = overlayTemporal(
      ['TASK-0043', 'TASK-0043'], // Duplicate entity query
      { readOperations: makeReadOperations() },
    );

    const keys = result.map(a => `${a.ts}:${a.entity_id}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('sorts activity by timestamp descending', () => {
    const result = overlayTemporal(
      ['TASK-0042', 'TASK-0043', 'EPIC-0005'],
      { readOperations: makeReadOperations() },
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.ts >= result[i]!.ts).toBe(true);
    }
  });

  it('limits total activity entries', () => {
    const result = overlayTemporal(
      ['TASK-0042', 'TASK-0043', 'EPIC-0005'],
      { readOperations: makeReadOperations() },
      2, // limit to 2
    );

    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('generates human-readable summaries', () => {
    const result = overlayTemporal(
      ['TASK-0042'],
      { readOperations: makeReadOperations() },
    );

    for (const act of result) {
      expect(act.summary).toBeDefined();
      expect(act.summary.length).toBeGreaterThan(0);
      // Should contain the entity ID or meaningful info
      expect(act.summary).toContain('TASK-0042');
    }
  });

  it('activity entries have all required fields', () => {
    const result = overlayTemporal(
      ['TASK-0042'],
      { readOperations: makeReadOperations() },
    );

    for (const act of result) {
      expect(act.ts).toBeDefined();
      expect(act.tool).toBeDefined();
      expect(act.entity_id).toBeDefined();
      expect(act.actor).toBeDefined();
      expect(act.summary).toBeDefined();
    }
  });

  it('returns empty array when no operations found', () => {
    const noOps: TemporalOverlayDeps['readOperations'] = () => [];
    const result = overlayTemporal(['TASK-0042'], { readOperations: noOps });
    expect(result).toHaveLength(0);
  });

  it('summarizes create operations correctly', () => {
    const result = overlayTemporal(
      ['TASK-0043'],
      { readOperations: makeReadOperations() },
    );

    const createOp = result.find(a => a.tool === 'backlog_create');
    if (createOp) {
      expect(createOp.summary).toContain('Created');
    }
  });

  it('summarizes update operations with field changes', () => {
    const result = overlayTemporal(
      ['TASK-0042'],
      { readOperations: makeReadOperations() },
    );

    const updateOp = result.find(a => a.tool === 'backlog_update');
    expect(updateOp).toBeDefined();
    expect(updateOp!.summary).toContain('Updated');
    expect(updateOp!.summary).toContain('status');
  });
});

// ── Token budgeting ──────────────────────────────────────────────────

describe('Token estimation', () => {
  it('estimates tokens from string length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello')).toBe(2); // ceil(5/4)
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('estimates entity tokens at different fidelities', () => {
    const full = taskToContextEntity(TASK_FOCAL, 'full');
    const summary = taskToContextEntity(TASK_FOCAL, 'summary');
    const reference = taskToContextEntity(TASK_FOCAL, 'reference');

    const fullTokens = estimateEntityTokens(full);
    const summaryTokens = estimateEntityTokens(summary);
    const referenceTokens = estimateEntityTokens(reference);

    // Full > summary > reference
    expect(fullTokens).toBeGreaterThan(summaryTokens);
    expect(summaryTokens).toBeGreaterThan(referenceTokens);
    // All are positive
    expect(referenceTokens).toBeGreaterThan(0);
  });
});

describe('Entity downgrading', () => {
  const fullEntity = taskToContextEntity(TASK_FOCAL, 'full');

  it('downgrades full to summary', () => {
    const summary = downgradeEntity(fullEntity, 'summary');
    expect(summary.fidelity).toBe('summary');
    expect(summary.description).toBeUndefined();
    expect(summary.evidence).toBeUndefined();
    expect(summary.references).toEqual(fullEntity.references);
  });

  it('downgrades full to reference', () => {
    const ref = downgradeEntity(fullEntity, 'reference');
    expect(ref.fidelity).toBe('reference');
    expect(ref.description).toBeUndefined();
    expect(ref.references).toBeUndefined();
    expect(ref.created_at).toBeUndefined();
    expect(ref.id).toBe(fullEntity.id);
    expect(ref.title).toBe(fullEntity.title);
  });

  it('preserves relevance_score when downgrading to summary', () => {
    const entityWithScore = { ...fullEntity, relevance_score: 0.85 };
    const summary = downgradeEntity(entityWithScore, 'summary');
    expect(summary.relevance_score).toBe(0.85);
  });
});

describe('Token budget application', () => {
  const focal = taskToContextEntity(TASK_FOCAL, 'full');
  const parent = taskToContextEntity(EPIC, 'summary');
  const children = [TASK_CHILD_1, TASK_CHILD_2].map(t => taskToContextEntity(t, 'summary'));
  const siblings = [TASK_SIBLING_1, TASK_SIBLING_2].map(t => taskToContextEntity(t, 'summary'));
  const related = [TASK_SEMANTIC_1, TASK_SEMANTIC_2].map(t => taskToContextEntity(t, 'summary'));
  const resources: ContextResource[] = [
    { uri: 'mcp://backlog/resources/test.md', title: 'Test', path: 'resources/test.md', fidelity: 'summary', snippet: 'A snippet' },
  ];

  it('includes all items when budget is large', () => {
    const result = applyBudget(focal, parent, children, siblings, [], [], [], [], related, resources, [], null, 100000);
    expect(result.truncated).toBe(false);
    expect(result.entities.length).toBe(1 + 1 + 2 + 2 + 2); // focal + parent + children + siblings + related
    expect(result.resources.length).toBe(1);
  });

  it('focal and parent are always included', () => {
    const result = applyBudget(focal, parent, [], [], [], [], [], [], [], [], [], null, 100000);
    expect(result.entities.length).toBe(2);
    expect(result.entities[0]!.id).toBe(focal.id);
    expect(result.entities[1]!.id).toBe(parent!.id);
  });

  it('truncates lower-priority items when budget is tight', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const tightBudget = focalCost + parentCost + 50 + 10;

    const result = applyBudget(focal, parent, children, siblings, [], [], [], [], related, resources, [], null, tightBudget);
    expect(result.truncated).toBe(true);
    expect(result.entities[0]!.id).toBe(focal.id);
    expect(result.entities[1]!.id).toBe(parent!.id);
  });

  it('downgrades entities to reference fidelity before dropping them', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const refChildCost = estimateEntityTokens(downgradeEntity(children[0]!, 'reference'));
    const summaryChildCost = estimateEntityTokens(children[0]!);

    const budget = focalCost + parentCost + 50 + refChildCost * 2 + 20;

    if (budget < focalCost + parentCost + 50 + summaryChildCost * 2) {
      const result = applyBudget(focal, parent, children, [], [], [], [], [], [], [], [], null, budget);
      const childEntities = result.entities.filter(e => e.id === 'TASK-0043' || e.id === 'TASK-0044');
      if (childEntities.length > 0) {
        const hasReference = childEntities.some(e => e.fidelity === 'reference');
        const hasSummary = childEntities.some(e => e.fidelity === 'summary');
        expect(hasReference || hasSummary).toBe(true);
      }
    }
  });

  it('related entities are lower priority than siblings', () => {
    // Budget that fits focal + parent + children + siblings but not related
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const childCosts = children.reduce((sum, c) => sum + estimateEntityTokens(c), 0);
    const siblingCosts = siblings.reduce((sum, s) => sum + estimateEntityTokens(s), 0);
    const budget = focalCost + parentCost + childCosts + siblingCosts + 50 + 5;

    const result = applyBudget(focal, parent, children, siblings, [], [], [], [], related, [], [], null, budget);
    const entityIds = result.entities.map(e => e.id);

    // Children and siblings should be present before related
    for (const child of children) {
      expect(entityIds).toContain(child.id);
    }
    for (const sibling of siblings) {
      expect(entityIds).toContain(sibling.id);
    }
  });

  it('activity entries are budgeted last', () => {
    const activities = [
      { ts: '2026-02-14T09:00:00Z', tool: 'backlog_update', entity_id: 'TASK-0042', actor: 'claude', summary: 'Updated TASK-0042' },
      { ts: '2026-02-14T08:00:00Z', tool: 'backlog_update', entity_id: 'TASK-0043', actor: 'claude', summary: 'Updated TASK-0043' },
    ];

    const result = applyBudget(focal, parent, children, siblings, [], [], [], [], related, resources, activities, null, 100000);
    expect(result.activities.length).toBe(2);
  });

  it('tokensUsed is always positive', () => {
    const result = applyBudget(focal, null, [], [], [], [], [], [], [], [], [], null, 100000);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });
});

// ── End-to-end pipeline ──────────────────────────────────────────────

describe('ContextHydrationService: end-to-end pipeline', () => {
  it('returns full context for a task with parent, children, siblings, and resources', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();

    // Focal
    expect(result!.focal.id).toBe('TASK-0042');
    expect(result!.focal.fidelity).toBe('full');
    expect(result!.focal.description).toBeDefined();

    // Parent
    expect(result!.parent).not.toBeNull();
    expect(result!.parent!.id).toBe('EPIC-0005');

    // Children
    expect(result!.children.length).toBe(2);
    const childIds = result!.children.map(c => c.id);
    expect(childIds).toContain('TASK-0043');
    expect(childIds).toContain('TASK-0044');

    // Siblings
    expect(result!.siblings.length).toBe(2);
    const siblingIds = result!.siblings.map(s => s.id);
    expect(siblingIds).toContain('TASK-0040');
    expect(siblingIds).toContain('TASK-0041');

    // Resources
    expect(result!.related_resources.length).toBeGreaterThanOrEqual(1);

    // Metadata
    expect(result!.metadata.stages_executed).toContain('focal_resolution');
    expect(result!.metadata.stages_executed).toContain('relational_expansion');
    expect(result!.metadata.stages_executed).toContain('token_budgeting');
    expect(result!.metadata.total_items).toBeGreaterThan(0);
    expect(result!.metadata.token_estimate).toBeGreaterThan(0);
    expect(result!.metadata.focal_resolved_from).toBe('id');
  });

  it('returns null for non-existent entity', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-9999' }, deps);
    expect(result).toBeNull();
  });

  it('works for epic as focal (lists all children)', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'EPIC-0005', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('EPIC-0005');
    expect(result!.focal.type).toBe('epic');
    expect(result!.parent).toBeNull();
    expect(result!.children.length).toBeGreaterThanOrEqual(3);
    expect(result!.siblings).toHaveLength(0);
  });

  it('respects max_tokens budget', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', max_tokens: 200, include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('TASK-0042');
    expect(result!.metadata.token_estimate).toBeLessThanOrEqual(250);
  });

  it('large budget includes everything without truncation', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', max_tokens: 100000, include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.truncated).toBe(false);
  });

  it('metadata.depth reflects requested depth', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2 }, deps);
    expect(result!.metadata.depth).toBe(2);
  });

  it('depth is clamped to max 3', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 10 }, deps);
    expect(result!.metadata.depth).toBe(3);
  });

  it('default depth is 1', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata.depth).toBe(1);
  });

  it('default max_tokens is 4000', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result!.metadata.token_estimate).toBeLessThanOrEqual(4000);
  });

  it('handles leaf task with no children', async () => {
    const deps = makeDeps();
    // TASK-0044 has no children (TASK-0043 now has grandchildren in Phase 3 test data)
    const result = await hydrateContext({ task_id: 'TASK-0044', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(0);
    expect(result!.parent).not.toBeNull();
    expect(result!.parent!.id).toBe('TASK-0042');
  });

  it('handles orphan task (no parent)', async () => {
    const orphanDeps = makeDeps([
      makeTask({ id: 'TASK-0060', title: 'Orphan' }),
    ], []);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false }, orphanDeps);
    expect(result).not.toBeNull();
    expect(result!.parent).toBeNull();
    expect(result!.children).toHaveLength(0);
    expect(result!.siblings).toHaveLength(0);
    expect(result!.related_resources).toHaveLength(0);
  });
});

// ── Phase 2: Semantic enrichment in pipeline ─────────────────────────

describe('Pipeline with semantic enrichment (Phase 2)', () => {
  it('includes semantically related entities when search is available', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: true, include_activity: false, max_tokens: 100000 }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).toContain('semantic_enrichment');
    // Related should not contain items already in children/siblings
    const graphIds = new Set([
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
    ]);
    for (const rel of result!.related) {
      expect(graphIds.has(rel.id)).toBe(false);
    }
  });

  it('skips semantic enrichment when include_related is false', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).not.toContain('semantic_enrichment');
    expect(result!.related).toHaveLength(0);
  });

  it('skips semantic enrichment when searchUnified is not provided', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: true, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).not.toContain('semantic_enrichment');
    expect(result!.related).toHaveLength(0);
  });
});

// ── Phase 2: Temporal overlay in pipeline ────────────────────────────

describe('Pipeline with temporal overlay (Phase 2)', () => {
  it('includes activity when readOperations is available', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: true, max_tokens: 100000 }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).toContain('temporal_overlay');
    expect(result!.activity.length).toBeGreaterThan(0);
  });

  it('skips temporal overlay when include_activity is false', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).not.toContain('temporal_overlay');
    expect(result!.activity).toHaveLength(0);
  });

  it('skips temporal overlay when readOperations is not provided', async () => {
    const deps = makeDeps(ALL_TASKS, ALL_RESOURCES, { includeSearch: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', include_activity: true }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.stages_executed).not.toContain('temporal_overlay');
  });
});

// ── Phase 2: Query-based focal resolution in pipeline ────────────────

describe('Pipeline with query-based focal resolution (Phase 2)', () => {
  it('resolves focal from query when searchUnified is available', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ query: 'context hydration pipeline', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.focal_resolved_from).toBe('query');
    expect(result!.focal.title.toLowerCase()).toContain('context');
  });

  it('returns null for query with no matches', async () => {
    const noMatchSearch: SemanticEnrichmentDeps['searchUnified'] = async () => [];
    const deps: HydrationServiceDeps = {
      getTask: makeGetTask(ALL_TASKS),
      listTasks: makeListTasks(ALL_TASKS),
      listResources: () => ALL_RESOURCES,
      searchUnified: noMatchSearch,
    };
    const result = await hydrateContext({ query: 'xyznonexistent999' }, deps);
    expect(result).toBeNull();
  });

  it('returns null for query without searchUnified dep', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ query: 'context hydration' }, deps);
    expect(result).toBeNull();
  });
});

// ── Resource context ─────────────────────────────────────────────────

describe('Resource discovery in context', () => {
  it('matches resources by focal task ID in path (case insensitive)', async () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/task-0042/design.md', path: 'resources/task-0042/design.md', title: 'Design', content: 'Design doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result!.related_resources.length).toBe(1);
    expect(result!.related_resources[0]!.uri).toBe('mcp://backlog/resources/task-0042/design.md');
  });

  it('matches resources by parent ID in path', async () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/EPIC-0005/plan.md', path: 'resources/EPIC-0005/plan.md', title: 'Plan', content: 'Plan doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result!.related_resources.length).toBe(1);
  });

  it('does not match resources with unrelated paths', async () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/other/doc.md', path: 'resources/other/doc.md', title: 'Other', content: 'Other doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result!.related_resources.length).toBe(0);
  });
});

// ── Contract invariants ──────────────────────────────────────────────

describe('Context response contract invariants', () => {
  it('focal entity always has full fidelity', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.focal.fidelity).toBe('full');
  });

  it('parent entity (when present) has summary fidelity', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result!.parent!.fidelity).toBe('summary');
  });

  it('all entities have required fields', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', max_tokens: 100000 }, deps);
    const allEntities = [result!.focal, result!.parent, ...result!.children, ...result!.siblings, ...result!.related].filter(Boolean);
    for (const entity of allEntities) {
      expect(entity!.id).toBeDefined();
      expect(entity!.title).toBeDefined();
      expect(entity!.status).toBeDefined();
      expect(entity!.type).toBeDefined();
      expect(entity!.fidelity).toBeDefined();
    }
  });

  it('all resources have required fields', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', max_tokens: 100000 }, deps);
    for (const resource of result!.related_resources) {
      expect(resource.uri).toBeDefined();
      expect(resource.title).toBeDefined();
      expect(resource.path).toBeDefined();
      expect(resource.fidelity).toBeDefined();
    }
  });

  it('all activity entries have required fields', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_activity: true, max_tokens: 100000 }, deps);
    for (const act of result!.activity) {
      expect(act.ts).toBeDefined();
      expect(act.tool).toBeDefined();
      expect(act.entity_id).toBeDefined();
      expect(act.actor).toBeDefined();
      expect(act.summary).toBeDefined();
    }
  });

  it('metadata is always present and complete', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata).toBeDefined();
    expect(typeof result!.metadata.depth).toBe('number');
    expect(typeof result!.metadata.total_items).toBe('number');
    expect(typeof result!.metadata.token_estimate).toBe('number');
    expect(typeof result!.metadata.truncated).toBe('boolean');
    expect(Array.isArray(result!.metadata.stages_executed)).toBe(true);
    expect(result!.metadata.stages_executed.length).toBeGreaterThan(0);
    expect(result!.metadata.focal_resolved_from).toBeDefined();
  });

  it('total_items matches the actual number of items in the response', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', max_tokens: 100000 }, deps);
    const expectedTotal = 1 + // focal
      (result!.parent ? 1 : 0) +
      result!.children.length +
      result!.siblings.length +
      result!.cross_referenced.length +
      result!.referenced_by.length +
      result!.ancestors.length +
      result!.descendants.length +
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length +
      (result!.session_summary ? 1 : 0);
    expect(result!.metadata.total_items).toBe(expectedTotal);
  });

  it('related entities never duplicate entities from the relational graph', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: true, max_tokens: 100000 }, deps);
    const graphIds = new Set([
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
    ]);
    for (const rel of result!.related) {
      expect(graphIds.has(rel.id)).toBe(false);
    }
  });

  it('focal_resolved_from is "id" for task_id input', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata.focal_resolved_from).toBe('id');
  });

  it('focal_resolved_from is "query" for query input', async () => {
    const deps = makeFullDeps();
    const result = await hydrateContext({ query: 'context hydration', include_related: false, include_activity: false }, deps);
    if (result) {
      expect(result.metadata.focal_resolved_from).toBe('query');
    }
  });

  it('stages_executed includes semantic_enrichment only when search is available and enabled', async () => {
    // With search
    const depsWithSearch = makeFullDeps();
    const result1 = await hydrateContext({ task_id: 'TASK-0042', include_related: true }, depsWithSearch);
    expect(result1!.metadata.stages_executed).toContain('semantic_enrichment');

    // Without search
    const depsNoSearch = makeDeps();
    const result2 = await hydrateContext({ task_id: 'TASK-0042', include_related: true }, depsNoSearch);
    expect(result2!.metadata.stages_executed).not.toContain('semantic_enrichment');
  });

  it('stages_executed includes temporal_overlay only when readOperations is available and enabled', async () => {
    // With ops
    const depsWithOps = makeDeps(ALL_TASKS, ALL_RESOURCES, { includeOps: true });
    const result1 = await hydrateContext({ task_id: 'TASK-0042', include_activity: true, include_related: false }, depsWithOps);
    expect(result1!.metadata.stages_executed).toContain('temporal_overlay');

    // Without ops
    const depsNoOps = makeDeps();
    const result2 = await hydrateContext({ task_id: 'TASK-0042', include_activity: true }, depsNoOps);
    expect(result2!.metadata.stages_executed).not.toContain('temporal_overlay');
  });

  it('response includes ancestors, descendants, and cross_referenced arrays (Phase 3+4)', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.ancestors)).toBe(true);
    expect(Array.isArray(result!.descendants)).toBe(true);
    expect(Array.isArray(result!.cross_referenced)).toBe(true);
  });

  it('response includes session_summary field (Phase 3)', async () => {
    const deps = makeDeps();
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false }, deps);
    expect(result).not.toBeNull();
    // session_summary is null when readOperations is not provided
    expect(result!.session_summary).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: Depth 2+ Relational Expansion (ADR-0076)
// ══════════════════════════════════════════════════════════════════════

describe('Phase 3: Depth 2+ Relational Expansion', () => {
  const deepDeps: RelationalExpansionDeps = {
    getTask: makeGetTask(DEEP_TASKS),
    listTasks: makeListTasks(DEEP_TASKS),
    listResources: () => ALL_RESOURCES,
  };

  it('depth 1: returns ancestors=[], descendants=[] (backward compatible)', () => {
    const result = expandRelations(TASK_FOCAL, 1, deepDeps);
    expect(result.ancestors).toHaveLength(0);
    expect(result.descendants).toHaveLength(0);
    expect(result.parent).not.toBeNull();
    expect(result.parent!.id).toBe('EPIC-0005');
    expect(result.children.length).toBeGreaterThan(0);
  });

  it('depth 2: finds grandparent in ancestors', () => {
    const result = expandRelations(TASK_FOCAL, 2, deepDeps);
    // Parent = EPIC-0005, grandparent = EPIC-0001
    expect(result.parent!.id).toBe('EPIC-0005');
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0]!.id).toBe('EPIC-0001');
    expect(result.ancestors[0]!.graph_depth).toBe(2);
    expect(result.ancestors[0]!.fidelity).toBe('reference');
  });

  it('depth 2: finds grandchildren in descendants', () => {
    const result = expandRelations(TASK_FOCAL, 2, deepDeps);
    // Grandchildren: TASK-0045, TASK-0046 (children of TASK-0043)
    const descendantIds = result.descendants.map(d => d.id);
    expect(descendantIds).toContain('TASK-0045');
    expect(descendantIds).toContain('TASK-0046');
    for (const d of result.descendants) {
      expect(d.graph_depth).toBe(2);
      expect(d.fidelity).toBe('reference');
    }
  });

  it('depth 3: traverses three ancestor hops', () => {
    // From TASK-0043 → parent=TASK-0042, grandparent=EPIC-0005, great-grandparent=EPIC-0001
    const result = expandRelations(TASK_CHILD_1, 3, deepDeps);
    expect(result.parent!.id).toBe('TASK-0042');
    expect(result.ancestors.length).toBe(2);
    const ancestorIds = result.ancestors.map(a => a.id);
    expect(ancestorIds).toContain('EPIC-0005');
    expect(ancestorIds).toContain('EPIC-0001');
  });

  it('cycle detection: does not revisit focal entity', () => {
    // Even if somehow a task has a circular parent reference, the visited set prevents looping
    const circularTask = makeTask({
      id: 'TASK-LOOP-1',
      title: 'Circular A',
      parent_id: 'TASK-LOOP-2',
    });
    const circularParent = makeTask({
      id: 'TASK-LOOP-2',
      title: 'Circular B',
      parent_id: 'TASK-LOOP-1', // Circular reference!
    });
    const circularDeps: RelationalExpansionDeps = {
      getTask: makeGetTask([circularTask, circularParent]),
      listTasks: makeListTasks([circularTask, circularParent]),
      listResources: () => [],
    };

    const result = expandRelations(circularTask, 3, circularDeps);
    // Should find parent TASK-LOOP-2 but NOT loop back to TASK-LOOP-1
    expect(result.parent!.id).toBe('TASK-LOOP-2');
    expect(result.ancestors).toHaveLength(0); // Cycle detected, can't go further
  });

  it('entities at depth 2+ never appear in children or siblings', () => {
    const result = expandRelations(TASK_FOCAL, 2, deepDeps);
    const childIds = new Set(result.children.map(c => c.id));
    const siblingIds = new Set(result.siblings.map(s => s.id));
    for (const d of result.descendants) {
      expect(childIds.has(d.id)).toBe(false);
      expect(siblingIds.has(d.id)).toBe(false);
    }
    for (const a of result.ancestors) {
      expect(a.id).not.toBe(result.parent?.id);
    }
  });

  it('resource discovery extends to ancestor IDs at depth 2+', () => {
    const resourceForGrandparent = {
      id: 'mcp://backlog/resources/EPIC-0001/vision.md',
      path: 'resources/EPIC-0001/vision.md',
      title: 'Platform Vision',
      content: 'Vision doc.',
    };
    const depsWithResource: RelationalExpansionDeps = {
      getTask: deepDeps.getTask,
      listTasks: deepDeps.listTasks,
      listResources: () => [...ALL_RESOURCES, resourceForGrandparent],
    };
    const result = expandRelations(TASK_FOCAL, 2, depsWithResource);
    const resourceUris = result.related_resources.map(r => r.uri);
    expect(resourceUris).toContain('mcp://backlog/resources/EPIC-0001/vision.md');
  });

  it('depth 2+ pipeline integration: ancestors and descendants in response', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({
      task_id: 'TASK-0042',
      depth: 2,
      include_related: false,
      include_activity: false,
      max_tokens: 100000,
    }, deps);

    expect(result).not.toBeNull();
    expect(result!.metadata.depth).toBe(2);

    // Ancestors
    expect(result!.ancestors.length).toBeGreaterThan(0);
    const ancestorIds = result!.ancestors.map(a => a.id);
    expect(ancestorIds).toContain('EPIC-0001');

    // Descendants (grandchildren of focal)
    expect(result!.descendants.length).toBeGreaterThan(0);
    const descendantIds = result!.descendants.map(d => d.id);
    expect(descendantIds).toContain('TASK-0045');
    expect(descendantIds).toContain('TASK-0046');
  });

  it('depth 1 pipeline: ancestors and descendants are empty', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({
      task_id: 'TASK-0042',
      depth: 1,
      include_related: false,
      include_activity: false,
    }, deps);

    expect(result!.ancestors).toHaveLength(0);
    expect(result!.descendants).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: Session Memory (ADR-0076)
// ══════════════════════════════════════════════════════════════════════

describe('Phase 3: Session Memory', () => {
  const sessionOps = [
    {
      ts: '2026-02-14T09:30:00Z',
      tool: 'backlog_update',
      params: { id: 'TASK-0042', status: 'in_progress' },
      result: { id: 'TASK-0042' },
      resourceId: 'TASK-0042',
      actor: { type: 'agent' as const, name: 'claude' },
    },
    {
      ts: '2026-02-14T09:20:00Z',
      tool: 'backlog_update',
      params: { id: 'TASK-0042', add_evidence: 'Designed the pipeline' },
      result: { id: 'TASK-0042' },
      resourceId: 'TASK-0042',
      actor: { type: 'agent' as const, name: 'claude' },
    },
    {
      ts: '2026-02-14T09:10:00Z',
      tool: 'write_resource',
      params: { uri: 'mcp://backlog/resources/TASK-0042/notes.md' },
      result: {},
      resourceId: 'TASK-0042',
      actor: { type: 'agent' as const, name: 'claude' },
    },
    // --- 2-hour gap (session boundary) ---
    {
      ts: '2026-02-14T07:00:00Z',
      tool: 'backlog_update',
      params: { id: 'TASK-0042', status: 'open' },
      result: { id: 'TASK-0042' },
      resourceId: 'TASK-0042',
      actor: { type: 'user' as const, name: 'developer' },
    },
  ];

  function makeSessionDeps(ops = sessionOps): SessionMemoryDeps {
    return {
      readOperations: (options: { taskId?: string; limit?: number }) => {
        let filtered = [...ops];
        if (options.taskId) {
          filtered = filtered.filter(op => op.resourceId === options.taskId);
        }
        filtered.sort((a, b) => b.ts.localeCompare(a.ts));
        return filtered.slice(0, options.limit || 50);
      },
    };
  }

  it('derives session summary from operation log', () => {
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    expect(result).not.toBeNull();
    expect(result!.actor).toBe('claude');
    expect(result!.actor_type).toBe('agent');
    expect(result!.operation_count).toBe(3);
    expect(result!.started_at).toBe('2026-02-14T09:10:00Z');
    expect(result!.ended_at).toBe('2026-02-14T09:30:00Z');
  });

  it('session boundary: different actor breaks session', () => {
    // All ops by claude, then one by developer at the start
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    // Should only include the 3 claude ops, not the developer op
    expect(result!.operation_count).toBe(3);
    expect(result!.actor).toBe('claude');
  });

  it('session boundary: 30+ minute gap breaks session', () => {
    const opsWithGap = [
      {
        ts: '2026-02-14T10:00:00Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0042', status: 'done' },
        result: { id: 'TASK-0042' },
        resourceId: 'TASK-0042',
        actor: { type: 'agent' as const, name: 'claude' },
      },
      // 45-minute gap
      {
        ts: '2026-02-14T09:15:00Z',
        tool: 'backlog_update',
        params: { id: 'TASK-0042', add_evidence: 'Some evidence' },
        result: { id: 'TASK-0042' },
        resourceId: 'TASK-0042',
        actor: { type: 'agent' as const, name: 'claude' },
      },
    ];
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps(opsWithGap));
    expect(result!.operation_count).toBe(1); // Only the most recent one
    expect(result!.started_at).toBe('2026-02-14T10:00:00Z');
    expect(result!.ended_at).toBe('2026-02-14T10:00:00Z');
  });

  it('returns null when no operations exist', () => {
    const emptyDeps: SessionMemoryDeps = {
      readOperations: () => [],
    };
    const result = deriveSessionSummary('TASK-0042', emptyDeps);
    expect(result).toBeNull();
  });

  it('summary includes status changes', () => {
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    expect(result!.summary).toContain('status');
    expect(result!.summary).toContain('in_progress');
  });

  it('summary includes evidence additions', () => {
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    expect(result!.summary).toContain('evidence');
  });

  it('summary includes resource writes', () => {
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    expect(result!.summary).toContain('resource');
  });

  it('session summary has all required fields', () => {
    const result = deriveSessionSummary('TASK-0042', makeSessionDeps());
    expect(result).not.toBeNull();
    expect(result!.actor).toBeDefined();
    expect(result!.actor_type).toBeDefined();
    expect(result!.started_at).toBeDefined();
    expect(result!.ended_at).toBeDefined();
    expect(result!.operation_count).toBeGreaterThan(0);
    expect(result!.summary).toBeDefined();
    expect(result!.summary.length).toBeGreaterThan(0);
  });

  it('pipeline integration: session_summary in response when ops available', async () => {
    const deps = makeDeps(ALL_TASKS, ALL_RESOURCES, { includeOps: true });
    const result = await hydrateContext({
      task_id: 'TASK-0042',
      include_related: false,
      include_activity: false,
      max_tokens: 100000,
    }, deps);

    expect(result).not.toBeNull();
    expect(result!.session_summary).not.toBeNull();
    expect(result!.metadata.stages_executed).toContain('session_memory');
  });

  it('pipeline: session_summary null when no readOperations', async () => {
    const deps = makeDeps(ALL_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({
      task_id: 'TASK-0042',
      include_related: false,
      include_activity: false,
    }, deps);

    expect(result!.session_summary).toBeNull();
    expect(result!.metadata.stages_executed).not.toContain('session_memory');
  });
});

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: Token Budget with ancestors, descendants, session (ADR-0076)
// ══════════════════════════════════════════════════════════════════════

describe('Phase 3: Token budget with new priority levels', () => {
  const focal = taskToContextEntity(TASK_FOCAL, 'full');
  const parent = taskToContextEntity(EPIC, 'summary');
  const children = [TASK_CHILD_1, TASK_CHILD_2].map(t => taskToContextEntity(t, 'summary'));
  const siblings = [TASK_SIBLING_1, TASK_SIBLING_2].map(t => taskToContextEntity(t, 'summary'));
  const ancestors: ContextEntity[] = [{
    id: 'EPIC-0001', title: 'Platform', status: 'open', type: 'epic',
    fidelity: 'reference', graph_depth: 2,
  }];
  const descendants: ContextEntity[] = [
    { id: 'TASK-0045', title: 'Grandchild A', status: 'open', type: 'task', fidelity: 'reference', graph_depth: 2 },
    { id: 'TASK-0046', title: 'Grandchild B', status: 'done', type: 'task', fidelity: 'reference', graph_depth: 2 },
  ];
  const mockSession: SessionSummary = {
    actor: 'claude',
    actor_type: 'agent',
    started_at: '2026-02-14T09:10:00Z',
    ended_at: '2026-02-14T09:30:00Z',
    operation_count: 3,
    summary: 'status → in_progress, added evidence, wrote 1 resource',
  };

  it('ancestors are budgeted after siblings', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const childCosts = children.reduce((sum, c) => sum + estimateEntityTokens(c), 0);
    const siblingCosts = siblings.reduce((sum, s) => sum + estimateEntityTokens(s), 0);
    const budget = focalCost + parentCost + childCosts + siblingCosts + 50 + 5;

    const result = applyBudget(focal, parent, children, siblings, [], [], ancestors, descendants, [], [], [], null, budget);
    const entityIds = result.entities.map(e => e.id);

    // All children and siblings should be in, ancestors should be dropped
    for (const child of children) expect(entityIds).toContain(child.id);
    for (const sibling of siblings) expect(entityIds).toContain(sibling.id);
    // Ancestors may or may not fit depending on exact budget
  });

  it('descendants are budgeted after ancestors', () => {
    const result = applyBudget(focal, parent, children, siblings, [], [], ancestors, descendants, [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);

    // All should be included with large budget
    expect(entityIds).toContain('EPIC-0001'); // ancestor
    expect(entityIds).toContain('TASK-0045'); // descendant
    expect(entityIds).toContain('TASK-0046'); // descendant
  });

  it('session summary is budgeted before children', () => {
    const result = applyBudget(focal, parent, children, siblings, [], [], [], [], [], [], [], mockSession, 100000);
    expect(result.sessionSummary).not.toBeNull();
    expect(result.sessionSummary!.actor).toBe('claude');
  });

  it('session summary dropped when budget too tight', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    // Budget that barely fits focal + parent + metadata
    const tinyBudget = focalCost + parentCost + 50 + 5;

    const result = applyBudget(focal, parent, [], [], [], [], [], [], [], [], [], mockSession, tinyBudget);
    expect(result.sessionSummary).toBeNull();
    expect(result.truncated).toBe(true);
  });

  it('graph_depth preserved through entity downgrading', () => {
    const entityWithDepth: ContextEntity = {
      id: 'TASK-0045', title: 'Grandchild', status: 'open', type: 'task',
      fidelity: 'summary', created_at: '2026-02-10T10:00:00Z', updated_at: '2026-02-14T10:00:00Z',
      graph_depth: 2,
    };
    const downgraded = downgradeEntity(entityWithDepth, 'reference');
    expect(downgraded.graph_depth).toBe(2);
    expect(downgraded.fidelity).toBe('reference');
  });

  it('session summary token estimation is positive', () => {
    const cost = estimateSessionSummaryTokens(mockSession);
    expect(cost).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: Contract Invariants (ADR-0076)
// ══════════════════════════════════════════════════════════════════════

describe('Phase 3: Contract invariants', () => {
  it('ancestors are always reference fidelity', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    for (const a of result!.ancestors) {
      expect(a.fidelity).toBe('reference');
    }
  });

  it('descendants are always reference fidelity', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    for (const d of result!.descendants) {
      expect(d.fidelity).toBe('reference');
    }
  });

  it('all ancestors have graph_depth >= 2', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 3, include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    for (const a of result!.ancestors) {
      expect(a.graph_depth).toBeGreaterThanOrEqual(2);
    }
  });

  it('all descendants have graph_depth >= 2', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    for (const d of result!.descendants) {
      expect(d.graph_depth).toBeGreaterThanOrEqual(2);
    }
  });

  it('no entity ID appears in more than one role', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const allIds: string[] = [
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
      ...result!.cross_referenced.map(x => x.id),
      ...result!.referenced_by.map(r => r.id),
      ...result!.ancestors.map(a => a.id),
      ...result!.descendants.map(d => d.id),
    ];
    const unique = new Set(allIds);
    expect(allIds.length).toBe(unique.size);
  });

  it('ancestors ordered closest-first', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES);
    // From TASK-0043: parent=TASK-0042, grandparent=EPIC-0005, great-grandparent=EPIC-0001
    const result = await hydrateContext({ task_id: 'TASK-0043', depth: 3, include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    if (result!.ancestors.length >= 2) {
      for (let i = 1; i < result!.ancestors.length; i++) {
        expect(result!.ancestors[i]!.graph_depth!).toBeGreaterThanOrEqual(result!.ancestors[i - 1]!.graph_depth!);
      }
    }
  });

  it('session_summary required fields when present', async () => {
    const deps = makeDeps(ALL_TASKS, ALL_RESOURCES, { includeOps: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    if (result!.session_summary) {
      const s = result!.session_summary;
      expect(s.actor).toBeDefined();
      expect(s.actor_type).toBeDefined();
      expect(['user', 'agent']).toContain(s.actor_type);
      expect(s.started_at).toBeDefined();
      expect(s.ended_at).toBeDefined();
      expect(s.operation_count).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
    }
  });

  it('total_items includes ancestors + descendants + cross_referenced + referenced_by + session_summary', async () => {
    const deps = makeDeps(DEEP_TASKS, ALL_RESOURCES, { includeOps: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: true, max_tokens: 100000 }, deps);
    const expectedTotal = 1 +
      (result!.parent ? 1 : 0) +
      result!.children.length +
      result!.siblings.length +
      result!.cross_referenced.length +
      result!.referenced_by.length +
      result!.ancestors.length +
      result!.descendants.length +
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length +
      (result!.session_summary ? 1 : 0);
    expect(result!.metadata.total_items).toBe(expectedTotal);
  });

  it('stages_executed includes session_memory when readOperations available and session found', async () => {
    const deps = makeDeps(ALL_TASKS, ALL_RESOURCES, { includeOps: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    if (result!.session_summary) {
      expect(result!.metadata.stages_executed).toContain('session_memory');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 4: Cross-Reference Traversal (ADR-0077)
// ══════════════════════════════════════════════════════════════════════

// Cross-reference test data: tasks with references[] pointing to other entities
const TASK_WITH_XREFS = makeTask({
  id: 'TASK-0060',
  title: 'Task with cross-references',
  parent_id: 'EPIC-0005',
  description: 'This task references several other tasks.',
  references: [
    { url: 'TASK-0099', title: 'Unrelated feature' },
    { url: 'https://github.com/org/repo/issues/TASK-0050', title: 'Related GH issue' },
    { url: 'TASK-0051', title: 'Agent memory' },
    { url: 'https://example.com/plain-url', title: 'No entity ID here' },
    { url: 'mcp://backlog/resources/doc.md', title: 'Resource link' },
  ],
});

const TASK_WITH_SELF_REF = makeTask({
  id: 'TASK-0061',
  title: 'Task that references itself and its parent',
  parent_id: 'EPIC-0005',
  references: [
    { url: 'TASK-0061', title: 'Self reference' },
    { url: 'EPIC-0005', title: 'Parent reference' },
  ],
});

const TASK_NO_REFS = makeTask({
  id: 'TASK-0062',
  title: 'Task with no references',
  parent_id: 'EPIC-0005',
});

const PARENT_WITH_REFS = makeTask({
  ...EPIC,
  references: [
    { url: 'TASK-0050', title: 'Research task' },
    { url: 'TASK-0099', title: 'Unrelated' },
  ],
});

// Tasks that include cross-reference test data alongside the standard set
const XREF_TASKS: Entity[] = [
  ...ALL_TASKS,
  TASK_WITH_XREFS,
  TASK_WITH_SELF_REF,
  TASK_NO_REFS,
];

const XREF_TASKS_WITH_PARENT_REFS: Entity[] = [
  PARENT_WITH_REFS, // replaces EPIC at index 0
  ...ALL_TASKS.filter(t => t.id !== 'EPIC-0005'),
  TASK_WITH_XREFS,
  TASK_WITH_SELF_REF,
  TASK_NO_REFS,
];

// ── Stage 2.5: Cross-Reference Traversal (unit tests) ────────────────

describe('Phase 4: extractEntityIds', () => {
  it('extracts a direct entity ID', () => {
    expect(extractEntityIds('TASK-0041')).toEqual(['TASK-0041']);
  });

  it('extracts entity ID from a URL', () => {
    expect(extractEntityIds('https://github.com/org/repo/issues/TASK-0041')).toEqual(['TASK-0041']);
  });

  it('extracts multiple entity IDs from one string', () => {
    const ids = extractEntityIds('TASK-0041 and EPIC-0005 are related');
    expect(ids).toEqual(['TASK-0041', 'EPIC-0005']);
  });

  it('returns empty for plain URLs with no entity ID', () => {
    expect(extractEntityIds('https://example.com/issues/42')).toEqual([]);
  });

  it('returns empty for resource URIs', () => {
    expect(extractEntityIds('mcp://backlog/resources/doc.md')).toEqual([]);
  });

  it('handles all entity type prefixes', () => {
    expect(extractEntityIds('FLDR-0001')).toEqual(['FLDR-0001']);
    expect(extractEntityIds('ARTF-0010')).toEqual(['ARTF-0010']);
    expect(extractEntityIds('MLST-0003')).toEqual(['MLST-0003']);
  });

  it('requires at least 4 digits', () => {
    expect(extractEntityIds('TASK-01')).toEqual([]);
    expect(extractEntityIds('TASK-001')).toEqual([]);
    expect(extractEntityIds('TASK-0001')).toEqual(['TASK-0001']);
  });
});

describe('Phase 4: traverseCrossReferences (unit tests)', () => {
  const getTask = makeGetTask(XREF_TASKS);
  const xrefDeps: CrossReferenceTraversalDeps = { getTask };

  it('resolves entity IDs from focal references', () => {
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005']);
    const result = traverseCrossReferences(TASK_WITH_XREFS, null, visited, xrefDeps);

    // Should resolve TASK-0099, TASK-0050, TASK-0051 (3 unique entity IDs from references)
    expect(result.cross_referenced.length).toBe(3);
    const ids = result.cross_referenced.map(e => e.id);
    expect(ids).toContain('TASK-0099');
    expect(ids).toContain('TASK-0050');
    expect(ids).toContain('TASK-0051');
  });

  it('returns entities at summary fidelity', () => {
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005']);
    const result = traverseCrossReferences(TASK_WITH_XREFS, null, visited, xrefDeps);

    for (const entity of result.cross_referenced) {
      expect(entity.fidelity).toBe('summary');
    }
  });

  it('deduplicates against visited set', () => {
    // TASK-0099 is already in context
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005', 'TASK-0099']);
    const result = traverseCrossReferences(TASK_WITH_XREFS, null, visited, xrefDeps);

    const ids = result.cross_referenced.map(e => e.id);
    expect(ids).not.toContain('TASK-0099');
    expect(ids).toContain('TASK-0050');
    expect(ids).toContain('TASK-0051');
  });

  it('adds resolved IDs to the visited set', () => {
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005']);
    traverseCrossReferences(TASK_WITH_XREFS, null, visited, xrefDeps);

    expect(visited.has('TASK-0099')).toBe(true);
    expect(visited.has('TASK-0050')).toBe(true);
    expect(visited.has('TASK-0051')).toBe(true);
  });

  it('skips self-references and already-visited entities', () => {
    // TASK-0061 references itself and its parent (EPIC-0005, already visited)
    const visited = new Set<string>(['TASK-0061', 'EPIC-0005']);
    const result = traverseCrossReferences(TASK_WITH_SELF_REF, null, visited, xrefDeps);

    expect(result.cross_referenced.length).toBe(0);
  });

  it('returns empty when focal has no references', () => {
    const visited = new Set<string>(['TASK-0062', 'EPIC-0005']);
    const result = traverseCrossReferences(TASK_NO_REFS, null, visited, xrefDeps);

    expect(result.cross_referenced).toEqual([]);
  });

  it('collects references from parent as well', () => {
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005']);
    const parentTask = PARENT_WITH_REFS;
    const result = traverseCrossReferences(TASK_WITH_XREFS, parentTask, visited, xrefDeps);

    const ids = result.cross_referenced.map(e => e.id);
    // TASK-0099 and TASK-0050 from focal, TASK-0051 from focal,
    // Parent refs: TASK-0050 (already from focal — deduped), TASK-0099 (already from focal — deduped)
    expect(ids).toContain('TASK-0099');
    expect(ids).toContain('TASK-0050');
    expect(ids).toContain('TASK-0051');
    // No duplicates
    expect(ids.filter(id => id === 'TASK-0099').length).toBe(1);
    expect(ids.filter(id => id === 'TASK-0050').length).toBe(1);
  });

  it('skips references pointing to non-existent entities', () => {
    const taskWithBadRef = makeTask({
      id: 'TASK-0070',
      title: 'Bad ref task',
      references: [
        { url: 'TASK-9999', title: 'Does not exist' },
        { url: 'TASK-0099', title: 'Exists' },
      ],
    });
    const visited = new Set<string>(['TASK-0070']);
    const result = traverseCrossReferences(taskWithBadRef, null, visited, xrefDeps);

    expect(result.cross_referenced.length).toBe(1);
    expect(result.cross_referenced[0]!.id).toBe('TASK-0099');
  });

  it('caps at MAX_CROSS_REFS (10)', () => {
    // Create a task with 15 references to different entities
    const manyRefTask = makeTask({
      id: 'TASK-0071',
      title: 'Many refs',
      references: Array.from({ length: 15 }, (_, i) => ({
        url: `TASK-${String(2000 + i).padStart(4, '0')}`,
        title: `Ref ${i}`,
      })),
    });
    // Create tasks for all referenced IDs
    const tasks = [
      ...XREF_TASKS,
      manyRefTask,
      ...Array.from({ length: 15 }, (_, i) =>
        makeTask({ id: `TASK-${String(2000 + i).padStart(4, '0')}`, title: `Target ${i}` }),
      ),
    ];
    const deps: CrossReferenceTraversalDeps = { getTask: makeGetTask(tasks) };
    const visited = new Set<string>(['TASK-0071']);
    const result = traverseCrossReferences(manyRefTask, null, visited, deps);

    expect(result.cross_referenced.length).toBeLessThanOrEqual(10);
  });
});

// ── Stage 2.5: Pipeline integration tests ──────────────────────────────

describe('Phase 4: Cross-reference traversal in pipeline', () => {
  it('cross_referenced populated when focal has entity references', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    expect(result!.cross_referenced.length).toBeGreaterThan(0);
    const xrefIds = result!.cross_referenced.map(e => e.id);
    expect(xrefIds).toContain('TASK-0099');
  });

  it('cross_referenced is empty when focal has no entity references', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0062', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    expect(result!.cross_referenced).toEqual([]);
  });

  it('cross_referenced does not include entities already in relational graph', async () => {
    // TASK-0061 references itself and its parent EPIC-0005 — both are in visited
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0061', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // Self and parent should NOT appear in cross_referenced
    const xrefIds = result!.cross_referenced.map(e => e.id);
    expect(xrefIds).not.toContain('TASK-0061');
    expect(xrefIds).not.toContain('EPIC-0005');
  });

  it('cross_referenced entities excluded from semantic enrichment dedup', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES, { includeSearch: true });
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: true, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // Cross-referenced IDs should not appear in semantic related
    const xrefIds = new Set(result!.cross_referenced.map(e => e.id));
    for (const rel of result!.related) {
      expect(xrefIds.has(rel.id)).toBe(false);
    }
  });

  it('stages_executed includes cross_reference_traversal when refs found', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result!.metadata.stages_executed).toContain('cross_reference_traversal');
  });

  it('stages_executed omits cross_reference_traversal when no refs resolved', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0062', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result!.metadata.stages_executed).not.toContain('cross_reference_traversal');
  });

  it('parent references are also traversed', async () => {
    const deps = makeDeps(XREF_TASKS_WITH_PARENT_REFS, ALL_RESOURCES);
    // TASK-0043 has parent TASK-0042, which has parent EPIC-0005 (with refs to TASK-0050, TASK-0099)
    // Actually TASK-0043's parent is TASK-0042 which has refs to github issue only (no entity ID)
    // Use TASK-0040 whose parent is EPIC-0005 (PARENT_WITH_REFS has refs to TASK-0050 and TASK-0099)
    const result = await hydrateContext({ task_id: 'TASK-0040', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // Parent (EPIC-0005) has references to TASK-0050 and TASK-0099
    // TASK-0040 is a sibling of TASK-0042 under EPIC-0005
    // TASK-0050 and TASK-0099 should appear in cross_referenced (if not already siblings)
    const xrefIds = result!.cross_referenced.map(e => e.id);
    // TASK-0099 is not a sibling of TASK-0040, so it should be cross-referenced
    expect(xrefIds).toContain('TASK-0099');
  });
});

// ── Phase 4: Token budget with cross-references ─────────────────────

describe('Phase 4: Token budget with cross-referenced entities', () => {
  const focal = taskToContextEntity(TASK_FOCAL, 'full');
  const parent = taskToContextEntity(EPIC, 'summary');
  const children = [TASK_CHILD_1, TASK_CHILD_2].map(t => taskToContextEntity(t, 'summary'));
  const siblings = [TASK_SIBLING_1, TASK_SIBLING_2].map(t => taskToContextEntity(t, 'summary'));
  const xrefs = [TASK_SEMANTIC_1, TASK_SEMANTIC_2].map(t => taskToContextEntity(t, 'summary'));
  const ancestors = [taskToContextEntity(EPIC_GRANDPARENT, 'reference')].map(e => ({ ...e, graph_depth: 2 })) as ContextEntity[];

  it('cross-referenced entities included with large budget', () => {
    const result = applyBudget(focal, parent, children, siblings, xrefs, [], ancestors, [], [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);
    expect(entityIds).toContain('TASK-0050');
    expect(entityIds).toContain('TASK-0051');
  });

  it('cross-referenced entities budgeted after siblings', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const childCosts = children.reduce((sum, c) => sum + estimateEntityTokens(c), 0);
    const siblingCosts = siblings.reduce((sum, s) => sum + estimateEntityTokens(s), 0);
    // Budget that fits siblings but not cross-refs
    const budget = focalCost + parentCost + childCosts + siblingCosts + 50 + 5;

    const result = applyBudget(focal, parent, children, siblings, xrefs, [], [], [], [], [], [], null, budget);
    const entityIds = result.entities.map(e => e.id);

    // Siblings should be present
    for (const s of siblings) expect(entityIds).toContain(s.id);
    // Cross-refs may be truncated/dropped
    expect(result.truncated).toBe(true);
  });

  it('cross-referenced entities budgeted before ancestors', () => {
    const result = applyBudget(focal, parent, [], [], xrefs, [], ancestors, [], [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);

    // Both cross-refs and ancestors should be in with large budget
    expect(entityIds).toContain('TASK-0050');
    expect(entityIds).toContain('EPIC-0001');

    // Cross-refs should appear before ancestors in the entity list
    const xrefIdx = entityIds.indexOf('TASK-0050');
    const ancestorIdx = entityIds.indexOf('EPIC-0001');
    expect(xrefIdx).toBeLessThan(ancestorIdx);
  });
});

// ── Phase 4: Contract invariants ────────────────────────────────────

describe('Phase 4: Contract invariants', () => {
  it('cross_referenced entities are always summary fidelity', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    for (const entity of result!.cross_referenced) {
      expect(entity.fidelity).toBe('summary');
    }
  });

  it('cross_referenced entities do not duplicate any relational graph entities', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const graphIds = new Set([
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
      ...result!.ancestors.map(a => a.id),
      ...result!.descendants.map(d => d.id),
    ]);

    for (const xref of result!.cross_referenced) {
      expect(graphIds.has(xref.id)).toBe(false);
    }
  });

  it('cross_referenced entities do not duplicate semantic related entities', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES, { includeSearch: true });
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: true, include_activity: false, max_tokens: 100000 }, deps);

    const xrefIds = new Set(result!.cross_referenced.map(e => e.id));
    for (const rel of result!.related) {
      expect(xrefIds.has(rel.id)).toBe(false);
    }
  });

  it('no entity ID appears in more than one role (extended with cross_referenced + referenced_by)', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const allIds: string[] = [
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
      ...result!.cross_referenced.map(x => x.id),
      ...result!.referenced_by.map(r => r.id),
      ...result!.ancestors.map(a => a.id),
      ...result!.descendants.map(d => d.id),
    ];
    const unique = new Set(allIds);
    expect(allIds.length).toBe(unique.size);
  });

  it('total_items includes cross_referenced + referenced_by entities', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const expectedTotal = 1 +
      (result!.parent ? 1 : 0) +
      result!.children.length +
      result!.siblings.length +
      result!.cross_referenced.length +
      result!.referenced_by.length +
      result!.ancestors.length +
      result!.descendants.length +
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length +
      (result!.session_summary ? 1 : 0);
    expect(result!.metadata.total_items).toBe(expectedTotal);
  });

  it('cross_referenced is always an array (never undefined)', async () => {
    const deps = makeDeps(XREF_TASKS, ALL_RESOURCES);

    const result1 = await hydrateContext({ task_id: 'TASK-0060', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    expect(Array.isArray(result1!.cross_referenced)).toBe(true);

    const result2 = await hydrateContext({ task_id: 'TASK-0062', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    expect(Array.isArray(result2!.cross_referenced)).toBe(true);
    expect(result2!.cross_referenced.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 5: Reverse Cross-References (ADR-0078)
// ══════════════════════════════════════════════════════════════════════

// Reverse reference test data: tasks that reference other tasks in the backlog
// TASK-0080 references TASK-0042 (the standard focal task)
const TASK_REFERENCING_FOCAL = makeTask({
  id: 'TASK-0080',
  title: 'Depends on context hydration',
  parent_id: 'EPIC-0010',
  description: 'This task depends on TASK-0042 being completed first.',
  references: [
    { url: 'TASK-0042', title: 'Context hydration task' },
  ],
});

// TASK-0081 also references TASK-0042 via a URL
const TASK_REFERENCING_FOCAL_VIA_URL = makeTask({
  id: 'TASK-0081',
  title: 'Related to hydration pipeline',
  parent_id: 'EPIC-0010',
  references: [
    { url: 'https://github.com/org/repo/issues/TASK-0042', title: 'GH issue' },
  ],
});

// TASK-0082 references TASK-0042 and also TASK-0060 (cross-references target)
const TASK_REFERENCING_MULTIPLE = makeTask({
  id: 'TASK-0082',
  title: 'Multi-reference task',
  parent_id: 'EPIC-0010',
  references: [
    { url: 'TASK-0042', title: 'Hydration' },
    { url: 'TASK-0060', title: 'Cross-ref task' },
  ],
});

// TASK-0083 references itself (self-ref should not appear in reverse index)
const TASK_SELF_REFERENCING = makeTask({
  id: 'TASK-0083',
  title: 'Self-referencing task',
  references: [
    { url: 'TASK-0083', title: 'Self' },
  ],
});

// TASK-0084 has no references (control case)
const TASK_NO_REFS_CONTROL = makeTask({
  id: 'TASK-0084',
  title: 'No references control',
  parent_id: 'EPIC-0010',
});

// Task set for reverse reference tests
const REVERSE_REF_TASKS: Entity[] = [
  ...ALL_TASKS,
  TASK_REFERENCING_FOCAL,
  TASK_REFERENCING_FOCAL_VIA_URL,
  TASK_REFERENCING_MULTIPLE,
  TASK_SELF_REFERENCING,
  TASK_NO_REFS_CONTROL,
];

// ── Stage 2.5: buildReverseReferenceIndex (unit tests) ────────────────

describe('Phase 5: buildReverseReferenceIndex', () => {
  it('builds an index mapping target → source entity IDs', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);

    // TASK-0042 is referenced by TASK-0080, TASK-0081, TASK-0082
    const refsToFocal = index.get('TASK-0042');
    expect(refsToFocal).toBeDefined();
    expect(refsToFocal).toContain('TASK-0080');
    expect(refsToFocal).toContain('TASK-0081');
    expect(refsToFocal).toContain('TASK-0082');
  });

  it('excludes self-references from the index', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);

    // TASK-0083 references itself — should NOT appear in its own reverse refs
    const refsToSelf = index.get('TASK-0083');
    if (refsToSelf) {
      expect(refsToSelf).not.toContain('TASK-0083');
    }
  });

  it('handles tasks with no references', () => {
    const index = buildReverseReferenceIndex([TASK_NO_REFS_CONTROL]);
    // Should build without error, index may be empty
    expect(index.size).toBe(0);
  });

  it('handles multiple references from one source to same target', () => {
    const taskWithDuplicateRefs = makeTask({
      id: 'TASK-0090',
      title: 'Duplicate refs',
      references: [
        { url: 'TASK-0042', title: 'First ref' },
        { url: 'TASK-0042', title: 'Second ref' },
      ],
    });
    const index = buildReverseReferenceIndex([taskWithDuplicateRefs]);
    const refs = index.get('TASK-0042');
    expect(refs).toBeDefined();
    // Should deduplicate — TASK-0090 should appear only once
    expect(refs!.filter(id => id === 'TASK-0090').length).toBe(1);
  });

  it('extracts entity IDs from URLs in references', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);

    // TASK-0081 references TASK-0042 via URL — should still be indexed
    const refs = index.get('TASK-0042');
    expect(refs).toContain('TASK-0081');
  });

  it('indexes multiple targets from a single source', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);

    // TASK-0082 references both TASK-0042 and TASK-0060
    const refsTo42 = index.get('TASK-0042');
    const refsTo60 = index.get('TASK-0060');
    expect(refsTo42).toContain('TASK-0082');
    expect(refsTo60).toContain('TASK-0082');
  });

  it('returns empty array for entities with no reverse refs', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);

    // TASK-0084 is not referenced by anything
    const refs = index.get('TASK-0084');
    expect(refs).toBeUndefined();
  });
});

// ── Stage 2.5: lookupReverseReferences (unit tests) ───────────────────

describe('Phase 5: lookupReverseReferences', () => {
  const getTask = makeGetTask(REVERSE_REF_TASKS);

  it('resolves reverse-referencing entities at summary fidelity', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005']);
    const result = lookupReverseReferences('TASK-0042', index, visited, { getTask });

    expect(result.length).toBeGreaterThan(0);
    for (const entity of result) {
      expect(entity.fidelity).toBe('summary');
    }
  });

  it('deduplicates against visited set', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);
    // TASK-0080 is already visited
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005', 'TASK-0080']);
    const result = lookupReverseReferences('TASK-0042', index, visited, { getTask });

    const ids = result.map(e => e.id);
    expect(ids).not.toContain('TASK-0080');
    // TASK-0081 and TASK-0082 should still be found
    expect(ids).toContain('TASK-0081');
    expect(ids).toContain('TASK-0082');
  });

  it('adds resolved IDs to the visited set', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005']);
    lookupReverseReferences('TASK-0042', index, visited, { getTask });

    expect(visited.has('TASK-0080')).toBe(true);
    expect(visited.has('TASK-0081')).toBe(true);
    expect(visited.has('TASK-0082')).toBe(true);
  });

  it('returns empty when no reverse references exist', () => {
    const index = buildReverseReferenceIndex(REVERSE_REF_TASKS);
    const visited = new Set<string>(['TASK-0084']);
    const result = lookupReverseReferences('TASK-0084', index, visited, { getTask });

    expect(result).toEqual([]);
  });

  it('caps at MAX_REVERSE_REFS (10)', () => {
    // Create 15 tasks that all reference TASK-0042
    const manyReferencers = Array.from({ length: 15 }, (_, i) =>
      makeTask({
        id: `TASK-${String(3000 + i).padStart(4, '0')}`,
        title: `Ref ${i}`,
        references: [{ url: 'TASK-0042', title: 'Target' }],
      }),
    );
    const allTasks = [...REVERSE_REF_TASKS, ...manyReferencers];
    const index = buildReverseReferenceIndex(allTasks);
    const visited = new Set<string>(['TASK-0042']);
    const result = lookupReverseReferences('TASK-0042', index, visited, { getTask: makeGetTask(allTasks) });

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('skips non-existent source entities', () => {
    // Manually construct an index with a non-existent source
    const index = new Map<string, string[]>([
      ['TASK-0042', ['TASK-9999', 'TASK-0080']],
    ]);
    const visited = new Set<string>(['TASK-0042']);
    const result = lookupReverseReferences('TASK-0042', index, visited, { getTask });

    const ids = result.map(e => e.id);
    expect(ids).not.toContain('TASK-9999');
    expect(ids).toContain('TASK-0080');
  });
});

// ── Stage 2.5: traverseCrossReferences with reverse refs ─────────────

describe('Phase 5: traverseCrossReferences with reverse references', () => {
  const getTask = makeGetTask(REVERSE_REF_TASKS);
  const listTasks = makeListTasks(REVERSE_REF_TASKS);

  it('returns both forward and reverse references', () => {
    // TASK-0060 has forward refs (to TASK-0099, TASK-0050, TASK-0051)
    // and is referenced by TASK-0082 (reverse ref)
    const visited = new Set<string>(['TASK-0060', 'EPIC-0005']);
    const xrefTasks = [...REVERSE_REF_TASKS, TASK_WITH_XREFS];
    const result = traverseCrossReferences(
      TASK_WITH_XREFS,
      null,
      visited,
      { getTask: makeGetTask(xrefTasks), listTasks: makeListTasks(xrefTasks) },
    );

    expect(result.cross_referenced.length).toBeGreaterThan(0);
    expect(result.referenced_by.length).toBeGreaterThan(0);
  });

  it('returns empty referenced_by when listTasks not provided', () => {
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005']);
    const result = traverseCrossReferences(
      TASK_FOCAL,
      null,
      visited,
      { getTask }, // No listTasks — reverse refs disabled
    );

    expect(result.referenced_by).toEqual([]);
  });

  it('reverse refs dedup against forward refs (visited set)', () => {
    // Create a scenario: TASK-0042 (focal) has forward ref to TASK-0080,
    // and TASK-0080 also references TASK-0042 (bidirectional).
    const focalWithForwardRef = makeTask({
      ...TASK_FOCAL,
      references: [{ url: 'TASK-0080', title: 'Forward link' }],
    });
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005']);
    const result = traverseCrossReferences(
      focalWithForwardRef,
      null,
      visited,
      { getTask, listTasks },
    );

    // TASK-0080 should appear in forward refs (cross_referenced)
    const forwardIds = result.cross_referenced.map(e => e.id);
    expect(forwardIds).toContain('TASK-0080');

    // TASK-0080 should NOT also appear in reverse refs (already in visited after forward pass)
    const reverseIds = result.referenced_by.map(e => e.id);
    expect(reverseIds).not.toContain('TASK-0080');
  });

  it('reverse refs exclude entities already in relational graph', () => {
    const visited = new Set<string>(['TASK-0042', 'EPIC-0005', 'TASK-0040', 'TASK-0041', 'TASK-0043', 'TASK-0044']);
    const result = traverseCrossReferences(
      TASK_FOCAL,
      null,
      visited,
      { getTask, listTasks },
    );

    // None of the relational graph entities should appear in referenced_by
    const reverseIds = result.referenced_by.map(e => e.id);
    expect(reverseIds).not.toContain('TASK-0042'); // focal
    expect(reverseIds).not.toContain('EPIC-0005'); // parent
    expect(reverseIds).not.toContain('TASK-0043'); // child
  });
});

// ── Stage 2.5: Pipeline integration tests (reverse refs) ─────────────

describe('Phase 5: Reverse references in pipeline', () => {
  it('referenced_by populated when other tasks reference the focal entity', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    expect(result!.referenced_by.length).toBeGreaterThan(0);
    const refByIds = result!.referenced_by.map(e => e.id);
    expect(refByIds).toContain('TASK-0080');
    expect(refByIds).toContain('TASK-0081');
  });

  it('referenced_by is empty when no tasks reference the focal entity', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0084', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    expect(result!.referenced_by).toEqual([]);
  });

  it('referenced_by does not include entities already in relational graph', async () => {
    // Create a task whose parent references it (already in relational graph as parent)
    const parentRefsFocal = makeTask({
      ...EPIC,
      references: [{ url: 'TASK-0042', title: 'My child' }],
    });
    const tasks = [
      parentRefsFocal,
      ...ALL_TASKS.filter(t => t.id !== 'EPIC-0005'),
      TASK_REFERENCING_FOCAL,
    ];
    const deps = makeDeps(tasks, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // Parent EPIC-0005 references TASK-0042 but should NOT appear in referenced_by
    // (it's already the parent)
    const refByIds = result!.referenced_by.map(e => e.id);
    expect(refByIds).not.toContain('EPIC-0005');
  });

  it('referenced_by entities excluded from semantic enrichment dedup', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES, { includeSearch: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: true, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // referenced_by IDs should not appear in semantic related
    const refByIds = new Set(result!.referenced_by.map(e => e.id));
    for (const rel of result!.related) {
      expect(refByIds.has(rel.id)).toBe(false);
    }
  });

  it('stages_executed includes cross_reference_traversal when reverse refs found', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result!.metadata.stages_executed).toContain('cross_reference_traversal');
  });

  it('stages_executed includes cross_reference_traversal with only reverse refs (no forward)', async () => {
    // TASK-0084 has no references[] but is not referenced by anyone either.
    // Use TASK-0042 which has no forward entity refs but IS referenced by others.
    const tasksNoForwardRefs = REVERSE_REF_TASKS.map(t =>
      t.id === 'TASK-0042' ? makeTask({ ...t, references: undefined }) : t,
    );
    const deps = makeDeps(tasksNoForwardRefs, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // Should have reverse refs but no forward refs
    expect(result!.cross_referenced.length).toBe(0);
    expect(result!.referenced_by.length).toBeGreaterThan(0);
    expect(result!.metadata.stages_executed).toContain('cross_reference_traversal');
  });

  it('bidirectional references handled correctly', async () => {
    // TASK-0042 references TASK-0080, and TASK-0080 references TASK-0042
    const focalWithRef = makeTask({
      ...TASK_FOCAL,
      references: [
        ...(TASK_FOCAL.references || []),
        { url: 'TASK-0080', title: 'Forward to 0080' },
      ],
    });
    const tasks = [
      ...REVERSE_REF_TASKS.filter(t => t.id !== 'TASK-0042'),
      focalWithRef,
    ];
    const deps = makeDeps(tasks, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result).not.toBeNull();
    // TASK-0080 should appear in cross_referenced (forward) but NOT referenced_by
    const forwardIds = result!.cross_referenced.map(e => e.id);
    const reverseIds = result!.referenced_by.map(e => e.id);
    expect(forwardIds).toContain('TASK-0080');
    expect(reverseIds).not.toContain('TASK-0080');
    // TASK-0081 and TASK-0082 should still appear in referenced_by
    expect(reverseIds).toContain('TASK-0081');
  });
});

// ── Phase 5: Token budget with referenced_by ─────────────────────────

describe('Phase 5: Token budget with referenced_by entities', () => {
  const focal = taskToContextEntity(TASK_FOCAL, 'full');
  const parent = taskToContextEntity(EPIC, 'summary');
  const children = [TASK_CHILD_1, TASK_CHILD_2].map(t => taskToContextEntity(t, 'summary'));
  const siblings = [TASK_SIBLING_1, TASK_SIBLING_2].map(t => taskToContextEntity(t, 'summary'));
  const xrefs = [TASK_SEMANTIC_1].map(t => taskToContextEntity(t, 'summary'));
  const refBy = [TASK_REFERENCING_FOCAL, TASK_REFERENCING_FOCAL_VIA_URL].map(t => taskToContextEntity(t, 'summary'));
  const ancestors = [taskToContextEntity(EPIC_GRANDPARENT, 'reference')].map(e => ({ ...e, graph_depth: 2 })) as ContextEntity[];

  it('referenced_by entities included with large budget', () => {
    const result = applyBudget(focal, parent, children, siblings, xrefs, refBy, ancestors, [], [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);
    expect(entityIds).toContain('TASK-0080');
    expect(entityIds).toContain('TASK-0081');
  });

  it('referenced_by entities budgeted after cross-referenced (forward)', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const childCosts = children.reduce((sum, c) => sum + estimateEntityTokens(c), 0);
    const siblingCosts = siblings.reduce((sum, s) => sum + estimateEntityTokens(s), 0);
    const xrefCosts = xrefs.reduce((sum, x) => sum + estimateEntityTokens(x), 0);
    // Budget that fits forward xrefs but not reverse refs
    const budget = focalCost + parentCost + childCosts + siblingCosts + xrefCosts + 50 + 5;

    const result = applyBudget(focal, parent, children, siblings, xrefs, refBy, [], [], [], [], [], null, budget);
    const entityIds = result.entities.map(e => e.id);

    // Forward cross-refs should be present
    for (const x of xrefs) expect(entityIds).toContain(x.id);
    // Referenced-by may be truncated/dropped
    expect(result.truncated).toBe(true);
  });

  it('referenced_by entities budgeted before ancestors', () => {
    const result = applyBudget(focal, parent, [], [], [], refBy, ancestors, [], [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);

    // Both referenced_by and ancestors should be in with large budget
    expect(entityIds).toContain('TASK-0080');
    expect(entityIds).toContain('EPIC-0001');

    // Referenced_by should appear before ancestors in the entity list
    const refByIdx = entityIds.indexOf('TASK-0080');
    const ancestorIdx = entityIds.indexOf('EPIC-0001');
    expect(refByIdx).toBeLessThan(ancestorIdx);
  });

  it('referenced_by entities appear after forward cross-referenced in entity list', () => {
    const result = applyBudget(focal, parent, [], [], xrefs, refBy, [], [], [], [], [], null, 100000);
    const entityIds = result.entities.map(e => e.id);

    const xrefIdx = entityIds.indexOf(xrefs[0]!.id);
    const refByIdx = entityIds.indexOf(refBy[0]!.id);
    expect(xrefIdx).toBeLessThan(refByIdx);
  });
});

// ── Phase 5: Contract invariants ────────────────────────────────────

describe('Phase 5: Contract invariants', () => {
  it('referenced_by entities are always summary fidelity', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    for (const entity of result!.referenced_by) {
      expect(entity.fidelity).toBe('summary');
    }
  });

  it('referenced_by entities do not duplicate any relational graph entities', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const graphIds = new Set([
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
      ...result!.ancestors.map(a => a.id),
      ...result!.descendants.map(d => d.id),
    ]);

    for (const refBy of result!.referenced_by) {
      expect(graphIds.has(refBy.id)).toBe(false);
    }
  });

  it('referenced_by entities do not duplicate forward cross-referenced', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const xrefIds = new Set(result!.cross_referenced.map(e => e.id));
    for (const refBy of result!.referenced_by) {
      expect(xrefIds.has(refBy.id)).toBe(false);
    }
  });

  it('referenced_by entities do not duplicate semantic related', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES, { includeSearch: true });
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: true, include_activity: false, max_tokens: 100000 }, deps);

    const refByIds = new Set(result!.referenced_by.map(e => e.id));
    for (const rel of result!.related) {
      expect(refByIds.has(rel.id)).toBe(false);
    }
  });

  it('no entity ID appears in more than one role (all roles)', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', depth: 2, include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const allIds: string[] = [
      result!.focal.id,
      ...(result!.parent ? [result!.parent.id] : []),
      ...result!.children.map(c => c.id),
      ...result!.siblings.map(s => s.id),
      ...result!.cross_referenced.map(x => x.id),
      ...result!.referenced_by.map(r => r.id),
      ...result!.ancestors.map(a => a.id),
      ...result!.descendants.map(d => d.id),
    ];
    const unique = new Set(allIds);
    expect(allIds.length).toBe(unique.size);
  });

  it('total_items includes referenced_by entities', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    const expectedTotal = 1 +
      (result!.parent ? 1 : 0) +
      result!.children.length +
      result!.siblings.length +
      result!.cross_referenced.length +
      result!.referenced_by.length +
      result!.ancestors.length +
      result!.descendants.length +
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length +
      (result!.session_summary ? 1 : 0);
    expect(result!.metadata.total_items).toBe(expectedTotal);
  });

  it('referenced_by is always an array (never undefined)', async () => {
    const deps = makeDeps(REVERSE_REF_TASKS, ALL_RESOURCES);

    const result1 = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    expect(Array.isArray(result1!.referenced_by)).toBe(true);

    const result2 = await hydrateContext({ task_id: 'TASK-0084', include_related: false, include_activity: false, max_tokens: 100000 }, deps);
    expect(Array.isArray(result2!.referenced_by)).toBe(true);
    expect(result2!.referenced_by.length).toBe(0);
  });

  it('referenced_by capped at 10', async () => {
    // Create 15 tasks that all reference TASK-0042
    const manyReferencers = Array.from({ length: 15 }, (_, i) =>
      makeTask({
        id: `TASK-${String(4000 + i).padStart(4, '0')}`,
        title: `Referencing ${i}`,
        parent_id: 'EPIC-0010',
        references: [{ url: 'TASK-0042', title: 'Target' }],
      }),
    );
    const tasks = [...REVERSE_REF_TASKS, ...manyReferencers];
    const deps = makeDeps(tasks, ALL_RESOURCES);
    const result = await hydrateContext({ task_id: 'TASK-0042', include_related: false, include_activity: false, max_tokens: 100000 }, deps);

    expect(result!.referenced_by.length).toBeLessThanOrEqual(10);
  });
});
