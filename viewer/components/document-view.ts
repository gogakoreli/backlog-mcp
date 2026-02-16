/**
 * document-view.ts — Smart markdown document viewer.
 *
 * Renders frontmatter-aware document headers + <md-block> body.
 * Extracts known patterns from frontmatter into structured UI:
 *   - title → h1
 *   - dates → compact row
 *   - parent_id → clickable badge
 *   - everything else → MetadataCard key-value pairs
 *
 * Works for known entities (task, epic, milestone, artifact, folder)
 * and arbitrary markdown files with frontmatter.
 */
import { signal, computed } from '@framework/signal.js';
import { component } from '@framework/component.js';
import { html, when, each } from '@framework/template.js';
import { inject } from '@framework/injector.js';
import { useHostEvent } from '@framework/lifecycle.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import { getTypeFromId, getTypeConfig, getParentId } from '../type-registry.js';
import { TaskBadge } from './task-badge.js';
import { MetadataCard } from './metadata-card.js';
import { MdBlock } from './md-block.js';
import type { ReadonlySignal } from '@framework/signal.js';

type DocumentViewProps = {
  frontmatter: Record<string, unknown>;
  content: string;
  onNavigate?: (id: string) => void;
};

/** Fields rendered in the structured header — excluded from MetadataCard */
const HEADER_KEYS = new Set([
  'id', 'title', 'type', 'status',
  'created_at', 'updated_at', 'due_date',
  'parent_id', 'epic_id', 'parentTitle', 'epicTitle',
  // Internal fields not for display
  'raw', 'filePath', 'fileUri', 'mcpUri', 'description',
  'children',
]);

function formatDate(iso: string): string {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

export const DocumentView = component<DocumentViewProps>('document-view', (props, host) => {
  const splitState = inject(SplitPaneState);

  // Route file:// and mcp:// link clicks from md-block
  useHostEvent(host, 'link-click', (e: CustomEvent<{ href: string }>) => {
    const { href } = e.detail;
    if (href.startsWith('file://')) splitState.openResource(href.replace('file://', ''));
    else if (href.startsWith('mcp://')) splitState.openMcpResource(href);
  });

  const fm = props.frontmatter;
  const onNav = props.onNavigate;

  // ── Extracted header fields ──────────────────────────────────────
  const title = computed(() => fm.value.title as string | undefined);
  const createdAt = computed(() => {
    const v = fm.value.created_at || fm.value.date || fm.value.created;
    return v ? formatDate(String(v)) : null;
  });
  const updatedAt = computed(() => {
    const v = fm.value.updated_at || fm.value.modified || fm.value.updated;
    return v ? formatDate(String(v)) : null;
  });
  const dueDate = computed(() => {
    const v = fm.value.due_date;
    return v ? formatDate(String(v)) : null;
  });

  const parentId = computed(() => {
    const raw = fm.value as { parent_id?: string; epic_id?: string };
    return getParentId(raw) ?? null;
  });
  const parentType = computed(() => {
    const pid = parentId.value;
    return pid ? getTypeFromId(pid) : null;
  });
  const parentLabel = computed(() => {
    const pt = parentType.value;
    return pt ? getTypeConfig(pt).label : 'Parent';
  });
  const parentTitle = computed(() =>
    (fm.value.parentTitle || fm.value.epicTitle || null) as string | null
  );

  const hasDates = computed(() => !!(createdAt.value || updatedAt.value));

  function handleParentClick(e: Event) {
    e.preventDefault();
    const pid = parentId.value;
    const nav = onNav?.value;
    if (pid && nav) nav(pid);
  }

  // ── Extra entries for MetadataCard (everything not in header) ────
  const extraEntries = computed(() => {
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of Object.entries(fm.value)) {
      if (HEADER_KEYS.has(key)) continue;
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      entries.push({ key: key.replace(/_/g, ' '), value });
    }
    return entries;
  });

  // ── Header ───────────────────────────────────────────────────────
  const header = computed(() => {
    const hasTitle = !!title.value;
    const hasParent = !!parentId.value;
    const hasExtra = extraEntries.value.length > 0;
    if (!hasTitle && !hasDates.value && !hasParent && !hasExtra) return null;
    return true; // signal that header should render
  });

  // ── Children section ─────────────────────────────────────────────
  type ChildItem = { id: string; title: string; status: string; type: string };
  const children = computed<ChildItem[]>(() => {
    const raw = fm.value.children as Array<{ id: string; title: string; status: string; type?: string }> | undefined;
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    return raw.map(c => ({ id: c.id, title: c.title, status: c.status, type: c.type ?? 'task' }));
  });
  const hasChildren = computed(() => children.value.length > 0);

  function handleChildClick(childId: string) {
    const nav = onNav?.value;
    if (nav) nav(childId);
  }

  const childrenList = each(children, c => c.id, (child) => {
    const childId = computed(() => child.value.id);
    const childTitle = computed(() => child.value.title);
    const childStatus = computed(() => child.value.status);
    const childType = computed(() => child.value.type);
    const hasStatus = computed(() => getTypeConfig(childType.value).hasStatus);
    return html`
      <a href="#" class="child-row" @click.prevent="${() => handleChildClick(child.value.id)}">
        ${TaskBadge({ taskId: childId })}
        <span class="child-title">${childTitle}</span>
        ${when(hasStatus, html`<span class="status-badge status-${childStatus}">${childStatus}</span>`)}
      </a>
    `;
  });

  return html`
    <article class="markdown-body">
      ${when(header, html`
        <div class="doc-header">
          ${when(title, html`<h1 class="doc-title">${title}</h1>`)}
          ${when(hasDates, html`
            <div class="doc-dates">
              ${when(createdAt, html`<span>Created: ${createdAt}</span>`)}
              ${when(updatedAt, html`<span>Updated: ${updatedAt}</span>`)}
              ${when(dueDate, html`<span class="doc-due-date">Due: ${dueDate}</span>`)}
              ${when(parentId, html`
                <span class="doc-parent">
                  <span class="doc-parent-label">${parentLabel}:</span>
                  <a href="#" class="epic-link" @click="${handleParentClick}">
                    ${TaskBadge({ taskId: parentId as any })}
                  </a>
                  ${when(parentTitle, html`<span class="epic-title">${parentTitle}</span>`)}
                </span>
              `)}
            </div>
          `)}
          ${MetadataCard({ entries: extraEntries })}
        </div>
      `)}
      ${when(hasChildren, html`
        <div class="doc-children">
          <h3 class="doc-children-heading">Children</h3>
          <div class="doc-children-list">
            ${childrenList}
          </div>
        </div>
      `)}
      ${MdBlock({ content: props.content })}
    </article>
  `;
});
