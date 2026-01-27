import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { paths } from '@/utils/paths.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Operation, WriteResourceResult } from './types.js';
import { applyOperation } from './operations.js';

export interface ResourceContent {
  content: string;
  frontmatter?: Record<string, any>;
  mimeType: string;
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
   * Write/modify resource content.
   * Applies operations like str_replace, append, insert, etc.
   * 
   * @param uri MCP URI
   * @param operation Operation to apply
   * @returns Result with success status and message
   */
  write(uri: string, operation: Operation): WriteResourceResult {
    try {
      const filePath = this.resolve(uri);
      
      if (!existsSync(filePath)) {
        // Helpful error for common mistake: extension-less task URIs
        if (/^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+$/.test(uri)) {
          return {
            success: false,
            message: 'Task URIs must include .md extension',
            error: `Did you mean: ${uri}.md?`,
          };
        }
        return {
          success: false,
          message: 'File not found',
          error: `Resource not found: ${uri}`,
        };
      }

      const fileContent = readFileSync(filePath, 'utf-8');
      const newContent = applyOperation(fileContent, operation);
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
        description: 'Write/modify resource content with operations like str_replace, append, insert',
        inputSchema: z.object({
          uri: z.string().describe('MCP URI (mcp://backlog/path/file.md)'),
          operation: z.discriminatedUnion('type', [
            z.object({
              type: z.literal('str_replace'),
              old_str: z.string().describe('String to find and replace'),
              new_str: z.string().describe('Replacement string'),
            }),
            z.object({
              type: z.literal('append'),
              content: z.string().describe('Content to append'),
            }),
            z.object({
              type: z.literal('prepend'),
              content: z.string().describe('Content to prepend'),
            }),
            z.object({
              type: z.literal('insert'),
              line: z.number().describe('Line number to insert at (0-based)'),
              content: z.string().describe('Content to insert'),
            }),
            z.object({
              type: z.literal('delete'),
              content: z.string().describe('Content to delete'),
            }),
          ]).describe('Operation to apply'),
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
