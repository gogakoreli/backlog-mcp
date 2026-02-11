# 0013. Final Debt Resolution and Third-Party Web Component Bridge

**Date**: 2026-02-11
**Status**: Proposed
**Depends on**: [0012-migration-phase-14-final](./0012-migration-phase-14-final.md), [0003-migration-gaps-and-debt-tracker](./0003-migration-gaps-and-debt-tracker.md)

## Context

Phase 14 completed migration of all 14 components to the reactive framework.
One component was intentionally skipped: `md-block`, a third-party markdown
renderer by Lea Verou wrapping `marked`, `DOMPurify`, and `Prism`.

Two categories of work remain:

1. **Tracked debt** — HACK/GAP tags left behind during migration that should
   be cleaned up now that all components are reactive.
2. **Third-party integration** — md-block (and any future third-party web
   components) operates outside the reactive system, causing `queueMicrotask`
   hacks, document event bridges, and timing-fragile link interception.

This ADR resolves both: it catalogs all remaining debt, proposes a resolution
for each item, and designs a cohesive long-term approach for integrating
third-party web components into the reactive framework.

---

## Part 1: Remaining Tracked Debt

### Complete Inventory (grep for HACK:/GAP: across viewer/)

| # | Tag | Location | Description | Severity |
|---|-----|----------|-------------|----------|
| 1 | `HACK:DOC_EVENT` resource-open | main.ts:30-41 | md-block link clicks dispatch `resource-open` on document | LOW |
| 2 | `HACK:DOC_EVENT` resource-open | backlog-app.ts:11 | Comment documenting the bridge | — |
| 3 | `HACK:DOC_EVENT` resource-open | spotlight-search.ts:256 | Spotlight dispatches `resource-open` for MCP URIs | LOW |
| 4 | `HACK:DOC_EVENT` task-selected | activity-panel (noted in ADR 0012) | url-state uses document events | LOW |
| 5 | `HACK:EXPOSE` attr bridge | svg-icon.ts:41-46 | Reads HTML attributes into prop signals | LOW |
| 6 | `HACK:EXPOSE` .text setter | copy-button.ts:84-91 | Imperative `.text` property for dead code | LOW |
| 7 | `GAP:LINK_INTERCEPT` | resource-viewer.ts:101-125 | queueMicrotask to intercept md-block links | MEDIUM |

### Resolution Plan

#### Items 1-3: `HACK:DOC_EVENT resource-open`

**Root cause**: md-block renders links asynchronously. When a user clicks a
`file://` or `mcp://` link inside rendered markdown, the click handler in
md-block output dispatches a `resource-open` document event because md-block
has no access to `SplitPaneState`.

**Resolution**: The third-party bridge (Part 2) eliminates this entirely.
Once resource-viewer listens for md-block's `md-render` event and intercepts
links reactively, the document event bridge in main.ts can be deleted.

For spotlight-search.ts:256, this is unrelated to md-block — spotlight already
has access to `inject(SplitPaneState)`. Replace with a direct call:
```typescript
// Before:
document.dispatchEvent(new CustomEvent('resource-open', { detail: { uri: id } }));
// After:
splitState.openMcpResource(id);
```

#### Item 4: `HACK:DOC_EVENT task-selected`

**Root cause**: `UrlState` (used by `AppState`) reads/writes URL search params
reactively via `popstate` listener, but `activity-panel` still dispatches
`task-selected` on document for the URL to update.

**Resolution**: `UrlState` already backs `AppState.selectedTaskId`. When
activity-panel calls `app.selectTask(id)`, `UrlState` auto-updates the URL.
The document event dispatch in activity-panel is dead code — remove it.

#### Item 5: `HACK:EXPOSE svg-icon` attribute bridge

**Root cause**: When `<svg-icon src="..." size="...">` appears in raw HTML
strings (e.g., `html:inner` content from highlight results), the HTML parser
sets attributes, not framework props.

