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
  isSignal,
  effect,
  computed,
  type Signal,
  type ReadonlySignal,
} from './signal.js';

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

interface ChildBinding {
  type: 'child';
  startMarker: Comment;
  endMarker: Comment;
  currentNodes: Node[];
  dispose?: () => void;
}

type Binding = TextBinding | AttributeBinding | ClassBinding | EventBinding | ChildBinding;

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
      // Build the HTML string with markers
      let htmlStr = '';
      for (let i = 0; i < strings.length; i++) {
        htmlStr += strings[i];
        if (i < values.length) {
          const raw = strings.raw[i];
          // Check if we're inside an attribute (look for = before the slot)
          // We'll handle this in the binding phase
          htmlStr += createMarker(i);
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

function replaceMarkerWithBinding(
  comment: Comment,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  const parent = comment.parentNode;
  if (!parent) return;

  if (isSignal(value)) {
    // Create a text node bound to the signal
    const textNode = document.createTextNode(String(value.value));
    parent.replaceChild(textNode, comment);

    const binding: TextBinding = { type: 'text', node: textNode };
    bindings.push(binding);

    const dispose = effect(() => {
      textNode.data = String((value as ReadonlySignal<unknown>).value);
    });
    binding.dispose = dispose;
    disposers.push(dispose);
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
    const factory = value as { tagName: string; props: Record<string, Signal<unknown>>; children?: TemplateResult };
    const el = document.createElement(factory.tagName);
    for (const [key, sig] of Object.entries(factory.props)) {
      if (isSignal(sig)) {
        (el as any)._setProp?.(key, sig.value);
        const unsub = sig.subscribe((newVal: unknown) => {
          (el as any)._setProp?.(key, newVal);
        });
        disposers.push(unsub);
      } else {
        (el as any)._setProp?.(key, sig);
      }
    }
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
  // Auto-resolution: framework components get _setProp for custom props
  // (preserves types). Standard HTML attributes (class, id, style, data-*,
  // aria-*) always use setAttribute even on framework components.
  const isHtmlAttr = name === 'class' || name === 'id' || name === 'style'
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
 */
export function when(
  condition: unknown,
  template: TemplateResult,
): TemplateResult | null {
  if (isSignal(condition)) {
    // For signal conditions, we need reactive switching
    // Return a special marker that the parent template will handle
    return (condition as ReadonlySignal<unknown>).value ? template : null;
  }
  return condition ? template : null;
}
