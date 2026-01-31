// Apply operations to text content (mirrors fs_write semantics)

import type { Operation } from './types.js';

export function applyOperation(content: string, operation: Operation): string {
  switch (operation.type) {
    case 'create': {
      return operation.file_text;
    }

    case 'str_replace': {
      const { old_str, new_str } = operation;
      if (!content.includes(old_str)) {
        throw new Error(`str_replace failed: old_str not found in content`);
      }
      // Check uniqueness - fail if old_str appears more than once
      const firstIndex = content.indexOf(old_str);
      const secondIndex = content.indexOf(old_str, firstIndex + 1);
      if (secondIndex !== -1) {
        throw new Error(`str_replace failed: old_str is not unique in file. Include more context to make it unique.`);
      }
      return content.replace(old_str, new_str);
    }

    case 'insert': {
      // insert_line: insert AFTER this line (1-based, like fs_write)
      const lines = content.split('\n');
      const lineNum = operation.insert_line;
      if (lineNum < 0 || lineNum > lines.length) {
        throw new Error(`insert failed: line ${lineNum} out of range (0-${lines.length})`);
      }
      lines.splice(lineNum, 0, operation.new_str);
      return lines.join('\n');
    }

    case 'append': {
      // Add newline if file doesn't end with one (like fs_write)
      const needsNewline = content.length > 0 && !content.endsWith('\n');
      return content + (needsNewline ? '\n' : '') + operation.new_str;
    }

    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}
