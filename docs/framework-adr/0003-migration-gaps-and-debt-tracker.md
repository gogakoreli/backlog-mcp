# 0003. Migration Gaps, Framework Debt, and Component Follow-Up Tracker

**Date**: 2026-02-09
**Status**: Active
**Predecessor**: [0001-web-component-framework](./0001-web-component-framework.md), [0002-implementation-notes](./0002-implementation-notes.md)

## Context

Phase 8 migrated `task-filter-bar` to the reactive framework. The migration succeeded but exposed **framework gaps** — features the framework lacks that forced backward-compat hacks in the migrated component. Before migrating remaining components (Phase 9), we need to:

1. Document every gap precisely, with code evidence
2. Catalog every backward-compat hack introduced per component
3. Define what "done" looks like for each gap
4. Prioritize which gaps block further migration vs. which can be batched

This ADR is a **living document** — updated as each component is migrated.

---

## Framework Gaps Found During Migration

### Gap 1: No public API mechanism on components

**Severity**: HIGH — blocks clean migration of 5/8 components
**Found in**: task-filter-bar (Phase 8)
**Affects**: task-filter-bar, task-item, task-list, task-detail, activity-panel

**Problem**: The `component()` factory hides the custom element class. There is no way to define methods or properties that external code can call on the element. The old class-based components exposed methods directly (e.g., `setState()`, `getSort()`, `loadTask()`).

**Current hack**:
```typescript
// task-filter-bar.ts — monkey-patching methods onto the host
(host as any).setState = (filter: string, _type: string, _query: string | null) => {
  currentFilter.value = filter;
};
(host as any).getSort = () => currentSort.value;
```

**Callers that depend on public methods** (grep evidence):
| Component | Method | Called from |
|---|---|---|
| task-filter-bar | `setState()` | backlog-app.ts:69 |
| task-filter-bar | `getSort()` | (internal only currently) |
| task-list | `setState()` | backlog-app.ts:72 |
| task-list | `setSelected()` | task-item.ts |
| task-list | `loadTasks()` | event listeners in connectedCallback |
| task-detail | `loadTask()` | task-item.ts, backlog-app.ts |
| activity-panel | `setTaskId()` | external callers |

**Proposed fix**: Add an `expose` option to `component()`:
```typescript
component<Props, Exposed>('task-filter-bar', (props, host) => {
  const currentFilter = signal('active');
  return {
    template: html`...`,
    expose: {
      setState: (filter: string) => { currentFilter.value = filter; },
      getSort: () => currentSort.value,
    },
  };
});
// Then: (el as TaskFilterBarElement).setState('completed')
```

**Follow-up ticket**: After implementing `expose`, revisit every `(host as any).methodName =` pattern.

---

### Gap 2: No `ref()` primitive for imperative DOM access

**Severity**: MEDIUM — workaround exists but is fragile
**Found in**: task-filter-bar (Phase 8)
**Affects**: task-filter-bar (select sync), task-detail (dynamic child creation), activity-panel (scroll preservation)

**Problem**: The template engine owns the DOM. But some patterns require imperative access to specific DOM nodes: setting `<select>` value, preserving scroll position, dynamically creating child elements. Currently, the only option is `host.querySelector()` inside an `effect()`, which is fragile and couples the effect to CSS class names.

**Current hack**:
```typescript
// task-filter-bar.ts — querying DOM inside effect
effect(() => {
  const sort = currentSort.value;
  const select = host.querySelector('.filter-sort-select') as HTMLSelectElement | null;
  if (select && select.value !== sort) {
    select.value = sort;
  }
});
```

**Components that will need ref()**:
| Component | DOM access pattern | What it does |
|---|---|---|
| task-filter-bar | `host.querySelector('.filter-sort-select')` | Sync select value with signal |
| task-detail | `document.querySelector('task-detail')` | Find self for external method calls |
| task-detail | `document.getElementById('task-pane-header')` | Update header outside component |
| activity-panel | `this.scrollTop` | Preserve/restore scroll position |
| task-list | Template with `escapeAttr()` | Build HTML strings with escaped data |

**Proposed fix**: A `ref()` function that returns a signal-like container for DOM references:
```typescript
const selectRef = ref<HTMLSelectElement>();
// In template:
html`<select ref="${selectRef}" class="filter-sort-select">...</select>`
// In effect:
effect(() => {
  if (selectRef.current) selectRef.current.value = currentSort.value;
});
```

---

### Gap 3: No Emitter integration during migration

**Severity**: LOW (for now) — intentionally deferred, not a framework bug
**Found in**: task-filter-bar (Phase 8)
**Affects**: ALL components

