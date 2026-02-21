# Decision: write_resource create guard

## Pre-Decision Questions

**Which proposal would I regret not doing in 6 months?**
Proposal 2. It's the same effort as Proposal 1 but eliminates the "forgot to update the regex" bug class forever. In 6 months if we add a 6th entity type, Proposal 1 would silently fail again.

**Argue FOR the most ambitious (Proposal 3):**
If it works, agents never need to learn "don't use create on task files." The footgun disappears entirely. But the complexity and risk of frontmatter merge bugs outweigh the benefit for a problem that's better solved by clear error messages.

**Real cost of playing it safe (Proposal 1)?**
The regex becomes a maintenance trap. It's one more place to update when entity types change, and the failure mode is silent data corruption — the worst kind.

## Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 5 | 3 |
| Risk | 4 | 5 | 3 |
| Testability | 5 | 5 | 4 |
| Future flexibility | 2 | 5 | 4 |
| Operational complexity | 5 | 5 | 5 |
| Blast radius | 5 | 5 | 3 |
| **Total** | **26** | **30** | **22** |

## Decision

<selected>2</selected>
<selectedname>Path-based isTaskUri using directory check instead of prefix regex</selectedname>
<rationale>Same effort as Proposal 1 (one line change) but scores 30 vs 26. The key differentiator is future flexibility (5 vs 2) — path-based check automatically protects new entity types. Proposal 3 is interesting but over-engineered for a bug fix and introduces new risk.</rationale>
<assumptions>The `tasks/` directory is exclusively for entity files managed by TaskStorage. No non-entity files should ever be placed there.</assumptions>
<tradeoffs>Less explicit about which prefixes exist (but schema.ts is the source of truth for that). If someone puts a non-entity file in tasks/, it would be protected too (acceptable — they shouldn't do that).</tradeoffs>
