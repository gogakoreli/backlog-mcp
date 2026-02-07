import { getTypeConfig } from '../type-registry.js';
import { sidebarScope } from '../utils/sidebar-scope.js';

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
    const isCurrentEpic = this.dataset.currentEpic === 'true';
    const isSelected = this.hasAttribute('selected');
    const childCount = this.dataset.childCount || '0';
    const dueDate = this.dataset.dueDate || '';
    const config = getTypeConfig(type);
    
    this.className = 'task-item-wrapper';

    const dueDateHtml = type === 'milestone' && dueDate
      ? `<span class="due-date-badge">${new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`
      : '';

    this.innerHTML = `
      <div class="task-item ${isSelected ? 'selected' : ''} ${isCurrentEpic ? 'current-epic' : ''} type-${type}">
        <task-badge task-id="${id}"></task-badge>
        <span class="task-title">${title}</span>
        ${dueDateHtml}
        ${config.isContainer ? `<span class="child-count">${childCount}</span>` : ''}
        ${config.isContainer && !isCurrentEpic ? '<span class="enter-icon" title="Browse inside">→</span>' : ''}
        ${config.hasStatus ? `<span class="status-badge status-${status}">${status.replace('_', ' ')}</span>` : ''}
      </div>
    `;
  }
  
  attachListeners() {
    const taskItem = this.querySelector('.task-item');
    const enterIcon = this.querySelector('.enter-icon');
    const type = this.dataset.type || 'task';
    const config = getTypeConfig(type);
    
    // Arrow click → scope sidebar only (no URL change)
    if (enterIcon && config.isContainer) {
      enterIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = this.dataset.id;
        if (taskId) {
          sidebarScope.set(taskId);
        }
      });
    }

    // Item click → navigate (set ?id=, show in detail)
    taskItem?.addEventListener('click', () => {
      const taskId = this.dataset.id;
      if (!taskId) return;
      
      // Select and show detail
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
  }
}

customElements.define('task-item', TaskItem);
