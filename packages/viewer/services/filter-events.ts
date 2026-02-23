/**
 * filter-events.ts — Typed emitter for filter/sort/search changes.
 *
 * Replaces document CustomEvent strings (filter-change, sort-change,
 * search-change) with typed, DI-injected events per emitter-typed-events.
 */
import { Emitter } from '@framework/emitter.js';

export class FilterEvents extends Emitter<{
  'filter-change': { filter: string; type: string; sort: string };
  'sort-change': { sort: string };
  'search-change': { query: string | null };
}> {}
