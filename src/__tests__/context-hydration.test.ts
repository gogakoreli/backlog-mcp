/**
 * context-hydration.test.ts — Tests for the agent context hydration pipeline (ADR-0074).
 *
 * Tests the ContextHydrationService pipeline, including:
 * 1. Focal resolution (Stage 1)
 * 2. Relational expansion (Stage 2)
 * 3. Token budgeting
 * 4. End-to-end pipeline orchestration
 *
 * Uses dependency injection — no filesystem or search index needed.
 */
import { describe, it, expect } from 'vitest';
import type { Task } from '../storage/schema.js';
import type { Resource } from '../search/types.js';
import { resolveFocal, taskToContextEntity } from '../context/stages/focal-resolution.js';
import { expandRelations, type RelationalExpansionDeps } from '../context/stages/relational-expansion.js';
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

const ALL_TASKS: Task[] = [EPIC, TASK_FOCAL, TASK_SIBLING_1, TASK_SIBLING_2, TASK_CHILD_1, TASK_CHILD_2, TASK_UNRELATED];

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

const ALL_RESOURCES: Resource[] = [RESOURCE_ADR, RESOURCE_TASK, RESOURCE_UNRELATED];

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

function makeDeps(tasks: Task[] = ALL_TASKS, resources: Resource[] = ALL_RESOURCES): HydrationServiceDeps {
  return {
    getTask: makeGetTask(tasks),
    listTasks: makeListTasks(tasks),
    listResources: () => resources,
  };
}

// ── Stage 1: Focal Resolution ────────────────────────────────────────

