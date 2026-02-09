/**
 * task-item.test.ts — Tests for the migrated task-item component.
 *
 * Validates: rendering from props, click handlers,
 * bubbling event dispatch, conditional template elements.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects } from '../framework/signal.js';
import { resetInjector } from '../framework/injector.js';

// ── Mock dependencies ────────────────────────────────────────────────

vi.mock('../type-registry.js', () => {
  const configs: Record<string, any> = {
    task: { prefix: 'TASK', label: 'Task', icon: '', gradient: '', isContainer: false, hasStatus: true },
    epic: { prefix: 'EPIC', label: 'Epic', icon: '', gradient: '', isContainer: true, hasStatus: true },
    milestone: { prefix: 'MLST', label: 'Milestone', icon: '', gradient: '', isContainer: true, hasStatus: true },
    folder: { prefix: 'FLDR', label: 'Folder', icon: '', gradient: '', isContainer: true, hasStatus: false },
  };
  return {
    getTypeFromId: (id: string) => {
      for (const [type, config] of Object.entries(configs)) {
        if (id.startsWith(config.prefix + '-')) return type;
      }
      return 'task';
    },
    getTypeConfig: (type: string) => configs[type] || configs.task,
  };
});

vi.mock('../utils/sidebar-scope.js', () => ({
  sidebarScope: { set: vi.fn(), get: vi.fn() },
}));

let imported = false;

beforeEach(async () => {
  resetInjector();
  document.body.innerHTML = '';

  if (!imported) {
    await import('./task-badge.js');
    await import('./task-item.js');
    imported = true;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

function createTaskItem(props: Record<string, unknown> = {}): HTMLElement {
  const defaults: Record<string, unknown> = {
    id: 'TASK-0001',
    title: 'Test task',
    status: 'open',
    type: 'task',
    childCount: 0,
    dueDate: '',
    selected: false,
    currentEpic: false,
  };
  const merged = { ...defaults, ...props };
  const el = document.createElement('task-item');
  for (const [key, val] of Object.entries(merged)) {
    (el as any)._setProp(key, val);
  }
  document.body.appendChild(el);
  flushEffects();
  return el;
}

// ── Rendering ────────────────────────────────────────────────────────

describe('task-item rendering', () => {
  it('renders task title', () => {
    const el = createTaskItem({ title: 'My Test Task' });
    const title = el.querySelector('.task-title');
    expect(title?.textContent).toContain('My Test Task');
  });

  it('renders task-badge with correct id', () => {
    const el = createTaskItem({ id: 'TASK-0042' });
    const badge = el.querySelector('task-badge');
    expect(badge?.getAttribute('task-id')).toBe('TASK-0042');
  });

  it('renders status badge for status-bearing types', () => {
    const el = createTaskItem({ status: 'in_progress', type: 'task' });
    const status = el.querySelector('.status-badge');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('in progress');
    expect(status?.classList.contains('status-in_progress')).toBe(true);
  });

  it('does not render status badge for non-status types', () => {
    const el = createTaskItem({ type: 'folder' });
    const status = el.querySelector('.status-badge');
    expect(status).toBeNull();
  });

  it('renders child count for container types', () => {
    const el = createTaskItem({ type: 'epic', childCount: 5 });
    const count = el.querySelector('.child-count');
    expect(count).not.toBeNull();
    expect(count?.textContent).toContain('5');
  });

  it('does not render child count for leaf types', () => {
    const el = createTaskItem({ type: 'task' });
    const count = el.querySelector('.child-count');
    expect(count).toBeNull();
  });

  it('renders enter icon for containers that are not current epic', () => {
    const el = createTaskItem({ type: 'epic' });
    const enter = el.querySelector('.enter-icon');
    expect(enter).not.toBeNull();
  });

  it('does not render enter icon when current epic', () => {
    const el = createTaskItem({ type: 'epic', currentEpic: true });
    const enter = el.querySelector('.enter-icon');
    expect(enter).toBeNull();
  });

  it('renders selected class when selected prop is true', () => {
    const el = createTaskItem({ selected: true });
    const inner = el.querySelector('.task-item');
    expect(inner?.classList.contains('selected')).toBe(true);
  });

  it('renders due date badge for milestones with due date', () => {
    const el = createTaskItem({ type: 'milestone', dueDate: '2026-03-15' });
    const badge = el.querySelector('.due-date-badge');
    expect(badge).not.toBeNull();
  });

  it('sets host className to task-item-wrapper', () => {
    const el = createTaskItem();
    expect(el.className).toBe('task-item-wrapper');
  });
});

// ── Click behavior ───────────────────────────────────────────────────

describe('task-item click behavior', () => {
  it('clicking item dispatches task-select bubbling event', () => {
    const el = createTaskItem({ id: 'TASK-0099' });
    const handler = vi.fn();
    // Listen on document — event should bubble up
    document.addEventListener('task-select', handler);

    const inner = el.querySelector('.task-item') as HTMLElement;
    inner.click();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.taskId).toBe('TASK-0099');

    document.removeEventListener('task-select', handler);
  });

  it('clicking enter icon dispatches scope-enter bubbling event', () => {
    const el = createTaskItem({ type: 'epic', id: 'EPIC-0001' });
    const handler = vi.fn();
    document.addEventListener('scope-enter', handler);

    const enter = el.querySelector('.enter-icon') as HTMLElement;
    enter.click();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.scopeId).toBe('EPIC-0001');

    document.removeEventListener('scope-enter', handler);
  });

  it('clicking enter icon does not trigger task-select', () => {
    const el = createTaskItem({ type: 'epic', id: 'EPIC-0001' });
    const handler = vi.fn();
    document.addEventListener('task-select', handler);

    const enter = el.querySelector('.enter-icon') as HTMLElement;
    enter.click();

    expect(handler).not.toHaveBeenCalled();

    document.removeEventListener('task-select', handler);
  });
});
