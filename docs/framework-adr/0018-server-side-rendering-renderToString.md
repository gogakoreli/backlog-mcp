# 0018. Server-Side Rendering — Full SSR Pipeline for `@nisli/core`

**Date**: 2026-03-05
**Status**: Proposed
**Backlog Item**: TASK-0477

## Context

`@nisli/core` is a reactive web component framework using signals, tagged template literals, and custom elements. The `html()` tagged template builds an HTML string with comment markers (`<!--bk-N-->`), parses it into DOM via `<template>.innerHTML`, then walks the DOM tree to create reactive bindings. The `component()` function registers custom elements that run setup functions in `connectedCallback()`.

This architecture is entirely browser-dependent. SSG pipelines output empty custom element shells (`<my-component></my-component>`). Content is invisible until JavaScript loads and executes, causing a flash of empty content (FOEC), poor perceived performance, and broken SEO.

### Current Template Engine Flow

```
html`<div>${name}</div>`
  ↓ mount(host)
1. Build HTML string with markers:  "<div><!--bk-0--></div>"     ← DOM-free
2. Parse: template.innerHTML = htmlStr                            ← Requires DOM
3. Clone: template.content.cloneNode(true)                        ← Requires DOM
4. Walk DOM, replace markers with reactive bindings               ← Requires DOM
5. Append fragment to host                                        ← Requires DOM
```

### Key Architectural Insight

The string-building phase (step 1, lines 134-155 of `template.ts`) is already DOM-free — pure string concatenation with a state machine for auto-quoting (ADR 0069). The DOM dependency begins at step 2. For SSR, we resolve signal values into the string instead of inserting markers, and skip DOM entirely.

### Framework Philosophy Alignment

From ADR 0001 and the framework skill guide, the core design principles are:

- **Pure setup functions** — take props, return TemplateResult. No DOM access in setup itself.
- **Signals for reactivity** — fine-grained, automatic dependency tracking via `.value`
- **DI via `inject()`** — auto-singleton, synchronous, works without DOM
- **`effect()` is for side effects** — DOM, network, localStorage. NOT for derived state.
- **`onMount()` is for DOM access** — runs after template is mounted, explicitly client-only
- **Context is synchronous** — exists only during `setup()`, does not survive async boundaries

This philosophy maps cleanly to SSR. The framework already separates "setup-time" (pure, synchronous, no DOM) from "runtime" (DOM, async, effects). **SSR runs setup-time only.**

### Component System Coupling Points

The `component()` function has three browser-only dependencies:
1. `customElements.define()` — registers the element class
2. `HTMLElement` — base class for the component
3. `connectedCallback()` — lifecycle hook that runs setup and mounts template

### How Lit SSR Works (Reference Architecture)

Lit's SSR (`@lit-labs/ssr`) provides key design patterns we draw from:

1. **`RenderResult` is a sync iterable**, not a string. Contains strings, nested iterables, and optionally Promises. This enables streaming without async overhead. Convenience wrappers: `collectResult()` (async), `collectResultSync()` (sync, throws on Promise).

2. **Minimal DOM shim** — Lit provides `HTMLElement`, `customElements`, `Element.setAttribute()` etc. as lightweight stubs so the same component code runs on server. We take a different approach (environment-aware `component()`) because our template engine's string-building is already DOM-free.

3. **Hydration is a separate module** — `@lit-labs/ssr-client/lit-element-hydrate-support.js` must load BEFORE any component modules. It patches `LitElement` to detect SSR'd content. Clean separation of concerns.

4. **`isServer` flag** — `import { isServer } from 'lit'` lets components guard browser-only code.

5. **`defer-hydration` attribute** — server adds this to components. Removing it triggers hydration. Enables lazy/progressive hydration.

6. **Server lifecycle is minimal** — only `constructor()`, `willUpdate()`, and `render()` run on server. `connectedCallback()`, `updated()`, `firstUpdated()` are client-only.

