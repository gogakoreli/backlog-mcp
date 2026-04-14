import type { Tokenizer } from '@orama/orama';

/**
 * Split a word on camelCase/PascalCase boundaries.
 * "FeatureStore" → ["Feature", "Store"]
 * "getHTTPResponse" → ["get", "HTTP", "Response"]
 * "simple" → ["simple"] (no split)
 */
export function splitCamelCase(word: string): string[] {
  // Insert boundary marker between lowercase→uppercase and acronym→word transitions
  return word
    .replace(/([a-z\d])([A-Z])/g, '$1\0$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
    .split('\0')
    .filter(Boolean);
}

/**
 * Custom tokenizer that expands compound words (hyphens + camelCase).
 * "FeatureStore" → ["featurestore", "feature", "store"]
 * "keyboard-first" → ["keyboard-first", "keyboard", "first"]
 */
export const compoundWordTokenizer: Tokenizer = {
  language: 'english',
  normalizationCache: new Map(),
  tokenize(input: string): string[] {
    if (typeof input !== 'string') return [];
    // Split on non-alphanumeric (keeping hyphens/apostrophes) BEFORE lowercasing
    const rawTokens = input.split(/[^a-zA-Z0-9'-]+/).filter(Boolean);
    const expanded: string[] = [];
    for (const raw of rawTokens) {
      const lower = raw.toLowerCase();
      expanded.push(lower);
      // Expand hyphens: "keyboard-first" → + ["keyboard", "first"]
      if (raw.includes('-')) {
        expanded.push(...lower.split(/-+/).filter(Boolean));
      }
      // Expand camelCase: "FeatureStore" → + ["feature", "store"]
      const camelParts = splitCamelCase(raw);
      if (camelParts.length > 1) {
        for (const part of camelParts) {
          expanded.push(part.toLowerCase());
        }
      }
    }
    return [...new Set(expanded)];
  },
};
