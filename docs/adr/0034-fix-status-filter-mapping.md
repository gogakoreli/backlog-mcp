# 0034. Fix Status Filter Mapping

**Date**: 2026-01-28
**Status**: Accepted
**Backlog Item**: TASK-XXXX

## Context

The status filters in the web viewer (Active, Completed, All) are broken - they show incorrect results or don't work at all. Users report filters showing "0" tasks when tasks exist.

### Current State

**Frontend** (`viewer/components/task-filter-bar.ts`):
- Filter buttons: `active`, `completed`, `all`
- Dispatches `filter-change` events with these values

**Backend** (`src/server/viewer-routes.ts`):
```typescript
const statusMap: Record<string, any> = {
  active: { status: ['open', 'in_progress', 'blocked'] },
  done: { status: ['done'] },
  cancelled: { status: ['cancelled'] },
  all: {},
};
```

**The Problem**: Frontend sends `completed` but backend has no mapping for it. Backend falls back to `active` (default), causing the Completed filter to show active tasks instead of completed ones.

### Research Findings

1. **Filter mismatch**: Frontend and backend use different filter keys
2. **No count badges**: Task description mentions count badges showing "0", but no implementation exists in current code
3. **Epic context**: Filters must work correctly both at root level and inside epics (per ADR 0033)
4. **URL state**: Filter state is persisted in URL and must remain consistent

## Proposed Solutions

### Option 1: Backend Fix - Add 'completed' Mapping

**Description**: Add `completed` to backend statusMap to return both `done` and `cancelled` tasks.

**Implementation**:
```typescript
const statusMap: Record<string, any> = {
  active: { status: ['open', 'in_progress', 'blocked'] },
  completed: { status: ['done', 'cancelled'] },  // ADD THIS
  all: {},
};
```

**Pros**:
- Minimal change (1 line)
- Fixes the immediate bug
- Maintains frontend API contract
- No breaking changes
- Backward compatible (old filters still work)

**Cons**:
- Leaves unused backend filters (`done`, `cancelled`)
- Doesn't address count badges issue
- Doesn't improve UX beyond fixing the bug

**Implementation Complexity**: Low

### Option 2: Frontend Fix - Split into Granular Filters

**Description**: Change frontend to match backend's granular filters: `active`, `done`, `cancelled`, `all`.

**Implementation**:
```typescript
const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];
```

**Pros**:
- More granular control for users
- Matches backend capabilities
- Could be useful for power users

**Cons**:
- Breaking change to UX
- More buttons = more cognitive load
- Most users don't need to distinguish done vs cancelled
- Changes URL state format (breaks shared links)
- Requires migration of existing URL states

**Implementation Complexity**: Medium

### Option 3: Backend Fix + Count Badges

**Description**: Fix the filter mapping AND add count badges to filter buttons as a UX enhancement.

**Implementation**:
1. Add `completed` mapping to backend
2. Add `/api/counts` endpoint returning task counts by status
3. Update filter buttons to show counts: "Active (5)", "Completed (12)", "All (17)"
4. Fetch counts on load and update every 5 seconds

**Pros**:
- Fixes the bug
- Adds useful UX feature (see counts at a glance)
- Helps users understand task distribution
- Matches common UI patterns (Gmail, Jira, etc.)

**Cons**:
- More complex implementation
- Additional API endpoint needed
- Counts might be confusing inside epic context (show epic counts or global counts?)
- Performance consideration (counting tasks on every request)
- Increases bundle size slightly

**Implementation Complexity**: Medium-High

## Decision

**Selected**: Option 1 - Backend Fix (Add 'completed' Mapping)

**Rationale**: 

This is a **bug fix**, not a feature enhancement. The principle of minimal change applies:
- Fixes the immediate problem with 1 line of code
- No breaking changes or UX disruption
- Maintains existing API contract
- Backward compatible
- Can be deployed immediately

**Why not Option 2**: Breaking change to UX for no clear user benefit. Most users don't need to distinguish between done and cancelled - they just want to see "completed" work.

**Why not Option 3**: Count badges are a separate feature request, not part of the bug fix. The task description mentions "count badges showing 0" but there's no existing implementation - this suggests it was either:
- A planned feature that was never implemented
- A misunderstanding in the task description
- A feature that was removed

Adding count badges should be a separate task with proper product design consideration:
- Should counts be global or epic-scoped?
- Do counts add value or just clutter?
- Performance implications of counting on every request
- How do counts behave during epic navigation?

**Trade-offs Accepted**:
- Backend has unused filter mappings (`done`, `cancelled`) - acceptable technical debt
- No count badges feature - can be addressed separately if needed

## Consequences

### Positive

- **Bug fixed**: Completed filter now works correctly
- **Minimal risk**: Single line change, easy to test and verify
- **Fast deployment**: Can ship immediately
- **No migration**: Existing URLs and user workflows unchanged
- **Backward compatible**: Old filter values still work

### Negative

- **Technical debt**: Backend has unused filter mappings
- **No UX enhancement**: Doesn't add count badges (but that's a separate concern)

### Risks

- **None identified**: This is a straightforward bug fix with no known risks

## Implementation Notes

**Change required**:
```typescript
// src/server/viewer-routes.ts
const statusMap: Record<string, any> = {
  active: { status: ['open', 'in_progress', 'blocked'] },
  completed: { status: ['done', 'cancelled'] },  // ADD THIS LINE
  all: {},
};
```

**Testing**:
1. Click "Active" filter → should show open, in_progress, blocked tasks
2. Click "Completed" filter → should show done and cancelled tasks
3. Click "All" filter → should show all tasks
4. Test at root level (home page)
5. Test inside epic (epic navigation)
6. Verify URL state updates correctly
7. Verify filter state persists on page reload

**Verification**:
- Manual testing in dev environment
- Check browser network tab to confirm correct filter parameter sent
- Verify correct tasks returned from API
- Test with various task statuses in backlog

## Future Enhancements

If count badges are desired, create a separate task to:
1. Design the UX (global vs epic-scoped counts)
2. Implement `/api/counts` endpoint
3. Add count display to filter buttons
4. Consider performance optimization (caching, incremental updates)
5. Handle edge cases (counts during epic navigation)
