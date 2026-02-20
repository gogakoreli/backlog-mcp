# Proposal 3: Symlink / Reference-based

<name>Symlink artifacts — don't copy, link</name>
<approach>Instead of copying file content into the backlog, create a symlink or store a reference to the original file, reading content on-demand when the artifact is accessed.</approach>
<timehorizon>[ALTERNATIVE]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: No file content is copied at creation time — fundamentally different data flow. vs Proposal 2: Storage doesn't resolve content at write time; it resolves at read time. Different ownership model — the source file remains the source of truth.</differs>

## Design

When `source_path` is provided to `backlog_create`:
1. Validate the file exists
2. Store the absolute path in the `path` field
3. Create the task/artifact file with minimal frontmatter, no body
4. When the artifact is read (via `backlog_get` or resource read), resolve `path` and read content on-demand

The artifact file on disk is lightweight — just metadata. Content lives at the original location.

## Evaluation

- **Product design**: Elegant for files that change (living documents). But backlog artifacts should be snapshots — you want to capture state at a point in time, not track a moving target.
- **UX design**: Confusing — "I created an artifact but if I delete the source file, the artifact breaks?"
- **Architecture**: Adds read-time complexity. Every read path needs to check for external references. Error handling for missing/moved files.
- **Backward compatibility**: Changes read semantics — existing code expects description in the file.
- **Performance**: Slower reads (extra filesystem access), but no write-time cost.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | Need to modify all read paths, not just create |
| Risk | 2 | Broken references if source files move/delete |
| Testability | 3 | Need to test read paths with valid/invalid/missing references |
| Future flexibility | 3 | Interesting for live documents, but wrong model for snapshots |
| Operational complexity | 2 | Dangling references, debugging "why is my artifact empty?" |
| Blast radius | 2 | Affects all read paths, not just creation |

## Pros
- Zero duplication — no content copied
- Artifacts stay in sync with source (if that's desired)
- Fast creation

## Cons
- Wrong mental model — backlog artifacts should be snapshots, not live references
- Fragile — source file deletion breaks the artifact
- Complicates every read path
- Debugging nightmare for agents and users