7. **No async SSR** — no mechanism to wait for async results. Data must be pre-fetched before rendering. `until()` directive only renders the highest-priority non-promise fallback.

## Problem

The task requires four interconnected changes:

1. **`renderToString(templateResult)`** — serialize templates to HTML strings, resolving signals to `.value`
2. **Server-mode `component()`** — run setup functions without `customElements.define` or DOM APIs
3. **Hydration markers** — embed comment markers in SSR output for client reconnection
4. **Client hydration** — teach `.mount()` to detect existing SSR'd DOM and attach bindings without re-rendering

These form a pipeline. renderToString without component rendering can't SSR component trees. Component rendering without hydration means the client re-renders everything from scratch. Hydration without markers has nothing to reconnect to.

## Proposals Considered

### Option 1: Standalone `renderToString()` — Templates Only `[SHORT-TERM]` `[LOW]`

Server-only `html()` that resolves signals to values. No components, no hydration.

**Why it falls short**: Delivers 1 of 4 requirements. Can't render component trees. Without hydration, client re-renders from scratch — content → blank → re-rendered flash that's *worse* than no SSR. The "upgrade path to P2" is misleading — P1's `resolveValue()` strips to plain strings with no expression boundary awareness. Adding markers later is a rewrite, not an extension.

### Option 2: Server Component Registry + Hydration `[MEDIUM-TERM]` `[HIGH]`

Environment-aware `component()`, server rendering of full component trees with hydration markers, client `hydrate()` that reconnects bindings.

**Selected.** Delivers all 4 requirements. Designed as a pipeline from the start.

### Option 3: Universal Template IR `[LONG-TERM]` `[HIGH]`

Refactor `html()` to produce a renderer-agnostic IR consumed by pluggable renderers.

**Rejected.** Rewrites the rendering hot path for a framework with one consumer. Months before anything ships. Enormous blast radius. Can be revisited if multiple render targets are ever needed.

## Decision

**Option 2: Server Component Registry + Hydration**, delivered in 4 phases.

Each phase is architecturally aware of the full pipeline. Phase 1 code is designed with markers and components in mind, so later phases extend rather than rewrite.

## Design

### Core Primitives

#### `isServer` Flag

Exported from `@nisli/core`. Components use this to guard browser-only code.

```ts
// @nisli/core/server.ts sets this before any rendering
export let isServer = false;
export function setServerMode(value: boolean) { isServer = value; }
```

**Anti-pattern**: Do NOT use `isServer` to render *different* content. If server and client produce different HTML, hydration will mismatch. The only safe use is to *skip* code (effects, event listeners), not to change output.

```ts
// ❌ WRONG — hydration mismatch
const greeting = isServer ? 'Loading...' : 'Hello!';

// ✅ CORRECT — skip side effects, same output
component('my-comp', (props, host) => {
  const data = signal('Hello!');
  if (!isServer) {
    onMount(() => host.querySelector('input')?.focus());
  }
  return html`<div>${data}</div>`;
});
```

#### `RenderResult` as Sync Iterable (Inspired by Lit)

Instead of returning a plain string, the server `render()` produces a `RenderResult` — a sync iterable of string chunks. This enables streaming without async overhead.

```ts
export type RenderResult = Iterable<string | RenderResult>;

// Convenience wrappers
export function collectResultSync(result: RenderResult): string { ... }
export async function collectResult(result: RenderResult): Promise<string> { ... }

// Shorthand (most common use case)
export function renderToString(result: RenderResult): string {
  return collectResultSync(result);
}
```

Why iterable instead of string:
- **Streaming**: pipe to `Readable.from(result)` for HTTP streaming
- **Lazy evaluation**: nested components render on demand, not eagerly
- **Future async support**: can contain Promises for async data fetching (Phase 5+)

### Server Lifecycle Table

Explicitly documents what runs on server vs client. This is the contract that component authors must understand.

