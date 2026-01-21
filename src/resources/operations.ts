// Apply operations to text content

import type { Operation } from './types.js';

export function applyOperation(content: string, operation: Operation): string {
  switch (operation.type) {
    case 'str_replace': {
      const { old_str, new_str } = operation;
      if (!content.includes(old_str)) {
        throw new Error(`str_replace failed: old_str not found in content`);
      }
      return content.replace(old_str, new_str);
    }

    case 'append': {
      return content + operation.content;
    }

    case 'prepend': {
      return operation.content + content;
    }

    case 'insert': {
      const lines = content.split('\n');
      if (operation.line < 0 || operation.line > lines.length) {
        throw new Error(`insert failed: line ${operation.line} out of range (0-${lines.length})`);
      }
      lines.splice(operation.line, 0, operation.content);
      return lines.join('\n');
    }

    case 'delete': {
      if (!content.includes(operation.content)) {
        throw new Error(`delete failed: content not found`);
      }
      return content.replace(operation.content, '');
    }

    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}
