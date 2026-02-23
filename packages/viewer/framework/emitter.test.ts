/**
 * emitter.test.ts — Tests for typed event emitters.
 * Pure logic tests — no DOM needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { Emitter } from './emitter.js';
import { flushEffects, effect } from './signal.js';
import { runWithContext, type ComponentHost } from './context.js';

// Test emitter type
class TestEvents extends Emitter<{
  select: { id: string };
  filter: { filter: string; type: string };
  reset: undefined;
}> {}

function createMockHost(): ComponentHost & { disposers: (() => void)[] } {
  const disposers: (() => void)[] = [];
  return {
    element: {} as HTMLElement,
    addDisposer: (fn: () => void) => disposers.push(fn),
    disposers,
  };
}

describe('Emitter', () => {
  it('basic emit → on subscriber fires with correct payload', () => {
    const emitter = new TestEvents();
    const fn = vi.fn();
    emitter.on('select', fn);

    emitter.emit('select', { id: 'TASK-1' });
    expect(fn).toHaveBeenCalledWith({ id: 'TASK-1' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('multiple subscribers on same event all fire', () => {
    const emitter = new TestEvents();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const fn3 = vi.fn();

    emitter.on('select', fn1);
    emitter.on('select', fn2);
    emitter.on('select', fn3);

    emitter.emit('select', { id: 'TASK-1' });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it('on() returns unsubscribe function', () => {
    const emitter = new TestEvents();
    const fn = vi.fn();
    const unsub = emitter.on('select', fn);

    emitter.emit('select', { id: '1' });
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();

    emitter.emit('select', { id: '2' });
    expect(fn).toHaveBeenCalledTimes(1); // not called again
  });

  it('unsubscribe during emit does not affect other subscribers', () => {
    const emitter = new TestEvents();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    let unsub1: () => void;
    unsub1 = emitter.on('select', () => {
      fn1();
      unsub1(); // unsubscribe self during callback
    });
    emitter.on('select', fn2);

    emitter.emit('select', { id: '1' });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    // fn1 unsubscribed, fn2 still subscribed
    emitter.emit('select', { id: '2' });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  it('emit during subscriber callback (re-entrancy)', () => {
    const emitter = new TestEvents();
    const order: string[] = [];

    emitter.on('select', () => {
      order.push('select:A');
      // Re-entrant emit of a different event
      emitter.emit('filter', { filter: 'active', type: 'task' });
    });
    emitter.on('filter', () => {
      order.push('filter:B');
    });
    emitter.on('select', () => {
      order.push('select:C');
    });

    emitter.emit('select', { id: '1' });

    // A fires, emits filter (B fires), then C fires
    expect(order).toEqual(['select:A', 'filter:B', 'select:C']);
  });

  it('subscriber throws — other subscribers still fire', () => {
    const emitter = new TestEvents();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn1 = vi.fn(() => { throw new Error('boom'); });
    const fn2 = vi.fn();

    emitter.on('select', fn1);
    emitter.on('select', fn2);

    emitter.emit('select', { id: '1' });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('emit to event with no subscribers is a no-op', () => {
    const emitter = new TestEvents();
    // Should not throw
    expect(() => emitter.emit('select', { id: '1' })).not.toThrow();
  });

  it('events with different names are independent', () => {
    const emitter = new TestEvents();
    const selectFn = vi.fn();
    const filterFn = vi.fn();

    emitter.on('select', selectFn);
    emitter.on('filter', filterFn);

    emitter.emit('select', { id: '1' });
    expect(selectFn).toHaveBeenCalledTimes(1);
    expect(filterFn).not.toHaveBeenCalled();
  });

  it('clear() removes all subscribers', () => {
    const emitter = new TestEvents();
    const fn = vi.fn();
    emitter.on('select', fn);
    emitter.on('filter', vi.fn());

    emitter.clear();

    emitter.emit('select', { id: '1' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('Emitter.toSignal()', () => {
  it('creates a signal with initial value', () => {
    const emitter = new TestEvents();
    const selectedId = emitter.toSignal('select', e => e.id, 'none');
    expect(selectedId.value).toBe('none');
  });

  it('updates signal when event fires', () => {
    const emitter = new TestEvents();
    const selectedId = emitter.toSignal('select', e => e.id, 'none');

    emitter.emit('select', { id: 'TASK-42' });
    expect(selectedId.value).toBe('TASK-42');
  });

  it('signal integrates with effect()', () => {
    const emitter = new TestEvents();
    const selectedId = emitter.toSignal('select', e => e.id, 'none');
    const values: string[] = [];

    effect(() => {
      values.push(selectedId.value);
    });
    expect(values).toEqual(['none']);

    emitter.emit('select', { id: 'TASK-1' });
    flushEffects();
    expect(values).toEqual(['none', 'TASK-1']);
  });
});

describe('Emitter auto-disposal in setup context', () => {
  it('on() registers disposer when inside component context', () => {
    const emitter = new TestEvents();
    const host = createMockHost();
    const fn = vi.fn();

    runWithContext(host, () => {
      emitter.on('select', fn);
    });

    expect(host.disposers).toHaveLength(1);

    // Subscription works
    emitter.emit('select', { id: '1' });
    expect(fn).toHaveBeenCalledTimes(1);

    // Run disposer (simulates disconnectedCallback)
    host.disposers[0]();

    // Subscription removed
    emitter.emit('select', { id: '2' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('on() does NOT register disposer when outside component context', () => {
    const emitter = new TestEvents();
    const fn = vi.fn();

    // Outside any context — no auto-disposal
    const unsub = emitter.on('select', fn);

    emitter.emit('select', { id: '1' });
    expect(fn).toHaveBeenCalledTimes(1);

    unsub(); // manual cleanup
  });
});
