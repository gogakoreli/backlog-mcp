/**
 * Scaling diagnostic: demonstrates how "backlog mcp" ranking degrades
 * as corpus size increases (more documents mentioning both terms).
 */
import { describe, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { OramaSearchService } from '../search/orama-search-service.js';
import type { Entity } from '@backlog-mcp/shared';

const TEST_CACHE_PATH = join(process.cwd(), 'test-data', '.cache', 'search-scale.json');

function makeTask(overrides: Partial<Entity> & { id: string; title: string }): Task {
  return { status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...overrides };
}

/**
 * Generate N "noisy" tasks that naturally mention "backlog" and "mcp" with
 * varying frequency — simulating a real backlog-mcp project.
 */
function generateNoisyBacklogTasks(n: number): Entity[] {
  const templates = [
    // High TF: both "backlog" and "mcp" appear many times
    (i: number) => makeTask({
      id: `TASK-${String(100 + i).padStart(4, '0')}`,
      title: `Improve backlog search performance`,
      description: `The backlog-mcp search is slow. The backlog needs optimization for mcp agents. The backlog indexing for mcp needs caching. Backlog queries through mcp are timing out. The backlog-mcp server backlog queue is growing. MCP clients querying the backlog need faster responses from the backlog-mcp API.`,
    }),
    // Medium TF: "backlog" in title + both in body
    (i: number) => makeTask({
      id: `TASK-${String(100 + i).padStart(4, '0')}`,
      title: `Backlog item validation for MCP protocol`,
      description: `Validate backlog items against MCP schema. The backlog data needs to conform to mcp standards. Backlog validation errors should be reported through mcp notifications.`,
    }),
    // Medium TF: "mcp" in title + both in body
    (i: number) => makeTask({
      id: `TASK-${String(100 + i).padStart(4, '0')}`,
      title: `MCP server backlog endpoint redesign`,
      description: `Redesign the MCP endpoint that serves backlog data. The current mcp backlog endpoint is too slow. The backlog response from the mcp server needs pagination.`,
    }),
    // Lower TF but both terms present
    (i: number) => makeTask({
      id: `TASK-${String(100 + i).padStart(4, '0')}`,
      title: `Fix caching layer for MCP tools`,
      description: `The backlog-mcp caching layer has stale entries. Need to invalidate cache when backlog items change.`,
    }),
    // Both in title
    (i: number) => makeTask({
      id: `TASK-${String(100 + i).padStart(4, '0')}`,
      title: `Backlog MCP integration testing`,
      description: `Write integration tests for the backlog MCP tools. Ensure the backlog list and backlog search MCP endpoints return correct results.`,
    }),
  ];

  return Array.from({ length: n }, (_, i) => templates[i % templates.length](i));
}

describe('Scaling Diagnostic: "backlog mcp" ranking vs corpus size', () => {
  for (const corpusSize of [5, 15, 30, 50]) {
    it(`corpus=${corpusSize} noisy docs`, async () => {
      const service = new OramaSearchService({
        cachePath: TEST_CACHE_PATH.replace('.json', `-${corpusSize}.json`),
      });

      const noisyTasks = generateNoisyBacklogTasks(corpusSize);
      const target = makeTask({
        id: 'EPIC-0001',
        title: 'backlog-mcp 10x',
        description: 'Transform backlog-mcp from task tracker to agentic work system with keyboard-first UX',
        type: 'epic',
      });

      await service.index([target, ...noisyTasks]);
      const results = await service.search('backlog mcp');

      const targetIdx = results.findIndex(r => r.task.id === 'EPIC-0001');
      console.log(`\nCorpus: 1 target + ${corpusSize} noisy docs = ${corpusSize + 1} total`);
      console.log(`EPIC-0001 "backlog-mcp 10x" ranked: #${targetIdx + 1} of ${results.length}`);
      console.log(`Top 5:`);
      results.slice(0, 5).forEach((r, i) => {
        const marker = r.task.id === 'EPIC-0001' ? ' <<<< TARGET' : '';
        console.log(`  #${i+1} ${r.task.id.padEnd(12)} score=${r.score.toFixed(4)} "${r.task.title.substring(0, 50)}"${marker}`);
      });
      if (targetIdx >= 5) {
        console.log(`  ...`);
        const r = results[targetIdx];
        console.log(`  #${targetIdx+1} ${r.task.id.padEnd(12)} score=${r.score.toFixed(4)} "${r.task.title.substring(0, 50)}" <<<< TARGET`);
      }
    });
  }
});
