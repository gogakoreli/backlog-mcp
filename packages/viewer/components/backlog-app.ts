/**
 * backlog-app.ts — Root component.
 *
 * Thin shell: mounts children, wires keyboard shortcuts.
 * All state flows through AppState (ADR 0007 shared services).
 *
 * task-detail owns its own pane header and reads AppState + SplitPaneState.
 * resource-viewer and activity-panel read SplitPaneState directly.
 * The split pane area is rendered reactively using computed views.
 *
 * All document event bridges eliminated (ADR 0013). md-block link
 * interception uses event delegation on click.
 */
import { signal, computed, effect } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html } from '@framework/template.js';
import { inject } from '@framework/injector.js';
import { onMount } from '@framework/lifecycle.js';
import { settingsIcon, activityIcon } from '../icons/index.js';
import { SvgIcon } from './svg-icon.js';
import { CopyButton } from './copy-button.js';
import { ResizeHandle } from './resize-handle.js';
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
    app.scopeId.value = null;
    app.selectedTaskId.value = null;
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

  // ── Split pane reactive rendering ─────────────────────────────────

  // Pane header content (reactive)
  const paneHeaderContent = computed(() => {
    const paneType = splitState.activePane.value;
    if (!paneType) return null;

    const title = splitState.headerTitle.value;
    const subtitle = splitState.headerSubtitle.value;
    const fileUri = splitState.headerFileUri.value;
    const mcpUri = splitState.headerMcpUri.value;

    if (fileUri) {
      return html`
        <div class="uri-section">
          <div class="pane-title">${title}</div>
          <div class="uri-row">
            <span class="uri-label">file://</span>
            <code class="uri-value" title="${fileUri}">${fileUri}</code>
            ${CopyButton({ text: fileUri })}
          </div>
          ${mcpUri ? html`
            <div class="uri-row">
              <span class="uri-label">mcp://</span>
              <code class="uri-value" title="${mcpUri}">${mcpUri}</code>
              ${CopyButton({ text: mcpUri })}
            </div>
          ` : null}
        </div>
      `;
    }

    return html`
      <div class="pane-title">${title}</div>
      ${subtitle ? html`<div class="pane-subtitle">${subtitle}</div>` : null}
    `;
  });

  // Split pane content component (switches between resource-viewer and activity-panel)
  const splitPaneContent = computed(() => {
    const type = splitState.activePane.value;
    if (type === 'activity') return html`<activity-panel></activity-panel>`;
    return html`<resource-viewer></resource-viewer>`;
  });

  // Entire split pane area (reactive)
  const splitPaneView = computed(() => {
    const paneType = splitState.activePane.value;
    if (!paneType) return null;

    return html`
      <div class="resource-pane">
        <div class="pane-header">
          <div class="pane-header-content" id="split-pane-header-content">
            ${paneHeaderContent}
          </div>
          <button class="btn-outline resource-close-btn" title="Close (Cmd+W)"
                  @click=${() => splitState.close()}>✕</button>
        </div>
        <div class="pane-content">
          ${splitPaneContent}
        </div>
      </div>
    `;
  });

  // Effect: toggle split-active class on right-pane
  effect(() => {
    const rightPane = host.querySelector('#right-pane') as HTMLElement;
    if (!rightPane) return;
    if (splitState.activePane.value) {
      rightPane.classList.add('split-active');
    } else {
      rightPane.classList.remove('split-active');
    }
  });

  // ── Keyboard shortcut (runs once after mount) ─────────────────────
  onMount(() => {
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

      ${ResizeHandle({ storageKey: signal('leftPaneWidth') })}

      <div class="right-pane" id="right-pane">
        <div class="task-pane">
          <task-detail></task-detail>
        </div>
        ${ResizeHandle({ storageKey: signal('taskPaneWidth') })}
        ${splitPaneView}
      </div>
    </div>
  `;
});