| Primitive | Server | Client | Notes |
|-----------|--------|--------|-------|
| `setup()` | ✅ YES | ✅ YES | The render function. Must be pure + synchronous. |
| `signal()` | ✅ YES | ✅ YES | Created, `.value` read once. No subscriptions. |
| `computed()` | ✅ YES | ✅ YES | Resolved immediately via `.value`. No lazy caching. |
| `effect()` | ❌ NO-OP | ✅ YES | Suppressed on server. Effects are side effects. |
| `inject()` | ✅ YES | ✅ YES | Singleton cache works. `resetInjector()` between renders. |
| `provide()` | ✅ YES | ✅ YES | Override services for server context. |
| `onMount()` | ⚠️ REGISTERED | ✅ YES | Callback registered but never invoked on server. |
| `onCleanup()` | ⚠️ REGISTERED | ✅ YES | Callback registered but never invoked on server. |
| `useHostEvent()` | ❌ NO-OP | ✅ YES | No EventTarget on server. Suppressed. |
| `html\`...\`` | ✅ SERVER VERSION | ✅ CLIENT VERSION | Server resolves values inline. Client creates bindings. |
| `when()` | ✅ YES | ✅ YES | Resolves to current branch. No reactivity. |
| `each()` | ✅ YES | ✅ YES | Resolves to current items. No reconciliation. |
| `query()` | ❌ NO | ✅ YES | Async data loading. Pre-fetch before SSR. |

### Entry Points

```
@nisli/core              — Client framework (existing, unchanged)
@nisli/core/server       — Server rendering: html(), render(), renderToString()
@nisli/core/hydrate      — Client hydration support (load BEFORE component modules)
```

Package exports in `package.json`:
```json
{
  "exports": {
    ".":        { "import": "./dist/index.js" },
    "./server": { "import": "./dist/server.js" },
    "./hydrate": { "import": "./dist/hydrate.js" }
  }
}
```

### Phase 1: Server `html()` + `render()`

Server `html()` resolves signals to values and produces string chunks. Designed with marker slots from day 1 — `resolveSlot()` takes an index parameter even though markers aren't emitted until Phase 3.

```ts
// packages/framework/src/server.ts
import { isSignal, type ReadonlySignal } from './signal.js';

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): RenderResult {
  return {
    *[Symbol.iterator]() {
      for (let i = 0; i < strings.length; i++) {
        yield strings[i] ?? '';
        if (i < values.length) {
          yield* resolveSlot(i, values[i]);
        }
      }
    },
  };
}
```

#### Value Resolution

```ts
function* resolveSlot(index: number, value: unknown): RenderResult {
  // Phase 3 hook: wrap with markers when hydrate option is set
  yield* resolveValue(value);
}

function* resolveValue(value: unknown): RenderResult {
  if (isSignal(value)) {
    yield* resolveValue((value as ReadonlySignal<unknown>).value);
  } else if (isServerTemplate(value)) {
    yield* value;  // Nested RenderResult — delegate iteration
  } else if (isServerComponent(value)) {
    yield* renderServerComponent(value);  // Phase 2
  } else if (Array.isArray(value)) {
    for (const item of value) yield* resolveValue(item);
  } else if (value == null || value === false) {
    // Render nothing
  } else if (typeof value === 'function') {
    // Event handler — strip
  } else {
    yield escapeHtml(String(value));
  }
}
```

**Note on HTML escaping**: The client `html()` uses `textNode.data = ...` which auto-escapes. The server `html()` must explicitly escape `<`, `>`, `&`, `"` in text content to prevent XSS. This is a divergence point — the server is stricter.

#### Attribute Handling

The server `html()` does NOT need the auto-quoting state machine from ADR 0069. That machine exists because comment markers (`<!--bk-N-->`) contain `>` which breaks unquoted attribute parsing. Server rendering resolves values inline — no comment markers, no `>` problem.

