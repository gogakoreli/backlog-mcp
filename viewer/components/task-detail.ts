import { fetchTask, fetchOperationCount } from '../utils/api.js';
import type { Reference } from '../utils/api.js';
import { copyIcon, activityIcon } from '../icons/index.js';
import { backlogEvents } from '../services/event-source-client.js';

function linkify(input: string | Reference): string {
  if (typeof input === 'string') {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    return input.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  return `<a href="${input.url}" target="_blank" rel="noopener">${input.title || input.url}</a>`;
}

export class TaskDetail extends HTMLElement {
  private currentTaskId: string | null = null;

  connectedCallback() {
    this.showEmpty();

    // Re-fetch displayed task when it changes via SSE
    backlogEvents.onChange((event) => {
      if (this.currentTaskId && event.type === 'task_changed' && event.id === this.currentTaskId) {
        this.loadTask(this.currentTaskId);
      }
    });
  }

  showEmpty() {
    this.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">←</div>
        <div>Select a task to view details</div>
      </div>
    `;
  }
  
  async loadTask(taskId: string) {
    this.currentTaskId = taskId;
    try {
      const task = await fetchTask(taskId);
      
      // Update pane header
      this.updatePaneHeader(task);
      
      // Create resource-viewer with custom metadata renderer
      const viewer = document.createElement('resource-viewer') as any;
      viewer.setShowHeader(false); // No header for task detail
      viewer.setMetadataRenderer((frontmatter: any) => this.renderTaskMetadata(frontmatter));
      viewer.loadData({
        frontmatter: task,
        content: task.description || '',
        path: task.filePath,
        ext: 'md'
      });
      
      this.innerHTML = '';
      this.appendChild(viewer);
      
      // Bind event handlers after render
      setTimeout(() => this.bindEventHandlers(task), 0);
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load task: ${(error as Error).message}</div>`;
    }
  }

  private updatePaneHeader(task: any) {
    const headerHtml = `
      <div class="task-header-left">
        ${task.epic_id ? `<copy-button id="copy-epic-id" title="Copy Epic ID"><task-badge task-id="${task.epic_id}"></task-badge></copy-button>` : ''}
        <copy-button id="copy-task-id" title="Copy ID"><task-badge task-id="${task.id}"></task-badge></copy-button>
        <span class="status-badge status-${task.status || 'open'}">${(task.status || 'open').replace('_', ' ')}</span>
      </div>
      <div class="task-header-right">
        <button id="task-activity-btn" class="btn-outline activity-btn-with-badge" title="View activity for this task">
          <svg-icon src="${activityIcon}" size="14px"></svg-icon>
          <span id="activity-count-badge" class="activity-badge" style="display: none;"></span>
        </button>
        <copy-button id="copy-markdown" title="Copy markdown">Copy Markdown</copy-button>
      </div>
    `;
    
    const paneHeader = document.getElementById('task-pane-header');
    if (paneHeader) {
      paneHeader.innerHTML = headerHtml;
      
      // Set text via property (not attribute) to avoid DOM pollution
      const epicBtn = document.getElementById('copy-epic-id') as any;
      if (epicBtn) epicBtn.text = task.epic_id;
      
      (document.getElementById('copy-task-id') as any).text = task.id;
      (document.getElementById('copy-markdown') as any).text = task.raw || '';
      
      // Activity button handler
      document.getElementById('task-activity-btn')?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('activity-open', { detail: { taskId: task.id } }));
      });
      
      // Fetch and display operation count badge
      this.updateActivityBadge(task.id);
    }
  }

  private async updateActivityBadge(taskId: string) {
    try {
      const count = await fetchOperationCount(taskId);
      const badge = document.getElementById('activity-count-badge');
      if (badge && count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'flex';
      }
    } catch {
      // Silently fail - badge is optional
    }
  }

  private renderTaskMetadata(task: any): HTMLElement {
    const metaDiv = document.createElement('div');
    metaDiv.className = 'task-meta-card';
    metaDiv.innerHTML = `
      <h1 class="task-meta-title">${task.title || ''}</h1>
      <div class="task-meta-row">
        <span>Created: ${task.created_at ? new Date(task.created_at).toLocaleDateString() : ''}</span>
        <span>Updated: ${task.updated_at ? new Date(task.updated_at).toLocaleDateString() : ''}</span>
        ${task.epic_id ? `<span class="task-meta-epic"><span class="task-meta-epic-label">Epic:</span><a href="#" class="epic-link" data-epic-id="${task.epic_id}"><task-badge task-id="${task.epic_id}"></task-badge></a>${task.epicTitle ? `<span class="epic-title">${task.epicTitle}</span>` : ''}</span>` : ''}
      </div>
      ${task.references?.length ? `
        <div class="task-meta-section">
          <div class="task-meta-section-label">References:</div>
          <ul>${task.references.map((r: Reference) => `<li>${linkify(r)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${task.evidence?.length ? `
        <div class="task-meta-section">
          <div class="task-meta-section-label">Evidence:</div>
          <ul>${task.evidence.map((e: string) => `<li>${linkify(e)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${task.blocked_reason?.length ? `
        <div class="task-meta-section blocked-reason-section">
          <div class="task-meta-section-label">Blocked</div>
          <ul>${task.blocked_reason.map((r: string) => `<li>${linkify(r)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    `;
    return metaDiv;
  }

  private bindEventHandlers(task: any) {
    // Bind epic link click
    const epicLink = this.querySelector('.epic-link');
    if (epicLink) {
      epicLink.addEventListener('click', (e) => {
        e.preventDefault();
        const epicId = (epicLink as HTMLElement).dataset.epicId;
        if (epicId) {
          this.loadTask(epicId);
          document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId: epicId } }));
        }
      });
    }
  }
}

customElements.define('task-detail', TaskDetail);
