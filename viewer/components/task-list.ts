/**
 * task-list.ts — Reactive task list with declarative data loading.
 *
 * Reads all state from AppState (ADR 0007 shared services).
 * Uses query() for auto-fetching, each() for keyed list rendering.
 * No setState, no local filter/sort signals, no manual doFetch.
 */
import { signal, computed, effect, type ReadonlySignal } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html, each, when } from '@framework/template.js';
import { inject } from '@framework/injector.js';
import { query } from '@framework/query.js';
import { fetchTasks, type Task } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { AppState } from '../services/app-state.js';
import { TaskItem } from './task-item.js';
import { Breadcrumb } from './breadcrumb.js';
import { SvgIcon } from './svg-icon.js';
import { ringIcon } from '../icons/index.js';

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
  const app = inject(AppState);

  // ── Fetch tasks — auto-refetches when filter/query change ────────
  const tasksQuery = query<Task[]>(
    () => ['tasks', app.filter.value, app.query.value],
    () => fetchTasks(app.filter.value as any, app.query.value || undefined),
    { initialData: [] },
  );
  const allTasks = tasksQuery.data as ReadonlySignal<Task[]>;
  const error = computed(() => tasksQuery.error.value?.message ?? null);

  // SSE → refetch
  backlogEvents.onChange((event) => {
    if (event.type === 'task_changed' || event.type === 'task_created' ||
        event.type === 'task_deleted' || event.type === 'resource_changed') {
      tasksQuery.refetch();
    }
  });

  // Auto-scope: when selected task is a leaf, scope to its parent (needs task data)
  effect(() => {
    const tasks = allTasks.value;
    const id = app.selectedTaskId.value;
    if (!tasks?.length || !id) return;
    const selected = tasks.find(t => t.id === id);
    if (!selected) return;
    const config = getTypeConfig(selected.type ?? 'task');
    if (!config.isContainer) {
      app.scopeId.value = getParentId(selected) || null;
    }
  });

  // ── Derived: visible tasks (filtered, sorted, scoped) ───────────
  const visibleTasks = computed(() => {
    let tasks = allTasks.value ?? [];

    if (app.type.value !== 'all') {
      tasks = tasks.filter(t => (t.type ?? 'task') === app.type.value);
    }

    tasks = sortTasks(tasks, app.sort.value);

    const scope = app.scopeId.value;
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

  // ── Enriched tasks for rendering ─────────────────────────────────
  type EnrichedTask = {
    id: string; title: string; status: string; type: string;
    childCount: number; dueDate: string; selected: boolean; currentEpic: boolean;
  };

  const allEnriched = computed<EnrichedTask[]>(() => {
    const tasks = visibleTasks.value;
    const scope = app.scopeId.value;
    const sel = app.selectedTaskId.value;
    const all = allTasks.value ?? [];
    return tasks.map(task => {
      const type = task.type ?? 'task';
      const config = getTypeConfig(type);
      return {
        id: task.id, title: task.title, status: task.status, type,
        childCount: config.isContainer ? all.filter(t => getParentId(t) === task.id).length : 0,
        dueDate: task.due_date || '',
        selected: sel === task.id,
        currentEpic: scope === task.id,
      };
    });
  });

  /** Container item when scoped, rendered above separator. */
  const containerItem = computed<EnrichedTask[]>(() =>
    allEnriched.value.filter(t => t.currentEpic)
  );
  /** Children (or all items when unscoped). */
  const childItems = computed<EnrichedTask[]>(() =>
    allEnriched.value.filter(t => !t.currentEpic)
  );
  const isScoped = computed(() => containerItem.value.length > 0);
  const hasOnlyContainer = computed(() => isScoped.value && childItems.value.length === 0);
  const isEmpty = computed(() => !error.value && allEnriched.value.length === 0);

  // ── Breadcrumb (factory composition) ───────────────────────────────
  const breadcrumb = Breadcrumb({ tasks: allTasks });
  const separatorIcon = SvgIcon({ src: signal(ringIcon) }, { class: 'separator-icon' });

  // ── View pieces ──────────────────────────────────────────────────
  const taskItemFor = (task: ReadonlySignal<EnrichedTask>) =>
    TaskItem({
      id: computed(() => task.value.id),
      title: computed(() => task.value.title),
      status: computed(() => task.value.status),
      type: computed(() => task.value.type),
      childCount: computed(() => task.value.childCount),
      dueDate: computed(() => task.value.dueDate),
      selected: computed(() => task.value.selected),
      currentEpic: computed(() => task.value.currentEpic),
    });

  const containerList = each(containerItem, t => t.id, (task) =>
    html`${taskItemFor(task)}`
  );
  const childList = each(childItems, t => t.id, (task) =>
    html`${taskItemFor(task)}`
  );

  // ── Template ─────────────────────────────────────────────────────
  return html`
    ${breadcrumb}
    <div class="task-list-container">
      ${when(error, html`<div class="error">Failed to load tasks: ${error}</div>`)}
      ${when(isEmpty, html`
        <div class="empty-state">
          <div class="empty-state-icon">—</div>
          <div>No tasks found</div>
        </div>
      `)}
      <div class="task-list">
        ${containerList}
        ${when(isScoped, html`
          <div class="epic-separator">
            ${separatorIcon}
          </div>
        `)}
        ${childList}
        ${when(hasOnlyContainer, html`
          <div class="empty-state-inline">
            <div class="empty-state-icon">—</div>
            <div>No items in this container</div>
          </div>
        `)}
      </div>
    </div>
  `;
});
