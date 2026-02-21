# 0086. Broaden write_resource entity file protection to all entity types

**Date**: 2026-02-21
**Status**: Accepted
**Backlog Item**: TASK-0373 (child of TASK-0355)

## Context

The `write_resource` handler in `ResourceManager` guards against `create` operations on entity files to prevent frontmatter destruction. The guard uses `isTaskUri()` which matches URIs via regex `(TASK|EPIC)-\d+\.md`.

Since the substrates expansion (TASK-0255), five entity types exist: TASK, EPIC, FLDR, ARTF, MLST — all stored in the `tasks/` directory. The regex only covers two of them.

An actual incident on 2026-02-20 destroyed `ARTF-0008.md`'s frontmatter when `write_resource create` was called on it.

## Decision

Replace the prefix-based regex in `isTaskUri()` with a path-based check:

```typescript
// Before (fragile — misses ARTF, FLDR, MLST)
private isTaskUri(uri: string): boolean {
  return /^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+\.md$/.test(uri);
}

// After (future-proof — protects all files in tasks/)
private isTaskUri(uri: string): boolean {
  return uri.startsWith('mcp://backlog/tasks/');
}
```

## Alternatives Considered

1. **Expand regex to all 5 prefixes** — Same effort but fragile; adding a 6th entity type would require another regex update (same bug class).
2. **Frontmatter-aware create** — Instead of rejecting, preserve frontmatter and replace body. Over-engineered for a bug fix, introduces merge complexity and new risk.

## Consequences

- All entity files in `tasks/` are protected from `create` overwrites, regardless of prefix
- New entity types are automatically protected without code changes
- Timestamp updates via `updateTaskTimestamp` also apply to all entity types (correct behavior)
- If a non-entity file is placed in `tasks/`, it would also be protected (acceptable — `tasks/` is exclusively for entities)
