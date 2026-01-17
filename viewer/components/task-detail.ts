import { fetchTask } from '../utils/api.js';
import { copyIcon } from '../icons/index.js';

function linkify(text: string): string {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
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
          <button class="btn-outline task-id-btn" onclick="navigator.clipboard.writeText('${task.id}')" title="Copy ID">${task.id} ${copyIcon}</button>
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
          <div class="task-meta-dates">
            <span>Created: ${task.created_at ? new Date(task.created_at).toLocaleDateString() : ''}</span>
            <span>Updated: ${task.updated_at ? new Date(task.updated_at).toLocaleDateString() : ''}</span>
          </div>
          ${task.evidence?.length ? `
            <div class="task-meta-evidence">
              <div class="task-meta-evidence-label">Evidence:</div>
              <ul>${task.evidence.map((e: string) => `<li>${linkify(e)}</li>`).join('')}</ul>
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
      
      // Bind copy raw button (in pane header)
      const copyRawBtn = paneHeader?.querySelector('.copy-raw');
      if (copyRawBtn && task.raw) {
        copyRawBtn.addEventListener('click', () => navigator.clipboard.writeText(task.raw));
      }
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load task: ${(error as Error).message}</div>`;
    }
  }
}

customElements.define('task-detail', TaskDetail);
