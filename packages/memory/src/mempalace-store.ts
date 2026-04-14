import type { MemoryStore, MemoryEntry, RecallQuery, MemoryResult, ForgetFilter } from './types.js';

/**
 * Config for connecting to a MemPalace instance via pythonia.
 */
export interface MemPalaceStoreConfig {
  /** Path to the palace directory (default: ~/.mempalace/palace) */
  palacePath?: string;
  /** ChromaDB collection name (default: mempalace_drawers) */
  collection?: string;
}

/**
 * MemoryStore backed by MemPalace via pythonia (JSPyBridge).
 *
 * Calls MemPalace's Python functions directly — full palace structure,
 * wings, rooms, semantic search. No subprocess management, no HTTP.
 *
 * Requires:
 *   npm:  pythonia
 *   pip:  mempalace
 */
export class MemPalaceStore implements MemoryStore {
  readonly name = 'mempalace';
  private config: Required<MemPalaceStoreConfig>;
  private searcher: any;
  private miner: any;
  private py: any;

  constructor(config?: MemPalaceStoreConfig) {
    this.config = {
      palacePath: config?.palacePath ?? '~/.mempalace/palace',
      collection: config?.collection ?? 'mempalace_drawers',
    };
  }

  private async connect(): Promise<void> {
    if (this.searcher) return;

    const { python } = await import('pythonia');
    this.py = python;
    this.searcher = await python('mempalace.searcher');
    this.miner = await python('mempalace.miner');
  }

  async store(entry: MemoryEntry): Promise<void> {
    await this.connect();

    // MemPalace stores "drawers" — verbatim content with wing/room metadata.
    // Map our MemoryEntry to MemPalace's add_memory API.
    const metadata: Record<string, string> = {
      layer: entry.layer,
      source: entry.source,
    };
    if (entry.context) metadata.context = entry.context;
    if (entry.tags?.length) metadata.tags = entry.tags.join(',');
    if (entry.expiresAt) metadata.expiresAt = String(entry.expiresAt);

    await this.searcher.add_memory(
      entry.content,
      entry.id,
      metadata,
      this.config.palacePath,
    );
  }

  async recall(query: RecallQuery): Promise<MemoryResult[]> {
    await this.connect();

    const limit = query.limit ?? 10;

    // Call MemPalace's search_memories — returns semantic search results
    const raw = await this.searcher.search_memories$(query.query, {
      palace_path: this.config.palacePath,
      n_results: limit,
    });

    // Convert pythonia proxy to JS array
    const results = await raw.valueOf();
    if (!results?.length) return [];

    const now = Date.now();
    const memories: MemoryResult[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const meta = r.metadata ?? {};

      // Skip expired
      const expiresAt = meta.expiresAt ? Number(meta.expiresAt) : 0;
      if (expiresAt > 0 && expiresAt < now) continue;

      // Apply layer filter
      if (query.layers && meta.layer && !query.layers.includes(meta.layer)) continue;
      if (query.context && meta.context !== query.context) continue;

      // MemPalace returns distance — lower = more similar
      const distance = r.distance ?? 1;
      let score = 1 / (1 + distance);

      if (query.recencyWeight && query.recencyWeight > 0) {
        const createdAt = meta.createdAt ? Number(meta.createdAt) : 0;
        const ageHours = (now - createdAt) / 3_600_000;
        const recency = 1 / (1 + ageHours / 24);
        score = score * (1 - query.recencyWeight) + recency * query.recencyWeight;
      }

      memories.push({
        entry: {
          id: r.id ?? `mp-${i}`,
          content: r.document ?? '',
          layer: (meta.layer as any) ?? 'episodic',
          source: meta.source ?? 'mempalace',
          context: meta.context || undefined,
          tags: meta.tags ? meta.tags.split(',') : undefined,
          createdAt: meta.createdAt ? Number(meta.createdAt) : 0,
          expiresAt: expiresAt || undefined,
        },
        score,
      });
    }

    memories.sort((a, b) => b.score - a.score);
    return memories;
  }

  async forget(filter: ForgetFilter): Promise<number> {
    await this.connect();

    if (!filter.ids?.length) return 0;

    // MemPalace delete by IDs via ChromaDB collection
    const chromadb = await this.py('chromadb');
    const client = await chromadb.Client();
    const collection = await client.get_collection(this.config.collection);
    await collection.delete$({ ids: filter.ids });
    return filter.ids.length;
  }

  async size(): Promise<number> {
    await this.connect();

    const chromadb = await this.py('chromadb');
    const client = await chromadb.Client();
    const collection = await client.get_collection(this.config.collection);
    const count = await collection.count();
    return await count.valueOf();
  }

  /** Shut down the Python bridge. Call when done. */
  async close(): Promise<void> {
    if (this.py) this.py.exit();
  }
}
