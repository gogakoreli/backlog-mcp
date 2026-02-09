/**
 * task-filter-bar.test.ts — Tests for the migrated task-filter-bar component.
 *
 * Validates: signals, computed class bindings, effects (localStorage),
 * event dispatching, backward-compat public API (setState, getSort).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushEffects } from '../framework/signal.js';
import { resetInjector } from '../framework/injector.js';

// ── Mock TYPE_REGISTRY before importing component ────────────────────

vi.mock('../type-registry.js', () => ({
  TYPE_REGISTRY: {
    task: { prefix: 'TASK', label: 'Task', icon: '', gradient: '', isContainer: false, hasStatus: true },
    epic: { prefix: 'EPIC', label: 'Epic', icon: '', gradient: '', isContainer: true, hasStatus: true },
  },
}));

// Dynamic import after mock is set up
// The component self-registers via component() on import
let imported = false;

beforeEach(async () => {
  resetInjector();
  document.body.innerHTML = '';
  localStorage.clear();

  // Import once — component() guards against double registration
  if (!imported) {
    await import('./task-filter-bar.js');
    imported = true;
  }
});

// ── Helper ───────────────────────────────────────────────────────────

function createElement(): HTMLElement {
  const el = document.createElement('task-filter-bar');
  document.body.appendChild(el);
  flushEffects();
  return el;
}

// ── Rendering ────────────────────────────────────────────────────────

describe('task-filter-bar rendering', () => {
  it('renders status filter buttons', () => {
    const el = createElement();
    const buttons = el.querySelectorAll('[data-filter]');
    expect(buttons.length).toBe(3);

    const labels = [...buttons].map(b => b.textContent?.trim());
    expect(labels).toEqual(['Active', 'Completed', 'All']);
  });

  it('renders type filter buttons (All + registry types)', () => {
    const el = createElement();
    const buttons = el.querySelectorAll('[data-type-filter]');
    // 'All' + 'Task' + 'Epic' from mocked registry
    expect(buttons.length).toBe(3);

    const labels = [...buttons].map(b => b.textContent?.trim());
    expect(labels).toEqual(['All', 'Task', 'Epic']);
  });

  it('renders sort select with options', () => {
    const el = createElement();
    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    expect(select).not.toBeNull();

    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].value).toBe('updated');
    expect(options[1].value).toBe('created_desc');
    expect(options[2].value).toBe('created_asc');
  });

  it('default filter is "active" (has active class)', () => {
    const el = createElement();
    const activeBtn = el.querySelector('[data-filter="active"]');
    expect(activeBtn?.classList.contains('active')).toBe(true);

    const completedBtn = el.querySelector('[data-filter="completed"]');
    expect(completedBtn?.classList.contains('active')).toBe(false);
  });

  it('default type is "all" (has active class)', () => {
    const el = createElement();
    const allBtn = el.querySelector('[data-type-filter="all"]');
    expect(allBtn?.classList.contains('active')).toBe(true);
  });
});

// ── Filter interaction ───────────────────────────────────────────────

describe('task-filter-bar filter interaction', () => {
  it('clicking a status filter button updates active class', () => {
    const el = createElement();
    const completedBtn = el.querySelector('[data-filter="completed"]') as HTMLElement;
    completedBtn.click();
    flushEffects();

    expect(completedBtn.classList.contains('active')).toBe(true);
    const activeBtn = el.querySelector('[data-filter="active"]') as HTMLElement;
    expect(activeBtn.classList.contains('active')).toBe(false);
  });

  it('clicking a status filter dispatches filter-change on document', () => {
    const el = createElement();
    const handler = vi.fn();
    document.addEventListener('filter-change', handler);

    const completedBtn = el.querySelector('[data-filter="completed"]') as HTMLElement;
    completedBtn.click();
    flushEffects();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.filter).toBe('completed');
    expect(detail.type).toBe('all');
    expect(detail.sort).toBe('updated');

    document.removeEventListener('filter-change', handler);
  });

  it('clicking a type filter button updates active class', () => {
    const el = createElement();
    const taskBtn = el.querySelector('[data-type-filter="task"]') as HTMLElement;
    taskBtn.click();
    flushEffects();

    expect(taskBtn.classList.contains('active')).toBe(true);
    const allBtn = el.querySelector('[data-type-filter="all"]') as HTMLElement;
    expect(allBtn.classList.contains('active')).toBe(false);
  });

  it('clicking a type filter dispatches filter-change on document', () => {
    const el = createElement();
    const handler = vi.fn();
    document.addEventListener('filter-change', handler);

    const epicBtn = el.querySelector('[data-type-filter="epic"]') as HTMLElement;
    epicBtn.click();
    flushEffects();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.filter).toBe('active');
    expect(detail.type).toBe('epic');

    document.removeEventListener('filter-change', handler);
  });
});

// ── Sort interaction ─────────────────────────────────────────────────

describe('task-filter-bar sort interaction', () => {
  it('changing sort dispatches sort-change on document', () => {
    const el = createElement();
    const handler = vi.fn();
    document.addEventListener('sort-change', handler);

    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    select.value = 'created_desc';
    select.dispatchEvent(new Event('change'));
    flushEffects();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.sort).toBe('created_desc');

    document.removeEventListener('sort-change', handler);
  });

  it('sort change persists to localStorage', () => {
    const el = createElement();
    // Initial mount persists default sort
    expect(localStorage.getItem('backlog:sort')).toBe('updated');

    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    select.value = 'created_asc';
    select.dispatchEvent(new Event('change'));
    flushEffects();

    expect(localStorage.getItem('backlog:sort')).toBe('created_asc');
  });
});

// ── Backward-compat public API ───────────────────────────────────────

describe('task-filter-bar public API (backward compat)', () => {
  it('setState() updates the active filter', () => {
    const el = createElement() as any;
    el.setState('completed', 'all', null);
    flushEffects();

    const completedBtn = el.querySelector('[data-filter="completed"]') as HTMLElement;
    expect(completedBtn.classList.contains('active')).toBe(true);

    const activeBtn = el.querySelector('[data-filter="active"]') as HTMLElement;
    expect(activeBtn.classList.contains('active')).toBe(false);
  });

  it('getSort() returns current sort value', () => {
    const el = createElement() as any;
    expect(el.getSort()).toBe('updated');

    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    select.value = 'created_desc';
    select.dispatchEvent(new Event('change'));
    flushEffects();

    expect(el.getSort()).toBe('created_desc');
  });
});

// ── localStorage restore ─────────────────────────────────────────────

describe('task-filter-bar localStorage', () => {
  it('restores sort from localStorage on mount', () => {
    localStorage.setItem('backlog:sort', 'created_asc');

    const el = createElement() as any;
    expect(el.getSort()).toBe('created_asc');
  });

  it('ignores invalid localStorage sort values', () => {
    localStorage.setItem('backlog:sort', 'invalid_sort');

    const el = createElement() as any;
    // Invalid sort values are ignored, defaults to 'updated'
    expect(el.getSort()).toBe('updated');
  });
});
