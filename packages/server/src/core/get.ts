import type { IBacklogService } from '../storage/service-types.js';
import { ValidationError, type GetParams, type GetResult, type GetItem } from './types.js';

function isResourceUri(id: string): boolean {
  return id.startsWith('mcp://backlog/');
}

async function fetchItem(id: string, service: IBacklogService): Promise<GetItem> {
  if (isResourceUri(id)) {
    const resource = service.getResource?.(id);
    if (!resource) return { id, content: null };
    const header = `# Resource: ${id}\nMIME: ${resource.mimeType}`;
    const frontmatterStr = resource.frontmatter
      ? `\nFrontmatter: ${JSON.stringify(resource.frontmatter)}`
      : '';
    return { id, content: `${header}${frontmatterStr}\n\n${resource.content}` };
  }
  const markdown = await service.getMarkdown(id);
  return { id, content: markdown };
}

export async function getItems(service: IBacklogService, params: GetParams): Promise<GetResult> {
  if (params.ids.length === 0) throw new ValidationError('Required: id');
  const items = await Promise.all(params.ids.map((id) => fetchItem(id, service)));
  return { items };
}