Directive handling in Phase 1:
- `@event` attributes: value resolves to `""` (function → empty). Attribute name `@click` is invalid HTML — browsers ignore it.
- `class:name` directives: value resolves to `"true"` or `"false"`. Phase 3 will resolve these to actual class application.
- `html:inner` directive: resolves the signal value as trusted HTML content.
- `ref` directive: stripped entirely (client-only DOM reference).

### Phase 2: Environment-Aware `component()` + Server Component Rendering

`component()` detects the runtime environment and branches:

```ts
const serverRegistry = new Map<string, SetupFunction<any>>();

export function component<P>(
  tagName: string,
  setup: SetupFunction<P>,
  options?: ComponentOptions,
): ComponentFactory<P> {
  if (isServer) {
    serverRegistry.set(tagName, setup);
    return (props, hostAttrs?) => ({
      __serverComponent: true as const,
      tagName, props, hostAttrs,
    }) as unknown as TemplateResult;
  }
  // Browser path — existing implementation, completely unchanged
  // ...
}
```

#### Server Component Rendering

```ts
function* renderServerComponent(result: ServerComponentResult): RenderResult {
  const setup = serverRegistry.get(result.tagName);
  if (!setup) {
    yield `<${result.tagName}></${result.tagName}>`;
    return;
  }

  // Create a lightweight host proxy (not a real HTMLElement)
  const hostProxy = createServerHostProxy(result.tagName);

  // Create reactive props with initial values
  const reactiveProps = createServerProps(result.props);

  // Run setup in a server context (effects suppressed, onMount registered but not called)
  const templateResult = runServerSetup(setup, reactiveProps, hostProxy);

  // Emit opening tag with resolved attributes
  yield `<${result.tagName}`;
  if (result.hostAttrs?.class) {
    const cls = isSignal(result.hostAttrs.class)
      ? (result.hostAttrs.class as ReadonlySignal<string>).value
      : result.hostAttrs.class;
    if (cls) yield ` class="${escapeHtml(String(cls))}"`;
  }
  yield `>`;

  // Recursively render the component's template
  yield* templateResult;

  yield `</${result.tagName}>`;
}
```

#### Server Host Proxy

Setup functions receive `host: HTMLElement` as the second argument. On the server, we provide a lightweight proxy that supports safe operations and throws on DOM measurement:

```ts
function createServerHostProxy(tagName: string): HTMLElement {
  return new Proxy({} as HTMLElement, {
    get(_, prop: string) {
      // Safe operations
      if (prop === 'tagName') return tagName.toUpperCase();
      if (prop === 'getAttribute') return () => null;
      if (prop === 'setAttribute') return () => {};
      if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };

      // Explicitly unsupported — clear error message
      if (['querySelector', 'querySelectorAll', 'getBoundingClientRect',
           'offsetWidth', 'offsetHeight', 'scrollTo', 'focus', 'blur'].includes(prop)) {
        return () => {
          throw new Error(
            `Cannot access host.${prop}() during SSR. ` +
            `Use onMount() for DOM measurement — it only runs client-side.`
          );
        };
      }
      return undefined;
    },
  });
}
```

#### DI Scoping

`inject()` uses a global singleton cache. On the server, singletons persist across renders unless cleared.

**Rule**: Call `resetInjector()` before each server render to ensure clean state.

```ts
import { resetInjector } from '@nisli/core';
import { renderToString, html } from '@nisli/core/server';

// Per-render isolation
resetInjector();
const result = renderToString(html`<my-app></my-app>`);
```

For SSG (single build-time render), this isn't needed. For SSR (per-request), it's mandatory.

### Phase 3: Hydration Markers

When rendering with `{ hydrate: true }`, the server output includes comment markers at expression boundaries. The client uses these to reconnect reactive bindings to existing DOM.

#### Marker Format

