# Problem Articulation: Unified URL State (TASK-0260)

## What are we solving?

<core>The viewer's URL model conflates two independent concerns — "what entity the user is viewing" and "which container the sidebar is browsing inside" — into a single URL, producing noisy, non-shareable permalinks and coupling ephemeral sidebar navigation to browser history.</core>

## Why does this problem exist?

The original viewer was epic-centric: you'd pick an epic, then pick a task within it. The URL naturally encoded both: `?epic=EPIC-0001&task=TASK-0005`. This worked when epics were the only container type.

With the substrates model (epics, folders, milestones), the `?epic=` param is semantically wrong for non-epic containers. More fundamentally, sidebar drilling (entering/exiting sub-containers) pushes URL state on every click, polluting browser history with ephemeral navigation that users don't want to share or bookmark.

## Root Causes

<dominant>The URL state type treats sidebar scope (`epic`) and viewed entity (`task`) as equally important URL-worthy state, when only the viewed entity is permalink-worthy.</dominant>

<alternative>The event model uses a single `epic-navigate` event for both "scope the sidebar" and "view this entity", making it impossible to do one without the other.</alternative>

## Constraints

- Backward compatibility: existing `?epic=&task=` URLs must redirect cleanly
- Filter params (`filter`, `type`, `q`) stay in URL — they're intentional state
- No server-side changes needed — this is purely a viewer concern
- Must work with all container types (epic, folder, milestone)
- Page reload must restore both viewed entity and sidebar context

## <whatifwrong>What if our understanding is wrong?</whatifwrong>

If sidebar scope IS permalink-worthy (users want to share "I'm browsing inside folder X"), then putting it in localStorage loses that capability. However, the task spec explicitly says sidebar scope is ephemeral, and the `?id=` of a container already implies its scope. So sharing `?id=FLDR-0001` gives the recipient the same view.

## Adjacent Problems

1. **Event naming**: `epic-navigate` is epic-specific naming that doesn't fit the substrates model. This task naturally renames it to `scope-change`.
2. **Auto-scoping on navigation**: When `?id=` changes to a leaf, the sidebar needs to know the leaf's parent to scope correctly. This requires the sidebar to have access to task data (parent_id) — currently it does via `allTasks`.

## ADR Draft: Problem Statement

### Context
The backlog viewer uses URL query parameters `?epic=` and `?task=` to track both sidebar navigation scope and the currently viewed entity. With the introduction of the substrates model (folders, milestones alongside epics), this epic-centric URL model is semantically incorrect and produces noisy URLs that leak ephemeral sidebar state.

### Problem
1. URLs contain sidebar browsing state (`?epic=`) that is not permalink-worthy
2. Every sidebar drill-in/out pushes browser history, making back/forward navigation frustrating
3. The `?epic=` parameter name is wrong for folder and milestone containers
4. The `epic-navigate` event conflates "scope sidebar" with "view entity"

### Decision Drivers
- Clean, shareable permalinks (`?id=TASK-0005`)
- Sidebar browsing should not pollute URL or browser history
- Must support all container types uniformly
- Backward compatibility with existing URLs
