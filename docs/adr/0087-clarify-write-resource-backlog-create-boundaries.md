# 0087. Remove create from write_resource — all creation through backlog_create

**Date**: 2026-02-21
**Status**: Accepted
**Backlog Item**: TASK-0355

## Context

The backlog MCP server had two tools that could create files:
- `backlog_create` — creates entities (TASK, EPIC, FLDR, ARTF, MLST) with auto-generated IDs and YAML frontmatter
- `write_resource create` — created raw files without IDs or frontmatter

This overlap confused agents about which tool to use and led to data corruption (TASK-0373) when agents used `write_resource create` on entity files.

## Decision

Remove the `create` operation from `write_resource` entirely. All file creation goes through `backlog_create`. `write_resource` becomes an edit-only tool (`str_replace`, `insert`, `append`).

This means:
- Resource files (ADRs, design docs) are now created as ARTF entities via `backlog_create`
- Every file in the backlog has an ID, frontmatter, and is tracked
- `write_resource` only operates on existing files

## Alternatives Considered

1. **Keep both tools with better descriptions** — Fixes perception but maintains the architectural split where some files are tracked entities and others are untracked. Rejected: user decision to unify all creation.
2. **Guard-only approach** — Block `create` on entity files but allow on resource files. Rejected: still leaves untracked files in the system.

## Consequences

- **Breaking change**: Agents using `write_resource create` for resource files must switch to `backlog_create type:artifact`
- All files in the backlog are now entities with IDs and metadata — no more "plain" resource files
- Simpler mental model: `backlog_create` creates, `write_resource` edits
- `write_resource` no longer mirrors the `fs_write` API (which has `create`)
- The `CreateOperation` type is removed from the codebase
