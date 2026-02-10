/**
 * breadcrumb.ts — Reactive breadcrumb for scoped navigation.
 *
 * Reads scopeId from AppState, receives tasks as prop from task-list.
 * Uses each() for the path segments, @click to set scope.
 */
import { computed, batch, type ReadonlySignal } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html, each } from '../framework/template.js';
import { inject } from '../framework/injector.js';
import { getTypeConfig, getParentId } from '../type-registry.js';
import { AppState } from '../services/app-state.js';
import { SvgIcon } from './svg-icon.js';
import type { Task } from '../utils/api.js';

interface BreadcrumbProps {
  tasks: Task[];
}

type Segment = { id: string; title: string; type: string };

export const Breadcrumb = component<BreadcrumbProps>('epic-breadcrumb', (props) => {
  const app = inject(AppState);

  const path = computed<Segment[]>(() => {
    const scopeId = app.scopeId.value;
    const tasks = props.tasks.value;
    if (!scopeId) return [];

    const segments: Segment[] = [];
    let currentId: string | null = scopeId;
    const seen = new Set<string>();

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const item = tasks.find(t => t.id === currentId);
      if (!item) break;
      segments.unshift({ id: item.id, title: item.title, type: item.type ?? 'task' });
      currentId = getParentId(item) || null;
    }
    return segments;
  });

  function handleSegmentClick(segmentId: string | null) {
    if (segmentId) {
      app.selectTask(segmentId);
    } else {
      batch(() => {
        app.scopeId.value = null;
        app.selectedTaskId.value = null;
      });
    }
  }

  const segments = each(path, s => s.id, (seg) => {
    const title = computed(() => seg.value.title);
    const type = computed(() => seg.value.type);
    const icon = SvgIcon({ src: computed(() => getTypeConfig(seg.value.type).icon), size: computed(() => '12px') });
    return html`
      <span class="breadcrumb-separator">›</span>
      <button class="breadcrumb-segment" title="${title}"
              @click="${() => handleSegmentClick(seg.value.id)}">
        ${icon}
        ${title}
      </button>
    `;
  });

  return html`
    <div class="breadcrumb">
      <button class="breadcrumb-segment" title="All Items" @click="${() => handleSegmentClick(null)}">All Items</button>
      ${segments}
    </div>
  `;
});
