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
  getToolLabel,
  getToolIcon,
  type OperationEntry,
  type Actor,
  type DayGroup,
  type TaskGroup,
  type JournalEntry,
} from './activity-utils.js';

type ViewMode = 'timeline' | 'journal';

function createUnifiedDiff(oldStr: string, newStr: string, filename: string = 'file'): string {
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 5 });
}

const POLL_INTERVAL = 30000;
const MODE_STORAGE_KEY = 'backlog:activity-mode';
const DEFAULT_VISIBLE_ITEMS = 5;

export class ActivityPanel extends HTMLElement {
  private taskId: string | null = null;
  private operations: OperationEntry[] = [];
  private expandedIndex: number | null = null;
  private pollTimer: number | null = null;
  private visibilityHandler: (() => void) | null = null;
  private mode: ViewMode = 'timeline';
  private selectedDate: string = getTodayKey();
  private expandedTaskGroups = new Set<string>();

  connectedCallback() {
    this.className = 'activity-panel';
    // Restore mode from localStorage
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY) as ViewMode | null;
    if (savedMode === 'timeline' || savedMode === 'journal') {
      this.mode = savedMode;
    }
    this.render();
    this.startPolling();
  }

  disconnectedCallback() {
    this.stopPolling();
  }

  private startPolling() {
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.loadOperations();
      }
    }, POLL_INTERVAL);

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        this.loadOperations();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  setTaskId(taskId: string | null) {
    this.taskId = taskId;
    this.loadOperations();
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.expandedIndex = null;
    // Persist mode to localStorage
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    this.render();
  }

  setDate(dateKey: string) {
    this.selectedDate = dateKey;
    this.render();
  }

  async loadOperations() {
    if (this.operations.length === 0) {
      this.innerHTML = '<div class="activity-loading">Loading activity...</div>';
    }

    try {
      const url = this.taskId 
        ? `/operations?task=${encodeURIComponent(this.taskId)}&limit=100`
        : '/operations?limit=100';
      
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
        <div class="activity-empty">
          <div class="activity-empty-icon">📋</div>
          <div>No activity${this.taskId ? ` for ${this.taskId}` : ''}</div>
        </div>
      `;
      return;
    }

    const modeToggle = this.taskId ? '' : `
      <div class="activity-mode-toggle">
        <button class="activity-mode-btn ${this.mode === 'timeline' ? 'active' : ''}" data-mode="timeline">Timeline</button>
        <button class="activity-mode-btn ${this.mode === 'journal' ? 'active' : ''}" data-mode="journal">Journal</button>
      </div>
    `;

    if (this.mode === 'journal' && !this.taskId) {
      this.innerHTML = `${modeToggle}${this.renderJournal()}`;
    } else {
      this.innerHTML = `${modeToggle}${this.renderTimeline()}`;
    }

    this.bindEventHandlers();
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
    const isExpanded = this.expandedTaskGroups.has(taskGroup.resourceId);
    const hasMore = taskGroup.operations.length > DEFAULT_VISIBLE_ITEMS;
    const visibleOps = isExpanded 
      ? taskGroup.operations 
      : taskGroup.operations.slice(0, DEFAULT_VISIBLE_ITEMS);
    const hiddenCount = taskGroup.operations.length - DEFAULT_VISIBLE_ITEMS;
    
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
        ${visibleOps.map(op => {
          const globalIndex = this.operations.indexOf(op);
          return this.renderOperation(op, globalIndex);
        }).join('')}
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
    
    return `
      <div class="activity-journal-section">
        <div class="activity-journal-section-title">${title}</div>
        <ul class="activity-journal-list">
          ${entries.map(e => `
            <li class="activity-journal-item">
              <a href="#" class="activity-task-link" data-task-id="${e.resourceId}">
                <task-badge task-id="${e.resourceId}"></task-badge>
              </a>
              ${e.title !== e.resourceId ? `<span class="activity-journal-title">${this.escapeHtml(e.title)}</span>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  private renderOperation(op: OperationEntry, index: number): string {
    const isExpanded = this.expandedIndex === index;
    const time = new Date(op.ts);
    const dateKey = getLocalDateKey(time);
    const today = getTodayKey();
    
    // Show date + time if not today, otherwise just time
    const timeStr = dateKey === today 
      ? formatTime(time)
      : formatDateTime(time);

    return `
      <div class="activity-item ${isExpanded ? 'expanded' : ''}" data-index="${index}">
        <div class="activity-item-header">
          <div class="activity-item-left">
            <span class="activity-icon">${getToolIcon(op.tool)}</span>
            <div class="activity-item-info">
              <span class="activity-label">${getToolLabel(op.tool)}</span>
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
    } else if (op.tool === 'write_resource' && op.params.operation) {
      const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
      
      if (operation.type === 'str_replace' && operation.old_str && operation.new_str) {
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

    return `<div class="activity-expanded" onclick="event.stopPropagation()">${content}</div>`;
  }

  private bindEventHandlers() {
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
          this.render();
        }
      });
    });

    // Expansion
    this.querySelectorAll('.activity-item-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.activity-item');
        const index = parseInt(item?.getAttribute('data-index') || '0');
        this.toggleExpand(index);
      });
    });

    // Task links
    this.querySelectorAll('.activity-task-link, .activity-epic-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const taskId = (link as HTMLElement).dataset.taskId;
        if (taskId) {
          document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
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

  private toggleExpand(index: number) {
    this.expandedIndex = this.expandedIndex === index ? null : index;
    this.render();
  }
}

customElements.define('activity-panel', ActivityPanel);
