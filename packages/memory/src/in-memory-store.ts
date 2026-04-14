import type { MemoryStore, MemoryEntry, RecallQuery, MemoryResult, ForgetFilter } from './types.js';

/**
 * In-memory store. Zero dependencies, keyword matching.
 * Good for testing, session memory, and small datasets.
 * Swap for Orama/D1/MemPalace when you need vector search or persistence.
 */
export class InMemoryStore implements MemoryStore {
  readonly name = 'in-memory';
  private entries: MemoryEntry[] = [];

  async store(entry: MemoryEntry): Promise<void> {
    // Upsert by id
    const idx = this.entries.findIndex(e => e.id === entry.id);
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    const now = Date.now();
    const limit = query.limit ?? 10;
    const terms = query.query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored: MemoryResult[] = [];
    for (const entry of this.entries) {
      // Skip expired
      if (entry.expiresAt && entry.expiresAt < now) continue;

      // Apply filters
      if (query.layers && !query.layers.includes(entry.layer)) continue;
      if (query.context && entry.context !== query.context) continue;
      if (query.tags && !query.tags.some(t => entry.tags?.includes(t))) continue;

      // Score: fraction of query terms found in content
      const lower = entry.content.toLowerCase();
      const hits = terms.filter(t => lower.includes(t)).length;
      if (hits === 0) continue;

      let score = hits / terms.length;

      // Recency boost
      if (query.recencyWeight && query.recencyWeight > 0) {
        const ageHours = (now - entry.createdAt) / 3_600_000;
        const recency = 1 / (1 + ageHours / 24); // decay over days
        score = score * (1 - query.recencyWeight) + recency * query.recencyWeight;
      }

      scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async forget(filter: ForgetFilter): Promise<number> {
    const before = this.entries.length;
    const now = Date.now();

    this.entries = this.entries.filter(e => {
      if (filter.ids?.includes(e.id)) return false;
      if (filter.layer && e.layer === filter.layer && !filter.ids) return false;
      if (filter.context && e.context === filter.context) return false;
      if (filter.olderThan && e.createdAt < filter.olderThan) return false;
      if (filter.expired && e.expiresAt && e.expiresAt < now) return false;
      return true;
    });

    return before - this.entries.length;
  }

  async size(): Promise<number> {
    return this.entries.length;
  }
}
