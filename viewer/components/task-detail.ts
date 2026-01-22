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
      }

      const metaHtml = `
        <div class="task-meta-card">
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
        </div>
      `;
      
      const article = document.createElement('article');
      article.className = 'markdown-body';
      article.innerHTML = metaHtml;
      
      const mdBlock = document.createElement('md-block');
      mdBlock.textContent = task.description || '';
      article.appendChild(mdBlock);
      
      this.innerHTML = '';
      this.appendChild(article);
      
      // Bind epic link click to navigate
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
      
      // Bind file:// links to open via server
      this.querySelectorAll('a[href^="file://"]').forEach(link => {
        const path = link.getAttribute('href')!.replace('file://', '');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.dispatchEvent(new CustomEvent('resource-open', { 
            detail: { path },
            bubbles: true 
          }));
        });
      });
      
      // Bind copy raw button (in pane header)
      const copyRawBtn = paneHeader?.querySelector('.copy-raw');
      const raw = task.raw;
      if (copyRawBtn && raw) {
        copyRawBtn.addEventListener('click', () => navigator.clipboard.writeText(raw));
      }
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load task: ${(error as Error).message}</div>`;
    }
  }
}

customElements.define('task-detail', TaskDetail);
