# 0010. Migration Phase 12 — system-info-modal, task-detail, and Remaining Gaps

**Date**: 2026-02-10
**Status**: Active
**Depends on**: [0009-framework-defense-in-depth](./0009-framework-defense-in-depth.md), [0007-shared-services-and-each](./0007-shared-services-and-each.md)

## Context

Phase 12 migrated `system-info-modal` and `task-detail` to the reactive framework.
Both components now use `component()`, `signal()`, `computed()`, `effect()`,
`query()`, `each()`, `when()`, and factory composition. This ADR documents the
migration decisions, remaining hacks, and architectural gaps discovered.

## Components Migrated

### system-info-modal

**Before**: Class-based, `open()`/`close()` methods called imperatively from
backlog-app via `querySelector`.

**After**: Reactive component reading `AppState.isSystemInfoOpen` signal. Data
loaded via `query()` with `enabled` guard (only fetches when modal is open).
CopyButton used via factory composition. Escape key handled via `onMount`
lifecycle hook.

**AppState addition**: `isSystemInfoOpen: Signal<boolean>` — controls modal
visibility. backlog-app sets `app.isSystemInfoOpen.value = true` instead of
calling `modal?.open()`.

**Hacks removed**:
- `HACK:EXPOSE` in copy-button for system-info-modal's `.text` setter — no longer
  needed, system-info-modal now uses `CopyButton({ text: dataDir })` factory.

### task-detail

**Before**: Class-based, `loadTask(id)` called imperatively from backlog-app via
a bridging `effect()` (`HACK:CROSS_QUERY`). Created `resource-viewer` element
imperatively and delegated rendering to it.

**After**: Reactive component reading `AppState.selectedTaskId`. Data loaded via
`query()` with `enabled` guard. Task metadata rendered inline (no resource-viewer
dependency). Markdown content rendered via `md-block` directly. References,
evidence, and blocked reasons rendered via `each()` list composition. Epic link
navigation uses `AppState.selectTask()`.

**Hacks removed**:
- `HACK:CROSS_QUERY` bridge effect in backlog-app — task-detail now reads
  `AppState.selectedTaskId` directly.

**Hacks retained**:
- `HACK:CROSS_QUERY` in task-detail — pane header (`#task-pane-header`) lives
  outside task-detail's DOM tree, updated via `effect()` with `innerHTML`.
- `HACK:DOC_EVENT` in task-detail — `activity-open` event dispatched on
  `document` for unmigrated activity-panel.
- `HACK:EXPOSE` in copy-button — still needed for pane header and split-pane.
- `HACK:MOUNT_APPEND` in copy-button — still needed for pane header and split-pane.

## Remaining Framework/Architecture Gaps

### Gap 1: Pane Header Cross-Tree Ownership (HIGH)

**Problem**: The task pane header (`#task-pane-header`) is rendered by backlog-app
but populated by task-detail. This creates a cross-tree DOM manipulation pattern
that can't be expressed in the framework's template system.

**Current workaround**: task-detail uses `document.getElementById('task-pane-header')`
inside an `effect()` and sets `innerHTML` with copy-button, task-badge, svg-icon
elements. These elements still need `HACK:EXPOSE` attribute bridges.

**Impact**: Prevents removing `HACK:EXPOSE` from copy-button and svg-icon.
Prevents removing `HACK:MOUNT_APPEND` from copy-button.

**Proposed solution**: Two options:
1. **Move header into task-detail**: task-detail owns its header as part of its
   template. Requires CSS layout adjustment (header currently positioned as sibling
   of `pane-content`, not inside it).
2. **Header content service**: A `DetailHeaderState` service with signals for
   title, badges, actions. backlog-app reads these to render the header
   reactively. task-detail writes to the service when task data changes.

**Recommendation**: Option 1 (move header into task-detail) is simpler and
eliminates the cross-tree pattern entirely. The CSS adjustment is straightforward:
make the pane header a slot-like area that task-detail can fill.

### Gap 2: Split-Pane Imperative Component Creation (HIGH)

**Problem**: `split-pane.ts` creates `resource-viewer` and `activity-panel` via
`document.createElement()` and calls imperative methods (`.loadResource()`,
`.loadMcpResource()`, `.setTaskId()`, `.setShowHeader()`, `.setMetadataRenderer()`).
This pattern is fundamentally incompatible with the `component()` factory model.

