const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const TYPE_FILTERS = [
  { key: 'task', label: 'Tasks' },
  { key: 'epic', label: 'Epics' },
  { key: 'all', label: 'All' },
];

export class TaskFilterBar extends HTMLElement {
  private currentFilter = 'active';
  private currentType = 'all';
  private isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  connectedCallback() {
    this.render();
    this.attachListeners();
  }

  render() {
    const shortcut = this.isMac ? '⌘J' : 'Ctrl+J';
    const statusButtons = FILTERS.map(f => 
      `<button class="filter-btn ${this.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('');
    const typeButtons = TYPE_FILTERS.map(f => 
      `<button class="filter-btn ${this.currentType === f.key ? 'active' : ''}" data-type="${f.key}">${f.label}</button>`
    ).join('');
    this.innerHTML = `
      <button class="search-trigger" aria-label="Search tasks">
        <svg class="search-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
        <span class="search-label">Search</span>
        <kbd class="search-shortcut">${shortcut}</kbd>
      </button>
      <div class="filter-bar"><span class="filter-label">Status</span>${statusButtons}</div>
      <div class="filter-bar type-filter"><span class="filter-label">Type</span>${typeButtons}</div>
    `;
  }

  attachListeners() {
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = (e.target as HTMLElement).dataset.filter;
        if (filter) this.setFilter(filter);
      });
    });
    this.querySelectorAll('[data-type]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = (e.target as HTMLElement).dataset.type;
        if (type) this.setType(type);
      });
    });
    this.querySelector('.search-trigger')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('open-spotlight'));
    });
  }

  setFilter(filter: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter, type: this.currentType } }));
  }

  setType(type: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter: this.currentFilter, type } }));
  }

  setState(filter: string, type: string, _query: string | null) {
    this.currentFilter = filter;
    this.currentType = type;
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === filter);
    });
    this.querySelectorAll('[data-type]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.type === type);
    });
  }
}

customElements.define('task-filter-bar', TaskFilterBar);