**Problem**: The framework provides `Emitter<Events>` for typed pub/sub, but migrated components still use `document.dispatchEvent(new CustomEvent(...))` because their consumers haven't been migrated yet. Two systems will coexist during migration.

**Current hack**:
```typescript
// task-filter-bar.ts — still using document events
document.dispatchEvent(new CustomEvent('filter-change', {
  detail: { filter, type: currentType.value, sort: currentSort.value },
}));
```

**Document events in use** (must all be migrated to Emitter eventually):
| Event name | Dispatched by | Listened by |
|---|---|---|
| `filter-change` | task-filter-bar | task-list, backlog-app |
| `sort-change` | task-filter-bar | task-list |
| `search-change` | spotlight-search | task-list |
| `task-selected` | task-item, task-detail | task-list, backlog-app, url-state |
| `scope-change` | sidebar-scope | task-list |
| `activity-open` | task-detail | backlog-app |
| `activity-clear-filter` | activity-panel | (unknown) |

**Resolution**: Migrate to Emitter when the last consumer of each event is migrated. No point doing it piecemeal — both sides must use Emitter for the typing to have value.

---

### Gap 4: No reactive list rendering (`each()` / `repeat()`)

**Severity**: MEDIUM — blocks efficient migration of task-list, activity-panel
**Found in**: Planning Phase 9
**Affects**: task-list (renders task items), activity-panel (renders operations)

**Problem**: The template engine can render arrays of TemplateResults, but they are static — created once during setup. There's no mechanism to efficiently update a list when items are added, removed, or reordered. Currently, the old components re-render the entire innerHTML. The framework should provide a `repeat()` or `each()` helper that takes a signal of an array and a template function, and performs keyed reconciliation.

**Evidence of the need**:
- `task-list.ts:179` — `this.innerHTML = \`...\`` rebuilds every task item on any change
- `activity-panel.ts:200+` — similar pattern, rebuilds entire operation list

**Proposed fix**: `each(itemsSignal, keyFn, templateFn)` that tracks items by key and patches the DOM.

**Note**: This was already identified as open gap #2 in [0002-implementation-notes](./0002-implementation-notes.md).

---

### Gap 5: Effect auto-disposal not wired to component lifecycle

**Severity**: MEDIUM — memory leak risk
**Found in**: Phase 8 and documented in 0002-implementation-notes
**Affects**: ALL components that use `effect()` during setup

**Problem**: Effects created during `component()` setup are not automatically disposed when the component disconnects. The component disposes its `ComponentHostImpl` disposers, and the template disposes its own effects, but standalone `effect()` calls in the setup function are not registered as disposers.

**Current state**: In task-filter-bar, the localStorage persistence effect and the select sync effect are NOT auto-disposed on disconnect. They will leak if the element is removed from the DOM while still holding signal subscriptions.

**Proposed fix**: Make `effect()` context-aware — if called during component setup, auto-register the dispose function with the component host.

**Note**: Already listed as open gap #1 in [0002-implementation-notes](./0002-implementation-notes.md).

---

### Gap 6: No `observedAttributes` → signal bridge

**Severity**: LOW — only affects pure leaf components
**Found in**: Attempted migration of svg-icon, task-badge
**Affects**: svg-icon, task-badge (and any future attribute-driven components)

**Problem**: The framework's `component()` routes props through a signal-backed Proxy (`_setProp()`). But leaf components like `svg-icon` and `task-badge` receive data as HTML attributes (`<svg-icon src="..." size="...">`), not as props. The native `observedAttributes` + `attributeChangedCallback` pattern has no framework equivalent.

**Why it matters**: These components are used inside `innerHTML` strings and `html` template literals. Their consumers write `<svg-icon src="${icon}">`, which sets an HTML attribute, not a framework prop. Without an attribute → signal bridge, migrating these components would require changing every call site to use factory composition instead.

**Decision**: SKIP migration of attribute-driven leaf components. They work fine as plain `HTMLElement` subclasses. The framework adds no value here — no internal state, no reactivity, no events.

**Future option**: If needed, add an `attrs` option to `component()`:
```typescript
component('svg-icon', (props) => {
  // props.src and props.size auto-populated from HTML attributes
  return html`...`;
}, { attrs: ['src', 'size'] });
```

---

## Component Migration Status and Debt Tracker

### Migration Order (by complexity, ascending)

