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
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 3 });
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

    const title = this.taskId ? `Activity for ${this.taskId}` : 'Recent Activity';
    
    this.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">${title}</span>
        <span class="activity-count">${this.operations.length} operations</span>
      </div>
      <div class="activity-list">
        ${this.operations.map((op, i) => this.renderOperation(op, i)).join('')}
      </div>
    `;

    // Bind click handlers for expansion
    this.querySelectorAll('.activity-item').forEach((item, i) => {
      item.addEventListener('click', () => this.toggleExpand(i));
    });

    // Bind task ID links
    this.querySelectorAll('.activity-task-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (link as HTMLElement).dataset.taskId;
        if (taskId) {
          document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
        }
      });
    });
  }

  private renderOperation(op: OperationEntry, index: number): string {
    const isExpanded = this.expandedIndex === index;
    const resourceDisplay = op.resourceId 
      ? `<a class="activity-task-link" data-task-id="${op.resourceId}">${op.resourceId}</a>`
      : this.getResourceFromParams(op);
    const actorDisplay = formatActorDisplay(op.actor);

    return `
      <div class="activity-item ${isExpanded ? 'expanded' : ''}" data-index="${index}">
        <div class="activity-item-header">
          <span class="activity-icon">${getToolIcon(op.tool)}</span>
          <span class="activity-label">${getToolLabel(op.tool)}</span>
          <span class="activity-resource">${resourceDisplay}</span>
          <span class="activity-time">${formatRelativeTime(op.ts)}</span>
        </div>
        ${actorDisplay ? `<div class="activity-actor-row">${actorDisplay}</div>` : ''}
        ${isExpanded ? this.renderExpandedContent(op) : ''}
      </div>
    `;
  }

  private getResourceFromParams(op: OperationEntry): string {
    if (op.tool === 'write_resource' && op.params.uri) {
      const uri = op.params.uri as string;
      return uri.split('/').pop() || uri;
    }
    if (op.params.title) {
      return `"${(op.params.title as string).slice(0, 30)}..."`;
    }
    return '';
  }

  private renderExpandedContent(op: OperationEntry): string {
    const paramsJson = JSON.stringify(op.params, null, 2);
    const resultJson = JSON.stringify(op.result, null, 2);

    // For str_replace operations, use diff2html for proper rendering
    let diffHtml = '';
    if (op.tool === 'write_resource' && op.params.operation) {
      const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
      if (operation.type === 'str_replace' && operation.old_str && operation.new_str) {
        const unifiedDiff = createUnifiedDiff(operation.old_str, operation.new_str);
        diffHtml = `
          <div class="activity-diff">
            <div class="activity-diff-header">Changes</div>
            <div class="activity-diff-content">
              ${Diff2Html.html(unifiedDiff, {
                drawFileList: false,
                matching: 'lines',
                outputFormat: 'line-by-line',
                diffStyle: 'word',
              })}
            </div>
          </div>
        `;
      }
    }

    return `
      <div class="activity-expanded">
        ${diffHtml}
        <details class="activity-details">
          <summary>Parameters</summary>
          <pre class="activity-json">${this.escapeHtml(paramsJson)}</pre>
        </details>
        <details class="activity-details">
          <summary>Result</summary>
          <pre class="activity-json">${this.escapeHtml(resultJson)}</pre>
        </details>
      </div>
    `;
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
