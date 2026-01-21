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
  getFilePath: (taskId: string) => string | null
): WriteResourceResult {
  try {
    // Parse URI
    const parsed = parseURI(params.uri);
    if (!parsed) {
      return {
        success: false,
        message: 'Invalid URI format',
        error: 'Expected format: mcp://backlog/tasks/TASK-0039/description',
      };
    }

    if (parsed.server !== 'backlog') {
      return {
        success: false,
        message: `Unknown server: ${parsed.server}`,
        error: 'Only "backlog" server is supported',
      };
    }

    if (!parsed.taskId) {
      return {
        success: false,
        message: 'Task ID not found in URI',
        error: 'Expected format: mcp://backlog/tasks/TASK-0039/description',
      };
    }

    // Get file path
    const filePath = getFilePath(parsed.taskId);
    if (!filePath) {
      return {
        success: false,
        message: `Task not found: ${parsed.taskId}`,
        error: `No file found for task ${parsed.taskId}`,
      };
    }

    // Read file
    const fileContent = readFileSync(filePath, 'utf-8');
    const { data: frontmatter, content: description } = matter(fileContent);

    // Apply operation based on field
    let newContent: string;
    
    if (parsed.field === 'description') {
      // Edit description (markdown body)
      newContent = applyOperation(description, params.operation);
      // Write back
      const newFile = matter.stringify(newContent, frontmatter);
      writeFileSync(filePath, newFile, 'utf-8');
    } else if (parsed.field === 'file') {
      // Edit entire file
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
  } catch (error) {
    return {
      success: false,
      message: 'Operation failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
