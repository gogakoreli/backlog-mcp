# Proposal 2: Dual-State Split

<name>Dual-State Split</name>
<approach>Introduce a SidebarScope service backed by localStorage, split the `epic-navigate` event into `scope-change` (sidebar-only) and navigation via `?id=`, with auto-scoping logic that derives sidebar scope from the navigated entity.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Different data-flow — sidebar scope moves from URL to a dedicated localStorage-backed service with its own event system. Navigation and browsing become independent state channels rather than coupled URL params.</differs>

## Design

### New Module: `viewer/utils/sidebar-scope.ts`
```typescript
const STORAGE_KEY = 'backlog:sidebar-scope';

class SidebarScope {
  get(): string | null { return localStorage.getItem(STORAGE_KEY); }
  set(id: string | null) {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    document.dispatchEvent(new CustomEvent('scope-change', { detail: { scopeId: id } }));
  }
}
export const sidebarScope = new SidebarScope();
```

### url-state.ts Changes
- State: `{ filter, type, id, q }` — no more `epic`/`task`
- `get()`: reads `?id=` param. On first load, checks for legacy `?epic=&task=` and redirects.

### Event Model Changes
- `epic-navigate` → removed
- `epic-pin` → removed
- New: `scope-change` — sidebar-only, dispatched by SidebarScope service
- `task-selected` → sets `?id=` (unchanged semantics, different param)

### Auto-Scoping Logic (in backlog-app.ts)
When `?id=` changes:
- If id is a container → `sidebarScope.set(id)`
- If id is a leaf → `sidebarScope.set(getParentId(task))` (requires fetching task data)
- If id is null → `sidebarScope.set(null)` (home)

### Component Changes
- **task-item.ts**: Click body → `task-selected` (sets ?id=). Arrow click → `sidebarScope.set(id)` (scope only).
- **breadcrumb.ts**: Click → `sidebarScope.set(id)` (no URL change).
- **task-list.ts**: Reads scope from `sidebarScope.get()`, listens to `scope-change`.
- **spotlight-search.ts**: `urlState.set({ id: taskId })`.
- **task-detail.ts**: Epic link → `urlState.set({ id: epicId })`.
- **activity-panel.ts**: Links → dispatch `task-selected`.

### Backward Compatibility
In `url-state.get()`:
```
if (params.has('epic') || params.has('task')) {
  const id = params.get('task') || params.get('epic');
  // Redirect: replace URL with ?id=X
}
```

## Evaluation

- **Product design**: Fully aligned — clean permalinks, ephemeral sidebar state
- **UX design**: Improved — back button only undoes entity navigation, not sidebar drilling. Arrow vs click distinction is intuitive.
- **Architecture**: Clean separation of concerns. Two independent state channels with clear ownership.
- **Backward compatibility**: Redirect handles old URLs transparently
- **Performance**: Negligible — localStorage reads are synchronous and fast

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | ~9 files to modify, new service to create, event model rework |
| Risk | 3 | Auto-scoping logic needs careful handling of async task data |
| Testability | 4 | SidebarScope is easily unit-testable, URL redirect is straightforward |
| Future flexibility | 5 | Clean separation allows independent evolution of URL and sidebar |
| Operational complexity | 5 | No new infrastructure, localStorage is built-in |
| Blast radius | 3 | Touches all navigation paths — if broken, sidebar/detail desync |

## Pros
- Solves the actual problem completely
- Clean permalinks: `?id=TASK-0005`
- Back button works intuitively (only entity navigation)
- Sidebar scope persists across page reloads via localStorage
- Event model is cleaner (scope-change vs task-selected)
- Works uniformly for all container types

## Cons
- More files to change than Proposal 1
- Auto-scoping for leaves requires knowing the parent (async data dependency)
- Arrow vs click distinction needs clear visual affordance
- localStorage scope can get stale if task is deleted/moved
