import { pinIcon, chevronIcon } from '../icons/index.js';

export class TaskItem extends HTMLElement {
  connectedCallback() {
    this.render();
    this.attachListeners();
  }
  
  render() {
    const id = this.dataset.id || '';
    const title = this.dataset.title || '';
    const status = this.dataset.status || 'open';
    const type = this.dataset.type || 'task';
    const isChild = this.dataset.child === 'true';
    const isPinned = this.hasAttribute('pinned');
    const isSelected = this.hasAttribute('selected');
    const isCollapsed = this.dataset.collapsed === 'true';
    const childCount = this.dataset.childCount;
    
    this.className = `task-item-wrapper ${isPinned ? 'pinned' : ''} ${isChild ? 'child' : ''}`;
    this.innerHTML = `
      <div class="task-item ${isSelected ? 'selected' : ''} type-${type}">
        ${type === 'epic' ? `<button class="collapse-btn ${isCollapsed ? 'collapsed' : ''}" title="${isCollapsed ? 'Expand' : 'Collapse'}">${chevronIcon}</button>` : ''}
        <task-badge task-id="${id}" type="${type}"></task-badge>
        <span class="task-title">${title}</span>
        ${isCollapsed && childCount ? `<span class="child-count">${childCount}</span>` : ''}
        <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
      </div>
      ${type === 'epic' ? `<button class="pin-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin to filter'}">${pinIcon}</button>` : ''}
    `;
  }
  
  attachListeners() {
    const taskItem = this.querySelector('.task-item');
    taskItem?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.collapse-btn')) return;
      const taskId = this.dataset.id;
      if (!taskId) return;
      
      document.querySelectorAll('task-item .task-item').forEach(item => {
        item.classList.toggle('selected', (item.closest('task-item') as HTMLElement)?.dataset.id === taskId);
      });
      
      const detailPane = document.querySelector('task-detail');
      if (detailPane) {
        (detailPane as any).loadTask(taskId);
      }
      
      document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
      
      const taskList = document.querySelector('task-list');
      if (taskList) {
        (taskList as any).setSelected(taskId);
      }
    });
    
    const collapseBtn = this.querySelector('.collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const epicId = this.dataset.id;
        if (epicId) {
          document.dispatchEvent(new CustomEvent('epic-toggle', { detail: { epicId } }));
        }
      });
    }
    
    const pinBtn = this.querySelector('.pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const epicId = this.dataset.id;
        if (!epicId) return;
        const isPinned = this.hasAttribute('pinned');
        document.dispatchEvent(new CustomEvent('epic-pin', { detail: { epicId: isPinned ? null : epicId } }));
      });
    }
  }
}

customElements.define('task-item', TaskItem);
