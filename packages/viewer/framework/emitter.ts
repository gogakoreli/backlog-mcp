/**
 * emitter.ts — Typed pub/sub base class for services.
 *
 * Replaces `document.dispatchEvent(new CustomEvent(...))` with typed,
 * scoped event emitters. Services extend Emitter<T> where T defines
 * the event contract as a record of event names → payload types.
 *
 * ```ts
 * class NavigationEvents extends Emitter<{
 *   select: { id: string };
 *   filter: { filter: string };
 * }> {}
 *
 * const nav = inject(NavigationEvents);
 * nav.emit('select', { id: 'TASK-1' });           // typed
 * nav.on('select', ({ id }) => console.log(id));   // typed
 * const selectedId = nav.toSignal('select', e => e.id, null);
 * ```
 */

import { signal, type Signal } from './signal.js';
import { hasContext, getCurrentComponent } from './context.js';

// ── Types ───────────────────────────────────────────────────────────

type EventMap = Record<string, unknown>;
type Listener<T> = (payload: T) => void;

// ── Emitter base class ──────────────────────────────────────────────

export class Emitter<Events extends EventMap> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  /**
   * Emit a typed event. All subscribers for this event name are called
   * synchronously. If a subscriber throws, other subscribers still fire.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;

    // Iterate a copy to allow unsubscribe during callback
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Emitter: subscriber for '${String(event)}' threw:`, err);
      }
    }
  }

  /**
   * Subscribe to a typed event. Returns an unsubscribe function.
   *
   * If called during component setup, the subscription is automatically
   * disposed on disconnectedCallback.
   */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);

    const unsubscribe = () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(event);
      }
    };

    // Auto-dispose if inside component setup context
    if (hasContext()) {
      getCurrentComponent().addDisposer(unsubscribe);
    }

    return unsubscribe;
  }

  /**
   * Bridge an event into the signal system.
   * Returns a signal that updates whenever the event fires.
   *
   * @param event - Event name to subscribe to
   * @param selector - Transform the payload into the signal value
   * @param initial - Initial signal value before any event fires
   */
  toSignal<K extends keyof Events, V>(
    event: K,
    selector: (payload: Events[K]) => V,
    initial: V,
  ): Signal<V> {
    const s = signal(initial);
    this.on(event, (payload) => {
      s.value = selector(payload);
    });
    return s;
  }

  /**
   * Remove all subscribers. Useful for testing cleanup.
   */
  clear(): void {
    this.listeners.clear();
  }
}
