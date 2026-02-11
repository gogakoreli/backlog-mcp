/**
 * template.ts — Tagged template engine with targeted DOM binding
 *
 * The html tagged template literal parses HTML with expression slots,
 * creates bindings for signals, and produces a TemplateResult that
 * can be mounted into the DOM with surgical updates.
 *
 * Two phases:
 * 1. First render: parse template, clone, create bindings, mount
 * 2. Updates: signal changes trigger individual binding updates (O(1))
 */

import {
  signal,
  isSignal,
  effect,
  computed,
  type Signal,
  type ReadonlySignal,
} from './signal.js';
import { isRef, type Ref } from './ref.js';

// ── Types ───────────────────────────────────────────────────────────

export interface TemplateResult {
  /** Mount this template into a host element */
  mount(host: HTMLElement): void;
  /** Dispose all bindings and effects */
  dispose(): void;
  /** Brand for type checking */
  __templateResult: true;
}

// ── Template cache ──────────────────────────────────────────────────

/**
 * Cache parsed templates by their static string parts.
 * Since tagged templates always produce the same static strings array
 * reference per call site, we use WeakMap for efficient caching.
 */
const templateCache = new WeakMap<TemplateStringsArray, HTMLTemplateElement>();

// ── Marker for expression slots ─────────────────────────────────────

const MARKER_PREFIX = '<!--bk-';
const MARKER_SUFFIX = '-->';
const ATTR_MARKER = 'bk-';

/**
 * Generate a unique marker for each expression slot.
 * We use HTML comments as markers in text positions and
 * special attribute prefixes for attribute positions.
 */
function createMarker(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}

// ── Binding types ───────────────────────────────────────────────────

interface TextBinding {
  type: 'text';
  node: Text;
  dispose?: () => void;
}

interface AttributeBinding {
  type: 'attribute';
  element: Element;
  name: string;
  dispose?: () => void;
}

interface ClassBinding {
  type: 'class';
  element: Element;
  className: string;
  dispose?: () => void;
}

interface EventBinding {
  type: 'event';
  element: Element;
  eventName: string;
  handler: EventListener;
  modifiers: string[];
}

interface InnerHtmlBinding {
  type: 'innerHtml';
  element: Element;
  dispose?: () => void;
}

interface ChildBinding {
  type: 'child';
  startMarker: Comment;
  endMarker: Comment;
  currentNodes: Node[];
  dispose?: () => void;
}

type Binding = TextBinding | AttributeBinding | ClassBinding | EventBinding | InnerHtmlBinding | ChildBinding;

// ── html tagged template ────────────────────────────────────────────

