/**
 * invariants.test.ts — Tests for framework invariants identified during ADR review.
 *
 * These tests encode the hard invariants that must hold across the framework.
 * Each test references the specific gap or invariant it verifies.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { component } from './component.js';
import {
  signal,
  computed,
  effect,
  flushEffects,
  isSignal,
  untrack,
} from './signal.js';
import { html, when, type TemplateResult } from './template.js';
import { inject, provide, resetInjector } from './injector.js';
import { Emitter } from './emitter.js';
import { runWithContext, getCurrentComponent, hasContext, type ComponentHost } from './context.js';
import { ref } from './ref.js';
import { onMount, onCleanup } from './lifecycle.js';

beforeEach(() => {
  resetInjector();
  document.body.innerHTML = '';
});

let tagCounter = 0;
function uniqueTag(prefix = 'inv'): string {
  return `${prefix}-${++tagCounter}-${Date.now()}`;
}

function mount(result: TemplateResult): HTMLElement {
  const host = document.createElement('div');
  result.mount(host);
  return host;
}

// ═══════════════════════════════════════════════════════════════════════
// GAP 1 (P0): Effect auto-disposal in component context
// ADR 0002 Gap 1, ADR 0003 Gap 5
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: effect() auto-disposes in component context', () => {
  it('effects created during setup are disposed on disconnect', () => {
    const tag = uniqueTag('eff-dispose');
    const count = signal(0);
    const values: number[] = [];

    component(tag, () => {
      effect(() => {
        values.push(count.value);
      });
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);
    expect(values).toEqual([0]);

    // Signal change triggers effect
    count.value = 1;
    flushEffects();
    expect(values).toEqual([0, 1]);

    // Remove element — effects should be disposed
    document.body.removeChild(el);

    // Signal change should NOT trigger effect
    count.value = 2;
    flushEffects();
    expect(values).toEqual([0, 1]); // no 2 — effect was disposed
  });

  it('multiple effects in setup are all auto-disposed', () => {
    const tag = uniqueTag('eff-multi');
    const a = signal(0);
    const b = signal(0);
    const aValues: number[] = [];
    const bValues: number[] = [];

    component(tag, () => {
      effect(() => { aValues.push(a.value); });
      effect(() => { bValues.push(b.value); });
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);
    expect(aValues).toEqual([0]);
    expect(bValues).toEqual([0]);

    document.body.removeChild(el);

    a.value = 1;
    b.value = 1;
    flushEffects();
    expect(aValues).toEqual([0]); // disposed
    expect(bValues).toEqual([0]); // disposed
  });

  it('effects outside component context are NOT auto-disposed', () => {
    const count = signal(0);
    const values: number[] = [];

    const dispose = effect(() => {
      values.push(count.value);
    });
    expect(values).toEqual([0]);

    count.value = 1;
    flushEffects();
    expect(values).toEqual([0, 1]); // still alive — no component context

    dispose(); // manual dispose needed
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GAP 2: when() reactivity with signal conditions
// ADR 0002 Gap 3
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: when() is reactive with signal conditions', () => {
  it('shows/hides content reactively when signal changes', () => {
    const show = signal(true);
    const template = when(show, html`<span class="toggle">visible</span>`);
    const result = html`<div>${template}</div>`;
    const host = mount(result);

    expect(host.querySelector('.toggle')).not.toBeNull();
    expect(host.querySelector('.toggle')?.textContent).toBe('visible');

    // Toggle off
    show.value = false;
    flushEffects();
    expect(host.querySelector('.toggle')).toBeNull();

    // Toggle back on
    show.value = true;
    flushEffects();
    expect(host.querySelector('.toggle')).not.toBeNull();
  });

  it('supports lazy callback form for expensive branches', () => {
    const show = signal(false);
    let evalCount = 0;
    const template = when(show, () => {
      evalCount++;
      return html`<span>expensive</span>`;
    });
    const result = html`<div>${template}</div>`;
    mount(result);

    // Template function not called when condition is false
    expect(evalCount).toBe(0);

    show.value = true;
    flushEffects();
    expect(evalCount).toBe(1);
  });

  it('static condition still works (non-signal)', () => {
    const truthy = html`<div>${when(true, html`<span>yes</span>`)}</div>`;
    const falsy = html`<div>${when(false, html`<span>no</span>`)}</div>`;

    const hostT = mount(truthy);
    const hostF = mount(falsy);

    expect(hostT.querySelector('span')?.textContent).toBe('yes');
    expect(hostF.querySelector('span')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: XSS safety — text bindings use textNode.data
// ADR 0004 Gap 6
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: XSS safety in text bindings', () => {
  it('user input in text binding renders as text, not HTML', () => {
    const userInput = signal('<img onerror=alert(1)>');
    const result = html`<span>${userInput}</span>`;
    const host = mount(result);

    // Should be visible as text, NOT parsed as an HTML element
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img onerror=alert(1)>');
  });

  it('script tags in text binding are not executed', () => {
    const xss = signal('<script>window.__xss = true</script>');
    const result = html`<div>${xss}</div>`;
    const host = mount(result);

    expect(host.querySelector('script')).toBeNull();
    expect((window as any).__xss).toBeUndefined();
  });

  it('HTML entities in dynamic text are not double-encoded', () => {
    const text = signal('A & B < C');
    const result = html`<span>${text}</span>`;
    const host = mount(result);

    expect(host.querySelector('span')?.textContent).toBe('A & B < C');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Cleanup errors are swallowed
// ADR 0002 — error boundaries
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: cleanup errors are swallowed', () => {
  it('effect cleanup error does not prevent next execution', () => {
    const count = signal(0);
    const values: number[] = [];

    effect(() => {
      values.push(count.value);
      return () => {
        if (count.value === 1) throw new Error('cleanup boom');
      };
    });
    expect(values).toEqual([0]);

    count.value = 1;
    flushEffects();
    expect(values).toEqual([0, 1]);

    // The cleanup for value=1 throws, but the effect should still run
    count.value = 2;
    flushEffects();
    expect(values).toEqual([0, 1, 2]);
  });

  it('disposal cleanup error does not prevent other disposers from running', () => {
    const tag = uniqueTag('cleanup-swallow');
    const afterBroken = vi.fn();

    component(tag, () => {
      onCleanup(() => { throw new Error('broken cleanup'); });
      onCleanup(afterBroken);
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);
    document.body.removeChild(el);

    // The second disposer should still run even though the first threw
    expect(afterBroken).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Error boundaries — sibling isolation
// ADR 0002 — component.ts error boundaries
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: error boundaries isolate components', () => {
  it('setup error in one component does not affect siblings', () => {
    const goodTag = uniqueTag('good');
    const badTag = uniqueTag('bad');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    component(goodTag, () => html`<span class="ok">works</span>`);
    component(badTag, () => { throw new Error('setup crash'); });

    const good = document.createElement(goodTag);
    const bad = document.createElement(badTag);
    document.body.appendChild(good);
    document.body.appendChild(bad);

    expect(good.querySelector('.ok')?.textContent).toBe('works');
    expect(bad.innerHTML).toContain('Error in');
    errorSpy.mockRestore();
  });

  it('effect error is logged but effect stays alive', () => {
    const count = signal(0);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const values: number[] = [];

    effect(() => {
      const v = count.value;
      if (v === 1) throw new Error('temp failure');
      values.push(v);
    });
    expect(values).toEqual([0]);

    count.value = 1; // throws
    flushEffects();
    expect(errorSpy).toHaveBeenCalled();

    count.value = 2; // should still work — effect not disposed
    flushEffects();
    expect(values).toEqual([0, 2]);
    errorSpy.mockRestore();
  });

  it('event handler error is caught and logged', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = html`<button @click="${() => { throw new Error('click boom'); }}">Click</button>`;
    const host = mount(result);

    expect(() => host.querySelector('button')?.click()).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Event handler error'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Singleton identity — inject(A) === inject(A) always
// ADR 0002 — injector.ts invariant 1
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: DI singleton identity', () => {
  it('inject() returns identical instance across all call sites', () => {
    class SharedState { data = 'shared'; }

    const a = inject(SharedState);
    const b = inject(SharedState);
    const c = inject(SharedState);

    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('failed construction is never cached — retry is possible', () => {
    let attempt = 0;
    class FlakeyService {
      constructor() {
        attempt++;
        if (attempt < 3) throw new Error(`fail-${attempt}`);
      }
    }

    expect(() => inject(FlakeyService)).toThrow('fail-1');
    expect(() => inject(FlakeyService)).toThrow('fail-2');
    // Third attempt succeeds
    const instance = inject(FlakeyService);
    expect(instance).toBeInstanceOf(FlakeyService);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Context is synchronous-only
// ADR 0002 — context.ts invariant 1
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: context is strictly synchronous', () => {
  it('context is gone after async boundary', async () => {
    const host: ComponentHost = {
      element: {} as HTMLElement,
      addDisposer: () => {},
    };

    let contextInSync = false;
    let contextAfterMicrotask = false;

    runWithContext(host, () => {
      contextInSync = hasContext();
      queueMicrotask(() => {
        contextAfterMicrotask = hasContext();
      });
    });

    expect(contextInSync).toBe(true);

    await new Promise(r => queueMicrotask(r));
    expect(contextAfterMicrotask).toBe(false);
  });

  it('nested contexts restore correctly', () => {
    const host1: ComponentHost = {
      element: document.createElement('div'),
      addDisposer: () => {},
    };
    const host2: ComponentHost = {
      element: document.createElement('span'),
      addDisposer: () => {},
    };

    let innerHost: HTMLElement | null = null;
    let outerHostAfter: HTMLElement | null = null;

    runWithContext(host1, () => {
      runWithContext(host2, () => {
        innerHost = getCurrentComponent().element;
      });
      outerHostAfter = getCurrentComponent().element;
    });

    expect(innerHost?.tagName).toBe('SPAN');
    expect(outerHostAfter?.tagName).toBe('DIV');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Signal equality uses Object.is()
// ADR 0002 — signal.ts invariant 2
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: Object.is() equality semantics', () => {
  it('NaN does not trigger infinite updates', () => {
    const s = signal(NaN);
    const fn = vi.fn(() => s.value);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    s.value = NaN;
    flushEffects();
    expect(fn).toHaveBeenCalledTimes(1); // Object.is(NaN, NaN) = true
  });

  it('-0 and +0 are different (Object.is semantics)', () => {
    const s = signal(0);
    const fn = vi.fn(() => s.value);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    s.value = -0;
    flushEffects();
    // Object.is(0, -0) = false — should trigger update
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('object mutation does not trigger (same reference)', () => {
    const obj = { x: 1 };
    const s = signal(obj);
    const fn = vi.fn(() => s.value);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    s.value = obj; // same reference
    flushEffects();
    expect(fn).toHaveBeenCalledTimes(1);

    s.value = { ...obj }; // new reference
    flushEffects();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Auto-resolution (_setProp vs setAttribute)
// ADR 0005
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: auto-resolution for props vs attributes', () => {
  it('standard HTML attributes use setAttribute even on framework components', () => {
    const setPropCalls: [string, unknown][] = [];
    class TestComp extends HTMLElement {
      _setProp(key: string, value: unknown) {
        setPropCalls.push([key, value]);
      }
    }
    customElements.define('auto-res-std', TestComp);

    const result = html`<auto-res-std class="foo" data-id="42" task="${'myTask'}"></auto-res-std>`;
    const host = mount(result);
    const el = host.querySelector('auto-res-std')!;

    // class and data-id should use setAttribute (standard HTML attrs)
    expect(el.getAttribute('class')).toBe('foo');
    expect(el.getAttribute('data-id')).toBe('42');

    // task is a custom prop — should route through _setProp
    expect(setPropCalls).toContainEqual(['task', 'myTask']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Emitter auto-disposal in component context
// ADR 0002 — emitter.ts invariant 3
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: emitter.on() auto-disposes in component context', () => {
  it('subscription is cleaned up on disconnect', () => {
    const tag = uniqueTag('emitter-dispose');
    class TestEvents extends Emitter<{ ping: undefined }> {}

    const events = new TestEvents();
    const fn = vi.fn();

    component(tag, () => {
      events.on('ping', fn);
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);

    events.emit('ping', undefined);
    expect(fn).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);

    events.emit('ping', undefined);
    expect(fn).toHaveBeenCalledTimes(1); // disposed — not called again
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Microtask coalescing — multiple writes, one effect run
// ADR 0015 — batch() removed, microtask scheduling only
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: microtask coalescing', () => {
  it('multiple synchronous writes coalesce into one effect run', () => {
    const s = signal(0);
    const values: number[] = [];
    effect(() => { values.push(s.value); });
    values.length = 0; // clear initial run

    s.value = 1;
    s.value = 2;
    s.value = 3;
    // Effects haven't run yet — scheduled on microtask
    expect(values).toEqual([]);

    flushEffects();
    // One run with final value
    expect(values).toEqual([3]);
  });

  it('effects do not run synchronously between writes', () => {
    const a = signal(0);
    const b = signal(0);
    const runs: Array<[number, number]> = [];
    effect(() => { runs.push([a.value, b.value]); });
    runs.length = 0;

    a.value = 1;
    // If effects ran synchronously here, we'd see [1, 0]
    b.value = 2;
    flushEffects();
    // Only one run, seeing both changes
    expect(runs).toEqual([[1, 2]]);
  });

  it('flush() is idempotent — no-op when no pending effects', () => {
    const s = signal(0);
    const fn = vi.fn(() => { s.value; });
    effect(fn);
    fn.mockClear();

    flushEffects(); // nothing pending
    flushEffects(); // still nothing
    expect(fn).not.toHaveBeenCalled();
  });

  it('effects run on microtask without explicit flush', async () => {
    const s = signal(0);
    const values: number[] = [];
    effect(() => { values.push(s.value); });
    values.length = 0;

    s.value = 42;
    expect(values).toEqual([]); // not yet

    await new Promise(r => queueMicrotask(r));
    expect(values).toEqual([42]); // ran automatically
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Dependencies are fully re-tracked on every execution
// ADR 0002 — signal.ts invariant 4
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: dynamic dependency re-tracking', () => {
  it('conditional dependency switch works correctly', () => {
    const flag = signal(true);
    const a = signal('A');
    const b = signal('B');
    const values: string[] = [];

    effect(() => {
      values.push(flag.value ? a.value : b.value);
    });
    expect(values).toEqual(['A']);

    // b is not tracked when flag=true
    b.value = 'B2';
    flushEffects();
    expect(values).toEqual(['A']); // no re-run

    // Switch to b branch
    flag.value = false;
    flushEffects();
    expect(values).toEqual(['A', 'B2']);

    // a is no longer tracked
    a.value = 'A2';
    flushEffects();
    expect(values).toEqual(['A', 'B2']); // no re-run for a
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Circular dependency detection
// ADR 0002 — both computed and DI
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: circular dependency detection', () => {
  it('computed self-reference throws immediately', () => {
    const self = computed((): number => (self as any).value + 1);
    expect(() => self.value).toThrow('Circular dependency');
  });

  it('DI circular dependency throws immediately', () => {
    class CycleA { constructor() { inject(CycleB); } }
    class CycleB { constructor() { inject(CycleA); } }
    expect(() => inject(CycleA)).toThrow('Circular dependency');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Query generation guard prevents stale response overwrites
// ADR 0002 — query.ts invariant 1
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: query generation guard', () => {
  it('stale response does not overwrite fresh response', async () => {
    const { query } = await import('./query.js');

    const scopeId = signal('a');
    const slowResolve: { resolve: (v: string) => void } = { resolve: () => {} };
    const fastResolve: { resolve: (v: string) => void } = { resolve: () => {} };
    let callCount = 0;

    const result = query(
      () => ['test', scopeId.value],
      () => {
        callCount++;
        if (callCount === 1) return new Promise<string>(r => { slowResolve.resolve = r; });
        return new Promise<string>(r => { fastResolve.resolve = r; });
      },
    );

    flushEffects();
    // First fetch in flight

    scopeId.value = 'b';
    flushEffects();
    // Second fetch starts

    // Resolve second (fast) before first (slow)
    fastResolve.resolve('fast-result');
    await vi.waitFor(() => expect(result.data.value).toBe('fast-result'));

    // Resolve first (stale) — should NOT overwrite
    slowResolve.resolve('slow-stale');
    await new Promise(r => setTimeout(r, 10));
    expect(result.data.value).toBe('fast-result');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ADR 0009 Gap 1: activeObserver isolation via untrack()
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: untrack() isolates activeObserver', () => {
  it('signal reads inside untrack are not tracked by outer effect', () => {
    const outer = signal(0);
    const inner = signal(0);
    let runCount = 0;

    effect(() => {
      outer.value; // tracked
      untrack(() => {
        inner.value; // NOT tracked
      });
      runCount++;
    });
    expect(runCount).toBe(1);

    // Changing inner should NOT re-trigger the effect
    inner.value = 1;
    flushEffects();
    expect(runCount).toBe(1);

    // Changing outer SHOULD re-trigger the effect
    outer.value = 1;
    flushEffects();
    expect(runCount).toBe(2);
  });

  it('restores activeObserver after untrack completes', () => {
    const a = signal(0);
    const b = signal(0);
    const c = signal(0);
    let runCount = 0;

    effect(() => {
      a.value; // tracked
      untrack(() => { b.value; }); // NOT tracked
      c.value; // tracked
      runCount++;
    });
    expect(runCount).toBe(1);

    c.value = 1;
    flushEffects();
    expect(runCount).toBe(2);
  });

  it('connectedCallback isolates child signal reads from parent effect', () => {
    const tag = uniqueTag('iso');
    const childSignal = signal('child-value');
    let parentEffectRuns = 0;

    // Create a component that reads childSignal during setup
    component(tag, (_props) => {
      const val = childSignal.value; // read during setup
      return html`<span>${val}</span>`;
    });

    // Simulate: parent effect creates a child component
    const container = document.createElement('div');
    document.body.appendChild(container);

    effect(() => {
      parentEffectRuns++;
      // This would normally be "inside" a parent effect
      const el = document.createElement(tag);
      container.appendChild(el);
    });
    expect(parentEffectRuns).toBe(1);

    // Changing childSignal should NOT re-trigger parent effect
    childSignal.value = 'updated';
    flushEffects();
    expect(parentEffectRuns).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ADR 0009 Gap 2: Effect loop detection
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: effect loop detection', () => {
  it('effect that writes to its own dependency is auto-disposed after MAX_RERUNS', () => {
    const counter = signal(0);
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(String(args[0]));
    };

    try {
      // This effect reads and writes the same signal — infinite loop
      effect(() => {
        counter.value = counter.value + 1;
      });
      // Initial run: counter goes 0→1. That triggers a re-run via microtask.
      expect(counter.value).toBe(1);

      // Simulate microtask flushes — each run writes to counter, which
      // re-triggers the effect. After 100 re-runs, the guard kicks in.
      for (let i = 0; i < 200; i++) {
        flushEffects();
      }

      // The effect should have been disposed before reaching 200+ runs
      expect(counter.value).toBeGreaterThan(1);
      expect(counter.value).toBeLessThanOrEqual(102);
      expect(errors.some(e => e.includes('maximum re-run limit'))).toBe(true);

      // Verify the effect is truly dead — further flushes don't increment
      const finalValue = counter.value;
      flushEffects();
      expect(counter.value).toBe(finalValue);
    } finally {
      console.error = origError;
    }
  });

  it('normal effects are not affected by loop detection', () => {
    const a = signal(0);
    const b = signal('');
    let runCount = 0;

    // This effect reads a and writes b — no loop (different signals)
    effect(() => {
      b.value = `value-${a.value}`;
      runCount++;
    });
    expect(runCount).toBe(1);
    expect(b.value).toBe('value-0');

    // Update a many times — each should work fine
    for (let i = 1; i <= 50; i++) {
      a.value = i;
      flushEffects();
    }
    expect(runCount).toBe(51);
    expect(b.value).toBe('value-50');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ADR 0009 Gap 3: Factory class prop (HostAttrs)
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: factory class prop via HostAttrs', () => {
  /**
   * Mount a factory result by embedding it in a parent template.
   * Factory results are not TemplateResults — they need to be rendered
   * via the template engine's expression slot handling.
   */
  function mountFactory(factoryResult: TemplateResult): { host: HTMLElement; el: Element } {
    const wrapper = html`<div>${factoryResult}</div>`;
    const host = document.createElement('div');
    wrapper.mount(host);
    document.body.appendChild(host);
    const el = host.querySelector('div')!.children[0];
    return { host, el };
  }

  it('static class is applied to the host element', () => {
    const tag = uniqueTag('cls');
    const Comp = component<{ label: string }>(tag, (props) => {
      return html`<span>${props.label}</span>`;
    });

    const result = Comp({ label: signal('hi') }, { class: 'my-class extra' });
    const { el } = mountFactory(result);
    expect(el).toBeTruthy();
    expect(el.classList.contains('my-class')).toBe(true);
    expect(el.classList.contains('extra')).toBe(true);
  });

  it('reactive class updates the host element', () => {
    const tag = uniqueTag('cls-rx');
    const Comp = component<{ label: string }>(tag, (props) => {
      return html`<span>${props.label}</span>`;
    });

    const cls = signal('initial-class');
    const result = Comp({ label: signal('hi') }, { class: cls });
    const { el } = mountFactory(result);
    expect(el.classList.contains('initial-class')).toBe(true);

    cls.value = 'new-class another';
    flushEffects();
    expect(el.classList.contains('initial-class')).toBe(false);
    expect(el.classList.contains('new-class')).toBe(true);
    expect(el.classList.contains('another')).toBe(true);
  });

  it('host class does not interfere with component internal classes', () => {
    const tag = uniqueTag('cls-int');
    const Comp = component<{ active: boolean }>(tag, (props, host) => {
      effect(() => {
        host.classList.toggle('internal-active', props.active.value);
      });
      return html`<span>content</span>`;
    });

    const active = signal(true);
    const result = Comp({ active }, { class: 'external-class' });
    const { el } = mountFactory(result);
    expect(el.classList.contains('external-class')).toBe(true);
    expect(el.classList.contains('internal-active')).toBe(true);

    // Changing active should not remove external class
    active.value = false;
    // Cascading: flush subscription effect → prop update → flush internal effect
    flushEffects();
    flushEffects();
    expect(el.classList.contains('external-class')).toBe(true);
    expect(el.classList.contains('internal-active')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ADR 0009 Gap 4: Static prop auto-wrapping (PropInput<T>)
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: factory accepts plain values (auto-wrapping)', () => {
  function mountFactory(factoryResult: TemplateResult): HTMLElement {
    const wrapper = html`<div>${factoryResult}</div>`;
    const host = document.createElement('div');
    wrapper.mount(host);
    document.body.appendChild(host);
    return host;
  }

  it('plain value is auto-wrapped and forwarded as prop', () => {
    const tag = uniqueTag('auto');
    let receivedValue = '';
    const Comp = component<{ name: string }>(tag, (props) => {
      receivedValue = props.name.value;
      return html`<span>${props.name}</span>`;
    });

    const result = Comp({ name: 'static-value' });
    mountFactory(result);
    expect(receivedValue).toBe('static-value');
  });

  it('signal value is forwarded without double-wrapping', () => {
    const tag = uniqueTag('auto-sig');
    const name = signal('reactive-value');
    let receivedValue = '';
    const Comp = component<{ name: string }>(tag, (props) => {
      receivedValue = props.name.value;
      return html`<span>${props.name}</span>`;
    });

    const result = Comp({ name });
    mountFactory(result);
    expect(receivedValue).toBe('reactive-value');
  });

  it('mixed static and signal props work together', () => {
    const tag = uniqueTag('auto-mix');
    const dynamic = signal('dynamic');
    let staticVal = '';
    let dynamicVal = '';
    const Comp = component<{ label: string; title: string }>(tag, (props) => {
      staticVal = props.label.value;
      dynamicVal = props.title.value;
      return html`<span>${props.label} ${props.title}</span>`;
    });

    const result = Comp({ label: 'fixed', title: dynamic });
    mountFactory(result);
    expect(staticVal).toBe('fixed');
    expect(dynamicVal).toBe('dynamic');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVARIANT: Unquoted attribute expressions work (ADR 0069)
// The html() tagged template must handle both quoted and unquoted
// attribute expressions. Comment markers contain > which breaks
// unquoted attributes without auto-quoting.
// ═══════════════════════════════════════════════════════════════════════

describe('INVARIANT: unquoted attribute expressions (ADR 0069)', () => {
  it('unquoted @click handler fires', () => {
    const handler = vi.fn();
    const result = html`<button @click=${handler}>Click</button>`;
    const host = mount(result);
    host.querySelector('button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unquoted class:name toggles class', () => {
    const active = signal(true);
    const result = html`<div class:active=${active}></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.classList.contains('active')).toBe(true);

    active.value = false;
    flushEffects();
    expect(host.querySelector('div')?.classList.contains('active')).toBe(false);
  });

  it('unquoted @click with modifiers works', () => {
    const handler = vi.fn();
    const result = html`<button @click.prevent=${handler}>Click</button>`;
    const host = mount(result);
    host.querySelector('button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('mixed quoted and unquoted on same element', () => {
    const handler = vi.fn();
    const active = signal(true);
    const result = html`<button class="base" class:active=${active} @click=${handler}>Click</button>`;
    const host = mount(result);
    const btn = host.querySelector('button')!;

    expect(btn.classList.contains('base')).toBe(true);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('multiple unquoted bindings on same element', () => {
    const handler = vi.fn();
    const expanded = signal(true);
    const result = html`<div class:expanded=${expanded} @click=${handler}>Content</div>`;
    const host = mount(result);
    const div = host.querySelector('div')!;

    expect(div.classList.contains('expanded')).toBe(true);
    div.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unquoted attribute binding sets value', () => {
    const id = signal('test-id');
    const result = html`<div id=${id}></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('id')).toBe('test-id');
  });

  it('quoted expression containing = inside attribute is not broken', () => {
    // Regression: naive regex fix would break "${a}=${b}" patterns
    const a = signal('x');
    const b = signal('y');
    const result = html`<div data-value="${a}=${b}"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('data-value')).toBe('x=y');
  });

  it('text content with = is not affected', () => {
    const val = signal('42');
    const result = html`<p>x = ${val}</p>`;
    const host = mount(result);
    expect(host.querySelector('p')?.textContent).toContain('x =');
    expect(host.querySelector('p')?.textContent).toContain('42');
  });

  it('unquoted style attribute works', () => {
    const style = computed(() => 'color:red');
    const result = html`<div style=${style}></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('style')).toBe('color:red');
  });
});

// ── ADR 0070: Reactive slot reparenting ─────────────────────────────

describe('INVARIANT: reactive slots survive DOM reparenting', () => {
  it('computed returning TemplateResult updates after mount', async () => {
    const task = signal<{ id: string } | null>(null);

    const header = computed(() => {
      const t = task.value;
      if (!t) return html`<div class="fallback">empty</div>`;
      return html`<div class="loaded">${t.id}</div>`;
    });

    const host = mount(html`${header}<div class="body">body</div>`);

    expect(host.querySelector('.fallback')?.textContent).toBe('empty');

    task.value = { id: 'TASK-1' };
    await new Promise(r => setTimeout(r, 0));

    expect(host.querySelector('.loaded')?.textContent).toBe('TASK-1');
    expect(host.querySelector('.fallback')).toBeNull();
  });
});
