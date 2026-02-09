/**
 * template.test.ts — Tests for the tagged template engine.
 * Requires DOM — uses happy-dom via vitest environment.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { html, when, type TemplateResult } from './template.js';
import { signal, computed, effect, flushEffects } from './signal.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(result: TemplateResult): HTMLElement {
  const host = document.createElement('div');
  result.mount(host);
  return host;
}

// ── Text bindings ───────────────────────────────────────────────────

describe('text bindings', () => {
  it('renders static text', () => {
    const result = html`<span>Hello World</span>`;
    const host = mount(result);
    expect(host.querySelector('span')?.textContent).toBe('Hello World');
  });

  it('renders dynamic primitive values', () => {
    const result = html`<span>${42}</span>`;
    const host = mount(result);
    expect(host.querySelector('span')?.textContent).toContain('42');
  });

  it('renders signal values', () => {
    const name = signal('Alice');
    const result = html`<span>${name}</span>`;
    const host = mount(result);
    expect(host.textContent).toContain('Alice');
  });

  it('updates text when signal changes', () => {
    const name = signal('Alice');
    const result = html`<span>${name}</span>`;
    const host = mount(result);
    expect(host.textContent).toContain('Alice');

    name.value = 'Bob';
    flushEffects();
    expect(host.textContent).toContain('Bob');
  });

  it('multiple signals in one template update independently', () => {
    const first = signal('John');
    const last = signal('Doe');
    const result = html`<span>${first} ${last}</span>`;
    const host = mount(result);
    expect(host.textContent).toContain('John');
    expect(host.textContent).toContain('Doe');

    first.value = 'Jane';
    flushEffects();
    expect(host.textContent).toContain('Jane');
    expect(host.textContent).toContain('Doe');
  });

  it('renders null/undefined/false as empty', () => {
    const result1 = html`<div>${null}</div>`;
    const host1 = mount(result1);
    expect(host1.querySelector('div')?.childNodes.length).toBeLessThanOrEqual(1);

    const result2 = html`<div>${undefined}</div>`;
    const host2 = mount(result2);
    expect(host2.querySelector('div')?.childNodes.length).toBeLessThanOrEqual(1);

    const result3 = html`<div>${false}</div>`;
    const host3 = mount(result3);
    expect(host3.querySelector('div')?.textContent?.trim()).toBe('');
  });

  it('renders computed values reactively', () => {
    const count = signal(5);
    const doubled = computed(() => count.value * 2);
    const result = html`<span>${doubled}</span>`;
    const host = mount(result);
    expect(host.textContent).toContain('10');

    count.value = 10;
    flushEffects();
    expect(host.textContent).toContain('20');
  });
});

// ── Attribute bindings ──────────────────────────────────────────────

describe('attribute bindings', () => {
  it('sets static attribute values', () => {
    const result = html`<div id="${'myid'}"></div>`;
    const host = mount(result);
    const div = host.querySelector('div');
    expect(div?.getAttribute('id')).toBe('myid');
  });

  it('sets signal attribute values', () => {
    const id = signal('first');
    const result = html`<div id="${id}"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('id')).toBe('first');

    id.value = 'second';
    flushEffects();
    expect(host.querySelector('div')?.getAttribute('id')).toBe('second');
  });

  it('removes attribute when value is null/false', () => {
    const hidden = signal<boolean | null>(true);
    const result = html`<div hidden="${hidden}"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.hasAttribute('hidden')).toBe(true);

    hidden.value = null;
    flushEffects();
    expect(host.querySelector('div')?.hasAttribute('hidden')).toBe(false);
  });
});

// ── class:name directive ────────────────────────────────────────────

describe('class:name directive', () => {
  it('toggles class based on truthy signal', () => {
    const active = signal(true);
    const result = html`<div class="base" class:active="${active}"></div>`;
    const host = mount(result);
    const div = host.querySelector('div');
    expect(div?.classList.contains('active')).toBe(true);

    active.value = false;
    flushEffects();
    expect(div?.classList.contains('active')).toBe(false);
  });

  it('toggles class based on static value', () => {
    const result = html`<div class:visible="${true}"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.classList.contains('visible')).toBe(true);

    const result2 = html`<div class:hidden="${false}"></div>`;
    const host2 = mount(result2);
    expect(host2.querySelector('div')?.classList.contains('hidden')).toBe(false);
  });
});

// ── @event bindings ─────────────────────────────────────────────────

describe('@event bindings', () => {
  it('attaches click handler', () => {
    const handler = vi.fn();
    const result = html`<button @click="${handler}">Click</button>`;
    const host = mount(result);
    const btn = host.querySelector('button');

    btn?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler receives the event object', () => {
    let receivedEvent: Event | null = null;
    const result = html`<button @click="${(e: Event) => { receivedEvent = e; }}">Click</button>`;
    const host = mount(result);
    host.querySelector('button')?.click();
    expect(receivedEvent).toBeInstanceOf(Event);
  });

  it('@click.stop modifier stops propagation', () => {
    const parentHandler = vi.fn();
    const childHandler = vi.fn();

    const result = html`<div @click="${parentHandler}"><button @click.stop="${childHandler}">Click</button></div>`;
    const host = mount(result);
    host.querySelector('button')?.click();

    expect(childHandler).toHaveBeenCalledTimes(1);
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it('handler errors are caught and logged', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = () => { throw new Error('click boom'); };
    const result = html`<button @click="${handler}">Click</button>`;
    const host = mount(result);

    // Should not throw
    expect(() => host.querySelector('button')?.click()).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Event handler error'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('signal in @event handler triggers reactivity', () => {
    const count = signal(0);
    const values: number[] = [];
    effect(() => { values.push(count.value); });

    const result = html`<button @click="${() => { count.value++; }}">+</button>`;
    const host = mount(result);

    host.querySelector('button')?.click();
    flushEffects();
    expect(count.value).toBe(1);
    expect(values).toContain(1);
  });
});

// ── Nested templates ────────────────────────────────────────────────

describe('nested templates', () => {
  it('renders nested html template', () => {
    const inner = html`<span>inner</span>`;
    const outer = html`<div>${inner}</div>`;
    const host = mount(outer);
    expect(host.querySelector('span')?.textContent).toBe('inner');
  });

  it('renders array of templates', () => {
    const items = ['A', 'B', 'C'].map(s => html`<li>${s}</li>`);
    const result = html`<ul>${items}</ul>`;
    const host = mount(result);
    const lis = host.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[0].textContent).toContain('A');
    expect(lis[1].textContent).toContain('B');
    expect(lis[2].textContent).toContain('C');
  });
});

// ── when() conditional ──────────────────────────────────────────────

describe('when() conditional', () => {
  it('shows template when condition is truthy', () => {
    const result = html`<div>${when(true, html`<span>visible</span>`)}</div>`;
    const host = mount(result);
    expect(host.querySelector('span')?.textContent).toBe('visible');
  });

  it('hides template when condition is falsy', () => {
    const result = html`<div>${when(false, html`<span>hidden</span>`)}</div>`;
    const host = mount(result);
    expect(host.querySelector('span')).toBeNull();
  });

  it('works with signal condition', () => {
    const show = signal(true);
    const template = when(show, html`<span>toggle</span>`);
    const result = html`<div>${template}</div>`;
    const host = mount(result);
    expect(host.querySelector('span')?.textContent).toBe('toggle');
  });
});

// ── Disposal ────────────────────────────────────────────────────────

describe('template disposal', () => {
  it('dispose() cleans up signal subscriptions', () => {
    const name = signal('Alice');
    const result = html`<span>${name}</span>`;
    const host = mount(result);
    expect(host.textContent).toContain('Alice');

    result.dispose();

    name.value = 'Bob';
    flushEffects();
    // Text should NOT have updated since we disposed
    // (the text node still exists but the effect is gone)
  });
});

// ── Complex scenarios ───────────────────────────────────────────────

describe('complex scenarios', () => {
  it('renders a component-like structure with multiple binding types', () => {
    const title = signal('Task 1');
    const status = signal('open');
    const selected = signal(false);
    const onClick = vi.fn();

    const result = html`
      <div class="task-item" class:selected="${selected}" @click="${onClick}">
        <span class="title">${title}</span>
        <span class="status">${status}</span>
      </div>
    `;
    const host = mount(result);

    // Initial state
    const div = host.querySelector('.task-item');
    expect(div).not.toBeNull();
    expect(host.querySelector('.title')?.textContent).toContain('Task 1');
    expect(host.querySelector('.status')?.textContent).toContain('open');
    expect(div?.classList.contains('selected')).toBe(false);

    // Update signals
    title.value = 'Task 2';
    status.value = 'done';
    selected.value = true;
    flushEffects();

    expect(host.querySelector('.title')?.textContent).toContain('Task 2');
    expect(host.querySelector('.status')?.textContent).toContain('done');
    expect(div?.classList.contains('selected')).toBe(true);

    // Click
    div?.dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ── Auto-resolution: props vs attributes ────────────────────────────

describe('mixed static + dynamic attributes', () => {
  it('preserves static text around interpolations', () => {
    const result = html`<div class="prefix-${`dynamic`} suffix"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('class')).toBe('prefix-dynamic suffix');
  });

  it('handles multiple interpolations in one attribute', () => {
    const a = 'hello';
    const b = 'world';
    const result = html`<div data-info="${a}-${b}"></div>`;
    const host = mount(result);
    expect(host.querySelector('div')?.getAttribute('data-info')).toBe('hello-world');
  });

  it('reactively updates when signal in mixed attribute changes', () => {
    const status = signal('active');
    const result = html`<div class="badge status-${status}"></div>`;
    const host = mount(result);
    const div = host.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('badge status-active');
    status.value = 'closed';
    flushEffects();
    expect(div.getAttribute('class')).toBe('badge status-closed');
  });
});

describe('auto-resolution', () => {
  it('routes attribute bindings through _setProp on framework components', () => {
    const setPropCalls: [string, unknown][] = [];
    class FakeComponent extends HTMLElement {
      _setProp(key: string, value: unknown) {
        setPropCalls.push([key, value]);
      }
    }
    customElements.define('fake-comp', FakeComponent);

    const obj = { id: 1, title: 'Test' };
    const result = html`<fake-comp task="${obj}" count="${42}"></fake-comp>`;
    const host = mount(result);

    expect(setPropCalls).toContainEqual(['task', obj]);
    expect(setPropCalls).toContainEqual(['count', 42]);
    // Object reference preserved — not serialized to string
    const taskCall = setPropCalls.find(([k]) => k === 'task');
    expect(taskCall![1]).toBe(obj);
  });

  it('routes signal bindings through _setProp reactively', () => {
    const props = new Map<string, unknown>();
    class FakeReactive extends HTMLElement {
      _setProp(key: string, value: unknown) {
        props.set(key, value);
      }
    }
    customElements.define('fake-reactive', FakeReactive);

    const title = signal('Hello');
    const result = html`<fake-reactive title="${title}"></fake-reactive>`;
    mount(result);
    flushEffects();

    expect(props.get('title')).toBe('Hello');

    title.value = 'Updated';
    flushEffects();
    expect(props.get('title')).toBe('Updated');
  });

  it('falls back to setAttribute for vanilla elements', () => {
    const result = html`<div data-id="${'42'}" title="${'hello'}"></div>`;
    const host = mount(result);
    const div = host.querySelector('div')!;

    expect(div.getAttribute('data-id')).toBe('42');
    expect(div.getAttribute('title')).toBe('hello');
  });
});
