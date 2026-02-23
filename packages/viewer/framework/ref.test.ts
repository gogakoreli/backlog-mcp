/**
 * ref.test.ts — Tests for the ref() primitive.
 * Requires DOM — uses happy-dom via vitest environment.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, isRef, REF_BRAND } from './ref.js';
import { html, type TemplateResult } from './template.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(result: TemplateResult): HTMLElement {
  const host = document.createElement('div');
  result.mount(host);
  return host;
}

describe('ref()', () => {
  it('creates a ref with null initial value', () => {
    const r = ref<HTMLInputElement>();
    expect(r.current).toBeNull();
    expect(r[REF_BRAND]).toBe(true);
  });

  it('isRef() detects refs', () => {
    expect(isRef(ref())).toBe(true);
    expect(isRef(null)).toBe(false);
    expect(isRef({})).toBe(false);
    expect(isRef(42)).toBe(false);
  });
});

describe('ref in template', () => {
  it('assigns DOM element to ref.current after mount', () => {
    const inputRef = ref<HTMLInputElement>();
    const result = html`<input ref="${inputRef}" type="text" />`;
    mount(result);

    expect(inputRef.current).not.toBeNull();
    expect(inputRef.current?.tagName).toBe('INPUT');
  });

  it('ref.current is set to null after dispose', () => {
    const divRef = ref<HTMLDivElement>();
    const result = html`<div ref="${divRef}">content</div>`;
    mount(result);

    expect(divRef.current).not.toBeNull();

    result.dispose();
    expect(divRef.current).toBeNull();
  });

  it('does not set ref attribute on the DOM element', () => {
    const r = ref();
    const result = html`<div ref="${r}">content</div>`;
    const host = mount(result);
    const div = host.querySelector('div');

    // The ref attribute should be removed, not left as a DOM attribute
    expect(div?.hasAttribute('ref')).toBe(false);
  });

  it('works with multiple refs in one template', () => {
    const inputRef = ref<HTMLInputElement>();
    const buttonRef = ref<HTMLButtonElement>();
    const result = html`
      <input ref="${inputRef}" type="text" />
      <button ref="${buttonRef}">Click</button>
    `;
    mount(result);

    expect(inputRef.current?.tagName).toBe('INPUT');
    expect(buttonRef.current?.tagName).toBe('BUTTON');
  });
});
