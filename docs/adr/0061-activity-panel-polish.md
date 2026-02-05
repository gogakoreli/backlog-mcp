# 0061. Activity Panel Polish and Code Quality

**Date**: 2026-02-05
**Status**: Accepted
**Backlog Item**: TASK-0196

## Problem Statement

The Activity Panel accumulated technical debt during rapid iteration: non-null assertions in production code, inconsistent styling, missing features (sort, task-scoped header), and a backend gap where `write_resource` doesn't update task timestamps.

## Changes Made

### Code Quality Fixes
- Removed non-null assertions (`!`) from `getTodayKey()`, `getYesterdayKey()`, `groupByDay()`, `groupByTask()`, and `groupByEpic()`
- Changed `DEFAULT_VISIBLE_ITEMS` from 5 to 2 for more compact task groups

### CSS/Styling Fixes
- Changed `activity-badge` from red alert style to neutral gray (informative, not alarming)
- Improved `activity-day-separator` with solid background and shadow for better visual distinction
- Added consistent color and hover state to `activity-epic-link`
- Removed duplicate CSS definitions

### Feature Additions
- Added sort dropdown to `task-filter-bar` with options: Updated (default), Created (newest), Created (oldest)
- Sort preference persisted in localStorage
- Added `epicTitle` to `TaskGroup` interface for richer display
- Unified `renderCompletedSection` and `renderJournalSection` - all journal sections now use epic grouping
- Added task-scoped activity filter header with clear button

### Backend Fix
- `write_resource` now automatically updates `updated_at` timestamp when modifying task files (`mcp://backlog/tasks/*.md`)

## Deferred

- **In-memory task cache** (Issue #5): Deferred as premature optimization. No evidence of performance problems with current disk-based approach.

## Implementation Notes

- Sort is applied client-side after fetching tasks
- Task file detection uses regex: `/^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+\.md$/`
- Filter clear dispatches `activity-clear-filter` event handled by main.ts
