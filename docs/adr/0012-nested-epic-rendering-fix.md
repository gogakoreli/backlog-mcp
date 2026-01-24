# 0012. Fix Nested Epic Rendering in Viewer

**Date**: 2026-01-24
**Status**: Accepted
**Backlog Item**: TASK-0070

## Context

The backlog-mcp viewer UI has a hierarchy bug where nested epics (epics with `epic_id` set) appear in **two places**:
1. At the root level with all other epics
2. As children under their parent epic

This creates visual duplication and confusion about the epic hierarchy.

### Current State

The viewer's `task-list.ts` component renders tasks in a hierarchical structure:
- Epics are rendered first with their children
- Tasks without parents (orphans) are rendered after

The rendering logic (lines 99-112) works as follows:
```typescript
const epics = tasks.filter(t => (t.type ?? 'task') === 'epic');
const childTasks = tasks.filter(t => t.epic_id && epics.some(e => e.id === t.epic_id));
const orphanTasks = tasks.filter(t => (t.type ?? 'task') === 'task' && !childTasks.includes(t));

for (const epic of epics) {
  const children = childTasks.filter(t => t.epic_id === epic.id);
  grouped.push({ ...epic, childCount: children.length });
  if (!isCollapsed) {
    for (const child of children) {
      grouped.push({ ...child, isChild: true });
    }
  }
}
```

### Research Findings

**The bug**: Line 99 filters for ALL epics regardless of whether they have a parent (`epic_id`). This means:
- EPIC-0010 (no epic_id) → root epic ✅
- EPIC-0006 (epic_id: "EPIC-0010") → nested epic, but treated as root ❌

When the loop iterates:
1. EPIC-0010 is added, then its children (including EPIC-0006) are added
2. EPIC-0006 is added AGAIN as a root epic, then its children are added

Result: EPIC-0006 appears twice in the UI.

**Root cause**: The `epics` filter doesn't distinguish between root and nested epics.

## Proposed Solutions

### Option 1: Filter Root Epics at Source

**Description**: Modify line 99 to only select epics without a parent:
```typescript
const epics = tasks.filter(t => (t.type ?? 'task') === 'epic' && !t.epic_id);
```

**Pros**:
- Minimal change (add `&& !t.epic_id` to existing filter)
- Clear intent: "get root epics only"
- Filters data at the source (most efficient)
- Single pass over tasks array
- Easy to understand and maintain

**Cons**:
- None identified

**Implementation Complexity**: Low (one-line change)

### Option 2: Skip Nested Epics in Loop

**Description**: Keep line 99 as-is, but add a skip condition in the loop:
```typescript
for (const epic of epics) {
  if (epic.epic_id) continue; // Skip nested epics
  // ... rest of loop
}
```

**Pros**:
- Also a minimal change
- Achieves same visual result

**Cons**:
- Less efficient: filters ALL epics, then skips some in loop
- Wasteful: iterates over epics that immediately get skipped
- Less clear intent: why filter for all epics if we skip some?
- Violates "filter early" principle

**Implementation Complexity**: Low (one-line change)

### Option 3: Explicit Root/Nested Separation

**Description**: Create separate arrays for root and nested epics:
```typescript
const rootEpics = tasks.filter(t => (t.type ?? 'task') === 'epic' && !t.epic_id);
const nestedEpics = tasks.filter(t => (t.type ?? 'task') === 'epic' && t.epic_id);
// Use rootEpics in loop instead of epics
```

**Pros**:
- Very explicit about root vs nested distinction
- Could be useful if we need different operations on each

**Cons**:
- Over-engineered for this simple problem
- More code for no benefit
- Two passes over tasks array (less efficient)
- Adds cognitive load (more variables to track)
- We don't need separate operations on nested epics

**Implementation Complexity**: Medium (multiple changes, more code)

## Decision

**Selected**: Option 3 - Explicit Root/Nested Separation (with revised rationale)

**Rationale**: 
After implementation analysis, Option 1 and Option 2 are both **incorrect** and would break the rendering:

**Why Option 1 fails**: The `childTasks` filter depends on the `epics` array to determine valid children:
```typescript
const childTasks = tasks.filter(t => t.epic_id && epics.some(e => e.id === t.epic_id));
```
If `epics` only contains root epics, then tasks under nested epics (e.g., TASK-0001 under EPIC-0006) won't be included in `childTasks` because EPIC-0006 isn't in the `epics` array. These tasks would be lost entirely.

**Why Option 2 fails**: Skipping nested epics in the loop means their children never get rendered:
```typescript
for (const epic of epics) {
  if (epic.epic_id) continue; // Skip nested epic
  // Children of this epic never get added!
}
```
When we skip EPIC-0006, we also skip adding its children (TASK-0001), so they disappear from the UI.

**Why Option 3 is correct**: We need ALL epics for the `childTasks` filter to work, but only iterate ROOT epics in the loop:
```typescript
const epics = tasks.filter(t => (t.type ?? 'task') === 'epic'); // All epics
const rootEpics = epics.filter(e => !e.epic_id); // Only root epics
const childTasks = tasks.filter(t => t.epic_id && epics.some(e => e.id === t.epic_id)); // Uses all epics

for (const epic of rootEpics) { // Only iterate roots
  const children = childTasks.filter(t => t.epic_id === epic.id); // Gets all children including nested epics
  // Nested epics are added as children here, with their own children
}
```

This ensures:
- Nested epics are included in `childTasks` (because their parent is in `epics`)
- Nested epics are rendered as children (because they match `epic_id === epic.id`)
- Tasks under nested epics are included (because the nested epic is in `epics`)
- Nested epics are NOT rendered at root (because we only iterate `rootEpics`)

**Trade-offs Accepted**:
- Slightly more code (one extra variable)
- Two filters instead of one (minimal performance impact)
- This is the only correct solution - the "simpler" options are broken

## Consequences

**Positive**:
- Nested epics only appear under their parent (correct hierarchy)
- No visual duplication
- Clear, maintainable code
- Efficient filtering

**Negative**:
- None identified

**Risks**:
- None - this is a simple bug fix with no breaking changes
- Backward compatible: doesn't change data model or API

## Implementation Notes

- Change is in `viewer/components/task-list.ts` line 99
- The `childTasks` filter already correctly handles nested epics as children
- No changes needed to child rendering logic
- Test with multi-level epic nesting (epic → epic → task)
