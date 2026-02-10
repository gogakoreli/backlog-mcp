import { Highlight } from '@orama/highlight';
import type { Task } from '../utils/api.js';
import { API_URL } from '../utils/api.js';
import { inject } from '../framework/injector.js';
import { AppState } from '../services/app-state.js';
import { recentSearchesService, type RecentSearchItem } from '../services/recent-searches-service.js';

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

class SpotlightSearch extends HTMLElement {
  private isOpen = false;
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private query = '';
  private sortMode: SortMode = 'relevant';
  private typeFilter: TypeFilter = 'all';
  private isLoading = false;
  private activeTab: DefaultTab = 'searches';
  private recentActivity: SearchResult[] = [];
  private isLoadingActivity = false;

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  private render() {
    this.innerHTML = `
      <div class="spotlight-overlay">
        <div class="spotlight-modal">
          <div class="spotlight-input-wrapper">
            <svg class="spotlight-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
            <input type="text" class="spotlight-input" placeholder="Search tasks, epics, and resources..." autocomplete="off" />
            <span class="spotlight-hint">esc to close</span>
          </div>
          <div class="spotlight-controls">
            <div class="spotlight-type-filters">
              <button class="spotlight-filter-btn active" data-type="all">All</button>
              <button class="spotlight-filter-btn" data-type="task">Tasks</button>
              <button class="spotlight-filter-btn" data-type="epic">Epics</button>
              <button class="spotlight-filter-btn" data-type="resource">Resources</button>
            </div>
            <div class="spotlight-sort-controls">
              <button class="spotlight-sort-btn ${this.sortMode === 'relevant' ? 'active' : ''}" data-sort="relevant">Relevant</button>
              <button class="spotlight-sort-btn ${this.sortMode === 'recent' ? 'active' : ''}" data-sort="recent">Recent</button>
            </div>
          </div>
          <div class="spotlight-status">
            <span class="spotlight-result-count"></span>
            <span class="spotlight-loading-indicator"></span>
          </div>
          <div class="spotlight-default-tabs"></div>
          <div class="spotlight-results"></div>
        </div>
      </div>
    `;
  }

