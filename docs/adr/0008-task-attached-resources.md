# 0008. Task-Attached Resources

**Date**: 2026-01-23
**Status**: Accepted
**Backlog Item**: N/A (design discussion)

## Context

Users need to create ADRs, design documents, and other artifacts that are permanently associated with tasks. Currently, users can only add reference URLs to external files, which creates several problems:

1. **Orphaning**: External files can be deleted, breaking links and losing content
2. **No lifecycle management**: When tasks are archived/deleted, associated files remain scattered
3. **Discoverability**: No way to find all resources associated with a task
4. **Knowledge loss**: Important design decisions and context are lost when files disappear

### Current State

The backlog-mcp system stores tasks as flat markdown files:
- Active tasks: `~/.backlog/tasks/TASK-XXXX.md`
- Archived tasks: `~/.backlog/archive/TASK-XXXX.md`
- Task schema includes `references` field for external URLs

The system already has separate directories for different content types:
- `~/.backlog/artifacts/` - Work session outputs
- `~/.backlog/studio-engineer/` - Agent-specific work
- `~/.backlog/tasks/` - Task files

### Research Findings

The MCP server already supports multiple URI patterns:
- `mcp://backlog/tasks/TASK-XXXX/file` - Task file access
- `mcp://backlog/resources/{path}` - Repository files
- `mcp://backlog/artifacts/{path}` - Artifact files

The `write_resource` tool exists but doesn't support creating new task-attached resources.

## Proposed Solutions

### Option 1: Task-Owned Resources (Directory per Task)

**Description**: Convert tasks from flat files to directories when resources are added.

**Structure**:
```
~/.backlog/tasks/
  TASK-0042.md              # Legacy: flat file
  TASK-0043/                # New: directory
    task.md                 # Main task file
    adr-001.md              # ADR
    design.md               # Design doc
```

**URI**: `mcp://backlog/tasks/TASK-0043/resources/adr-001.md`

**Pros**:
- Strong ownership: resources live/die with task
- No orphaning possible
- Clear mental model: "this ADR belongs to this task"
- Atomic operations (move directory = move everything)

**Cons**:
- Breaking change to storage layer (file vs directory)
- Migration complexity for existing tasks
- Can't easily browse all ADRs across tasks
- Directory overhead for tasks without resources
- Storage layer built around flat files - requires fundamental rewrite

**Implementation Complexity**: HIGH

### Option 2: Separate Resources Directory with Lifecycle Management

**Description**: Keep tasks as flat files, add separate resources directory organized by task ID.

**Structure**:
```
~/.backlog/tasks/
  TASK-0042.md              # Task file (unchanged)
  TASK-0043.md              # Task file (unchanged)

~/.backlog/resources/
  TASK-0042/
    adr-001.md
    design.md
  TASK-0043/
    adr-001.md
```

**URI**: `mcp://backlog/resources/TASK-0043/adr-001.md`

**Lifecycle Management**:
- Delete task → prompt user about associated resources or auto-delete
- Add cleanup command for orphaned resources

**Note**: Archive directory was removed per ADR 0003. All tasks live in `tasks/` regardless of status.

**Pros**:
- No changes to task storage (backward compatible)
- Easy to browse all resources independently
- Scales to large numbers of resources
- Tasks remain lightweight
- Matches existing pattern (artifacts/, studio-engineer/ are separate)
- Resources can outlive tasks if desired (knowledge base)
- Simple implementation (no storage layer changes)
- No archive complexity (per ADR 0003, archive directory removed)

**Cons**:
- Need explicit lifecycle management (delete hooks)
- Potential for orphaned resources (mitigated by cleanup command)

**Implementation Complexity**: MEDIUM

### Option 3: Resource Registry with Metadata

**Description**: Standalone resources with JSON registry tracking ownership.

**Structure**:
```
~/.backlog/resources/
  adr-001-dark-mode.md
  adr-002-api-design.md
  .registry.json            # Metadata tracking
```

**Pros**:
- Resources are first-class entities
- Flexible: resources can be shared across tasks
- Rich metadata support

**Cons**:
- Registry is single point of failure
- Registry can get out of sync with filesystem
- Complex mental model (three entities: task, resource, registry)
- Overhead for simple use cases

**Implementation Complexity**: HIGH

## Decision

**Selected**: Option 2 - Separate Resources Directory with Lifecycle Management

**Rationale**: 

1. **Backward Compatibility**: No breaking changes to existing tasks or storage layer
2. **Consistency**: Matches existing pattern of separate directories (artifacts/, studio-engineer/)
3. **Simplicity**: No storage layer refactor required
4. **Flexibility**: Resources can outlive tasks if desired (knowledge base use case)
5. **Scalability**: Easy to browse all ADRs independently of tasks
6. **User Intuition**: The user who proposed this approach was correct

