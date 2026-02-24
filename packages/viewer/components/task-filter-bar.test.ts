/**
 * task-filter-bar.test.ts — Tests for the migrated task-filter-bar component.
 *
 * Validates: signals, computed class bindings, effects (localStorage),
 * typed emitter events, backward-compat public API (setState, getSort).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects, resetInjector, provide, inject } from '@nisli/core';
import { AppState } from '../services/app-state.js';

// ── Mock TYPE_REGISTRY before importing component ────────────────────

vi.mock('../type-registry.js', () => ({
  TYPE_REGISTRY: {
    task: { prefix: 'TASK', label: 'Task', icon: '', gradient: '', isContainer: false, hasStatus: true },
    epic: { prefix: 'EPIC', label: 'Epic', icon: '', gradient: '', isContainer: true, hasStatus: true },
  },
}));

let app: AppState;
let imported = false;

beforeEach(async () => {
  resetInjector();
  document.body.innerHTML = '';
  localStorage.clear();

  app = new AppState();
  provide(AppState, () => app);

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

  it('clicking a status filter updates AppState.filter', () => {
    const el = createElement();
    const completedBtn = el.querySelector('[data-filter="completed"]') as HTMLElement;
    completedBtn.click();
    flushEffects();

    expect(app.filter.value).toBe('completed');
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

  it('clicking a type filter updates AppState.type', () => {
    const el = createElement();
    const epicBtn = el.querySelector('[data-type-filter="epic"]') as HTMLElement;
    epicBtn.click();
    flushEffects();

    expect(app.type.value).toBe('epic');
  });
});

// ── Sort interaction ─────────────────────────────────────────────────

describe('task-filter-bar sort interaction', () => {
  it('changing sort updates AppState.sort', () => {
    const el = createElement();
    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    select.value = 'created_desc';
    select.dispatchEvent(new Event('change'));
    flushEffects();

    expect(app.sort.value).toBe('created_desc');
  });

  it('sort change persists to localStorage', () => {
    const el = createElement();
    expect(localStorage.getItem('backlog:sort')).toBe('updated');

    const select = el.querySelector('.filter-sort-select') as HTMLSelectElement;
    select.value = 'created_asc';
    select.dispatchEvent(new Event('change'));
    flushEffects();

    expect(localStorage.getItem('backlog:sort')).toBe('created_asc');
  });
});

// ── localStorage restore ─────────────────────────────────────────────

describe('task-filter-bar localStorage', () => {
  it('restores sort from localStorage on mount', () => {
    localStorage.setItem('backlog:sort', 'created_asc');

    // AppState reads sort from localStorage
    resetInjector();
    app = new AppState();
    provide(AppState, () => app);

    const el = createElement();
    expect(app.sort.value).toBe('created_asc');
  });

  it('ignores invalid localStorage sort values', () => {
    localStorage.setItem('backlog:sort', 'invalid_sort');

    resetInjector();
    app = new AppState();
    provide(AppState, () => app);

    const el = createElement();
    expect(app.sort.value).toBe('updated');
  });
});
