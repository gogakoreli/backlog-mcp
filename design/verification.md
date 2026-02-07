# Verification: Problem Understanding

## Dominant Causes — Complete?
Yes. The URL state type treating sidebar scope and viewed entity as equally URL-worthy is the root cause. This is clearly visible in the `State` type having both `epic` and `task` fields, and in `epic-navigate` setting both URL params simultaneously.

## Alternative Root Causes — Considered?
Yes. The event model conflation (`epic-navigate` doing double duty) is the secondary cause. Even if we fixed the URL model, the single event would still make it hard to scope without navigating. Both causes need addressing.

One additional alternative: the lack of a dedicated sidebar state store. Currently sidebar scope is derived entirely from URL params — there's no independent state management for "where the sidebar is browsing." This is why scope changes must go through the URL.

## "What if we're wrong" — Articulated?
Yes. If sidebar scope IS permalink-worthy, localStorage loses shareability. But `?id=CONTAINER` already implies scope, so this is a non-issue. The task spec explicitly calls sidebar scope "ephemeral."

One additional consideration: what if users rely on browser back/forward to undo sidebar drilling? Moving scope to localStorage means back button won't undo drill-in. This is actually the desired behavior per the task spec — back should undo "view entity" changes, not sidebar browsing.

## Gaps
None identified. The problem space is well-bounded:
- Input: current URL model with `?epic=&task=`
- Output: `?id=` only, sidebar scope in localStorage
- Scope: viewer-only changes, no server impact
- All affected files identified in research

<ready>YES — Problem space is fully mapped. Dominant and alternative causes are clear. Edge cases (backward compat, back button behavior, auto-scoping) are identified. Ready to propose solutions.</ready>