**Resolution**: Keep this bridge. It costs 3 lines, has no correctness risk,
and is the correct pattern for components that must work in both factory
composition AND raw HTML contexts. Rename the tag from `HACK:EXPOSE` to
`BRIDGE:ATTR` to indicate it's intentional, not debt.

#### Item 6: `HACK:EXPOSE copy-button .text` setter

**Root cause**: Comment says it exists for `utils/split-pane.ts` which is dead
code (replaced by `SplitPaneState` service).

**Resolution**: Delete the `.text` property setter. Verify `utils/split-pane.ts`
is actually dead and delete it too if so.

#### Item 7: `GAP:LINK_INTERCEPT` (the core problem)

**Root cause**: md-block renders asynchronously. The framework's template
engine has no visibility into when md-block finishes rendering its content.
`resource-viewer` uses `queueMicrotask` to race ahead and intercept links,
but this is timing-fragile.

**Resolution**: This is the primary motivation for the third-party bridge
design in Part 2.

---

## Part 2: Third-Party Web Component Integration

### Problem Statement

Third-party web components like `md-block` operate outside the reactive
framework's control. They:

1. **Render asynchronously** — the framework's synchronous template engine
   can't know when they're done
2. **Produce DOM the framework didn't create** — links, headings, code blocks
   rendered by `marked` are invisible to the template engine
3. **Dispatch their own events** — `md-render` CustomEvent, not framework
   Emitters
4. **Accept data via properties/attributes** — not via framework signals

This creates a boundary problem: reactive state flows INTO the third-party
component (markdown content), but the component's OUTPUT (rendered DOM, events)
has no path back into the reactive system.

### Design Constraints