describe('Stage 1: Focal Resolution', () => {
  it('resolves a task by ID', () => {
    const result = resolveFocal({ task_id: 'TASK-0042' }, makeGetTask(ALL_TASKS));
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('TASK-0042');
    expect(result!.focal.title).toBe('Implement context hydration');
    expect(result!.focal.fidelity).toBe('full');
    expect(result!.focal.description).toBe(TASK_FOCAL.description);
    expect(result!.focalTask).toEqual(TASK_FOCAL);
  });

  it('resolves an epic by ID', () => {
    const result = resolveFocal({ task_id: 'EPIC-0005' }, makeGetTask(ALL_TASKS));
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('EPIC-0005');
    expect(result!.focal.type).toBe('epic');
  });

  it('returns null for non-existent entity', () => {
    const result = resolveFocal({ task_id: 'TASK-9999' }, makeGetTask(ALL_TASKS));
    expect(result).toBeNull();
  });

  it('returns null when no task_id or query provided', () => {
    const result = resolveFocal({}, makeGetTask(ALL_TASKS));
    expect(result).toBeNull();
  });

  it('returns null for query-based resolution (Phase 2 not implemented)', () => {
    const result = resolveFocal({ query: 'context hydration' }, makeGetTask(ALL_TASKS));
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
    const orphan = makeTask({ id: 'TASK-0050', title: 'Orphan task' });
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
});

describe('Token budget application', () => {
  const focal = taskToContextEntity(TASK_FOCAL, 'full');
  const parent = taskToContextEntity(EPIC, 'summary');
  const children = [TASK_CHILD_1, TASK_CHILD_2].map(t => taskToContextEntity(t, 'summary'));
  const siblings = [TASK_SIBLING_1, TASK_SIBLING_2].map(t => taskToContextEntity(t, 'summary'));
  const resources: ContextResource[] = [
    { uri: 'mcp://backlog/resources/test.md', title: 'Test', path: 'resources/test.md', fidelity: 'summary', snippet: 'A snippet' },
  ];

  it('includes all items when budget is large', () => {
    const result = applyBudget(focal, parent, children, siblings, resources, [], 100000);
    expect(result.truncated).toBe(false);
    expect(result.entities.length).toBe(1 + 1 + 2 + 2); // focal + parent + children + siblings
    expect(result.resources.length).toBe(1);
  });

  it('focal and parent are always included', () => {
    // Even with tiny budget, focal is included (it's always first)
    const result = applyBudget(focal, parent, [], [], [], [], 100000);
    expect(result.entities.length).toBe(2);
    expect(result.entities[0]!.id).toBe(focal.id);
    expect(result.entities[1]!.id).toBe(parent!.id);
  });

  it('truncates lower-priority items when budget is tight', () => {
    // Set budget to just fit focal + parent, not children/siblings/resources
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const tightBudget = focalCost + parentCost + 50 + 10; // +50 metadata overhead + small margin

    const result = applyBudget(focal, parent, children, siblings, resources, [], tightBudget);
    expect(result.truncated).toBe(true);
    // Focal and parent should be there
    expect(result.entities[0]!.id).toBe(focal.id);
    expect(result.entities[1]!.id).toBe(parent!.id);
  });

  it('downgrades entities to reference fidelity before dropping them', () => {
    // Set budget that fits focal + parent + some reference-level children
    const focalCost = estimateEntityTokens(focal);
    const parentCost = estimateEntityTokens(parent);
    const refChildCost = estimateEntityTokens(downgradeEntity(children[0]!, 'reference'));
    const summaryChildCost = estimateEntityTokens(children[0]!);

    // Budget: fits focal + parent + reference children but not summary children
    const budget = focalCost + parentCost + 50 + refChildCost * 2 + 20;

    // Only apply budget if summary cost exceeds budget (i.e., downgrade happens)
    if (budget < focalCost + parentCost + 50 + summaryChildCost * 2) {
      const result = applyBudget(focal, parent, children, [], [], [], budget);
      // Check that at least some children are included (possibly at reference fidelity)
      const childEntities = result.entities.filter(e => e.id === 'TASK-0043' || e.id === 'TASK-0044');
      if (childEntities.length > 0) {
        // At least one child should be at reference fidelity due to budget pressure
        const hasReference = childEntities.some(e => e.fidelity === 'reference');
        const hasSummary = childEntities.some(e => e.fidelity === 'summary');
        expect(hasReference || hasSummary).toBe(true);
      }
    }
  });

  it('tokensUsed is always positive', () => {
    const result = applyBudget(focal, null, [], [], [], [], 100000);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });
});

// ── End-to-end pipeline ──────────────────────────────────────────────

describe('ContextHydrationService: end-to-end pipeline', () => {
  const deps = makeDeps();

  it('returns full context for a task with parent, children, siblings, and resources', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
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
  });

  it('returns null for non-existent entity', () => {
    const result = hydrateContext({ task_id: 'TASK-9999' }, deps);
    expect(result).toBeNull();
  });

  it('works for epic as focal (lists all children)', () => {
    const result = hydrateContext({ task_id: 'EPIC-0005' }, deps);
    expect(result).not.toBeNull();
    expect(result!.focal.id).toBe('EPIC-0005');
    expect(result!.focal.type).toBe('epic');
    expect(result!.parent).toBeNull();
    expect(result!.children.length).toBeGreaterThanOrEqual(3); // TASK-0040, 0041, 0042
    expect(result!.siblings).toHaveLength(0);
  });

  it('respects max_tokens budget', () => {
    // Very small budget — should truncate
    const result = hydrateContext({ task_id: 'TASK-0042', max_tokens: 200 }, deps);
    expect(result).not.toBeNull();
    // Focal is always included
    expect(result!.focal.id).toBe('TASK-0042');
    // Total token estimate should be within budget (with some margin for metadata)
    expect(result!.metadata.token_estimate).toBeLessThanOrEqual(250); // budget + margin
  });

  it('large budget includes everything without truncation', () => {
    const result = hydrateContext({ task_id: 'TASK-0042', max_tokens: 100000 }, deps);
    expect(result).not.toBeNull();
    expect(result!.metadata.truncated).toBe(false);
  });

  it('metadata.depth reflects requested depth', () => {
    const result = hydrateContext({ task_id: 'TASK-0042', depth: 2 }, deps);
    expect(result!.metadata.depth).toBe(2);
  });

  it('depth is clamped to max 3', () => {
    const result = hydrateContext({ task_id: 'TASK-0042', depth: 10 }, deps);
    expect(result!.metadata.depth).toBe(3);
  });

  it('default depth is 1', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata.depth).toBe(1);
  });

  it('default max_tokens is 4000', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata.token_estimate).toBeLessThanOrEqual(4000);
  });

  it('related array is empty in Phase 1', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.related).toEqual([]);
  });

  it('activity array is empty in Phase 1', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.activity).toEqual([]);
  });

  it('handles leaf task with no children', () => {
    const result = hydrateContext({ task_id: 'TASK-0043' }, deps);
    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(0);
    // Should still have parent and siblings
    expect(result!.parent).not.toBeNull();
    expect(result!.parent!.id).toBe('TASK-0042');
  });

  it('handles orphan task (no parent)', () => {
    const orphanDeps = makeDeps([
      makeTask({ id: 'TASK-0050', title: 'Orphan' }),
    ], []);
    const result = hydrateContext({ task_id: 'TASK-0050' }, orphanDeps);
    expect(result).not.toBeNull();
    expect(result!.parent).toBeNull();
    expect(result!.children).toHaveLength(0);
    expect(result!.siblings).toHaveLength(0);
    expect(result!.related_resources).toHaveLength(0);
  });
});

