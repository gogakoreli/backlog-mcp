/**
 * task-item.ts — Migrated to the reactive framework (Phase 9, updated Phase 11)
 *
 * Props are signals — simple bindings (title, id, class:selected) are
 * implicit in the template. Conditional branches evaluate at setup time
 * since the parent rebuilds elements on change (HACK:STATIC_LIST).
 *
 * Emits typed events via NavigationEvents emitter (DI singleton).
 *
 * Uses: component, html, inject, Emitter
 */
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { getTypeConfig } from '../type-registry.js';
import { NavigationEvents } from '../services/navigation-events.js';

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
  const nav = inject(NavigationEvents);

  // Evaluate once — parent rebuilds elements on change (HACK:STATIC_LIST)
  const type = props.type.value || 'task';
  const status = props.status.value || 'open';
  const isCurrentEpic = !!props.currentEpic.value;
  const dueDate = props.dueDate.value || '';
  const config = getTypeConfig(type);

  host.className = 'task-item-wrapper';

  // ── Actions ──────────────────────────────────────────────────────

  function handleEnterClick() {
    const id = props.id.value;
    if (id) nav.emit('scope-enter', { scopeId: id });
  }

  function handleItemClick() {
    const id = props.id.value;
    if (id) nav.emit('task-select', { taskId: id });
  }

  // ── Conditional fragments (evaluated once) ───────────────────────

  const dueDateHtml = type === 'milestone' && dueDate
    ? html`<span class="due-date-badge">${new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`
    : null;

  // ── Template — signals implicit for simple bindings ──────────────
  return html`
    <div class="task-item type-${type}" class:selected="${props.selected}" class:current-epic="${isCurrentEpic}" @click="${handleItemClick}">
      <task-badge task-id="${props.id}"></task-badge>
      <span class="task-title">${props.title}</span>
      ${dueDateHtml}
      ${config.isContainer ? html`<span class="child-count">${props.childCount}</span>` : null}
      ${config.isContainer && !isCurrentEpic ? html`<span class="enter-icon" title="Browse inside" @click.stop="${handleEnterClick}">→</span>` : null}
      ${config.hasStatus ? html`<span class="status-badge status-${status}">${status.replace('_', ' ')}</span>` : null}
    </div>
  `;
});
