/**
 * component.ts — Web component shell with typed props and factory composition
 *
 * `component()` is the single entry point for defining components.
 * It registers a custom element and returns a typed factory function.
 *
 * Component authors write a setup function that receives typed props
 * (each wrapped as a Signal) and optionally the host element.
 * The setup function returns a TemplateResult from html`...`.
 *
 * The class internals (connectedCallback, etc.) are completely hidden.
 */

import { signal, effect, setContextHook, isSignal, untrack, type Signal, type ReadonlySignal } from './signal.js';
import { runWithContext, hasContext, getCurrentComponent, type ComponentHost } from './context.js';
import type { TemplateResult } from './template.js';
import { runMountCallbacks } from './lifecycle.js';

// Wire up effect auto-disposal: when effect() is called during component setup,
// auto-register the dispose function with the component host.
setContextHook(() => {
  if (hasContext()) {
    const comp = getCurrentComponent();
    return (disposer: () => void) => comp.addDisposer(disposer);
  }
  return null;
});

// ── Types ───────────────────────────────────────────────────────────

/**
 * Maps a props interface to reactive signals.
 * Each prop `P[K]` becomes `Signal<P[K]>`.
 */
export type ReactiveProps<P> = {
  readonly [K in keyof P]: Signal<P[K]>;
};

/**
 * The setup function signature. Receives reactive props and host element.
 * Returns a TemplateResult to be mounted into the component.
 */
export type SetupFunction<P> = (
  props: ReactiveProps<P>,
  host: HTMLElement,
) => TemplateResult;

/**
 * Accepts either a Signal<T> (reactive) or a plain T (static, auto-wrapped).
 * This eliminates the need to wrap static values in `signal()` at call sites.
 * See ADR 0009 Gap 4.
 */
export type PropInput<T> = T | Signal<T> | ReadonlySignal<T>;

/**
 * Host-level attributes that every factory accepts, independent of component props.
 * `class` is applied to the host element via classList — it does not collide with
 * the component's own class attribute or class:name directives.
 * See ADR 0009 Gap 3.
 */
export interface HostAttrs {
  class?: PropInput<string>;
}

/**
 * A factory function for type-safe component composition.
 * Props accept both Signal<T> (reactive) and plain T (static, auto-wrapped).
 * An optional second argument provides host-level attributes (class).
 */
export type ComponentFactory<P> = (
  props: { [K in keyof P]: PropInput<P[K]> },
  hostAttrs?: HostAttrs,
) => TemplateResult;

/** Options for component() registration */
export interface ComponentOptions {
  /** Custom error fallback renderer */
  onError?: (error: Error, host: HTMLElement) => TemplateResult | string;
}

// ── Internal component host ─────────────────────────────────────────

class ComponentHostImpl implements ComponentHost {
  element: HTMLElement;
  private disposers: (() => void)[] = [];
  private setupComplete = false;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  addDisposer(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    for (const fn of this.disposers) {
      try { fn(); } catch (_) { /* swallow disposal errors */ }
    }
    this.disposers.length = 0;
  }
}

// ── Prop signal management via Proxy ────────────────────────────────

/**
 * Creates a Proxy-based props object that lazily creates signals
 * for each property on first access. When a parent sets a property
 * on the element, the Proxy intercepts it and updates (or creates)
 * the backing signal.
 */
function createPropsProxy<P>(): {
  props: ReactiveProps<P>;
  setProperty: (key: string, value: unknown) => void;
} {
  const signals = new Map<string, Signal<unknown>>();

  const getOrCreate = (key: string, initialValue?: unknown): Signal<unknown> => {
    let s = signals.get(key);
    if (!s) {
      s = signal(initialValue);
      signals.set(key, s);
    }
    return s;
  };

  const props = new Proxy({} as ReactiveProps<P>, {
    get(_target, key: string) {
      return getOrCreate(key);
    },
  });

  const setProperty = (key: string, value: unknown) => {
    const s = getOrCreate(key, value);
    s.value = value;
  };

  return { props, setProperty };
}

// ── component() — the main entry point ──────────────────────────────

/**
 * Define a web component with typed props and a setup function.
 *
 * Returns a typed factory function for compile-time-safe composition.
 *
 * ```ts
 * interface TaskItemProps {
 *   task: Task;
 *   selected: boolean;
 * }
 *
 * const TaskItem = component<TaskItemProps>('task-item', (props, host) => {
 *   const title = computed(() => props.task.value.title);
 *   return html`<div>${title}</div>`;
 * });
 *
 * // Factory usage:
 * TaskItem({ task: taskSignal, selected: isSelected })
 * ```
 */
