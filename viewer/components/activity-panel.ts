import * as Diff2Html from 'diff2html';
import { createTwoFilesPatch } from 'diff';

interface Actor {
  type: 'user' | 'agent';
  name: string;
  delegatedBy?: string;
  taskContext?: string;
}

interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  resourceTitle?: string;
  actor?: Actor;
}

type ViewMode = 'timeline' | 'journal';

interface DayGroup {
  dateKey: string;
  label: string;
  operations: OperationEntry[];
}

interface TaskGroup {
  resourceId: string;
  title: string;
  operations: OperationEntry[];
  mostRecentTs: string;
}

interface JournalEntry {
  resourceId: string;
  title: string;
}

interface JournalData {
  completed: JournalEntry[];
  inProgress: JournalEntry[];
  created: JournalEntry[];
  updated: JournalEntry[];
}

// Date utilities - use local time, not UTC
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayKey(): string {
  return getLocalDateKey(new Date());
}

function formatDayLabel(dateKey: string): string {
  const today = getTodayKey();
  const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));
  
  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  
  const date = new Date(dateKey + 'T12:00:00');
  return date.toLocaleDateString(undefined, { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

function formatDateForNav(dateKey: string): string {
  const today = getTodayKey();
  const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));
  
  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  
  const date = new Date(dateKey + 'T12:00:00');
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getPrevDay(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  date.setDate(date.getDate() - 1);
  return getLocalDateKey(date);
}

function getNextDay(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  date.setDate(date.getDate() + 1);
  return getLocalDateKey(date);
}

// Group operations by day
function groupByDay(operations: OperationEntry[]): DayGroup[] {
  const groups = new Map<string, OperationEntry[]>();
  
  for (const op of operations) {
    const dateKey = getLocalDateKey(new Date(op.ts));
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(op);
  }
  
  // Sort by date descending (most recent first)
  const sortedKeys = Array.from(groups.keys()).sort().reverse();
  
  return sortedKeys.map(dateKey => ({
    dateKey,
    label: formatDayLabel(dateKey),
    operations: groups.get(dateKey)!,
  }));
}

// Group operations by task within a day, ordered by most recent operation
function groupByTask(operations: OperationEntry[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  
  for (const op of operations) {
    const resourceId = op.resourceId || '_no_task_';
    const title = op.resourceTitle || (op.params.title as string) || resourceId;
    
    if (!groups.has(resourceId)) {
      groups.set(resourceId, {
        resourceId,
        title,
        operations: [],
        mostRecentTs: op.ts,
      });
    }
    
    const group = groups.get(resourceId)!;
    group.operations.push(op);
    // Update most recent timestamp if this operation is newer
    if (op.ts > group.mostRecentTs) {
      group.mostRecentTs = op.ts;
    }
  }
  
  // Sort groups by most recent operation (descending)
  return Array.from(groups.values())
    .sort((a, b) => b.mostRecentTs.localeCompare(a.mostRecentTs));
}

// Aggregate operations for journal view
function aggregateForJournal(operations: OperationEntry[]): JournalData {
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
    
    if (op.tool === 'backlog_create') {
      if (!seenCreated.has(resourceId)) {
        seenCreated.add(resourceId);
        created.push({ resourceId, title });
      }
    } else if (op.tool === 'backlog_update') {
      const status = op.params.status as string | undefined;
      if (status === 'done' && !seenCompleted.has(resourceId)) {
        seenCompleted.add(resourceId);
        completed.push({ resourceId, title });
      } else if (status === 'in_progress' && !seenInProgress.has(resourceId)) {
        seenInProgress.add(resourceId);
        inProgress.push({ resourceId, title });
      } else if (!seenUpdated.has(resourceId) && !seenCompleted.has(resourceId) && !seenInProgress.has(resourceId)) {
        seenUpdated.add(resourceId);
        updated.push({ resourceId, title });
      }
    }
  }
  
  return { completed, inProgress, created, updated };
}

function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    backlog_create: 'Created',
    backlog_update: 'Updated',
    backlog_delete: 'Deleted',
    write_resource: 'Wrote',
  };
  return labels[tool] || tool;
}

function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    backlog_create: '➕',
    backlog_update: '✏️',
    backlog_delete: '🗑️',
    write_resource: '📝',
  };
  return icons[tool] || '⚡';
}

function createUnifiedDiff(oldStr: string, newStr: string, filename: string = 'file'): string {
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 5 });
}

const POLL_INTERVAL = 30000;
const MODE_STORAGE_KEY = 'backlog:activity-mode';

export class ActivityPanel extends HTMLElement {
  private taskId: string | null = null;
  private operations: OperationEntry[] = [];
  private expandedIndex: number | null = null;
  private pollTimer: number | null = null;
  private visibilityHandler: (() => void) | null = null;
  private mode: ViewMode = 'timeline';
  private selectedDate: string = getTodayKey();

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
          ${groupByTask(dayGroup.operations).map(taskGroup => `
            <div class="activity-task-group">
              <div class="activity-task-header">
                <a href="#" class="activity-task-link" data-task-id="${taskGroup.resourceId}">
                  <task-badge task-id="${taskGroup.resourceId}"></task-badge>
                </a>
                ${taskGroup.title !== taskGroup.resourceId ? `<span class="activity-task-title">${this.escapeHtml(taskGroup.title)}</span>` : ''}
              </div>
              ${taskGroup.operations.map(op => {
                const globalIndex = this.operations.indexOf(op);
                return this.renderOperation(op, globalIndex);
              }).join('')}
            </div>
          `).join('')}
        `).join('')}
      </div>
    `;
  }

  private renderJournal(): string {
    // Filter operations for selected date
    const dayOps = this.operations.filter(op => 
      getLocalDateKey(new Date(op.ts)) === this.selectedDate
    );
    
    const journal = aggregateForJournal(dayOps);
    const hasContent = journal.completed.length || journal.inProgress.length || 
                       journal.created.length || journal.updated.length;
    
    const isToday = this.selectedDate === getTodayKey();
    const canGoNext = this.selectedDate < getTodayKey();
    
    return `
      <div class="activity-journal">
        <div class="activity-nav">
          <button class="activity-nav-btn" data-action="prev">← Prev</button>
          <span class="activity-nav-date">${formatDayLabel(this.selectedDate)}</span>
          <button class="activity-nav-btn" data-action="next" ${canGoNext ? '' : 'disabled'}>Next →</button>
          ${!isToday ? `<button class="activity-nav-btn activity-nav-today" data-action="today">Today</button>` : ''}
        </div>
        
        ${!hasContent ? `
          <div class="activity-journal-empty">
            <div class="activity-empty-icon">📭</div>
            <div>No activity on ${formatDateForNav(this.selectedDate)}</div>
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
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
          this.setDate(getPrevDay(this.selectedDate));
        } else if (action === 'next') {
          this.setDate(getNextDay(this.selectedDate));
        } else if (action === 'today') {
          this.setDate(getTodayKey());
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