Option 1 was initially appealing due to "clean architecture" but is over-engineered for the problem. The high implementation cost (storage layer rewrite, migration) doesn't justify the benefits. Most tasks won't have resources, so directory overhead is wasteful.

Option 3 adds unnecessary complexity with registry management and doesn't solve any problem that Option 2 doesn't solve.

**Trade-offs Accepted**:
- Need explicit lifecycle management (delete hooks)
- Potential for orphaned resources (mitigated by cleanup command)

These trade-offs are acceptable because:
- Lifecycle hooks are straightforward to implement
- Orphaned resources can be cleaned up with a simple command

## Consequences

**Positive**:
- Users can create ADRs and design docs permanently attached to tasks
- No risk of broken links or lost content
- Resources are discoverable (browse by task or browse all)
- Knowledge base emerges naturally (all ADRs in one place)
- Zero impact on existing tasks
- Simple implementation path

**Negative**:
- Need to implement lifecycle hooks in delete operations
- Potential for orphaned resources if lifecycle hooks fail

**Risks**:
- **Risk**: Orphaned resources accumulate over time
  - **Mitigation**: Add `backlog_cleanup_orphaned_resources` command
  - **Mitigation**: Prompt user on task deletion about resources

## Implementation Notes

### API Stability

**CRITICAL**: The `write_resource` tool API must remain unchanged. It's designed to be 1:1 compatible with Kiro's native `fs_write` tool, just for MCP URIs instead of file paths.

**Current API** (unchanged):
```typescript
write_resource({
  uri: string,              // mcp:// URI
  command: 'strReplace' | 'insert',
  oldStr?: string,          // For strReplace
  newStr?: string,          // For strReplace
  content?: string,         // For insert
  insertLine?: number       // For insert (0-based, omit to append)
})
```

This API mirrors `fs_write` exactly, making it intuitive for users already familiar with file operations.

### Changes Required

1. **URI Resolution** (`src/server.ts`):
   - Update `resolveMcpUri()` to handle `resources/TASK-XXXX/` pattern
   - Map to `~/.backlog/resources/TASK-XXXX/`
   - **No changes to tool registration or API**

2. **Write Resource Support**:
   - Enable `write_resource` to create new files in `resources/TASK-XXXX/`
   - Auto-create directory if it doesn't exist
   - **Implementation detail only - API unchanged**

3. **Lifecycle Hooks** (`src/backlog.ts`):
   - `delete()`: Check for `resources/TASK-XXXX/` and prompt/delete

4. **Cleanup Command** (optional):
   - Add `backlog_cleanup_orphaned_resources` tool
   - Scan `resources/` and check if task exists
   - Report or delete orphaned directories

5. **Viewer Integration** (optional):
   - Show resources associated with task in task detail view
   - Add "Resources" section listing attached files

### Directory Structure

```
~/.backlog/
  tasks/
    TASK-0042.md
    TASK-0043.md
  resources/
    TASK-0042/
      adr-001.md
      design-proposal.md
    TASK-0043/
      adr-001.md
```

Note: Archive directory removed per ADR 0003. All tasks stored in `tasks/` regardless of status.

### URI Pattern

`mcp://backlog/resources/TASK-0042/adr-001.md`

**Design Principle**: The `write_resource` tool API is intentionally 1:1 compatible with Kiro's native `fs_write` tool. Users familiar with file operations can use the same commands, just with MCP URIs instead of file paths. This makes the tool intuitive and reduces learning curve.

**Existing URI Patterns** (for reference):
- `mcp://backlog/tasks/TASK-XXXX/file` → Task file
- `mcp://backlog/tasks/TASK-XXXX/description` → Task description only
- `mcp://backlog/resources/{path}` → Repository files
- `mcp://backlog/artifacts/{path}` → Artifact files

**New Pattern**:
- `mcp://backlog/resources/TASK-XXXX/{filename}` → Task-attached resources

### Usage Example

```typescript
// Create ADR for task
write_resource({
  uri: "mcp://backlog/resources/TASK-0042/adr-001.md",
  command: "insert",
  content: "# ADR 001: Dark Mode Implementation\n\n..."
})

// Add reference to task
backlog_update({
  id: "TASK-0042",
  references: [
    {
      url: "mcp://backlog/resources/TASK-0042/adr-001.md",
      title: "ADR 001: Dark Mode Implementation"
    }
  ]
})
```

### Edge Cases

1. **User deletes task manually**: Resources remain orphaned
   - Solution: Cleanup command detects and reports
   
2. **User wants to share resource across tasks**: 
   - Solution: Create resource under one task, reference from others via URL
   - Future: Could add symlinks or shared resources directory

3. **Resource naming conflicts**: 
   - Solution: Resources namespaced by task ID, no conflicts possible