| # | Component | LOC | Status | Framework features exercised | Backward-compat hacks needed |
|---|---|---|---|---|---|
| 1 | task-filter-bar | 120→130 | **DONE** (Phase 8) | signal, computed, effect, html, component, class:active | None remaining (hacks removed in later phases) |
| 2 | svg-icon | 73 | **DONE** (Phase 9) | component, effect, html, PropInput | `HACK:EXPOSE` (attr bridge for unmigrated consumers) |
| 3 | task-badge | 27 | **DONE** (Phase 9) | component, computed, effect, html, SvgIcon factory | None |
| 4 | md-block | 306 | **SKIP** | N/A — third-party wrapper, async rendering | Too many external deps (marked, DOMPurify, Prism) |
| 5 | copy-button | ~100 | **DONE** (Phase 10) | component, html, SvgIcon factory | `HACK:EXPOSE`, `HACK:MOUNT_APPEND` (for pane header, split-pane) |
| 6 | task-item | 82 | **DONE** (Phase 10) | component, html, computed, when, inject, AppState | None remaining |
| 7 | task-list | 219 | **DONE** (Phase 11) | signal, computed, effect, html, inject, query, each, when | None remaining |
| 8 | breadcrumb | ~60 | **DONE** (Phase 11) | component, computed, each, html, inject | None |
| 9 | backlog-app | 118 | **DONE** (Phase 11) | component, inject, effect, html, SvgIcon factory | `HACK:CROSS_QUERY` (spotlight open) |
| 10 | **system-info-modal** | 104→131 | **DONE** (Phase 12) | component, computed, html, query, inject, onMount, CopyButton factory | None |
| 11 | **task-detail** | 168→258 | **DONE** (Phase 12) | component, signal, computed, effect, html, query, each, when, inject, onCleanup, CopyButton/TaskBadge/SvgIcon factory | `HACK:CROSS_QUERY` (pane header), `HACK:DOC_EVENT` (activity-open) |
| 12 | spotlight-search | 629 | Pending | — | Blocked by Gap 3 (ADR 0010) |
| 13 | resource-viewer | 227 | Pending | — | Blocked by Gap 2 (ADR 0010) |
| 14 | activity-panel | 545 | Pending | — | Blocked by Gap 2 (ADR 0010) |

### Key decisions

- **svg-icon, task-badge**: SKIP migration. Pure attribute-driven leaf components with zero internal state. The framework lacks an `observedAttributes` → signal bridge (Gap 6), and these components gain nothing from signals/effects/emitters. They work perfectly as plain `HTMLElement` subclasses.
- **md-block**: SKIP migration. It wraps third-party libraries (marked, DOMPurify, Prism) with async rendering. The framework gains nothing from migrating it, and the async `render()` pattern doesn't fit the synchronous setup model.
- **backlog-app**: Migrate LAST. It's the root orchestrator that calls methods on all children. Every child must be migrated first so we know what API surface to call.
- **task-list and activity-panel**: Need `each()` for efficient list rendering. Can be migrated with static arrays first (same perf as today), then upgraded when `each()` lands.

---

## Per-Component Follow-Up Ledger

This section tracks every backward-compat hack introduced. When a framework gap is fixed, grep for the tag to find all sites that need cleanup.

### task-filter-bar (migrated)

| Hack | Tag | Cleanup trigger |
|---|---|---|
| `(host as any).setState = ...` | `HACK:EXPOSE` | Gap 1 resolved |
| `(host as any).getSort = ...` | `HACK:EXPOSE` | Gap 1 resolved |
| `document.dispatchEvent(new CustomEvent('filter-change', ...))` | `HACK:DOC_EVENT` | Gap 3 — when task-list migrated |
| `document.dispatchEvent(new CustomEvent('sort-change', ...))` | `HACK:DOC_EVENT` | Gap 3 — when task-list migrated |
| `host.querySelector('.filter-sort-select')` in effect | `HACK:REF` | Gap 2 resolved |

### svg-icon (migrated Phase 9)

| Hack | Tag | Cleanup trigger |
|---|---|---|
| Attribute → signal bridge for unmigrated consumers | `HACK:EXPOSE` | When all consumers use factory composition |

### task-badge (migrated Phase 9)

No hacks. Clean migration.

### copy-button (migrated Phase 10)

| Hack | Tag | Cleanup trigger |
|---|---|---|
| `.text` property setter for unmigrated consumers | `HACK:EXPOSE` | When pane header + split-pane use factory |
| innerHTML children persist alongside template | `HACK:MOUNT_APPEND` | When all consumers use factory composition |

### task-item (migrated Phase 10)

No hacks remaining. Uses AppState.selectTask() for navigation.

### task-list (migrated Phase 11)

No hacks remaining. Uses query() + each() + AppState signals.

