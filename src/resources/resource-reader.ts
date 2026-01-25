import { readFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { resolveMcpUri } from '../utils/uri-resolver.js';

export interface ResourceContent {
  content: string;
  frontmatter?: Record<string, any>;
  mimeType: string;
}

export function readMcpResource(uri: string): ResourceContent {
  const filePath = resolveMcpUri(uri);
  
  if (!existsSync(filePath)) {
    throw new Error(`Resource not found: ${uri}`);
  }
  
  const content = readFileSync(filePath, 'utf-8');
  const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
  
  const mimeMap: Record<string, string> = {
    md: 'text/markdown',
    json: 'application/json',
    ts: 'text/typescript',
    js: 'application/javascript',
    txt: 'text/plain',
  };
  
  const mimeType = mimeMap[ext] || 'text/plain';
  
  // Parse frontmatter for markdown files
  if (ext === 'md') {
    const parsed = matter(content);
    return {
      content: parsed.content,
      frontmatter: parsed.data,
      mimeType,
    };
  }
  
  return {
    content,
    mimeType,
  };
}
