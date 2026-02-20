# Proposal 2: Structural Refactor

<name>Content resolver middleware</name>
<approach>Introduce a content resolution layer in storage that resolves `source_path` references at the storage level, so any tool that creates/updates entities can benefit without duplicating logic.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Resolution happens at the storage layer (CreateTaskInput), not in the tool handler. Any tool or code path that calls `createTask()` or `storage.add()` automatically gets source_path support. Different module boundary — storage owns resolution, not tools.</differs>

## Design

Extend `CreateTaskInput` with `source_path?: string`. In `createTask()` (or a pre-processing step in `storage.add()`), if `source_path` is present:
1. Resolve and read the file
2. Set `description` from file content
3. Auto-set `content_type` from file extension if not provided
4. Store the original path in `path` field for provenance

This means `backlog_create`, `backlog_update`, or any future tool that touches `CreateTaskInput` gets file resolution for free.

## Evaluation

- **Product design**: Solves the same user problem, plus enables future tools to use source_path without extra work.
- **UX design**: Same agent-facing API as Proposal 1 — `source_path` parameter.
- **Architecture**: Resolution logic lives in storage layer, closer to where data is persisted. Cleaner separation — tools don't need to know about filesystem.
- **Backward compatibility**: Fully backward compatible.
- **Performance**: Same readFileSync, no difference.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | Slightly more work — need to modify storage layer and schema |
| Risk | 4 | Touching storage layer has broader implications than a single tool handler |
| Testability | 4 | Need to test at storage level + tool level |
| Future flexibility | 5 | Any tool creating entities gets source_path for free |
| Operational complexity | 5 | No new dependencies or config |
| Blast radius | 4 | Storage layer change affects all entity creation paths |

## Pros
- Reusable across all tools and code paths
- Auto content_type inference
- Provenance tracking (original path stored)
- Clean separation — tools don't do filesystem work

## Cons
- More code to change (schema + storage + tool)
- Storage layer doing I/O (reading external files) may be a concern — it currently only reads/writes its own data directory
- Overengineered for a single parameter on one tool
