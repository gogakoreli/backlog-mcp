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

The string-building phase (step 1, lines 134-155 of `template.ts`) is already DOM-free — pure string concatenation with a state machine for auto-quoting (ADR 0069). The DOM dependency begins at step 2. For SSR, we resolve signal values into the string instead of inserting markers, and skip DOM entirely. This separation point is the foundation for the entire SSR architecture.

### Component System Coupling Points

The `component()` function has three browser-only dependencies:
1. `customElements.define()` — registers the element class
2. `HTMLElement` — base class for the component
3. `connectedCallback()` — lifecycle hook that runs setup and mounts template

For server rendering, we need an alternative path that runs the setup function and captures the template result without any of these.

## Problem

The task requires four changes:

1. **`renderToString(templateResult)`** — serialize templates to HTML strings, resolving signals to `.value`
2. **Server-mode `component()`** — run setup functions without `customElements.define` or DOM APIs
3. **Hydration markers** — embed comment markers in SSR output for client reconnection
4. **Client hydration** — teach `.mount()` to detect existing SSR'd DOM and attach bindings without re-rendering

These are not independent features — they form a pipeline. renderToString without component rendering can't SSR component trees. Component rendering without hydration means the client re-renders everything from scratch (potentially worse than no SSR due to layout shift). Hydration without markers has nothing to reconnect to.

## Proposals Considered

### Option 1: Standalone `renderToString()` — Templates Only `[SHORT-TERM]` `[LOW]`

New `@nisli/core/server` entry point with a server-only `html()` that resolves signals to values and returns a plain HTML string. No DOM, no hydration, no component system.

**Why it falls short**: Only delivers requirement #1 of 4. Can't render component trees (the actual problem — `<nisli-theme-toggle>` outputs empty). Without hydration, client JS re-renders everything from scratch, causing content → blank → re-rendered content flash that can be *worse* than no SSR. The "upgrade path to P2" is misleading — P1's `resolveValue()` strips everything to plain strings with no concept of expression boundaries or component slots. Adding hydration markers later isn't extending, it's rewriting.

### Option 2: Server Component Registry + Hydration `[MEDIUM-TERM]` `[HIGH]`

Environment-aware `component()` that auto-detects Node vs browser. Server rendering of full component trees with hydration markers. Client `hydrate()` that reconnects bindings to existing DOM.

**Strengths**: Delivers all 4 requirements. Designed as a pipeline from the start — each phase builds on the previous one's architecture. Single `component()` call works in both environments.

### Option 3: Universal Template IR `[LONG-TERM]` `[HIGH]`

Refactor `html()` to produce a renderer-agnostic intermediate representation consumed by pluggable renderers (DOM, string, hydration).

**Why it's over-engineered**: Rewrites the rendering hot path for a framework with one consumer. IR allocation adds measurable overhead to every template render. Months of work before any SSR ships. Enormous blast radius — every component affected. The abstraction solves a problem (multiple render targets) that doesn't exist yet and may never exist.

### Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 2 | 1 |
| Risk | 5 | 3 | 2 |
| Testability | 5 | 3 | 5 |
| Future flexibility | 2 | 5 | 5 |
| Operational complexity | 5 | 4 | 4 |
| Blast radius | 5 | 3 | 1 |
| **Solves stated requirements** | **1/4** | **4/4** | **4/4** |

### Why P1 Was Initially Selected (and Why That Was Wrong)

The rubric optimized for conservatism — time-to-ship, risk, blast radius. P1 scored highest on those dimensions. But the rubric failed to weight the most important dimension: *does it actually solve the problem?* SSR without hydration for interactive components is like building a car without an engine. P1 is a partial solution that doesn't address the stated requirements and creates a false foundation that would need rewriting.

## Decision

**Option 2: Server Component Registry + Hydration**, delivered in 4 phases.

P2 is the only option that delivers all 4 required changes. The hydration complexity is real, but it's *inherent* complexity — you can't have interactive SSR without it. The question isn't "should we build hydration" but "how do we deliver it incrementally."

