/**
 * injector.test.ts — Tests for dependency injection.
 * Pure logic tests — no DOM needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  inject,
  provide,
  createToken,
  resetInjector,
  type Constructor,
} from './injector.js';
import { runWithContext, type ComponentHost } from './context.js';

// Reset between every test to ensure isolation
beforeEach(() => {
  resetInjector();
});

// ── Test services ───────────────────────────────────────────────────

class ServiceA {
  name = 'ServiceA';
}

class ServiceB {
  name = 'ServiceB';
  a: ServiceA;
  constructor() {
    this.a = inject(ServiceA);
  }
}

class BrokenService {
  constructor() {
    throw new Error('construction failed');
  }
}

// ── inject() ────────────────────────────────────────────────────────

describe('inject()', () => {
  it('creates singleton on first call', () => {
    const instance = inject(ServiceA);
    expect(instance).toBeInstanceOf(ServiceA);
    expect(instance.name).toBe('ServiceA');
  });

  it('returns same instance on subsequent calls (singleton)', () => {
    const first = inject(ServiceA);
    const second = inject(ServiceA);
    expect(first).toBe(second);
  });

  it('different classes get different singletons', () => {
    const a = inject(ServiceA);
    const b = inject(ServiceB);
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(ServiceA);
    expect(b).toBeInstanceOf(ServiceB);
  });

  it('service constructor can inject() other services', () => {
    const b = inject(ServiceB);
    expect(b.a).toBeInstanceOf(ServiceA);
    expect(b.a).toBe(inject(ServiceA)); // same singleton
  });

  it('works both inside and outside component context', () => {
    // Outside context
    const outside = inject(ServiceA);

    // Inside context
    const host: ComponentHost = {
      element: {} as HTMLElement,
      addDisposer: () => {},
    };
    let inside: ServiceA | null = null;
    runWithContext(host, () => {
      inside = inject(ServiceA);
    });

    expect(outside).toBe(inside); // same singleton
  });

  it('throws on circular dependency', () => {
    class CircularA {
      constructor() { inject(CircularB); }
    }
    class CircularB {
      constructor() { inject(CircularA); }
    }

    expect(() => inject(CircularA)).toThrow('Circular dependency');
  });

  it('surfaces constructor errors clearly — does not cache broken instance', () => {
    expect(() => inject(BrokenService)).toThrow('construction failed');

    // Should not have cached a broken instance
    expect(() => inject(BrokenService)).toThrow('construction failed');
  });
});

// ── provide() ───────────────────────────────────────────────────────

describe('provide()', () => {
  it('overrides the default constructor with a factory', () => {
    class MockA extends ServiceA {
      name = 'MockA';
    }
    provide(ServiceA, () => new MockA());

    const instance = inject(ServiceA);
    expect(instance.name).toBe('MockA');
    expect(instance).toBeInstanceOf(MockA);
  });

  it('override is used for all subsequent inject() calls', () => {
    provide(ServiceA, () => {
      const mock = new ServiceA();
      mock.name = 'overridden';
      return mock;
    });

    const first = inject(ServiceA);
    const second = inject(ServiceA);
    expect(first).toBe(second);
    expect(first.name).toBe('overridden');
  });

  it('provide() after inject() replaces the cached singleton', () => {
    const original = inject(ServiceA);
    expect(original.name).toBe('ServiceA');

    provide(ServiceA, () => {
      const mock = new ServiceA();
      mock.name = 'replaced';
      return mock;
    });

    const replaced = inject(ServiceA);
    expect(replaced.name).toBe('replaced');
    expect(replaced).not.toBe(original);
  });
});

// ── createToken() ───────────────────────────────────────────────────

describe('createToken()', () => {
  it('works with provide() + inject()', () => {
    const AppConfig = createToken<{ apiUrl: string }>('AppConfig');
    provide(AppConfig, () => ({ apiUrl: '/api' }));

    const config = inject(AppConfig);
    expect(config.apiUrl).toBe('/api');
  });

  it('throws if no provider and no default factory', () => {
    const Missing = createToken<string>('Missing');
    expect(() => inject(Missing)).toThrow("No provider found for token 'Missing'");
  });

  it('uses default factory if no provide() override', () => {
    const Config = createToken('Config', () => ({ debug: true }));
    const instance = inject(Config);
    expect(instance.debug).toBe(true);
  });

  it('provide() overrides default factory', () => {
    const Config = createToken('Config', () => ({ debug: true }));
    provide(Config, () => ({ debug: false }));
    const instance = inject(Config);
    expect(instance.debug).toBe(false);
  });

  it('token instances are singletons', () => {
    const Config = createToken('Config', () => ({ debug: true }));
    const first = inject(Config);
    const second = inject(Config);
    expect(first).toBe(second);
  });
});

// ── resetInjector() ─────────────────────────────────────────────────

describe('resetInjector()', () => {
  it('clears singleton cache — next inject() creates new instance', () => {
    const first = inject(ServiceA);
    resetInjector();
    const second = inject(ServiceA);
    expect(first).not.toBe(second);
  });

  it('clears factory overrides', () => {
    provide(ServiceA, () => {
      const mock = new ServiceA();
      mock.name = 'mock';
      return mock;
    });
    resetInjector();

    const instance = inject(ServiceA);
    expect(instance.name).toBe('ServiceA'); // back to default
  });
});
