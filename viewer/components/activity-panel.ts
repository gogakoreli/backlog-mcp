interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
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

export class ActivityPanel extends HTMLElement {
  private taskId: string | null = null;
  private operations: OperationEntry[] = [];
  private expandedIndex: number | null = null;

  connectedCallback() {
    this.className = 'activity-panel';
    this.render();
  }

  setTaskId(taskId: string | null) {
    this.taskId = taskId;
    this.loadOperations();
  }

  async loadOperations() {
    this.innerHTML = '<div class="activity-loading">Loading activity...</div>';

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

    return `
      <div class="activity-item ${isExpanded ? 'expanded' : ''}" data-index="${index}">
        <div class="activity-item-header">
          <span class="activity-icon">${getToolIcon(op.tool)}</span>
          <span class="activity-label">${getToolLabel(op.tool)}</span>
          <span class="activity-resource">${resourceDisplay}</span>
          <span class="activity-time">${formatRelativeTime(op.ts)}</span>
        </div>
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

    // For str_replace operations, show a simple diff
    let diffHtml = '';
    if (op.tool === 'write_resource' && op.params.operation) {
      const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
      if (operation.type === 'str_replace' && operation.old_str && operation.new_str) {
        diffHtml = `
          <div class="activity-diff">
            <div class="activity-diff-header">Changes</div>
            <div class="activity-diff-old">- ${this.escapeHtml(operation.old_str.slice(0, 200))}</div>
            <div class="activity-diff-new">+ ${this.escapeHtml(operation.new_str.slice(0, 200))}</div>
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