### breadcrumb (migrated Phase 11)

No hacks. Clean migration.

### backlog-app (migrated Phase 11)

| Hack | Tag | Cleanup trigger |
|---|---|---|
| `querySelector('spotlight-search').open()` | `HACK:CROSS_QUERY` | When spotlight-search uses AppState signal |

### system-info-modal (migrated Phase 12)

No hacks. Uses AppState.isSystemInfoOpen signal for open/close.

### task-detail (migrated Phase 12)

| Hack | Tag | Cleanup trigger |
|---|---|---|
| `document.getElementById('task-pane-header')` innerHTML update | `HACK:CROSS_QUERY` | ADR 0010 Gap 1 — move header into task-detail |
| `document.dispatchEvent('activity-open')` | `HACK:DOC_EVENT` | ADR 0010 Gap 2 — when split-pane is reactive |

### activity-panel (pending)

| Expected hack | Tag | Cleanup trigger |
|---|---|---|
| `(host as any).setTaskId = ...` | `HACK:EXPOSE` | Gap 1 resolved |
| `this.scrollTop` preservation | `HACK:REF` | Gap 2 resolved |
| Event delegation via `data-*` attributes | `HACK:EVENT_DELEGATION` | Consider keeping — it's a valid pattern |
| Static list rendering | `HACK:STATIC_LIST` | Gap 4 resolved |
| `disconnectedCallback` cleanup | `HACK:LIFECYCLE` | Gap 5 resolved |

---

## Gap Resolution Priority

| Priority | Gap | Blocks | Effort | When to fix |
|---|---|---|---|---|
| P0 | #5 Effect auto-disposal | All components (memory leaks) | Small | Before migrating task-list |
| P1 | #1 Component expose API | 5 components | Medium | Before migrating task-item |
| P2 | #2 ref() primitive | 4 components | Small | Before migrating task-detail |
| P3 | #4 each() / repeat() | task-list, activity-panel | Large | Before Phase 9 is "complete" |
| Deferred | #3 Emitter migration | All | Medium | When all components are migrated |
| Deferred | #6 Attribute → signal bridge | svg-icon, task-badge | Small | Only if attribute-driven components need reactivity |

**Critical path**: Fix P0 → Fix P1 → Migrate task-item → Fix P2 → Migrate task-detail → Migrate task-list (static) → Migrate activity-panel (static) → Migrate backlog-app → Fix P3 → Upgrade lists → Fix Deferred → Remove all `HACK:DOC_EVENT` tags.

**Components skipped** (not on critical path): svg-icon, task-badge, md-block — all work fine as plain HTMLElement subclasses.

---

## Invariants for Migration

These rules MUST hold during the entire migration period:

1. **The app must work at every commit**. Migrated and unmigrated components coexist. A migrated component must produce the same DOM structure, CSS classes, and events as the original.

2. **Same tag name**. Migrated components keep their tag names. `<task-filter-bar>` before = `<task-filter-bar>` after. The `main.ts` import path stays the same.

3. **Same document events**. Until ALL listeners of an event are migrated, the event MUST still be dispatched on `document`. Do not partially migrate to Emitter — it breaks the unmigrated listener.

4. **Same public method signatures**. If `backlog-app.ts:69` calls `filterBar.setState(filter, type, query)`, the migrated component must accept the same arguments, even if it ignores some.

5. **Tests cover the public contract**. Every migrated component must have tests that verify: DOM structure, event dispatch, public method behavior, and reactive updates.

6. **No hack without a tag**. Every backward-compat hack must be tagged (`HACK:EXPOSE`, `HACK:DOC_EVENT`, etc.) so we can grep and clean up later.

7. **`md-block` is exempt**. It wraps third-party libraries and doesn't benefit from framework migration. Leave it as-is.

---

## Estimation

Based on task-filter-bar taking ~1 session:

| Component | Estimated effort | Notes |
|---|---|---|
| svg-icon | SKIP | Attribute-driven leaf, no framework benefit |
| task-badge | SKIP | Attribute-driven leaf, no framework benefit |
| task-item | 1 session | Cross-component queries are the hard part |
| task-list | 1–2 sessions | Largest state surface, needs careful test coverage |
| task-detail | 1 session | Dynamic child creation is tricky |
| backlog-app | 1 session | Depends on all children being migrated |
| activity-panel | 2 sessions | Largest component, complex state and event delegation |
| Framework gap fixes | 2–3 sessions | P0 through P3 |
| Emitter migration | 1 session | After all components migrated |

**Total remaining**: ~10–12 sessions for full migration including framework fixes.
