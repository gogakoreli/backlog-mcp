import { fetchTask } from '../utils/api.js';
import type { Reference } from '../utils/api.js';
import { copyIcon } from '../icons/index.js';

function linkify(input: string | Reference): string {
  if (typeof input === 'string') {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    return input.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  return `<a href="${input.url}" target="_blank" rel="noopener">${input.title || input.url}</a>`;
}

export class TaskDetail extends HTMLElement {
  connectedCallback() {
    this.showEmpty();
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
        ${task.epic_id ? `<button class="btn-outline epic-id-btn" onclick="navigator.clipboard.writeText('${task.epic_id}')" title="Copy Epic ID"><task-badge task-id="${task.epic_id}" type="epic"></task-badge> ${copyIcon}</button>` : ''}
        <button class="btn-outline task-id-btn" onclick="navigator.clipboard.writeText('${task.id}')" title="Copy ID"><task-badge task-id="${task.id}" type="${task.type || 'task'}"></task-badge> ${copyIcon}</button>
        <span class="status-badge status-${task.status || 'open'}">${(task.status || 'open').replace('_', ' ')}</span>
        ${task.filePath ? `
          <div class="task-meta-path">
            <a href="#" class="open-link" onclick="fetch('http://localhost:3030/open/${task.id}');return false;" title="Open in editor">${task.filePath}</a>
          </div>
        ` : ''}
      </div>
      <button class="copy-btn copy-raw btn-outline" title="Copy markdown">Copy Markdown ${copyIcon}</button>
    `;
    
    const paneHeader = document.getElementById('task-pane-header');
    if (paneHeader) {
      paneHeader.innerHTML = headerHtml;
      
      // Bind copy raw button
      const copyRawBtn = paneHeader.querySelector('.copy-raw');
      if (copyRawBtn && task.raw) {
        copyRawBtn.addEventListener('click', () => navigator.clipboard.writeText(task.raw));
      }
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
        ${task.epic_id ? `<span class="task-meta-epic"><span class="task-meta-epic-label">Epic:</span><a href="#" class="epic-link" data-epic-id="${task.epic_id}"><task-badge task-id="${task.epic_id}" type="epic"></task-badge></a>${task.epicTitle ? `<span class="epic-title">${task.epicTitle}</span>` : ''}</span>` : ''}
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
