# Proposal 1: Update regex to include all entity prefixes

<name>Expand isTaskUri regex to all 5 entity prefixes</name>
<approach>Change the regex from `(TASK|EPIC)` to `(TASK|EPIC|FLDR|ARTF|MLST)` to match all entity types.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>This is a literal regex expansion — same pattern, more prefixes. Keeps the explicit allowlist approach. Contrast with Proposal 2 (path-based) and Proposal 3 (schema-driven).</differs>

## Changes
```typescript
private isTaskUri(uri: string): boolean {
  return /^mcp:\/\/backlog\/tasks\/(TASK|EPIC|FLDR|ARTF|MLST)-\d+\.md$/.test(uri);
}
```

## Evaluation
- **Product design**: Fixes the bug, aligns with "entity files are sacred" principle
- **UX design**: N/A (server-side guard)
- **Architecture**: Minimal — same pattern, just wider net
- **Backward compatibility**: No breaking changes
- **Performance**: Negligible regex change

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | One line change + tests |
| Risk | 4 | Very safe, but must remember to update regex if new entity types are added |
| Testability | 5 | Easy to test each prefix |
| Future flexibility | 2 | New entity types require manual regex update — same bug class can recur |
| Operational complexity | 5 | No operational changes |
| Blast radius | 5 | Only affects write_resource create on task URIs |

## Pros
- Smallest possible change
- Explicit — clear which prefixes are protected

## Cons
- Fragile — adding a 6th entity type requires updating this regex (same bug class)
- Duplicates the prefix list from schema.ts
