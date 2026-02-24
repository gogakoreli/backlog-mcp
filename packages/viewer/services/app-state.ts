/**
 * AppState — Application state composed from UrlState + derived state.
 *
 * - URL signals: delegated to UrlState (filter, type, id, q)
 * - Scope: derived from selectedTaskId (container → self, null → null, leaf → unchanged)
 * - Sort: persisted to localStorage (not in URL)
 *
 * See ADR 0007 for design rationale.
 */
import { signal, effect } from '@nisli/core';
import { getTypeFromId } from '@backlog-mcp/shared';
import { getTypeConfig } from '../type-registry.js';
import { UrlState } from './url-state.js';

const SCOPE_STORAGE_KEY = 'backlog:sidebar-scope';
const SORT_STORAGE_KEY = 'backlog:sort';
const VALID_SORTS = ['updated', 'created_desc', 'created_asc'];

function loadSavedSort(): string {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved && VALID_SORTS.includes(saved)) return saved;
  } catch { /* */ }
  return 'updated';
}

export class AppState {
  private readonly url = new UrlState();

  // ── URL-backed (delegated to UrlState) ───────────────────────────
  readonly filter = this.url.filter;
  readonly type = this.url.type;
  readonly selectedTaskId = this.url.id;
  readonly query = this.url.q;

  // ── Local state ──────────────────────────────────────────────────
  readonly sort = signal(loadSavedSort());
  readonly scopeId = signal<string | null>(null);
  readonly isSystemInfoOpen = signal(false);
  readonly isSpotlightOpen = signal(false);

  constructor() {
    // Derive scope from initial URL id
    this.deriveScope(this.selectedTaskId.value);

    // Restore scope from localStorage if still unresolved (leaf task on refresh)
    if (!this.scopeId.value) {
      try { this.scopeId.value = localStorage.getItem(SCOPE_STORAGE_KEY); }
      catch { /* */ }
    }

    // Derive scope on URL navigation (popstate / programmatic)
    effect(() => {
      this.deriveScope(this.selectedTaskId.value);
    });

    // Persist scope to localStorage
    effect(() => {
      try {
        const scope = this.scopeId.value;
        if (scope) localStorage.setItem(SCOPE_STORAGE_KEY, scope);
        else localStorage.removeItem(SCOPE_STORAGE_KEY);
      } catch { /* */ }
    });

    // Persist sort to localStorage
    effect(() => {
      try { localStorage.setItem(SORT_STORAGE_KEY, this.sort.value); }
      catch { /* */ }
    });
  }

  /** Select a task; auto-scopes into containers. */
  selectTask(id: string) {
    this.selectedTaskId.value = id;
    this.deriveScope(id);
  }

  /**
   * Derive scope from selectedTaskId:
   *   null      → clear scope
   *   container → scope into it
   *   leaf      → unchanged (task-list resolves parent from data)
   */
  private deriveScope(id: string | null) {
    if (!id) {
      this.scopeId.value = null;
    } else if (getTypeConfig(getTypeFromId(id)).isContainer) {
      this.scopeId.value = id;
    }
  }
}
