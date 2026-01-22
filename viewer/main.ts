import './components/md-block.js';
import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
import './components/task-badge.js';
import './components/resource-viewer.js';
import { urlState } from './utils/url-state.js';
import { splitPane } from './utils/split-pane.js';
import { resizeService } from './utils/resize.js';

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
document.addEventListener('DOMContentLoaded', () => {
  urlState.init();
  splitPane.init();
  resizeService.init();
  
  // Add resize handle between left and right panes
  const appContainer = document.getElementById('app-container');
  const leftPane = document.getElementById('left-pane');
  if (appContainer && leftPane) {
    const handle = resizeService.createHandle(appContainer, leftPane, 'leftPaneWidth');
    handle.dataset.storageKey = 'leftPaneWidth';
    handle.classList.add('main-resize-handle');
    appContainer.insertBefore(handle, leftPane.nextSibling);
  }
  
  // Restore resource from localStorage
  const savedResource = localStorage.getItem('openResource');
  if (savedResource) {
    splitPane.open(savedResource);
  }
});

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

document.addEventListener('resource-open', ((e: CustomEvent) => {
  localStorage.setItem('openResource', e.detail.path);
  splitPane.open(e.detail.path);
}) as EventListener);

document.addEventListener('resource-close', () => {
  localStorage.removeItem('openResource');
  splitPane.close();
});
