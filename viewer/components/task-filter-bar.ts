const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export class TaskFilterBar extends HTMLElement {
  private currentFilter = 'active';

  connectedCallback() {
    this.render();
    this.attachListeners();
  }

  render() {
    const statusButtons = FILTERS.map(f => 
      `<button class="filter-btn ${this.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('');
    this.innerHTML = `<div class="filter-bar">${statusButtons}</div>`;
  }

  attachListeners() {
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = (e.target as HTMLElement).dataset.filter;
        if (filter) this.setFilter(filter);
      });
    });
  }

  setFilter(filter: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter, type: 'all' } }));
  }

  setState(filter: string, _type: string, _query: string | null) {
    this.currentFilter = filter;
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === filter);
    });
  }
}

customElements.define('task-filter-bar', TaskFilterBar);
