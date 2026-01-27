# 0010. Unified Resource Path Resolution

**Date**: 2026-01-23
**Status**: Superseded by ADR-0031
**Related**: ADR 0006, ADR 0007

## Context

After implementing MCP resource URIs (ADR 0006, 0007), we discovered unnecessary complexity in path resolution. The code treated different resource types (tasks, resources, artifacts) with separate logic, when they all follow the same directory structure under `BACKLOG_DATA_DIR`.

### Problems with Original Implementation

1. **Duplicate logic**: `uri-resolver.ts` had separate branches for `resources/`, `artifacts/`, each with its own path construction
2. **Inconsistent handling**: Task-attached resources used different logic than artifacts
3. **Duplicate operations**: `server.ts` had inline file operations duplicating `writeResource` logic
4. **Type safety issues**: Operations passed as `any` instead of proper `Operation` type

### Directory Structure Reality

```
$BACKLOG_DATA_DIR/
├── tasks/           → Task markdown files
├── resources/       → Task-attached resources (ADRs, docs)
├── artifacts/       → Research artifacts, logs
└── backlog-mcp-engineer/  → Agent work artifacts
```

Everything is just subdirectories under `BACKLOG_DATA_DIR`. No special cases needed except tasks (which need `.md` extension).

## Decision

**Simplify to uniform path resolution with one special case (tasks).**

### URI Resolver (`src/uri-resolver.ts`)

```typescript
export function resolveMcpUri(uri: string): string {
  const url = new URL(uri);
  const path = url.pathname.substring(1);
  
  if (path.includes('..')) {
    throw new Error(`Path traversal not allowed: ${uri}`);
  }
  
  const dataDir = getBacklogDataDir();
  
  // Special case: tasks/{id}/description or tasks/{id}/file → tasks/{id}.md
  if (path.startsWith('tasks/')) {
    const match = path.match(/^tasks\/([^/]+)(?:\/(description|file))?$/);
    if (match) {
      return join(dataDir, 'tasks', `${match[1]}.md`);
    }
  }
  
  // Everything else: direct mapping to dataDir/{path}
  return join(dataDir, path);
}
```

**Rules**:
- `mcp://backlog/tasks/TASK-0001` → `{dataDir}/tasks/TASK-0001.md`
- `mcp://backlog/tasks/TASK-0001/description` → `{dataDir}/tasks/TASK-0001.md` (special field)
- `mcp://backlog/resources/TASK-0001/adr.md` → `{dataDir}/resources/TASK-0001/adr.md`
- `mcp://backlog/artifacts/foo.md` → `{dataDir}/artifacts/foo.md`
- `mcp://backlog/anything/else.txt` → `{dataDir}/anything/else.txt`

### Write Resource (`src/resources/write.ts`)

Make `writeResource` handle **all** resource types:

```typescript
export function writeResource(
  params: WriteResourceParams,
  getFilePath: (taskId: string) => string | null,
  resolvePath: (uri: string) => string
): WriteResourceResult {
  const parsed = parseURI(params.uri);
  
  // Task field edits (description/file) - special handling with frontmatter
  if (parsed.taskId && parsed.field) {
    const filePath = getFilePath(parsed.taskId);
    const { data: frontmatter, content: description } = matter(readFileSync(filePath, 'utf-8'));
    
    if (parsed.field === 'description') {
      const newContent = applyOperation(description, params.operation);
      writeFileSync(filePath, matter.stringify(newContent, frontmatter), 'utf-8');
    } else {
      const newContent = applyOperation(readFileSync(filePath, 'utf-8'), params.operation);
      writeFileSync(filePath, newContent, 'utf-8');
    }
    
    return { success: true, message: `Applied ${params.operation.type}` };
  }

  // General file operations (artifacts, resources, etc.)
  const filePath = resolvePath(params.uri);
  const newContent = applyOperation(readFileSync(filePath, 'utf-8'), params.operation);
  writeFileSync(filePath, newContent, 'utf-8');
  
  return { success: true, message: `Applied ${params.operation.type}` };
}
```

### Server Tool (`src/server.ts`)

Remove duplicate file operation code, just call `writeResource`:

```typescript
server.registerTool('write_resource', schema, async ({ uri, command, oldStr, newStr, content, insertLine }) => {
  let operation: Operation;
  if (command === 'strReplace') {
    operation = { type: 'str_replace', old_str: oldStr!, new_str: newStr! };
  } else if (insertLine !== undefined) {
    operation = { type: 'insert', line: insertLine, content: content || newStr || '' };
  } else {
    operation = { type: 'append', content: content || newStr || '' };
  }
  
  const result = writeResource(
    { uri, operation },
    (taskId) => storage.getFilePath(taskId),
    (uri) => resolveMcpUri(uri)
  );
  
  if (!result.success) {
    return { content: [{ type: 'text', text: `${result.message}\n${result.error || ''}` }], isError: true };
  }
  
  return { content: [{ type: 'text', text: result.message }] };
});
```

## Benefits

1. **Less code**: ~100 lines removed from `uri-resolver.ts` and `server.ts`
2. **Single source of truth**: One path resolution function, one write function
3. **Type safety**: Proper `Operation` type instead of `any`
4. **Consistency**: All resources treated uniformly
5. **Maintainability**: Fix bugs once, not in multiple places
6. **Extensibility**: Easy to add new resource types (just create directory)

## Consequences

**Positive**:
- Simpler mental model (everything is just files under `dataDir`)
- Less code to maintain
- Easier to test
- Type-safe operations
- Consistent behavior across all resource types

**Negative**:
- None identified

**Risks**:
- None - this is pure simplification with no behavior changes

## Implementation

Changes made:
1. Simplified `resolveMcpUri()` to ~15 lines (was ~60)
2. Made `writeResource()` handle all resource types
3. Removed ~80 lines of duplicate code from `server.ts`
4. Fixed type safety (`Operation` instead of `any`)
5. Removed unused imports

All existing functionality preserved, just cleaner implementation.