/**
 * Tagged template literal for creating reactive DOM templates.
 *
 * ```ts
 * const name = signal('World');
 * const greeting = html`<h1>Hello, ${name}!</h1>`;
 * ```
 *
 * Signals in expression slots are detected automatically and
 * create fine-grained bindings. When the signal changes, only
 * the specific text node or attribute updates — no diffing needed.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): TemplateResult {
  const bindings: Binding[] = [];
  const disposers: (() => void)[] = [];

  return {
    __templateResult: true as const,

    mount(host: HTMLElement): void {
      // Build the HTML string with markers.
      // Track HTML parsing state to auto-quote markers in unquoted
      // attribute positions where the > in --> would close the tag.
      // See ADR 0069.
      let htmlStr = '';
      let inTag = false;
      let quoteChar: string | null = null;

      for (let i = 0; i < strings.length; i++) {
        const s = strings[i];
        for (let c = 0; c < s.length; c++) {
          const ch = s[c];
          if (quoteChar) { if (ch === quoteChar) quoteChar = null; }
          else if (inTag) {
            if (ch === '>') inTag = false;
            else if (ch === '"' || ch === "'") quoteChar = ch;
          } else { if (ch === '<') inTag = true; }
        }
        htmlStr += s;
        if (i < values.length) {
          const needsQuotes = inTag && !quoteChar && /=\s*$/.test(s);
          htmlStr += needsQuotes ? `"${createMarker(i)}"` : createMarker(i);
        }
      }

      // Parse the HTML
      const template = document.createElement('template');
      template.innerHTML = htmlStr;
      const fragment = template.content.cloneNode(true) as DocumentFragment;

      // Walk the DOM tree and replace markers with bindings
      processNode(fragment, values, bindings, disposers);

      // Mount into host
      host.appendChild(fragment);
    },

    dispose(): void {
      for (const d of disposers) {
        try { d(); } catch (_) {}
      }
      disposers.length = 0;
      for (const b of bindings) {
        if ('dispose' in b && b.dispose) {
          try { b.dispose(); } catch (_) {}
        }
      }
      bindings.length = 0;
    },
  };
}

// ── DOM walking and binding creation ────────────────────────────────

function processNode(
  node: Node,
  values: unknown[],
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  // Process element attributes
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    processAttributes(el, values, bindings, disposers);
  }

  // Process text nodes and comments (markers)
  if (node.nodeType === Node.COMMENT_NODE) {
    const comment = node as Comment;
    const text = comment.textContent || '';
    // Check if this is one of our markers
    if (text.startsWith('bk-') && !isNaN(Number(text.slice(3)))) {
      const index = Number(text.slice(3));
      const value = values[index];
      replaceMarkerWithBinding(comment, value, bindings, disposers);
      return; // Don't recurse into replaced content
    }
  }

  // Process child nodes (make a copy since we may mutate)
  const children = [...node.childNodes];
  for (const child of children) {
    processNode(child, values, bindings, disposers);
  }
}

function processAttributes(
  el: Element,
  values: unknown[],
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  // We need to find attributes that contain markers
  const attrsToRemove: string[] = [];

  for (const attr of [...el.attributes]) {
    const name = attr.name;
    const attrValue = attr.value;

    // Check for @event bindings
    if (name.startsWith('@')) {
      const eventParts = name.slice(1).split('.');
      const eventName = eventParts[0];
      const modifiers = eventParts.slice(1);

      // The value should be a marker containing the handler
      const markerMatch = attrValue.match(/<!--bk-(\d+)-->/);
      if (markerMatch) {
        const index = Number(markerMatch[1]);
        const handler = values[index];
        if (typeof handler === 'function') {
          bindEvent(el, eventName, handler as EventListener, modifiers, bindings);
          disposers.push(() => el.removeEventListener(eventName, handler as EventListener));
        }
      }
      attrsToRemove.push(name);
      continue;
    }

    // Check for class:name bindings
    if (name.startsWith('class:')) {
      const className = name.slice(6);
      const markerMatch = attrValue.match(/<!--bk-(\d+)-->/);
      if (markerMatch) {
        const index = Number(markerMatch[1]);
        const value = values[index];
        bindClass(el, className, value, bindings, disposers);
      }
      attrsToRemove.push(name);
      continue;
    }

    // Check for html:inner binding (trusted HTML rendering)
    if (name === 'html:inner') {
      const markerMatch = attrValue.match(/<!--bk-(\d+)-->/);
      if (markerMatch) {
        const index = Number(markerMatch[1]);
        const value = values[index];
        bindInnerHtml(el, value, bindings, disposers);
      }
      attrsToRemove.push(name);
      continue;
    }

    // Check for ref binding: ref="${myRef}"
    if (name === 'ref' && attrValue.includes(MARKER_PREFIX)) {
      const markerMatch = attrValue.match(/<!--bk-(\d+)-->/);
      if (markerMatch) {
        const index = Number(markerMatch[1]);
        const value = values[index];
        if (isRef(value)) {
          (value as Ref).current = el;
          disposers.push(() => { (value as Ref).current = null; });
        }
      }
      attrsToRemove.push(name);
      continue;
    }

    // Check for regular attribute bindings with markers
    if (attrValue.includes(MARKER_PREFIX)) {
      const markers = [...attrValue.matchAll(/<!--bk-(\d+)-->/g)];
      if (markers.length) {
        // Single expression = entire value: preserve raw type and signal
        if (markers.length === 1 && attrValue === markers[0][0]) {
          bindAttribute(el, name, values[Number(markers[0][1])], bindings, disposers);
        } else {
          // Mixed static + dynamic: resolve markers into string
          const resolve = () => attrValue.replace(/<!--bk-(\d+)-->/g, (_, i) => {
            const v = values[Number(i)];
            const raw = isSignal(v) ? (v as ReadonlySignal<unknown>).value : v;
            return raw == null || raw === false ? '' : String(raw);
          });
          const hasSignals = markers.some(m => isSignal(values[Number(m[1])]));
          bindAttribute(el, name, hasSignals ? computed(resolve) : resolve(), bindings, disposers);
        }
      }
      continue;
    }
  }

  for (const name of attrsToRemove) {
    el.removeAttribute(name);
  }
}

/**
 * Mount a factory result (from component() factory functions) into a DOM element.
 * Handles prop forwarding (with signal subscriptions) and host-level class attrs.
 */
