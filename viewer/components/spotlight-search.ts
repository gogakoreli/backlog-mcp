import { Highlight } from '@orama/highlight';
import type { Task } from '../utils/api.js';
import { API_URL } from '../utils/api.js';
import { urlState } from '../utils/url-state.js';

const highlighter = new Highlight({ CSSClass: 'spotlight-match' });

interface SearchResult {
  task: Task;
  snippet: { field: string; html: string };
}

class SpotlightSearch extends HTMLElement {
  private isOpen = false;
  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private query = '';

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
            <input type="text" class="spotlight-input" placeholder="Search tasks and epics..." autocomplete="off" />
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
      const response = await fetch(`${API_URL}/tasks?q=${encodeURIComponent(this.query)}&filter=all&limit=10`);
      const tasks: Task[] = await response.json();
      
      this.results = tasks.map(task => ({
        task,
        snippet: this.generateSnippet(task, this.query)
      }));
      this.selectedIndex = 0;
      this.renderResults();
    } catch {
      resultsEl.innerHTML = '<div class="spotlight-empty">Search failed</div>';
    }
  }

  private generateSnippet(task: Task, query: string): { field: string; html: string } {
    // Check fields in priority order (matches Orama boost order)
    const fields: { name: string; value: string }[] = [
      { name: 'title', value: task.title },
      { name: 'description', value: task.description || '' },
      { name: 'evidence', value: (task.evidence || []).join(' ') },
      { name: 'blocked_reason', value: (task.blocked_reason || []).join(' ') },
      { name: 'references', value: (task.references || []).map(r => `${r.title || ''} ${r.url}`).join(' ') },
    ];

    for (const { name, value } of fields) {
      if (!value) continue;
      const result = highlighter.highlight(value, query);
      if (result.positions.length > 0) {
        // Trim to ~100 chars around first match
        const trimmed = result.trim(50);
        return { field: name, html: trimmed };
      }
    }

    // Fallback: show title
    return { field: 'title', html: this.escapeHtml(task.title) };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

    resultsEl.innerHTML = this.results.map((r, i) => `
      <div class="spotlight-result ${i === this.selectedIndex ? 'selected' : ''}" data-index="${i}">
        <div class="spotlight-result-icon">${this.getTypeIcon(r.task)}</div>
        <div class="spotlight-result-content">
          <div class="spotlight-result-title">${highlighter.highlight(r.task.title, this.query).HTML}</div>
          <div class="spotlight-result-snippet">
            <span class="spotlight-result-field">${r.snippet.field}:</span> ${r.snippet.html}
          </div>
        </div>
        <task-badge status="${r.task.status}"></task-badge>
      </div>
    `).join('');

    // Attach click handlers
    resultsEl.querySelectorAll('.spotlight-result').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.getAttribute('data-index') || '0');
        this.selectResult(index);
      });
    });
  }

  private getTypeIcon(task: Task): string {
    const isEpic = task.type === 'epic' || task.id.startsWith('EPIC-');
    return isEpic 
      ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2h-11zM4 5.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5z"/></svg>';
  }

  private handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
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
    
    urlState.set({ task: result.task.id });
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
