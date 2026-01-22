import './components/md-block.js';
import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
import './components/task-badge.js';
import './components/resource-viewer.js';
import { urlState } from './utils/url-state.js';

let splitActive = false;

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
  
  // Restore resource from localStorage
  const savedResource = localStorage.getItem('openResource');
  if (savedResource) {
    openSplitPane(savedResource);
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
  openSplitPane(e.detail.path);
}) as EventListener);

document.addEventListener('resource-close', () => {
  localStorage.removeItem('openResource');
  closeSplitPane();
});

function openSplitPane(path: string) {
  const taskPane = document.getElementById('task-pane');
  if (!taskPane) return;
  
  // Check if split pane viewer already exists
  let viewer = taskPane.querySelector('resource-viewer.split-pane-viewer') as any;
  
  if (viewer) {
    // Reload existing viewer
    viewer.loadResource(path);
  } else {
    // Create new split pane viewer
    taskPane.classList.add('split-active');
    viewer = document.createElement('resource-viewer');
    viewer.classList.add('split-pane-viewer');
    taskPane.appendChild(viewer);
    viewer.loadResource(path);
    splitActive = true;
  }
}

function closeSplitPane() {
  const taskPane = document.getElementById('task-pane');
  const viewer = taskPane?.querySelector('resource-viewer.split-pane-viewer');
  
  if (viewer) {
    viewer.remove();
  }
  
  taskPane?.classList.remove('split-active');
  splitActive = false;
}
