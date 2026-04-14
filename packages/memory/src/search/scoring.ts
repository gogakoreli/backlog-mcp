/**
 * Linear fusion scoring module (ADR-0081).
 *
 * Replaces the shadow scoring system (rerankWithSignals, normalizeScores,
 * getRecencyMultiplier) with independent retriever fusion.
 *
 * Architecture:
 *   BM25 hits → MinMax normalize → ┐
 *                                    ├→ weighted linear combination → post-fusion modifiers → ranked results
 *   Vector hits → MinMax normalize → ┘
 *
 * All functions are pure and independently testable without an Orama instance.
 */

import { compoundWordTokenizer } from './tokenizer.js';

/** A scored hit from a single retriever. */
export interface ScoredHit {
  id: string;
  score: number;
}

/** Default fusion weights: text-heavy for a backlog system where exact term matches matter. */
export const DEFAULT_WEIGHTS = { text: 0.7, vector: 0.3 } as const;

/**
 * MinMax normalize scores to [0,1] range per-retriever.
 *
 * Preserves relative score differences within a retriever while mapping
 * to a common scale for fusion. Handles edge cases:
 * - Empty array → empty array
 * - Single result → score 1.0 (it's the best and only result)
 * - All same score → all get 1.0 (equally relevant)
 */
export function minmaxNormalize(hits: ScoredHit[]): ScoredHit[] {
  if (hits.length === 0) return [];
  const scores = hits.map(h => h.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return hits.map(h => ({ ...h, score: 1.0 }));
  return hits.map(h => ({ ...h, score: (h.score - min) / range }));
}

/**
 * Linear fusion: weighted combination of normalized retriever scores (ADR-0081).
 *
 * For each document, computes:
 *   score = w_text * norm_bm25 + w_vector * norm_vector
 *
 * Documents appearing in only one retriever get 0 for the missing retriever's
 * contribution. This naturally handles BM25-only fallback when embeddings
 * are unavailable (vector hits empty → pure BM25 ranking).
 *
 * @param bm25Hits - MinMax-normalized BM25 retriever results
 * @param vectorHits - MinMax-normalized vector retriever results (empty if unavailable)
 * @param weights - Fusion weights (default: 0.7 text, 0.3 vector)
 * @returns Fused and sorted results
 */
export function linearFusion(
  bm25Hits: ScoredHit[],
  vectorHits: ScoredHit[],
  weights: { text: number; vector: number } = DEFAULT_WEIGHTS,
): ScoredHit[] {
  const scores = new Map<string, number>();

  for (const hit of bm25Hits) {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + weights.text * hit.score);
  }
  for (const hit of vectorHits) {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + weights.vector * hit.score);
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Post-fusion coordination bonus for multi-term queries (ADR-0081).
 *
 * In OR mode (tolerance=1), BM25 returns documents matching ANY query term.
 * A single "feature" in a boosted title field can outscore "feature"+"store"
 * in description. This modifier rewards documents matching ALL query terms,
 * which is a standard IR coordination factor (Lucene had coord() for years).
 *
 * Title coordination gets extra weight: if all query terms appear in the title,
 * the document gets a larger bonus than body-only matches. This ensures
 * "backlog mcp" → EPIC-0002 ("Backlog MCP: Product Design & Vision") ranks
 * above tasks that merely mention "backlog" and "mcp" in references.
 *
 * @param hits - Fused results with scores
 * @param query - Original search query
 * @param getText - Function to retrieve full searchable text for a document ID
 * @param getTitle - Function to retrieve title for a document ID
 * @returns Re-scored results, sorted by adjusted score
 */
export function applyCoordinationBonus(
  hits: ScoredHit[],
  query: string,
  getText: (id: string) => string,
  getTitle?: (id: string) => string,
): ScoredHit[] {
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (queryWords.length <= 1) return hits;

  return hits
    .map(h => {
      // Tokenize the document text the same way Orama does, so compound words
      // like "FeatureStore" expand to ["featurestore", "feature", "store"]
      const bodyTokens = new Set(compoundWordTokenizer.tokenize(getText(h.id)));
      const bodyMatchCount = queryWords.filter(w => bodyTokens.has(w)).length;
      const bodyCoord = bodyMatchCount / queryWords.length;

      // Title coordination: extra bonus when query terms match in the title
      let titleBonus = 0;
      if (getTitle) {
        const titleTokens = new Set(compoundWordTokenizer.tokenize(getTitle(h.id)));
        const titleMatchCount = queryWords.filter(w => titleTokens.has(w)).length;
        titleBonus = (titleMatchCount / queryWords.length) * 0.3;
      }

      // Body coordination (0.5 max) + title coordination (0.3 max)
      return { ...h, score: h.score + bodyCoord * 0.5 + titleBonus };
    })
    .sort((a, b) => b.score - a.score);
}
