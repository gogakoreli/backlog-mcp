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

  connectedCallback() {
    this.render();
    this.attachListeners();
  }

  render() {
    const statusButtons = FILTERS.map(f => 
      `<button class="filter-btn ${this.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('');
    const typeButtons = TYPE_FILTERS.map(f => 
      `<button class="filter-btn ${this.currentType === f.key ? 'active' : ''}" data-type="${f.key}">${f.label}</button>`
    ).join('');
    this.innerHTML = `
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
  }

  setFilter(filter: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter, type: this.currentType } }));
  }

  setType(type: string) {
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter: this.currentFilter, type } }));
  }

  setState(filter: string, type: string) {
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
