import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getRepoRoot(): string {
  return join(__dirname, '..');
}

export function getBacklogDataDir(): string {
  return process.env.BACKLOG_DATA_DIR ?? 'data';
}

export function resolveMcpUri(uri: string): string {
  if (!uri.startsWith('mcp://')) {
    throw new Error(`Not an MCP URI: ${uri}`);
  }

  const url = new URL(uri);
  
  if (url.hostname !== 'backlog') {
    throw new Error(`Invalid MCP URI hostname: ${url.hostname}`);
  }
  
  const path = url.pathname.substring(1); // Remove leading /
  
  if (path.includes('..')) {
    throw new Error(`Path traversal not allowed: ${uri}`);
  }
  
  const dataDir = getBacklogDataDir();
  
  // Special case: tasks/{id}, tasks/{id}/file, tasks/{id}/description -> tasks/{id}.md
  if (path.startsWith('tasks/')) {
    const match = path.match(/^tasks\/([^/]+)(\/(?:file|description))?$/);
    if (match) {
      return join(dataDir, 'tasks', `${match[1]}.md`);
    }
  }
  
  // Everything else: direct mapping to dataDir/{path}
  return join(dataDir, path);
}

export function filePathToMcpUri(filePath: string): string | null {
  const dataDir = getBacklogDataDir();
  const repoRoot = getRepoRoot();
  
  // Check if it's a task file
  if (filePath.includes(`${dataDir}/tasks/`)) {
    const match = filePath.match(/(TASK-\d+|EPIC-\d+)\.md$/);
    if (match) {
      return `mcp://backlog/tasks/${match[1]}`;
    }
  }
  
  // Check if it's a repo resource
  if (filePath.startsWith(repoRoot)) {
    const relativePath = filePath.substring(repoRoot.length + 1);
    return `mcp://backlog/resources/${relativePath}`;
  }
  
  // Check if it's an artifact
  const dataDirParent = dirname(dataDir);
  if (filePath.startsWith(dataDirParent) && !filePath.startsWith(dataDir)) {
    const relativePath = filePath.substring(dataDirParent.length + 1);
    return `mcp://backlog/artifacts/${relativePath}`;
  }
  
  return null;
}
