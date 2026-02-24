/**
 * md-block.ts — Markdown renderer as a framework component.
 *
 * Content arrives as a reactive prop (never read from innerHTML),
 * eliminating all HTML-entity escaping issues. Link behaviour is
 * handled inside marked renderers (see services/markdown.ts).
 *
 * file:// / mcp:// links → click event delegation on host
 */

import { marked } from '../services/markdown.js';
import { computed, effect } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html } from '@framework/template.js';
import { useHostEvent } from '@framework/lifecycle.js';
import { ref } from '@framework/ref.js';

export type MdBlockProps = {
  content: string;
};

export const MdBlock = component<MdBlockProps>('md-block', (props, host) => {
  const rendered = computed(() => {
    const md = props.content.value;
    if (!md) return '';
    return marked.parse(md) as string;
  });

  const bodyRef = ref<HTMLDivElement>();

  effect(() => {
    rendered.value; // track
    const el = bodyRef.current;
    if (el) renderMermaid(el);
  });

  // Bubble anchor clicks as a typed custom event — parent decides routing
  useHostEvent(host, 'click', (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('file://') || href.startsWith('mcp://')) {
      e.preventDefault();
      host.dispatchEvent(new CustomEvent('link-click', {
        bubbles: true, composed: true,
        detail: { href },
      }));
    }
  });

  return html`<div class="markdown-body" ref=${bodyRef} html:inner=${rendered}></div>`;

  async function renderMermaid(container: HTMLElement) {
    const nodes = container.querySelectorAll<HTMLPreElement>('pre.mermaid');
    if (!nodes.length) return;
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    await mermaid.run({ nodes });
  }
});
