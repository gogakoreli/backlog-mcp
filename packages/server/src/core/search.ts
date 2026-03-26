import type { Entity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import type { Resource, SearchableType } from '../search/types.js';
import { ValidationError, type SearchParams, type SearchResult, type SearchResultItem } from './types.js';

function isResource(type: string): boolean {
  return type === 'resource';
}

export async function searchItems(service: IBacklogService, params: SearchParams): Promise<SearchResult> {
  const { query, types, status, parent_id, sort, limit, include_content, include_scores } = params;

  if (!query.trim()) throw new ValidationError('Query must not be empty');

  const results = await service.searchUnified(query, {
    types: types as SearchableType[] | undefined,
    status,
    parent_id,
    sort: sort ?? 'relevant',
    limit: limit ?? 20,
  });

  const searchMode = service.isHybridSearchActive?.() ?? false ? 'hybrid' : 'bm25';

  const formattedResults: SearchResultItem[] = results.map(r => {
    if (isResource(r.type)) {
      const resource = r.item as Resource;
      const item: SearchResultItem = { id: resource.id, title: resource.title, type: 'resource', path: resource.path };
      if (r.snippet) { item.snippet = r.snippet.text; item.matched_fields = r.snippet.matched_fields; }
      if (include_scores) item.score = Math.round(r.score * 1000) / 1000;
      if (include_content) item.content = resource.content;
      return item;
    }

    const task = r.item as Entity;
    const item: SearchResultItem = { id: task.id, title: task.title, type: r.type, status: task.status };
    const parentId = task.parent_id ?? task.epic_id;
    if (parentId) item.parent_id = parentId;
    if (r.snippet) { item.snippet = r.snippet.text; item.matched_fields = r.snippet.matched_fields; }
    if (include_scores) item.score = Math.round(r.score * 1000) / 1000;
    if (include_content) item.description = task.description;
    return item;
  });

  return { results: formattedResults, total: formattedResults.length, query, search_mode: searchMode };
}
