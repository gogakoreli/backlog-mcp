/**
 * task-item.ts — Migrated to the reactive framework (Phase 9)
 *
 * Data comes from data-* attributes (set by parent task-list via innerHTML).
 * When task-list is migrated, this will switch to reactive props.
 *
 * Uses: component, html template, @click handlers
 */
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { getTypeConfig } from '../type-registry.js';
import { sidebarScope } from '../utils/sidebar-scope.js';

export const TaskItem = component('task-item', (_props, host) => {
  // ── Read data from attributes (set by parent before mount) ────────
  const id = host.dataset.id || '';
  const title = host.dataset.title || '';
  const status = host.dataset.status || 'open';
  const type = host.dataset.type || 'task';
  const isCurrentEpic = host.dataset.currentEpic === 'true';
  const isSelected = host.hasAttribute('selected');
  const childCount = host.dataset.childCount || '0';
  const dueDate = host.dataset.dueDate || '';
  const config = getTypeConfig(type);

  host.className = 'task-item-wrapper';

  // ── Actions ──────────────────────────────────────────────────────

  function handleEnterClick(e: Event) {
    e.stopPropagation();
    if (id) {
      sidebarScope.set(id);
    }
  }

  function handleItemClick() {
    if (!id) return;

    // HACK:CROSS_QUERY — toggle selected across all task-items
    document.querySelectorAll('task-item .task-item').forEach(item => {
      item.classList.toggle('selected', (item.closest('task-item') as HTMLElement)?.dataset.id === id);
    });

    // HACK:CROSS_QUERY — call loadTask on task-detail
    const detailPane = document.querySelector('task-detail');
    if (detailPane) {
      (detailPane as any).loadTask(id);
    }

    // HACK:DOC_EVENT — migrate to Emitter when all listeners are migrated
    document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId: id } }));

    // HACK:CROSS_QUERY — call setSelected on task-list
    const taskList = document.querySelector('task-list');
    if (taskList) {
      (taskList as any).setSelected(id);
    }
  }

  // ── Template ─────────────────────────────────────────────────────

  const dueDateHtml = type === 'milestone' && dueDate
    ? html`<span class="due-date-badge">${new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`
    : null;

  return html`
    <div class="task-item type-${type}" class:selected="${isSelected}" class:current-epic="${isCurrentEpic}" @click="${handleItemClick}">
      <task-badge task-id="${id}"></task-badge>
      <span class="task-title">${title}</span>
      ${dueDateHtml}
      ${config.isContainer ? html`<span class="child-count">${childCount}</span>` : null}
      ${config.isContainer && !isCurrentEpic ? html`<span class="enter-icon" title="Browse inside" @click.stop="${handleEnterClick}">→</span>` : null}
      ${config.hasStatus ? html`<span class="status-badge status-${status}">${status.replace('_', ' ')}</span>` : null}
    </div>
  `;
});
