# Proposal 1: Minimal Surgical Fix

<name>source_path parameter on backlog_create</name>
<approach>Add optional `source_path` string to backlog_create's Zod schema; resolve and read file server-side in the handler before calling createTask.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>This is the most direct approach — add one parameter, add ~10 lines of resolution logic in the handler. No new files, no abstractions, no shared utilities.</differs>

## Design

Add `source_path` to the Zod input schema. In the handler, if `source_path` is provided:
1. Resolve path (absolute as-is, `~` → homedir, relative → cwd)
2. Validate file exists and is readable
3. `readFileSync` the content
4. Use it as `description`
5. Error if both `description` and `source_path` provided

All logic lives inline in `backlog-create.ts` handler.

## Evaluation

- **Product design**: Directly solves the user's pain point. Agents pass a path, server reads the file.
- **UX design**: Intuitive — `source_path` is self-explanatory. Consistent with how `path` already exists on artifacts.
- **Architecture**: Inline logic in handler. Simple but not reusable if `write_resource` or other tools need the same later.
- **Backward compatibility**: Fully backward compatible — `source_path` is optional, existing `description` usage unchanged.
- **Performance**: `readFileSync` is fine for typical artifact sizes. No streaming needed.

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~30 min implementation, minimal code change |
| Risk | 5 | Additive change, no existing behavior modified |
| Testability | 5 | Easy to test: create temp file, pass path, verify content |
| Future flexibility | 3 | Logic is inline — if other tools need it, must duplicate or extract later |
| Operational complexity | 5 | No new dependencies, no config, no deployment changes |
| Blast radius | 5 | If source_path fails, falls back to error — existing flows unaffected |

## Pros
- Smallest possible change
- No new files or abstractions
- Immediately solves the problem

## Cons
- Path resolution logic not reusable (if write_resource needs it later, must duplicate or refactor)
- No content_type auto-inference from file extension
