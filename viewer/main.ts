import './styles.css';
import './github-markdown.css';
import 'diff2html/bundles/css/diff2html.min.css';
import './components/svg-icon.js';
import './components/md-block.js';
import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
import './components/task-badge.js';
import './components/resource-viewer.js';
import './components/system-info-modal.js';
import './components/copy-button.js';
import './components/spotlight-search.js';
import './components/activity-panel.js';
import './components/backlog-app.js';
import { splitPane } from './utils/split-pane.js';
import { backlogEvents } from './services/event-source-client.js';
import { inject } from './framework/injector.js';
import { AppState } from './services/app-state.js';

// Bootstrap AppState singleton (di-bootstrap-eager)
inject(AppState);

// Connect to SSE for real-time updates
backlogEvents.connect();

// ── Document-level events for unmigrated components ────────────────

document.addEventListener('resource-open', ((e: CustomEvent) => {
  if (e.detail.uri) {
    splitPane.openMcp(e.detail.uri);
  } else if (e.detail.path) {
    splitPane.open(e.detail.path);
  }
}) as EventListener);

document.addEventListener('resource-close', () => {
  splitPane.close();
});

document.addEventListener('activity-close', () => {
  splitPane.close();
});

document.addEventListener('activity-open', ((e: CustomEvent) => {
  splitPane.openActivity(e.detail?.taskId);
}) as EventListener);

document.addEventListener('activity-clear-filter', () => {
  splitPane.openActivity();
});

document.addEventListener('resource-loaded', ((e: CustomEvent) => {
  const { title, fileUri, mcpUri } = e.detail;
  if (fileUri && mcpUri) {
    splitPane.setHeaderWithUris(title, fileUri, mcpUri);
  } else if (fileUri) {
    splitPane.setHeaderTitle(title, fileUri);
  }
}) as EventListener);