function mountFactoryResult(
  factory: { tagName: string; props: Record<string, unknown>; hostAttrs?: { class?: unknown } },
  disposers: (() => void)[],
): HTMLElement {
  const el = document.createElement(factory.tagName);
  for (const [key, raw] of Object.entries(factory.props)) {
    if (isSignal(raw)) {
      const sig = raw as ReadonlySignal<unknown>;
      (el as any)._setProp?.(key, sig.value);
      const unsub = sig.subscribe((newVal: unknown) => {
        (el as any)._setProp?.(key, newVal);
      });
      disposers.push(unsub);
    } else {
      (el as any)._setProp?.(key, raw);
    }
  }
  if (factory.hostAttrs?.class != null) {
    const classVal = factory.hostAttrs.class;
    if (isSignal(classVal)) {
      const sig = classVal as ReadonlySignal<string>;
      let prevClasses: string[] = [];
      const applyClasses = (raw: string) => {
        const next = raw ? raw.split(/\s+/).filter(Boolean) : [];
        for (const cls of prevClasses) {
          if (!next.includes(cls)) el.classList.remove(cls);
        }
        for (const cls of next) {
          if (!prevClasses.includes(cls)) el.classList.add(cls);
        }
        prevClasses = next;
      };
      applyClasses(sig.value);
      const unsub = sig.subscribe(applyClasses);
      disposers.push(unsub);
    } else if (typeof classVal === 'string' && classVal) {
      for (const cls of classVal.split(/\s+/).filter(Boolean)) {
        el.classList.add(cls);
      }
    }
  }
  return el;
}

