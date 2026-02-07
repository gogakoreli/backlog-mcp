# 0068. Unified URL State: Single `?id=` Param with localStorage Sidebar Scope

**Date**: 2026-02-07
**Status**: Accepted
**Backlog Item**: TASK-0260

## Context

The backlog viewer uses URL query parameters `?epic=EPIC-0001&task=TASK-0005` to track both the sidebar navigation scope (which container's children are shown) and the currently viewed entity (what's in the detail pane). With the substrates model introducing folders and milestones alongside epics, this epic-centric URL model is semantically incorrect and produces noisy, non-shareable URLs that leak ephemeral sidebar browsing state.

Every sidebar drill-in/out pushes browser history via `?epic=`, making back/forward navigation frustrating. The `epic-navigate` custom event conflates "scope the sidebar" with "view this entity," making it impossible to do one without the other.

## Decision

Replace `?epic=` and `?task=` with a single `?id=` URL parameter representing the viewed entity. Move sidebar scope to a localStorage-backed `SidebarScope` service.

### URL Model
- `?id=X` is the only entity-related query param (keep `filter`, `type`, `q`)
- Represents "what the user explicitly navigated to" — a clean permalink
- If `id` is a container → sidebar auto-scopes to its children, detail shows the container
- If `id` is a leaf → detail shows it, sidebar scopes to its parent's children

### Sidebar Scope
- Stored in `localStorage` under key `backlog:sidebar-scope`
- Managed by a `SidebarScope` service that dispatches `scope-change` events
- Drilling via arrow or breadcrumb updates scope only (no URL change)
- Navigating to an entity (`?id=`) auto-derives scope from entity type

### Event Model
- `epic-navigate` → removed, replaced by:
  - `scope-change` (sidebar-only, localStorage)
  - Navigation via `task-selected` → `?id=`
- `epic-pin` → removed

### Backward Compatibility
- On page load, detect `?epic=` or `?task=` params
- Redirect to `?id=` (prefer task, fall back to epic)

## Alternatives Considered

### 1. Rename-and-Redirect
Rename `?epic=&task=` to `?id=&_scope=`, keeping scope in URL. Rejected because it doesn't solve the core problem — sidebar drilling still pollutes URL and browser history.

### 2. Centralized Navigation Router
Replace event-based navigation with a single router service owning all state transitions. Rejected as over-engineered — introduces a new architectural pattern inconsistent with the viewer's lightweight event-based model.

## Consequences

### Positive
- Clean permalinks: `?id=TASK-0005`
- Browser back/forward only affects entity navigation, not sidebar browsing
- Sidebar scope persists across page reloads via localStorage
- Works uniformly for all container types (epic, folder, milestone)
- Cleaner event model with explicit separation of concerns

### Negative
- 9 files require modification
- localStorage scope can become stale if container is deleted (resets to root)
- Arrow vs click distinction in task-item requires clear visual affordance

### Risks
- Auto-scoping for leaves requires knowing the parent (available via allTasks in task-list)
- Transition period where old bookmarked URLs need redirect support