export function component<P extends Record<string, unknown> = Record<string, never>>(
  tagName: string,
  setup: SetupFunction<P>,
  options?: ComponentOptions,
): ComponentFactory<P> {
  // The custom element class
  class FrameworkComponent extends HTMLElement {
    private _host: ComponentHostImpl | null = null;
    private _propsProxy: ReturnType<typeof createPropsProxy<P>> | null = null;
    private _mounted = false;
    private _templateResult: TemplateResult | null = null;

    constructor() {
      super();
      this._propsProxy = createPropsProxy<P>();
    }

    connectedCallback() {
      if (this._mounted) return; // guard against re-connection
      this._mounted = true;

      // Isolate activeObserver: child component setup signal reads must NOT
      // leak into a parent effect's dependency set. Without this, a parent
      // effect running replaceChildren/appendChild triggers child
      // connectedCallback synchronously, and child signal reads would be
      // tracked as parent dependencies — causing infinite re-render loops.
      // See ADR 0008 Gap 1 / ADR 0009.
      untrack(() => {
        const host = new ComponentHostImpl(this);
        this._host = host;

        try {
          runWithContext(host, () => {
            this._templateResult = setup(this._propsProxy!.props, this);
          });

          // Mount the template result
          if (this._templateResult) {
            mountTemplate(this, this._templateResult, host);
          }

          // Run onMount() callbacks — DOM is now committed
          runMountCallbacks(host);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`Component <${tagName}> setup error:`, error);

          if (options?.onError) {
            try {
              const fallback = options.onError(error, this);
              if (typeof fallback === 'string') {
                this.innerHTML = fallback;
              } else {
                mountTemplate(this, fallback);
              }
            } catch (_) {
              this.innerHTML = `<div style="color:red;padding:4px">Error in &lt;${tagName}&gt;</div>`;
            }
          } else {
            this.innerHTML = `<div style="color:red;padding:4px">Error in &lt;${tagName}&gt;</div>`;
          }
        }
      });
    }

    disconnectedCallback() {
      this._mounted = false;
      if (this._templateResult?.dispose) {
        this._templateResult.dispose();
      }
      if (this._host) {
        this._host.dispose();
        this._host = null;
      }
    }

    /**
     * Set a prop value. Called by the factory and by direct property assignment.
     * The Proxy intercepts and creates/updates backing signals.
     */
    _setProp(key: string, value: unknown): void {
      this._propsProxy?.setProperty(key, value);
    }
  }

  // Register the custom element (if not already registered)
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FrameworkComponent);
  }

  // Return the typed factory function
  const factory: ComponentFactory<P> = (props, hostAttrs?) => {
    return {
      __type: 'factory' as const,
      tagName,
      props: props as Record<string, PropInput<unknown>>,
      hostAttrs,
    } as unknown as TemplateResult;
  };

  return factory;
}

/**
 * Ensure a value is a signal. If it already is, return as-is.
 * If it's a plain value, wrap it in signal().
 * Used by factory mount to support PropInput<T> = T | Signal<T>.
 */
function ensureSignal<T>(value: PropInput<T>): ReadonlySignal<T> {
  if (isSignal(value)) return value as ReadonlySignal<T>;
  return signal(value as T);
}

/**
 * Mount a TemplateResult into a host element.
 * This is the bridge between component.ts and template.ts.
 * Template.ts will provide the actual implementation via the
 * TemplateResult.mount() method.
 *
 * @param hostImpl — optional ComponentHostImpl for registering disposers
 */
function mountTemplate(host: HTMLElement, result: TemplateResult, hostImpl?: ComponentHostImpl): void {
  if (result && typeof result === 'object' && 'mount' in result && typeof result.mount === 'function') {
    result.mount(host);
  } else if (result && typeof result === 'object' && '__type' in result) {
    // Factory result — create the child element
    const factoryResult = result as unknown as {
      __type: 'factory';
      tagName: string;
      props: Record<string, PropInput<unknown>>;
      hostAttrs?: HostAttrs;
    };
    const el = document.createElement(factoryResult.tagName);

    // Forward props as signals (auto-wrap plain values)
    for (const [key, raw] of Object.entries(factoryResult.props)) {
      const sig = ensureSignal(raw);
      (el as any)._setProp(key, sig.value);
      // Subscribe to signal changes to update the child's props
      const unsub = sig.subscribe((newVal: unknown) => {
        (el as any)._setProp(key, newVal);
      });
      // Register unsub for cleanup on disconnect
      if (hostImpl) {
        hostImpl.addDisposer(unsub);
      }
    }

    // Apply host-level attributes (class)
    if (factoryResult.hostAttrs?.class != null) {
      const classSig = ensureSignal(factoryResult.hostAttrs.class);
      // Apply initial value
      applyHostClass(el, '', classSig.value);
      // Subscribe to reactive changes
      let prevClass = classSig.value;
      const unsub = classSig.subscribe((newClass: string) => {
        applyHostClass(el, prevClass, newClass);
        prevClass = newClass;
      });
      if (hostImpl) {
        hostImpl.addDisposer(unsub);
      }
    }

    host.appendChild(el);
  }
}

/**
 * Apply a class string to an element via classList, replacing the previous
 * class string's classes. Uses add/remove to avoid interfering with classes
 * set by the component's own template (class:name directives, etc.).
 */
function applyHostClass(el: Element, prev: string, next: string): void {
  const prevClasses = prev ? prev.split(/\s+/).filter(Boolean) : [];
  const nextClasses = next ? next.split(/\s+/).filter(Boolean) : [];
  for (const cls of prevClasses) {
    if (!nextClasses.includes(cls)) el.classList.remove(cls);
  }
  for (const cls of nextClasses) {
    if (!prevClasses.includes(cls)) el.classList.add(cls);
  }
}