function replaceMarkerWithBinding(
  comment: Comment,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  const parent = comment.parentNode;
  if (!parent) return;

  if (isSignal(value)) {
    const signalValue = (value as ReadonlySignal<unknown>).value;

    // Check if the signal holds a TemplateResult, factory, null, undefined, or array
    // (e.g., from reactive when(), computed(() => items.map(renderFn)), or factory results)
    const isReactiveSlot = signalValue === null || signalValue === undefined
      || (signalValue && typeof signalValue === 'object' && '__templateResult' in signalValue)
      || (signalValue && typeof signalValue === 'object' && '__type' in signalValue)
      || Array.isArray(signalValue);

    if (isReactiveSlot) {
      // Reactive template slot — mount/unmount templates as signal changes
      const startMarker = document.createComment('slot-start');
      const endMarker = document.createComment('slot-end');
      parent.replaceChild(endMarker, comment);
      parent.insertBefore(startMarker, endMarker);

      let currentResults: TemplateResult[] = [];
      let currentNodes: Node[] = [];

      const dispose = effect(() => {
        const newValue = (value as ReadonlySignal<unknown>).value;
        // Use endMarker.parentNode — the captured `parent` may be a
        // DocumentFragment that was already appended to the real DOM,
        // leaving the markers reparented under the actual DOM element.
        const liveParent = endMarker.parentNode;
        if (!liveParent) return;

        // Remove previous content
        for (const r of currentResults) {
          try { r.dispose(); } catch (_) {}
        }
        for (const node of currentNodes) {
          node.parentNode?.removeChild(node);
        }
        currentNodes = [];
        currentResults = [];

        if (newValue == null) {
          // null/undefined — nothing to mount
        } else if (Array.isArray(newValue)) {
          // Array of TemplateResults (or mixed content)
          for (const item of newValue) {
            if (item && typeof item === 'object' && '__templateResult' in item) {
              const tpl = item as TemplateResult;
              const wrapper = document.createDocumentFragment();
              tpl.mount(wrapper as unknown as HTMLElement);
              const nodes = [...wrapper.childNodes];
              currentNodes.push(...nodes);
              currentResults.push(tpl);
              liveParent.insertBefore(wrapper, endMarker);
            } else if (item && typeof item === 'object' && '__type' in item && (item as any).__type === 'factory') {
              const el = mountFactoryResult(item as any, disposers);
              currentNodes.push(el);
              liveParent.insertBefore(el, endMarker);
            } else if (item != null && item !== false) {
              const textNode = document.createTextNode(String(item));
              currentNodes.push(textNode);
              liveParent.insertBefore(textNode, endMarker);
            }
          }
        } else if (typeof newValue === 'object' && '__templateResult' in newValue) {
          // Single TemplateResult
          const tpl = newValue as TemplateResult;
          const wrapper = document.createDocumentFragment();
          tpl.mount(wrapper as unknown as HTMLElement);
          currentNodes = [...wrapper.childNodes];
          currentResults.push(tpl);
          liveParent.insertBefore(wrapper, endMarker);
        } else if (typeof newValue === 'object' && '__type' in newValue && (newValue as any).__type === 'factory') {
          // Factory result — create child element
          const el = mountFactoryResult(newValue as any, disposers);
          currentNodes.push(el);
          liveParent.insertBefore(el, endMarker);
        }
      });
      disposers.push(dispose);
    } else {
      // Primitive signal — create a reactive text node
      const textNode = document.createTextNode(String(signalValue));
      parent.replaceChild(textNode, comment);

      const binding: TextBinding = { type: 'text', node: textNode };
      bindings.push(binding);

      const dispose = effect(() => {
        textNode.data = String((value as ReadonlySignal<unknown>).value);
      });
      binding.dispose = dispose;
      disposers.push(dispose);
    }
  } else if (value && typeof value === 'object' && '__templateResult' in value) {
    // Nested template result — mount it
    const result = value as TemplateResult;
    const startMarker = document.createComment('tpl-start');
    const endMarker = document.createComment('tpl-end');
    parent.replaceChild(endMarker, comment);
    parent.insertBefore(startMarker, endMarker);

    // Create a wrapper element to mount into
    const wrapper = document.createDocumentFragment();
    result.mount(wrapper as unknown as HTMLElement);
    parent.insertBefore(wrapper, endMarker);

    disposers.push(() => result.dispose());
  } else if (value && typeof value === 'object' && '__type' in value && (value as any).__type === 'factory') {
    // Factory result — create child element
    const el = mountFactoryResult(value as any, disposers);
    parent.replaceChild(el, comment);
  } else if (Array.isArray(value)) {
    // Array of template results
    const startMarker = document.createComment('list-start');
    const endMarker = document.createComment('list-end');
    parent.replaceChild(endMarker, comment);
    parent.insertBefore(startMarker, endMarker);

    for (const item of value) {
      if (item && typeof item === 'object' && '__templateResult' in item) {
        const wrapper = document.createDocumentFragment();
        (item as TemplateResult).mount(wrapper as unknown as HTMLElement);
        parent.insertBefore(wrapper, endMarker);
        disposers.push(() => (item as TemplateResult).dispose());
      } else {
        const textNode = document.createTextNode(String(item));
        parent.insertBefore(textNode, endMarker);
      }
    }
  } else if (value == null || value === false) {
    // null, undefined, false — render nothing
    parent.removeChild(comment);
  } else {
    // Primitive value — render as text
    const textNode = document.createTextNode(String(value));
    parent.replaceChild(textNode, comment);
  }
}

