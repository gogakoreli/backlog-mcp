# 0030. URI Resolver Cleanup and Simplification

**Date**: 2026-01-27
**Status**: Superseded by ADR-0031
**Backlog Item**: N/A (cleanup task)

## Context

The `uri-resolver.ts` module has accumulated technical debt and conflicting logic:

1. **Duplicated URI parsing**: Both `parseURI()` (in `uri.ts`) and `resolveMcpUri()` parse task URIs
2. **Broken logic in `filePathToMcpUri()`**: Returns `null` for non-task files in data directory
3. **Leftover special cases**: Code for "repo resources" that was removed in a previous PR
4. **Inconsistent behavior**: Tasks get special treatment (extension-less URIs), other files don't

### Current State

**resolveMcpUri()** converts MCP URIs to file paths:
- `mcp://backlog/tasks/TASK-0001` → `{dataDir}/tasks/TASK-0001.md` (adds .md)
- `mcp://backlog/tasks/TASK-0001/file` → `{dataDir}/tasks/TASK-0001.md` (strips suffix)
- `mcp://backlog/tasks/TASK-0001/description` → `{dataDir}/tasks/TASK-0001.md` (strips suffix)
- `mcp://backlog/resources/test.md` → `{dataDir}/resources/test.md` (direct mapping)

**filePathToMcpUri()** converts file paths to MCP URIs:
- `{dataDir}/tasks/TASK-0001.md` → `mcp://backlog/tasks/TASK-0001` (strips .md)
- `{dataDir}/resources/test.md` → `null` ❌ (BROKEN - should return URI)
- `{repoRoot}/src/file.ts` → `mcp://backlog/resources/src/file.ts` ❌ (repo resources removed)

### Research Findings

1. **Task URI special cases ARE used**:
   - Extension-less format (`tasks/TASK-0001`) is used extensively in docs and references
   - `/description` and `/file` suffixes are used by `write_resource` tool
   - Backward compatibility is important

2. **filePathToMcpUri() is broken**:
   - Returns `null` for non-task files in data directory
   - Has leftover logic for "repo resources" that no longer exist
   - Has logic for "artifacts" outside data dir that seems unused

3. **No single source of truth**:
   - `parseURI()` in `uri.ts` parses task field URIs for write_resource
   - `resolveMcpUri()` in `uri-resolver.ts` has duplicate parsing logic
   - Both need to stay in sync manually

## Proposed Solutions

### Option 1: Keep Task Convenience, Fix filePathToMcpUri()

**Description**: Maintain current behavior for tasks (backward compatible), but fix the broken `filePathToMcpUri()` logic.

**Changes**:
```typescript
export function resolveMcpUri(uri: string): string {
  // Keep existing task special cases
  if (path.startsWith('tasks/')) {
    // Handle TASK-XXXX, TASK-XXXX/file, TASK-XXXX/description
  }
  
  // Everything else: direct mapping
  return join(dataDir, path);
}

export function filePathToMcpUri(filePath: string): string | null {
  if (!filePath.startsWith(dataDir)) return null;
  
  // Special case: strip .md from task files
  if (filePath.includes('/tasks/')) {
    const match = filePath.match(/(TASK-\d+|EPIC-\d+)\.md$/);
    if (match) return `mcp://backlog/tasks/${match[1]}`;
  }
  
  // Everything else: preserve full path with extension
  const relativePath = filePath.substring(dataDir.length + 1);
  return `mcp://backlog/${relativePath}`;
}
```

**Pros**:
- ✅ Backward compatible - no breaking changes
- ✅ Fixes broken filePathToMcpUri() for non-task files
- ✅ Removes leftover repo resource logic
- ✅ Maintains convenient task URIs

**Cons**:
- ❌ Still has special cases (inconsistent)
- ❌ Tasks treated differently than other files
- ❌ Doesn't address the "two sources of truth" problem

**Implementation Complexity**: Low

### Option 2: Pure Catch-All (Remove All Special Cases)

**Description**: Remove ALL special cases. Use literal path mapping for everything.

**Changes**:
```typescript
export function resolveMcpUri(uri: string): string {
  validateUri(uri);
  const path = extractPath(uri);
  return join(paths.backlogDataDir, path);
}

export function filePathToMcpUri(filePath: string): string | null {
  if (!filePath.startsWith(dataDir)) return null;
  const relativePath = filePath.substring(dataDir.length + 1);
  return `mcp://backlog/${relativePath}`;
}
```

**URIs become**:
- `mcp://backlog/tasks/TASK-0001.md` (must include .md)
- `mcp://backlog/resources/test.md`

**Pros**:
- ✅ Simplest possible implementation
- ✅ No magic, no surprises
- ✅ Philosophically consistent with catch-all pattern
- ✅ No special cases to maintain

