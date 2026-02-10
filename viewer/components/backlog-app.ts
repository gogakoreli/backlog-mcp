/**
 * backlog-app.ts — Root component.
 *
 * Thin shell: mounts children, initializes layout services, and bridges
 * AppState to unmigrated components (task-detail) via effects.
 *
 * All state flows through AppState (ADR 0007 shared services).
 */
import { effect, batch, signal } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { settingsIcon, activityIcon } from '../icons/index.js';
import { SvgIcon } from './svg-icon.js';
import { splitPane } from '../utils/split-pane.js';
import { resizeService } from '../utils/resize.js';
import { layoutService } from '../utils/layout.js';
import { AppState } from '../services/app-state.js';

export const BacklogApp = component('backlog-app', (_props, host) => {
  const app = inject(AppState);
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const shortcut = isMac ? '⌘J' : 'Ctrl+J';

  // ── Actions ──────────────────────────────────────────────────────

  const activityIconEl = SvgIcon({ src: signal(activityIcon), size: signal('16px') });
  const settingsIconEl = SvgIcon({ src: signal(settingsIcon), size: signal('16px') });

  function handleHomeClick() {
    batch(() => {
      app.scopeId.value = null;
      app.selectedTaskId.value = null;
    });
  }

  function handleSpotlightClick() {
    const spotlight = host.querySelector('spotlight-search') as any;
    spotlight?.open();
  }

  function handleActivityClick() {
    splitPane.openActivity();
  }

  function handleSystemInfoClick() {
    const modal = host.querySelector('system-info-modal') as any;
    modal?.open();
  }

  // ── Bridge to unmigrated task-detail ─────────────────────────────
  effect(() => {
    const id = app.selectedTaskId.value;
    if (!id) return;
    // HACK:CROSS_QUERY — remove when task-detail is migrated to framework
    const detail = host.querySelector('task-detail') as any;
    detail?.loadTask?.(id);
  });

  // ── Initialize layout services (runs once after mount) ───────────
  queueMicrotask(() => {
    resizeService.init();
    layoutService.init();
    splitPane.init();

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        handleSpotlightClick();
      }
    });
  });

  // ── Template ─────────────────────────────────────────────────────
  return html`
    <div class="app-container" id="app-container">
      <system-info-modal></system-info-modal>
      <spotlight-search></spotlight-search>

      <div class="left-pane" id="left-pane">
        <div class="pane-header">
          <div class="pane-title home-button" style="cursor: pointer;" title="Go to All Tasks" @click="${handleHomeClick}">
            <img src="./logo.svg" class="logo" alt="">
            Backlog
          </div>
          <div class="header-actions">
            <button class="btn-outline spotlight-btn" title="Search" @click="${handleSpotlightClick}">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
              </svg>
              <kbd>${shortcut}</kbd>
            </button>
            <button class="btn-outline activity-btn" title="Recent Activity" @click="${handleActivityClick}">
              ${activityIconEl}
            </button>
            <button class="btn-outline system-info-btn" title="System Info" @click="${handleSystemInfoClick}">
              ${settingsIconEl}
            </button>
          </div>
        </div>
        <div class="pane-content">
          <task-filter-bar></task-filter-bar>
          <task-list></task-list>
        </div>
      </div>

      <div class="right-pane" id="right-pane">
        <div class="task-pane">
          <div class="pane-header" id="task-pane-header">
            <div class="pane-title">Task Detail</div>
          </div>
          <div class="pane-content">
            <task-detail></task-detail>
          </div>
        </div>
      </div>
    </div>
  `;
});
