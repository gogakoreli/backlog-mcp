/**
 * task-item.ts — Migrated to the reactive framework (Phase 9, updated Phase 11)
 *
 * All props are signals — template reads them implicitly.
 * Conditional branches use computed views (tmpl-computed-views).
 * Emits typed events via NavigationEvents emitter (DI singleton).
 *
 * Uses: component, computed, html, when, inject, Emitter
 */
import { computed } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html, when } from '../framework/template.js';
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

  // ── Derived state ────────────────────────────────────────────────
  const config = computed(() => getTypeConfig(props.type.value || 'task'));

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

  // ── Computed views (tmpl-computed-views) ──────────────────────────

  const dueDateHtml = computed(() => {
    if (props.type.value === 'milestone' && props.dueDate.value) {
      return html`<span class="due-date-badge">${new Date(props.dueDate.value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`;
    }
    return null;
  });

  const childCountHtml = computed(() =>
    config.value.isContainer
      ? html`<span class="child-count">${props.childCount}</span>`
      : null
  );

  const enterIconHtml = computed(() =>
    config.value.isContainer && !props.currentEpic.value
      ? html`<span class="enter-icon" title="Browse inside" @click.stop="${handleEnterClick}">→</span>`
      : null
  );

  const statusHtml = computed(() => {
    if (!config.value.hasStatus) return null;
    const s = props.status.value || 'open';
    return html`<span class="status-badge status-${s}">${s.replace('_', ' ')}</span>`;
  });

  // ── Template — all signals implicit ──────────────────────────────
  return html`
    <div class="task-item type-${props.type}" class:selected="${props.selected}" class:current-epic="${props.currentEpic}" @click="${handleItemClick}">
      <task-badge task-id="${props.id}"></task-badge>
      <span class="task-title">${props.title}</span>
      ${dueDateHtml}
      ${childCountHtml}
      ${enterIconHtml}
      ${statusHtml}
    </div>
  `;
});
