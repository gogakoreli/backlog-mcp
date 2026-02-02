import { Highlight } from '@orama/highlight';
import type { Task } from '../utils/api.js';
import { API_URL } from '../utils/api.js';
import { urlState } from '../utils/url-state.js';

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

  private handleInput(value: string) {
    this.query = value.trim();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    
    if (this.query.length < 2) {
      this.results = [];
      this.renderResults();
      this.updateResultCount();
      return;
    }

    this.debounceTimer = setTimeout(() => this.search(), 300);
  }

  private async search() {
    this.isLoading = true;
    this.updateLoadingState();

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
            <task-badge task-id="${task.id}" type="${type}"></task-badge>
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
      case 'Enter':
        e.preventDefault();
        if (this.results.length > 0) {
          this.selectResult(this.selectedIndex);
        }
        break;
    }
  }

  private moveSelection(delta: number) {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;
    this.renderResults();
    
    const selected = this.querySelector('.spotlight-result.selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  private selectResult(index: number) {
    const result = this.results[index];
    if (!result) return;
    
    if (result.type === 'resource') {
      const resource = result.item as Resource;
      urlState.set({ 
        resource: resource.id,
        task: null,
        epic: null
      });
    } else {
      const task = result.item as Task;
      urlState.set({ 
        task: task.id,
        epic: task.epic_id || null,
        resource: null
      });
    }
    this.close();
  }

  open() {
    this.isOpen = true;
    this.query = '';
    this.results = [];
    this.selectedIndex = 0;
    
    const overlay = this.querySelector('.spotlight-overlay') as HTMLElement;
    overlay.style.display = 'flex';
    
    const input = this.querySelector('.spotlight-input') as HTMLInputElement;
    input.value = '';
    input.focus();
    
    this.renderResults();
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
