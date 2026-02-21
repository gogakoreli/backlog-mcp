import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { paths } from '@/utils/paths.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Operation, WriteResourceResult } from './types.js';
import { applyOperation } from './operations.js';
import type { Resource } from '@/search/types.js';

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
   * Check if a URI points to a task file.
   */
  private isTaskUri(uri: string): boolean {
    return uri.startsWith('mcp://backlog/tasks/');
  }

  /**
   * Update the updated_at timestamp in task frontmatter.
   */
  private updateTaskTimestamp(content: string): string {
    const parsed = matter(content);
    if (parsed.data && typeof parsed.data === 'object') {
      parsed.data.updated_at = new Date().toISOString();
      return matter.stringify(parsed.content, parsed.data);
    }
    return content;
  }

  /**
   * Write/modify resource content.
   * Applies operations like str_replace, append, insert, etc.
   * For task files, automatically updates the updated_at timestamp.
   * 
   * @param uri MCP URI
   * @param operation Operation to apply
   * @returns Result with success status and message
   */
  write(uri: string, operation: Operation): WriteResourceResult {
    try {
      const filePath = this.resolve(uri);
      const canCreate = ['create', 'append', 'insert'].includes(operation.type);
      const isTask = this.isTaskUri(uri);
      
      if (!existsSync(filePath)) {
        if (canCreate) {
          // Auto-create file and parent directories
          mkdirSync(dirname(filePath), { recursive: true });
          writeFileSync(filePath, '', 'utf-8');
        } else {
          // str_replace/delete need existing content
          return {
            success: false,
            message: 'File not found',
            error: `Resource not found: ${uri} (${operation.type} requires existing file)`,
          };
        }
      }

      const fileContent = readFileSync(filePath, 'utf-8');

      // Prevent create from overwriting existing task files — use str_replace or backlog_update instead
      if (isTask && operation.type === 'create' && fileContent) {
        return {
          success: false,
          message: 'Cannot overwrite existing task file',
          error: `${uri} already exists. Use str_replace to edit content, or backlog_update to update metadata.`,
        };
      }

      let newContent = applyOperation(fileContent, operation);
      
      // Update timestamp for task files
      if (isTask) {
        newContent = this.updateTaskTimestamp(newContent);
      }
      
      writeFileSync(filePath, newContent, 'utf-8');

      return {
        success: true,
        message: `Successfully applied ${operation.type} to ${uri}`,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Operation failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
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

  /**
   * Register write_resource MCP tool.
   */
  registerWriteTool(server: McpServer) {
    server.registerTool(
      'write_resource',
      {
        description: `A tool for creating and editing files on the MCP server
 * The \`create\` command will override the file at \`uri\` if it already exists as a file, and otherwise create a new file
 * The \`append\` command will add content to the end of a file, automatically adding a newline if the file doesn't end with one. Creates the file if it doesn't exist.
 Notes for using the \`str_replace\` command:
 * The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
 * If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
 * The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
        inputSchema: z.object({
          uri: z.string().describe('MCP resource URI, e.g. mcp://backlog/path/to/file.md'),
          operation: z.preprocess(
            // Workaround: MCP clients stringify object params with $ref/oneOf schemas
            // https://github.com/anthropics/claude-code/issues/18260
            (val) => typeof val === 'string' ? JSON.parse(val) : val,
            z.discriminatedUnion('type', [
            z.object({
              type: z.literal('create'),
              file_text: z.string().describe('Content of the file to be created'),
            }),
            z.object({
              type: z.literal('str_replace'),
              old_str: z.string().describe('String in file to replace (must match exactly)'),
              new_str: z.string().describe('New string to replace old_str with'),
            }),
            z.object({
              type: z.literal('insert'),
              insert_line: z.number().describe('Line number after which new_str will be inserted'),
              new_str: z.string().describe('String to insert'),
            }),
            z.object({
              type: z.literal('append'),
              new_str: z.string().describe('Content to append to the file'),
            }),
          ])).describe('Operation to apply'),
        }),
      },
      async ({ uri, operation }) => {
        const result = this.write(uri, operation);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
