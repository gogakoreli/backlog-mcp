/**
 * task-badge.ts — Reactive badge showing type icon + task ID.
 */
import { computed, effect, signal } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { getTypeFromId, getTypeConfig } from '../type-registry.js';
import { SvgIcon } from './svg-icon.js';

export const TaskBadge = component<{ taskId: string }>('task-badge', (props, host) => {
  const type = computed(() => getTypeFromId(props.taskId.value || ''));
  const config = computed(() => getTypeConfig(type.value));

  effect(() => { host.className = `task-badge type-${type.value}`; });

  const icon = SvgIcon({ src: computed(() => config.value.icon), class: signal('task-badge-icon') });

  return html`${icon}<span class="task-badge-id">${props.taskId}</span>`;
});
