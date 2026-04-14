// ============================================================================
// Memory Entry — what gets stored
// ============================================================================

export interface MemoryEntry {
  /** Unique ID, auto-generated if not provided */
  id: string;
  /** The content to remember */
  content: string;
  /** Which layer this belongs to */
  layer: MemoryLayer;
  /** Who created this memory (agent name, tool call, user) */
  source: string;
  /** Optional scope (task_id, epic_id, session_id) */
  context?: string;
  /** Freeform tags for filtering */
  tags?: string[];
  /** When this memory was created (epoch ms) */
  createdAt: number;
  /** When this memory expires (epoch ms), undefined = never */
  expiresAt?: number;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export type MemoryLayer = 'session' | 'episodic' | 'semantic' | 'procedural';

// ============================================================================
// Recall — how you query memories
// ============================================================================

export interface RecallQuery {
  /** Natural language or keyword query */
  query: string;
  /** Filter to specific layer(s) */
  layers?: MemoryLayer[];
  /** Scope to a context (task_id, epic_id, session_id) */
  context?: string;
  /** Filter by tags */
  tags?: string[];
  /** Max results (default: 10) */
  limit?: number;
  /** 0–1, how much to favor recent memories (default: 0) */
  recencyWeight?: number;
}

// ============================================================================
// Result — what comes back from recall
// ============================================================================

export interface MemoryResult {
  entry: MemoryEntry;
  /** Relevance score 0–1 */
  score: number;
}

// ============================================================================
// Store — the backend-agnostic plugin interface
// ============================================================================

/**
 * A MemoryStore is a backend that can store and retrieve memories.
 * Implementations: in-memory (default), Orama, D1, MemPalace, etc.
 */
export interface MemoryStore {
  readonly name: string;

  /** Store a memory entry */
  store(entry: MemoryEntry): Promise<void>;

  /** Recall relevant memories for a query */
  recall(query: RecallQuery): Promise<MemoryResult[]>;

  /** Remove memories matching criteria */
  forget(filter: ForgetFilter): Promise<number>;

  /** Count of stored memories */
  size(): Promise<number>;
}

export interface ForgetFilter {
  /** Remove by specific IDs */
  ids?: string[];
  /** Remove by layer */
  layer?: MemoryLayer;
  /** Remove by context */
  context?: string;
  /** Remove entries older than this (epoch ms) */
  olderThan?: number;
  /** Remove expired entries */
  expired?: boolean;
}

// ============================================================================
// Composer config
// ============================================================================

export interface ComposerConfig {
  /** Default limit for recall queries */
  defaultLimit?: number;
}
