import './styles.css';
import './github-markdown.css';
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
import { layoutService } from './utils/layout.js';

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
  resizeService.init();
  layoutService.init();
  splitPane.init();
  
  // Restore resource from localStorage
  const savedResource = localStorage.getItem('openResource');
  if (savedResource) {
    if (savedResource.startsWith('mcp://')) {
      splitPane.openMcp(savedResource);
    } else {
      splitPane.open(savedResource);
    }
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
  if (e.detail.uri) {
    // MCP URI
    localStorage.setItem('openResource', e.detail.uri);
    splitPane.openMcp(e.detail.uri);
  } else if (e.detail.path) {
    // File path
    localStorage.setItem('openResource', e.detail.path);
    splitPane.open(e.detail.path);
  }
}) as EventListener);

document.addEventListener('resource-close', () => {
  localStorage.removeItem('openResource');
  splitPane.close();
});

document.addEventListener('resource-loaded', ((e: CustomEvent) => {
  const { title, fileUri, mcpUri } = e.detail;
  if (fileUri && mcpUri) {
    splitPane.setHeaderWithUris(title, fileUri, mcpUri);
  } else if (fileUri) {
    splitPane.setHeaderTitle(title, fileUri);
  }
}) as EventListener);
