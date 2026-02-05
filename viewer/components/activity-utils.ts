/**
 * Activity panel grouping and aggregation functions.
 * Extracted for testability.
 */

import { getLocalDateKey, formatRelativeDay } from '../utils/date.js';

export interface Actor {
  type: 'user' | 'agent';
  name: string;
  delegatedBy?: string;
  taskContext?: string;
}

export interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  resourceTitle?: string;
  epicId?: string;
  epicTitle?: string;
  actor?: Actor;
}

export interface DayGroup {
  dateKey: string;
  label: string;
  operations: OperationEntry[];
}

export interface TaskGroup {
  resourceId: string;
  title: string;
  epicId?: string;
  epicTitle?: string;
  operations: OperationEntry[];
  mostRecentTs: string;
}

export interface JournalEntry {
  resourceId: string;
  title: string;
  epicId?: string;
  epicTitle?: string;
}

export interface EpicGroup {
  epicId: string | null;
  epicTitle: string;
  entries: JournalEntry[];
}

export interface JournalData {
  completed: JournalEntry[];
  inProgress: JournalEntry[];
  created: JournalEntry[];
  updated: JournalEntry[];
}

/**
 * Group operations by day (local timezone).
 * Returns groups sorted by date descending (most recent first).
 */
export function groupByDay(operations: OperationEntry[]): DayGroup[] {
  const groups = new Map<string, OperationEntry[]>();
  
  for (const op of operations) {
    const date = new Date(op.ts);
    const dateKey = getLocalDateKey(date);
    if (!dateKey) continue; // Skip invalid timestamps
    
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    const group = groups.get(dateKey);
    if (group) {
      group.push(op);
    }
  }
  
  // Sort by date descending (most recent first)
  const sortedKeys = Array.from(groups.keys()).sort().reverse();
  
  return sortedKeys.map(dateKey => ({
    dateKey,
    label: formatRelativeDay(dateKey),
    operations: groups.get(dateKey) ?? [],
  }));
}

/**
 * Group operations by task within a day.
 * Returns groups sorted by most recent operation (descending).
 */
export function groupByTask(operations: OperationEntry[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  
  for (const op of operations) {
    const resourceId = op.resourceId || '_no_task_';
    const title = op.resourceTitle || (op.params.title as string) || resourceId;
    
    if (!groups.has(resourceId)) {
      groups.set(resourceId, {
        resourceId,
        title,
        epicId: op.epicId,
        epicTitle: op.epicTitle,
        operations: [],
        mostRecentTs: op.ts,
      });
    }
    
    const group = groups.get(resourceId);
    if (group) {
      group.operations.push(op);
      // Update most recent timestamp if this operation is newer
      if (op.ts > group.mostRecentTs) {
        group.mostRecentTs = op.ts;
      }
      // Update epicId/epicTitle if not set
      if (!group.epicId && op.epicId) {
        group.epicId = op.epicId;
        group.epicTitle = op.epicTitle;
      }
    }
  }
  
  // Sort groups by most recent operation (descending)
  return Array.from(groups.values())
    .sort((a, b) => b.mostRecentTs.localeCompare(a.mostRecentTs));
}

/**
 * Aggregate operations for journal view.
 * Categorizes tasks by their most significant status change.
 */
export function aggregateForJournal(operations: OperationEntry[]): JournalData {
  const completed: JournalEntry[] = [];
  const inProgress: JournalEntry[] = [];
  const created: JournalEntry[] = [];
  const updated: JournalEntry[] = [];
  
  const seenCompleted = new Set<string>();
  const seenInProgress = new Set<string>();
  const seenCreated = new Set<string>();
  const seenUpdated = new Set<string>();
  
  for (const op of operations) {
    const resourceId = op.resourceId;
    if (!resourceId) continue;
    
    // Use resourceTitle from server enrichment, fall back to params.title or resourceId
    const title = op.resourceTitle || (op.params.title as string) || resourceId;
    const epicId = op.epicId;
    const epicTitle = op.epicTitle;
    
    if (op.tool === 'backlog_create') {
      if (!seenCreated.has(resourceId)) {
        seenCreated.add(resourceId);
        created.push({ resourceId, title, epicId, epicTitle });
      }
    } else if (op.tool === 'backlog_update') {
      const status = op.params.status as string | undefined;
      if (status === 'done' && !seenCompleted.has(resourceId)) {
        seenCompleted.add(resourceId);
        completed.push({ resourceId, title, epicId, epicTitle });
      } else if (status === 'in_progress' && !seenInProgress.has(resourceId)) {
        seenInProgress.add(resourceId);
        inProgress.push({ resourceId, title, epicId, epicTitle });
      } else if (!seenUpdated.has(resourceId) && !seenCompleted.has(resourceId) && !seenInProgress.has(resourceId)) {
        seenUpdated.add(resourceId);
        updated.push({ resourceId, title, epicId, epicTitle });
      }
    }
  }
  
  return { completed, inProgress, created, updated };
}

/**
 * Group journal entries by epic.
 * Returns groups sorted by epic title, with "No Epic" at the end.
 */
export function groupByEpic(entries: JournalEntry[]): EpicGroup[] {
  const groups = new Map<string | null, EpicGroup>();
  
  for (const entry of entries) {
    const key = entry.epicId || null;
    
    if (!groups.has(key)) {
      groups.set(key, {
        epicId: key,
        epicTitle: entry.epicTitle || (key ? key : 'No Epic'),
        entries: [],
      });
    }
    
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    }
  }
  
  // Sort: epics with titles first (alphabetically), then "No Epic" last
  return Array.from(groups.values()).sort((a, b) => {
    if (a.epicId === null) return 1;
    if (b.epicId === null) return -1;
    return a.epicTitle.localeCompare(b.epicTitle);
  });
}

/**
 * Get human-readable label for a tool.
 */
export function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    backlog_create: 'Created',
    backlog_update: 'Updated',
    backlog_delete: 'Deleted',
    write_resource: 'Wrote',
  };
  return labels[tool] || tool;
}

/**
 * Get emoji icon for a tool.
 */
export function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    backlog_create: '➕',
    backlog_update: '✏️',
    backlog_delete: '🗑️',
    write_resource: '📝',
  };
  return icons[tool] || '⚡';
}
