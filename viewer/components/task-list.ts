/**
 * task-list.ts — Migrated to the reactive framework (Phase 11)
 *
 * Owns: task fetching, filtering, sorting, scoping, selection.
 * Uses TaskItem factory for type-safe child composition.
 * Subscribes to NavigationEvents emitter for task-select/scope-enter.
 *
 * Uses: signal, computed, effect, component, html, inject, Emitter, TaskItem factory
 */
import { signal, computed, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { fetchTasks, type Task } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { sidebarScope } from '../utils/sidebar-scope.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { NavigationEvents } from '../services/navigation-events.js';
import { TaskItem } from './task-item.js';
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
  const nav = inject(NavigationEvents);

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

    if (typeFilter.value !== 'all') {
      tasks = tasks.filter(t => (t.type ?? 'task') === typeFilter.value);
    }

    tasks = sortTasks(tasks, sort.value);

    const scope = scopeId.value;

    if (scope) {
      const container = tasks.find(t => t.id === scope);
      const children = tasks.filter(t => getParentId(t) === scope);
      tasks = container ? [container, ...children] : children;
    } else {
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

  doFetch();

  backlogEvents.onChange((event) => {
    if (event.type === 'task_changed' || event.type === 'task_created' ||
        event.type === 'task_deleted' || event.type === 'resource_changed') {
      doFetch();
    }
  });

  // ── Emitter subscriptions (auto-dispose via emitter-auto-dispose) ──
  nav.on('task-select', ({ taskId }) => {
    selectedId.value = taskId;

    // HACK:DOC_EVENT — backlog-app listens for this to update URL
    document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));

    // HACK:CROSS_QUERY — update task-detail directly until it's migrated
    const detailPane = document.querySelector('task-detail');
    if (detailPane) (detailPane as any).loadTask(taskId);
  });

  nav.on('scope-enter', ({ scopeId: id }) => {
    sidebarScope.set(id);
    scopeId.value = id;
  });

  // ── External event listeners (HACK:DOC_EVENT — until filter-bar uses emitter) ──
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

  // HACK:EXPOSE — replace with props when backlog-app passes state down
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

  // ── HACK:STATIC_LIST — Render list via effect ────────────────────
  // Rebuilds task-item elements when visibleTasks/selectedId/scopeId change.
  // Uses TaskItem factory for type-safe composition (comp-factory-composition).
  // Replace with each() when reactive list primitive is implemented.
  effect(() => {
    const tasks = visibleTasks.value;
    const scope = scopeId.value;
    const selected = selectedId.value;
    const all = allTasks.value;
    const err = error.value;

    const container = host.querySelector('.task-list-container') as HTMLElement;
    if (!container) return;

    // HACK:REF — update breadcrumb via querySelector until ref() exists
    const breadcrumb = host.querySelector('epic-breadcrumb');
    if (breadcrumb) (breadcrumb as any).setData(scope, all);

    if (err) {
      container.replaceChildren();
      const errDiv = document.createElement('div');
      errDiv.className = 'error';
      errDiv.textContent = `Failed to load tasks: ${err}`;
      container.appendChild(errDiv);
      return;
    }

    if (tasks.length === 0) {
      container.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.appendChild(Object.assign(document.createElement('div'), { className: 'empty-state-icon', textContent: '—' }));
      empty.appendChild(Object.assign(document.createElement('div'), { textContent: 'No tasks found' }));
      container.appendChild(empty);
      return;
    }

    const isInsideContainer = !!scope;
    const currentContainer = isInsideContainer ? tasks.find(t => t.id === scope) : null;
    const hasOnlyContainer = isInsideContainer && tasks.length === 1 && currentContainer;

    // Build DOM using TaskItem factory (comp-factory-composition)
    const listDiv = document.createElement('div');
    listDiv.className = 'task-list';

    for (const task of tasks) {
      const type = task.type ?? 'task';
      const config = getTypeConfig(type);
      const childCount = config.isContainer
        ? all.filter(t => getParentId(t) === task.id).length
        : 0;
      const isCurrentContainer = scope === task.id;

      // Factory composition — type-safe, signals required (comp-props-signals)
      const result = TaskItem({
        id: signal(task.id),
        title: signal(task.title),
        status: signal(task.status),
        type: signal(type),
        childCount: signal(childCount),
        dueDate: signal(task.due_date || ''),
        selected: signal(selected === task.id),
        currentEpic: signal(isCurrentContainer),
      });

      // Mount factory result into DOM
      const factoryResult = result as unknown as {
        tagName: string;
        props: Record<string, unknown>;
      };
      const el = document.createElement(factoryResult.tagName);
      for (const [key, val] of Object.entries(factoryResult.props)) {
        (el as any)._setProp(key, (val as any).value ?? val);
      }
      listDiv.appendChild(el);

      if (isCurrentContainer) {
        const sep = document.createElement('div');
        sep.className = 'epic-separator';
        const icon = document.createElement('svg-icon');
        icon.className = 'separator-icon';
        icon.setAttribute('src', ringIcon);
        sep.appendChild(icon);
        listDiv.appendChild(sep);
      }
    }

    if (hasOnlyContainer) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-inline';
      empty.appendChild(Object.assign(document.createElement('div'), { className: 'empty-state-icon', textContent: '—' }));
      empty.appendChild(Object.assign(document.createElement('div'), { textContent: 'No items in this container' }));
      listDiv.appendChild(empty);
    }

    container.replaceChildren(listDiv);
  });

  // ── Template (static shell) ──────────────────────────────────────
  return html`
    <epic-breadcrumb></epic-breadcrumb>
    <div class="task-list-container"></div>
  `;
});
