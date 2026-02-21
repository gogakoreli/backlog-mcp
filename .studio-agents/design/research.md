# Research: write_resource create guard — TASK-0373

## Task
`write_resource create` on entity files in `tasks/` directory destroys YAML frontmatter. The existing guard only protects TASK and EPIC prefixes, missing ARTF, FLDR, and MLST.

## Codebase Findings

### Current guard (src/resources/manager.ts:199-204)
```typescript
if (isTask && operation.type === 'create' && fileContent) {
  return { success: false, message: 'Cannot overwrite existing task file', ... };
}
```
Logic is correct — rejects `create` on existing task files. But `isTask` is too narrow.

### The bug: isTaskUri regex (line 148-150)
```typescript
private isTaskUri(uri: string): boolean {
  return /^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+\.md$/.test(uri);
}
```
Only matches `TASK-NNNN.md` and `EPIC-NNNN.md`. Five entity types exist: TASK, EPIC, FLDR, ARTF, MLST — all stored in `tasks/` directory.

### Entity types (src/storage/schema.ts)
```typescript
const TYPE_PREFIXES = { task: 'TASK', epic: 'EPIC', folder: 'FLDR', artifact: 'ARTF', milestone: 'MLST' };
const ID_PATTERN = /^(TASK|EPIC|FLDR|ARTF|MLST)-(\d{4,})$/;
```

### Test coverage
`src/__tests__/resource-manager.test.ts` has tests for `resolve()`, `read()`, `toUri()`, and round-trips. Zero tests for `write()`.

### `isTaskUri` is also used for timestamp updates (line 210)
```typescript
if (isTask) { newContent = this.updateTaskTimestamp(newContent); }
```
So broadening `isTaskUri` also correctly applies timestamp updates to all entity types.

<insight>The fix is a one-line regex change in `isTaskUri` — broaden to match all files under `tasks/` directory. This fixes both the guard AND the timestamp update for all entity types.</insight>
