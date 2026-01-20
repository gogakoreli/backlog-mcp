import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
import './components/task-badge.js';
import { urlState } from './utils/url-state.js';

// Subscribe components to URL state changes - single source of truth
urlState.subscribe((state) => {
  const filterBar = document.querySelector('task-filter-bar') as any;
  filterBar?.setState?.(state.filter, state.type);
  
  const taskList = document.querySelector('task-list') as any;
  taskList?.setState?.(state.filter, state.type, state.epic, state.task);
  
  if (state.task) {
    const detail = document.querySelector('task-detail') as any;
    detail?.loadTask?.(state.task);
  }
});

// Initialize on load
document.addEventListener('DOMContentLoaded', () => urlState.init());

// Component events -> URL updates
document.addEventListener('filter-change', ((e: CustomEvent) => {
  urlState.set({ filter: e.detail.filter, type: e.detail.type });
}) as EventListener);

document.addEventListener('task-selected', ((e: CustomEvent) => {
  urlState.set({ task: e.detail.taskId });
}) as EventListener);

document.addEventListener('epic-pin', ((e: CustomEvent) => {
  urlState.set({ epic: e.detail.epicId });
}) as EventListener);
