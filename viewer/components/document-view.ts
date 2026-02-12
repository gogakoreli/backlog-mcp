/**
 * document-view.ts — Reusable markdown document viewer.
 *
 * Renders an optional header (custom or MetadataCard) above an
 * <md-block> body, wrapped in <article class="markdown-body">.
 * Owns link interception for file:// and mcp:// URLs (ADR 0070).
 *
 * Callers compose their own header — task-detail provides a fancy
 * task card, resource-viewer provides a generic MetadataCard,
 * future types provide whatever they need.
 */
import { component } from '../framework/component.js';
import { html, type TemplateResult } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { useResourceLinks } from '../framework/lifecycle.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import type { ReadonlySignal } from '../framework/signal.js';

interface DocumentViewProps {
  header?: TemplateResult;
  content: ReadonlySignal<string>;
}

export const DocumentView = component<DocumentViewProps>('document-view', (props, host) => {
  const splitState = inject(SplitPaneState);
  useResourceLinks(host, splitState);

  return html`
    <article class="markdown-body">
      ${props.header}
      <md-block>${props.content}</md-block>
    </article>
  `;
}, { class: 'document-view' });
