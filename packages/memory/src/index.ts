// Types
export type {
  MemoryEntry,
  MemoryLayer,
  MemoryStore,
  MemoryResult,
  RecallQuery,
  ForgetFilter,
  ComposerConfig,
} from './types.js';

// Composer
export { MemoryComposer } from './composer.js';

// Built-in stores
export { InMemoryStore } from './in-memory-store.js';

// Optional stores (require peer deps)
export { MemPalaceStore, type MemPalaceStoreConfig } from './mempalace-store.js';
