/**
 * Scoring decomposition: shows raw BM25 scores, normalized scores,
 * fused scores, and coordination bonus separately.
 *
 * This traces the FULL scoring pipeline for specific queries to find
 * exactly where the ranking goes wrong.
 */
import { describe, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { create, insert, search, type Results } from '@orama/orama';
import { compoundWordTokenizer } from '../search/tokenizer.js';
import { minmaxNormalize, linearFusion, applyCoordinationBonus, type ScoredHit } from '../search/scoring.js';
import {
  schema, TEXT_PROPERTIES, UNSORTABLE_PROPERTIES, ENUM_FACETS,
  type OramaDoc, type OramaInstance,
} from '../search/orama-schema.js';
import type { Entity } from '@backlog-mcp/shared';

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return {
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function taskToDoc(task: Entity): OramaDoc {
  return {
    id: task.id,
    title: task.title,
    description: task.description || '',
    status: task.status,
    type: task.type || 'task',
    epic_id: task.parent_id ?? task.epic_id ?? '',
    evidence: (task.evidence || []).join(' '),
    blocked_reason: (task.blocked_reason || []).join(' '),
    references: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' '),
    path: '',
    updated_at: task.updated_at || '',
  };
}

// Same dataset as the diagnostic test
const TASKS: Entity[] = [
  makeTask({ id: 'EPIC-0001', title: 'backlog-mcp 10x', description: 'Transform backlog-mcp from task tracker to agentic work system with keyboard-first UX', type: 'epic' }),
  makeTask({ id: 'TASK-0010', title: 'Implement Spotlight-style search UI', description: 'Global search modal for backlog-mcp triggered by Cmd+J. The backlog search needs to support mcp tool integration.', references: [{ url: 'https://github.com/user/backlog-mcp', title: 'backlog-mcp repo' }] }),
  makeTask({ id: 'TASK-0011', title: 'Fix search ranking quality', description: 'Search in backlog-mcp returns wrong results. The backlog items are not ranked properly when using mcp tools. Need to improve the backlog search for mcp agents.', evidence: ['Searched backlog for mcp-related tasks, got wrong results', 'backlog-mcp search needs improvement'] }),
  makeTask({ id: 'TASK-0012', title: 'Add MCP tool documentation', description: 'Document all backlog-mcp tools. The MCP protocol requires specific schemas. The backlog tools should follow mcp best practices for backlog management.', references: [{ url: 'https://github.com/user/backlog-mcp/docs', title: 'backlog-mcp docs' }, { url: 'https://modelcontextprotocol.io', title: 'MCP specification' }] }),
  makeTask({ id: 'TASK-0013', title: 'Performance optimization for large backlogs', description: 'The backlog-mcp server is slow with >500 items. Need to optimize backlog queries. The mcp server should handle large backlog collections efficiently. Current backlog-mcp indexing takes too long.' }),
  makeTask({ id: 'TASK-0014', title: 'Implement backlog import/export', description: 'Add import/export functionality to backlog-mcp. Users need to migrate their backlog from other tools into mcp format. The backlog export should preserve all mcp metadata.' }),
  makeTask({ id: 'TASK-0015', title: 'API rate limiting for MCP server', description: 'Add rate limiting to the backlog-mcp MCP server endpoints. The backlog API needs throttling when mcp clients send too many requests to the backlog service.' }),
  makeTask({ id: 'TASK-0016', title: 'Hybrid search architecture', description: 'Implement BM25 + vector hybrid search for backlog-mcp. The search should combine text and semantic matching for the backlog. MCP tool responses should include relevance scores.' }),
  makeTask({ id: 'TASK-0017', title: 'Test infrastructure improvements', description: 'Improve test coverage for backlog-mcp. Add golden tests for backlog search. The mcp tool tests need better assertions. Current backlog test suite is incomplete.' }),
  makeTask({ id: 'TASK-0018', title: 'Backlog notifications via MCP', description: 'Send notifications through MCP when backlog items change. The backlog-mcp server should emit events. MCP clients consuming the backlog need real-time updates.' }),

  // FeatureStore scenario
  makeTask({ id: 'TASK-0009', title: 'Create YavapaiMFE ownership transfer documentation', description: 'Create comprehensive starter doc for new team taking ownership of FeatureStore (YavapaiMFE).\n\nMFE ID: `featurestore`\nFeature flag: `featureStore`\nMain package: RhinestoneMonarchYavapaiMFE', status: 'done' }),
  makeTask({ id: 'TASK-0020', title: 'Feature flag cleanup', description: 'Remove old feature flags from the codebase. The feature toggle system has accumulated stale feature flags. Clean up the feature management store.' }),
  makeTask({ id: 'TASK-0021', title: 'Feature prioritization framework', description: 'Create a feature prioritization framework. Each feature should have a score. The product feature backlog needs a feature ranking system to store priorities.' }),
  makeTask({ id: 'TASK-0022', title: 'Implement feature toggle service', description: 'Build a centralized feature toggle service. Features can be enabled per user. The feature store should persist feature state. Add feature flag support for A/B testing.' }),
  makeTask({ id: 'TASK-0023', title: 'Add feature request template', description: 'Create a feature request template for the backlog. Feature requests should include feature description, feature impact, and feature store integration requirements.' }),
];

const taskMap = new Map<string, Task>(TASKS.map(t => [t.id, t]));

describe('Scoring Decomposition', () => {
  let db: OramaInstance;

  beforeAll(async () => {
    db = await create({
      schema,
      components: { tokenizer: compoundWordTokenizer },
      sort: { unsortableProperties: [...UNSORTABLE_PROPERTIES] },
    });
    for (const task of TASKS) {
      await insert(db, taskToDoc(task));
    }
  });

  async function decompose(query: string, targetId: string) {
    // Stage 1: Raw BM25
    const bm25Raw = await search(db, {
      term: query,
      properties: [...TEXT_PROPERTIES],
      limit: 40,
      boost: { id: 10, title: 3 },
      tolerance: 1,
      facets: ENUM_FACETS,
    });

    // Also run WITHOUT id boost to compare
    const bm25NoIdBoost = await search(db, {
      term: query,
      properties: [...TEXT_PROPERTIES],
      limit: 40,
      boost: { title: 3 },
      tolerance: 1,
      facets: ENUM_FACETS,
    });

    // Also run with ONLY title search to see the title-only signal
    const bm25TitleOnly = await search(db, {
      term: query,
      properties: ['title'],
      limit: 40,
      boost: { title: 1 },
      tolerance: 1,
    });

    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${query}"  |  TARGET: ${targetId}`);
    console.log(`${'='.repeat(80)}`);

    // Show raw BM25 scores
    console.log(`\n--- Stage 1a: Raw BM25 (with id:10, title:3) ---`);
    bm25Raw.hits.slice(0, 8).forEach((h, i) => {
      const marker = h.document.id === targetId ? ' <<<< TARGET' : '';
      console.log(`  #${i+1}  ${h.document.id.padEnd(12)} raw_bm25=${h.score.toFixed(6)}  "${(h.document as any).title?.substring(0, 45)}"${marker}`);
    });
    const targetRawIdx = bm25Raw.hits.findIndex(h => h.document.id === targetId);
    if (targetRawIdx >= 8) {
      const h = bm25Raw.hits[targetRawIdx];
      console.log(`  ...`);
      console.log(`  #${targetRawIdx+1}  ${h.document.id.padEnd(12)} raw_bm25=${h.score.toFixed(6)}  "${(h.document as any).title?.substring(0, 45)}" <<<< TARGET`);
    }

    console.log(`\n--- Stage 1b: Raw BM25 (NO id boost, title:3 only) ---`);
    bm25NoIdBoost.hits.slice(0, 8).forEach((h, i) => {
      const marker = h.document.id === targetId ? ' <<<< TARGET' : '';
      console.log(`  #${i+1}  ${h.document.id.padEnd(12)} raw_bm25=${h.score.toFixed(6)}  "${(h.document as any).title?.substring(0, 45)}"${marker}`);
    });
    const targetNoIdIdx = bm25NoIdBoost.hits.findIndex(h => h.document.id === targetId);
    if (targetNoIdIdx >= 8) {
      const h = bm25NoIdBoost.hits[targetNoIdIdx];
      console.log(`  ...`);
      console.log(`  #${targetNoIdIdx+1}  ${h.document.id.padEnd(12)} raw_bm25=${h.score.toFixed(6)}  "${(h.document as any).title?.substring(0, 45)}" <<<< TARGET`);
    }

    console.log(`\n--- Stage 1c: Title-only BM25 ---`);
    bm25TitleOnly.hits.slice(0, 5).forEach((h, i) => {
      const marker = h.document.id === targetId ? ' <<<< TARGET' : '';
      console.log(`  #${i+1}  ${h.document.id.padEnd(12)} title_bm25=${h.score.toFixed(6)}  "${(h.document as any).title?.substring(0, 45)}"${marker}`);
    });

    // Stage 2: MinMax normalized
    const bm25Hits: ScoredHit[] = bm25Raw.hits.map(h => ({ id: h.document.id, score: h.score }));
    const normalized = minmaxNormalize(bm25Hits);
    const fused = linearFusion(normalized, []); // No vector, pure BM25

    console.log(`\n--- Stage 2: After MinMax normalize + fusion (BM25-only) ---`);
    fused.slice(0, 8).forEach((h, i) => {
      const marker = h.id === targetId ? ' <<<< TARGET' : '';
      console.log(`  #${i+1}  ${h.id.padEnd(12)} fused=${h.score.toFixed(6)}${marker}`);
    });
    const targetFusedIdx = fused.findIndex(h => h.id === targetId);
    if (targetFusedIdx >= 8) {
      console.log(`  ...`);
      console.log(`  #${targetFusedIdx+1}  ${fused[targetFusedIdx].id.padEnd(12)} fused=${fused[targetFusedIdx].score.toFixed(6)} <<<< TARGET`);
    }

    // Stage 3: After coordination bonus
    const getText = (id: string) => {
      const t = taskMap.get(id);
      return t ? [t.title, t.description || '', (t.evidence || []).join(' ')].join(' ') : '';
    };
    const getTitle = (id: string) => taskMap.get(id)?.title || '';
    const coordinated = applyCoordinationBonus(fused, query, getText, getTitle);

    console.log(`\n--- Stage 3: After coordination bonus ---`);
    coordinated.slice(0, 8).forEach((h, i) => {
      const fusedScore = fused.find(f => f.id === h.id)?.score ?? 0;
      const bonus = h.score - fusedScore;
      const marker = h.id === targetId ? ' <<<< TARGET' : '';
      console.log(`  #${i+1}  ${h.id.padEnd(12)} final=${h.score.toFixed(4)}  (fused=${fusedScore.toFixed(4)} + coord=${bonus.toFixed(4)})${marker}`);
    });
    const targetCoordIdx = coordinated.findIndex(h => h.id === targetId);
    if (targetCoordIdx >= 8) {
      const h = coordinated[targetCoordIdx];
      const fusedScore = fused.find(f => f.id === h.id)?.score ?? 0;
      const bonus = h.score - fusedScore;
      console.log(`  ...`);
      console.log(`  #${targetCoordIdx+1}  ${h.id.padEnd(12)} final=${h.score.toFixed(4)}  (fused=${fusedScore.toFixed(4)} + coord=${bonus.toFixed(4)}) <<<< TARGET`);
    }

    console.log('');
  }

  it('decompose "feature store" scoring', async () => {
    await decompose('feature store', 'TASK-0009');
  });

  it('decompose "backlog mcp" scoring', async () => {
    await decompose('backlog mcp', 'EPIC-0001');
  });

  it('decompose "feature" scoring (single term)', async () => {
    await decompose('feature', 'TASK-0009');
  });
});
