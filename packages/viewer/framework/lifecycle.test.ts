/**
 * lifecycle.test.ts — Tests for onMount() and onCleanup() lifecycle hooks.
 * Requires DOM — uses happy-dom via vitest environment.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { component } from './component.js';
import { signal, flushEffects } from './signal.js';
import { onMount, onCleanup } from './lifecycle.js';
import { html } from './template.js';
import { resetInjector } from './injector.js';

beforeEach(() => {
  resetInjector();
  document.body.innerHTML = '';
});

let tagCounter = 0;
function uniqueTag(prefix = 'lc'): string {
  return `${prefix}-${++tagCounter}-${Date.now()}`;
}

describe('onMount()', () => {
  it('runs callback after template is mounted to DOM', () => {
    const tag = uniqueTag('mount');
    const order: string[] = [];

    component(tag, () => {
      order.push('setup');
      onMount(() => {
        order.push('mounted');
      });
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);

    // onMount runs after setup and template mount
    expect(order).toEqual(['setup', 'mounted']);
  });

  it('can access DOM elements created by the template', () => {
    const tag = uniqueTag('mount-dom');
    let foundSpan = false;

    component(tag, (_props, host) => {
      onMount(() => {
        foundSpan = host.querySelector('span.target') !== null;
      });
      return html`<span class="target">hello</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);

    expect(foundSpan).toBe(true);
  });

  it('cleanup from onMount runs on disconnect', () => {
    const tag = uniqueTag('mount-cleanup');
    const cleanup = vi.fn();

    component(tag, () => {
      onMount(() => {
        return cleanup;
      });
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);
    expect(cleanup).not.toHaveBeenCalled();

    document.body.removeChild(el);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('multiple onMount callbacks run in order', () => {
    const tag = uniqueTag('mount-multi');
    const order: string[] = [];

    component(tag, () => {
      onMount(() => { order.push('first'); });
      onMount(() => { order.push('second'); });
      onMount(() => { order.push('third'); });
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('throws when called outside setup context', () => {
    expect(() => onMount(() => {})).toThrow('outside setup');
  });

  it('onMount error does not crash sibling callbacks', () => {
    const tag = uniqueTag('mount-err');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secondCb = vi.fn();

    component(tag, () => {
      onMount(() => { throw new Error('mount boom'); });
      onMount(secondCb);
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);

    expect(errorSpy).toHaveBeenCalled();
    expect(secondCb).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('onCleanup()', () => {
  it('runs callback on disconnect', () => {
    const tag = uniqueTag('cleanup');
    const cleanup = vi.fn();

    component(tag, () => {
      onCleanup(cleanup);
      return html`<span>content</span>`;
    });

    const el = document.createElement(tag);
    document.body.appendChild(el);
    expect(cleanup).not.toHaveBeenCalled();

    document.body.removeChild(el);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('throws when called outside setup context', () => {
    expect(() => onCleanup(() => {})).toThrow('outside setup');
  });
});