```html
<div class="card">
  <!--nh-t:0-->Hello World<!--/nh-t:0-->
  <span class="badge status-open">
    <!--nh-t:1-->Open<!--/nh-t:1-->
  </span>
  <!--nh-w:2-->
  <p>Conditional content</p>
  <!--/nh-w:2-->
  <!--nh-e:3-->
  <li>Item 1</li>
  <li>Item 2</li>
  <!--/nh-e:3-->
</div>
```

| Marker | Type | Wraps |
|--------|------|-------|
| `nh-t:N` | Text expression | Resolved text content |
| `nh-a:N:name` | Attribute expression | Attribute value |
| `nh-w:N` | `when()` conditional | Conditional branch |
| `nh-e:N` | `each()` list | List items |
| `nh-c:N:tag` | Component boundary | Component inner HTML |

Marker indices reset per component scope (each component's template has its own slot numbering from 0).

#### Version Marker

The root of SSR'd output includes `<!--nh-v:1-->`. The client hydrator checks this version. On mismatch, it falls back to full client render instead of broken hydration.

#### `defer-hydration` Attribute (Inspired by Lit)

Server adds `defer-hydration` to component elements:

```html
<my-component defer-hydration>
  <!--nh-c:0:my-component-->
  <button>☀️</button>
  <!--/nh-c:0:my-component-->
</my-component>
```

The client hydration module removes `defer-hydration` after attaching bindings. This enables:
- **Progressive hydration**: hydrate above-the-fold components first
- **Lazy hydration**: hydrate on interaction or viewport entry
- **Selective hydration**: skip hydration for static components entirely

### Phase 4: Client Hydration

#### Hydration Support Module

`@nisli/core/hydrate` must be imported BEFORE any component modules (same pattern as Lit's `lit-element-hydrate-support.js`). It patches `connectedCallback()` to detect SSR'd content.

```ts
// @nisli/core/hydrate — side-effect import
// Must load before component modules

import { patchConnectedCallback } from './component.js';

patchConnectedCallback((original, element, setup, propsProxy, host) => {
  const hasSSRContent = element.firstChild?.nodeType === 8 /* COMMENT */
    && (element.firstChild as Comment).data.startsWith('nh-');

  if (hasSSRContent) {
    // Run setup to get the TemplateResult (same as normal)
    const templateResult = setup(propsProxy.props, element);
    // HYDRATE: walk existing DOM, match markers, attach bindings
    hydrateTemplate(element, templateResult);
    // Attach event listeners (stripped during SSR)
    // Remove defer-hydration attribute
    element.removeAttribute('defer-hydration');
  } else {
    // Normal mount path (no SSR content detected)
    original();
  }
});
```

#### Hydration Walker

`hydrateTemplate()` walks the existing DOM matching markers to expression slots:

1. `nh-t:N` → find text node between markers → attach signal subscription
2. `nh-a:N:name` → find attribute → attach signal subscription
3. `nh-w:N` → find conditional block → attach `when()` effect
4. `nh-e:N` → find list block → attach `each()` reconciler
5. `nh-c:N:tag` → child component hydrates itself via its own `connectedCallback()`
6. `@event` attributes → attach event listeners (these were stripped during SSR)

#### Dev-Mode Mismatch Detection

During hydration, compare the expected value from the client's signal with the text content of the SSR'd node. On mismatch, log a warning:

```
⚠️ Hydration mismatch in <my-component>:
  Server rendered: "Hello World"
  Client expected: "Hello Universe"
  Expression slot: nh-t:0
```

This is dev-mode only (stripped in production builds). Same approach as React, Lit, and Solid.

## Gotchas and Anti-Patterns

### 1. Host Element Access in Setup

**Rule**: Never access `host` for DOM measurement during setup. Use `onMount()`.

```ts
// ❌ WRONG — crashes on server
component('my-comp', (props, host) => {
  const width = host.offsetWidth; // throws in SSR
  return html`<div style="width: ${width}px">...</div>`;
});

// ✅ CORRECT — onMount is client-only
component('my-comp', (props, host) => {
  const width = signal(0);
  onMount(() => { width.value = host.offsetWidth; });
  return html`<div style="width: ${width}px">...</div>`;
});
```

### 2. Signal Reads Are One-Shot on Server

Signals are read once for their current `.value`. No reactivity, no subscriptions, no re-renders. If a computed depends on async data that hasn't resolved, SSR captures the initial (empty) state.

**Rule**: Pre-fetch all data before calling `renderToString()`. SSR is synchronous.

### 3. Effects Are Suppressed on Server

`effect()` is a no-op during server rendering. Code inside effects will not run. This is correct — effects are for side effects (DOM manipulation, network calls, localStorage).

**Rule**: Don't put rendering logic inside effects. Derived state belongs in `computed()`.

### 4. `query()` Does Not Work on Server

`query()` is async data loading. It won't resolve during synchronous SSR. The signal will have its initial value (typically `undefined` or loading state).

**Rule**: Pre-fetch data and pass it as props or pre-populated signals.

### 5. Hydration Mismatch from Conditional Rendering

If server and client render different content (e.g., `isServer` checks that change output, time-dependent rendering, random values), hydration will silently produce broken UI.

**Rule**: Server and client must produce identical HTML for the same input data. Use `isServer` only to skip code, never to change output.

### 6. Marker Format Is a Versioned Contract

The hydration marker format (`nh-t:N`, `nh-c:N:tag`) is a contract between server and client. Changing the format breaks hydration of cached SSR output.

**Mitigation**: Version marker (`<!--nh-v:1-->`). Client checks version, falls back to full render on mismatch.

### 7. DI Singletons Persist Across Server Renders

`inject()` caches singletons globally. Without `resetInjector()`, state leaks between renders.

**Rule**: Call `resetInjector()` before each server render in SSR (per-request) mode.

### 8. Two `html()` Implementations Will Diverge

Server and client `html()` are separate implementations. When the client gains new features, the server must be updated.

**Mitigation**: Shared conformance test suite. Every template test renders with both and compares output (ignoring markers and event bindings). CI fails on divergence.

### 9. Nested Component Depth

Deeply nested component trees cause recursive rendering. No stack overflow protection.

**Mitigation**: Depth counter with configurable max (default: 50). Throws on infinite recursion from circular component references.

### 10. Third-Party Web Components

Components not registered with `@nisli/core`'s `component()` won't be in the server registry. They render as empty shells.

**Expected behavior**: Only `@nisli/core` components participate in SSR. Third-party components are client-only.

### 11. `useHostEvent()` Is Suppressed on Server

`useHostEvent()` registers DOM event listeners. On the server, there's no EventTarget. It becomes a no-op.

**Rule**: Event-driven logic that affects rendering must use signals, not event listeners.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hydration mismatch bugs | High | Dev-mode mismatch detection, conformance test suite |
| Marker format changes break cached SSR output | Medium | Version marker, fallback to full render |
| Server/client `html()` divergence | Medium | Shared conformance tests in CI |
| Setup functions crash on server host proxy | Medium | Proxy with clear error messages, `onMount()` pattern |
| DI singleton leaks between server renders | Medium | Document `resetInjector()` requirement |
| Performance regression from hydration in `connectedCallback()` | Low | O(1) marker detection check |

## Phased Delivery Plan

### Phase 1: Server `html()` + `render()` + `renderToString()`

- `packages/framework/src/server.ts` — server `html()`, `render()`, `resolveSlot()`, `resolveValue()`, `renderToString()`, `collectResultSync()`
- `packages/framework/src/server.test.ts` — template rendering tests
- `./server` export in `package.json`
- `isServer` flag export
- HTML escaping for text content

### Phase 2: Environment-Aware `component()` + Server Components

- Server registry (`Map<string, SetupFunction>`)
- `component()` environment detection
- `renderServerComponent()` with recursive rendering
- Server host proxy
- `effect()` / `useHostEvent()` suppression on server
- Depth-limited recursion

### Phase 3: Hydration Markers

- Marker emission in `resolveSlot()` when `{ hydrate: true }`
- Component boundary markers
- Version marker
- `defer-hydration` attribute on server-rendered components
- Attribute directive resolution (`class:name` → class attribute)

### Phase 4: Client Hydration

- `@nisli/core/hydrate` side-effect module
- `hydrateTemplate()` DOM walker
- `connectedCallback()` patch for SSR detection
- Event listener attachment
- `defer-hydration` removal
- Dev-mode mismatch detection

## Files Changed (All Phases)

| File | Phase | Change |
|------|-------|--------|
| `packages/framework/src/server.ts` | 1-3 | New — server rendering pipeline |
| `packages/framework/src/server.test.ts` | 1-3 | New — server rendering tests |
| `packages/framework/package.json` | 1 | Add `./server` and `./hydrate` exports |
| `packages/framework/src/component.ts` | 2 | Environment detection, server registry |
| `packages/framework/src/hydrate.ts` | 4 | New — client hydration logic |
| `packages/framework/src/hydrate.test.ts` | 4 | New — hydration tests |

## Long-Term Vision

### Near-Term (Phases 1-4)

Full SSR pipeline: server rendering → hydration markers → client hydration. Components render content at build time and become interactive without re-rendering.

### Medium-Term: Streaming SSR

The `RenderResult` iterable architecture enables streaming from Phase 1. `renderToStream()` pipes chunks to an HTTP response as they're generated:

```ts
import { Readable } from 'node:stream';
import { render } from '@nisli/core/server';

app.get('/', (req, res) => {
  const result = render(html`<my-app></my-app>`);
  Readable.from(result).pipe(res);
});
```

For async data, `RenderResult` can contain Promises (Phase 5+). The stream pauses on Promises and resumes when they resolve. Same hybrid sync/async model as Lit.

### Medium-Term: Partial Hydration / Islands

Not all components need interactivity. Static components can skip hydration entirely:

```ts
component('static-header', setup, { hydrate: false });
// SSR output has no markers → client skips hydration → zero JS for this component
```

The `defer-hydration` attribute from Phase 3 is the foundation. Islands architecture layers on top: only interactive "islands" get hydration markers and client JS.

### Long-Term: Declarative Shadow DOM

SSR into shadow roots via `<template shadowrootmode="open">`. Enables style encapsulation without JS. Requires browser support (Chrome 111+, Firefox 123+, Safari 16.4+). Out of scope — we use light DOM exclusively.

### Long-Term: Universal Template IR (P3 Revisited)

If `@nisli/core` grows to need multiple render targets (native, test renderer, PDF), the IR approach becomes justified. The phased P2 architecture doesn't prevent this — server `html()` and `hydrateTemplate()` could be refactored into IR consumers. But this should be driven by actual need.

## References

- TASK-0477 — original task with requirements
- Framework ADR 0001 — web component framework design, philosophy
- Framework ADR 0002 — implementation notes, signal invariants
- Framework ADR 0009 — observer isolation via `untrack()` (relevant to hydration)
- Framework ADR 0069 — template auto-quoting (server doesn't need this)
- [Lit SSR server usage](https://lit.dev/docs/ssr/server-usage/) — RenderResult iterable, render options
- [Lit SSR client usage](https://lit.dev/docs/ssr/client-usage/) — hydrate(), hydrate-support.js pattern
- [Lit SSR authoring](https://lit.dev/docs/ssr/authoring/) — isServer, lifecycle table, async limitations
- [Lit SSR DOM emulation](https://lit.dev/docs/ssr/dom-emulation/) — minimal shim approach (we use environment detection instead)
