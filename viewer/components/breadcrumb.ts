import type { Task } from '../utils/api.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { sidebarScope } from '../utils/sidebar-scope.js';

export class Breadcrumb extends HTMLElement {
  private currentScopeId: string | null = null;
  private tasks: Task[] = [];

  setData(currentScopeId: string | null, tasks: Task[]) {
    this.currentScopeId = currentScopeId;
    this.tasks = tasks;
    this.render();
  }

  private buildPath(): Task[] {
    if (!this.currentScopeId) return [];
    
    const path: Task[] = [];
    let currentId: string | null = this.currentScopeId;
    const seen = new Set<string>();
    
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const item = this.tasks.find(t => t.id === currentId);
      if (!item) break;
      path.unshift(item);
      currentId = getParentId(item) || null;
    }
    
    return path;
  }

  private render() {
    const path = this.buildPath();
    
    this.innerHTML = `
      <div class="breadcrumb">
        <button class="breadcrumb-segment" data-scope-id="" title="All Items">All Items</button>
        ${path.map(item => {
          const config = getTypeConfig(item.type ?? 'task');
          return `
            <span class="breadcrumb-separator">›</span>
            <button class="breadcrumb-segment" data-scope-id="${item.id}" title="${item.title}">
              <svg-icon src="${config.icon}" class="breadcrumb-type-icon type-${item.type ?? 'task'}" size="12px"></svg-icon>
              ${item.title}
            </button>
          `;
        }).join('')}
      </div>
    `;

    this.querySelectorAll('.breadcrumb-segment').forEach(btn => {
      btn.addEventListener('click', () => {
        const scopeId = (btn as HTMLElement).dataset.scopeId || null;
        sidebarScope.set(scopeId);
      });
    });
  }
}

customElements.define('epic-breadcrumb', Breadcrumb);
