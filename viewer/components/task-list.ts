/**
 * task-list.ts — Migrated to the reactive framework (Phase 11)
 *
 * Owns: task fetching, filtering, sorting, scoping, selection.
 * Renders task-item children via effect-driven list (no innerHTML).
 * Passes props to task-item instead of data-* attributes.
 *
 * Uses: signal, computed, effect, component, html template
 */
import { signal, computed, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { fetchTasks, type Task } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { sidebarScope } from '../utils/sidebar-scope.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import './breadcrumb.js';
import { ringIcon } from '../icons/index.js';

const SORT_STORAGE_KEY = 'backlog:sort';

function loadSavedSort(): string {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved) return saved;
  } catch { /* localStorage unavailable */ }
  return 'updated';
}

function sortTasks(tasks: Task[], sort: string): Task[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created_desc':
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case 'created_asc':
      return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    default:
      return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
}

export const TaskList = component('task-list', (_props, host) => {
  // ── Reactive state ───────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);

  const filter = signal(params.get('filter') || 'active');
  const typeFilter = signal('all');
  const sort = signal(loadSavedSort());
  const selectedId = signal<string | null>(params.get('id') || params.get('task'));
  const query = signal<string | null>(null);
  const allTasks = signal<Task[]>([]);
  const scopeId = signal<string | null>(sidebarScope.get());
  const error = signal<string | null>(null);
  const pendingAutoScope = signal(false);

  // ── Derived: visible tasks ───────────────────────────────────────
  const visibleTasks = computed(() => {
    let tasks = allTasks.value;

    // Type filter
    if (typeFilter.value !== 'all') {
      tasks = tasks.filter(t => (t.type ?? 'task') === typeFilter.value);
    }

    // Sort
    tasks = sortTasks(tasks, sort.value);

    const scope = scopeId.value;

    // Scope filter
    if (scope) {
      const container = tasks.find(t => t.id === scope);
      const children = tasks.filter(t => getParentId(t) === scope);
      tasks = container ? [container, ...children] : children;
    } else {
      // Home: root containers + orphan leaves
      const containers = tasks.filter(t => {
        const config = getTypeConfig(t.type ?? 'task');
        return config.isContainer && !getParentId(t);
      });
      const orphans = tasks.filter(t => {
        const config = getTypeConfig(t.type ?? 'task');
        return !config.isContainer && !getParentId(t);
      });
      tasks = [...containers, ...orphans];
    }

    // Group: containers first, then leaves
    const containers = tasks.filter(t => getTypeConfig(t.type ?? 'task').isContainer);
    const leaves = tasks.filter(t => !getTypeConfig(t.type ?? 'task').isContainer);
    return [...containers, ...leaves];
  });

  // ── Fetch tasks ──────────────────────────────────────────────────
  async function doFetch() {
    try {
      error.value = null;
      const tasks = await fetchTasks(filter.value as any, query.value || undefined);
      allTasks.value = tasks;

      // Auto-scope for leaf entities on URL navigation
      if (pendingAutoScope.value && selectedId.value) {
        pendingAutoScope.value = false;
        const selected = tasks.find(t => t.id === selectedId.value);
        if (selected) {
          const config = getTypeConfig(selected.type ?? 'task');
          if (!config.isContainer) {
            const parentId = getParentId(selected);
            sidebarScope.set(parentId || null);
            scopeId.value = parentId || null;
          }
        }
      }
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  // Initial fetch
  doFetch();

  // Real-time updates
  backlogEvents.onChange((event) => {
    if (event.type === 'task_changed' || event.type === 'task_created' ||
        event.type === 'task_deleted' || event.type === 'resource_changed') {
      doFetch();
    }
  });

  // ── External event listeners (HACK:DOC_EVENT — until backlog-app migrated) ──
  document.addEventListener('filter-change', ((e: CustomEvent) => {
    filter.value = e.detail.filter;
    typeFilter.value = e.detail.type ?? 'all';
    doFetch();
  }) as EventListener);

  document.addEventListener('sort-change', ((e: CustomEvent) => {
    sort.value = e.detail.sort;
  }) as EventListener);

  document.addEventListener('search-change', ((e: CustomEvent) => {
    query.value = e.detail.query || null;
    doFetch();
  }) as EventListener);

  document.addEventListener('scope-change', (() => {
    scopeId.value = sidebarScope.get();
  }) as EventListener);

  // ── Handle bubbling events from child task-items ──────────────────
  host.addEventListener('task-select', ((e: CustomEvent) => {
    const taskId = e.detail.taskId;
    selectedId.value = taskId;

    // HACK:DOC_EVENT — backlog-app listens for this to update task-detail + URL
    document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));

    // HACK:CROSS_QUERY — update task-detail directly until backlog-app is migrated
    const detailPane = document.querySelector('task-detail');
    if (detailPane) (detailPane as any).loadTask(taskId);
  }) as EventListener);

  host.addEventListener('scope-enter', ((e: CustomEvent) => {
    const id = e.detail.scopeId;
    sidebarScope.set(id);
    scopeId.value = id;
  }) as EventListener);

  // HACK:EXPOSE — replace with props when backlog-app is migrated
  (host as any).setState = (f: string, t: string, id: string | null, q: string | null) => {
    filter.value = f;
    typeFilter.value = t;
    selectedId.value = id;
    query.value = q;
    pendingAutoScope.value = !!id;
    doFetch();
  };

  (host as any).setSelected = (taskId: string) => {
    selectedId.value = taskId;
  };

  // ── Render list via effect ───────────────────────────────────────
  // The framework doesn't have a reactive list primitive yet,
  // so we use an effect that rebuilds the list container.
  effect(() => {
    const tasks = visibleTasks.value;
    const scope = scopeId.value;
    const selected = selectedId.value;
    const all = allTasks.value;
    const err = error.value;

    const container = host.querySelector('.task-list-container') as HTMLElement;
    if (!container) return;

    // Update breadcrumb
    const breadcrumb = host.querySelector('epic-breadcrumb');
    if (breadcrumb) (breadcrumb as any).setData(scope, all);

    if (err) {
      container.innerHTML = `<div class="error">Failed to load tasks: ${err}</div>`;
      return;
    }

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `;
      return;
    }

    const isInsideContainer = !!scope;
    const currentContainer = isInsideContainer ? tasks.find(t => t.id === scope) : null;
    const hasOnlyContainer = isInsideContainer && tasks.length === 1 && currentContainer;

    // Build DOM
    container.innerHTML = '';
    const listDiv = document.createElement('div');
    listDiv.className = 'task-list';

    for (const task of tasks) {
      const type = task.type ?? 'task';
      const config = getTypeConfig(type);
      const childCount = config.isContainer
        ? all.filter(t => getParentId(t) === task.id).length
        : 0;
      const isCurrentContainer = scope === task.id;

      const item = document.createElement('task-item');
      // Props via _setProp (auto-resolution path)
      (item as any)._setProp('id', task.id);
      (item as any)._setProp('title', task.title);
      (item as any)._setProp('status', task.status);
      (item as any)._setProp('type', type);
      (item as any)._setProp('childCount', childCount);
      (item as any)._setProp('dueDate', task.due_date || '');
      (item as any)._setProp('selected', selected === task.id);
      (item as any)._setProp('currentEpic', isCurrentContainer);
      listDiv.appendChild(item);

      if (isCurrentContainer) {
        const sep = document.createElement('div');
        sep.className = 'epic-separator';
        sep.innerHTML = `<svg-icon class="separator-icon" src="${ringIcon}"></svg-icon>`;
        listDiv.appendChild(sep);
      }
    }

    if (hasOnlyContainer) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-inline';
      empty.innerHTML = '<div class="empty-state-icon">—</div><div>No items in this container</div>';
      listDiv.appendChild(empty);
    }

    container.appendChild(listDiv);
  });

  // ── Template (static shell) ──────────────────────────────────────
  return html`
    <epic-breadcrumb></epic-breadcrumb>
    <div class="task-list-container"></div>
  `;
});
