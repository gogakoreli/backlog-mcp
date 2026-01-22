# 0003. Remove Archive Directory - Single Source of Truth

**Date**: 2026-01-21
**Status**: Accepted

## Context

We discovered a duplicate task ID bug: TASK-0050 existed in both `tasks/` and `archive/` directories simultaneously. This happened because:

1. Tasks were stored in two directories based on status (active vs done/cancelled)
2. Files could have the same name in different directories (filesystem allows this)
3. ID generation scanned both directories, but timing issues caused collisions

### Current State

- `BacklogStorage` maintained two directories: `tasks/` and `archive/`
- `save()` moved files between directories based on status changes
- All read operations (`get`, `list`, `getAllIds`) scanned both directories
- Status was already a property on each task

### Research Findings

- Only 52 total tasks (41 active + 11 archived) - no performance justification
- Archive folder was premature optimization
- Dual-directory design added ~30 lines of complexity
- Status property already provides filtering capability
- Filesystem prevents duplicate filenames in same directory

## Proposed Solutions

### Option 1: Single Directory (Remove Archive)

**Description**: Remove archive folder entirely. Store all tasks in `tasks/` directory regardless of status.

**Pros**:
- Eliminates duplicate ID bug entirely (filesystem prevents duplicate filenames)
- Simplifies code (~30 lines removed)
- One source of truth
- No performance impact at current scale
- Status property already handles filtering
- Follows YAGNI principle

**Cons**:
- Requires one-time migration
- Potential breaking change if external tools depend on archive/
- All tasks in one directory (not actually a downside)

**Implementation Complexity**: Low

### Option 2: Keep Archive + Duplicate Prevention

**Description**: Keep two-directory structure but add explicit duplicate checking.

**Pros**:
- Prevents immediate bug
- No migration needed

**Cons**:
- Band-aid solution - doesn't fix root cause
- Adds more complexity on top of existing complexity
- Still have file moving logic
- Doesn't prevent filesystem confusion

**Implementation Complexity**: Low

### Option 3: Keep Archive + ID Registry

**Description**: Add persistent ID registry to track used IDs globally.

**Pros**:
- Guarantees uniqueness

**Cons**:
- Over-engineering
- New failure mode (registry corruption)
- Concurrency issues
- More code to maintain
- Doesn't address why we need two directories

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 1 - Single Directory

**Rationale**:

The archive folder is premature optimization that adds complexity without benefit:

1. **Scale doesn't justify it** - 52 tasks is trivial for filesystem operations
2. **Status property exists** - Already have filtering mechanism
3. **Filesystem prevents duplicates** - Can't have two files with same name in one directory
4. **Simpler code** - Removes entire class of bugs and complexity
5. **YAGNI** - We aren't gonna need archive separation

Options 2 and 3 are defensive programming around a bad design. They add complexity to preserve something that shouldn't exist.

**Trade-offs Accepted**:
- One-time migration effort (~30 minutes)
- Potential breaking change if external tools depend on archive/ (unlikely - personal tool)
- All tasks in one directory (not actually a downside)

## Consequences

**Positive**:
- Duplicate ID bug eliminated by design
- Simpler, more maintainable code
- Easier to reason about system
- Faster operations (single directory scan)
- Status-based filtering still works perfectly

**Negative**:
- One-time migration required
- Breaking change for direct filesystem access

**Risks**:
- Data loss during migration - MITIGATED by keeping archive/ directory temporarily
- External tools breaking - MITIGATED by using BacklogStorage abstraction

## Implementation Notes

### Migration

Created `scripts/migrate-archive.sh`:
- Moves all files from archive/ to tasks/
- Handles TASK-0050 collision by renaming archived version to TASK-0051
- Preserves archive/ directory for rollback safety
- Updates frontmatter IDs in renamed files

### Code Changes

Simplified `src/backlog.ts`:
- Removed `ARCHIVE_DIR` constant and `TERMINAL_STATUSES` array
- Removed `archivePath` getter
- Simplified `taskFilePath()` - no more `archived` parameter
- Simplified `get()`, `getMarkdown()`, `getFilePath()` - single directory check
- Simplified `list()` - single directory scan, sort by date only
- Simplified `save()` - no more file moving between directories
- Simplified `delete()`, `counts()`, `getAllIds()` - single directory operations

**Lines removed**: ~30
**Complexity reduced**: Significant

### Testing

All existing tests pass without modification - they use BacklogStorage abstraction.
