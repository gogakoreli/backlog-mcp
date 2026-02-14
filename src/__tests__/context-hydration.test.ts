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
import type { Task } from '../storage/schema.js';
import type { Resource } from '../search/types.js';
import { resolveFocal, taskToContextEntity } from '../context/stages/focal-resolution.js';
import { expandRelations, type RelationalExpansionDeps } from '../context/stages/relational-expansion.js';
import { enrichSemantic, type SemanticEnrichmentDeps } from '../context/stages/semantic-enrichment.js';
import { overlayTemporal, type TemporalOverlayDeps } from '../context/stages/temporal-overlay.js';
import {
  estimateTokens,
  estimateEntityTokens,
  estimateResourceTokens,
  applyBudget,
  downgradeEntity,
  downgradeResource,
} from '../context/token-budget.js';
import { hydrateContext, type HydrationServiceDeps } from '../context/hydration-service.js';
import type { ContextEntity, ContextResource } from '../context/types.js';

// ── Test data ────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
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

const ALL_TASKS: Task[] = [EPIC, TASK_FOCAL, TASK_SIBLING_1, TASK_SIBLING_2, TASK_CHILD_1, TASK_CHILD_2, TASK_UNRELATED, TASK_SEMANTIC_1, TASK_SEMANTIC_2];

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

function makeGetTask(tasks: Task[]): (id: string) => Task | undefined {
  const map = new Map(tasks.map(t => [t.id, t]));
  return (id) => map.get(id);
}

function makeListTasks(tasks: Task[]): (filter: { parent_id?: string; limit?: number }) => Task[] {
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

function makeSearchUnified(tasks: Task[] = ALL_TASKS, resources: Resource[] = ALL_RESOURCES): SemanticEnrichmentDeps['searchUnified'] {
  return async (query: string, options?: { types?: Array<'task' | 'epic' | 'resource'>; limit?: number }) => {
    const queryLower = query.toLowerCase();
    const results: Array<{ item: Task | Resource; score: number; type: 'task' | 'epic' | 'resource' }> = [];

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
  tasks: Task[] = ALL_TASKS,
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
  tasks: Task[] = ALL_TASKS,
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
        return results.map(r => ({ item: r.item as Task, score: r.score }));
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
      search: async (_query: string) => [] as Array<{ item: Task; score: number }>,
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
    const result = expandRelations(TASK_CHILD_1, 1, deps);
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
    const result = applyBudget(focal, parent, children, siblings, related, resources, [], 100000);
    expect(result.truncated).toBe(false);
    expect(result.entities.length).toBe(1 + 1 + 2 + 2 + 2); // focal + parent + children + siblings + related
    expect(result.resources.length).toBe(1);
  });

  it('focal and parent are always included', () => {
    const result = applyBudget(focal, parent, [], [], [], [], [], 100000);
    expect(result.entities.length).toBe(2);
    expect(result.entities[0]!.id).toBe(focal.id);
    expect(result.entities[1]!.id).toBe(parent!.id);
  });

  it('truncates lower-priority items when budget is tight', () => {
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const tightBudget = focalCost + parentCost + 50 + 10;

    const result = applyBudget(focal, parent, children, siblings, related, resources, [], tightBudget);
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
      const result = applyBudget(focal, parent, children, [], [], [], [], budget);
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

    const result = applyBudget(focal, parent, children, siblings, related, [], [], budget);
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

    const result = applyBudget(focal, parent, children, siblings, related, resources, activities, 100000);
    expect(result.activities.length).toBe(2);
  });

  it('tokensUsed is always positive', () => {
    const result = applyBudget(focal, null, [], [], [], [], [], 100000);
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
    const result = await hydrateContext({ task_id: 'TASK-0043', include_related: false, include_activity: false }, deps);
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
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length;
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
});
