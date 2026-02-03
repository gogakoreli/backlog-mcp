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
  actor?: Actor;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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

function formatActorDisplay(actor?: Actor): string {
  if (!actor) return '';
  
  const currentUser = 'You'; // Could be enhanced to check against current user
  
  if (actor.type === 'user') {
    return `<span class="activity-actor activity-actor-user">${currentUser}</span>`;
  }
  
  // Agent with delegation info
  let display = `<span class="activity-actor activity-actor-agent">${actor.name}</span>`;
  if (actor.delegatedBy) {
    display += `<span class="activity-delegated">(delegated by ${actor.delegatedBy})</span>`;
  }
  if (actor.taskContext) {
    display += `<span class="activity-context">Working on: ${actor.taskContext}</span>`;
  }
  return display;
}

/**
 * Generate unified diff string from old and new content using diff library.
 */
function createUnifiedDiff(oldStr: string, newStr: string, filename: string = 'file'): string {
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 5 });
}

const POLL_INTERVAL = 30000; // 30 seconds

export class ActivityPanel extends HTMLElement {
  private taskId: string | null = null;
  private operations: OperationEntry[] = [];
  private expandedIndex: number | null = null;
  private pollTimer: number | null = null;
  private visibilityHandler: (() => void) | null = null;

  connectedCallback() {
    this.className = 'activity-panel';
    this.render();
    this.startPolling();
  }

  disconnectedCallback() {
    this.stopPolling();
  }

  private startPolling() {
    // Start polling timer
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.loadOperations();
      }
    }, POLL_INTERVAL);

    // Also refresh when page becomes visible
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

  async loadOperations() {
    // Only show loading on initial load, not on poll refresh
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
    } catch (error) {
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

    this.innerHTML = `
      <div class="activity-list">
        ${this.operations.map((op, i) => this.renderOperation(op, i)).join('')}
      </div>
    `;

    // Bind click handlers for expansion - only on header
    this.querySelectorAll('.activity-item-header').forEach((header) => {
      header.addEventListener('click', () => {
        const item = header.closest('.activity-item');
        const index = parseInt(item?.getAttribute('data-index') || '0');
        this.toggleExpand(index);
      });
    });

    // Bind task badge clicks for navigation (in expanded content)
    this.querySelectorAll('.activity-task-link').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (badge as HTMLElement).getAttribute('task-id');
        if (taskId) {
          document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
        }
      });
    });
  }

  private renderOperation(op: OperationEntry, index: number): string {
    const isExpanded = this.expandedIndex === index;
    const time = new Date(op.ts);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

    return `
      <div class="activity-item ${isExpanded ? 'expanded' : ''}" data-index="${index}">
        <div class="activity-item-header">
          <div class="activity-item-left">
            <span class="activity-icon">${getToolIcon(op.tool)}</span>
            <div class="activity-item-info">
              <span class="activity-label">${getToolLabel(op.tool)}</span>
              ${op.resourceId ? `<span class="activity-resource-id">${op.resourceId}</span>` : ''}
              ${this.renderActorInline(op.actor)}
            </div>
          </div>
          <div class="activity-item-right">
            <span class="activity-date">${dateStr}</span>
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
    
    // Add clickable task badge at top if we have a resourceId
    if (op.resourceId) {
      content += `
        <div class="activity-detail-row">
          <span class="activity-detail-label">Task:</span>
          <task-badge class="activity-task-link" task-id="${op.resourceId}"></task-badge>
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
            <task-badge class="activity-task-link" task-id="${epicId}"></task-badge>
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
      content = `<div class="activity-detail-row"><span class="activity-detail-value">Task permanently deleted</span></div>`;
    } else if (op.tool === 'write_resource' && op.params.operation) {
      const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
      const uri = op.params.uri as string;
      const filename = uri.split('/').pop() || 'file';
      
      content = `
        <div class="activity-detail-row">
          <span class="activity-detail-label">File:</span>
          <span class="activity-detail-value">${this.escapeHtml(filename)}</span>
        </div>
      `;
      
      if (operation.type === 'str_replace' && operation.old_str && operation.new_str) {
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
