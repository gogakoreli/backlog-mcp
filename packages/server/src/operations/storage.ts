/**
 * JSONL storage for operation entries.
 * Single responsibility: read/write operations to disk.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from '@/utils/paths.js';
import { utcToLocalDateKey } from '@/utils/date.js';
import type { OperationEntry, OperationFilter } from './types.js';

export class OperationStorage {
  private logPath: string;

  constructor() {
    this.logPath = join(paths.backlogDataDir, '.internal', 'operations.jsonl');
  }

  /**
   * Append an operation entry to the log file.
   */
  append(entry: OperationEntry): void {
    try {
      const dir = dirname(this.logPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Fail silently - logging should not break tool execution
    }
  }

  /**
   * Read all operations from the log file.
   */
  readAll(): OperationEntry[] {
    if (!existsSync(this.logPath)) return [];

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      return lines
        .map(line => {
          try {
            return JSON.parse(line) as OperationEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is OperationEntry => e !== null);
    } catch {
      return [];
    }
  }

  /**
   * Query operations with optional filtering.
   */
  query(filter: OperationFilter = {}): OperationEntry[] {
    const { taskId, date, tzOffset, limit = 50 } = filter;
    
    let entries = this.readAll();

    if (taskId) {
      entries = entries.filter(e => e.resourceId === taskId);
    }

    if (date) {
      entries = entries.filter(e => {
        const localDate = tzOffset != null
          ? utcToLocalDateKey(e.ts, tzOffset)
          : e.ts.slice(0, 10);
        return localDate === date;
      });
    }

    // Return most recent first, limited
    return entries.reverse().slice(0, limit);
  }

  /**
   * Count operations for a specific task.
   */
  countForTask(taskId: string): number {
    return this.query({ taskId, limit: 1000 }).length;
  }
}
