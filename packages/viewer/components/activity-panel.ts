/**
 * activity-panel.ts — Reactive activity/journal component (Phase 14).
 *
 * Reads SplitPaneState.activityTaskId directly via inject().
 * Replaces the class-based ActivityPanel with signal-driven reactivity.
 *
 * Uses html:inner directive for trusted HTML (diff rendering from diff2html).
 * Uses each() for reactive list rendering of day groups and task groups.
 */
import * as Diff2Html from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib/types';
import { createTwoFilesPatch } from 'diff';
import { signal, computed, effect, component, html, when, each, inject, onCleanup } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { backlogEvents, type ChangeCallback } from '../services/event-source-client.js';
import { TaskBadge } from './task-badge.js';
import {
  getLocalDateKey,
  getTodayKey,
  formatRelativeDay,
  formatTime,
  formatDateTime,
  addDays,
} from '../utils/date.js';
import {
  groupByDay,
  groupByTask,
  aggregateForJournal,
  groupByEpic,
  getToolLabel,
  getToolIcon,
  mergeConsecutiveEdits,
  type OperationEntry,
  type TaskGroup,
  type JournalEntry,
  type EpicGroup,
} from './activity-utils.js';

type ViewMode = 'timeline' | 'journal';

function createUnifiedDiff(oldStr: string, newStr: string, filename: string = 'file'): string {
  return createTwoFilesPatch(filename, filename, oldStr, newStr, '', '', { context: 5 });
}