The critical architectural decision: **design for the full pipeline from Phase 1**, even though phases ship incrementally. Every phase's code is written with awareness of what comes next, so later phases extend rather than rewrite.

## Design

### Entry Point: `@nisli/core/server`

```ts
import { html, renderToString, renderComponent } from '@nisli/core/server';
```

Server-only module. Zero DOM dependencies. Tree-shaken from client bundles.

### Phase 1: Server `html()` + `renderToString()`

Server `html()` that resolves signals to values and produces HTML strings. Unlike the P1 design, this version is **marker-aware from day 1** — it tracks expression slot indices and component boundaries in its internal state, even though markers aren't emitted until Phase 3.

```ts
export interface ServerTemplateResult {
  toString(options?: RenderOptions): string;
  __serverTemplate: true;
}

export interface RenderOptions {
  /** Emit hydration markers in output (Phase 3) */
  hydrate?: boolean;
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): ServerTemplateResult {
  return {
    __serverTemplate: true as const,
    toString(options?: RenderOptions): string {
      let out = '';
      for (let i = 0; i < strings.length; i++) {
        out += strings[i] ?? '';
        if (i < values.length) {
          out += resolveSlot(i, values[i], options);
        }
      }
      return out;
    },
  };
}

export function renderToString(
  result: ServerTemplateResult,
  options?: RenderOptions,
): string {
  return result.toString(options);
}
```

#### Value Resolution (marker-aware)

```ts
function resolveSlot(
  index: number,
  value: unknown,
  options?: RenderOptions,
): string {
  const resolved = resolveValue(value, options);
  // Phase 3 will wrap resolved content with markers:
  // `<!--nh-t:${index}-->${resolved}<!--/nh-t:${index}-->`
  return resolved;
}

function resolveValue(value: unknown, options?: RenderOptions): string {
  if (isSignal(value)) {
    return resolveValue((value as ReadonlySignal<unknown>).value, options);
  }
  if (value && typeof value === 'object' && '__serverTemplate' in value) {
    return (value as ServerTemplateResult).toString(options);
  }
  if (value && typeof value === 'object' && '__serverComponent' in value) {
    return renderServerComponent(value as ServerComponentResult, options);
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveValue(v, options)).join('');
  }
  if (value == null || value === false) return '';
  if (typeof value === 'function') return '';
  return escapeHtml(String(value));
}
```

#### Attribute Handling

The server `html()` does NOT need the auto-quoting state machine from ADR 0069. That machine exists because comment markers (`<!--bk-N-->`) contain `>` which breaks unquoted attribute parsing. Server rendering resolves values inline — no comment markers, no `>` problem.

Directive handling:
- `@event` attributes: value resolves to `""` (function → empty), attribute name `@click` is invalid HTML — browsers ignore it. Harmless in static output.
- `class:name` directives: value resolves to `"true"` or `"false"`. Phase 3 will strip these and apply resolved classes to the `class` attribute.
- `html:inner` directive: resolves the signal value as trusted HTML content.
- `ref` directive: stripped entirely (client-only DOM reference).

### Phase 2: Environment-Aware `component()`

Instead of a separate `defineServer()`, make `component()` itself detect the runtime environment:

```ts
// In Node.js (no customElements global):
//   → Register setup function in server registry
//   → Return factory that produces ServerComponentResult
//
// In browser (customElements exists):
//   → customElements.define() as today
//   → Return factory that produces TemplateResult (unchanged)

export function component<P>(
  tagName: string,
  setup: SetupFunction<P>,
  options?: ComponentOptions,
): ComponentFactory<P> {
  if (typeof customElements === 'undefined') {
    // Server path
    serverRegistry.set(tagName, setup);
    return (props) => ({
      __serverComponent: true,
      tagName,
      props,
    }) as unknown as TemplateResult;
  }
  // Browser path — existing implementation unchanged
  // ...
}
```

#### Server Component Rendering

