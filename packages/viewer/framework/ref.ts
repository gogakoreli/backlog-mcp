/**
 * ref.ts — Element reference primitive for imperative DOM access
 *
 * `ref()` creates a container that receives a DOM element reference
 * after the template is mounted. Use it for focus management, DOM
 * measurement, scroll management, and third-party library init.
 *
 * ```ts
 * const inputRef = ref<HTMLInputElement>();
 *
 * onMount(() => inputRef.current?.focus());
 *
 * return html`<input ${inputRef} @keydown.enter=${onSubmit} />`;
 * ```
 *
 * The template engine detects `Ref` objects in expression positions
 * (not inside attribute values) and assigns the nearest parent element.
 */

// ── Brand for ref detection in templates ─────────────────────────────

export const REF_BRAND = Symbol.for('backlog.ref');

// ── Types ───────────────────────────────────────────────────────────

export interface Ref<T extends Element = Element> {
  readonly [REF_BRAND]: true;
  /** The DOM element, or null before mount / after unmount */
  current: T | null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Create a ref container for imperative DOM access.
 *
 * After the template is mounted, `ref.current` holds the element.
 * After dispose, `ref.current` is set back to null.
 */
export function ref<T extends Element = Element>(): Ref<T> {
  return {
    [REF_BRAND]: true as const,
    current: null,
  };
}

/**
 * Check if a value is a Ref.
 * Used by the template engine to detect refs in expression slots.
 */
export function isRef(value: unknown): value is Ref {
  return (
    value !== null &&
    typeof value === 'object' &&
    REF_BRAND in (value as Record<symbol, unknown>)
  );
}
