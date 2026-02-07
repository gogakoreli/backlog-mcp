# Implementation Ready

- [x] ADR created at `docs/adr/0068-unified-url-state-single-id-param.md`
- [x] ADR log updated at `docs/adr/README.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements

<implementationplan>
1. Create `viewer/utils/sidebar-scope.ts` — localStorage wrapper + scope-change event
2. Update `viewer/utils/url-state.ts` — Replace epic/task with id, add backward compat redirect
3. Update `viewer/main.ts` — Rewire events: remove epic-navigate/epic-pin URL handlers, add scope-change handling
4. Update `viewer/components/backlog-app.ts` — Use id + sidebarScope, auto-scope logic
5. Update `viewer/components/task-list.ts` — Read scope from sidebarScope, listen to scope-change
6. Update `viewer/components/task-item.ts` — Split click (navigate) vs arrow (scope)
7. Update `viewer/components/breadcrumb.ts` — Use scope-change instead of epic-navigate
8. Update `viewer/components/spotlight-search.ts` — Use ?id= instead of ?epic=&task=
9. Update `viewer/components/task-detail.ts` — Epic link sets ?id=
10. Update `viewer/components/activity-panel.ts` — Links dispatch task-selected
11. Build and verify
</implementationplan>

<firststep>Create the SidebarScope service — it's the new primitive that other components depend on.</firststep>
