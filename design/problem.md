# Problem Articulation: Search Ranking Architecture (TASK-0285)

<core>The search ranking system has two scoring systems — Orama's BM25 and our custom reranker — that operate at incompatible score magnitudes and compete for control of result ordering. This produces unpredictable rankings where the "winner" depends on invisible factors (document length, term density) rather than actual relevance to the user's query.</core>

## Root Causes

### Dominant
1. **Additive bonuses on unbounded scores** — Fixed-point bonuses can't reliably override BM25 because they don't scale with the score distribution.
2. **Title boost too low (2x)** — Orama's own ranking doesn't prioritize title matches enough.
3. **No score normalization** — BM25-only mode: unbounded scores. Hybrid mode: 0-1 scores. Same fixed bonuses for both.

### Alternative
4. **Strict title matching in reranker** — Misses fuzzy matches that Orama found.
5. **Responsibility confusion** — Reranker handles both search concerns and domain concerns.

### What If Wrong
If BM25 is fundamentally unsuited for short-document search, tuning won't help. But evidence shows it works well for single-term queries — the problem is magnitude/coordination, not algorithmic.

<ready>YES — All three cause categories are verified with source-level evidence. The problem is well-understood: incompatible score magnitudes between an unbounded BM25 system and a fixed-point reranker, compounded by insufficient title boost and strict title matching. Ready to propose solutions.</ready>
