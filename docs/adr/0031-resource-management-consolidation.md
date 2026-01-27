# 0031. Resource Management Consolidation

**Date**: 2026-01-27
**Status**: Accepted
**Supersedes**: ADR-0001, ADR-0006, ADR-0007, ADR-0010, ADR-0030
**Backlog Item**: N/A (cleanup task)

## Context

Resource handling code is scattered across multiple files with duplicated logic and unnecessary complexity:

### Current Problems

1. **Scattered responsibilities**:
   - `uri-resolver.ts` - URI ↔ path conversion
   - `resource-reader.ts` - Read files, parse frontmatter
   - `uri.ts` - URI parsing for write operations
   - `data-dir.ts` - MCP resource handler registration
   - All in different locations (utils/ vs resources/)

2. **Unnecessary special cases**:
   - Tasks get extension-less URIs (`mcp://backlog/tasks/TASK-0001` → `.md` added automatically)
   - `/file` and `/description` suffixes for task field editing
   - Leftover "repo resource" logic that was removed

3. **Broken functionality**:
   - `filePathToMcpUri()` returns `null` for non-task files
   - Inconsistent behavior between tasks and other resources

4. **No dependency injection**:
   - Functions scattered across modules
   - Hard to test in isolation
   - No single point of control

### Research Findings

- The "convenience" of extension-less task URIs adds complexity without significant value
- Users can type `.md` - it's not a burden
- Special cases make the code harder to understand and maintain
- The catch-all pattern `mcp://backlog/{+path}` → `{dataDir}/{path}` is simple and sufficient

## Proposed Solutions

### Option 1: Keep Special Cases, Just Consolidate

**Description**: Move everything to a ResourceManager class but keep task special cases.

**Pros**:
- Backward compatible
- Consolidates code

**Cons**:
- Still has complexity
- Doesn't solve the fundamental problem

**Complexity**: Medium

### Option 2: Pure Catch-All + ResourceManager Singleton

**Description**: Remove ALL special cases. Implement clean ResourceManager with pure catch-all pattern.

**ResourceManager API**:
```typescript
class ResourceManager {
  resolve(uri: string): string        // URI → file path
  read(uri: string): ResourceContent  // Read resource
  toUri(filePath: string): string     // File path → URI (optional)
}
```

**Pure mapping**:
- `mcp://backlog/tasks/TASK-0001.md` → `{dataDir}/tasks/TASK-0001.md`
- `mcp://backlog/resources/test.md` → `{dataDir}/resources/test.md`
- No extension inference, no suffix stripping

**Pros**:
- Simplest possible implementation
- No magic, no surprises
- Easy to test and maintain
- Single point of responsibility
- Proper dependency injection

**Cons**:
- Breaking change (must use `.md` in URIs)
- Documentation updates needed

**Complexity**: Low (code) / Medium (migration)

## Decision

**Selected**: Option 2 - Pure Catch-All + ResourceManager Singleton

**Rationale**:

1. **Simplicity over convenience**: The complexity cost of special cases outweighs the minor convenience of extension-less URIs.

2. **Consistency**: All resources treated the same way. No "why are tasks special?" questions.

3. **Maintainability**: Future developers can understand the code in 5 minutes instead of 30.

4. **Testability**: Clean class with dependency injection is easy to test.

5. **Migration is manageable**: 
   - Update URIs in code/docs to include `.md`
   - Most URIs are already correct
   - Breaking change is localized

6. **Aligns with architecture**: The catch-all MCP resource pattern is already in place. The special cases were fighting against it.

**Trade-offs Accepted**:
- Users must type `.md` in URIs (minor inconvenience)
- One-time migration effort for existing references
- `/description` suffix for field editing no longer works for reads (write_resource has its own parsing)

## Consequences

**Positive**:
- ✅ Single source of truth for resource operations
- ✅ No special cases to remember
- ✅ Clean dependency injection
- ✅ Easy to test and maintain
- ✅ Consistent behavior across all resources
- ✅ Removes ~100 lines of complex logic

**Negative**:
- ❌ Breaking change for extension-less URIs
- ❌ Documentation updates needed
- ❌ Existing references need migration

**Risks**:
- **Risk**: Users confused by breaking change
  - **Mitigation**: Clear error messages, migration guide
- **Risk**: Missed URI references in code/docs
  - **Mitigation**: Comprehensive grep, update tests

## Implementation Notes

### New Structure

```
src/resources/
├── manager.ts          # ResourceManager class (NEW)
├── data-dir.ts         # MCP handler (uses ResourceManager)
├── write.ts            # Write operations (uses ResourceManager)
├── operations.ts       # Write operation logic
└── types.ts            # Shared types
```

### Files to Remove

- `src/utils/uri-resolver.ts` - Replaced by ResourceManager
- `src/resources/resource-reader.ts` - Merged into ResourceManager
- `src/resources/uri.ts` - Parsing logic simplified

### ResourceManager Implementation

```typescript
export class ResourceManager {
  constructor(private readonly dataDir: string) {}
  
  resolve(uri: string): string {
    // Pure catch-all: mcp://backlog/path → {dataDir}/path
    // Validates URI, prevents path traversal
  }
  
  read(uri: string): ResourceContent {
    // Reads file, parses frontmatter, detects MIME type
  }
  
  toUri(filePath: string): string | null {
    // Converts file path back to URI (for viewer)
  }
}
```

### Singleton Instance

```typescript
// src/resources/manager.ts
export const resourceManager = new ResourceManager(paths.backlogDataDir);
```

### Migration Steps

1. ✅ Implement ResourceManager with tests
2. Update `data-dir.ts` to use ResourceManager
3. Update `viewer-routes.ts` to use ResourceManager
4. Update `write.ts` to use ResourceManager
5. Remove old files (uri-resolver.ts, resource-reader.ts)
6. Update all tests
7. Update documentation (README, ADRs)
8. Search and update URI references to include `.md`

### URI Migration Examples

**Before**:
```
mcp://backlog/tasks/TASK-0001
mcp://backlog/tasks/TASK-0001/file
mcp://backlog/tasks/TASK-0001/description
```

**After**:
```
mcp://backlog/tasks/TASK-0001.md
mcp://backlog/tasks/TASK-0001.md  (same file)
mcp://backlog/tasks/TASK-0001.md  (write_resource handles field parsing)
```

### Testing Strategy

1. ✅ Comprehensive ResourceManager unit tests
2. Update existing resource tests to use new API
3. Integration tests for MCP resource handlers
4. Manual testing of viewer and write_resource tool

### Documentation Updates

- README: Update MCP resource examples
- ADRs: Update URI examples
- Code comments: Remove special case explanations
- Migration guide: Document breaking changes
