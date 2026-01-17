export class TaskFilterBar extends HTMLElement {
  private currentFilter = 'active';
  
  connectedCallback() {
    this.render();
    this.attachListeners();
  }
  
  render() {
    this.innerHTML = `
      <div class="filter-bar">
        <button class="filter-btn ${this.currentFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>
        <button class="filter-btn ${this.currentFilter === 'completed' ? 'active' : ''}" data-filter="completed">Completed</button>
        <button class="filter-btn ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
    `;
  }
  
  attachListeners() {
    this.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const filter = target.dataset.filter;
        if (!filter) return;
        
        this.setFilter(filter);
      });
    });
  }
  
  setFilter(filter: string) {
    this.currentFilter = filter;
    this.querySelectorAll('.filter-btn').forEach(btn => {
      const btnElement = btn as HTMLElement;
      btn.classList.toggle('active', btnElement.dataset.filter === filter);
    });
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter } }));
  }
}

customElements.define('task-filter-bar', TaskFilterBar);
