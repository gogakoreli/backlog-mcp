# Research: Unified URL State (TASK-0260)

## Current Architecture

### URL State (`url-state.ts`)
- State type: `{ filter, type, task, epic, q }`
- `epic` = which container the sidebar is scoped to
- `task` = which entity is shown in detail pane
- Both are URL query params, making URLs noisy: `?epic=EPIC-0001&task=TASK-0005`

### Event Flow (main.ts)
- `task-selected` → sets `?task=`
- `epic-navigate` → sets both `?epic=` and `?task=` to epicId
- `epic-pin` → sets `?epic=` only
- `filter-change` → sets `?filter=` and `?type=`
- `search-change` → sets `?q=`

### Component Behavior
- **backlog-app.ts**: Subscribes to urlState, passes `(filter, type, epic, task, q)` to task-list. Loads detail when `task` is set.
- **task-list.ts**: Uses `currentEpicId` from URL to filter sidebar (show container + children). Uses `selectedTaskId` for highlighting.
- **task-item.ts**: Container click → `epic-navigate` (scopes + selects). Leaf click → `task-selected`. Arrow icon exists but is not a separate click target.
- **breadcrumb.ts**: Click → `epic-navigate` (updates URL).
- **spotlight-search.ts**: Select → `urlState.set({ task: id, epic: ... })`.
- **task-detail.ts**: Epic link → `task-selected` + direct `loadTask()`.
- **activity-panel.ts**: Task links → `task-selected`. Epic links → `epic-navigate`.

### Type Registry
- Container types: `epic`, `folder`, `milestone` (isContainer: true)
- Leaf types: `task`, `artifact` (isContainer: false)
- `getParentId(item)` returns `parent_id || epic_id`

## Key Problems
1. URL conflates "what I'm viewing" with "where I'm browsing" — two separate concerns
2. Sidebar navigation (drilling in/out) pollutes URL history
3. Epic-centric naming (`?epic=`) doesn't fit the substrates model (folders, milestones)
4. URLs are not clean permalinks — they contain ephemeral sidebar state

## <insight>The fundamental change is separating navigation (URL `?id=`) from browsing (localStorage scope). When `?id=` points to a container, the sidebar auto-scopes to it. When it points to a leaf, the sidebar scopes to the leaf's parent. Arrow/breadcrumb clicks change scope independently without touching the URL.</insight>

## Files Requiring Changes
1. `viewer/utils/url-state.ts` — Replace `epic`/`task` with `id`
2. `viewer/utils/sidebar-scope.ts` — NEW: localStorage wrapper for sidebar scope
3. `viewer/main.ts` — Rewire event→URL mappings
4. `viewer/components/backlog-app.ts` — Use `id` + sidebar scope
5. `viewer/components/task-list.ts` — Read scope from localStorage
6. `viewer/components/task-item.ts` — Split click (navigate) vs arrow (scope)
7. `viewer/components/breadcrumb.ts` — Scope-only clicks
8. `viewer/components/spotlight-search.ts` — Use `?id=`
9. `viewer/components/task-detail.ts` — Epic link uses `?id=`
10. `viewer/components/activity-panel.ts` — Links use `?id=`

## Edge Cases
- Backward compat: `?epic=E&task=T` → redirect to `?id=T`
- `?epic=E` (no task) → redirect to `?id=E`
- Page reload with `?id=X` → derive sidebar scope from X's type
- Home button → clear both `?id=` and localStorage scope
- Deep link to leaf whose parent isn't loaded yet → scope to parent after tasks load