**Cons**:
- ❌ BREAKING CHANGE - all existing URIs need .md extension
- ❌ Less convenient (must type .md every time)
- ❌ `/description` and `/file` suffixes stop working for reads
- ❌ Extensive documentation updates needed

**Implementation Complexity**: Low (code) / High (migration)

### Option 3: Separate Parsing from Resolution

**Description**: Split responsibilities - `parseURI()` handles semantics, `resolveMcpUri()` handles file system mapping.

**Changes**:
```typescript
// uri.ts - Enhanced semantic parsing
export interface ParsedURI {
  server: string;
  resource: string;
  taskId?: string;
  field?: 'file' | 'description';
  isTaskUri: boolean;
}

export function parseURI(uri: string): ParsedURI {
  // Single source of truth for URI semantics
}

// uri-resolver.ts - Uses parseURI
export function resolveMcpUri(uri: string): string {
  const parsed = parseURI(uri);
  
  if (parsed.isTaskUri && parsed.taskId) {
    return join(dataDir, 'tasks', `${parsed.taskId}.md`);
  }
  
  return join(dataDir, parsed.resource);
}
```

**Pros**:
- ✅ Single source of truth for URI semantics
- ✅ Clear separation of concerns
- ✅ Backward compatible
- ✅ Easier to test and maintain

**Cons**:
- ❌ Still has special cases for tasks
- ❌ More complex (two functions to coordinate)
- ❌ Doesn't fundamentally simplify the architecture

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 1 - Keep Task Convenience, Fix filePathToMcpUri()

**Rationale**:

1. **Backward compatibility is critical**: The extension-less task URI format (`mcp://backlog/tasks/TASK-0001`) is used extensively in:
   - Documentation (ADRs, README)
   - Existing references in task files
   - User workflows and scripts
   - write_resource tool semantics

2. **The special case serves a purpose**: Task URIs are semantically different from file URIs. The `/description` suffix means "edit this field", not "read this file". This is intentional API design, not accidental complexity.

3. **The real bug is filePathToMcpUri()**: The broken logic that returns `null` for non-task files is the actual problem. Fixing this resolves the immediate issue without breaking existing functionality.

4. **Option 2 is too disruptive**: While philosophically pure, the breaking change would require:
   - Updating all documentation
   - Migrating existing references
   - Retraining users
   - Potentially breaking external integrations
   
   The cost outweighs the benefit of "purity".

5. **Option 3 is over-engineering**: It adds complexity without solving the core problem. The current code works fine for tasks; it just needs the non-task path fixed.

**Trade-offs Accepted**:
- Tasks continue to have special treatment (inconsistent with pure catch-all)
- Two code paths to maintain (tasks vs non-tasks)
- Some "magic" behavior remains (extension inference)

## Consequences

**Positive**:
- ✅ No breaking changes - existing code continues to work
- ✅ Fixes broken filePathToMcpUri() for resources and artifacts
- ✅ Removes leftover repo resource logic
- ✅ Maintains convenient task URI format
- ✅ Low implementation risk

**Negative**:
- ❌ Doesn't achieve "pure" catch-all architecture
- ❌ Tasks remain special-cased
- ❌ Some philosophical inconsistency remains

**Risks**:
- **Risk**: Future confusion about why tasks are special
  - **Mitigation**: Document the rationale clearly in code comments
- **Risk**: Temptation to add more special cases
  - **Mitigation**: Establish clear rule - ONLY tasks get special treatment

## Implementation Notes

### Changes Required

1. **Fix filePathToMcpUri()**:
   - Remove repo resource logic (already removed from resource handlers)
   - Remove artifact logic (unused)
   - Add catch-all case for non-task files in data directory

2. **Clean up resolveMcpUri()**:
   - Keep task special case (no changes)
   - Remove any leftover repo resource logic
   - Simplify comments

3. **Update tests**:
   - Add tests for non-task file path → URI conversion
   - Add round-trip tests (URI → path → URI)
   - Verify task special cases still work

### Code Comments to Add

```typescript
/**
 * Task URIs get special treatment for backward compatibility and API semantics:
 * - mcp://backlog/tasks/TASK-0001 → tasks/TASK-0001.md (adds .md)
 * - mcp://backlog/tasks/TASK-0001/file → tasks/TASK-0001.md (whole file)
 * - mcp://backlog/tasks/TASK-0001/description → tasks/TASK-0001.md (field edit)
 * 
 * All other URIs use direct path mapping (catch-all pattern).
 */
```

### Testing Strategy

1. Run new comprehensive test suite
2. Verify all existing tests still pass
3. Test round-trip conversions (URI → path → URI)
4. Verify write_resource tool still works with /description URIs

### Documentation Updates

- Update code comments to explain task special case rationale
- No user-facing documentation changes needed (behavior unchanged)
