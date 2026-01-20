import { fetchTasks, type Task } from '../utils/api.js';

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getCollapsedEpics(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('collapsed-epics') || '[]'));
  } catch { return new Set(); }
}

function setCollapsedEpics(ids: Set<string>) {
  localStorage.setItem('collapsed-epics', JSON.stringify([...ids]));
}

export class TaskList extends HTMLElement {
  private currentFilter: string = 'active';
  private currentType: string = 'all';
  private pinnedEpicId: string | null = null;
  private selectedTaskId: string | null = null;
  private collapsedEpics: Set<string> = getCollapsedEpics();
  
  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.selectedTaskId = params.get('task');
    this.pinnedEpicId = params.get('epic');
    
    this.loadTasks();
    setInterval(() => this.loadTasks(), 5000);
    
    document.addEventListener('filter-change', ((e: CustomEvent) => {
      this.currentFilter = e.detail.filter;
      this.currentType = e.detail.type ?? 'all';
      this.loadTasks();
    }) as EventListener);
    
    document.addEventListener('task-selected', ((e: CustomEvent) => {
      this.setSelected(e.detail.taskId);
    }) as EventListener);
    
    document.addEventListener('epic-pin', ((e: CustomEvent) => {
      this.pinnedEpicId = e.detail.epicId;
      this.loadTasks();
    }) as EventListener);
    
    document.addEventListener('epic-toggle', ((e: CustomEvent) => {
      const { epicId } = e.detail;
      if (this.collapsedEpics.has(epicId)) {
        this.collapsedEpics.delete(epicId);
      } else {
        this.collapsedEpics.add(epicId);
      }
      setCollapsedEpics(this.collapsedEpics);
      this.loadTasks();
    }) as EventListener);
  }
  
  setState(filter: string, type: string, epicId: string | null, taskId: string | null) {
    this.currentFilter = filter;
    this.currentType = type;
    this.pinnedEpicId = epicId;
    this.selectedTaskId = taskId;
    this.loadTasks();
  }
  
  async loadTasks() {
    try {
      let tasks = await fetchTasks(this.currentFilter as any);
      
      // Type filter
      if (this.currentType !== 'all') {
        tasks = tasks.filter(t => (t.type ?? 'task') === this.currentType);
      }
      
      // Epic pin filter
      if (this.pinnedEpicId) {
        const pinnedEpic = tasks.find(t => t.id === this.pinnedEpicId);
        const children = tasks.filter(t => t.epic_id === this.pinnedEpicId);
        tasks = pinnedEpic ? [pinnedEpic, ...children] : children;
      }
      
      this.render(tasks);
    } catch (error) {
      this.innerHTML = `<div class="error">Failed to load tasks: ${(error as Error).message}</div>`;
    }
  }
  
  render(tasks: Task[]) {
    if (tasks.length === 0) {
      this.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `;
      return;
    }
    
    // Group: epics first with their children, then orphan tasks
    const epics = tasks.filter(t => (t.type ?? 'task') === 'epic');
    const childTasks = tasks.filter(t => t.epic_id && epics.some(e => e.id === t.epic_id));
    const orphanTasks = tasks.filter(t => (t.type ?? 'task') === 'task' && !childTasks.includes(t));
    
    const grouped: Array<Task & { isChild?: boolean; childCount?: number }> = [];
    for (const epic of epics) {
      const children = childTasks.filter(t => t.epic_id === epic.id);
      const isCollapsed = this.collapsedEpics.has(epic.id);
      grouped.push({ ...epic, childCount: children.length });
      if (!isCollapsed) {
        for (const child of children) {
          grouped.push({ ...child, isChild: true });
        }
      }
    }
    grouped.push(...orphanTasks);
    
    this.innerHTML = `
      <div class="task-list">
        ${grouped.map(task => `
          <task-item 
            data-id="${task.id}"
            data-title="${escapeAttr(task.title)}"
            data-status="${task.status}"
            data-type="${task.type ?? 'task'}"
            ${task.isChild ? 'data-child="true"' : ''}
            ${task.childCount !== undefined ? `data-child-count="${task.childCount}"` : ''}
            ${this.collapsedEpics.has(task.id) ? 'data-collapsed="true"' : ''}
            ${this.selectedTaskId === task.id ? 'selected' : ''}
            ${this.pinnedEpicId === task.id ? 'pinned' : ''}
          ></task-item>
        `).join('')}
      </div>
    `;
  }
  
  setSelected(taskId: string) {
    this.selectedTaskId = taskId;
  }
}

customElements.define('task-list', TaskList);
