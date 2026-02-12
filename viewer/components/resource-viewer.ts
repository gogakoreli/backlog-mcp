/**
 * resource-viewer.ts — Reactive resource viewer component.
 *
 * Reads SplitPaneState signals to load and display resources.
 * Delegates markdown rendering to DocumentView (link interception,
 * MetadataCard, md-block). Handles code/text files directly.
 */
import { signal, computed, effect, batch } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { DocumentView } from './document-view.js';

interface ResourceData {
  frontmatter?: Record<string, unknown>;
  content: string;
  path?: string;
  ext?: string;
  fileUri?: string;
  mcpUri?: string | null;
}

type LoadState = 'empty' | 'loading' | 'loaded' | 'error';

export const ResourceViewer = component('resource-viewer', () => {
  const splitState = inject(SplitPaneState);

  // ── Local state ──────────────────────────────────────────────────
  const loadState = signal<LoadState>('empty');
  const data = signal<ResourceData | null>(null);
  const errorMessage = signal('');

  // ── Data loading ─────────────────────────────────────────────────
  async function loadResource(path: string) {
    loadState.value = 'loading';
    try {
      const res = await fetch(`/resource?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load resource');
      batch(() => {
        data.value = json;
        loadState.value = 'loaded';
      });
      updateHeaderFromData(json);
    } catch (err) {
      batch(() => {
        errorMessage.value = (err as Error).message;
        loadState.value = 'error';
      });
    }
  }

  async function loadMcpResource(uri: string) {
    loadState.value = 'loading';
    try {
      const res = await fetch(`/mcp/resource?uri=${encodeURIComponent(uri)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load resource');
      batch(() => {
        data.value = json;
        loadState.value = 'loaded';
      });
      updateHeaderFromData(json);
    } catch (err) {
      batch(() => {
        errorMessage.value = (err as Error).message;
        loadState.value = 'error';
      });
    }
  }

  function updateHeaderFromData(d: ResourceData) {
    if (d.fileUri || d.mcpUri) {
      splitState.setHeaderWithUris(
        d.path?.split('/').pop() || 'Resource',
        d.fileUri || '',
        d.mcpUri || undefined,
      );
    }
  }

  // ── React to SplitPaneState changes ──────────────────────────────
  effect(() => {
    const paneType = splitState.activePane.value;
    if (paneType === 'resource') {
      const path = splitState.resourcePath.value;
      if (path) loadResource(path).catch(() => {});
    } else if (paneType === 'mcp') {
      const uri = splitState.mcpUri.value;
      if (uri) loadMcpResource(uri).catch(() => {});
    } else {
      // Reset when pane closes or switches to activity
      data.value = null;
      loadState.value = 'empty';
    }
  });

  // ── Computed content view ────────────────────────────────────────
  const contentView = computed(() => {
    const state = loadState.value;
    const d = data.value;

    if (state === 'empty') {
      return html`
        <div class="resource-empty">
          <div class="resource-empty-icon">📄</div>
          <div>Click a file reference to view</div>
        </div>
      `;
    }

    if (state === 'loading') {
      return html`
        <div class="resource-content">
          <div class="resource-loading">Loading...</div>
        </div>
      `;
    }

    if (state === 'error') {
      return html`
        <div class="resource-content">
          <div class="resource-error">
            <div>Failed to load resource</div>
            <div class="resource-error-detail">${errorMessage}</div>
          </div>
        </div>
      `;
    }

    if (!d) return html`<div></div>`;

    // Markdown document
    if (d.ext === 'md' || d.frontmatter) {
      return DocumentView({
        frontmatter: computed(() => data.value?.frontmatter ?? {}),
        content: computed(() => data.value?.content || ''),
      });
    }

    // Code file
    if (d.ext && ['ts', 'js', 'json', 'txt'].includes(d.ext)) {
      return html`
        <pre><code class="language-${d.ext}">${computed(() => data.value?.content || '')}</code></pre>
      `;
    }

    // Plain text fallback
    return html`
      <pre>${computed(() => data.value?.content || '')}</pre>
    `;
  });

  // ── Template ─────────────────────────────────────────────────────
  return html`<div class="resource-viewer">${contentView}</div>`;
}, { class: 'resource-viewer' });
