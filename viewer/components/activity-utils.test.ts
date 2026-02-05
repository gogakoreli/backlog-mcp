import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  groupByDay,
  groupByTask,
  aggregateForJournal,
  groupByEpic,
  getToolLabel,
  getToolIcon,
  mergeConsecutiveEdits,
  type OperationEntry,
  type JournalEntry,
} from './activity-utils.js';

describe('activity-utils', () => {
  beforeEach(() => {
    // Mock Date.now to Feb 5, 2026 at noon
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 5, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('groupByDay', () => {
    it('groups operations by date', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_create', params: {}, result: {} },
        { ts: '2026-02-05T11:00:00Z', tool: 'backlog_update', params: {}, result: {} },
        { ts: '2026-02-04T09:00:00Z', tool: 'backlog_create', params: {}, result: {} },
      ];

      const groups = groupByDay(operations);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].operations).toHaveLength(2); // Feb 5
      expect(groups[1].operations).toHaveLength(1); // Feb 4
    });

    it('sorts groups by date descending', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-03T10:00:00Z', tool: 'backlog_create', params: {}, result: {} },
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_create', params: {}, result: {} },
        { ts: '2026-02-04T10:00:00Z', tool: 'backlog_create', params: {}, result: {} },
      ];

      const groups = groupByDay(operations);
      
      expect(groups[0].dateKey).toBe('2026-02-05');
      expect(groups[1].dateKey).toBe('2026-02-04');
      expect(groups[2].dateKey).toBe('2026-02-03');
    });

    it('returns empty array for empty input', () => {
      expect(groupByDay([])).toEqual([]);
    });

    it('skips operations with invalid timestamps', () => {
      const operations: OperationEntry[] = [
        { ts: 'invalid', tool: 'backlog_create', params: {}, result: {} },
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_create', params: {}, result: {} },
      ];

      const groups = groupByDay(operations);
      
      expect(groups).toHaveLength(1);
      expect(groups[0].operations).toHaveLength(1);
    });
  });

  describe('groupByTask', () => {
    it('groups operations by resourceId', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: {}, result: {}, resourceId: 'TASK-0001' },
        { ts: '2026-02-05T11:00:00Z', tool: 'backlog_update', params: {}, result: {}, resourceId: 'TASK-0001' },
        { ts: '2026-02-05T09:00:00Z', tool: 'backlog_create', params: {}, result: {}, resourceId: 'TASK-0002' },
      ];

      const groups = groupByTask(operations);
      
      expect(groups).toHaveLength(2);
    });

    it('sorts groups by most recent operation', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T09:00:00Z', tool: 'backlog_create', params: {}, result: {}, resourceId: 'TASK-0001' },
        { ts: '2026-02-05T11:00:00Z', tool: 'backlog_update', params: {}, result: {}, resourceId: 'TASK-0002' },
      ];

      const groups = groupByTask(operations);
      
      expect(groups[0].resourceId).toBe('TASK-0002'); // More recent
      expect(groups[1].resourceId).toBe('TASK-0001');
    });

    it('uses resourceTitle when available', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: {}, result: {}, resourceId: 'TASK-0001', resourceTitle: 'My Task' },
      ];

      const groups = groupByTask(operations);
      
      expect(groups[0].title).toBe('My Task');
    });

    it('falls back to params.title', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_create', params: { title: 'Created Task' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const groups = groupByTask(operations);
      
      expect(groups[0].title).toBe('Created Task');
    });

    it('groups operations without resourceId under _no_task_', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'write_resource', params: {}, result: {} },
      ];

      const groups = groupByTask(operations);
      
      expect(groups[0].resourceId).toBe('_no_task_');
    });

    it('includes epicId from operations', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: {}, result: {}, resourceId: 'TASK-0001', epicId: 'EPIC-0001' },
      ];

      const groups = groupByTask(operations);
      
      expect(groups[0].epicId).toBe('EPIC-0001');
    });
  });

  describe('aggregateForJournal', () => {
    it('categorizes completed tasks', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: { status: 'done' }, result: {}, resourceId: 'TASK-0001', resourceTitle: 'Done Task' },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.completed).toHaveLength(1);
      expect(journal.completed[0].resourceId).toBe('TASK-0001');
      expect(journal.completed[0].title).toBe('Done Task');
    });

    it('categorizes in-progress tasks', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: { status: 'in_progress' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.inProgress).toHaveLength(1);
    });

    it('categorizes created tasks', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_create', params: { title: 'New Task' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.created).toHaveLength(1);
      expect(journal.created[0].title).toBe('New Task');
    });

    it('categorizes updated tasks', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: { title: 'Updated Title' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.updated).toHaveLength(1);
    });

    it('deduplicates tasks by resourceId', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: { status: 'done' }, result: {}, resourceId: 'TASK-0001' },
        { ts: '2026-02-05T11:00:00Z', tool: 'backlog_update', params: { status: 'done' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.completed).toHaveLength(1);
    });

    it('shows first status change for each task', () => {
      // Operations are processed in order - first status wins for each category
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'backlog_update', params: { status: 'in_progress' }, result: {}, resourceId: 'TASK-0001' },
        { ts: '2026-02-05T11:00:00Z', tool: 'backlog_update', params: { status: 'done' }, result: {}, resourceId: 'TASK-0001' },
      ];

      const journal = aggregateForJournal(operations);
      
      // Both statuses are recorded since they're different categories
      expect(journal.inProgress).toHaveLength(1);
      expect(journal.completed).toHaveLength(1);
    });

    it('skips operations without resourceId', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00Z', tool: 'write_resource', params: {}, result: {} },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.completed).toHaveLength(0);
      expect(journal.inProgress).toHaveLength(0);
      expect(journal.created).toHaveLength(0);
      expect(journal.updated).toHaveLength(0);
    });

    it('captures epicId and epicTitle from operations', () => {
      const operations: OperationEntry[] = [
        { 
          ts: '2026-02-05T10:00:00Z', 
          tool: 'backlog_update', 
          params: { status: 'done' }, 
          result: {}, 
          resourceId: 'TASK-0001',
          resourceTitle: 'My Task',
          epicId: 'EPIC-0001',
          epicTitle: 'My Epic',
        },
      ];

      const journal = aggregateForJournal(operations);
      
      expect(journal.completed).toHaveLength(1);
      expect(journal.completed[0].epicId).toBe('EPIC-0001');
      expect(journal.completed[0].epicTitle).toBe('My Epic');
    });
  });

  describe('groupByEpic', () => {
    it('groups entries by epicId', () => {
      const entries: JournalEntry[] = [
        { resourceId: 'TASK-0001', title: 'Task 1', epicId: 'EPIC-0001', epicTitle: 'Epic A' },
        { resourceId: 'TASK-0002', title: 'Task 2', epicId: 'EPIC-0001', epicTitle: 'Epic A' },
        { resourceId: 'TASK-0003', title: 'Task 3', epicId: 'EPIC-0002', epicTitle: 'Epic B' },
      ];

      const groups = groupByEpic(entries);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].epicId).toBe('EPIC-0001');
      expect(groups[0].entries).toHaveLength(2);
      expect(groups[1].epicId).toBe('EPIC-0002');
      expect(groups[1].entries).toHaveLength(1);
    });

    it('puts tasks without epic in "No Epic" group', () => {
      const entries: JournalEntry[] = [
        { resourceId: 'TASK-0001', title: 'Task 1', epicId: 'EPIC-0001', epicTitle: 'Epic A' },
        { resourceId: 'TASK-0002', title: 'Task 2' }, // No epic
      ];

      const groups = groupByEpic(entries);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].epicId).toBe('EPIC-0001');
      expect(groups[1].epicId).toBeNull();
      expect(groups[1].epicTitle).toBe('No Epic');
    });

    it('sorts epics alphabetically with "No Epic" last', () => {
      const entries: JournalEntry[] = [
        { resourceId: 'TASK-0001', title: 'Task 1' }, // No epic
        { resourceId: 'TASK-0002', title: 'Task 2', epicId: 'EPIC-0002', epicTitle: 'Zebra Epic' },
        { resourceId: 'TASK-0003', title: 'Task 3', epicId: 'EPIC-0001', epicTitle: 'Alpha Epic' },
      ];

      const groups = groupByEpic(entries);
      
      expect(groups).toHaveLength(3);
      expect(groups[0].epicTitle).toBe('Alpha Epic');
      expect(groups[1].epicTitle).toBe('Zebra Epic');
      expect(groups[2].epicTitle).toBe('No Epic');
    });

    it('uses epicId as title fallback when epicTitle is missing', () => {
      const entries: JournalEntry[] = [
        { resourceId: 'TASK-0001', title: 'Task 1', epicId: 'EPIC-0001' }, // No epicTitle
      ];

      const groups = groupByEpic(entries);
      
      expect(groups).toHaveLength(1);
      expect(groups[0].epicTitle).toBe('EPIC-0001');
    });

    it('returns empty array for empty input', () => {
      const groups = groupByEpic([]);
      expect(groups).toHaveLength(0);
    });
  });

  describe('getToolLabel', () => {
    it('returns human-readable labels', () => {
      expect(getToolLabel('backlog_create')).toBe('Created');
      expect(getToolLabel('backlog_update')).toBe('Updated');
      expect(getToolLabel('backlog_delete')).toBe('Deleted');
      expect(getToolLabel('write_resource')).toBe('Wrote');
    });

    it('returns tool name for unknown tools', () => {
      expect(getToolLabel('unknown_tool')).toBe('unknown_tool');
    });
  });

  describe('getToolIcon', () => {
    it('returns emoji icons', () => {
      expect(getToolIcon('backlog_create')).toBe('➕');
      expect(getToolIcon('backlog_update')).toBe('✏️');
      expect(getToolIcon('backlog_delete')).toBe('🗑️');
      expect(getToolIcon('write_resource')).toBe('📝');
    });

    it('returns default icon for unknown tools', () => {
      expect(getToolIcon('unknown_tool')).toBe('⚡');
    });
  });

  describe('mergeConsecutiveEdits', () => {
    it('merges consecutive str_replace ops within 30s window', () => {
      const operations: OperationEntry[] = [
        // Newest first (reverse chronological)
        { ts: '2026-02-05T10:00:20.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'B', new_str: 'C' } }, result: {} },
        { ts: '2026-02-05T10:00:10.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'A', new_str: 'B' } }, result: {} },
      ];

      const merged = mergeConsecutiveEdits(operations);
      
      expect(merged).toHaveLength(1);
      expect(merged[0].params._mergedCount).toBe(2);
      // Should store all ops for stacked rendering
      const mergedOps = merged[0].params._mergedOps as OperationEntry[];
      expect(mergedOps).toHaveLength(2);
      expect((mergedOps[0].params.operation as { new_str: string }).new_str).toBe('C'); // newest
      expect((mergedOps[1].params.operation as { old_str: string }).old_str).toBe('A'); // oldest
    });

    it('does not merge ops more than 30s apart', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:01:00.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'B', new_str: 'C' } }, result: {} },
        { ts: '2026-02-05T10:00:00.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'A', new_str: 'B' } }, result: {} },
      ];

      const merged = mergeConsecutiveEdits(operations);
      
      expect(merged).toHaveLength(2);
      expect(merged[0].params._mergedCount).toBeUndefined();
    });

    it('does not merge ops on different URIs', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:10.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0002.md', operation: { type: 'str_replace', old_str: 'X', new_str: 'Y' } }, result: {} },
        { ts: '2026-02-05T10:00:00.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'A', new_str: 'B' } }, result: {} },
      ];

      const merged = mergeConsecutiveEdits(operations);
      
      expect(merged).toHaveLength(2);
    });

    it('preserves non-str_replace operations', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:20.000Z', tool: 'backlog_update', params: { id: 'TASK-0001' }, result: {} },
        { ts: '2026-02-05T10:00:10.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'A', new_str: 'B' } }, result: {} },
      ];

      const merged = mergeConsecutiveEdits(operations);
      
      expect(merged).toHaveLength(2);
      expect(merged[0].tool).toBe('backlog_update');
      expect(merged[1].tool).toBe('write_resource');
    });

    it('returns empty array for empty input', () => {
      expect(mergeConsecutiveEdits([])).toEqual([]);
    });

    it('returns single op unchanged', () => {
      const operations: OperationEntry[] = [
        { ts: '2026-02-05T10:00:00.000Z', tool: 'write_resource', params: { uri: 'mcp://backlog/tasks/TASK-0001.md', operation: { type: 'str_replace', old_str: 'A', new_str: 'B' } }, result: {} },
      ];

      const merged = mergeConsecutiveEdits(operations);
      
      expect(merged).toHaveLength(1);
      expect(merged[0].params._mergedCount).toBeUndefined();
    });
  });
});
