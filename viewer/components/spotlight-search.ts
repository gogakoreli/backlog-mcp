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
  snippet: { field: string; html: string; matchCount: number };
  score: number;
}

function isResource(item: Task | Resource): item is Resource {
  return 'path' in item && 'content' in item;
}

class SpotlightSearch extends HTMLElement {
  private isOpen = false;
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private query = '';
  private maxScore = 0;

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
  }

  private handleInput(value: string) {
    this.query = value.trim();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    
    if (this.query.length < 2) {
      this.results = [];
      this.renderResults();
      return;
    }

    this.debounceTimer = setTimeout(() => this.search(), 300);
  }

  private async search() {
    const resultsEl = this.querySelector('.spotlight-results') as HTMLElement;
    resultsEl.innerHTML = '<div class="spotlight-loading">Searching...</div>';

    try {
      const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(this.query)}&limit=10`);
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
      
      // Calculate max score for normalization
      this.maxScore = Math.max(...this.results.map(r => r.score), 1);
      
      this.selectedIndex = 0;
      this.renderResults();
    } catch {
      resultsEl.innerHTML = '<div class="spotlight-empty">Search failed</div>';
    }
  }

  private generateTaskSnippet(task: Task, query: string): { field: string; html: string; matchCount: number } {
    // Check fields in priority order (matches Orama boost order)
    const fields: { name: string; value: string }[] = [
      { name: 'title', value: task.title },
      { name: 'description', value: task.description || '' },
      { name: 'evidence', value: (task.evidence || []).join(' ') },
      { name: 'blocked_reason', value: (task.blocked_reason || []).join(' ') },
      { name: 'references', value: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' ') },
    ];

    let totalMatches = 0;
    
    // Count total matches across all fields
    for (const { value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      totalMatches += result.positions.length;
    }

    // Find first matching field for snippet
    for (const { name, value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      if (result.positions.length > 0) {
        // Get more context - ~200 chars for multi-line display
        const trimmed = result.trim(100);
        return { field: name, html: trimmed, matchCount: totalMatches };
      }
    }

    // Fallback: show title
    return { field: 'title', html: this.escapeHtml(task.title), matchCount: 0 };
  }

  private generateResourceSnippet(resource: Resource, query: string): { field: string; html: string; matchCount: number } {
    const fields: { name: string; value: string }[] = [
      { name: 'title', value: resource.title },
      { name: 'content', value: resource.content },
    ];

    let totalMatches = 0;
    
    for (const { value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      totalMatches += result.positions.length;
    }

    for (const { name, value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      if (result.positions.length > 0) {
        const trimmed = result.trim(100);
        return { field: name, html: trimmed, matchCount: totalMatches };
      }
    }

    return { field: 'title', html: this.escapeHtml(resource.title), matchCount: 0 };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getScorePercent(score: number): number {
    return Math.round((score / this.maxScore) * 100);
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
      const scorePercent = this.getScorePercent(r.score);
      const matchText = r.snippet.matchCount === 1 ? '1 match' : `${r.snippet.matchCount} matches`;
      
      if (r.type === 'resource') {
        const resource = r.item as Resource;
        return `
          <div class="spotlight-result ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}">
            <div class="spotlight-result-header">
              <span class="spotlight-resource-icon">📄</span>
              <span class="spotlight-result-title">${highlighter.highlight(resource.title, this.query).HTML}</span>
              <span class="type-badge type-resource">resource</span>
              <span class="spotlight-score-badge">${scorePercent}%</span>
            </div>
            <div class="spotlight-result-snippet">
              <span class="snippet-text">${r.snippet.html}</span>
            </div>
            <div class="spotlight-result-meta">
              <span class="spotlight-result-path">${this.escapeHtml(resource.path)}</span>
              <span class="spotlight-result-matches">${matchText}</span>
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
            <span class="spotlight-score-badge">${scorePercent}%</span>
          </div>
          <div class="spotlight-result-snippet">
            <span class="snippet-text">${r.snippet.html}</span>
          </div>
          <div class="spotlight-result-meta">
            <span class="spotlight-result-field">${r.snippet.field}</span>
            <span class="spotlight-result-matches">${matchText}</span>
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

  private escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // Prevent task-list's global Escape handler
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
    
    // Scroll selected into view
    const selected = this.querySelector('.spotlight-result.selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  private selectResult(index: number) {
    const result = this.results[index];
    if (!result) return;
    
    if (result.type === 'resource') {
      // Open resource in resource pane
      const resource = result.item as Resource;
      urlState.set({ 
        resource: resource.id,
        task: null,
        epic: null
      });
    } else {
      // Task or Epic - navigate to it
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
