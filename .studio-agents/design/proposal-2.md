# Proposal 2: Path-based guard — protect the entire tasks/ directory

<name>Path-based isTaskUri using directory check instead of prefix regex</name>
<approach>Replace the entity-prefix regex with a simple path check: any URI under `mcp://backlog/tasks/` is a task URI.</approach>
<timehorizon>[MEDIUM-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>vs Proposal 1: Different interface contract — instead of an allowlist of known prefixes, this uses directory-level ownership. The `tasks/` directory IS the boundary, not the filename pattern. No regex duplication, no update needed for new entity types.</differs>

## Changes
```typescript
private isTaskUri(uri: string): boolean {
  return uri.startsWith('mcp://backlog/tasks/');
}
```

## Evaluation
- **Product design**: Aligns with the architectural rule that `tasks/` is exclusively for entity files
- **UX design**: N/A
- **Architecture**: Cleaner — directory is the boundary, not filename patterns. Follows convention-over-configuration
- **Backward compatibility**: No breaking changes. All current entity URIs start with `mcp://backlog/tasks/`
- **Performance**: Faster than regex (string prefix check)

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | One line change + tests |
| Risk | 5 | Simpler logic = fewer edge cases |
| Testability | 5 | Easy to test with any URI |
| Future flexibility | 5 | New entity types automatically protected — no code changes needed |
| Operational complexity | 5 | No operational changes |
| Blast radius | 5 | Only affects write_resource create on task URIs |

## Pros
- Future-proof — new entity types automatically protected
- Simpler code — no regex, no prefix duplication
- Faster — string prefix check vs regex match
- Matches the architectural invariant: `tasks/` = entity files

## Cons
- Less explicit — doesn't document which prefixes exist (but schema.ts does that)
- If someone ever puts a non-entity file in `tasks/`, it would be protected too (but that shouldn't happen)
