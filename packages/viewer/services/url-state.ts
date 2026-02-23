/**
 * UrlState — Reactive URL state service.
 *
 * Clean separation: owns ONLY the URL ↔ signal sync.
 * Reads URL → signals. Writes signals → URL. Handles popstate.
 * No localStorage, no scope derivation, no domain logic.
 */
import { signal, effect } from '@framework/signal.js';

export class UrlState {
  readonly filter = signal('active');
  readonly type = signal('all');
  readonly id = signal<string | null>(null);
  readonly q = signal<string | null>(null);

  constructor() {
    this.readUrl();
    window.addEventListener('popstate', () => this.readUrl());

    effect(() => {
      const f = this.filter.value;
      const t = this.type.value;
      const id = this.id.value;
      const q = this.q.value;
      this.pushUrl(f, t, id, q);
    });
  }

  private readUrl() {
    const params = new URLSearchParams(window.location.search);

    // Backward compat: ?epic=&task= → ?id=
    if (params.has('epic') || params.has('task')) {
      const id = params.get('task') || params.get('epic');
      const url = new URL(window.location.href);
      url.searchParams.delete('epic');
      url.searchParams.delete('task');
      if (id) url.searchParams.set('id', id);
      history.replaceState(null, '', url);
      this.readUrl();
      return;
    }

    this.filter.value = params.get('filter') || 'active';
    this.type.value = params.get('type') || 'all';
    this.id.value = params.get('id');
    this.q.value = params.get('q');
  }

  private pushUrl(f: string, t: string, id: string | null, q: string | null) {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null, def?: string) => {
      if (v && v !== def) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    };
    set('filter', f, 'active');
    set('type', t, 'all');
    set('id', id);
    set('q', q);
    if (url.href !== window.location.href) {
      history.pushState(null, '', url);
    }
  }
}
