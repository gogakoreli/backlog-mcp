/**
 * task-filter-bar.ts — Migrated to the reactive framework (Phase 8)
 *
 * Uses: signal, computed, effect, component, html template
 *
 * Backward-compatible: same tag name, same document events,
 * same setState()/getSort() public API on the element.
 */
import { signal, computed, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { TYPE_REGISTRY } from '../type-registry.js';

// ── Static data ──────────────────────────────────────────────────────

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

const SORT_STORAGE_KEY = 'backlog:sort';

// ── Helper: read saved sort from localStorage ────────────────────────

function loadSavedSort(): string {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved && SORT_OPTIONS.some(o => o.key === saved)) return saved;
  } catch { /* localStorage unavailable */ }
  return 'updated';
}

// ── Type filter entries (static — computed once) ─────────────────────

const TYPE_ENTRIES = [
  { key: 'all', label: 'All' },
  ...Object.entries(TYPE_REGISTRY).map(([key, config]) => ({ key, label: config.label })),
];

// ── Component definition ─────────────────────────────────────────────

export const TaskFilterBar = component('task-filter-bar', (_props, host) => {
  // ── Reactive state ───────────────────────────────────────────────
  const currentFilter = signal('active');
  const currentSort = signal(loadSavedSort());
  const currentType = signal('all');

  // ── Actions ──────────────────────────────────────────────────────
  function setFilter(filter: string) {
    currentFilter.value = filter;
    document.dispatchEvent(new CustomEvent('filter-change', {
      detail: { filter, type: currentType.value, sort: currentSort.value },
    }));
  }

  function setType(type: string) {
    currentType.value = type;
    document.dispatchEvent(new CustomEvent('filter-change', {
      detail: { filter: currentFilter.value, type, sort: currentSort.value },
    }));
  }

  function setSort(sort: string) {
    currentSort.value = sort;
    document.dispatchEvent(new CustomEvent('sort-change', {
      detail: { sort },
    }));
  }

  // ── Side effect: persist sort to localStorage ────────────────────
  effect(() => {
    const sort = currentSort.value;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sort);
    } catch { /* localStorage unavailable */ }
  });

  // ── Backward-compat public API on the host element ───────────────
  (host as any).setState = (filter: string, _type: string, _query: string | null) => {
    currentFilter.value = filter;
  };
  (host as any).getSort = () => currentSort.value;

  // ── Template ─────────────────────────────────────────────────────
  const statusButtons = FILTERS.map(f =>
    html`<button class="filter-btn" class:active="${computed(() => currentFilter.value === f.key)}" data-filter="${f.key}" @click="${() => setFilter(f.key)}">${f.label}</button>`
  );

  const typeButtons = TYPE_ENTRIES.map(t =>
    html`<button class="filter-btn" class:active="${computed(() => currentType.value === t.key)}" data-type-filter="${t.key}" @click="${() => setType(t.key)}">${t.label}</button>`
  );

  const sortOptions = SORT_OPTIONS.map(s =>
    html`<option value="${s.key}">${s.label}</option>`
  );

  // We need an effect to keep the select value in sync with the signal
  // because <option> selected attribute is set at parse time, not reactively.
  effect(() => {
    const sort = currentSort.value;
    const select = host.querySelector('.filter-sort-select') as HTMLSelectElement | null;
    if (select && select.value !== sort) {
      select.value = sort;
    }
  });

  return html`
    <div class="filter-bar">
      ${statusButtons}
      <div class="filter-sort">
        <label class="filter-sort-label">Sort:</label>
        <select class="filter-sort-select" @change="${(e: Event) => setSort((e.target as HTMLSelectElement).value)}">
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
