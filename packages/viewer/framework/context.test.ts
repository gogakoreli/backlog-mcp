/**
 * context.test.ts — Tests for the setup context.
 * Pure logic tests — no DOM needed.
 */
import { describe, it, expect } from 'vitest';
import {
  runWithContext,
  getCurrentComponent,
  hasContext,
  type ComponentHost,
} from './context.js';

function createMockHost(element?: HTMLElement): ComponentHost {
  return {
    element: element ?? ({} as HTMLElement),
    addDisposer: () => {},
  };
}

describe('runWithContext()', () => {
  it('makes component available via getCurrentComponent()', () => {
    const host = createMockHost();
    let captured: ComponentHost | null = null;

    runWithContext(host, () => {
      captured = getCurrentComponent();
    });

    expect(captured).toBe(host);
  });

  it('restores previous context after completion', () => {
    expect(hasContext()).toBe(false);

    const host = createMockHost();
    runWithContext(host, () => {
      expect(hasContext()).toBe(true);
    });

    expect(hasContext()).toBe(false);
  });

  it('restores context even when fn throws', () => {
    const host = createMockHost();

    expect(() => {
      runWithContext(host, () => {
        throw new Error('setup error');
      });
    }).toThrow('setup error');

    expect(hasContext()).toBe(false);
  });

  it('supports nested contexts — inner sees inner component', () => {
    const outer = createMockHost();
    const inner = createMockHost();
    let capturedInner: ComponentHost | null = null;
    let capturedOuterAfter: ComponentHost | null = null;

    runWithContext(outer, () => {
      runWithContext(inner, () => {
        capturedInner = getCurrentComponent();
      });
      capturedOuterAfter = getCurrentComponent();
    });

    expect(capturedInner).toBe(inner);
    expect(capturedOuterAfter).toBe(outer);
  });
});

describe('getCurrentComponent()', () => {
  it('throws with clear error when called outside context', () => {
    expect(() => getCurrentComponent()).toThrow(
      'getCurrentComponent() called outside setup()'
    );
  });
});

describe('hasContext()', () => {
  it('returns false outside context', () => {
    expect(hasContext()).toBe(false);
  });

  it('returns true inside context', () => {
    const host = createMockHost();
    runWithContext(host, () => {
      expect(hasContext()).toBe(true);
    });
  });
});

describe('context does not leak across microtasks', () => {
  it('context is null after runWithContext completes, even if microtask runs later', async () => {
    const host = createMockHost();
    let contextInMicrotask = true;

    runWithContext(host, () => {
      // Schedule a microtask — context should NOT be available in it
      queueMicrotask(() => {
        contextInMicrotask = hasContext();
      });
    });

    // Wait for microtask to execute
    await new Promise<void>(r => queueMicrotask(r));
    expect(contextInMicrotask).toBe(false);
  });
});
