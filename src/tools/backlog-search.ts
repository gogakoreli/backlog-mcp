import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import { STATUSES } from '../storage/schema.js';
import type { Task } from '../storage/schema.js';
import type { Resource, SearchableType } from '../search/types.js';

/**
 * backlog_search — Dedicated search tool for discovery across all backlog content.
 *
 * This is the MCP-first search interface (ADR-0073). It wraps the same
 * BacklogService.searchUnified() method that the HTTP GET /search endpoint uses,
 * ensuring agents get identical search quality to the web viewer UI.
 *
 * Use backlog_search for:
 *   - Finding tasks, epics, or resources by keyword or semantic similarity
 *   - Cross-type discovery ("find anything related to authentication")
 *   - Getting ranked results with relevance scores and match snippets
 *
 * Use backlog_list for:
 *   - Filtering by status/type/parent (structured browsing)
 *   - Getting counts and metadata
 */
export function registerBacklogSearchTool(server: McpServer) {
  server.registerTool(
    'backlog_search',
    {
      description: 'Search across all backlog content — tasks, epics, and resources. Returns relevance-ranked results with match context. Use this for discovery; use backlog_list for filtering by status/type.',
      inputSchema: z.object({
        query: z.string().describe('Search query. Supports keywords, phrases, and natural language. Fuzzy matching and semantic similarity are applied automatically.'),
        types: z.array(z.enum(['task', 'epic', 'resource'])).optional().describe('Filter results by type. Default: all types. Example: ["task", "epic"] to exclude resources.'),
        status: z.array(z.enum(STATUSES)).optional().describe('Filter tasks/epics by status. Default: all statuses. Example: ["open", "in_progress"] for active work only.'),
        parent_id: z.string().optional().describe('Scope search to items under a specific parent. Example: "EPIC-0001"'),
        sort: z.enum(['relevant', 'recent']).optional().describe('Sort mode. "relevant" (default) ranks by search relevance. "recent" ranks by last updated.'),
        limit: z.number().min(1).max(100).optional().describe('Max results to return. Default: 20, max: 100.'),
        include_content: z.boolean().optional().describe('Include full description/content in results. Default: false (returns snippets only). Set true when you need the full text.'),
        include_scores: z.boolean().optional().describe('Include relevance scores in results. Default: false.'),
      }),
    },
    async ({ query, types, status, parent_id, sort, limit, include_content, include_scores }) => {
      if (!query.trim()) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Query must not be empty' }) }], isError: true };
      }

      const results = await storage.searchUnified(query, {
        types: types as SearchableType[] | undefined,
        status,
        parent_id,
        sort: sort ?? 'relevant',
        limit: limit ?? 20,
      });

      const searchMode = storage.isHybridSearchActive() ? 'hybrid' : 'bm25';

      const formattedResults = results.map(r => {
        const isResource = r.type === 'resource';

        if (isResource) {
          const resource = r.item as Resource;
          const result: Record<string, unknown> = {
            id: resource.id,
            title: resource.title,
            type: 'resource',
            path: resource.path,
          };
          if (r.snippet) {
            result.snippet = r.snippet.text;
            result.matched_fields = r.snippet.matched_fields;
          }
          if (include_scores) result.score = Math.round(r.score * 1000) / 1000;
          if (include_content) result.content = resource.content;
          return result;
        }

        // Task or Epic
        const task = r.item as Task;
        const result: Record<string, unknown> = {
          id: task.id,
          title: task.title,
          type: r.type,
          status: task.status,
        };
        const parentId = task.parent_id ?? task.epic_id;
        if (parentId) result.parent_id = parentId;
        if (r.snippet) {
          result.snippet = r.snippet.text;
          result.matched_fields = r.snippet.matched_fields;
        }
        if (include_scores) result.score = Math.round(r.score * 1000) / 1000;
        if (include_content) result.description = task.description;
        return result;
      });

      const response = {
        results: formattedResults,
        total: formattedResults.length,
        query,
        search_mode: searchMode,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }
  );
}