function bindAttribute(
  el: Element,
  name: string,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  // class attribute gets special handling to avoid conflicts with
  // class:name directives (see bindClassAttribute for details).
  if (name === 'class') {
    bindClassAttribute(el, value, bindings, disposers);
    return;
  }

  // Auto-resolution: framework components get _setProp for custom props
  // (preserves types). Standard HTML attributes (id, style, data-*,
  // aria-*) always use setAttribute even on framework components.
  const isHtmlAttr = name === 'id' || name === 'style'
    || name === 'slot' || name.startsWith('data-') || name.startsWith('aria-');
  const hasPropSetter = !isHtmlAttr && typeof (el as any)._setProp === 'function';

  if (hasPropSetter) {
    if (isSignal(value)) {
      const binding: AttributeBinding = { type: 'attribute', element: el, name };
      bindings.push(binding);
      const dispose = effect(() => {
        (el as any)._setProp(name, (value as ReadonlySignal<unknown>).value);
      });
      binding.dispose = dispose;
      disposers.push(dispose);
    } else {
      (el as any)._setProp(name, value);
    }
    return;
  }

  if (isSignal(value)) {
    const binding: AttributeBinding = { type: 'attribute', element: el, name };
    bindings.push(binding);

    const dispose = effect(() => {
      const v = (value as ReadonlySignal<unknown>).value;
      if (v == null || v === false) {
        el.removeAttribute(name);
      } else if (v === true) {
        el.setAttribute(name, '');
      } else {
        el.setAttribute(name, String(v));
      }
    });
    binding.dispose = dispose;
    disposers.push(dispose);
  } else {
    if (value == null || value === false) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, String(value));
    }
  }
}

/**
 * Bind a reactive class attribute using classList.add/remove instead of
 * setAttribute('class', ...). This prevents the class attribute binding
 * from overwriting classes toggled by class:name directives.
 *
 * The problem: setAttribute('class', 'foo bar') replaces ALL classes,
 * wiping out any classes added by classList.toggle() from class:name
 * bindings. By tracking which classes "belong" to the class attribute
 * and using classList operations, we only manage our own classes.
 */
function bindClassAttribute(
  el: Element,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  // On first call, we must clear the parser-set class attribute which
  // contains raw marker text (e.g. "badge status-<!--bk-0-->").
  // We snapshot any non-marker classes set by the parser before clearing.
  let initialized = false;
  let prevClasses: string[] = [];

  const applyClasses = (raw: unknown) => {
    if (!initialized) {
      // Clear the parser's class attribute (contains marker text)
      el.setAttribute('class', '');
      initialized = true;
    }
    const str = raw == null || raw === false ? '' : String(raw);
    const next = str.split(/\s+/).filter(Boolean);

    // Remove classes no longer in the attribute value
    for (const cls of prevClasses) {
      if (!next.includes(cls)) {
        el.classList.remove(cls);
      }
    }
    // Add new classes
    for (const cls of next) {
      if (!prevClasses.includes(cls)) {
        el.classList.add(cls);
      }
    }
    prevClasses = next;
  };

  if (isSignal(value)) {
    const binding: AttributeBinding = { type: 'attribute', element: el, name: 'class' };
    bindings.push(binding);

    const dispose = effect(() => {
      applyClasses((value as ReadonlySignal<unknown>).value);
    });
    binding.dispose = dispose;
    disposers.push(dispose);
  } else {
    applyClasses(value);
  }
}