- No rewriting md-block (it's 306 lines wrapping 3 libraries)
- No build-time transformation (framework principle: pure runtime)
- Must work for any third-party web component, not just md-block
- Must compose naturally with existing framework primitives
- Solution must be < 100 lines of framework code

---

### Proposal A: `bridge()` — Reactive Event-to-Signal Adapter

**Concept**: A framework primitive that listens for a DOM event on a host
element and converts it into a signal write, enabling the reactive system
to respond to third-party component lifecycle.

```typescript
// New framework primitive: bridge()
function bridge<T>(
  host: HTMLElement,
  eventName: string,
  selector: string,
  transform: (el: HTMLElement, event: Event) => T,
): ReadonlySignal<T>;
```

**Usage in resource-viewer**:
```typescript
// Listen for md-block's 'md-render' event → signal
const mdRendered = bridge(host, 'md-render', 'md-block', (mdBlock) => {
  // After md-block renders, extract all file/mcp links
  return Array.from(mdBlock.querySelectorAll('a[href^="file://"], a[href^="mcp://"]'));
});

// React to rendered links with a normal effect
effect(() => {
  const links = mdRendered.value;
  if (!links) return;
  for (const link of links) {
    if ((link as any).__intercepted) continue;
    (link as any).__intercepted = true;
    const href = link.getAttribute('href')!;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (href.startsWith('file://')) splitState.openResource(href.replace('file://', ''));
      else if (href.startsWith('mcp://')) splitState.openMcpResource(href);
    });
  }
});
```

**Implementation** (~40 lines in `framework/bridge.ts`):
```typescript
import { signal, type ReadonlySignal } from './signal.js';
import { hasContext, getCurrentComponent } from './context.js';

export function bridge<T>(
  host: HTMLElement,
  eventName: string,
  selector: string,
  transform: (el: HTMLElement, event: Event) => T,
): ReadonlySignal<T | null> {
  const result = signal<T | null>(null);

  const handler = (e: Event) => {
    const target = host.querySelector(selector);
    if (target) {
      result.value = transform(target as HTMLElement, e);
    }
  };

  host.addEventListener(eventName, handler);

  // Auto-dispose if inside component context
  if (hasContext()) {
    getCurrentComponent().addDisposer(() => {
      host.removeEventListener(eventName, handler);
    });
  }

  return result;
}
```

**Pros**:
- Generic: works for ANY third-party web component that emits events
- Composable: output is a signal, works with `effect()`, `computed()`, `when()`
- Small: ~40 lines, no new concepts
- Uses md-block's existing `md-render` event (already dispatched, currently unused)
- No mutation of the third-party component

**Cons**:
- One-directional: only handles OUTPUT from third-party components, not INPUT
- The `selector` parameter couples bridge to DOM structure
- Link interception still requires imperative `addEventListener` inside the effect
- Doesn't address the input side (setting `mdContent` reactively)

---

### Proposal B: `wrapThirdParty()` — Full Bidirectional Component Wrapper

**Concept**: A higher-order function that wraps a third-party web component
class, creating a new custom element that bridges signals in BOTH directions:
reactive props → attribute/property writes, and DOM events → signal reads.

```typescript
// New framework primitive: wrapThirdParty()
function wrapThirdParty<Props, Events>(config: {
  tagName: string;
  element: string;          // original tag name (e.g., 'md-block')
  props: (keyof Props)[];   // properties to forward reactively
  events?: {                // events to capture as signals
    [K in keyof Events]: {
      domEvent: string;
      transform: (el: HTMLElement, event: Event) => Events[K];
    };
  };
  onRender?: (host: HTMLElement, el: HTMLElement) => void;
}): ComponentFactory<Props>;
```

**Usage**:
```typescript
const ReactiveMdBlock = wrapThirdParty<
  { content: string },
  { rendered: HTMLAnchorElement[] }
>({
  tagName: 'reactive-md-block',
  element: 'md-block',
  props: ['content'],       // content signal → mdContent property
  events: {
    rendered: {
      domEvent: 'md-render',
      transform: (el) =>
        Array.from(el.querySelectorAll('a[href^="file://"], a[href^="mcp://"]')),
    },
  },
  onRender: (host, mdBlock) => {
    // Post-render processing (link interception, etc.)
  },
});

// Usage in resource-viewer template:
ReactiveMdBlock({ content: computed(() => data.value?.content || '') })
```

**Implementation** (~80 lines in `framework/wrap-third-party.ts`):
```typescript
import { signal, effect, isSignal, type Signal, type ReadonlySignal } from './signal.js';
import { component, type PropInput } from './component.js';
import { html } from './template.js';

interface WrapConfig<Props, Events> {
  tagName: string;
  element: string;
  props: (keyof Props)[];
  propMap?: Partial<Record<keyof Props, string>>; // rename props to element properties
  events?: {
    [K in keyof Events]: {
      domEvent: string;
      transform: (el: HTMLElement, event: Event) => Events[K];
    };
  };
  onRender?: (host: HTMLElement, el: HTMLElement) => void;
}

export function wrapThirdParty<
  Props extends Record<string, unknown> = Record<string, never>,
  Events extends Record<string, unknown> = Record<string, never>,
>(config: WrapConfig<Props, Events>) {
  return component<Props>(config.tagName, (props, host) => {
    // Create the inner third-party element
    const inner = document.createElement(config.element);
    host.appendChild(inner);

    // Forward reactive props → element properties
    for (const key of config.props) {
      const propName = config.propMap?.[key] ?? key;
      effect(() => {
        const sig = props[key] as Signal<unknown>;
        const value = sig.value;
        (inner as any)[propName as string] = value;
      });
    }

    // Capture events → signals (exposed on host for parent effects)
    if (config.events) {
      for (const [name, def] of Object.entries(config.events) as [string, any][]) {
        const eventSignal = signal<Events[string] | null>(null);
        inner.addEventListener(def.domEvent, (e: Event) => {
          eventSignal.value = def.transform(inner, e);
          config.onRender?.(host, inner);
        });
        // Expose as readable signal on host element
        (host as any)[`${name}$`] = eventSignal;
      }
    }

    return html``;  // inner element already appended
  });
}
```

**Pros**:
- Bidirectional: handles both input (props → properties) AND output (events → signals)
- Encapsulated: all md-block specifics live in the wrapper config, not scattered
- Reusable: works for any third-party web component (code editors, charts, etc.)
- Factory composition: `ReactiveMdBlock({ content: ... })` is type-safe
- Eliminates ALL md-block hacks: no queueMicrotask, no document event bridge

**Cons**:
- More framework code (~80 lines vs ~40 lines)
- Introduces a new wrapper element in the DOM (`<reactive-md-block>` containing `<md-block>`)
- The `onRender` callback is still imperative (link interception can't be purely declarative)
- Event signals exposed as `host.rendered$` is a naming convention, not type-enforced
- Over-engineered if md-block is the only third-party component we ever use

---

### Proposal C: `useHostEvent()` + Direct Property Effect (Minimal Composition)

**Concept**: Instead of a new abstraction, compose existing primitives. Add one
small utility (`useHostEvent`) and solve the rest with `effect()`.

```typescript
// New primitive: useHostEvent() — ~15 lines in framework/lifecycle.ts
function useHostEvent<E extends Event = Event>(
  target: EventTarget,
  eventName: string,
  handler: (event: E) => void,
): void;
```

**Usage in resource-viewer**:
```typescript
// Push content into md-block reactively via effect
effect(() => {
  const mdBlock = host.querySelector('md-block') as any;
  if (mdBlock && data.value?.content) {
    mdBlock.mdContent = data.value.content;
  }
});

// React to md-block's render completion
useHostEvent(host, 'md-render', () => {
  // md-render bubbles from md-block — intercept links after render
  host.querySelectorAll('a[href^="file://"], a[href^="mcp://"]').forEach(link => {
    if ((link as any).__intercepted) return;
    (link as any).__intercepted = true;
    const href = link.getAttribute('href')!;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (href.startsWith('file://')) splitState.openResource(href.replace('file://', ''));
      else if (href.startsWith('mcp://')) splitState.openMcpResource(href);
    });
  });
});
```

**Implementation** (~15 lines added to `framework/lifecycle.ts`):
```typescript
import { hasContext, getCurrentComponent } from './context.js';

export function useHostEvent<E extends Event = Event>(
  target: EventTarget,
  eventName: string,
  handler: (event: E) => void,
): void {
  target.addEventListener(eventName, handler as EventListener);
  if (hasContext()) {
    getCurrentComponent().addDisposer(() => {
      target.removeEventListener(eventName, handler as EventListener);
    });
  }
}
```

**Pros**:
- Smallest change: 15 lines, one new function
- No new abstractions or wrapper elements
- Uses md-block's existing `md-render` event (bubbles up, already dispatched)
- `useHostEvent` is generally useful beyond md-block (keyboard shortcuts, resize, etc.)
- No DOM structure change — md-block stays in the template as `<md-block>`
- Composable with existing `effect()` for the input side

**Cons**:
- Not encapsulated: md-block integration logic is spread across resource-viewer
  and task-detail rather than centralized in a wrapper
- Still requires imperative link interception inside the event handler
- The `effect()` for setting `mdContent` uses `host.querySelector()` (same
  pattern as the old `HACK:REF`, though now there's `ref()` to improve this)
- Doesn't provide a reusable pattern if more third-party components are added

---

### Decision: Proposal C (useHostEvent + direct property effect)

**Rationale**:

1. **Minimum viable solution**: md-block is currently the ONLY third-party web
   component. Designing a generic wrapper system (Proposal B) for a single
   consumer violates the framework's design principle of "don't design for
   hypothetical future requirements."

2. **Already has the key hook**: md-block dispatches `md-render` as a bubbling
   CustomEvent. This is the exact integration point we need — we just aren't
   using it. `useHostEvent` makes it lifecycle-safe.

3. **`useHostEvent` is independently useful**: It auto-disposes event listeners
   on component disconnect. This benefits keyboard shortcuts (backlog-app.ts:154
   currently uses `onMount` + manual cleanup), SSE subscriptions, and any
   host-level DOM event.

4. **Upgrade path exists**: If a second third-party component is ever needed,
   Proposal B's `wrapThirdParty()` can be built ON TOP of `useHostEvent` without
   breaking changes. The primitives compose.

5. **No DOM structure change**: Proposals A and B add wrapper elements or change
   how md-block is instantiated. Proposal C keeps `<md-block>` exactly where it
   is in the template — zero risk of CSS/layout regression.

### What changes:

| File | Change |
|------|--------|
| `framework/lifecycle.ts` | Add `useHostEvent()` (~15 lines) |
| `resource-viewer.ts` | Replace `GAP:LINK_INTERCEPT` queueMicrotask with `useHostEvent(host, 'md-render', ...)` |
| `task-detail.ts` | Add `useHostEvent(host, 'md-render', ...)` for link interception if task description has links |
| `main.ts` | Delete `resource-open` document event bridge (lines 29-41) |
| `spotlight-search.ts` | Replace `document.dispatchEvent('resource-open')` with `splitState.openMcpResource()` |
| `copy-button.ts` | Delete `HACK:EXPOSE .text` setter (lines 84-91) |
| `activity-panel.ts` | Remove dead `task-selected` document event dispatch |
| `svg-icon.ts` | Rename `HACK:EXPOSE` → `BRIDGE:ATTR` (intentional, not debt) |

---

## Part 3: Migration Finalization Checklist

After implementing the changes above, the migration is **complete**. This
checklist defines "done":

### Zero remaining HACK tags
- [ ] No `HACK:DOC_EVENT` in any file
- [ ] No `HACK:EXPOSE` in any file (svg-icon renamed to `BRIDGE:ATTR`)
- [ ] No `HACK:MOUNT_APPEND` in any file
- [ ] No `HACK:CROSS_QUERY` in any file
- [ ] No `GAP:LINK_INTERCEPT` in any file

### Document event bridge
- [ ] `main.ts` has zero `document.addEventListener` calls for component events
- [ ] No component dispatches `CustomEvent` on `document` (only on `host` or via Emitter)
- [ ] Exception: md-block's own `md-render` event (third-party, bubbles naturally)

### Dead code removal
- [ ] `utils/split-pane.ts` deleted (replaced by `SplitPaneState` service)
- [ ] No `(host as any).methodName =` patterns remain

### Framework primitive inventory (post-migration)
| Primitive | Source | Lines |
|-----------|--------|-------|
| `signal()`, `computed()`, `effect()`, `batch()` | signal.ts | ~250 |
| `component()`, `PropInput`, `HostAttrs` | component.ts | ~180 |
| `html`, `when()`, `each()` | template.ts | ~600 |
| `inject()`, `provide()` | injector.ts | ~60 |
| `query()` | query.ts | ~120 |
| `onMount()`, `onCleanup()`, `useHostEvent()` | lifecycle.ts | ~60 |
| `Emitter<T>` | emitter.ts | ~40 |
| `ref()` | template.ts (inline) | ~10 |
| **Total** | | **~1,320** |

---

## Appendix: Why Not Rewrite md-block

It would be tempting to rewrite md-block as a reactive `component()`. Here's
why that's worse than bridging:

1. **306 lines of library glue**: md-block wraps `marked` (tokenizer config,
   custom extensions, renderer overrides), `DOMPurify` (sanitization with
   stale-content detection), and optionally `Prism`. This is not "our code" —
   it's configuration of three third-party libraries.

2. **Async rendering model**: `marked.parse()` is synchronous but DOMPurify
   may race with content changes. The existing stale-content guard (lines
   112-119) handles this correctly. Rewriting risks subtle timing bugs.

3. **The framework's template engine is synchronous**: `component()` setup
   runs once, effects are synchronous. md-block's async `render()` method
   (which can be re-triggered by `attributeChangedCallback`) doesn't fit
   the setup-once model.

4. **The bridge approach is strictly additive**: We add 15 lines to the
   framework and ~20 lines per consumer. We remove ~30 lines of hacks. Net
   change is near zero, with improved correctness.

5. **Future-proof**: If md-block is ever replaced (e.g., with a different
   markdown renderer), only the `useHostEvent` handlers change — not the
   framework.
