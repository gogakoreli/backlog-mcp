// URI parser for mcp:// scheme

export interface ParsedURI {
  server: string;
  resource: string;
  taskId?: string;
  field?: string;
}

export function parseURI(uri: string): ParsedURI | null {
  // Expected format: mcp://backlog/{resource}
  const match = uri.match(/^mcp:\/\/([^\/]+)\/(.+)$/);
  if (!match) return null;

  const [, server, resource] = match;
  
  if (!server || !resource) return null;
  
  // Check if it's a task field edit: tasks/{id}/description or tasks/{id}/file
  const taskMatch = resource.match(/^tasks\/([^\/]+)(?:\/(description|file))?$/);
  if (taskMatch) {
    return {
      server,
      resource,
      taskId: taskMatch[1],
      field: taskMatch[2] || 'file',
    };
  }

  // General resource (artifacts, resources, etc.)
  return {
    server,
    resource,
  };
}