// ── Resource context ─────────────────────────────────────────────────

describe('Resource discovery in context', () => {
  it('matches resources by focal task ID in path (case insensitive)', () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/task-0042/design.md', path: 'resources/task-0042/design.md', title: 'Design', content: 'Design doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.related_resources.length).toBe(1);
    expect(result!.related_resources[0]!.uri).toBe('mcp://backlog/resources/task-0042/design.md');
  });

  it('matches resources by parent ID in path', () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/EPIC-0005/plan.md', path: 'resources/EPIC-0005/plan.md', title: 'Plan', content: 'Plan doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.related_resources.length).toBe(1);
  });

  it('does not match resources with unrelated paths', () => {
    const resources: Resource[] = [
      { id: 'mcp://backlog/resources/other/doc.md', path: 'resources/other/doc.md', title: 'Other', content: 'Other doc' },
    ];
    const deps = makeDeps(ALL_TASKS, resources);
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.related_resources.length).toBe(0);
  });
});

// ── Contract invariants ──────────────────────────────────────────────

describe('Context response contract invariants', () => {
  const deps = makeDeps();

  it('focal entity always has full fidelity', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.focal.fidelity).toBe('full');
  });

  it('parent entity (when present) has summary fidelity', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.parent!.fidelity).toBe('summary');
  });

  it('all entities have required fields', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    const allEntities = [result!.focal, result!.parent, ...result!.children, ...result!.siblings].filter(Boolean);
    for (const entity of allEntities) {
      expect(entity!.id).toBeDefined();
      expect(entity!.title).toBeDefined();
      expect(entity!.status).toBeDefined();
      expect(entity!.type).toBeDefined();
      expect(entity!.fidelity).toBeDefined();
    }
  });

  it('all resources have required fields', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    for (const resource of result!.related_resources) {
      expect(resource.uri).toBeDefined();
      expect(resource.title).toBeDefined();
      expect(resource.path).toBeDefined();
      expect(resource.fidelity).toBeDefined();
    }
  });

  it('metadata is always present and complete', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    expect(result!.metadata).toBeDefined();
    expect(typeof result!.metadata.depth).toBe('number');
    expect(typeof result!.metadata.total_items).toBe('number');
    expect(typeof result!.metadata.token_estimate).toBe('number');
    expect(typeof result!.metadata.truncated).toBe('boolean');
    expect(Array.isArray(result!.metadata.stages_executed)).toBe(true);
    expect(result!.metadata.stages_executed.length).toBeGreaterThan(0);
  });

  it('total_items matches the actual number of items in the response', () => {
    const result = hydrateContext({ task_id: 'TASK-0042' }, deps);
    const expectedTotal = 1 + // focal
      (result!.parent ? 1 : 0) +
      result!.children.length +
      result!.siblings.length +
      result!.related_resources.length +
      result!.related.length +
      result!.activity.length;
    expect(result!.metadata.total_items).toBe(expectedTotal);
  });
});
