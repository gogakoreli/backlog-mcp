/**
 * backlog-app.ts — Migrated to the reactive framework (Phase 11)
 *
 * Root component. Owns URL state subscription, service initialization,
 * and layout. Delegates to child components via querySelector (children
 * are still a mix of framework and vanilla components).
 *
 * Uses: component, html template, @click handlers
 */
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { settingsIcon, activityIcon } from '../icons/index.js';
import { urlState } from '../utils/url-state.js';
import { sidebarScope } from '../utils/sidebar-scope.js';
import { splitPane } from '../utils/split-pane.js';
import { resizeService } from '../utils/resize.js';
import { layoutService } from '../utils/layout.js';
import { getTypeConfig, getTypeFromId } from '../type-registry.js';

export const BacklogApp = component('backlog-app', (_props, host) => {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const shortcut = isMac ? '⌘J' : 'Ctrl+J';

  // ── Actions ──────────────────────────────────────────────────────

  function handleHomeClick() {
    sidebarScope.set(null);
    urlState.set({ id: null });
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

  // ── Initialization (runs once after mount) ───────────────────────
  // Use queueMicrotask to run after the template is mounted into the DOM
  queueMicrotask(() => {
    // Subscribe BEFORE init so we get the initial state
    urlState.subscribe((state) => {
      const filterBar = host.querySelector('task-filter-bar') as any;
      filterBar?.setState?.(state.filter, state.type, state.q);

      const taskList = host.querySelector('task-list') as any;
      taskList?.setState?.(state.filter, state.type, state.id, state.q);

      if (state.id) {
        const type = getTypeFromId(state.id);
        const config = getTypeConfig(type);
        if (config.isContainer) {
          sidebarScope.set(state.id);
        }

        const detail = host.querySelector('task-detail') as any;
        detail?.loadTask?.(state.id);
      }
    });

    urlState.init();
    resizeService.init();
    layoutService.init();
    splitPane.init();

    // Global keyboard shortcut
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
              <svg-icon src="${activityIcon}" size="16px"></svg-icon>
            </button>
            <button class="btn-outline system-info-btn" title="System Info" @click="${handleSystemInfoClick}">
              <svg-icon src="${settingsIcon}" size="16px"></svg-icon>
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