**Current state**: resource-viewer and activity-panel are NOT migrated because
split-pane can't use factory composition (it operates outside any framework
component's setup context).

**Impact**: Blocks migration of resource-viewer and activity-panel. Forces
retention of class-based patterns in both components.

**Proposed solutions**:
1. **Migrate split-pane to framework**: Make split-pane a framework component (or
   integrate its logic into backlog-app's template). Resource and activity content
   would be rendered via `when()` / computed views instead of imperative
   `createElement()`.
2. **Split-pane state service**: Extract split-pane state into a `SplitPaneState`
   service with signals (e.g., `activePane: Signal<'resource' | 'activity' | null>`,
   `resourceUri: Signal<string | null>`, `activityTaskId: Signal<string | null>`).
   backlog-app reads these signals to render the right pane reactively.

**Recommendation**: Option 2 (state service) is the better long-term design. It
follows the same pattern as AppState and keeps the reactive data flow consistent.
The right pane content would be determined by signals, not imperative method calls.

### Gap 3: Spotlight Search Imperative Open/Close (MEDIUM)

**Problem**: `spotlight-search` open/close is triggered imperatively from
backlog-app via `querySelector('spotlight-search').open()`. This is a
`HACK:CROSS_QUERY` that blocks spotlight-search migration.

**Proposed solution**: Add `isSpotlightOpen: Signal<boolean>` to AppState (same
pattern as `isSystemInfoOpen`). spotlight-search reads the signal to show/hide.
backlog-app sets `app.isSpotlightOpen.value = true` on trigger.

### Gap 4: Activity Panel Document Events (MEDIUM)

**Problem**: Multiple document-level custom events coordinate activity panel
behavior: `activity-open`, `activity-close`, `activity-clear-filter`. These are
dispatched by task-detail (for open) and activity-panel (for clear-filter), and
listened to by main.ts which delegates to split-pane.

**Current state**: Will persist until split-pane is refactored (Gap 2) and
activity-panel is migrated.

**Proposed solution**: Part of the Split-Pane State Service (Gap 2). Once
split-pane state is reactive, these events become signal writes:
- `activity-open` → `splitPaneState.activePane.value = 'activity'`
- `activity-close` → `splitPaneState.activePane.value = null`
- `activity-clear-filter` → `splitPaneState.activityTaskId.value = null`

### Gap 5: Resource Viewer metadataRenderer Callback Pattern (LOW)

**Problem**: resource-viewer accepts a `setMetadataRenderer(fn)` callback that
returns an HTMLElement for custom metadata rendering. This imperative callback
pattern doesn't fit the reactive template model.

**Current state**: task-detail no longer uses resource-viewer (renders metadata
inline). Only split-pane creates resource-viewer, and it doesn't use custom
metadata renderers. This gap may be moot.

**Proposed solution**: If resource-viewer is migrated, use props/slots for
metadata customization instead of callbacks. Or, since task-detail now renders
its own metadata, resource-viewer can be simplified to only handle raw file
content display.

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
| 9 | backlog-app | ✅ Done (Phase 11) | `HACK:CROSS_QUERY` (spotlight) |
| 10 | **system-info-modal** | ✅ **Done (Phase 12)** | **None** |
| 11 | **task-detail** | ✅ **Done (Phase 12)** | **`HACK:CROSS_QUERY` (header), `HACK:DOC_EVENT`** |
| 12 | spotlight-search | ❌ Pending | Gap 3 blocks clean migration |
| 13 | resource-viewer | ❌ Pending | Gap 2 blocks migration |
| 14 | activity-panel | ❌ Pending | Gap 2 blocks migration |

### Summary: 11/14 components migrated (3 pending, 1 skipped)

## Recommended Next Steps

1. **Resolve Gap 2** (Split-Pane State Service) — this is the critical path.
   It unblocks resource-viewer and activity-panel migration and eliminates
   most remaining document events.
2. **Resolve Gap 3** (spotlight open/close signal) — quick win, unblocks
   spotlight-search migration.
3. **Resolve Gap 1** (pane header ownership) — move header into task-detail
   to eliminate last `HACK:CROSS_QUERY` in the component.
4. **Migrate remaining 3 components** after gaps are resolved.
5. **Remove all HACK tags** after final component migrations.
