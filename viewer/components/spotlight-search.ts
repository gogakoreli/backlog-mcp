/**
 * spotlight-search.ts — Reactive spotlight search component.
 *
 * Reads AppState.isSpotlightOpen to show/hide. Performs debounced search
 * against the unified search API. Supports type filtering, sort mode,
 * keyboard navigation, recent searches, and recent activity tabs.
 *
 * Uses query() for recent activity data, signals for all internal state,
 * and factory composition for TaskBadge children.
 *
 * See ADR 0007 (shared services) for the open/close signal pattern.
 *
 * GAP:INNERHTML_BINDING — Search result titles and snippets contain
 * highlighted HTML from @orama/highlight. The framework has no safe
 * innerHTML binding directive, so we set innerHTML imperatively via
 * effects after render. See ADR 0011 Gap 1.
 */
import { signal, computed, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html, when, each } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { query } from '../framework/query.js';
import { onMount, onCleanup } from '../framework/lifecycle.js';
import { Highlight } from '@orama/highlight';
import type { Task } from '../utils/api.js';
import { API_URL } from '../utils/api.js';
import { AppState } from '../services/app-state.js';
import { recentSearchesService, type RecentSearchItem } from '../services/recent-searches-service.js';
import { TaskBadge } from './task-badge.js';

// ── Types ────────────────────────────────────────────────────────────

const highlighter = new Highlight({ CSSClass: 'spotlight-match' });

interface Resource {
  id: string;
  path: string;
  title: string;
  content: string;
}

interface UnifiedSearchResult {
  item: Task | Resource;
  score: number;
  type: 'task' | 'epic' | 'resource';
}

interface SearchResult {
  item: Task | Resource;
  type: 'task' | 'epic' | 'resource';
  snippet: { field: string; html: string; matchedFields: string[] };
  score: number;
}

type SortMode = 'relevant' | 'recent';
type TypeFilter = 'all' | 'task' | 'epic' | 'resource';
type DefaultTab = 'searches' | 'activity';

function isResource(item: Task | Resource): item is Resource {
  return 'path' in item && 'content' in item;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateTaskSnippet(task: Task, q: string): SearchResult['snippet'] {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: task.title },
    { name: 'description', value: task.description || '' },
    { name: 'evidence', value: (task.evidence || []).join(' ') },
    { name: 'blocked_reason', value: (task.blocked_reason || []).join(' ') },
    { name: 'references', value: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' ') },
  ];

  const matchedFields: string[] = [];
  let firstMatchField = '';
  let firstMatchHtml = '';

  for (const { name, value } of fields) {
    if (!value) continue;
    const result = highlighter.highlight(value, q);
    if (result.positions.length > 0) {
      matchedFields.push(name);
      if (!firstMatchField) {
        firstMatchField = name;
        firstMatchHtml = result.trim(100);
      }
    }
  }

  if (!firstMatchField) {
    return { field: 'title', html: escapeHtml(task.title), matchedFields: [] };
  }
  return { field: firstMatchField, html: firstMatchHtml, matchedFields };
}

function generateResourceSnippet(resource: Resource, q: string): SearchResult['snippet'] {
  const fields: { name: string; value: string }[] = [
    { name: 'title', value: resource.title },
    { name: 'content', value: resource.content },
  ];

  const matchedFields: string[] = [];
  let firstMatchField = '';
  let firstMatchHtml = '';

  for (const { name, value } of fields) {
    if (!value) continue;
    const result = highlighter.highlight(value, q);
    if (result.positions.length > 0) {
      matchedFields.push(name);
      if (!firstMatchField) {
        firstMatchField = name;
        firstMatchHtml = result.trim(100);
      }
    }
  }

  if (!firstMatchField) {
    return { field: 'title', html: escapeHtml(resource.title), matchedFields: [] };
  }
  return { field: firstMatchField, html: firstMatchHtml, matchedFields };
}

function formatMatchedFields(fields: string[]): string {
  if (fields.length === 0) return '';
  return `Matched in: ${fields.join(', ')}`;
}

// ── Component ────────────────────────────────────────────────────────

