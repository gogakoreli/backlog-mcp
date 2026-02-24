/**
 * context.ts — Setup context for pure function DI
 *
 * The setup context lets pure functions (inject(), listen(), effect())
 * access the component they belong to without needing `this`.
 *
 * The context exists ONLY during component initialization (setup()).
 * It is NOT a runtime thing — it's a synchronous initialization-time concept.
 *
 * Same pattern as Angular's inject(), Solid's createSignal(), Vue's setup().
 */

// ── Types ───────────────────────────────────────────────────────────

/**
 * Minimal interface for a component host. component.ts provides the
 * full implementation; this file only needs the disposal hook.
 */
export interface ComponentHost {
  /** Register a cleanup function to run on disconnectedCallback */
  addDisposer(fn: () => void): void;
  /** The raw HTMLElement */
  element: HTMLElement;
}

// ── Context state ───────────────────────────────────────────────────

let currentComponent: ComponentHost | null = null;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Run a function with a component as the active context.
 * Pure functions called during `fn` can access the component via
 * `getCurrentComponent()`.
 *
 * Context is strictly synchronous — it does NOT survive across
 * await boundaries or microtasks.
 */
export function runWithContext(component: ComponentHost, fn: () => void): void {
  const prev = currentComponent;
  currentComponent = component;
  try {
    fn();
  } finally {
    currentComponent = prev;
  }
}

/**
 * Get the currently active component host.
 * Throws if called outside a setup() context.
 *
 * This is framework-internal — component authors use inject(), effect(),
 * etc., which call this internally.
 */
export function getCurrentComponent(): ComponentHost {
  if (!currentComponent) {
    throw new Error(
      'getCurrentComponent() called outside setup(). ' +
      'inject(), effect(), and other context-dependent functions ' +
      'can only be called during component initialization.'
    );
  }
  return currentComponent;
}

/**
 * Check if there is an active setup context.
 * Returns true during component setup, false otherwise.
 */
export function hasContext(): boolean {
  return currentComponent !== null;
}
