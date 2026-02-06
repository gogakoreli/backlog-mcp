import * as Diff2Html from 'diff2html';
import { createTwoFilesPatch } from 'diff';
import { 
  getLocalDateKey, 
  getTodayKey, 
  formatRelativeDay, 
  formatTime,
  formatDateTime,
  addDays,
} from '../utils/date.js';
import {
  groupByDay,
  groupByTask,
  aggregateForJournal,
  groupByEpic,
  getToolLabel,
  getToolIcon,
  mergeConsecutiveEdits,
  type OperationEntry,
  type Actor,
  type DayGroup,
  type TaskGroup,
  type JournalEntry,
  type EpicGroup,
} from './activity-utils.js';
import { backlogEvents, type ChangeCallback } from '../services/event-source-client.js';

type ViewMode = 'timeline' | 'journal';

function createUnifiedDiff(oldStr: string, newStr: string, filename: string = 'file'): string {
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 5 });
}

const MODE_STORAGE_KEY = 'backlog:activity-mode';
const DEFAULT_VISIBLE_ITEMS = 2;

export class ActivityPanel extends HTMLElement {
  private taskId: string | null = null;
  private operations: OperationEntry[] = [];
  private expandedIndex: string | null = null; // Changed to timestamp-based ID
  private mode: ViewMode = 'timeline';
  private selectedDate: string = getTodayKey();
  private expandedTaskGroups = new Set<string>();
  private changeHandler: ChangeCallback = () => this.loadOperations();

