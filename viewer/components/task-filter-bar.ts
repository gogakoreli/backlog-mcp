/**
 * task-filter-bar.ts — Reactive filter/sort/type controls.
 *
 * Reads/writes AppState signals directly (ADR 0007 shared services).
 * URL updates happen automatically via AppState's signal→URL sync.
 */
import { signal, computed, effect } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html } from '@framework/template.js';
import { inject } from '@framework/injector.js';
import { ref } from '@framework/ref.js';
import { TYPE_REGISTRY } from '../type-registry.js';
import { AppState } from '../services/app-state.js';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
] as const;

const SORT_OPTIONS = [
  { key: 'updated', label: 'Updated' },
  { key: 'created_desc', label: 'Created (newest)' },
  { key: 'created_asc', label: 'Created (oldest)' },
] as const;

const TYPE_ENTRIES = [
  { key: 'all', label: 'All' },
  ...Object.entries(TYPE_REGISTRY).map(([key, config]) => ({ key, label: config.label })),
];

export const TaskFilterBar = component('task-filter-bar', (_props, host) => {
  const app = inject(AppState);

  const setFilter = (filter: string) => { app.filter.value = filter; };
  const setType = (type: string) => { app.type.value = type; };
  const setSort = (sort: string) => { app.sort.value = sort; };

  // Sync select element value when sort signal changes
  const selectRef = ref<HTMLSelectElement>();
  effect(() => {
    const s = app.sort.value;
    if (selectRef.current && selectRef.current.value !== s) {
      selectRef.current.value = s;
    }
  });

  const statusButtons = FILTERS.map(f =>
    html`<button class="filter-btn" class:active="${computed(() => app.filter.value === f.key)}" data-filter="${f.key}" @click="${() => setFilter(f.key)}">${f.label}</button>`
  );

  const typeButtons = TYPE_ENTRIES.map(t =>
    html`<button class="filter-btn" class:active="${computed(() => app.type.value === t.key)}" data-type-filter="${t.key}" @click="${() => setType(t.key)}">${t.label}</button>`
  );

  const sortOptions = SORT_OPTIONS.map(s =>
    html`<option value="${s.key}">${s.label}</option>`
  );

  return html`
    <div class="filter-bar">
      ${statusButtons}
      <div class="filter-sort">
        <label class="filter-sort-label">Sort:</label>
        <select class="filter-sort-select" ${selectRef} @change="${(e: Event) => setSort((e.target as HTMLSelectElement).value)}">
          ${sortOptions}
        </select>
      </div>
    </div>
    <div class="filter-bar type-filter">
      <span class="filter-label">Type</span>
      ${typeButtons}
    </div>
  `;
});
