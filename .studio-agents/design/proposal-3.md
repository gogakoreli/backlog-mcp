# Proposal 3: Frontmatter-aware create — preserve metadata instead of rejecting

<name>Make write_resource create frontmatter-aware on entity files</name>
<approach>Instead of rejecting `create` on entity files, detect existing frontmatter and preserve/merge it — only replace the markdown body.</approach>
<timehorizon>[LONG-TERM]</timehorizon>
<effort>[MEDIUM]</effort>

<differs>vs Proposal 1: Different data-flow — instead of reject, transform the operation to preserve frontmatter; vs Proposal 2: Different interface contract — `create` becomes safe on entity files rather than forbidden.</differs>

## Changes
```typescript
// In write() method, before applyOperation:
if (isTask && operation.type === 'create' && fileContent) {
  const { data: frontmatter } = matter(fileContent);
  // Preserve frontmatter, replace only body
  operation = { type: 'create', file_text: matter.stringify(operation.file_text, frontmatter) };
}
```

## Evaluation
- **Product design**: Eliminates the "wrong tool" problem — agents can use `create` without data loss
- **UX design**: More forgiving — agents don't need to know which tool to use for which file type
- **Architecture**: More complex — `write_resource` now needs to understand frontmatter format
- **Backward compatibility**: Changes behavior of `create` on entity files (currently errors, would now succeed)
- **Performance**: Minor — extra parse/stringify on entity file creates

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | Needs gray-matter integration, edge case handling |
| Risk | 3 | Frontmatter merge logic could have subtle bugs (nested YAML, special chars) |
| Testability | 4 | Testable but more cases to cover (various frontmatter shapes) |
| Future flexibility | 4 | Eliminates the problem class entirely — no guard needed |
| Operational complexity | 5 | No operational changes |
| Blast radius | 3 | If merge logic is wrong, could corrupt frontmatter in a different way |

## Pros
- Eliminates the "wrong tool" footgun entirely
- Agents don't need to learn which operations are allowed on which URIs
- Aligns with TASK-0355's direction of unifying creation paths

## Cons
- More complex implementation
- `write_resource` gains knowledge of frontmatter format (coupling)
- Risk of subtle merge bugs
- Changes existing error behavior to success — could mask agent mistakes
