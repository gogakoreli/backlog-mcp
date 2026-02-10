/**
 * backlog-app.ts — Root component.
 *
 * Thin shell: mounts children, initializes layout services.
 * All state flows through AppState (ADR 0007 shared services).
 *
 * task-detail, system-info-modal, and spotlight-search are now reactive —
 * they read AppState directly. No bridge effects needed.
 *
 * The split pane (resource-viewer / activity-panel) is driven by
 * SplitPaneState signals. When activePane changes, the pane content
 * is created/updated/removed imperatively via effect().
 *
 * GAP:IMPERATIVE_CHILD — resource-viewer and activity-panel are still
 * class-based and need imperative method calls (.loadResource(), .setTaskId()).
 * Once they're migrated to framework components, the effect-based pane
 * management can be replaced with reactive when()/computed views.
 * See ADR 0011 Gap 2.
 */
import { batch, signal, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { onMount } from '../framework/lifecycle.js';
import { settingsIcon, activityIcon } from '../icons/index.js';
import { SvgIcon } from './svg-icon.js';
import { resizeService } from '../utils/resize.js';
import { layoutService } from '../utils/layout.js';
import { AppState } from '../services/app-state.js';
import { SplitPaneState } from '../services/split-pane-state.js';

export const BacklogApp = component('backlog-app', (_props, host) => {
  const app = inject(AppState);
  const splitState = inject(SplitPaneState);
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
    app.isSpotlightOpen.value = !app.isSpotlightOpen.value;
  }

  function handleActivityClick() {
    splitState.openActivity();
  }

  function handleSystemInfoClick() {
    app.isSystemInfoOpen.value = true;
  }

  // ── Split pane management ─────────────────────────────────────────
  // GAP:IMPERATIVE_CHILD — resource-viewer and activity-panel are class-based.
  // We manage their lifecycle imperatively until they're migrated.

  let currentViewer: any = null;
  let currentPaneEl: HTMLElement | null = null;
  let currentPaneType: string | null = null;

  function destroySplitPane(rightPane: HTMLElement) {
    if (currentPaneEl) {
      currentPaneEl.remove();
      currentPaneEl = null;
      currentViewer = null;
      currentPaneType = null;
      rightPane.classList.remove('split-active');
    }
  }

  function createSplitPane(rightPane: HTMLElement, contentType: string): HTMLElement {
    rightPane.classList.add('split-active');

    const pane = document.createElement('div');
    pane.className = 'resource-pane';

    const header = document.createElement('div');
    header.className = 'pane-header';

    const headerContent = document.createElement('div');
    headerContent.className = 'pane-header-content';
    headerContent.id = 'split-pane-header-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-outline resource-close-btn';
    closeBtn.title = 'Close (Cmd+W)';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => splitState.close());

    header.appendChild(headerContent);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content';

    if (contentType === 'activity') {
      currentViewer = document.createElement('activity-panel');
    } else {
      currentViewer = document.createElement('resource-viewer');
      currentViewer.setShowHeader(false);
    }
    content.appendChild(currentViewer);

    pane.appendChild(header);
    pane.appendChild(content);
    rightPane.appendChild(pane);

    currentPaneEl = pane;
    currentPaneType = contentType;
    return pane;
  }

  // Effect: sync split pane content with state signals
  effect(() => {
    const paneType = splitState.activePane.value;
    const rightPane = host.querySelector('#right-pane') as HTMLElement;
    if (!rightPane) return;

    if (!paneType) {
      destroySplitPane(rightPane);
      return;
    }

    const isActivityPane = paneType === 'activity';
    const neededType = isActivityPane ? 'activity' : 'resource';

    // If pane type changed, destroy and recreate
    if (currentPaneType !== neededType) {
      destroySplitPane(rightPane);
      createSplitPane(rightPane, neededType);
    }

    // Update the viewer with current data
    if (isActivityPane && currentViewer) {
      currentViewer.setTaskId(splitState.activityTaskId.value);
    } else if (paneType === 'resource' && currentViewer && splitState.resourcePath.value) {
      currentViewer.loadResource(splitState.resourcePath.value);
    } else if (paneType === 'mcp' && currentViewer && splitState.mcpUri.value) {
      currentViewer.loadMcpResource(splitState.mcpUri.value);
    }
  });

  // Effect: sync split pane header with state signals
  effect(() => {
    const headerEl = host.querySelector('#split-pane-header-content') as HTMLElement;
    if (!headerEl) return;

    const title = splitState.headerTitle.value;
    const subtitle = splitState.headerSubtitle.value;
    const fileUri = splitState.headerFileUri.value;
    const mcpUri = splitState.headerMcpUri.value;

    if (fileUri) {
      // URI header with copy buttons
      headerEl.innerHTML = '';
      const uriSection = document.createElement('div');
      uriSection.className = 'uri-section';

      const titleEl = document.createElement('div');
      titleEl.className = 'pane-title';
      titleEl.textContent = title;
      uriSection.appendChild(titleEl);

      // File URI row
      uriSection.appendChild(createUriRow(fileUri, 'file://'));

      if (mcpUri) {
        uriSection.appendChild(createUriRow(mcpUri, 'mcp://'));
      }

      headerEl.appendChild(uriSection);
    } else {
      headerEl.innerHTML = `
        <div class="pane-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="pane-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      `;
    }
  });

  function createUriRow(uri: string, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'uri-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'uri-label';
    labelEl.textContent = label;

    const uriEl = document.createElement('code');
    uriEl.className = 'uri-value';
    uriEl.textContent = uri;
    uriEl.title = uri;

    const copyBtn = document.createElement('copy-button');
    copyBtn.id = 'copy-uri-btn';
    copyBtn.textContent = 'Copy';
    (copyBtn as any).text = uri;

    row.appendChild(labelEl);
    row.appendChild(uriEl);
    row.appendChild(copyBtn);

    return row;
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Initialize layout services (runs once after mount) ───────────
  onMount(() => {
    resizeService.init();
    layoutService.init();

    // Set up resize handle between task and resource panes
    const rightPane = host.querySelector('#right-pane') as HTMLElement;
    const taskPane = rightPane?.querySelector('.task-pane') as HTMLElement;
    if (rightPane && taskPane) {
      const savedWidth = localStorage.getItem('taskPaneWidth');
      if (savedWidth) {
        taskPane.style.width = savedWidth;
      }
      const handle = resizeService.createHandle(rightPane, taskPane, 'taskPaneWidth');
      handle.dataset.storageKey = 'taskPaneWidth';
      handle.classList.add('split-resize-handle');
      rightPane.appendChild(handle);
    }

    // Global keyboard shortcut for spotlight
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        handleSpotlightClick();
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
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