When `resolveValue()` encounters a `__serverComponent` result:

```ts
function renderServerComponent(
  result: ServerComponentResult,
  options?: RenderOptions,
): string {
  const setup = serverRegistry.get(result.tagName);
  if (!setup) return `<${result.tagName}></${result.tagName}>`;

  // Create reactive props (signals with initial values)
  const reactiveProps = createServerProps(result.props);

  // Run setup — returns a ServerTemplateResult
  const templateResult = setup(reactiveProps, null /* no host element */);

  // Serialize the component's template
  const inner = templateResult.toString(options);

  return `<${result.tagName}>${inner}</${result.tagName}>`;
}
```

**Key constraint**: The setup function receives `null` for the host element. Components that access `host` for DOM measurement, focus management, or imperative DOM manipulation will not work in SSR. This is expected — those are client-only concerns. The setup function must be written to handle `host` being null (or we provide a no-op proxy).

### Phase 3: Hydration Markers

When `options.hydrate === true`, the server output includes comment markers at expression boundaries:

```html
<div class="card">
  <!--nh-t:0-->Hello World<!--/nh-t:0-->
  <span class="badge <!--nh-a:1:class-->status-open">
    <!--nh-t:2-->Open<!--/nh-t:2-->
  </span>
  <!--nh-w:3-->                          <!-- when() block -->
  <p>Conditional content</p>
  <!--/nh-w:3-->
  <!--nh-e:4-->                          <!-- each() block -->
  <li>Item 1</li>
  <li>Item 2</li>
  <!--/nh-e:4-->
  <!--nh-c:5:my-component-->             <!-- component boundary -->
  <my-component>
    <!--nh-t:0-->inner content<!--/nh-t:0-->
  </my-component>
  <!--/nh-c:5:my-component-->
</div>
```

Marker format: `nh` = nisli-hydrate, followed by type code and slot index.

| Marker | Meaning | Wraps |
|--------|---------|-------|
| `nh-t:N` | Text expression | Resolved text content |
| `nh-a:N:name` | Attribute expression | Attribute value |
| `nh-w:N` | `when()` conditional | Conditional branch content |
| `nh-e:N` | `each()` list | List items |
| `nh-c:N:tag` | Component boundary | Component's inner HTML |

