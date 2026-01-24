// Main write_resource implementation

import { readFileSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import type { Operation, WriteResourceResult } from './types.js';
import { parseURI } from './uri.js';
import { applyOperation } from './operations.js';

export interface WriteResourceParams {
  uri: string;
  operation: Operation;
}

export function writeResource(
  params: WriteResourceParams,
  getFilePath: (taskId: string) => string | null,
  resolvePath: (uri: string) => string
): WriteResourceResult {
  try {
    // Parse URI
    const parsed = parseURI(params.uri);
    if (!parsed) {
      return {
        success: false,
        message: 'Invalid URI format',
        error: 'Expected format: mcp://backlog/...',
      };
    }

    if (parsed.server !== 'backlog') {
      return {
        success: false,
        message: `Unknown server: ${parsed.server}`,
        error: 'Only "backlog" server is supported',
      };
    }

    // Handle task field edits (description/file)
    if (parsed.taskId && parsed.field) {
      const filePath = getFilePath(parsed.taskId);
      if (!filePath) {
        return {
          success: false,
          message: `Task not found: ${parsed.taskId}`,
          error: `No file found for task ${parsed.taskId}`,
        };
      }

      const fileContent = readFileSync(filePath, 'utf-8');
      const { data: frontmatter, content: description } = matter(fileContent);

      let newContent: string;
      
      if (parsed.field === 'description') {
        newContent = applyOperation(description, params.operation);
        const newFile = matter.stringify(newContent, frontmatter);
        writeFileSync(filePath, newFile, 'utf-8');
      } else if (parsed.field === 'file') {
        newContent = applyOperation(fileContent, params.operation);
        writeFileSync(filePath, newContent, 'utf-8');
      } else {
        return {
          success: false,
          message: `Unsupported field: ${parsed.field}`,
          error: 'Only "description" and "file" fields are supported for editing',
        };
      }

      return {
        success: true,
        message: `Successfully applied ${params.operation.type} to ${params.uri}`,
      };
    }

    // Handle general file operations (artifacts, resources, etc.)
    const filePath = resolvePath(params.uri);
    const fileContent = readFileSync(filePath, 'utf-8');
    const newContent = applyOperation(fileContent, params.operation);
    writeFileSync(filePath, newContent, 'utf-8');

    return {
      success: true,
      message: `Successfully applied ${params.operation.type} to ${params.uri}`,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Operation failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