  private attachEventListeners() {
    const overlay = this.querySelector('.spotlight-overlay') as HTMLElement;
    const input = this.querySelector('.spotlight-input') as HTMLInputElement;

    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    input?.addEventListener('input', () => this.handleInput(input.value));
    input?.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Type filter buttons
    this.querySelectorAll('.spotlight-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = (e.target as HTMLElement).dataset.type as TypeFilter;
        if (type) this.setTypeFilter(type);
      });
    });

    // Sort buttons
    this.querySelectorAll('.spotlight-sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sort = (e.target as HTMLElement).dataset.sort as SortMode;
        if (sort) this.setSortMode(sort);
      });
    });

    this.attachTabListeners();
  }

  // Separate method for tab-related listeners that get re-rendered
  private attachTabListeners() {
    // Tab buttons
    this.querySelectorAll('.spotlight-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).dataset.tab as DefaultTab;
        if (tab) this.setActiveTab(tab);
      });
    });

    // Tab item clicks
    this.querySelectorAll('.spotlight-tab-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = (item as HTMLElement).dataset.id;
        const type = (item as HTMLElement).dataset.type as 'task' | 'epic' | 'resource';
        if (id && type) this.selectTabItem(id, type);
      });
    });
  }

  private setTypeFilter(type: TypeFilter) {
    this.typeFilter = type;
    this.querySelectorAll('.spotlight-filter-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.type === type);
    });
    if (this.query.length >= 2) this.search();
  }

  private setSortMode(sort: SortMode) {
    this.sortMode = sort;
    this.querySelectorAll('.spotlight-sort-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.sort === sort);
    });
    if (this.query.length >= 2) this.search();
  }

  private setActiveTab(tab: DefaultTab) {
    this.activeTab = tab;
    this.selectedIndex = 0;
    this.renderDefaultTabs();
    this.attachTabListeners();
  }

  private selectTabItem(id: string, type: 'task' | 'epic' | 'resource') {
    const app = inject(AppState);
    if (type === 'resource') {
      document.dispatchEvent(new CustomEvent('resource-open', { detail: { uri: id } }));
    } else {
      app.selectTask(id);
    }
    this.close();
  }

  private async loadRecentActivity() {
    if (this.isLoadingActivity) return;
    this.isLoadingActivity = true;

    try {
      // Fetch recent tasks/epics sorted by updated_at
      const response = await fetch(`${API_URL}/tasks?filter=all&limit=15`);
      const tasks: Task[] = await response.json();
      
      // Sort by updated_at descending and convert to SearchResult format
      const sorted = tasks.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      this.recentActivity = sorted.slice(0, 15).map(task => ({
        item: task,
        type: (task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task')) as 'task' | 'epic',
        snippet: { field: '', html: '', matchedFields: [] },
        score: 0,
      }));
    } catch {
      this.recentActivity = [];
    } finally {
      this.isLoadingActivity = false;
      if (this.query.length < 2) {
        this.renderDefaultTabs();
        this.attachTabListeners();
      }
    }
  }

  private renderDefaultTabs() {
    const tabsEl = this.querySelector('.spotlight-default-tabs') as HTMLElement;
    const resultsEl = this.querySelector('.spotlight-results') as HTMLElement;
    const controlsEl = this.querySelector('.spotlight-controls') as HTMLElement;
    const statusEl = this.querySelector('.spotlight-status') as HTMLElement;

    if (this.query.length >= 2) {
      // Hide tabs, show search UI
      tabsEl.style.display = 'none';
      resultsEl.style.display = 'block';
      controlsEl.style.display = 'flex';
      statusEl.style.display = 'flex';
      return;
    }

    // Show tabs, hide search UI
    tabsEl.style.display = 'block';
    resultsEl.style.display = 'none';
    controlsEl.style.display = 'none';
    statusEl.style.display = 'none';

    const recentSearches = recentSearchesService.getAll();
    
    tabsEl.innerHTML = `
      <div class="spotlight-tabs-header">
        <button class="spotlight-tab-btn ${this.activeTab === 'searches' ? 'active' : ''}" data-tab="searches">Recent Searches</button>
        <button class="spotlight-tab-btn ${this.activeTab === 'activity' ? 'active' : ''}" data-tab="activity">Recent Activity</button>
      </div>
      <div class="spotlight-tabs-content">
        ${this.activeTab === 'searches' ? this.renderRecentSearches(recentSearches) : this.renderRecentActivity()}
      </div>
    `;
  }

  private renderRecentSearches(items: RecentSearchItem[]): string {
    if (items.length === 0) {
      return '<div class="spotlight-tab-empty">No recent searches</div>';
    }

    return items.map((item, i) => `
      <div class="spotlight-tab-item ${i === this.selectedIndex ? 'selected' : ''}" data-id="${item.id}" data-type="${item.type}" data-index="${i}">
        ${item.type === 'resource' 
          ? `<span class="spotlight-resource-icon">📄</span><span class="spotlight-tab-item-title">${this.escapeHtml(item.title)}</span>`
          : `<task-badge task-id="${item.id}"></task-badge><span class="spotlight-tab-item-title">${this.escapeHtml(item.title)}</span>`
        }
        <span class="type-badge type-${item.type}">${item.type}</span>
      </div>
    `).join('');
  }

  private renderRecentActivity(): string {
    if (this.isLoadingActivity) {
      return '<div class="spotlight-tab-loading"><span class="spotlight-spinner"></span></div>';
    }

    if (this.recentActivity.length === 0) {
      return '<div class="spotlight-tab-empty">No recent activity</div>';
    }

    return this.recentActivity.map((r, i) => {
      const task = r.item as Task;
      const type = r.type;
      return `
        <div class="spotlight-tab-item ${i === this.selectedIndex ? 'selected' : ''}" data-id="${task.id}" data-type="${type}" data-index="${i}">
          <task-badge task-id="${task.id}"></task-badge>
          <span class="spotlight-tab-item-title">${this.escapeHtml(task.title)}</span>
          <span class="status-badge status-${task.status}">${task.status.replace('_', ' ')}</span>
        </div>
      `;
    }).join('');
  }

  private handleInput(value: string) {
    this.query = value.trim();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    
    if (this.query.length < 2) {
      this.results = [];
      this.selectedIndex = 0;
      this.renderDefaultTabs();
      this.attachEventListeners();
      this.updateResultCount();
      return;
    }

    this.debounceTimer = setTimeout(() => this.search(), 300);
  }

  private async search() {
    this.isLoading = true;
    this.updateLoadingState();
    this.renderDefaultTabs(); // Hide tabs, show search UI

    try {
      // Build query params
      const params = new URLSearchParams({
        q: this.query,
        limit: '20',
        sort: this.sortMode,
      });
      if (this.typeFilter !== 'all') {
        params.set('types', this.typeFilter);
      }

      const response = await fetch(`${API_URL}/search?${params}`);
      const apiResults: UnifiedSearchResult[] = await response.json();
      
      this.results = apiResults.map(r => {
        const snippet = isResource(r.item) 
          ? this.generateResourceSnippet(r.item, this.query)
          : this.generateTaskSnippet(r.item, this.query);
        return {
          item: r.item,
          type: r.type,
          snippet,
          score: r.score,
        };
      });
      
      this.selectedIndex = 0;
      this.renderResults();
      this.updateResultCount();
    } catch {
      const resultsEl = this.querySelector('.spotlight-results') as HTMLElement;
      resultsEl.innerHTML = '<div class="spotlight-empty">Search failed</div>';
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
    }
  }

  private updateLoadingState() {
    const indicator = this.querySelector('.spotlight-loading-indicator') as HTMLElement;
    if (indicator) {
      indicator.innerHTML = this.isLoading 
        ? '<span class="spotlight-spinner"></span>' 
        : '';
    }
  }

  private updateResultCount() {
    const countEl = this.querySelector('.spotlight-result-count') as HTMLElement;
    if (countEl) {
      if (this.query.length < 2) {
        countEl.textContent = '';
      } else if (this.results.length === 0) {
        countEl.textContent = 'No results';
      } else {
        countEl.textContent = `${this.results.length} result${this.results.length === 1 ? '' : 's'}`;
      }
    }
  }

  private generateTaskSnippet(task: Task, query: string): { field: string; html: string; matchedFields: string[] } {
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
    
    // Find all matching fields
    for (const { name, value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      if (result.positions.length > 0) {
        matchedFields.push(name);
        if (!firstMatchField) {
          firstMatchField = name;
          firstMatchHtml = result.trim(100);
        }
      }
    }

    // Fallback: show title
    if (!firstMatchField) {
      return { field: 'title', html: this.escapeHtml(task.title), matchedFields: [] };
    }

    return { field: firstMatchField, html: firstMatchHtml, matchedFields };
  }

  private generateResourceSnippet(resource: Resource, query: string): { field: string; html: string; matchedFields: string[] } {
    const fields: { name: string; value: string }[] = [
      { name: 'title', value: resource.title },
      { name: 'content', value: resource.content },
    ];

    const matchedFields: string[] = [];
    let firstMatchField = '';
    let firstMatchHtml = '';

    for (const { name, value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      if (result.positions.length > 0) {
        matchedFields.push(name);
        if (!firstMatchField) {
          firstMatchField = name;
          firstMatchHtml = result.trim(100);
        }
      }
    }

    if (!firstMatchField) {
      return { field: 'title', html: this.escapeHtml(resource.title), matchedFields: [] };
    }

    return { field: firstMatchField, html: firstMatchHtml, matchedFields };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private formatMatchedFields(fields: string[]): string {
    if (fields.length === 0) return '';
    return `Matched in: ${fields.join(', ')}`;
  }

  private renderResults() {
    const resultsEl = this.querySelector('.spotlight-results') as HTMLElement;
    
    if (this.results.length === 0) {
      if (this.query.length >= 2) {
        resultsEl.innerHTML = `<div class="spotlight-empty">No results for "${this.escapeHtml(this.query)}"</div>`;
      } else {
        resultsEl.innerHTML = '';
      }
      return;
    }

    resultsEl.innerHTML = this.results.map((r, i) => {
      const matchInfo = this.formatMatchedFields(r.snippet.matchedFields);
      
      if (r.type === 'resource') {
        const resource = r.item as Resource;
        return `
          <div class="spotlight-result ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}">
            <div class="spotlight-result-header">
              <span class="spotlight-resource-icon">📄</span>
              <span class="spotlight-result-title">${highlighter.highlight(resource.title, this.query).HTML}</span>
              <span class="type-badge type-resource">resource</span>
            </div>
            <div class="spotlight-result-snippet">
              <span class="snippet-text">${r.snippet.html}</span>
            </div>
            <div class="spotlight-result-meta">
              <span class="spotlight-result-path">${this.escapeHtml(resource.path)}</span>
              ${matchInfo ? `<span class="spotlight-result-field">${matchInfo}</span>` : ''}
            </div>
          </div>
        `;
      }
      
      // Task or Epic
      const task = r.item as Task;
      const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
      const status = task.status || 'open';
      
      return `
        <div class="spotlight-result ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}">
          <div class="spotlight-result-header">
            <task-badge task-id="${task.id}"></task-badge>
            <span class="spotlight-result-title">${highlighter.highlight(task.title, this.query).HTML}</span>
            <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
          </div>
          <div class="spotlight-result-snippet">
            <span class="snippet-text">${r.snippet.html}</span>
          </div>
          <div class="spotlight-result-meta">
            ${matchInfo ? `<span class="spotlight-result-field">${matchInfo}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    resultsEl.querySelectorAll('.spotlight-result').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.getAttribute('data-index') || '0');
        this.selectResult(index);
      });
    });
  }

  private handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveSelection(-1);
        break;
      case 'Tab':
        // Switch tabs when in default view
        if (this.query.length < 2) {
          e.preventDefault();
          this.setActiveTab(this.activeTab === 'searches' ? 'activity' : 'searches');
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (this.query.length >= 2 && this.results.length > 0) {
          this.selectResult(this.selectedIndex);
        } else if (this.query.length < 2) {
          this.selectTabItemByIndex(this.selectedIndex);
        }
        break;
    }
  }

  private selectTabItemByIndex(index: number) {
    const items = this.activeTab === 'searches' 
      ? recentSearchesService.getAll() 
      : this.recentActivity;
    
    if (index < 0 || index >= items.length) return;
    
    if (this.activeTab === 'searches') {
      const item = items[index] as RecentSearchItem;
      this.selectTabItem(item.id, item.type);
    } else {
      const result = items[index] as SearchResult;
      if (result.type === 'resource') {
        const resource = result.item as Resource;
        this.selectTabItem(resource.id, 'resource');
      } else {
        const task = result.item as Task;
        const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
        this.selectTabItem(task.id, type);
      }
    }
  }

  private moveSelection(delta: number) {
    if (this.query.length >= 2) {
      // Search results mode
      if (this.results.length === 0) return;
      this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;
      this.renderResults();
      const selected = this.querySelector('.spotlight-result.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    } else {
      // Tabs mode
      const items = this.activeTab === 'searches' 
        ? recentSearchesService.getAll() 
        : this.recentActivity;
      if (items.length === 0) return;
      this.selectedIndex = (this.selectedIndex + delta + items.length) % items.length;
      this.renderDefaultTabs();
      this.attachEventListeners();
      const selected = this.querySelector('.spotlight-tab-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectResult(index: number) {
    const result = this.results[index];
    if (!result) return;
    
    // Track this selection in recent searches
    if (result.type === 'resource') {
      const resource = result.item as Resource;
      recentSearchesService.add({ id: resource.id, title: resource.title, type: 'resource' });
      document.dispatchEvent(new CustomEvent('resource-open', { 
        detail: { uri: resource.id } 
      }));
    } else {
      const task = result.item as Task;
      const type = task.type || (task.id.startsWith('EPIC-') ? 'epic' : 'task');
      recentSearchesService.add({ id: task.id, title: task.title, type });
      const app = inject(AppState);
      app.selectTask(task.id);
    }
    this.close();
  }

  open() {
    this.isOpen = true;
    this.query = '';
    this.results = [];
    this.selectedIndex = 0;
    this.activeTab = 'searches'; // Reset to default tab
    
    const overlay = this.querySelector('.spotlight-overlay') as HTMLElement;
    overlay.style.display = 'flex';
    
    const input = this.querySelector('.spotlight-input') as HTMLInputElement;
    input.value = '';
    input.focus();
    
    // Show tabs and load recent activity
    this.renderDefaultTabs();
    this.attachEventListeners();
    this.loadRecentActivity();
    this.updateResultCount();
  }

  close() {
    this.isOpen = false;
    const overlay = this.querySelector('.spotlight-overlay') as HTMLElement;
    overlay.style.display = 'none';
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}

customElements.define('spotlight-search', SpotlightSearch);