Marker indices reset per component scope (each component's template has its own slot numbering starting from 0).

### Phase 4: Client Hydration

Teach `mount()` to detect existing SSR'd DOM and attach bindings without replacing content.

```ts
// In connectedCallback():
connectedCallback() {
  if (this._mounted) return;
  this._mounted = true;

  untrack(() => {
    const host = new ComponentHostImpl(this);
    this._host = host;

    // Detect SSR'd content
    const hasSSRContent = this.firstChild?.nodeType === Node.COMMENT_NODE
      && (this.firstChild as Comment).data.startsWith('nh-');

    runWithContext(host, () => {
      this._templateResult = setup(this._propsProxy!.props, this);
    });

    if (hasSSRContent && this._templateResult) {
      // HYDRATE: walk existing DOM, match markers to expression slots,
      // attach signal subscriptions to existing nodes
      hydrateTemplate(this, this._templateResult);
    } else {
      // MOUNT: normal client-side rendering (existing behavior)
      mountTemplate(this, this._templateResult, host);
    }

    runMountCallbacks(host);
  });
}
```

The `hydrateTemplate()` function walks the existing DOM tree:
1. Find `nh-t:N` markers → attach signal subscription to the text node between start/end markers
2. Find `nh-a:N:name` markers → attach signal subscription to the attribute
3. Find `nh-w:N` markers → attach `when()` effect to the conditional block
4. Find `nh-e:N` markers → attach `each()` reconciler to the list block
5. Find `nh-c:N:tag` markers → the child component hydrates itself via its own `connectedCallback()`
6. Attach event listeners (`@click`, etc.) — these were stripped during SSR

### Package Exports

```json
{
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./server": { "import": "./dist/server.js", "types": "./dist/server.d.ts" }
  }
}
```

### Usage

```ts
// === Server (build time) ===
import { signal } from '@nisli/core';
import { html, renderToString } from '@nisli/core/server';

// component() auto-detects Node environment
import { component } from '@nisli/core';

const ThemeToggle = component('theme-toggle', (props) => {
  const isDark = signal(false);
  const label = computed(() => isDark.value ? '🌙' : '☀️');
  return html`
    <button @click=${() => isDark.value = !isDark.value}>
      ${label}
    </button>
  `;
});

// Render to string with hydration markers
const output = renderToString(
  html`<div>${ThemeToggle({})}</div>`,
  { hydrate: true }
);
// <div><!--nh-c:0:theme-toggle--><theme-toggle>
//   <button><!--nh-t:0-->☀️<!--/nh-t:0--></button>
// </theme-toggle><!--/nh-c:0:theme-toggle--></div>

// === Client (browser) ===
// Same component() call registers via customElements.define()
// connectedCallback() detects nh- markers → hydrates instead of re-rendering
// Event listeners attached, signals connected, component is interactive
```

## Gotchas and Anti-Patterns

### 1. Host Element Access in Setup Functions

**Problem**: Setup functions receive `host: HTMLElement` as the second argument. On the server, there is no host element. Passing `null` will crash components that call `host.querySelector()`, `host.getBoundingClientRect()`, etc.

**Mitigation**: Provide a no-op proxy that returns safe defaults (`querySelector → null`, `getBoundingClientRect → zero rect`). Document that DOM-measuring code must be guarded with `onMount()` (which only runs client-side).

**Anti-pattern**: Don't access `host` during setup for DOM measurement. Use `onMount()` instead.

### 2. Signal Reads During SSR Are One-Shot

**Problem**: On the server, signals are read once for their current `.value`. There's no reactivity — no effects, no subscriptions, no re-renders. If a computed depends on an async value that hasn't resolved yet, SSR captures the initial (possibly empty) state.

**Mitigation**: Ensure all data is loaded before calling `renderToString()`. SSR is synchronous — async data must be pre-fetched.

**Anti-pattern**: Don't rely on effects or async signal updates during SSR. Pre-populate all signals before rendering.

### 3. Hydration Mismatch

**Problem**: If the server renders HTML that doesn't match what the client expects (different signal values, different conditional branches, race conditions), hydration silently produces broken UI — wrong text in wrong nodes, event listeners on wrong elements.

**Mitigation**: Dev-mode mismatch detection. During hydration, compare the expected value from the client's signal with the text content of the SSR'd node. Log warnings on mismatch. This is how React, Lit, and Solid handle it.

**Anti-pattern**: Don't render different content server vs client (e.g., `typeof window !== 'undefined'` checks that change output). If content must differ, use `when()` with a client-only signal that starts `false` and flips to `true` in `onMount()`.

### 4. Marker Format Is a Versioned Contract

**Problem**: The hydration marker format (`nh-t:N`, `nh-c:N:tag`, etc.) is a contract between the server renderer and the client hydrator. If the format changes, old SSR'd HTML won't hydrate with new client code.

**Mitigation**: Version the marker format. Include a version comment at the root: `<!--nh-v:1-->`. The client hydrator checks the version before attempting hydration. On version mismatch, fall back to full client render.

### 5. Two `html()` Implementations Will Diverge

**Problem**: Server `html()` and client `html()` are separate implementations. When the client template engine gains new features (new directives, new binding types), the server must be updated in lockstep.

**Mitigation**: Shared conformance test suite. Every template test renders with both server and client `html()` and compares output (ignoring hydration markers and event bindings). CI fails if they diverge.

**Anti-pattern**: Don't add client template features without adding the server equivalent. Treat them as a pair.

### 6. `each()` and `when()` on the Server

**Problem**: Client-side `when()` returns a `computed` signal wrapping a TemplateResult. Client-side `each()` returns a TemplateResult with keyed reconciliation. On the server, these reactive wrappers are unnecessary — we just need the resolved output.

**Mitigation**: Server `resolveValue()` handles these by unwrapping: signals are resolved to `.value`, TemplateResults are serialized. The reactive `when()` and `each()` from `@nisli/core` work on the server because `resolveValue()` chases through the signal/computed chain to the underlying TemplateResult. No server-specific `when()`/`each()` needed.

### 7. Nested Component Depth

**Problem**: Deeply nested component trees cause recursive `renderServerComponent()` calls. No stack overflow protection.

**Mitigation**: Add a depth counter. Throw at a configurable max depth (default: 50). This catches infinite recursion from circular component references.

### 8. Third-Party Web Components

**Problem**: Components not registered with `@nisli/core`'s `component()` (e.g., third-party web components, native HTML elements) won't be in the server registry. They render as empty shells.

**Mitigation**: This is expected and documented. Only `@nisli/core` components participate in SSR. Third-party components render client-side only. The SSR output includes their tags but not their content.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hydration mismatch bugs | High | Dev-mode mismatch detection, conformance test suite |
| Marker format changes break cached SSR output | Medium | Version marker, fallback to full render on mismatch |
| Server/client `html()` divergence | Medium | Shared conformance tests in CI |
| Setup functions crash on null host | Medium | No-op host proxy, document `onMount()` pattern |
| Performance regression from hydration code in `connectedCallback()` | Low | Marker detection is a single comment node check — O(1) |

## Phased Delivery Plan

### Phase 1: Server `html()` + `renderToString()` — Foundation

**Scope**: `@nisli/core/server` entry point with server `html()`, `resolveSlot()`, `resolveValue()`, `renderToString()`. Handles signals, nested templates, arrays, null/false, event handler stripping.

**Architecture note**: `resolveSlot()` takes an index parameter even though Phase 1 doesn't emit markers. This is the hook point for Phase 3.

**Deliverables**:
- `packages/framework/src/server.ts`
- `packages/framework/src/server.test.ts`
- `./server` export in `package.json`

**Test strategy**: Pure function tests — template in, string out. Snapshot comparisons.

### Phase 2: Environment-Aware `component()` + Server Component Rendering

**Scope**: `component()` detects `typeof customElements === 'undefined'` and registers in server registry. `resolveValue()` handles `__serverComponent` results by looking up the registry, running setup, and recursively serializing.

**Deliverables**:
- Server registry (`Map<string, SetupFunction>`)
- `renderServerComponent()` in `server.ts`
- Environment detection in `component.ts`
- No-op host proxy for setup functions
- Depth-limited recursion

**Test strategy**: Register components, render to string, verify full component tree output.

### Phase 3: Hydration Markers

**Scope**: When `options.hydrate === true`, `resolveSlot()` wraps resolved content with `nh-*` comment markers. Attribute markers embedded in attribute values. Component boundary markers wrap component output.

**Deliverables**:
- Marker emission in `resolveSlot()` and `renderServerComponent()`
- Version marker (`<!--nh-v:1-->`)
- Marker format documentation

**Test strategy**: Render with `{ hydrate: true }`, verify marker placement and format.

### Phase 4: Client Hydration

**Scope**: `hydrateTemplate()` function that walks existing DOM matching markers to expression slots. `connectedCallback()` detects SSR'd content and calls hydrate instead of mount. Event listener attachment. Dev-mode mismatch detection.

**Deliverables**:
- `hydrateTemplate()` in `template.ts` (or new `hydrate.ts`)
- Modified `connectedCallback()` in `component.ts`
- Mismatch detection (dev mode only)
- Version check with fallback

**Test strategy**: Pre-populate DOM with SSR'd HTML (including markers), run hydration, verify bindings work. Test mismatch detection. Test version fallback.

## Files Changed (All Phases)

| File | Phase | Change |
|------|-------|--------|
| `packages/framework/src/server.ts` | 1-3 | New — server `html()`, `renderToString()`, component rendering, markers |
| `packages/framework/src/server.test.ts` | 1-3 | New — server rendering tests |
| `packages/framework/package.json` | 1 | Add `./server` export path |
| `packages/framework/src/component.ts` | 2, 4 | Environment detection, hydration-aware `connectedCallback()` |
| `packages/framework/src/template.ts` | 4 | `hydrateTemplate()` function (or new `hydrate.ts`) |
| `packages/framework/src/hydrate.ts` | 4 | New — client hydration logic |
| `packages/framework/src/hydrate.test.ts` | 4 | New — hydration tests with pre-populated DOM |

## Assumptions

1. The primary use case is SSG with hydration — static HTML at build time, interactive on client load
2. All data is available synchronously at SSR time (no async rendering)
3. Components that access `host` for DOM measurement use `onMount()` (not inline in setup)
4. Third-party web components are client-only (expected, documented)
5. The framework has a small number of consumers, so the phased rollout is manageable

## Trade-offs Accepted

1. Two `html()` implementations — mitigated by shared conformance test suite
2. Hydration adds complexity to `connectedCallback()` — mitigated by O(1) marker detection check
3. Marker format is a versioned contract — mitigated by version marker and fallback
4. Setup functions can't access host DOM on server — mitigated by no-op proxy and `onMount()` pattern
5. Higher implementation effort than P1 — but P1 doesn't solve the stated problem

## Long-Term Vision

### Near-Term (Phases 1-4)

Full SSR pipeline: server rendering → hydration markers → client hydration. Components render content at build time and become interactive without re-rendering. This is the Lit SSR / Solid / Qwik model.

### Medium-Term: Streaming SSR

Once the marker-based architecture is in place, streaming SSR is a natural extension. Instead of `renderToString()` returning a complete string, `renderToStream()` returns an async generator that yields HTML chunks as components resolve:

```ts
async function* renderToStream(result: ServerTemplateResult): AsyncGenerator<string> {
  // Yield static parts immediately
  // Yield component content as setup functions complete
  // Yield closing markers after all children resolve
}
```

This enables Time-to-First-Byte (TTFB) optimization — the browser starts parsing HTML before the entire page is rendered.

### Medium-Term: Partial Hydration / Islands

Not all components need to be interactive. A static header, footer, or content block can be SSR'd without hydration markers — the client never hydrates them, saving JS bundle size and hydration time.

This could be expressed as a component option:

```ts
component('static-header', setup, { hydrate: false });
// SSR output has no markers → client skips hydration → zero JS for this component
```

Or at the template level:

```ts
html`<div>${StaticHeader({ title })} ${InteractiveSearch({})}</div>`
// Only InteractiveSearch gets hydration markers
```

### Long-Term: Declarative Shadow DOM

The current design renders into light DOM (component content is direct children). Declarative Shadow DOM (`<template shadowrootmode="open">`) would allow SSR'd content inside shadow roots, enabling style encapsulation without JS.

This is explicitly out of scope for now — it requires browser support (Chrome 111+, Firefox 123+, Safari 16.4+) and changes the component model significantly.

### Long-Term: Universal Template IR (P3 Revisited)

If `@nisli/core` grows to need multiple render targets (native, test renderer, PDF), the IR approach from P3 becomes justified. The phased P2 architecture doesn't prevent this evolution — the server `html()` and `hydrateTemplate()` could be refactored into IR consumers later. But this refactor should be driven by actual need, not speculative architecture.

## References

- TASK-0477 — original task with requirements
- Framework ADR 0001 — web component framework design (mentions Lit SSR scope difference)
- Framework ADR 0002 — implementation notes (signal invariants relevant to SSR signal resolution)
- Framework ADR 0009 — observer isolation via `untrack()` (relevant to hydration in `connectedCallback()`)
- Framework ADR 0069 — template auto-quoting (server `html()` doesn't need this — no comment markers)
- Lit SSR approach: string-based, not DOM shim. They control the template engine and short-circuit DOM.
