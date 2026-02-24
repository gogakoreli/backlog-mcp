/**
 * query.test.ts — Tests for declarative data loading.
 * Pure logic tests — no DOM needed (query is signal-based).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query, QueryClient } from './query.js';
import { signal, flushEffects } from './signal.js';
import { provide, resetInjector } from './injector.js';

beforeEach(() => {
  resetInjector();
});

// Helper: create a deferred promise for controlled async tests
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Basic lifecycle ─────────────────────────────────────────────────

describe('query() basic lifecycle', () => {
  it('starts with loading=true after initial effect runs', async () => {
    const d = deferred<string[]>();
    const result = query(
      () => ['tasks'],
      () => d.promise,
    );

    flushEffects();
    // After the effect runs, loading should be true
    await vi.waitFor(() => {
      expect(result.loading.value).toBe(true);
    });
    expect(result.data.value).toBeUndefined();
    expect(result.error.value).toBeNull();

    d.resolve(['task-1', 'task-2']);
    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });
    expect(result.data.value).toEqual(['task-1', 'task-2']);
    expect(result.error.value).toBeNull();
  });

  it('sets error on fetcher rejection', async () => {
    const d = deferred<string[]>();
    const result = query(
      () => ['tasks'],
      () => d.promise,
    );

    flushEffects();
    d.reject(new Error('network failure'));

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });
    expect(result.data.value).toBeUndefined();
    expect(result.error.value?.message).toBe('network failure');
  });

  it('uses initialData before first fetch resolves', async () => {
    const d = deferred<number[]>();
    const result = query(
      () => ['numbers'],
      () => d.promise,
      { initialData: [1, 2, 3] },
    );

    expect(result.data.value).toEqual([1, 2, 3]);

    d.resolve([4, 5, 6]);
    await vi.waitFor(() => {
      expect(result.data.value).toEqual([4, 5, 6]);
    });
  });
});

// ── Dependency change re-fetches ────────────────────────────────────

describe('auto-refetch on dependency change', () => {
  it('refetches when a signal in the key function changes', async () => {
    const scopeId = signal('scope-1');
    const fetcher = vi.fn(async () => [`data-for-${scopeId.value}`]);

    const result = query(
      () => ['tasks', scopeId.value],
      fetcher,
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(result.data.value).toEqual(['data-for-scope-1']);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    scopeId.value = 'scope-2';
    flushEffects();

    await vi.waitFor(() => {
      expect(result.data.value).toEqual(['data-for-scope-2']);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ── Race conditions ─────────────────────────────────────────────────

describe('race conditions', () => {
  it('discards stale responses', async () => {
    const scopeId = signal('scope-1');
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let callCount = 0;

    const fetcher = () => {
      callCount++;
      return callCount === 1 ? d1.promise : d2.promise;
    };

    const result = query(
      () => ['data', scopeId.value],
      fetcher,
    );

    flushEffects();
    // First fetch is in flight

    // Change scope before first fetch resolves
    scopeId.value = 'scope-2';
    flushEffects();
    // Second fetch starts, first should be stale

    // Resolve second fetch first
    d2.resolve('result-2');
    await vi.waitFor(() => {
      expect(result.data.value).toBe('result-2');
    });

    // Resolve first fetch (stale) — should NOT overwrite
    d1.resolve('result-1');
    await new Promise(r => setTimeout(r, 10));
    expect(result.data.value).toBe('result-2'); // still scope-2 data
  });
});

// ── enabled option ──────────────────────────────────────────────────

describe('enabled option', () => {
  it('skips fetch when enabled returns false', async () => {
    const scopeId = signal<string | null>(null);
    const fetcher = vi.fn(async () => ['data']);

    const result = query(
      () => ['tasks', scopeId.value],
      fetcher,
      { enabled: () => scopeId.value !== null },
    );

    flushEffects();
    await new Promise(r => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.loading.value).toBe(false);

    // Enable by setting scope
    scopeId.value = 'scope-1';
    flushEffects();

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Retry ───────────────────────────────────────────────────────────

describe('retry option', () => {
  it('retries failed fetches', async () => {
    let attempt = 0;
    const fetcher = async () => {
      attempt++;
      if (attempt < 3) throw new Error(`fail-${attempt}`);
      return 'success';
    };

    const result = query(
      () => ['retry-test'],
      fetcher,
      { retry: 2 },
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(result.data.value).toBe('success');
    });
    expect(attempt).toBe(3);
    expect(result.error.value).toBeNull();
  });

  it('reports error after all retries exhausted', async () => {
    const fetcher = async () => {
      throw new Error('always fails');
    };

    const result = query(
      () => ['fail-test'],
      fetcher,
      { retry: 2 },
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false);
    });
    expect(result.error.value?.message).toBe('always fails');
  });
});

// ── QueryClient ─────────────────────────────────────────────────────

describe('QueryClient', () => {
  it('invalidate() removes matching cache entries', () => {
    const client = new QueryClient();
    client.set('["tasks","1"]', 'data1', 0);
    client.set('["tasks","2"]', 'data2', 0);
    client.set('["users","1"]', 'user1', 0);

    const count = client.invalidate(['tasks']);
    expect(count).toBe(2);
    expect(client.getCached('["tasks","1"]')).toBeUndefined();
    expect(client.getCached('["users","1"]')).toBe('user1');
  });

  it('clear() removes everything', () => {
    const client = new QueryClient();
    client.set('["a"]', 1, 0);
    client.set('["b"]', 2, 0);
    client.clear();
    expect(client.getCached('["a"]')).toBeUndefined();
    expect(client.getCached('["b"]')).toBeUndefined();
  });

  it('isFresh() respects staleTime', () => {
    const client = new QueryClient();
    client.set('["x"]', 'data', 5000); // 5 second staleTime
    expect(client.isFresh('["x"]', 5000)).toBe(true);
    expect(client.isFresh('["x"]', 0)).toBe(false); // 0 = always stale
  });
});

// ── Callbacks ───────────────────────────────────────────────────────

describe('callbacks', () => {
  it('onSuccess fires after successful fetch', async () => {
    const onSuccess = vi.fn();
    const result = query(
      () => ['cb-test'],
      async () => 'hello',
      { onSuccess },
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('hello');
    });
  });

  it('onError fires after failed fetch', async () => {
    const onError = vi.fn();
    const result = query(
      () => ['cb-err-test'],
      async () => { throw new Error('fail'); },
      { onError },
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

// ── refetch() ───────────────────────────────────────────────────────

describe('refetch()', () => {
  it('manually triggers a new fetch', async () => {
    let counter = 0;
    const fetcher = async () => ++counter;

    const result = query(
      () => ['manual'],
      fetcher,
    );

    flushEffects();
    await vi.waitFor(() => {
      expect(result.data.value).toBe(1);
    });

    result.refetch();
    await vi.waitFor(() => {
      expect(result.data.value).toBe(2);
    });
  });
});