function bindClass(
  el: Element,
  className: string,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  if (isSignal(value)) {
    const binding: ClassBinding = { type: 'class', element: el, className };
    bindings.push(binding);

    const dispose = effect(() => {
      const v = (value as ReadonlySignal<unknown>).value;
      el.classList.toggle(className, !!v);
    });
    binding.dispose = dispose;
    disposers.push(dispose);
  } else {
    el.classList.toggle(className, !!value);
  }
}

/**
 * Bind trusted HTML content to an element's innerHTML.
 *
 * WARNING: This is for trusted content only (e.g., highlighted search results
 * from @orama/highlight, diff2html output). NEVER use with user-generated input.
 *
 * Supports both static strings and reactive Signal<string> values.
 * When the signal changes, innerHTML is updated reactively.
 *
 * Usage in templates:
 *   html`<span html:inner="${highlightedHtml}"></span>`
 */
function bindInnerHtml(
  el: Element,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  if (isSignal(value)) {
    const binding: InnerHtmlBinding = { type: 'innerHtml', element: el };
    bindings.push(binding);

    const dispose = effect(() => {
      const v = (value as ReadonlySignal<unknown>).value;
      el.innerHTML = v == null ? '' : String(v);
    });
    binding.dispose = dispose;
    disposers.push(dispose);
  } else {
    el.innerHTML = value == null ? '' : String(value);
  }
}

function bindEvent(
  el: Element,
  eventName: string,
  handler: EventListener,
  modifiers: string[],
  bindings: Binding[],
): void {
  let wrappedHandler: EventListener = handler;

  // Apply modifiers
  if (modifiers.includes('stop')) {
    const original = wrappedHandler;
    wrappedHandler = (e: Event) => {
      e.stopPropagation();
      original(e);
    };
  }
  if (modifiers.includes('prevent')) {
    const original = wrappedHandler;
    wrappedHandler = (e: Event) => {
      e.preventDefault();
      original(e);
    };
  }
  if (modifiers.includes('once')) {
    const original = wrappedHandler;
    wrappedHandler = (e: Event) => {
      el.removeEventListener(eventName, wrappedHandler);
      original(e);
    };
  }

  // Keyboard modifiers
  for (const mod of modifiers) {
    if (['enter', 'escape', 'space', 'tab'].includes(mod)) {
      const keyMap: Record<string, string> = {
        enter: 'Enter',
        escape: 'Escape',
        space: ' ',
        tab: 'Tab',
      };
      const original = wrappedHandler;
      wrappedHandler = (e: Event) => {
        if ((e as KeyboardEvent).key === keyMap[mod]) {
          original(e);
        }
      };
    }
  }

  // Wrap in try/catch for error containment
  const safeHandler: EventListener = (e: Event) => {
    try {
      wrappedHandler(e);
    } catch (err) {
      console.error(`Event handler error for '${eventName}':`, err);
    }
  };

  el.addEventListener(eventName, safeHandler);

  bindings.push({
    type: 'event',
    element: el,
    eventName,
    handler: safeHandler,
    modifiers,
  });
}

/**
 * Conditional rendering helper.
 * Shows the template when condition is truthy.
 *
 * Supports both static and reactive (signal) conditions.
 * For signal conditions, returns a computed that reactively switches
 * between the template and null.
 *
 * The template argument can be a TemplateResult or a lazy callback
 * `() => TemplateResult` to avoid evaluating expensive branches.
 */
// ── each() reactive list rendering ──────────────────────────────────

/** Brand for each result detection */
const EACH_BRAND = Symbol.for('backlog.each');

interface EachEntry<T> {
  key: string | number;
  itemSignal: Signal<T>;
  indexSignal: Signal<number>;
  templateResult: TemplateResult;
  nodes: Node[];
}

