import './styles.css';
import './github-markdown.css';
import 'diff2html/bundles/css/diff2html.min.css';
import './components/svg-icon.js';
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
import { backlogEvents } from './services/event-source-client.js';
import { inject } from 'nisli';
import { AppState } from './services/app-state.js';
import { SplitPaneState } from './services/split-pane-state.js';

// Bootstrap singletons (di-bootstrap-eager)
inject(AppState);
inject(SplitPaneState);

// Connect to SSE for real-time updates
backlogEvents.connect();

// All document-level event bridges have been removed.
// Components inject AppState / SplitPaneState directly.
// md-block link interception uses event delegation on click.
// See ADR 0013.
