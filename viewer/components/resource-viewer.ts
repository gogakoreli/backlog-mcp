/**
 * resource-viewer.ts — Reactive resource viewer component (Phase 14).
 *
 * Reads SplitPaneState signals directly to know what resource to load.
 * Replaces the class-based ResourceViewer with signal-driven reactivity.
 *
 * Uses html:inner directive for trusted HTML (markdown metadata rendering).
 * See ADR 0011 Gap 1 for the html:inner directive rationale.
 */
import { signal, computed, effect, batch } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { useHostEvent } from '../framework/lifecycle.js';
import { SplitPaneState } from '../services/split-pane-state.js';

interface ResourceData {
  frontmatter?: Record<string, unknown>;
  content: string;
  path?: string;
  ext?: string;
  fileUri?: string;
  mcpUri?: string | null;
}

type LoadState = 'empty' | 'loading' | 'loaded' | 'error';

export const ResourceViewer = component('resource-viewer', (_props, host) => {
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

  // ── Link interception ────────────────────────────────────────────
  // Listen for md-block's 'md-render' event (bubbles) to intercept
  // file:// and mcp:// links after each render. See ADR 0013.
  useHostEvent(host, 'md-render', () => {
    host.querySelectorAll('a[href^="file://"], a[href^="mcp://"]').forEach(link => {
      if ((link as any).__resourceIntercepted) return;
      (link as any).__resourceIntercepted = true;
      const href = link.getAttribute('href')!;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (href.startsWith('file://')) {
          splitState.openResource(href.replace('file://', ''));
        } else if (href.startsWith('mcp://')) {
          splitState.openMcpResource(href);
        }
      });
    });
  });

  // ── Rendering helpers ────────────────────────────────────────────

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatValue(value: unknown): string {
    if (Array.isArray(value)) {
      return `<ul>${value.map(v => `<li>${formatValue(v)}</li>`).join('')}</ul>`;
    }
    if (typeof value === 'object' && value !== null) {
      return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    }
    return escapeHtml(String(value));
  }

  // ── Computed metadata HTML (trusted, from frontmatter) ───────────
  const metadataHtml = computed(() => {
    const d = data.value;
    if (!d?.frontmatter || Object.keys(d.frontmatter).length === 0) return '';
    return `
      <dl class="frontmatter-list">
        ${Object.entries(d.frontmatter).map(([key, value]) => `
          <div class="frontmatter-item">
            <dt>${escapeHtml(key)}</dt>
            <dd>${formatValue(value)}</dd>
          </div>
        `).join('')}
      </dl>
    `;
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
      return html`
        <article class="markdown-body">
          <div class="frontmatter-meta" html:inner="${metadataHtml}"></div>
          <md-block>${computed(() => data.value?.content || '')}</md-block>
        </article>
      `;
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
