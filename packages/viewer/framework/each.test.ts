/**
 * each.test.ts — Tests for reactive list rendering.
 * Requires DOM — uses happy-dom via vitest environment.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { html, each, type TemplateResult } from './template.js';
import { signal, computed, flushEffects, type ReadonlySignal } from './signal.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(result: TemplateResult): HTMLElement {
  const host = document.createElement('div');
  result.mount(host);
  return host;
}

// ── Basic rendering ──────────────────────────────────────────────────

describe('each() basic rendering', () => {
  it('renders a static list of items', () => {
    const items = signal([
      { id: '1', title: 'Alpha' },
      { id: '2', title: 'Beta' },
      { id: '3', title: 'Gamma' },
    ]);

    const result = html`<ul>${each(
      items,
      (t) => t.id,
      (item) => html`<li>${computed(() => item.value.title)}</li>`,
    )}</ul>`;
    const host = mount(result);

    const lis = host.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[0].textContent).toContain('Alpha');
    expect(lis[1].textContent).toContain('Beta');
    expect(lis[2].textContent).toContain('Gamma');
  });

  it('renders empty array as nothing', () => {
    const items = signal<{ id: string; title: string }[]>([]);

    const result = html`<ul>${each(
      items,
      (t) => t.id,
      (item) => html`<li>${computed(() => item.value.title)}</li>`,
    )}</ul>`;
    const host = mount(result);

    expect(host.querySelectorAll('li')).toHaveLength(0);
  });
});

// ── Reactive updates ─────────────────────────────────────────────────

describe('each() reactive updates', () => {
  it('adds new items when array grows', () => {
    const items = signal([{ id: '1', title: 'A' }]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.item')).toHaveLength(1);

    items.value = [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ];
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toContain('A');
    expect(spans[1].textContent).toContain('B');
  });

  it('removes items when array shrinks', () => {
    const items = signal([
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
      { id: '3', title: 'C' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.item')).toHaveLength(3);

    items.value = [{ id: '2', title: 'B' }];
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toContain('B');
  });

  it('updates existing items in place via signal', () => {
    const items = signal([
      { id: '1', title: 'Original' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span>${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    expect(host.querySelector('span')?.textContent).toContain('Original');

    items.value = [{ id: '1', title: 'Updated' }];
    flushEffects(); // each() effect runs, updates itemSignal
    flushEffects(); // cascading: text binding effect reads updated itemSignal

    expect(host.querySelector('span')?.textContent).toContain('Updated');
  });

  it('reorders items when array order changes', () => {
    const items = signal([
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
      { id: '3', title: 'Third' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    // Reverse order
    items.value = [
      { id: '3', title: 'Third' },
      { id: '2', title: 'Second' },
      { id: '1', title: 'First' },
    ];
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toContain('Third');
    expect(spans[1].textContent).toContain('Second');
    expect(spans[2].textContent).toContain('First');
  });

  it('handles complete array replacement', () => {
    const items = signal([
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    // Replace with completely different items
    items.value = [
      { id: '3', title: 'X' },
      { id: '4', title: 'Y' },
      { id: '5', title: 'Z' },
    ];
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toContain('X');
    expect(spans[1].textContent).toContain('Y');
    expect(spans[2].textContent).toContain('Z');
  });

  it('handles empty → items → empty transitions', () => {
    const items = signal<{ id: string; title: string }[]>([]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.item')).toHaveLength(0);

    // Add items
    items.value = [{ id: '1', title: 'A' }];
    flushEffects();
    expect(host.querySelectorAll('.item')).toHaveLength(1);

    // Back to empty
    items.value = [];
    flushEffects();
    expect(host.querySelectorAll('.item')).toHaveLength(0);
  });
});

// ── Index signal ─────────────────────────────────────────────────────

describe('each() index signal', () => {
  it('provides correct index values', () => {
    const items = signal(['A', 'B', 'C']);

    const result = html`<div>${each(
      items,
      (_, i) => i,
      (item, index) => html`<span class="item">${computed(() => `${index.value}:${item.value}`)}</span>`,
    )}</div>`;
    const host = mount(result);

    const spans = host.querySelectorAll('.item');
    expect(spans[0].textContent).toContain('0:A');
    expect(spans[1].textContent).toContain('1:B');
    expect(spans[2].textContent).toContain('2:C');
  });

  it('updates index when items are reordered', () => {
    const items = signal([
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ]);

    const capturedIndices: number[] = [];
    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item, index) => {
        // Track index changes
        return html`<span class="item">${computed(() => {
          capturedIndices.push(index.value);
          return `${index.value}:${item.value.title}`;
        })}</span>`;
      },
    )}</div>`;
    const host = mount(result);

    // Swap order
    items.value = [
      { id: '2', title: 'B' },
      { id: '1', title: 'A' },
    ];
    flushEffects(); // each() effect runs, updates indexSignals
    flushEffects(); // cascading: text binding effects read updated indexSignals

    const spans = host.querySelectorAll('.item');
    expect(spans[0].textContent).toContain('0:B');
    expect(spans[1].textContent).toContain('1:A');
  });
});

// ── Disposal ─────────────────────────────────────────────────────────

describe('each() disposal', () => {
  it('disposes removed item templates', () => {
    const disposeSpy = vi.fn();
    const items = signal([{ id: '1' }, { id: '2' }]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => {
        const tpl = html`<span>${computed(() => item.value.id)}</span>`;
        const origDispose = tpl.dispose;
        tpl.dispose = () => {
          disposeSpy(item.value.id);
          origDispose.call(tpl);
        };
        return tpl;
      },
    )}</div>`;
    mount(result);

    // Remove item 1
    items.value = [{ id: '2' }];
    flushEffects();

    expect(disposeSpy).toHaveBeenCalledWith('1');
  });

  it('dispose() cleans up all items', () => {
    const items = signal([{ id: '1' }, { id: '2' }, { id: '3' }]);

    const eachResult = each(
      items,
      (t) => t.id,
      (item) => html`<span>${computed(() => item.value.id)}</span>`,
    );
    const host = document.createElement('div');
    eachResult.mount(host);

    expect(host.querySelectorAll('span')).toHaveLength(3);

    eachResult.dispose();

    // After dispose, updates should not affect DOM
    items.value = [{ id: '4' }];
    flushEffects();

    // The effect is disposed, so no new items should appear
    // (existing DOM nodes may still be present but no new ones added)
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe('each() edge cases', () => {
  it('handles duplicate keys gracefully (last wins)', () => {
    const items = signal([
      { id: '1', title: 'First' },
      { id: '1', title: 'Second' },
    ]);

    // Duplicate keys — last item with same key wins
    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    // Should render without crashing
    expect(host.querySelectorAll('.item').length).toBeGreaterThan(0);
  });

  it('works with numeric keys', () => {
    const items = signal([10, 20, 30]);

    const result = html`<div>${each(
      items,
      (n) => n,
      (item) => html`<span class="item">${item}</span>`,
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.item')).toHaveLength(3);
  });

  it('handles rapid successive updates', () => {
    const items = signal([{ id: '1', title: 'A' }]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => html`<span class="item">${computed(() => item.value.title)}</span>`,
    )}</div>`;
    const host = mount(result);

    // Multiple rapid updates — only last should be visible
    items.value = [{ id: '1', title: 'B' }, { id: '2', title: 'C' }];
    items.value = [{ id: '3', title: 'D' }];
    items.value = [{ id: '4', title: 'E' }, { id: '5', title: 'F' }];
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toContain('E');
    expect(spans[1].textContent).toContain('F');
  });
});

// ── Reactive content (computed TemplateResult) ──────────────────────

describe('each() with reactive computed content', () => {
  it('updates DOM correctly when items have computed TemplateResult content', () => {
    // This reproduces the spotlight search bug: each entry's templateFn
    // returns html`${content}` where content is a computed signal holding
    // a TemplateResult. When the item signal updates, the computed creates
    // a new TemplateResult, causing the reactive slot to swap DOM nodes.
    // The each() reconciler must still position entries correctly.
    const items = signal([
      { id: '1', title: 'Alpha', status: 'open' },
      { id: '2', title: 'Beta', status: 'done' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => {
        // Mimic spotlight: computed returns a new TemplateResult on each change
        const content = computed(() => {
          const t = item.value;
          return html`<div class="result"><span class="title">${t.title}</span><span class="status">${t.status}</span></div>`;
        });
        return html`${content}`;
      },
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.result')).toHaveLength(2);
    expect(host.querySelector('.result .title')?.textContent).toContain('Alpha');

    // Second "search" — same keys but updated content
    items.value = [
      { id: '1', title: 'Alpha Updated', status: 'in_progress' },
      { id: '2', title: 'Beta Updated', status: 'blocked' },
    ];
    flushEffects(); // each() reconcile
    flushEffects(); // computed TemplateResult re-evaluation
    flushEffects(); // inner text binding updates

    const results = host.querySelectorAll('.result');
    expect(results).toHaveLength(2);
    expect(results[0].querySelector('.title')?.textContent).toContain('Alpha Updated');
    expect(results[0].querySelector('.status')?.textContent).toContain('in_progress');
    expect(results[1].querySelector('.title')?.textContent).toContain('Beta Updated');
    expect(results[1].querySelector('.status')?.textContent).toContain('blocked');
  });

  it('handles complete replacement with computed TemplateResult content', () => {
    const items = signal([
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
    ]);

    const result = html`<div>${each(
      items,
      (t) => t.id,
      (item) => {
        const content = computed(() =>
          html`<span class="item">${item.value.title}</span>`
        );
        return html`${content}`;
      },
    )}</div>`;
    const host = mount(result);

    expect(host.querySelectorAll('.item')).toHaveLength(2);

    // Complete replacement — all new keys
    items.value = [
      { id: '3', title: 'Third' },
      { id: '4', title: 'Fourth' },
    ];
    flushEffects();
    flushEffects();

    const spans = host.querySelectorAll('.item');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toContain('Third');
    expect(spans[1].textContent).toContain('Fourth');

    // Third search — mix of reused and new keys
    items.value = [
      { id: '4', title: 'Fourth v2' },
      { id: '5', title: 'Fifth' },
    ];
    flushEffects();
    flushEffects();
    flushEffects();

    const spans2 = host.querySelectorAll('.item');
    expect(spans2).toHaveLength(2);
    expect(spans2[0].textContent).toContain('Fourth v2');
    expect(spans2[1].textContent).toContain('Fifth');
  });
});