export const SpotlightSearch = component('spotlight-search', (_props, host) => {
  const app = inject(AppState);

  // ── Internal state ────────────────────────────────────────────────
  const queryText = signal('');
  const results = signal<SearchResult[]>([]);
  const selectedIndex = signal(0);
  const sortMode = signal<SortMode>('relevant');
  const typeFilter = signal<TypeFilter>('all');
  const isLoading = signal(false);
  const activeTab = signal<DefaultTab>('searches');
  const recentSearches = signal<RecentSearchItem[]>([]);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Recent activity — loaded via query() when spotlight opens ─────
  const activityQuery = query<Task[]>(
    () => ['spotlight-activity', app.isSpotlightOpen.value],
    () => fetch(`${API_URL}/tasks?filter=all&limit=15`).then(r => r.json()),
    {
      enabled: () => app.isSpotlightOpen.value,
      staleTime: 10000,
    },
  );

  const recentActivity = computed<SearchResult[]>(() => {
    const tasks = activityQuery.data.value;
    if (!tasks) return [];
    const sorted = [...tasks].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    return sorted.slice(0, 15).map(task => ({
      item: task,
      type: (task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task')) as 'task' | 'epic',
      snippet: { field: '', html: '', matchedFields: [] },
      score: 0,
    }));
  });

  // ── Derived state ─────────────────────────────────────────────────
  const hasQuery = computed(() => queryText.value.length >= 2);
  const overlayDisplay = computed(() => app.isSpotlightOpen.value ? 'flex' : 'none');

  const resultCountText = computed(() => {
    if (!hasQuery.value) return '';
    if (results.value.length === 0) return 'No results';
    const n = results.value.length;
    return `${n} result${n === 1 ? '' : 's'}`;
  });

  // ── Actions ───────────────────────────────────────────────────────
  function close() {
    app.isSpotlightOpen.value = false;
  }

  function handleOverlayClick(e: Event) {
    if (e.target === (e.currentTarget as HTMLElement)) close();
  }

  async function doSearch() {
    const q = queryText.value;
    if (q.length < 2) return;

    isLoading.value = true;
    try {
      const params = new URLSearchParams({
        q,
        limit: '20',
        sort: sortMode.value,
      });
      if (typeFilter.value !== 'all') {
        params.set('types', typeFilter.value);
      }
      const response = await fetch(`${API_URL}/search?${params}`);
      const apiResults: UnifiedSearchResult[] = await response.json();

      results.value = apiResults.map(r => {
        const snippet = isResource(r.item)
          ? generateResourceSnippet(r.item, q)
          : generateTaskSnippet(r.item, q);
        return { item: r.item, type: r.type, snippet, score: r.score };
      });
      selectedIndex.value = 0;
    } catch {
      results.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    queryText.value = value;
    if (debounceTimer) clearTimeout(debounceTimer);

    if (value.length < 2) {
      results.value = [];
      selectedIndex.value = 0;
      return;
    }

    debounceTimer = setTimeout(() => doSearch(), 300);
  }

  function setTypeFilter(type: TypeFilter) {
    typeFilter.value = type;
    if (hasQuery.value) doSearch();
  }

  function setSortMode(sort: SortMode) {
    sortMode.value = sort;
    if (hasQuery.value) doSearch();
  }

  function setActiveTab(tab: DefaultTab) {
    activeTab.value = tab;
    selectedIndex.value = 0;
  }

  function selectItem(id: string, type: 'task' | 'epic' | 'resource') {
    if (type === 'resource') {
      document.dispatchEvent(new CustomEvent('resource-open', { detail: { uri: id } }));
    } else {
      app.selectTask(id);
    }
    close();
  }

  function selectResult(index: number) {
    const r = results.value[index];
    if (!r) return;

    if (r.type === 'resource') {
      const resource = r.item as Resource;
      recentSearchesService.add({ id: resource.id, title: resource.title, type: 'resource' });
      selectItem(resource.id, 'resource');
    } else {
      const task = r.item as Task;
      const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
      recentSearchesService.add({ id: task.id, title: task.title, type: type as 'task' | 'epic' });
      selectItem(task.id, type as 'task' | 'epic');
    }
  }

  function selectTabItemByIndex(index: number) {
    if (activeTab.value === 'searches') {
      const items = recentSearches.value;
      if (index < 0 || index >= items.length) return;
      const item = items[index];
      selectItem(item.id, item.type);
    } else {
      const items = recentActivity.value;
      if (index < 0 || index >= items.length) return;
      const result = items[index];
      if (result.type === 'resource') {
        const resource = result.item as Resource;
        selectItem(resource.id, 'resource');
      } else {
        const task = result.item as Task;
        const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
        selectItem(task.id, type as 'task' | 'epic');
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'Tab':
        if (!hasQuery.value) {
          e.preventDefault();
          setActiveTab(activeTab.value === 'searches' ? 'activity' : 'searches');
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (hasQuery.value && results.value.length > 0) {
          selectResult(selectedIndex.value);
        } else if (!hasQuery.value) {
          selectTabItemByIndex(selectedIndex.value);
        }
        break;
    }
  }

  function moveSelection(delta: number) {
    if (hasQuery.value) {
      const len = results.value.length;
      if (len === 0) return;
      selectedIndex.value = (selectedIndex.value + delta + len) % len;
    } else {
      const items = activeTab.value === 'searches'
        ? recentSearches.value
        : recentActivity.value;
      if (items.length === 0) return;
      selectedIndex.value = (selectedIndex.value + delta + items.length) % items.length;
    }
  }

  // ── Reset state when opening ──────────────────────────────────────
  effect(() => {
    if (app.isSpotlightOpen.value) {
      queryText.value = '';
      results.value = [];
      selectedIndex.value = 0;
      activeTab.value = 'searches';
      recentSearches.value = recentSearchesService.getAll();

      // Focus input after DOM update
      queueMicrotask(() => {
        const input = host.querySelector('.spotlight-input') as HTMLInputElement;
        if (input) {
          input.value = '';
          input.focus();
        }
      });
    }
  });

  // ── Keyboard: global Escape handler ───────────────────────────────
  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (app.isSpotlightOpen.value && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  // ── Scroll selected into view ─────────────────────────────────────
  effect(() => {
    const _idx = selectedIndex.value; // track
    queueMicrotask(() => {
      const selected = host.querySelector('.spotlight-result.selected, .spotlight-tab-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    });
  });

  // ── Template helpers ──────────────────────────────────────────────

  // Search results list (rendered when hasQuery)
  const searchResultsList = each(
    results,
    (r) => isResource(r.item) ? (r.item as Resource).id : (r.item as Task).id,
    (result, index) => {
      const r = computed(() => result.value);
      const isSelected = computed(() => index.value === selectedIndex.value);
      const itemClass = computed(() => `spotlight-result ${isSelected.value ? 'selected' : ''}`);

      const handleClick = () => selectResult(index.value);

      // GAP:INNERHTML_BINDING — highlighted title and snippet need innerHTML.
      // We render empty placeholders and fill them imperatively.
      const content = computed(() => {
        const rv = r.value;
        if (rv.type === 'resource') {
          const resource = rv.item as Resource;
          const matchInfo = formatMatchedFields(rv.snippet.matchedFields);
          return html`
            <div class="${itemClass}" @click="${handleClick}">
              <div class="spotlight-result-header">
                <span class="spotlight-resource-icon">📄</span>
                <span class="spotlight-result-title"></span>
                <span class="type-badge type-resource">resource</span>
              </div>
              <div class="spotlight-result-snippet">
                <span class="snippet-text"></span>
              </div>
              <div class="spotlight-result-meta">
                <span class="spotlight-result-path">${escapeHtml(resource.path)}</span>
                ${matchInfo ? html`<span class="spotlight-result-field">${matchInfo}</span>` : null}
              </div>
            </div>
          `;
        }
        // Task or Epic
        const task = rv.item as Task;
        const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
        const status = task.status || 'open';
        const matchInfo = formatMatchedFields(rv.snippet.matchedFields);

        return html`
          <div class="${itemClass}" @click="${handleClick}">
            <div class="spotlight-result-header">
              ${TaskBadge({ taskId: computed(() => task.id) })}
              <span class="spotlight-result-title"></span>
              <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
            </div>
            <div class="spotlight-result-snippet">
              <span class="snippet-text"></span>
            </div>
            <div class="spotlight-result-meta">
              ${matchInfo ? html`<span class="spotlight-result-field">${matchInfo}</span>` : null}
            </div>
          </div>
        `;
      });

      // Fill highlighted HTML imperatively after each render
      effect(() => {
        const rv = r.value;
        const q = queryText.value;
        if (!q || q.length < 2) return;

        queueMicrotask(() => {
          const items = host.querySelectorAll('.spotlight-results .spotlight-result');
          const el = items[index.value];
          if (!el) return;

          const titleEl = el.querySelector('.spotlight-result-title');
          if (titleEl) {
            if (rv.type === 'resource') {
              titleEl.innerHTML = highlighter.highlight((rv.item as Resource).title, q).HTML;
            } else {
              titleEl.innerHTML = highlighter.highlight((rv.item as Task).title, q).HTML;
            }
          }

          const snippetEl = el.querySelector('.snippet-text');
          if (snippetEl) {
            snippetEl.innerHTML = rv.snippet.html;
          }
        });
      });

      return html`${content}`;
    },
  );

  // Recent searches tab items
  const recentSearchItems = each(
    recentSearches,
    (item) => item.id,
    (item, index) => {
      const isSelected = computed(() => index.value === selectedIndex.value);
      const itemClass = computed(() => `spotlight-tab-item ${isSelected.value ? 'selected' : ''}`);
      const itemType = computed(() => item.value.type);
      const itemTitle = computed(() => escapeHtml(item.value.title));
      const itemId = computed(() => item.value.id);

      const handleClick = () => {
        const i = item.value;
        selectItem(i.id, i.type);
      };

      const content = computed(() => {
        if (itemType.value === 'resource') {
          return html`
            <div class="${itemClass}" @click="${handleClick}">
              <span class="spotlight-resource-icon">📄</span>
              <span class="spotlight-tab-item-title"></span>
              <span class="type-badge type-${itemType}">${itemType}</span>
            </div>
          `;
        }
        return html`
          <div class="${itemClass}" @click="${handleClick}">
            ${TaskBadge({ taskId: itemId })}
            <span class="spotlight-tab-item-title"></span>
            <span class="type-badge type-${itemType}">${itemType}</span>
          </div>
        `;
      });

      // Set title text
      effect(() => {
        const title = itemTitle.value;
        queueMicrotask(() => {
          const items = host.querySelectorAll('.spotlight-tabs-content .spotlight-tab-item');
          const el = items[index.value];
          const titleEl = el?.querySelector('.spotlight-tab-item-title');
          if (titleEl) titleEl.innerHTML = title;
        });
      });

      return html`${content}`;
    },
  );

  // Recent activity tab items
  const recentActivityItems = each(
    recentActivity,
    (r) => (r.item as Task).id,
    (result, index) => {
      const isSelected = computed(() => index.value === selectedIndex.value);
      const itemClass = computed(() => `spotlight-tab-item ${isSelected.value ? 'selected' : ''}`);
      const task = computed(() => result.value.item as Task);
      const taskId = computed(() => task.value.id);
      const taskTitle = computed(() => escapeHtml(task.value.title));
      const status = computed(() => task.value.status || 'open');
      const statusClass = computed(() => `status-badge status-${status.value}`);
      const statusLabel = computed(() => status.value.replace('_', ' '));

      const handleClick = () => {
        const t = task.value;
        const type = t.type || (t.id.startsWith('EPIC-') ? 'epic' : 'task');
        selectItem(t.id, type as 'task' | 'epic');
      };

      // Set title text
      effect(() => {
        const title = taskTitle.value;
        queueMicrotask(() => {
          const items = host.querySelectorAll('.spotlight-tabs-content .spotlight-tab-item');
          const el = items[index.value];
          const titleEl = el?.querySelector('.spotlight-tab-item-title');
          if (titleEl) titleEl.innerHTML = title;
        });
      });

      return html`
        <div class="${itemClass}" @click="${handleClick}">
          ${TaskBadge({ taskId })}
          <span class="spotlight-tab-item-title"></span>
          <span class="${statusClass}">${statusLabel}</span>
        </div>
      `;
    },
  );

  // ── Default tabs view (searches / activity) ───────────────────────
  const searchesEmpty = html`<div class="spotlight-tab-empty">No recent searches</div>`;
  const activityLoading = html`<div class="spotlight-tab-loading"><span class="spotlight-spinner"></span></div>`;
  const activityEmpty = html`<div class="spotlight-tab-empty">No recent activity</div>`;

  const tabContent = computed(() => {
    if (activeTab.value === 'searches') {
      if (recentSearches.value.length === 0) return searchesEmpty;
      return html`${recentSearchItems}`;
    }
    // activity tab
    if (activityQuery.loading.value && !activityQuery.data.value) return activityLoading;
    if (recentActivity.value.length === 0) return activityEmpty;
    return html`${recentActivityItems}`;
  });

  const searchesTabActive = computed(() => activeTab.value === 'searches');
  const activityTabActive = computed(() => activeTab.value === 'activity');

  const defaultTabsView = html`
    <div class="spotlight-tabs-header">
      <button class="spotlight-tab-btn" class:active="${searchesTabActive}"
        @click="${() => setActiveTab('searches')}">Recent Searches</button>
      <button class="spotlight-tab-btn" class:active="${activityTabActive}"
        @click="${() => setActiveTab('activity')}">Recent Activity</button>
    </div>
    <div class="spotlight-tabs-content">
      ${tabContent}
    </div>
  `;

  // ── Controls bar (filters + sort) ─────────────────────────────────
  const isFilterAll = computed(() => typeFilter.value === 'all');
  const isFilterTask = computed(() => typeFilter.value === 'task');
  const isFilterEpic = computed(() => typeFilter.value === 'epic');
  const isFilterResource = computed(() => typeFilter.value === 'resource');
  const isSortRelevant = computed(() => sortMode.value === 'relevant');
  const isSortRecent = computed(() => sortMode.value === 'recent');

  // ── Main search results or empty state ────────────────────────────
  const searchResultsView = computed(() => {
    if (results.value.length === 0 && hasQuery.value) {
      return html`<div class="spotlight-empty">No results for "${escapeHtml(queryText.value)}"</div>`;
    }
    return html`${searchResultsList}`;
  });

  // ── Template ──────────────────────────────────────────────────────
  return html`
    <div class="spotlight-overlay" style="${computed(() => `display:${overlayDisplay.value}`)}"
      @click="${handleOverlayClick}">
      <div class="spotlight-modal">
        <div class="spotlight-input-wrapper">
          <svg class="spotlight-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>
          <input type="text" class="spotlight-input"
            placeholder="Search tasks, epics, and resources..."
            autocomplete="off"
            @input="${handleInput}"
            @keydown="${handleKeydown}" />
          <span class="spotlight-hint">esc to close</span>
        </div>

        <div class="spotlight-controls" style="${computed(() => hasQuery.value ? 'display:flex' : 'display:none')}">
          <div class="spotlight-type-filters">
            <button class="spotlight-filter-btn" class:active="${isFilterAll}" @click="${() => setTypeFilter('all')}">All</button>
            <button class="spotlight-filter-btn" class:active="${isFilterTask}" @click="${() => setTypeFilter('task')}">Tasks</button>
            <button class="spotlight-filter-btn" class:active="${isFilterEpic}" @click="${() => setTypeFilter('epic')}">Epics</button>
            <button class="spotlight-filter-btn" class:active="${isFilterResource}" @click="${() => setTypeFilter('resource')}">Resources</button>
          </div>
          <div class="spotlight-sort-controls">
            <button class="spotlight-sort-btn" class:active="${isSortRelevant}" @click="${() => setSortMode('relevant')}">Relevant</button>
            <button class="spotlight-sort-btn" class:active="${isSortRecent}" @click="${() => setSortMode('recent')}">Recent</button>
          </div>
        </div>

        <div class="spotlight-status" style="${computed(() => hasQuery.value ? 'display:flex' : 'display:none')}">
          <span class="spotlight-result-count">${resultCountText}</span>
          <span class="spotlight-loading-indicator">
            ${when(isLoading, html`<span class="spotlight-spinner"></span>`)}
          </span>
        </div>

        <div class="spotlight-default-tabs" style="${computed(() => hasQuery.value ? 'display:none' : 'display:block')}">
          ${defaultTabsView}
        </div>

        <div class="spotlight-results" style="${computed(() => hasQuery.value ? 'display:block' : 'display:none')}">
          ${searchResultsView}
        </div>
      </div>
    </div>
  `;
});
