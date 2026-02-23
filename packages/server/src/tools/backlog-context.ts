import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { resourceManager } from '../resources/manager.js';
import { operationLogger } from '../operations/index.js';
import { hydrateContext, type ContextResponse } from '../context/index.js';

/**
 * backlog_context — Agent context hydration tool (ADR-0074, ADR-0075, ADR-0076, ADR-0077, ADR-0078).
 *
 * Provides a single-call context bundle for agents working on backlog tasks.
 * Replaces the 5-10 manual tool calls an agent would otherwise need to
 * understand a task's full context (parent, siblings, children, resources,
 * semantically related items, recent activity, and session memory).
 *
 * Phase 5 additions (ADR-0078):
 *   - Reverse cross-references: discovers "who references me?" via on-demand index
 *   - referenced_by array in response: entities whose references[] point to focal
 *
 * Use backlog_context for:
 *   - "I'm about to work on TASK-X, give me everything I need to know"
 *   - Understanding a task's place in the broader backlog
 *   - Discovering related resources (ADRs, design docs) attached to a task or its epic
 *   - Finding semantically related tasks across the backlog
 *   - Seeing recent activity (who changed what, when)
 *   - Understanding what the last agent did on this task
 *
 * Use backlog_search for:
 *   - Finding items matching a query (discovery)
 *
 * Use backlog_get for:
 *   - Getting raw content of a specific item by ID
 */
export function registerBacklogContextTool(server: McpServer) {
  server.registerTool(
    'backlog_context',
    {
      description: 'Get full context for working on a task — parent epic, sibling tasks, children, cross-referenced items, reverse references (who references me), ancestors, descendants, related resources, semantically related items, recent activity, and session memory in a single call. Use this before starting work on any task to understand its context.',
      inputSchema: z.object({
        task_id: z.string().optional().describe('Task or epic ID to get context for. Example: "TASK-0042" or "EPIC-0005". Mutually exclusive with query.'),
        query: z.string().optional().describe('Natural language query to find the most relevant entity. Example: "search ranking improvements". Mutually exclusive with task_id.'),
        depth: z.number().min(1).max(3).optional().describe('Relational expansion depth. 1 = direct relations (default). 2 = grandparent/grandchildren. 3 = three hops.'),
        max_tokens: z.number().min(500).max(32000).optional().describe('Token budget for the response. Default: 4000. Increase for more detail, decrease for conciseness.'),
        include_related: z.boolean().optional().describe('Include semantically related items (default: true). Set false to skip semantic search and reduce latency.'),
        include_activity: z.boolean().optional().describe('Include recent activity timeline (default: true). Set false to skip activity and reduce response size.'),
      }),
    },
    async ({ task_id, query, depth, max_tokens, include_related, include_activity }) => {
      if (!task_id && !query) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Either task_id or query is required' }) }],
          isError: true,
        };
      }

      const result = await hydrateContext(
        {
          task_id,
          query,
          depth: depth ?? 1,
          max_tokens: max_tokens ?? 4000,
          include_related: include_related ?? true,
          include_activity: include_activity ?? true,
        },
        {
          getTask: (id) => storage.get(id),
          listTasks: (filter) => storage.listSync(filter),
          listResources: () => resourceManager.list(),
          searchUnified: async (q, options) => storage.searchUnified(q, options),
          readOperations: (options) => operationLogger.read(options),
        },
      );

      if (!result) {
        const target = task_id || query;
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Entity not found: ${target}` }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(formatResponse(result), null, 2) }],
      };
    },
  );
}

/**
 * Format the context response for MCP output.
 * Strips internal fields (fidelity) and produces clean JSON for agents.
 */
function formatResponse(ctx: ContextResponse) {
  const response: Record<string, unknown> = {
    focal: formatEntity(ctx.focal),
  };

  if (ctx.parent) {
    response.parent = formatEntity(ctx.parent);
  }

  if (ctx.children.length > 0) {
    response.children = ctx.children.map(formatEntity);
  }

  if (ctx.siblings.length > 0) {
    response.siblings = ctx.siblings.map(formatEntity);
  }

  if (ctx.cross_referenced.length > 0) {
    response.cross_referenced = ctx.cross_referenced.map(formatEntity);
  }

  if (ctx.referenced_by.length > 0) {
    response.referenced_by = ctx.referenced_by.map(formatEntity);
  }

  if (ctx.ancestors.length > 0) {
    response.ancestors = ctx.ancestors.map(formatEntity);
  }

  if (ctx.descendants.length > 0) {
    response.descendants = ctx.descendants.map(formatEntity);
  }

  if (ctx.related_resources.length > 0) {
    response.related_resources = ctx.related_resources.map(formatResource);
  }

  if (ctx.related.length > 0) {
    response.related = ctx.related.map(formatEntity);
  }

  if (ctx.activity.length > 0) {
    response.activity = ctx.activity;
  }

  if (ctx.session_summary) {
    response.session_summary = ctx.session_summary;
  }

  response.metadata = ctx.metadata;

  return response;
}

function formatEntity(entity: ContextResponse['focal']) {
  const out: Record<string, unknown> = {
    id: entity.id,
    title: entity.title,
    status: entity.status,
    type: entity.type,
  };
  if (entity.parent_id) out.parent_id = entity.parent_id;
  if (entity.description) out.description = entity.description;
  if (entity.evidence?.length) out.evidence = entity.evidence;
  if (entity.blocked_reason?.length) out.blocked_reason = entity.blocked_reason;
  if (entity.references?.length) out.references = entity.references;
  if (entity.created_at) out.created_at = entity.created_at;
  if (entity.updated_at) out.updated_at = entity.updated_at;
  if (entity.relevance_score != null) out.relevance_score = entity.relevance_score;
  if (entity.graph_depth != null) out.graph_depth = entity.graph_depth;
  return out;
}

function formatResource(resource: ContextResponse['related_resources'][0]) {
  const out: Record<string, unknown> = {
    uri: resource.uri,
    title: resource.title,
    path: resource.path,
  };
  if (resource.snippet) out.snippet = resource.snippet;
  if (resource.content) out.content = resource.content;
  if (resource.relevance_score != null) out.relevance_score = resource.relevance_score;
  return out;
}
