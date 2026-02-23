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
    // For write_resource without a task ID, group by URI path
    const resourceId = op.resourceId
      || (op.tool === 'write_resource' && op.params.uri ? op.params.uri as string : '')
      || '_no_task_';
    const title = op.resourceTitle || (op.params.title as string)
      || (op.tool === 'write_resource' && op.params.uri ? (op.params.uri as string).replace('mcp://backlog/', '') : '')
      || resourceId;
    
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

const MERGE_WINDOW_MS = 30000; // 30 seconds

interface StrReplaceOp {
  type: 'str_replace';
  old_str: string;
  new_str: string;
}

function isStrReplace(op: OperationEntry): op is OperationEntry & { params: { uri: string; operation: StrReplaceOp } } {
  if (op.tool !== 'write_resource') return false;
  const operation = op.params.operation as { type?: string } | undefined;
  return operation?.type === 'str_replace';
}

/**
 * Merge consecutive str_replace operations on the same URI within a time window.
 * Operations are in reverse chronological order (newest first).
 * Stores all operations in _mergedOps for stacked diff rendering.
 */
export function mergeConsecutiveEdits(operations: OperationEntry[]): OperationEntry[] {
  if (operations.length <= 1) return operations;
  
  const result: OperationEntry[] = [];
  let i = 0;
  
  while (i < operations.length) {
    const current = operations[i];
    if (!current) { i++; continue; }
    
    if (!isStrReplace(current)) {
      result.push(current);
      i++;
      continue;
    }
    
    // Start a merge group
    const group: OperationEntry[] = [current];
    const uri = current.params.uri;
    let j = i + 1;
    
    // Collect consecutive str_replace ops on same URI within time window
    while (j < operations.length) {
      const next = operations[j];
      if (!next || !isStrReplace(next) || next.params.uri !== uri) break;
      
      // Check time gap (operations are newest-first, so group[last] is older)
      const prev = group[group.length - 1];
      if (!prev) break;
      const newerTs = new Date(prev.ts).getTime();
      const olderTs = new Date(next.ts).getTime();
      if (newerTs - olderTs > MERGE_WINDOW_MS) break;
      
      group.push(next);
      j++;
    }
    
    if (group.length === 1) {
      result.push(current);
    } else {
      // Create merged operation with all individual ops for stacked rendering
      const newest = group[0] ?? current;
      const oldest = group[group.length - 1] ?? current;
      
      const merged: OperationEntry = {
        ...newest,
        params: {
          ...newest.params,
          _mergedCount: group.length,
          _mergedOps: group, // Store all ops for stacked diff rendering
          _mergedRange: { from: oldest.ts, to: newest.ts },
        },
      };
      result.push(merged);
    }
    
    i = j;
  }
  
  return result;
}

/**
 * Aggregate operations for journal view.
 * Categorizes tasks by their most significant status change.
 * Each task appears in only ONE category (highest priority wins):
 * completed > in_progress > created > updated
 */
export function aggregateForJournal(operations: OperationEntry[]): JournalData {
  const completed: JournalEntry[] = [];
  const inProgress: JournalEntry[] = [];
  const created: JournalEntry[] = [];
  const updated: JournalEntry[] = [];
  
  // Track the highest priority state for each task
  const taskState = new Map<string, { state: 'completed' | 'in_progress' | 'created' | 'updated'; title: string; epicId?: string; epicTitle?: string }>();
  
  // Process operations (newest first) to find the latest state
  for (const op of operations) {
    const resourceId = op.resourceId;
    if (!resourceId) continue;
    
    const title = op.resourceTitle || (op.params.title as string) || resourceId;
    const epicId = op.epicId;
    const epicTitle = op.epicTitle;
    const entry = { title, epicId, epicTitle };
    
    const existing = taskState.get(resourceId);
    
    if (op.tool === 'backlog_update') {
      const status = op.params.status as string | undefined;
      if (status === 'done') {
        // Completed is highest priority - always set
        if (!existing || existing.state !== 'completed') {
          taskState.set(resourceId, { state: 'completed', ...entry });
        }
      } else if (status === 'in_progress') {
        // In progress beats created/updated
        if (!existing || (existing.state !== 'completed' && existing.state !== 'in_progress')) {
          taskState.set(resourceId, { state: 'in_progress', ...entry });
        }
      } else if (!existing) {
        // Generic update - lowest priority
        taskState.set(resourceId, { state: 'updated', ...entry });
      }
    } else if (op.tool === 'backlog_create') {
      // Created beats updated only
      if (!existing || existing.state === 'updated') {
        taskState.set(resourceId, { state: 'created', ...entry });
      }
    }
  }
  
  // Build result arrays
  for (const [resourceId, data] of taskState) {
    const entry: JournalEntry = { resourceId, title: data.title, epicId: data.epicId, epicTitle: data.epicTitle };
    switch (data.state) {
      case 'completed': completed.push(entry); break;
      case 'in_progress': inProgress.push(entry); break;
      case 'created': created.push(entry); break;
      case 'updated': updated.push(entry); break;
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
