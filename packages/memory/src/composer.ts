import type {
  MemoryStore,
  MemoryEntry,
  MemoryLayer,
  RecallQuery,
  MemoryResult,
  ForgetFilter,
  ComposerConfig,
} from './types.js';

/**
 * Orchestrates multiple MemoryStore backends.
 * Routes entries to the right store by layer, merges recall results.
 */
export class MemoryComposer {
  private stores = new Map<MemoryLayer, MemoryStore>();
  private defaultLimit: number;

  constructor(config?: ComposerConfig) {
    this.defaultLimit = config?.defaultLimit ?? 10;
  }

  /** Register a store for a specific memory layer */
  register(layer: MemoryLayer, store: MemoryStore): void {
    this.stores.set(layer, store);
  }

  /** Store a memory, routed to the store registered for its layer */
  async store(entry: MemoryEntry): Promise<void> {
    const store = this.stores.get(entry.layer);
    if (!store) throw new Error(`No store registered for layer: ${entry.layer}`);
    await store.store(entry);
  }

  /** Recall across targeted stores, merge and rank results */
  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    const limit = query.limit ?? this.defaultLimit;
    const targets = query.layers
      ? query.layers.map(l => this.stores.get(l)).filter(Boolean) as MemoryStore[]
      : [...this.stores.values()];

    if (targets.length === 0) return [];

    const resultSets = await Promise.all(
      targets.map(store => store.recall({ ...query, limit })),
    );

    // Merge, dedupe by entry.id, sort by score descending
    const seen = new Set<string>();
    const merged: MemoryResult[] = [];
    for (const results of resultSets) {
      for (const r of results) {
        if (!seen.has(r.entry.id)) {
          seen.add(r.entry.id);
          merged.push(r);
        }
      }
    }

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit);
  }

  /** Forget across all stores (or targeted layers) */
  async forget(filter: ForgetFilter): Promise<number> {
    const targets = filter.layer
      ? [this.stores.get(filter.layer)].filter(Boolean) as MemoryStore[]
      : [...this.stores.values()];

    const counts = await Promise.all(targets.map(s => s.forget(filter)));
    return counts.reduce((sum, n) => sum + n, 0);
  }

  /** Get registered store names by layer */
  registered(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [layer, store] of this.stores) out[layer] = store.name;
    return out;
  }
}
