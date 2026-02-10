# 0011. Migration Phase 13 — spotlight-search, SplitPaneState, and Remaining Gaps

**Date**: 2026-02-10
**Status**: Active
**Depends on**: [0010-migration-phase-12-gaps](./0010-migration-phase-12-gaps.md), [0009-framework-defense-in-depth](./0009-framework-defense-in-depth.md)

## Context

Phase 13 migrated `spotlight-search` to the reactive framework and replaced the
imperative `SplitPaneService` with a signal-driven `SplitPaneState` service.
This ADR documents the migration decisions, remaining hacks, and framework gaps
discovered during the work.

## Changes

### spotlight-search Migration

**Before**: Class-based `SpotlightSearch extends HTMLElement`, `open()`/`close()`
methods called imperatively from backlog-app via `querySelector`.

**After**: Reactive component reading `AppState.isSpotlightOpen` signal.
- Search results and tabs rendered via `each()` list composition
- Type filter / sort mode toggled via `class:active` bindings and signal state
- Recent activity loaded via `query()` with `enabled` guard (only fetches when open)
- Keyboard navigation (arrow keys, Tab, Enter, Escape) handled via `@keydown`
- Result selection updates recentSearchesService and navigates via AppState
- TaskBadge used via factory composition

**AppState addition**: `isSpotlightOpen: Signal<boolean>` — controls modal
visibility. backlog-app sets `app.isSpotlightOpen.value = true` on trigger.

**Hacks removed**:
- `HACK:CROSS_QUERY` in backlog-app — was `querySelector('spotlight-search').open()`,
  now `app.isSpotlightOpen.value = true`.

**Hacks retained**:
- `HACK:DOC_EVENT` — `resource-open` event dispatched on document for resource
  navigation (until SplitPaneState is consumed directly by components)
- `GAP:INNERHTML_BINDING` — highlighted HTML from @orama/highlight must be set
  imperatively via effects (see Gap 1 below)

### SplitPaneState Service

**Before**: `SplitPaneService` (imperative, DOM-coupled) created resource-viewer
and activity-panel elements via `document.createElement()`, called imperative
methods, managed pane headers — all operating outside the framework.

**After**: `SplitPaneState` (signal-driven, DOM-free) provides reactive state:
- `activePane: Signal<'resource' | 'mcp' | 'activity' | null>`
- `resourcePath`, `mcpUri`, `activityTaskId` — data signals
- `headerTitle`, `headerSubtitle`, `headerFileUri`, `headerMcpUri` — header signals
- Methods: `openResource()`, `openMcpResource()`, `openActivity()`, `close()`,
  `setHeaderWithUris()`, `clearActivityFilter()`

**Integration**: backlog-app reads SplitPaneState signals via effects to manage
split pane lifecycle. main.ts bridges document events to SplitPaneState methods.

**Impact**: Unblocks future migration of resource-viewer and activity-panel.
These components can now be migrated to framework components that read
SplitPaneState directly, at which point the imperative effect-based pane
management in backlog-app can be replaced with reactive `when()`/computed views.

## Remaining Framework/Architecture Gaps

### Gap 1: innerHTML Binding Directive (MEDIUM)

**Problem**: The framework's template engine has no way to render trusted HTML
strings. Spotlight search results use `@orama/highlight` which returns HTML with
`<mark>` tags for matched text. Without an innerHTML binding, we must set
innerHTML imperatively via effects after render.

**Current workaround**: Render empty placeholder `<span>` elements in the
template, then use effects with `queueMicrotask()` to find them via
`querySelectorAll()` and set their `innerHTML`. This is fragile — it depends on
DOM element order matching the signal array indices.

**Impact**: Any component that needs to render trusted HTML (markdown snippets,
highlighted search results, diff output) faces the same limitation.

**Proposed solution**: Add an `html:inner` or `unsafeHTML` directive to the
template engine. This would accept a signal containing an HTML string and update
the element's innerHTML reactively:
```ts
html`<span html:inner="${highlightedHtml}"></span>`
```
Must sanitize or clearly document that this is for trusted content only.

### Gap 2: Imperative Child Component Lifecycle in Effects (MEDIUM)

**Problem**: resource-viewer and activity-panel are still class-based components
with imperative APIs (`.loadResource()`, `.setTaskId()`). backlog-app manages
their lifecycle via effects that call `document.createElement()` and set
properties imperatively. This works but is not idiomatic framework code.

