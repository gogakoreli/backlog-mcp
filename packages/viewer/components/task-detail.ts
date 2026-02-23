/**
 * task-detail.ts — Reactive task detail view.
 *
 * Reads AppState.selectedTaskId to reactively load and display task data.
 * Uses query() for auto-fetching, factory composition for child components.
 *
 * Owns its own pane header (Phase 15) — no cross-tree DOM updates.
 * Opens activity via inject(SplitPaneState).openActivity() directly.
 */
import { signal, computed } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html, when } from '@framework/template.js';
import { inject } from '@framework/injector.js';
import { query } from '@framework/query.js';
import { onCleanup } from '@framework/lifecycle.js';
import { fetchTask, fetchOperationCount, type TaskResponse } from '../utils/api.js';
import { backlogEvents } from '../services/event-source-client.js';
import { getTypeFromId } from '@backlog-mcp/shared';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { AppState } from '../services/app-state.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { CopyButton } from './copy-button.js';
import { TaskBadge } from './task-badge.js';
import { SvgIcon } from './svg-icon.js';
import { DocumentView } from './document-view.js';
import { activityIcon } from '../icons/index.js';

// ── Component ────────────────────────────────────────────────────────

export const TaskDetail = component('task-detail', () => {
  const app = inject(AppState);
  const splitState = inject(SplitPaneState);

  // ── Data loading — auto-fetches when selectedTaskId changes ─────
  const taskQuery = query<TaskResponse>(
    () => ['task-detail', app.selectedTaskId.value],
    () => fetchTask(app.selectedTaskId.value!),
    {
      enabled: () => !!app.selectedTaskId.value,
      staleTime: 0,
    },
  );

  const task = taskQuery.data;
  const loading = taskQuery.loading;
  const error = computed(() => taskQuery.error.value?.message ?? null);

  // ── Operation count for activity badge ─────────────────────────
  const opCountQuery = query<number>(
    () => ['op-count', app.selectedTaskId.value],
    () => fetchOperationCount(app.selectedTaskId.value!),
    {
      enabled: () => !!app.selectedTaskId.value,
      staleTime: 5000,
    },
  );

  // ── SSE: refetch on task change ────────────────────────────────
  const changeHandler = (event: { type: string; id: string }) => {
    const id = app.selectedTaskId.value;
    if (id && (event.type === 'task_changed' || event.type === 'resource_changed') && event.id === id) {
      taskQuery.refetch();
      opCountQuery.refetch();
    }
  };
  backlogEvents.onChange(changeHandler);
  onCleanup(() => backlogEvents.offChange(changeHandler));

  // ── Derived state ──────────────────────────────────────────────
  const hasTask = computed(() => !!task.value && !!app.selectedTaskId.value);
  const taskDescription = computed(() => task.value?.description ?? '');
  const taskType = computed(() => task.value?.type ?? 'task');
  const taskStatus = computed(() => task.value?.status ?? 'open');
  const hasStatus = computed(() => getTypeConfig(taskType.value).hasStatus);
  const statusClass = computed(() => `status-badge status-${taskStatus.value}`);
  const statusLabel = computed(() => taskStatus.value.replace('_', ' '));
  const parentId = computed(() => {
    const t = task.value;
    return t ? (getParentId(t) ?? null) : null;
  });

  // ── Frontmatter for DocumentView (pass full task response) ─────
  const frontmatter = computed<Record<string, unknown>>(() => task.value ?? {});

  // ── Activity badge ──────────────────────────────────────────────
  const opCount = computed(() => opCountQuery.data.value ?? 0);
  const showBadge = computed(() => opCount.value > 0);
  const badgeText = computed(() => opCount.value > 99 ? '99+' : String(opCount.value));

  // ── Actions ────────────────────────────────────────────────────

  function handleActivityClick() {
    const id = app.selectedTaskId.value;
    if (id) {
      splitState.openActivity(id);
    }
  }

  const rawMarkdown = computed(() => task.value?.raw || '');

  // ── Pane header (reactive, owned by task-detail) ────────────────

  const paneHeader = computed(() => {
    const t = task.value;

    if (!t) {
      return html`
        <div class="pane-header" id="task-pane-header">
          <div class="pane-title">Task Detail</div>
        </div>
      `;
    }

    return html`
      <div class="pane-header" id="task-pane-header">
        <div class="task-header-left">
          ${when(parentId, html`
            ${CopyButton({
              text: parentId as any,
              content: TaskBadge({ taskId: parentId as any }),
            })}
          `)}
          ${CopyButton({
            text: computed(() => t.id),
            content: TaskBadge({ taskId: computed(() => t.id) }),
          })}
          ${when(hasStatus, html`
            <span class="${statusClass}">${statusLabel}</span>
          `)}
        </div>
        <div class="task-header-right">
          <button class="btn-outline activity-btn-with-badge" title="View activity for this task"
                  @click="${handleActivityClick}">
            ${SvgIcon({ src: signal(activityIcon), size: signal('14px') })}
            ${when(showBadge, html`
              <span class="activity-badge">${badgeText}</span>
            `)}
          </button>
          ${CopyButton({ text: rawMarkdown, content: html`Copy Markdown` })}
        </div>
      </div>
    `;
  });

  // ── Content view — DocumentView renders header + markdown ───────
  const taskView = DocumentView({
    frontmatter,
    content: taskDescription,
    onNavigate: (id) => {
      if (getTypeConfig(getTypeFromId(id)).opensInPane) {
        splitState.openMcpResource(`mcp://backlog/tasks/${id}.md`);
      } else {
        app.selectTask(id);
      }
    },
  });

  const emptyView = html`
    <div class="empty-state">
      <div class="empty-state-icon">←</div>
      <div>Select a task to view details</div>
    </div>
  `;

  const errorView = html`<div class="error">Failed to load task</div>`;
  const loadingView = html`<div class="loading">Loading...</div>`;

  const content = computed(() => {
    if (!app.selectedTaskId.value) return emptyView;
    if (error.value) return errorView;
    if (loading.value && !task.value) return loadingView;
    if (hasTask.value) return taskView;
    return emptyView;
  });

  // ── Template ───────────────────────────────────────────────────
  return html`
    ${paneHeader}
    <div class="pane-content">
      ${content}
    </div>
  `;
});
