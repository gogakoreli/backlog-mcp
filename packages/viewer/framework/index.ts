/**
 * viewer/framework/ — Public API barrel export
 *
 * This is the single import point for all framework primitives.
 *
 * ```ts
 * import {
 *   signal, computed, effect, flush,
 *   component, html, when,
 *   inject, provide,
 *   Emitter,
 *   query, QueryClient,
 * } from './framework';
 * ```
 */

// ── Reactivity ──────────────────────────────────────────────────────
export {
  signal,
  computed,
  effect,
  flush,
  isSignal,
  flushEffects,
  untrack,
  SIGNAL_BRAND,
  type Signal,
  type ReadonlySignal,
} from './signal.js';

// ── Setup context ───────────────────────────────────────────────────
export {
  runWithContext,
  getCurrentComponent,
  hasContext,
  type ComponentHost,
} from './context.js';

// ── Typed event emitters ────────────────────────────────────────────
export { Emitter } from './emitter.js';

// ── Dependency injection ────────────────────────────────────────────
export {
  inject,
  provide,
  createToken,
  resetInjector,
  type Constructor,
  type InjectionToken,
} from './injector.js';

// ── Component model ─────────────────────────────────────────────────
export {
  component,
  type ReactiveProps,
  type SetupFunction,
  type ComponentFactory,
  type ComponentOptions,
  type PropInput,
  type HostAttrs,
} from './component.js';

// ── Template engine ─────────────────────────────────────────────────
export {
  html,
  when,
  each,
  type TemplateResult,
} from './template.js';

// ── Element refs ────────────────────────────────────────────────────
export {
  ref,
  isRef,
  type Ref,
} from './ref.js';

// ── Lifecycle hooks ─────────────────────────────────────────────────
export {
  onMount,
  onCleanup,
} from './lifecycle.js';

// ── Declarative data loading ────────────────────────────────────────
export {
  query,
  QueryClient,
  type QueryResult,
  type QueryOptions,
} from './query.js';