**Current workaround**: The `createSplitPane()` / `destroySplitPane()` functions
in backlog-app imperatively create/destroy the pane and its child component,
tracked via closure variables (`currentViewer`, `currentPaneEl`).

**Impact**: The split pane area doesn't benefit from the framework's automatic
disposal and is manually managed. It works reliably but won't get lifecycle
guarantees (onMount/onCleanup) until the child components are migrated.

**Resolution path**: Migrate resource-viewer and activity-panel to framework
components, then replace the imperative effects with reactive `when()`/computed
views that render the appropriate component based on `splitState.activePane`.

### Gap 3: Pane Header Cross-Tree Ownership (HIGH — carried from ADR 0010)

**Problem**: The task pane header (`#task-pane-header`) is rendered by
backlog-app but populated by task-detail. Similarly, the split pane header
(`#split-pane-header-content`) is created imperatively and populated by effects.

**Current state**: Both headers use imperative `innerHTML` updates in effects.
The split pane header was migrated from SplitPaneService to SplitPaneState
signals, which is an improvement (reactive data flow), but the rendering is
still imperative DOM manipulation.

**Proposed solution** (updated): When resource-viewer and activity-panel are
migrated, the split pane header can be rendered reactively in backlog-app's
template based on SplitPaneState signals. For task-detail's header, the
recommendation from ADR 0010 Gap 1 (move header into task-detail) still applies.

### Gap 4: Document Events as Cross-Component Communication (LOW)

**Problem**: Several document-level custom events remain:
- `resource-open` — dispatched by spotlight-search, resource-viewer (link clicks)
- `resource-close` — dispatched by resource-viewer
- `resource-loaded` — dispatched by resource-viewer
- `activity-open` — dispatched by task-detail
- `activity-close` — dispatched by activity-panel close button
- `activity-clear-filter` — dispatched by activity-panel

**Current state**: main.ts bridges these events to SplitPaneState methods.
This is better than the previous pattern (events → imperative service calls)
because the state flow is now: event → signal write → reactive rendering.

**Resolution path**: As components are migrated, they can `inject(SplitPaneState)`
directly and call methods, eliminating the need for document events.

## Migration Status Update

| # | Component | Status | Hacks |
|---|---|---|---|
| 1 | task-filter-bar | ✅ Done (Phase 8) | None remaining |
| 2 | svg-icon | ✅ Done (Phase 9) | `HACK:EXPOSE` (attr bridge) |
| 3 | task-badge | ✅ Done (Phase 9) | None |
| 4 | md-block | ⏭ SKIP | Third-party wrapper |
| 5 | copy-button | ✅ Done (Phase 10) | `HACK:EXPOSE`, `HACK:MOUNT_APPEND` |
| 6 | task-item | ✅ Done (Phase 10) | None remaining |
| 7 | task-list | ✅ Done (Phase 11) | None remaining |
| 8 | breadcrumb | ✅ Done (Phase 11) | None |
| 9 | backlog-app | ✅ Done (Phase 11, updated Phase 13) | `GAP:IMPERATIVE_CHILD` |
| 10 | system-info-modal | ✅ Done (Phase 12) | None |
| 11 | task-detail | ✅ Done (Phase 12) | `HACK:CROSS_QUERY` (header), `HACK:DOC_EVENT` |
| 12 | **spotlight-search** | ✅ **Done (Phase 13)** | **`GAP:INNERHTML_BINDING`, `HACK:DOC_EVENT`** |
| 13 | resource-viewer | ❌ Pending | Gap 2 (now unblocked by SplitPaneState) |
| 14 | activity-panel | ❌ Pending | Gap 2 (now unblocked by SplitPaneState) |

### Summary: 12/14 components migrated (2 pending, 1 skipped)

## Recommended Next Steps

1. **Add `unsafeHTML` directive to template engine** (Gap 1) — enables clean
   spotlight-search and future components that render trusted HTML.
2. **Migrate resource-viewer** — now unblocked. Can read SplitPaneState directly.
   Will eliminate several document events.
3. **Migrate activity-panel** — now unblocked. Can read SplitPaneState directly.
   Will eliminate remaining document events.
4. **Move task-detail header into task-detail** (Gap 3 from ADR 0010) — eliminates
   `HACK:CROSS_QUERY` in task-detail.
5. **Remove document event bridges** in main.ts after all components use
   `inject(SplitPaneState)` directly.
