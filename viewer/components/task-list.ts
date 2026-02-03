import { fetchTasks, type Task } from '../utils/api.js';
import './breadcrumb.js';
import { ringIcon } from '../icons/index.js';

function escapeAttr(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class TaskList extends HTMLElement {
  private currentFilter: string = 'active';
  private currentType: string = 'all';
  private currentEpicId: string | null = null;
  private selectedTaskId: string | null = null;
  private currentQuery: string | null = null;
  private allTasks: Task[] = [];
  
  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.selectedTaskId = params.get('task');
    this.currentEpicId = params.get('epic');
    this.currentQuery = params.get('q');
    
    this.loadTasks();
    setInterval(() => this.loadTasks(), 5000);
    
    document.addEventListener('filter-change', ((e: CustomEvent) => {
      this.currentFilter = e.detail.filter;
      this.currentType = e.detail.type ?? 'all';
      this.loadTasks();
    }) as EventListener);
    
    document.addEventListener('search-change', ((e: CustomEvent) => {
      this.currentQuery = e.detail.query || null;
      this.loadTasks();
    }) as EventListener);
    
    document.addEventListener('task-selected', ((e: CustomEvent) => {
      this.setSelected(e.detail.taskId);
    }) as EventListener);
    
    document.addEventListener('epic-navigate', ((e: CustomEvent) => {
      this.currentEpicId = e.detail.epicId;
      if (e.detail.epicId) {
        this.selectedTaskId = e.detail.epicId;
      }
      this.loadTasks();
    }) as EventListener);
  }
  
  setState(filter: string, type: string, epicId: string | null, taskId: string | null, query: string | null) {
    this.currentFilter = filter;
    this.currentType = type;
    this.currentEpicId = epicId;
    this.selectedTaskId = taskId;
    this.currentQuery = query;
    this.loadTasks();
  }
  
  async loadTasks() {
    try {
      let tasks = await fetchTasks(this.currentFilter as any, this.currentQuery || undefined);
      this.allTasks = tasks;
      
      // Type filter
      if (this.currentType !== 'all') {
        tasks = tasks.filter(t => (t.type ?? 'task') === this.currentType);
      }
      
      // Epic navigation filter
      if (this.currentEpicId) {
        const currentEpic = tasks.find(t => t.id === this.currentEpicId);
        const children = tasks.filter(t => t.epic_id === this.currentEpicId);
        tasks = currentEpic ? [currentEpic, ...children] : children;
      } else {
        // Home page: only root epics and orphan tasks
        const rootEpics = tasks.filter(t => (t.type ?? 'task') === 'epic' && !t.epic_id);
        const orphanTasks = tasks.filter(t => (t.type ?? 'task') === 'task' && !t.epic_id);
        tasks = [...rootEpics, ...orphanTasks];
      }
      
      this.render(tasks);
      
      const breadcrumb = this.querySelector('epic-breadcrumb');
      if (breadcrumb) {
        (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
      }
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load tasks: ${(error as Error).message}</div>`;
    }
  }
  
  render(tasks: Task[]) {
    const isEmpty = tasks.length === 0;
    const isInsideEpic = !!this.currentEpicId;
    const currentEpic = isInsideEpic ? tasks.find(t => t.id === this.currentEpicId) : null;
    const hasOnlyEpic = isInsideEpic && tasks.length === 1 && currentEpic;
    
    if (isEmpty) {
      this.innerHTML = `
        <epic-breadcrumb></epic-breadcrumb>
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `;
      const breadcrumb = this.querySelector('epic-breadcrumb');
      if (breadcrumb) {
        (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
      }
      return;
    }
    
    // Group: epics first, then tasks
    const epics = tasks.filter(t => (t.type ?? 'task') === 'epic');
    const regularTasks = tasks.filter(t => (t.type ?? 'task') === 'task');
    const grouped = [...epics, ...regularTasks];
    
    this.innerHTML = `
      <epic-breadcrumb></epic-breadcrumb>
      <div class="task-list">
        ${grouped.map((task, index) => {
          const childCount = (task.type ?? 'task') === 'epic' 
            ? this.allTasks.filter(t => t.epic_id === task.id).length 
            : 0;
          const isCurrentEpic = this.currentEpicId === task.id;
          return `
            <task-item 
              data-id="${task.id}"
              data-title="${escapeAttr(task.title)}"
              data-status="${task.status}"
              data-type="${task.type ?? 'task'}"
              data-child-count="${childCount}"
              ${this.selectedTaskId === task.id ? 'selected' : ''}
              ${isCurrentEpic ? 'data-current-epic="true"' : ''}
            ></task-item>
            ${isCurrentEpic ? `<div class="epic-separator"><svg-icon class="separator-icon" src="${ringIcon}"></svg-icon></div>` : ''}
          `;
        }).join('')}
        ${hasOnlyEpic ? '<div class="empty-state-inline"><div class="empty-state-icon">—</div><div>No tasks in this epic</div></div>' : ''}
      </div>
    `;
    
    const breadcrumb = this.querySelector('epic-breadcrumb');
    if (breadcrumb) {
      (breadcrumb as any).setData(this.currentEpicId, this.allTasks);
    }
  }
  
  setSelected(taskId: string) {
    this.selectedTaskId = taskId;
  }
}

customElements.define('task-list', TaskList);
