/**
 * query.ts — Declarative async data loading with cache
 *
 * `query()` absorbs the loading/error/cache/refetch boilerplate that
 * every data-fetching component would otherwise write manually.
 *
 * Inspired by TanStack Query / React Query, but built on signals.
 *
 * ```ts
 * const tasks = query(
 *   () => ['tasks', scopeId.value],
 *   () => api.getTasks(scopeId.value),
 * );
 * tasks.data      // Signal<Task[] | undefined>
 * tasks.loading   // Signal<boolean>
 * tasks.error     // Signal<Error | null>
 * tasks.refetch() // manual refetch
 * ```
 */

import { signal, effect, computed, type Signal, type ReadonlySignal } from './signal.js';
import { hasContext, getCurrentComponent } from './context.js';
import { inject, type Constructor } from './injector.js';

// ── Types ───────────────────────────────────────────────────────────

export interface QueryResult<T> {
  /** The resolved data, or undefined if not yet loaded */
  data: Signal<T | undefined>;
  /** True while fetching */
  loading: ReadonlySignal<boolean>;
  /** The error if the fetch failed, null otherwise */
  error: Signal<Error | null>;
  /** Manually trigger a refetch */
  refetch(): void;
}

export interface QueryOptions<T> {
  /** Cache freshness duration in ms. Default: 0 (always refetch) */
  staleTime?: number;
  /** Number of retries on failure. Default: 0 */
  retry?: number;
  /** Skip fetch when returns false. Signal reads are tracked. */
  enabled?: () => boolean;
  /** Synchronous initial value before first fetch */
  initialData?: T;
  /** Callback after successful fetch */
  onSuccess?: (data: T) => void;
  /** Callback after failed fetch */
  onError?: (error: Error) => void;
}

// ── QueryClient — global cache ──────────────────────────────────────

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
  staleTime: number;
}

/**
 * Global query cache. Managed as an auto-singleton via inject().
 * Components use query() which accesses the client internally.
 */
export class QueryClient {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();

  /** Check if a cache entry is fresh */
  isFresh(key: string, staleTime: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return Date.now() - entry.fetchedAt < staleTime;
  }

  /** Get cached data */
  getCached<T>(key: string): T | undefined {
    return this.cache.get(key)?.data as T | undefined;
  }

  /** Store data in cache */
  set(key: string, data: unknown, staleTime: number): void {
    this.cache.set(key, { data, fetchedAt: Date.now(), staleTime });
  }

  /** Get in-flight promise for deduplication */
  getInFlight(key: string): Promise<unknown> | undefined {
    return this.inFlight.get(key);
  }

  /** Register an in-flight request */
  setInFlight(key: string, promise: Promise<unknown>): void {
    // Attach a catch handler to prevent unhandled rejection on the stored promise.
    // Callers who await this promise get the original behavior from their own try/catch.
    const handled = promise.catch(() => {});
    this.inFlight.set(key, promise);
    // Clean up when done
    handled.finally(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });
  }

  /**
   * Invalidate cached entries whose key array starts with the given prefix elements.
   * Returns the number of entries invalidated.
   *
   * invalidate(['tasks']) matches ['tasks'], ['tasks', '1'], ['tasks', '2', 'x']
   */
  invalidate(keyPrefix: unknown[]): number {
    let count = 0;
    for (const [serialized] of this.cache) {
      try {
        const key = JSON.parse(serialized) as unknown[];
        if (Array.isArray(key) && keyPrefix.every((v, i) => JSON.stringify(v) === JSON.stringify(key[i]))) {
          this.cache.delete(serialized);
          count++;
        }
      } catch {
        // Skip invalid keys
      }
    }
    return count;
  }

  /** Prefetch and cache data */
  async prefetch(key: unknown[], fetcher: () => Promise<unknown>, staleTime = 0): Promise<void> {
    const serialized = serializeKey(key);
    if (this.isFresh(serialized, staleTime)) return;
    const data = await fetcher();
    this.set(serialized, data, staleTime);
  }

  /** Clear all cache */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

