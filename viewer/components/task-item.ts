/**
 * task-item.ts — Migrated to the reactive framework (Phase 9, updated Phase 11)
 *
 * Accepts props from parent (task-list) via _setProp.
 * Emits bubbling `task-select` and `scope-enter` events — no more
 * document.querySelector hacks.
 *
 * Uses: component, html template, @click handlers
 */
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { getTypeConfig } from '../type-registry.js';

export const TaskItem = component<{
  id: string;
  title: string;
  status: string;
  type: string;
  childCount: number;
  dueDate: string;
  selected: boolean;
  currentEpic: boolean;
}>('task-item', (props, host) => {
  // ── Read props (signals from parent) ─────────────────────────────
  const id = props.id.value || '';
  const title = props.title.value || '';
  const status = props.status.value || 'open';
  const type = props.type.value || 'task';
  const isCurrentEpic = !!props.currentEpic.value;
  const isSelected = !!props.selected.value;
  const childCount = props.childCount.value || 0;
  const dueDate = props.dueDate.value || '';
  const config = getTypeConfig(type);

  host.className = 'task-item-wrapper';

  // ── Actions ──────────────────────────────────────────────────────

  function handleEnterClick(e: Event) {
    e.stopPropagation();
    if (id) {
      host.dispatchEvent(new CustomEvent('scope-enter', {
        bubbles: true,
        detail: { scopeId: id },
      }));
    }
  }

  function handleItemClick() {
    if (!id) return;
    host.dispatchEvent(new CustomEvent('task-select', {
      bubbles: true,
      detail: { taskId: id },
    }));
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