/**
 * Reactive list rendering with keyed reconciliation.
 *
 * Renders a list of items from a signal, tracking each item by key.
 * When the array changes, only affected DOM nodes are added, removed,
 * or reordered — existing items update in-place via their signals.
 *
 * ```ts
 * const tasks = signal([{ id: '1', title: 'A' }, { id: '2', title: 'B' }]);
 * html`<ul>${each(tasks, t => t.id, (task, index) =>
 *   html`<li>${computed(() => task.value.title)}</li>`
 * )}</ul>`
 * ```
 */
export function each<T>(
  items: ReadonlySignal<T[]>,
  keyFn: (item: T, index: number) => string | number,
  templateFn: (item: ReadonlySignal<T>, index: ReadonlySignal<number>) => TemplateResult,
): TemplateResult {
  let startMarker: Comment;
  let endMarker: Comment;
  let entries: EachEntry<T>[] = [];
  let effectDispose: (() => void) | null = null;

  return {
    __templateResult: true as const,

    mount(host: HTMLElement) {
      startMarker = document.createComment('each-start');
      endMarker = document.createComment('each-end');
      host.appendChild(startMarker);
      host.appendChild(endMarker);

      effectDispose = effect(() => {
        const newItems = items.value;
        reconcile(newItems);
      });
    },

    dispose() {
      if (effectDispose) {
        effectDispose();
        effectDispose = null;
      }
      for (const entry of entries) {
        entry.templateResult.dispose();
      }
      entries = [];
    },
  };

  function reconcile(newItems: T[]) {
    const parent = endMarker.parentNode;
    if (!parent) return;

    // Build old key → entry map
    const oldMap = new Map<string | number, EachEntry<T>>();
    for (const entry of entries) {
      oldMap.set(entry.key, entry);
    }

    // Build new entries list
    const newEntries: EachEntry<T>[] = [];
    const newKeys = new Set<string | number>();

    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      const key = keyFn(item, i);
      newKeys.add(key);

      const existing = oldMap.get(key);
      if (existing) {
        // Reuse — update signals in place
        existing.itemSignal.value = item;
        existing.indexSignal.value = i;
        newEntries.push(existing);
      } else {
        // Create new entry
        const itemSignal = signal(item) as Signal<T>;
        const indexSignal = signal(i);
        const wrapper = document.createDocumentFragment();
        const templateResult = templateFn(itemSignal, indexSignal);
        templateResult.mount(wrapper as unknown as HTMLElement);
        const nodes = [...wrapper.childNodes];
        newEntries.push({ key, itemSignal, indexSignal, templateResult, nodes });
      }
    }

    // Remove entries whose key is gone
    for (const entry of entries) {
      if (!newKeys.has(entry.key)) {
        entry.templateResult.dispose();
        for (const node of entry.nodes) {
          node.parentNode?.removeChild(node);
        }
      }
    }

    // Reorder DOM nodes to match new order
    // Walk newEntries and ensure each entry's nodes are in the right position
    let cursor: Node = startMarker;
    for (const entry of newEntries) {
      for (const node of entry.nodes) {
        const nextSibling = cursor.nextSibling;
        if (nextSibling !== node) {
          parent.insertBefore(node, nextSibling);
        }
        cursor = node;
      }
    }

    entries = newEntries;
  }
}

export function when(
  condition: unknown,
  template: TemplateResult | (() => TemplateResult),
): TemplateResult | ReadonlySignal<TemplateResult | null> | null {
  const resolveTemplate = () =>
    typeof template === 'function' ? template() : template;

  if (isSignal(condition)) {
    // Reactive: return a computed that re-evaluates when the signal changes
    return computed(() =>
      (condition as ReadonlySignal<unknown>).value ? resolveTemplate() : null
    );
  }
  return condition ? resolveTemplate() : null;
}
