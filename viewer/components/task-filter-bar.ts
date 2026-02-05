const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const SORT_OPTIONS = [
  { key: 'updated', label: 'Updated' },
  { key: 'created_desc', label: 'Created (newest)' },
  { key: 'created_asc', label: 'Created (oldest)' },
];

const SORT_STORAGE_KEY = 'backlog:sort';

export class TaskFilterBar extends HTMLElement {
  private currentFilter = 'active';
  private currentSort = 'updated';

  connectedCallback() {
    // Restore sort from localStorage
    const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (savedSort && SORT_OPTIONS.some(o => o.key === savedSort)) {
      this.currentSort = savedSort;
    }
    this.render();
    this.attachListeners();
  }

  render() {
    const statusButtons = FILTERS.map(f => 
      `<button class="filter-btn ${this.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('');
    
    const sortOptions = SORT_OPTIONS.map(s =>
      `<option value="${s.key}" ${this.currentSort === s.key ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    
    this.innerHTML = `
      <div class="filter-bar">
        ${statusButtons}
        <div class="filter-sort">
          <label class="filter-sort-label">Sort:</label>
          <select class="filter-sort-select">${sortOptions}</select>
        </div>
      </div>
    `;
  }

  attachListeners() {
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = (e.target as HTMLElement).dataset.filter;
        if (filter) this.setFilter(filter);
      });
    });
    
    this.querySelector('.filter-sort-select')?.addEventListener('change', (e) => {
      const sort = (e.target as HTMLSelectElement).value;
      this.setSort(sort);
    });
  }

  setFilter(filter: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter, type: 'all', sort: this.currentSort } }));
  }

  setSort(sort: string) {
    this.currentSort = sort;
    localStorage.setItem(SORT_STORAGE_KEY, sort);
    document.dispatchEvent(new CustomEvent('sort-change', { detail: { sort } }));
  }

  setState(filter: string, _type: string, _query: string | null) {
    this.currentFilter = filter;
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === filter);
    });
  }
  
  getSort(): string {
    return this.currentSort;
  }
}

customElements.define('task-filter-bar', TaskFilterBar);
