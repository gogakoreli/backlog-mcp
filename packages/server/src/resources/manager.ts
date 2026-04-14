import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { paths } from '@/utils/paths.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Resource } from '@backlog-mcp/memory/search';

export interface ResourceContent {
  content: string;
  frontmatter?: Record<string, any>;
  mimeType: string;
}

/**
 * Extract title from markdown content.
 * Returns first # heading or filename without extension.
 */
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || filename.replace(/\.md$/, '');
}

/**
 * ResourceManager - Single point of responsibility for MCP resource operations.
 * 
 * Pure catch-all design: mcp://backlog/{+path} → {dataDir}/{path}
 * No special cases, no magic behavior.
 */
export class ResourceManager {
  constructor(private readonly dataDir: string) {}

  /**
   * List all resources in the resources/ directory.
   * Returns Resource objects ready for search indexing.
   */
  list(): Resource[] {
    const resourcesDir = join(this.dataDir, 'resources');
    if (!existsSync(resourcesDir)) return [];

    const resources: Resource[] = [];
    this.scanDirectory(resourcesDir, resources);
    return resources;
  }

  private scanDirectory(dir: string, resources: Resource[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, resources);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relativePath = relative(this.dataDir, fullPath);
          const uri = `mcp://backlog/${relativePath}`;
          
          resources.push({
            id: uri,
            path: relativePath,
            title: extractTitle(content, entry.name),
            content,
          });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  /**
   * Resolve MCP URI to absolute file path.
   * Pure catch-all: mcp://backlog/path/file.md → {dataDir}/path/file.md
   * 
   * @param uri MCP URI (must start with mcp://backlog/)
   * @returns Absolute file path
   * @throws Error if URI is invalid or contains path traversal
   */
  resolve(uri: string): string {
    if (!uri.startsWith('mcp://')) {
      throw new Error(`Not an MCP URI: ${uri}`);
    }

    // Check for path traversal BEFORE URL parsing (URL normalizes ..)
    if (uri.includes('..')) {
      throw new Error(`Path traversal not allowed: ${uri}`);
    }

    const url = new URL(uri);
    
    if (url.hostname !== 'backlog') {
      throw new Error(`Invalid hostname: ${url.hostname}. Expected 'backlog'`);
    }
    
    const path = url.pathname.substring(1); // Remove leading /
    
    return join(this.dataDir, path);
  }

  /**
   * Read resource content from MCP URI.
   * Parses frontmatter for markdown files and detects MIME type.
   * 
   * @param uri MCP URI
   * @returns Resource content with frontmatter and MIME type
   * @throws Error if file not found
   */
  read(uri: string): ResourceContent {
    const filePath = this.resolve(uri);
    
    if (!existsSync(filePath)) {
      // Helpful error for common mistake: extension-less task URIs
      if (/^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+$/.test(uri)) {
        throw new Error(
          `Task URIs must include .md extension. Did you mean: ${uri}.md?`
        );
      }
      throw new Error(`Resource not found: ${uri} (resolved to ${filePath})`);
    }
    
    const content = readFileSync(filePath, 'utf-8');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
    const mimeType = this.getMimeType(ext);
    
    // Parse frontmatter for markdown files
    if (ext === 'md') {
      const parsed = matter(content);
      return {
        content: parsed.content,
        frontmatter: Object.keys(parsed.data).length > 0 ? parsed.data : undefined,
        mimeType,
      };
    }
    
    return {
      content,
      mimeType,
    };
  }

  /**
   * Convert file path to MCP URI.
   * Pure mapping: {dataDir}/path/file.md → mcp://backlog/path/file.md
   * 
   * @param filePath Absolute file path
   * @returns MCP URI or null if file is outside data directory
   */
  toUri(filePath: string): string | null {
    if (!filePath.startsWith(this.dataDir)) {
      return null;
    }
    
    const relativePath = filePath.substring(this.dataDir.length + 1);
    return `mcp://backlog/${relativePath}`;
  }

  /**
   * Register MCP resource handler (catch-all pattern).
   */
  registerResource(server: McpServer) {
    const template = new ResourceTemplate(
      'mcp://backlog/{+path}',
      { list: undefined }
    );
    
    server.registerResource(
      'Data Directory Resource',
      template,
      { description: 'Any file in the backlog data directory' },
      async (uri) => {
        const resource = this.read(uri.toString());
        return { 
          contents: [{ 
            uri: uri.toString(), 
            mimeType: resource.mimeType, 
            text: resource.content 
          }] 
        };
      }
    );
  }

  private getMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      md: 'text/markdown',
      json: 'application/json',
      ts: 'text/typescript',
      js: 'application/javascript',
      txt: 'text/plain',
    };
    
    return mimeMap[ext] || 'text/plain';
  }
}

/**
 * Singleton instance for dependency injection.
 * Uses the configured backlog data directory.
 */
export const resourceManager = new ResourceManager(paths.backlogDataDir);