const MODE_STORAGE_KEY = 'backlog:activity-mode';
const DEFAULT_VISIBLE_ITEMS = 2;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const ActivityPanel = component('activity-panel', (_props, host) => {
  const app = inject(AppState);
  const splitState = inject(SplitPaneState);

  // ── Local state ──────────────────────────────────────────────────
  const operations = signal<OperationEntry[]>([]);
  const expandedOpId = signal<string | null>(null);
  const expandedTaskGroups = signal(new Set<string>());
  const selectedDate = signal(getTodayKey());
  const mode = signal<ViewMode>((() => {
    const saved = localStorage.getItem(MODE_STORAGE_KEY) as ViewMode | null;
    return (saved === 'timeline' || saved === 'journal') ? saved : 'timeline';
  })());

  // ── SSE listener ─────────────────────────────────────────────────
  const changeHandler: ChangeCallback = () => loadOperations();
  backlogEvents.onChange(changeHandler);
  onCleanup(() => backlogEvents.offChange(changeHandler));

  // ── Data loading ─────────────────────────────────────────────────
  async function loadOperations() {
    const taskId = splitState.activityTaskId.value;
    const currentMode = mode.value;

    let url: string;
    if (taskId) {
      url = `/operations?task=${encodeURIComponent(taskId)}&limit=100`;
    } else if (currentMode === 'journal') {
      url = `/operations?date=${selectedDate.value}&tz=${new Date().getTimezoneOffset()}`;
    } else {
      url = '/operations?limit=100';
    }

    try {
      const res = await fetch(url);
      operations.value = await res.json();
    } catch {
      operations.value = [];
    }
  }

  // ── React to state changes ───────────────────────────────────────
  effect(() => {
    // Track all dependencies that should trigger a reload
    const _pane = splitState.activePane.value;
    const _taskId = splitState.activityTaskId.value;
    const _mode = mode.value;
    const _date = selectedDate.value;

    if (_pane === 'activity') {
      loadOperations().catch(() => {});
    }
  });

  // Persist mode to localStorage
  effect(() => {
    localStorage.setItem(MODE_STORAGE_KEY, mode.value);
  });

  // ── Actions ──────────────────────────────────────────────────────
  function setMode(newMode: ViewMode) {
    mode.value = newMode;
    expandedOpId.value = null;
  }

  function navigateDate(action: 'prev' | 'next' | 'today') {
    if (action === 'today') {
      selectedDate.value = getTodayKey();
    } else if (action === 'prev') {
      const prev = addDays(selectedDate.value, -1);
      if (prev) selectedDate.value = prev;
    } else {
      const next = addDays(selectedDate.value, 1);
      if (next) selectedDate.value = next;
    }
  }

  function toggleTaskGroup(taskId: string) {
    const current = expandedTaskGroups.value;
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    expandedTaskGroups.value = next;
  }

  function toggleExpand(opId: string) {
    expandedOpId.value = expandedOpId.value === opId ? null : opId;
  }

  function handleTaskClick(taskId: string) {
    app.selectTask(taskId);
  }

  function handleClearFilter() {
    splitState.clearActivityFilter();
  }

  // ── Rendering helpers (return TemplateResult) ────────────────────

  function renderActorInline(actor?: { type: string; name: string; delegatedBy?: string }) {
    if (!actor) return html`<span></span>`;
    if (actor.type === 'user') {
      return html`<span class="activity-actor-inline activity-actor-user">by you</span>`;
    }
    const text = actor.delegatedBy ? `by ${actor.name} (delegated)` : `by ${actor.name}`;
    return html`<span class="activity-actor-inline activity-actor-agent">${text}</span>`;
  }

  function renderExpandedContent(op: OperationEntry) {
    const parts: ReturnType<typeof html>[] = [];

    if (op.resourceId) {
      parts.push(html`
        <div class="activity-detail-row">
          <span class="activity-detail-label">Task:</span>
          <a href="#" class="activity-task-link" @click.prevent=${() => handleTaskClick(op.resourceId!)}>
            ${TaskBadge({ taskId: signal(op.resourceId) })}
          </a>
        </div>
      `);
    }

    if (op.tool === 'backlog_create') {
      const title = op.params.title as string;
      const parentId = (op.params.parent_id || op.params.epic_id) as string | undefined;
      parts.push(html`
        <div class="activity-detail-row">
          <span class="activity-detail-label">Title:</span>
          <span class="activity-detail-value">${title}</span>
        </div>
      `);
      if (parentId) {
        parts.push(html`
          <div class="activity-detail-row">
            <span class="activity-detail-label">Parent:</span>
            <a href="#" class="activity-task-link" @click.prevent=${() => handleTaskClick(parentId)}>
              ${TaskBadge({ taskId: signal(parentId) })}
            </a>
          </div>
        `);
      }
    } else if (op.tool === 'backlog_update') {
      const fields = Object.entries(op.params).filter(([k]) => k !== 'id');
      for (const [key, value] of fields) {
        let displayValue: string;
        if (Array.isArray(value)) {
          displayValue = value.length > 0 ? `${value.length} items` : 'cleared';
        } else if (typeof value === 'string' && value.length > 100) {
          displayValue = value.slice(0, 100) + '...';
        } else {
          displayValue = String(value);
        }
        parts.push(html`
          <div class="activity-detail-row">
            <span class="activity-detail-label">${key}:</span>
            <span class="activity-detail-value">${displayValue}</span>
          </div>
        `);
      }
    } else if (op.tool === 'backlog_delete') {
      parts.push(html`
        <div class="activity-detail-row">
          <span class="activity-detail-value">Task permanently deleted</span>
        </div>
      `);
    } else if (op.tool === 'write_resource') {
      const diffHtml = renderDiffHtml(op);
      if (diffHtml) {
        parts.push(html`<div class="activity-diff" html:inner="${signal(diffHtml)}"></div>`);
      }
    }

    return html`<div class="activity-expanded" @click.stop=${() => {}}>${parts}</div>`;
  }

  function renderDiffHtml(op: OperationEntry): string | null {
    const mergedOps = op.params._mergedOps as OperationEntry[] | undefined;

    if (mergedOps && mergedOps.length > 1) {
      const uri = op.params.uri as string;
      const filename = uri.split('/').pop() || 'file';
      let combinedDiff = '';
      for (const mergedOp of [...mergedOps].reverse()) {
        const operation = mergedOp.params.operation as { type: string; old_str?: string; new_str?: string };
        if (operation.old_str !== undefined && operation.new_str !== undefined) {
          combinedDiff += createUnifiedDiff(operation.old_str, operation.new_str, filename) + '\n';
        }
      }
      if (combinedDiff) {
        return Diff2Html.html(combinedDiff, {
          drawFileList: false, matching: 'lines',
          outputFormat: 'line-by-line', diffStyle: 'word', colorScheme: ColorSchemeType.DARK,
        });
      }
    } else if (op.params.operation) {
      const operation = op.params.operation as { type: string; old_str?: string; new_str?: string };
      if (operation.type === 'str_replace' && operation.old_str !== undefined && operation.new_str !== undefined) {
        const uri = op.params.uri as string;
        const filename = uri.split('/').pop() || 'file';
        const unifiedDiff = createUnifiedDiff(operation.old_str, operation.new_str, filename);
        return Diff2Html.html(unifiedDiff, {
          drawFileList: false, matching: 'lines',
          outputFormat: 'line-by-line', diffStyle: 'word', colorScheme: ColorSchemeType.DARK,
        });
      } else {
        return null; // Will render type label instead
      }
    }
    return null;
  }

  function renderOperation(op: OperationEntry) {
    const opId = op.ts;
    const isExpanded = computed(() => expandedOpId.value === opId);
    const time = new Date(op.ts);
    const dateKey = getLocalDateKey(time);
    const today = getTodayKey();
    const timeStr = dateKey === today ? formatTime(time) : formatDateTime(time);
    const mergedCount = op.params._mergedCount as number | undefined;

    const expandedView = computed(() => {
      if (!isExpanded.value) return null;
      return renderExpandedContent(op);
    });

    return html`
      <div class="activity-item" class:expanded=${isExpanded} data-op-id="${opId}">
        <div class="activity-item-header" @click=${() => toggleExpand(opId)}>
          <div class="activity-item-left">
            <span class="activity-icon">${getToolIcon(op.tool)}</span>
            <div class="activity-item-info">
              <span class="activity-label">
                ${getToolLabel(op.tool)}
                ${mergedCount && mergedCount > 1
                  ? html`<span class="activity-merged-badge">${mergedCount} edits</span>`
                  : null}
              </span>
              ${renderActorInline(op.actor)}
            </div>
          </div>
          <div class="activity-item-right">
            <span class="activity-time">${timeStr}</span>
          </div>
        </div>
        ${expandedView}
      </div>
    `;
  }

  function renderTaskGroup(taskGroup: TaskGroup) {
    const mergedOps = mergeConsecutiveEdits(taskGroup.operations);
    const isExpanded = computed(() => expandedTaskGroups.value.has(taskGroup.resourceId));
    const hiddenCount = mergedOps.length - DEFAULT_VISIBLE_ITEMS;
    const hasMore = mergedOps.length > DEFAULT_VISIBLE_ITEMS;

    const visibleOps = computed(() => {
      return isExpanded.value ? mergedOps : mergedOps.slice(0, DEFAULT_VISIBLE_ITEMS);
    });

    const mostRecentDate = new Date(taskGroup.mostRecentTs);
    const mostRecentDateStr = formatDateTime(mostRecentDate);
    const isTaskId = /^(TASK|EPIC|FLDR|ARTF|MLST)-\d+$/.test(taskGroup.resourceId);

    const toggleText = computed(() =>
      isExpanded.value ? 'Show less' : `Show ${hiddenCount} more`
    );

    return html`
      <div class="activity-task-group">
        <div class="activity-task-header">
          ${taskGroup.epicId ? html`
            <a href="#" class="activity-epic-link" @click.prevent=${() => handleTaskClick(taskGroup.epicId!)}>
              ${TaskBadge({ taskId: signal(taskGroup.epicId) })}
            </a>
          ` : null}
          ${isTaskId ? html`
            <a href="#" class="activity-task-link" @click.prevent=${() => handleTaskClick(taskGroup.resourceId)}>
              ${TaskBadge({ taskId: signal(taskGroup.resourceId) })}
            </a>
          ` : null}
          ${taskGroup.title !== taskGroup.resourceId
            ? html`<span class="activity-task-title">${taskGroup.title}</span>`
            : null}
          <span class="activity-task-recent">${mostRecentDateStr}</span>
        </div>
        ${computed(() => visibleOps.value.map(op => renderOperation(op)))}
        ${hasMore ? html`
          <button class="activity-toggle-btn" @click.stop=${() => toggleTaskGroup(taskGroup.resourceId)}>
            ${toggleText}
          </button>
        ` : null}
      </div>
    `;
  }

  function renderJournalSection(title: string, entries: JournalEntry[]) {
    if (entries.length === 0) return null;
    const epicGroups = groupByEpic(entries);

    return html`
      <div class="activity-journal-section">
        <div class="activity-journal-section-title">${title}</div>
        ${epicGroups.map(group => html`
          <div class="activity-journal-epic-group">
            <div class="activity-journal-epic-header">
              ${group.epicId ? html`
                <a href="#" class="activity-epic-link" @click.prevent=${() => handleTaskClick(group.epicId!)}>
                  ${TaskBadge({ taskId: signal(group.epicId) })}
                </a>
              ` : null}
              <span class="activity-journal-epic-title">${group.epicTitle}</span>
            </div>
            <ul class="activity-journal-list">
              ${group.entries.map(e => html`
                <li class="activity-journal-item">
                  <a href="#" class="activity-task-link" @click.prevent=${() => handleTaskClick(e.resourceId)}>
                    ${TaskBadge({ taskId: signal(e.resourceId) })}
                  </a>
                  ${e.title !== e.resourceId
                    ? html`<span class="activity-journal-title">${e.title}</span>`
                    : null}
                </li>
              `)}
            </ul>
          </div>
        `)}
      </div>
    `;
  }

  // ── Computed views ───────────────────────────────────────────────

  const taskId = computed(() => splitState.activityTaskId.value);

  const filterHeader = computed(() => {
    const id = taskId.value;
    if (!id) return null;
    return html`
      <div class="activity-filter-header">
        <span class="activity-filter-label">Showing activity for</span>
        ${TaskBadge({ taskId: signal(id) })}
        <button class="activity-filter-clear" title="Show all activity" @click=${handleClearFilter}>✕</button>
      </div>
    `;
  });

  const modeToggle = computed(() => {
    if (taskId.value) return null;
    return html`
      <div class="activity-mode-toggle">
        <button class="activity-mode-btn" class:active=${computed(() => mode.value === 'timeline')}
                @click=${() => setMode('timeline')}>Timeline</button>
        <button class="activity-mode-btn" class:active=${computed(() => mode.value === 'journal')}
                @click=${() => setMode('journal')}>Journal</button>
      </div>
    `;
  });

  const mainContent = computed(() => {
    const ops = operations.value;

    if (ops.length === 0) {
      const id = taskId.value;
      return html`
        <div class="activity-empty">
          <div class="activity-empty-icon">📋</div>
          <div>No activity${id ? ` for ${id}` : ''}</div>
        </div>
      `;
    }

    const currentMode = mode.value;
    const id = taskId.value;

    if (currentMode === 'journal' && !id) {
      return renderJournalView();
    }
    return renderTimelineView();
  });

  function renderTimelineView() {
    const dayGroups = groupByDay(operations.value);
    return html`
      <div class="activity-list">
        ${dayGroups.map(dayGroup => html`
          <div class="activity-day-separator">
            <span class="activity-day-label">${dayGroup.label}</span>
            <span class="activity-day-count">${dayGroup.operations.length}</span>
          </div>
          ${groupByTask(dayGroup.operations).map(taskGroup => renderTaskGroup(taskGroup))}
        `)}
      </div>
    `;
  }

  function renderJournalView() {
    const dayOps = operations.value.filter(op => {
      const dateKey = getLocalDateKey(new Date(op.ts));
      return dateKey === selectedDate.value;
    });

    const journal = aggregateForJournal(dayOps);
    const hasContent = journal.completed.length || journal.inProgress.length ||
                       journal.created.length || journal.updated.length;

    const isToday = computed(() => selectedDate.value === getTodayKey());
    const canGoNext = computed(() => selectedDate.value < getTodayKey());
    const dateLabel = computed(() => formatRelativeDay(selectedDate.value));

    return html`
      <div class="activity-journal">
        <div class="activity-nav">
          <button class="activity-nav-btn" @click=${() => navigateDate('prev')}>← Prev</button>
          <span class="activity-nav-date">${dateLabel}</span>
          <button class="activity-nav-btn" disabled="${computed(() => !canGoNext.value)}"
                  @click=${() => navigateDate('next')}>Next →</button>
          ${when(computed(() => !isToday.value),
            html`<button class="activity-nav-btn activity-nav-today" @click=${() => navigateDate('today')}>Today</button>`
          )}
        </div>

        ${!hasContent ? html`
          <div class="activity-journal-empty">
            <div class="activity-empty-icon">📭</div>
            <div>No activity on ${computed(() => formatRelativeDay(selectedDate.value, { short: true }))}</div>
          </div>
        ` : html`
          <div class="activity-journal-content">
            ${renderJournalSection('✅ Completed', journal.completed)}
            ${renderJournalSection('🚧 In Progress', journal.inProgress)}
            ${renderJournalSection('➕ Created', journal.created)}
            ${renderJournalSection('✏️ Updated', journal.updated)}
          </div>
        `}
      </div>
    `;
  }

  // ── Template ─────────────────────────────────────────────────────
  return html`
    <div class="activity-panel">
      ${filterHeader}
      ${modeToggle}
      ${mainContent}
    </div>
  `;
});