  connectedCallback() {
    this.className = 'activity-panel';
    // Restore mode from localStorage
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY) as ViewMode | null;
    if (savedMode === 'timeline' || savedMode === 'journal') {
      this.mode = savedMode;
    }
    this.render();
    backlogEvents.onChange(this.changeHandler);
  }

  disconnectedCallback() {
    backlogEvents.offChange(this.changeHandler);
  }

  setTaskId(taskId: string | null) {
    this.taskId = taskId;
    this.loadOperations();
  }

  setMode(mode: ViewMode) {
    const wasJournal = this.mode === 'journal';
    this.mode = mode;
    this.expandedIndex = null;
    // Persist mode to localStorage
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    // Reload when switching to/from journal mode (different data requirements)
    if (mode === 'journal' || wasJournal) {
      this.loadOperations();
    } else {
      this.render();
    }
  }

  setDate(dateKey: string) {
    this.selectedDate = dateKey;
    // Reload operations for the new date when in journal mode
    if (this.mode === 'journal') {
      this.loadOperations();
    } else {
      this.render();
    }
  }

  async loadOperations() {
    if (this.operations.length === 0) {
      this.innerHTML = '<div class="activity-loading">Loading activity...</div>';
    }

    try {
      let url: string;
      if (this.taskId) {
        url = `/operations?task=${encodeURIComponent(this.taskId)}&limit=100`;
      } else if (this.mode === 'journal') {
        // In journal mode, fetch all operations for the selected date
        url = `/operations?date=${this.selectedDate}`;
      } else {
        url = '/operations?limit=100';
      }
      
      const res = await fetch(url);
      this.operations = await res.json();
      this.render();
    } catch {
      this.innerHTML = `<div class="activity-error">Failed to load activity</div>`;
    }
  }

  private render() {
    if (this.operations.length === 0) {
      this.innerHTML = `
        ${this.renderFilterHeader()}
        <div class="activity-empty">
          <div class="activity-empty-icon">📋</div>
          <div>No activity${this.taskId ? ` for ${this.taskId}` : ''}</div>
        </div>
      `;
      this.bindEventHandlers();
      return;
    }

    const modeToggle = this.taskId ? '' : `
      <div class="activity-mode-toggle">
        <button class="activity-mode-btn ${this.mode === 'timeline' ? 'active' : ''}" data-mode="timeline">Timeline</button>
        <button class="activity-mode-btn ${this.mode === 'journal' ? 'active' : ''}" data-mode="journal">Journal</button>
      </div>
    `;

    if (this.mode === 'journal' && !this.taskId) {
      this.innerHTML = `${this.renderFilterHeader()}${modeToggle}${this.renderJournal()}`;
    } else {
      this.innerHTML = `${this.renderFilterHeader()}${modeToggle}${this.renderTimeline()}`;
    }

    this.bindEventHandlers();
  }

  private renderFilterHeader(): string {
    if (!this.taskId) return '';
    
    return `
      <div class="activity-filter-header">
        <span class="activity-filter-label">Showing activity for</span>
        <task-badge task-id="${this.taskId}"></task-badge>
        <button class="activity-filter-clear" title="Show all activity">✕</button>
      </div>
    `;
  }

  private renderTimeline(): string {
    const dayGroups = groupByDay(this.operations);
    
    return `
      <div class="activity-list">
        ${dayGroups.map(dayGroup => `
          <div class="activity-day-separator">
            <span class="activity-day-label">${dayGroup.label}</span>
            <span class="activity-day-count">${dayGroup.operations.length}</span>
          </div>
          ${groupByTask(dayGroup.operations).map(taskGroup => this.renderTaskGroup(taskGroup)).join('')}
        `).join('')}
      </div>
    `;
  }

  private renderTaskGroup(taskGroup: TaskGroup): string {
    // Merge consecutive edits before rendering
    const mergedOps = mergeConsecutiveEdits(taskGroup.operations);
    
    const isExpanded = this.expandedTaskGroups.has(taskGroup.resourceId);
    const hasMore = mergedOps.length > DEFAULT_VISIBLE_ITEMS;
    const visibleOps = isExpanded 
      ? mergedOps 
      : mergedOps.slice(0, DEFAULT_VISIBLE_ITEMS);
    const hiddenCount = mergedOps.length - DEFAULT_VISIBLE_ITEMS;
    
    // Format most recent activity date
    const mostRecentDate = new Date(taskGroup.mostRecentTs);
    const mostRecentDateStr = formatDateTime(mostRecentDate);
    
    return `
      <div class="activity-task-group">
        <div class="activity-task-header">
          ${taskGroup.epicId ? `
            <a href="#" class="activity-epic-link" data-task-id="${taskGroup.epicId}">
              <task-badge task-id="${taskGroup.epicId}"></task-badge>
            </a>
          ` : ''}
          <a href="#" class="activity-task-link" data-task-id="${taskGroup.resourceId}">
            <task-badge task-id="${taskGroup.resourceId}"></task-badge>
          </a>
          ${taskGroup.title !== taskGroup.resourceId ? `<span class="activity-task-title">${this.escapeHtml(taskGroup.title)}</span>` : ''}
          <span class="activity-task-recent">${mostRecentDateStr}</span>
        </div>
        ${visibleOps.map(op => this.renderOperation(op)).join('')}
        ${hasMore ? `
          <button class="activity-toggle-btn" data-task-id="${taskGroup.resourceId}">
            ${isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
          </button>
        ` : ''}
      </div>
    `;
  }

  private renderJournal(): string {
    // Filter operations for selected date
    const dayOps = this.operations.filter(op => {
      const dateKey = getLocalDateKey(new Date(op.ts));
      return dateKey === this.selectedDate;
    });
    
    const journal = aggregateForJournal(dayOps);
    const hasContent = journal.completed.length || journal.inProgress.length || 
                       journal.created.length || journal.updated.length;
    
    const isToday = this.selectedDate === getTodayKey();
    const canGoNext = this.selectedDate < getTodayKey();
    
    return `
      <div class="activity-journal">
        <div class="activity-nav">
          <button class="activity-nav-btn" data-action="prev">← Prev</button>
          <span class="activity-nav-date">${formatRelativeDay(this.selectedDate)}</span>
          <button class="activity-nav-btn" data-action="next" ${canGoNext ? '' : 'disabled'}>Next →</button>
          ${!isToday ? `<button class="activity-nav-btn activity-nav-today" data-action="today">Today</button>` : ''}
        </div>
        
        ${!hasContent ? `
          <div class="activity-journal-empty">
            <div class="activity-empty-icon">📭</div>
            <div>No activity on ${formatRelativeDay(this.selectedDate, { short: true })}</div>
          </div>
        ` : `
          <div class="activity-journal-content">
            ${this.renderJournalSection('✅ Completed', journal.completed)}
            ${this.renderJournalSection('🚧 In Progress', journal.inProgress)}
            ${this.renderJournalSection('➕ Created', journal.created)}
            ${this.renderJournalSection('✏️ Updated', journal.updated)}
          </div>
        `}
      </div>
    `;
  }

  private renderJournalSection(title: string, entries: JournalEntry[]): string {
    if (entries.length === 0) return '';
    
    const epicGroups = groupByEpic(entries);
    
    return `
      <div class="activity-journal-section">
        <div class="activity-journal-section-title">${title}</div>
        ${epicGroups.map(group => `
          <div class="activity-journal-epic-group">
            <div class="activity-journal-epic-header">
              ${group.epicId ? `
                <a href="#" class="activity-epic-link" data-epic-id="${group.epicId}">
                  <task-badge task-id="${group.epicId}"></task-badge>
                </a>
              ` : ''}
              <span class="activity-journal-epic-title">${this.escapeHtml(group.epicTitle)}</span>
            </div>
            <ul class="activity-journal-list">
              ${group.entries.map(e => `
                <li class="activity-journal-item">
                  <a href="#" class="activity-task-link" data-task-id="${e.resourceId}">
                    <task-badge task-id="${e.resourceId}"></task-badge>
                  </a>
                  ${e.title !== e.resourceId ? `<span class="activity-journal-title">${this.escapeHtml(e.title)}</span>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderOperation(op: OperationEntry): string {
    const opId = op.ts; // Use timestamp as unique ID
    const isExpanded = this.expandedIndex === opId;
    const time = new Date(op.ts);
    const dateKey = getLocalDateKey(time);
    const today = getTodayKey();
    
    // Show date + time if not today, otherwise just time
    const timeStr = dateKey === today 
      ? formatTime(time)
      : formatDateTime(time);
    
    // Check if this is a merged operation
    const mergedCount = op.params._mergedCount as number | undefined;
    const mergedBadge = mergedCount && mergedCount > 1 
      ? `<span class="activity-merged-badge">${mergedCount} edits</span>` 
      : '';

    return `
      <div class="activity-item ${isExpanded ? 'expanded' : ''}" data-op-id="${opId}">
        <div class="activity-item-header">
          <div class="activity-item-left">
            <span class="activity-icon">${getToolIcon(op.tool)}</span>
            <div class="activity-item-info">
              <span class="activity-label">${getToolLabel(op.tool)}${mergedBadge}</span>
              ${this.renderActorInline(op.actor)}
            </div>
          </div>
          <div class="activity-item-right">
            <span class="activity-time">${timeStr}</span>
          </div>
        </div>
        ${isExpanded ? this.renderExpandedContent(op) : ''}
      </div>
    `;
  }

  private renderActorInline(actor?: Actor): string {
    if (!actor) return '';
    if (actor.type === 'user') {
      return `<span class="activity-actor-inline activity-actor-user">by you</span>`;
    }
    let text = `by ${actor.name}`;
    if (actor.delegatedBy) text += ` (delegated)`;
    return `<span class="activity-actor-inline activity-actor-agent">${text}</span>`;
  }

  private renderExpandedContent(op: OperationEntry): string {
    let content = '';
    
    if (op.resourceId) {
      content += `
        <div class="activity-detail-row">
          <span class="activity-detail-label">Task:</span>
          <a href="#" class="activity-task-link" data-task-id="${op.resourceId}">
            <task-badge task-id="${op.resourceId}"></task-badge>
          </a>
        </div>
      `;
    }
    
    if (op.tool === 'backlog_create') {
      const title = op.params.title as string;
      const epicId = op.params.epic_id as string | undefined;
      content += `
        <div class="activity-detail-row">
          <span class="activity-detail-label">Title:</span>
          <span class="activity-detail-value">${this.escapeHtml(title)}</span>
        </div>
        ${epicId ? `
          <div class="activity-detail-row">
            <span class="activity-detail-label">Epic:</span>
            <a href="#" class="activity-task-link" data-task-id="${epicId}">
              <task-badge task-id="${epicId}"></task-badge>
            </a>
          </div>
        ` : ''}
      `;
    } else if (op.tool === 'backlog_update') {
      const fields = Object.entries(op.params).filter(([k]) => k !== 'id');
      content += fields.map(([key, value]) => {
        let displayValue: string;
        if (Array.isArray(value)) {
          displayValue = value.length > 0 ? `${value.length} items` : 'cleared';
        } else if (typeof value === 'string' && value.length > 100) {
          displayValue = value.slice(0, 100) + '...';
        } else {
          displayValue = String(value);
        }
        return `
          <div class="activity-detail-row">
            <span class="activity-detail-label">${key}:</span>
            <span class="activity-detail-value">${this.escapeHtml(displayValue)}</span>
          </div>
        `;
      }).join('');
    } else if (op.tool === 'backlog_delete') {
      content += `<div class="activity-detail-row"><span class="activity-detail-value">Task permanently deleted</span></div>`;
    } else if (op.tool === 'write_resource') {
      // Check if this is a merged operation with multiple diffs
      const mergedOps = op.params._mergedOps as OperationEntry[] | undefined;
      
      if (mergedOps && mergedOps.length > 1) {
        // Concatenate all diffs into one unified diff (oldest first)
        const uri = op.params.uri as string;
        const filename = uri.split('/').pop() || 'file';
        
        let combinedDiff = '';
        for (const mergedOp of [...mergedOps].reverse()) {
          const operation = mergedOp.params.operation as { type: string; old_str?: string; new_str?: string };
          if (operation.old_str !== undefined && operation.new_str !== undefined) {
            combinedDiff += createUnifiedDiff(operation.old_str, operation.new_str, filename) + '\n';
          }
        }
        
        content += `
          <div class="activity-diff">
            ${Diff2Html.html(combinedDiff, {
              drawFileList: false,
              matching: 'lines',
              outputFormat: 'line-by-line',
              diffStyle: 'word',
              colorScheme: 'dark',
            })}
          </div>
        `;
      } else if (op.params.operation) {
        // Single operation
        const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
        
        if (operation.type === 'str_replace' && operation.old_str !== undefined && operation.new_str !== undefined) {
          const uri = op.params.uri as string;
          const filename = uri.split('/').pop() || 'file';
          const unifiedDiff = createUnifiedDiff(operation.old_str, operation.new_str, filename);
          content += `
            <div class="activity-diff">
              ${Diff2Html.html(unifiedDiff, {
                drawFileList: false,
                matching: 'lines',
                outputFormat: 'line-by-line',
                diffStyle: 'word',
                colorScheme: 'dark',
              })}
            </div>
          `;
        } else {
          content += `
            <div class="activity-detail-row">
              <span class="activity-detail-label">Operation:</span>
              <span class="activity-detail-value">${operation.type}</span>
            </div>
          `;
        }
      }
    }

    return `<div class="activity-expanded" onclick="event.stopPropagation()">${content}</div>`;
  }

  private bindEventHandlers() {
    // Filter clear button
    this.querySelector('.activity-filter-clear')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('activity-clear-filter'));
    });

    // Mode toggle
    this.querySelectorAll('.activity-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as ViewMode;
        this.setMode(mode);
      });
    });

    // Day navigation
    this.querySelectorAll('.activity-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        if (action === 'prev') {
          const prevDay = addDays(this.selectedDate, -1);
          if (prevDay) this.setDate(prevDay);
        } else if (action === 'next') {
          const nextDay = addDays(this.selectedDate, 1);
          if (nextDay) this.setDate(nextDay);
        } else if (action === 'today') {
          this.setDate(getTodayKey());
        }
      });
    });

    // Task group expand/collapse
    this.querySelectorAll('.activity-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.taskId;
        if (taskId) {
          if (this.expandedTaskGroups.has(taskId)) {
            this.expandedTaskGroups.delete(taskId);
          } else {
            this.expandedTaskGroups.add(taskId);
          }
          // Preserve scroll position during re-render
          const scrollTop = this.scrollTop;
          this.render();
          this.scrollTop = scrollTop;
        }
      });
    });

    // Expansion
    this.querySelectorAll('.activity-item-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.activity-item');
        const opId = item?.getAttribute('data-op-id') || '';
        this.toggleExpand(opId);
      });
    });

    // Task links
    this.querySelectorAll('.activity-task-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const taskId = (link as HTMLElement).dataset.taskId;
        if (taskId) {
          document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
        }
      });
    });

    // Epic links
    this.querySelectorAll('.activity-epic-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const epicId = (link as HTMLElement).dataset.epicId;
        if (epicId) {
          document.dispatchEvent(new CustomEvent('epic-navigate', { detail: { epicId } }));
        }
      });
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private toggleExpand(opId: string) {
    this.expandedIndex = this.expandedIndex === opId ? null : opId;
    this.render();
  }
}

customElements.define('activity-panel', ActivityPanel);
