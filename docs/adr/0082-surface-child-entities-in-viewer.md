# 0082. Surface Child Entities in Viewer

**Date**: 2026-02-16
**Status**: Accepted
**Backlog Item**: TASK-0305

## Context

The backlog data model supports arbitrary parent-child nesting via `parent_id`. Any entity can be a child of any other entity. The viewer surfaces this for Epic→Task relationships (sidebar grouping, breadcrumb navigation) but not for Task→Subtask, Task→Artifact, or Task→Milestone relationships.

The `isContainer` flag in the type registry is a static property of entity types (Epic=true, Folder=true, Milestone=true, Task=false, Artifact=false). This gates all child-related UI: child count badges, enter/scope icons, and sidebar scoping. A task with children shows no indicator and provides no way to discover or navigate to those children.

Real example: TASK-0302 has ARTF-0002 (artifact) and TASK-0304 (subtask) as children, but viewing TASK-0302 in the viewer reveals nothing about these relationships.

## Problem

Users cannot discover or navigate to child entities from a parent task's card or detail view. The type-based `isContainer` flag prevents child counts from appearing on non-container types, and the detail view has no children section at all.

## Decision

Add children to the `/tasks/:id` API response and render an inline children section in the document-view component. Fix the sidebar to show child counts for all items with children, not just containers.

### Changes

1. **Backend** (`viewer-routes.ts`): Query children where `parent_id === id` and include in the `/tasks/:id` response as a `children` array.

2. **API types** (`api.ts`): Add `children?: Task[]` to `TaskResponse`.

3. **Sidebar child count** (`task-list.ts`): Remove the `isContainer` guard from child count computation — compute for all items.

4. **Sidebar badge** (`task-item.ts`): Show child count badge when `childCount > 0`, not when `isContainer`.

5. **Detail view** (`document-view.ts`): Add a children section between the header and markdown body. Each child rendered as a clickable row with type badge, title, and status.

### Alternatives Considered

**Children Panel Component with Dedicated API** (Proposal 2): Standalone component with own `/tasks/:id/children` endpoint. Rejected as premature — only one consumer exists, and the inline approach can be extracted later if reuse is needed.

**Dynamic Container Promotion** (Proposal 3): Make `isContainer` dynamic based on actual child count. Rejected as too risky — changes core navigation model with many edge cases. Right long-term direction but wrong scope for this task.

## Consequences

- Children of any entity type become visible in both the sidebar (count badge) and detail view (clickable list)
- The `/tasks/:id` response grows slightly larger (includes children array)
- The children section is embedded in document-view, not a standalone component — acceptable for now, extractable later
- No changes to the scoping/container model — tasks with children don't become scopeable containers
