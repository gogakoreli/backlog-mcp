import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { resourceManager } from '../resources/manager.js';
import { hydrateContext, type ContextResponse } from '../context/index.js';

/**
 * backlog_context — Agent context hydration tool (ADR-0074).
 *
 * Provides a single-call context bundle for agents working on backlog tasks.
 * Replaces the 5-10 manual tool calls an agent would otherwise need to
 * understand a task's full context (parent, siblings, children, resources).
 *
 * Use backlog_context for:
 *   - "I'm about to work on TASK-X, give me everything I need to know"
 *   - Understanding a task's place in the broader backlog
 *   - Discovering related resources (ADRs, design docs) attached to a task or its epic
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
      description: 'Get full context for working on a task — parent epic, sibling tasks, children, and related resources in a single call. Use this before starting work on any task to understand its context.',
      inputSchema: z.object({
        task_id: z.string().describe('Task or epic ID to get context for. Example: "TASK-0042" or "EPIC-0005".'),
        depth: z.number().min(1).max(3).optional().describe('Relational expansion depth. 1 = direct relations (default). Depth 2+ reserved for future use.'),
        max_tokens: z.number().min(500).max(32000).optional().describe('Token budget for the response. Default: 4000. Increase for more detail, decrease for conciseness.'),
      }),
    },
    async ({ task_id, depth, max_tokens }) => {
      const result = hydrateContext(
        {
          task_id,
          depth: depth ?? 1,
          max_tokens: max_tokens ?? 4000,
        },
        {
          getTask: (id) => storage.get(id),
          listTasks: (filter) => storage.listSync(filter),
          listResources: () => resourceManager.list(),
        },
      );

      if (!result) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Entity not found: ${task_id}` }) }],
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

  if (ctx.related_resources.length > 0) {
    response.related_resources = ctx.related_resources.map(formatResource);
  }

  if (ctx.related.length > 0) {
    response.related = ctx.related.map(formatEntity);
  }

  if (ctx.activity.length > 0) {
    response.activity = ctx.activity;
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
  return out;
}
