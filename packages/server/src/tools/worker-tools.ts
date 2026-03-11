/**
 * worker-tools.ts — MCP tool registrations for the Cloudflare Worker.
 *
 * These mirror the existing tool registrations (backlog-list.ts, backlog-get.ts, etc.)
 * but accept a D1BacklogService instance instead of importing the filesystem singleton.
 *
 * IMPORTANT: This file must NOT import any Node.js-only modules:
 *   - No node:fs, node:path, node:os
 *   - No gray-matter, @orama/orama, @huggingface/transformers, fastify
 *   - No ../storage/backlog-service.js or ../storage/task-storage.ts
 *
 * ADR-0089 Phase 2.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ENTITY_TYPES, STATUSES, nextEntityId } from '@backlog-mcp/shared';
import type { EntityType } from '@backlog-mcp/shared';
import { createTask } from '../storage/schema.js';
import type { D1BacklogService } from '../storage/d1-backlog-service.js';

export function registerWorkerTools(server: McpServer, service: D1BacklogService): void {
  // ── backlog_list ────────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_list',
    {
      description:
        'List tasks from backlog. Returns most recently updated items first. Default: shows only active work (open/in_progress/blocked), limited to 20 items. Use counts=true to check if more items exist beyond the limit.',
      inputSchema: z.object({
        status: z
          .array(z.enum(STATUSES))
          .optional()
          .describe(
            'Filter by status. Options: open, in_progress, blocked, done, cancelled. Default: [open, in_progress, blocked]. Pass ["done"] to see completed work.',
          ),
        type: z
          .enum(ENTITY_TYPES)
          .optional()
          .describe(
            'Filter by type. Options: task, epic, folder, artifact, milestone. Default: returns all.',
          ),
        epic_id: z
          .string()
          .optional()
          .describe('Filter tasks belonging to a specific epic. Example: epic_id="EPIC-0001"'),
        parent_id: z
          .string()
          .optional()
          .describe('Filter items by parent. Example: parent_id="FLDR-0001"'),
        query: z
          .string()
          .optional()
          .describe(
            'Search across all task fields (title, description, evidence, references, etc.). Case-insensitive substring matching.',
          ),
        counts: z
          .boolean()
          .optional()
          .describe(
            'Include global counts { total_tasks, total_epics, by_status, by_type } alongside results. Use this to detect if more items exist beyond the limit. Default: false',
          ),
        limit: z
          .number()
          .optional()
          .describe(
            'Max items to return. Default: 20. Increase if you need to see more items (e.g., limit=100 to list all epics).',
          ),
      }),
    },
    async ({ status, type, epic_id, parent_id, query, counts, limit }) => {
      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      const tasks = await service.list({ status, type, parent_id: resolvedParent, query, limit });
      const list = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        type: t.type ?? 'task',
        parent_id: t.parent_id ?? t.epic_id,
      }));
      const result: any = { tasks: list };
      if (counts) result.counts = await service.counts();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── backlog_get ─────────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_get',
    {
      description:
        'Get full details by ID. Accepts task IDs (TASK-0001, EPIC-0002). Works for any item regardless of status.',
      inputSchema: z.object({
        id: z
          .union([z.string(), z.array(z.string())])
          .describe('Task ID (e.g. TASK-0001). Array for batch fetch.'),
      }),
    },
    async ({ id }) => {
      const ids = Array.isArray(id) ? id : [id];
      if (ids.length === 0) {
        return { content: [{ type: 'text', text: 'Required: id' }], isError: true };
      }
      const results = await Promise.all(
        ids.map(async (itemId) => {
          const markdown = await service.getMarkdown(itemId);
          return markdown ?? `Not found: ${itemId}`;
        }),
      );
      return { content: [{ type: 'text', text: results.join('\n\n---\n\n') }] };
    },
  );

  // ── backlog_create ──────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_create',
    {
      description: 'Create a new item in the backlog.',
      inputSchema: z
        .object({
          title: z.string().describe('Task title'),
          description: z.string().optional().describe('Task description in markdown'),
          type: z
            .enum(ENTITY_TYPES)
            .optional()
            .describe('Type: task (default) or epic'),
          epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
          parent_id: z
            .string()
            .optional()
            .describe(
              'Parent ID (any entity). Supports subtasks (task→task), epic membership, folder organization, milestone grouping.',
            ),
          references: z
            .array(z.object({ url: z.string(), title: z.string().optional() }))
            .optional()
            .describe(
              'Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)',
            ),
        })
        .refine((data) => !(data.description && (data as any).source_path), {
          message:
            'Cannot provide both description and source_path — use one or the other',
        }),
    },
    async ({ title, description, type, epic_id, parent_id, references }) => {
      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      const maxId = await service.getMaxId(type as EntityType | undefined);
      const id = nextEntityId(maxId, type as EntityType | undefined);
      const task = createTask({
        id,
        title,
        description,
        type: type as EntityType | undefined,
        parent_id: resolvedParent,
        references,
      });
      // Write epic_id too for backward compat when caller used epic_id
      if (epic_id && !parent_id) task.epic_id = epic_id;
      await service.add(task);
      return { content: [{ type: 'text', text: `Created ${task.id}` }] };
    },
  );

  // ── backlog_update ──────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_update',
    {
      description: 'Update an existing item.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title'),
        status: z.enum(STATUSES).optional().describe('New status'),
        epic_id: z
          .union([z.string(), z.null()])
          .optional()
          .describe('Parent epic ID (null to unlink)'),
        parent_id: z
          .union([z.string(), z.null()])
          .optional()
          .describe('Parent ID (null to unlink). Takes precedence over epic_id.'),
        blocked_reason: z
          .array(z.string())
          .optional()
          .describe('Reason if status is blocked'),
        evidence: z
          .array(z.string())
          .optional()
          .describe(
            'Proof of completion when marking done - links to PRs, docs, or notes',
          ),
        references: z
          .array(z.object({ url: z.string(), title: z.string().optional() }))
          .optional()
          .describe(
            'Reference links. Formats: external URLs (https://...), task refs (mcp://backlog/tasks/TASK-XXXX.md), resources (mcp://backlog/resources/{path}). Local files must include extension (file:///path/to/file.md)',
          ),
        due_date: z
          .union([z.string(), z.null()])
          .optional()
          .describe('Due date for milestones (ISO 8601). Null to clear.'),
        content_type: z
          .union([z.string(), z.null()])
          .optional()
          .describe('Content type for artifacts (e.g. text/markdown). Null to clear.'),
      }),
    },
    async ({ id, epic_id, parent_id, due_date, content_type, ...updates }) => {
      const task = await service.get(id);
      if (!task)
        return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };

      // parent_id takes precedence over epic_id
      if (parent_id !== undefined) {
        if (parent_id === null) {
          delete task.parent_id;
          delete task.epic_id;
        } else {
          task.parent_id = parent_id;
        }
      } else if (epic_id !== undefined) {
        if (epic_id === null) {
          delete task.epic_id;
          delete task.parent_id;
        } else {
          task.epic_id = epic_id;
          task.parent_id = epic_id;
        }
      }

      // Nullable type-specific fields: null clears, string sets
      for (const [key, val] of Object.entries({ due_date, content_type })) {
        if (val === null) delete (task as any)[key];
        else if (val !== undefined) (task as any)[key] = val;
      }

      Object.assign(task, updates, { updated_at: new Date().toISOString() });
      await service.save(task);
      return { content: [{ type: 'text', text: `Updated ${id}` }] };
    },
  );

  // ── backlog_delete ──────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_delete',
    {
      description: 'Delete an item permanently.',
      inputSchema: z.object({
        id: z.string().describe('Task ID to delete'),
      }),
    },
    async ({ id }) => {
      await service.delete(id);
      return { content: [{ type: 'text', text: `Deleted ${id}` }] };
    },
  );

  // ── backlog_search ──────────────────────────────────────────────────────────

  server.registerTool(
    'backlog_search',
    {
      description:
        'Search across backlog tasks and epics. Returns relevance-ranked results. Use this for discovery; use backlog_list for filtering by status/type.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Search query. Supports keywords and phrases. FTS5 full-text search is applied automatically.',
          ),
        status: z
          .array(z.enum(STATUSES))
          .optional()
          .describe(
            'Filter tasks/epics by status. Default: all statuses. Example: ["open", "in_progress"] for active work only.',
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('Max results to return. Default: 20, max: 100.'),
        include_content: z
          .boolean()
          .optional()
          .describe(
            'Include full description/content in results. Default: false (returns snippets only). Set true when you need the full text.',
          ),
        include_scores: z
          .boolean()
          .optional()
          .describe('Include relevance scores in results. Default: false.'),
      }),
    },
    async ({ query, status, limit, include_content, include_scores }) => {
      if (!query.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Query must not be empty' }) }],
          isError: true,
        };
      }

      const results = await service.searchUnified(query, {
        status,
        limit: limit ?? 20,
      });

      const formattedResults = results.map((r) => {
        const task = r.item;
        const result: Record<string, unknown> = {
          id: task.id,
          title: task.title,
          type: r.type,
          status: task.status,
        };
        const parentId = task.parent_id ?? task.epic_id;
        if (parentId) result.parent_id = parentId;
        if (include_scores) result.score = Math.round(r.score * 1000) / 1000;
        if (include_content) result.description = task.description;
        return result;
      });

      const response = {
        results: formattedResults,
        total: formattedResults.length,
        query,
        search_mode: 'fts5',
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );
}
