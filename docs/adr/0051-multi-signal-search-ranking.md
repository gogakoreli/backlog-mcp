# 0051. Multi-Signal Search Ranking

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0165

## Problem Statement

Search ranking is broken despite TASK-0162's title bonus fix. When searching "backlog", EPIC-0002 "Backlog MCP" ranks #6 instead of #1-2. The +10 title bonus doesn't differentiate because ALL top results have title matches.

## Problem Space

### Why This Problem Exists

ADR-0050 added a +10 bonus for title matches, but this doesn't help when multiple results have title matches. The problem isn't "title matches don't rank high" - they do. The problem is differentiating BETWEEN title matches.

Current ranking for "backlog":
1. TASK-0024 "Display blocked_reason in backlog-web UI" - 100%
2. TASK-0163 "Evaluate Algolia vs Orama for backlog-mcp search" - 98%
...
6. EPIC-0002 "Backlog MCP: Product Design & Vision" - 97%

All have "backlog" in title, all get +10 bonus, BM25 term frequency determines final order.

### Who Is Affected

- Users searching for topics in Spotlight
- Users expecting epics (containers) to rank above tasks
- Users expecting recently touched items to be more relevant

### Problem Boundaries

**In scope**: Ranking algorithm, UI match display
**Out of scope**: Personalization, saved searches, filters in Spotlight

### Adjacent Problems

1. UI shows confusing "N matches" - users don't understand what this means
2. No indication of WHY something matched (title vs description)

### Problem-Space Map

**Dominant causes:**
- All top results have title matches, so +10 bonus doesn't differentiate
- No secondary ranking signals (recency, type importance)
- BM25 term frequency in descriptions overwhelms title bonus

**Alternative root causes:**
- Title match quality not considered (exact word vs substring)
- Recency not factored in at all
- Epic vs task distinction ignored

**What if we're wrong:**
- Users might want different things: relevance vs importance vs recency
- Maybe we need multiple sort modes, not a single ranking algorithm

## Context

### Current State

- Orama search with BM25 algorithm
- `rerankWithTitleBonus()` adds +10 for exact word match, +3 for partial
- No recency signal (updated_at not used)
- No type importance (epics vs tasks treated equally)
- UI shows "N matches" which is confusing

### Research Findings

1. **Title bonus is insufficient**: When ALL top results have title matches, +10 doesn't differentiate
2. **Recency data available**: `updated_at` field exists on all tasks
3. **Type data available**: `type` field distinguishes epics from tasks
4. **UI confusion**: "4 matches" is meaningless to users

### Prior Art

ADR-0050 attempted to fix this with title bonus alone - insufficient.

## Proposed Solutions

### Option 1: Weighted Multi-Signal Scoring `[SHORT-TERM]` `[MEDIUM]`

**Description**: Add recency and type importance as additive bonuses to the existing re-ranking function.

```typescript
finalScore = bm25Score + titleBonus + typeBonus + recencyBonus
```

Where:
- titleBonus: +10 exact word, +3 partial (existing)
- typeBonus: +15 for epics
- recencyBonus: 0-10 based on days since update

**Differs from others by**:
- vs Option 2: Single scoring function, not tiered buckets
- vs Option 3: Additive bonuses, not multiplicative weights

**Pros**:
- Minimal code change (~30 lines)
- Easy to tune individual bonus values
- Preserves BM25 relevance as base

**Cons**:
- Bonus values are arbitrary, need tuning
- May not guarantee epics rank first (depends on BM25 scores)

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | ~2-3 hours |
| Risk | 4 | Low risk, additive bonuses are predictable |
| Testability | 5 | Easy to test each bonus independently |
| Future flexibility | 4 | Can add more bonus signals easily |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Only affects ranking order |

### Option 2: Tiered Bucket Ranking `[SHORT-TERM]` `[LOW]`

**Description**: Sort results into buckets by match quality, then sort within buckets by type and recency.

Buckets:
1. Query IS the title or title STARTS WITH query
2. Query word appears as standalone word in title
3. Query appears as substring in title
4. Query only in description

Within each tier: Sort by type (epic > task) then recency.

**Differs from others by**:
- vs Option 1: Discrete buckets, not continuous scores
- vs Option 3: Ignores BM25 scores entirely within tiers

