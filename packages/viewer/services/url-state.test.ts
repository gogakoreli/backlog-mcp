/**
 * url-state.test.ts — Tests for UrlState URL↔signal sync.
 *
 * Key invariant (ADR 0015): readUrl() sets signals from URL params,
 * which triggers the pushUrl effect, but pushUrl's URL comparison
 * guard (`url.href !== window.location.href`) prevents echo writes.
 * No `pushing` flag needed.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects } from '@nisli/core';
import { UrlState } from './url-state.js';

// Stub window.location and history for JSDOM
function setLocation(search: string) {
  const url = new URL(`http://localhost${search}`);
  Object.defineProperty(window, 'location', {
    value: { href: url.href, search: url.search },
    writable: true,
    configurable: true,
  });
}

describe('UrlState', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setLocation('/');
    pushStateSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {});
  });

  it('readUrl sets signals from URL params', () => {
    setLocation('/?filter=done&type=epic&id=TASK-0001&q=hello');
    const state = new UrlState();
    flushEffects();

    expect(state.filter.value).toBe('done');
    expect(state.type.value).toBe('epic');
    expect(state.id.value).toBe('TASK-0001');
    expect(state.q.value).toBe('hello');
  });

  it('defaults when URL has no params', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();

    expect(state.filter.value).toBe('active');
    expect(state.type.value).toBe('all');
    expect(state.id.value).toBeNull();
    expect(state.q.value).toBeNull();
  });

  it('readUrl does not cause echo pushState (URL comparison guard)', () => {
    setLocation('/?filter=done&id=TASK-0001');
    const state = new UrlState();
    flushEffects();

    // readUrl sets signals → effect fires pushUrl → URL matches → no pushState
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('signal write triggers pushState when URL differs', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();
    pushStateSpy.mockClear();

    state.id.value = 'TASK-0042';
    flushEffects();

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const pushedUrl = String(pushStateSpy.mock.calls[0][2]);
    expect(pushedUrl).toContain('id=TASK-0042');
  });

  it('default values are omitted from URL', () => {
    setLocation('/');
    const state = new UrlState();
    flushEffects();
    pushStateSpy.mockClear();

    // Set non-default id, but keep filter/type at defaults
    state.id.value = 'EPIC-0001';
    flushEffects();

    const pushedUrl = new URL(String(pushStateSpy.mock.calls[0][2]));
    expect(pushedUrl.searchParams.has('filter')).toBe(false); // default, omitted
    expect(pushedUrl.searchParams.has('type')).toBe(false);   // default, omitted
    expect(pushedUrl.searchParams.get('id')).toBe('EPIC-0001');
  });
});
