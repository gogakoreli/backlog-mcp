// URI parser for mcp:// scheme

export interface ParsedURI {
  server: string;
  resource: string;
  taskId?: string;
  field?: string;
}

export function parseURI(uri: string): ParsedURI | null {
  // Expected format: mcp://backlog/tasks/TASK-0039/description
  const match = uri.match(/^mcp:\/\/([^\/]+)\/(.+)$/);
  if (!match) return null;

  const [, server, resource] = match;
  
  if (!server || !resource) return null;
  
  // Parse resource path
  const parts = resource.split('/');
  
  // For backlog: tasks/TASK-0039/description
  if (parts[0] === 'tasks' && parts.length >= 2) {
    return {
      server,
      resource,
      taskId: parts[1],
      field: parts[2] || 'file', // default to full file
    };
  }

  return { server, resource };
}
