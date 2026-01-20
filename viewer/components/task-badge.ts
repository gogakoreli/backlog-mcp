import { epicIcon, taskIcon } from '../icons/index.js';

export class TaskBadge extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['task-id', 'type'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const id = this.getAttribute('task-id') || '';
    const type = this.getAttribute('type') || 'task';
    const icon = type === 'epic' ? epicIcon : taskIcon;
    
    this.className = `task-badge type-${type}`;
    this.innerHTML = `<span class="task-badge-icon">${icon}</span><span class="task-badge-id">${id}</span>`;
  }
}

customElements.define('task-badge', TaskBadge);
