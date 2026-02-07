import { settingsIcon, activityIcon } from '../icons/index.js';
import { urlState } from '../utils/url-state.js';
import { sidebarScope } from '../utils/sidebar-scope.js';
import { splitPane } from '../utils/split-pane.js';
import { resizeService } from '../utils/resize.js';
import { layoutService } from '../utils/layout.js';
import { getTypeConfig, getTypeFromId } from '../type-registry.js';

export class BacklogApp extends HTMLElement {
  private isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  connectedCallback() {
    this.render();
    this.init();
  }

  private render() {
    const shortcut = this.isMac ? '⌘J' : 'Ctrl+J';
    this.innerHTML = `
      <div class="app-container" id="app-container">
        <system-info-modal></system-info-modal>
        <spotlight-search></spotlight-search>

        <div class="left-pane" id="left-pane">
          <div class="pane-header">
            <div class="pane-title home-button" style="cursor: pointer;" title="Go to All Tasks">
              <img src="./logo.svg" class="logo" alt="">
              Backlog
            </div>
            <div class="header-actions">
              <button class="btn-outline spotlight-btn" title="Search">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
                </svg>
                <kbd>${shortcut}</kbd>
              </button>
              <button class="btn-outline activity-btn" title="Recent Activity">
                <svg-icon src="${activityIcon}" size="16px"></svg-icon>
              </button>
              <button class="btn-outline system-info-btn" title="System Info">
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
  }

  private init() {
    // Subscribe BEFORE init so we get the initial state
    urlState.subscribe((state) => {
      const filterBar = this.querySelector('task-filter-bar') as any;
      filterBar?.setState?.(state.filter, state.type, state.q);

      const taskList = this.querySelector('task-list') as any;
      taskList?.setState?.(state.filter, state.type, state.id, state.q);

      if (state.id) {
        // Auto-scope sidebar based on navigated entity type
        const type = getTypeFromId(state.id);
        const config = getTypeConfig(type);
        if (config.isContainer) {
          // Navigating to a container → scope sidebar to it
          sidebarScope.set(state.id);
        }
        // For leaves, auto-scoping to parent happens in task-list after tasks load

        const detail = this.querySelector('task-detail') as any;
        detail?.loadTask?.(state.id);
      }
    });

    urlState.init();
    resizeService.init();
    layoutService.init();
    splitPane.init();

    // Button handlers
    this.querySelector('.home-button')?.addEventListener('click', () => {
      sidebarScope.set(null);
      urlState.set({ id: null });
    });

    const spotlight = this.querySelector('spotlight-search') as any;
    this.querySelector('.spotlight-btn')?.addEventListener('click', () => spotlight?.open());
    this.querySelector('.activity-btn')?.addEventListener('click', () => splitPane.openActivity());
    
    const modal = this.querySelector('system-info-modal') as any;
    this.querySelector('.system-info-btn')?.addEventListener('click', () => modal?.open());

    // Global keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        spotlight?.open();
      }
    });
  }
}

customElements.define('backlog-app', BacklogApp);
