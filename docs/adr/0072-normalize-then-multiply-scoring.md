# 0072. Normalize-Then-Multiply Search Scoring Architecture

**Date**: 2026-02-12
**Status**: Accepted
**Backlog Item**: TASK-0285
**Supersedes**: ADR-0051 (Multi-Signal Search Ranking) — replaces additive reranking with normalized multiplicative approach

## Problem Statement

The search ranking system has two competing scoring systems that fight each other:

1. **Orama's BM25** produces unbounded base scores across all indexed fields
2. **`rerankWithSignals()`** (ADR-0051) adds fixed-point bonuses on top

These operate at incompatible magnitudes. BM25 scores range from ~1 to 50+ depending on document content length and term density. The reranker's fixed bonuses (max ~49 points) sometimes dominate and sometimes get overwhelmed, producing unpredictable rankings.

**Concrete example**: Query "backlog mcp produc design vision" — EPIC-0002 "Backlog MCP: Product Design & Vision" (4/5 word title match) ranks below EPIC-0018 "backlog-mcp: Context Hydration" (2/5 word match) because EPIC-0018's BM25 base score from dense description content overwhelms the reranker's 16-point advantage.

Additionally, in hybrid mode (BM25 + vector), Orama internally normalizes scores to 0-1, but the reranker still adds fixed 5-49 point bonuses — meaning the reranker ALWAYS dominates in hybrid mode, the opposite problem.

## Decision

Replace the additive reranker with a two-stage normalize-then-multiply pipeline:

1. **Stage 1**: Orama BM25 (or hybrid) with increased title boost (5x, up from 2x)
2. **Normalization boundary**: Divide all scores by max score → 0-1 range
3. **Stage 2**: Multiplicative domain signals (title coverage, epic boost, recency)

### Scoring Pipeline

```
Orama BM25/hybrid → raw scores
    ↓ normalize (÷ maxScore) → 0-1
    ↓ × titleCoverageMultiplier (1.0-1.8)
    ↓ × epicMultiplier (1.0 or 1.1)
    ↓ × recencyMultiplier (1.0-1.15)
    → final scores
```

### Key Changes

**Orama configuration:**
- Title boost: 2 → 5 (let Orama handle more of the title importance)

**Normalization:**
- After Orama returns results, divide all scores by the maximum score
- This produces 0-1 scores regardless of BM25-only or hybrid mode

**Multiplicative reranker signals:**
- Title word coverage: `1.0 + (matchCount / queryWordCount) * 0.5` — up to 1.5x for perfect title match
- Title starts-with-query: additional +0.3 — up to 1.8x total
- Epic with title match: ×1.1
- Recency: ×1.0 to ×1.15 (decayed by age)

**Prefix matching for title words:**
- `tw.startsWith(qw) || qw.startsWith(tw)` instead of strict equality
- Handles truncated queries ("produc" → "product") without full Levenshtein

## Alternatives Considered

### Option 1: Boost Tuning Only
Increase title boost to 8x, add prefix matching, keep additive reranker. Rejected because it doesn't solve the fundamental magnitude problem — just shifts the threshold where BM25 overwhelms the reranker.

### Option 3: Unified Scoring via afterSearch Hook
Replace both systems with a single scoring function inside Orama's afterSearch hook. Rejected because the hook API is undocumented, synchronous-only (can't access async task metadata), and tightly couples domain logic to Orama's internals.

## Consequences

### Positive
- Score magnitudes are always compatible (0-1 base × multipliers)
- Works identically for BM25-only and hybrid modes
- New domain signals = new multiplier (composable, independent)
- Each multiplier has bounded, predictable effects
- Clean separation: Orama owns text relevance, reranker owns domain amplification

### Negative
- Golden test score thresholds need updating (scores change from 0-100+ to 0-2 range)
- Absolute scores become less meaningful (relative ranking is what matters)
- Normalization by max score means if the top result changes, all relative scores shift
- Multiplier values still need empirical tuning (but they're bounded and predictable)

### Risks
- Min-max normalization assumes the top result is a reasonable reference point. If the top result is an outlier (very high BM25), other results get compressed toward 0. Mitigation: this is unlikely for our small, homogeneous dataset.