// ── Key serialization ───────────────────────────────────────────────

function serializeKey(key: unknown[]): string {
  return JSON.stringify(key);
}

// ── query() — the main API ──────────────────────────────────────────

/**
 * Declarative async data loading with caching and auto-refetch.
 *
 * @param keyFn - Returns a cache key array. Signal reads are auto-tracked for refetch.
 * @param fetcher - Async function that fetches the data.
 * @param options - Optional configuration (staleTime, retry, enabled, etc.)
 */
export function query<T>(
  keyFn: () => unknown[],
  fetcher: () => Promise<T>,
  options: QueryOptions<T> = {},
): QueryResult<T> {
  const {
    staleTime = 0,
    retry = 0,
    enabled,
    initialData,
    onSuccess,
    onError,
  } = options;

  const data = signal<T | undefined>(initialData);
  const loading = signal(false);
  const error = signal<Error | null>(null);

  // Get or lazily create the QueryClient
  let client: QueryClient;
  try {
    client = inject(QueryClient);
  } catch {
    // If no DI context, create a local client
    client = new QueryClient();
  }

  // Track the current fetch generation to handle race conditions
  let fetchGeneration = 0;
  let disposed = false;

  const doFetch = async () => {
    if (disposed) return;

    // Check enabled
    if (enabled && !enabled()) return;

    const key = keyFn();
    const serialized = serializeKey(key);
    const generation = ++fetchGeneration;

    // Check cache freshness
    if (staleTime > 0 && client.isFresh(serialized, staleTime)) {
      const cached = client.getCached<T>(serialized);
      if (cached !== undefined) {
        data.value = cached;
        return;
      }
    }

    // Check for in-flight deduplication
    const existing = client.getInFlight(serialized);
    if (existing) {
      loading.value = true;
      try {
        const result = await existing as T;
        if (generation === fetchGeneration && !disposed) {
          data.value = result;
          error.value = null;
        }
      } catch (e) {
        if (generation === fetchGeneration && !disposed) {
          error.value = e instanceof Error ? e : new Error(String(e));
        }
      } finally {
        if (generation === fetchGeneration && !disposed) {
          loading.value = false;
        }
      }
      return;
    }

    loading.value = true;
    error.value = null;

    let lastError: Error | null = null;
    const attempts = retry + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (disposed || generation !== fetchGeneration) return;

      const promise = fetcher();
      // Prevent unhandled rejection on the shared in-flight reference
      promise.catch(() => {});
      client.setInFlight(serialized, promise);

      try {
        const result = await promise;
        // Guard against stale responses
        if (generation === fetchGeneration && !disposed) {
          data.value = result;
          error.value = null;
          loading.value = false;
          client.set(serialized, result, staleTime);
          onSuccess?.(result);
        }
        return; // success
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        // Continue to next retry attempt
      }
    }

    // All retries exhausted
    if (generation === fetchGeneration && !disposed) {
      error.value = lastError;
      loading.value = false;
      if (lastError) onError?.(lastError);
    }
  };

  // Auto-fetch on mount and when dependencies change
  const disposeEffect = effect(() => {
    // Reading keyFn() inside the effect tracks signal dependencies
    const _key = keyFn();
    // Also track enabled()
    if (enabled) enabled();
    // Schedule the async fetch — catch to prevent unhandled promise rejection
    doFetch().catch(() => {});
  });

  // Register disposal if in component context
  if (hasContext()) {
    getCurrentComponent().addDisposer(() => {
      disposed = true;
      disposeEffect();
    });
  }

  const refetch = () => {
    fetchGeneration++; // invalidate any in-flight
    doFetch().catch(() => {});
  };

  return {
    data,
    loading: loading as ReadonlySignal<boolean>,
    error,
    refetch,
  };
}