**Pros**:
- Guarantees title matches rank above description matches
- Predictable, deterministic ranking

**Cons**:
- Loses BM25 nuance within tiers
- May rank irrelevant epic above highly relevant task
- Bucket boundaries are arbitrary

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~1-2 hours |
| Risk | 3 | Loses BM25 nuance |
| Testability | 5 | Easy to test bucket assignment |
| Future flexibility | 2 | Rigid buckets hard to extend |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Could rank irrelevant items high |

### Option 3: Multiplicative Signal Weighting `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Multiply BM25 score by signal multipliers.

```typescript
finalScore = bm25Score * titleMultiplier * typeMultiplier * recencyMultiplier
```

**Differs from others by**:
- vs Option 1: Multiplicative, not additive
- vs Option 2: Continuous scores, not discrete buckets

**Pros**:
- Preserves BM25 relative ordering
- Signals compound

**Cons**:
- Multiplier values need careful tuning
- Can create extreme score differences
- Harder to reason about final scores

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 3 | ~3-4 hours |
| Risk | 3 | Multipliers can create extreme scores |
| Testability | 4 | Harder to predict final scores |
| Future flexibility | 4 | Can add more multipliers |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Extreme scores could surprise users |

## Decision

**Selected**: Option 1 - Weighted Multi-Signal Scoring

**Rationale**:
- Additive bonuses are predictable and easy to tune
- Can make bonus values large enough to override BM25 differences
- Easy to explain: "epics get +15, recent items get +10"
- Minimal code change, extends existing `rerankWithTitleBonus`

**For this decision to be correct, the following must be true**:
- Users primarily want title matches to rank high
- Epics are more important than tasks for the same query
- Recent items are more relevant than old items
- Bonus values (+15 epic, +10 title, +10 recency) are large enough to override BM25 differences

**Trade-offs Accepted**:
- Bonus values are somewhat arbitrary (can tune based on feedback)
- Recency decay thresholds are arbitrary (1/7/30/90 days)
- May occasionally rank less relevant epic above more relevant task

## Consequences

**Positive**:
- EPIC-0002 will rank #1-2 for "backlog" search
- Epics rank above tasks for same query
- Recently updated items get ranking boost
- UI no longer shows confusing "N matches"

**Negative**:
- Additional post-processing step (negligible performance impact)
- Bonus values may need tuning based on user feedback

**Risks**:
- Bonus values may not be optimal for all queries (mitigation: make configurable later)

## Implementation Notes

### Ranking Changes

1. Rename `rerankWithTitleBonus` to `rerankWithSignals`
2. Add title-starts-with bonus: +20 (strongest signal)
3. Add multi-word match bonus: +8 per additional query word matched in title
4. Add epic bonus: +5 only when epic has title match (prevents epics from ranking above tasks when they only match in description)
5. Add recency bonus with decay:
   ```typescript
   function getRecencyBonus(updatedAt: string): number {
     const daysSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
     if (daysSinceUpdate < 1) return 5;    // Today
     if (daysSinceUpdate < 7) return 3;    // This week
     if (daysSinceUpdate < 30) return 2;   // This month
     if (daysSinceUpdate < 90) return 1;   // This quarter
     return 0;                              // Older
   }
   ```

### Final Bonus Values

```typescript
const RANKING_BONUS = {
  TITLE_STARTS_WITH: 20,      // Title starts with query (strongest)
  TITLE_EXACT_WORD: 10,       // Query word in title
  TITLE_PARTIAL: 3,           // Query substring in title
  MULTI_WORD_MATCH: 8,        // Per additional query word in title
  EPIC_WITH_TITLE_MATCH: 5,   // Epic bonus (only with title match)
  RECENCY_TODAY: 5,
  RECENCY_WEEK: 3,
  RECENCY_MONTH: 2,
  RECENCY_QUARTER: 1,
};
```

### UI Changes

1. Remove "N matches" display from spotlight-search.ts
2. Change field display from "title" to "Matched in title"

### Golden Tests

1. "backlog" → EPIC-0001 ranks high (title starts with query)
2. "search" → EPIC-0002 ranks above TASK-0005 (epic with title match)
3. "Spotlight search UI" → TASK-0001 ranks first (multi-word match bonus)
