# 0018. Server-Side Rendering — `renderToString()` via `@nisli/core/server`

**Date**: 2026-03-05
**Status**: Proposed
**Backlog Item**: TASK-0477

## Context

`@nisli/core` is a reactive web component framework. The `html()` tagged template builds an HTML string with comment markers (`<!--bk-N-->`), parses it into DOM via `<template>.innerHTML`, then walks the DOM tree to create reactive bindings. The `component()` function registers custom elements that run setup functions in `connectedCallback()`.

This architecture is entirely browser-dependent. SSG pipelines output empty custom element shells (`<my-component></my-component>`). Content is invisible until JavaScript loads and executes, causing a flash of empty content (FOEC), poor perceived performance, and broken SEO.

The template engine's string-building phase (lines 134-155 of `template.ts`) is already DOM-free — pure string concatenation with a state machine for auto-quoting (ADR 0069). The DOM dependency begins at the parsing step (`document.createElement('template')`). This separation point is the foundation for SSR.

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

For SSR, we need step 1 but with resolved values instead of markers.

## Problem

We need `renderToString()` that:
1. Uses the same `html` tagged template syntax as client-side code
2. Resolves signal `.value`s inline to produce static HTML
3. Strips event handlers and reactive bindings
4. Resolves `when()` / `each()` to their current state
5. Handles nested templates and arrays
6. Runs in Node.js with zero DOM dependencies

## Proposals Considered

### Option 1: Standalone `renderToString()` — String-Only Server Module `[SHORT-TERM]` `[LOW]`

New `@nisli/core/server` entry point with a server-only `html()` that resolves signals to values and returns a plain HTML string. No DOM, no hydration, no component system.

- vs Option 2: Templates only, no component tree rendering, no hydration
- vs Option 3: Separate `html()` implementation, not a shared IR

### Option 2: Server Component Registry + Hydration `[MEDIUM-TERM]` `[HIGH]`

Server-side component registry (`defineServer()`), full component tree rendering, hydration markers in output, client `hydrate()` function.

- vs Option 1: Full component system + hydration, not just templates
- vs Option 3: Bolt-on hydration, not pluggable renderers

### Option 3: Universal Template IR `[LONG-TERM]` `[HIGH]`

Refactor `html()` to produce a renderer-agnostic intermediate representation consumed by pluggable renderers (DOM, string, hydration).

- vs Option 1: Single `html()` with multiple renderers, not two implementations
- vs Option 2: IR-based architecture, not string-based markers

### Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 2 | 1 |
| Risk | 5 | 2 | 2 |
| Testability | 5 | 3 | 5 |
| Future flexibility | 3 | 5 | 5 |
| Operational complexity | 5 | 4 | 4 |
| Blast radius | 5 | 3 | 1 |
| **Total** | **28** | **19** | **18** |

## Decision

**Option 1: Standalone `renderToString()`**.

P1 wins on every practical dimension. The divergence risk (two `html()` implementations) is manageable — the server `html()` is a strict subset of the client (no bindings, no effects, no DOM). Template engine changes that affect string building are infrequent.

P2 and P3 solve problems we don't have yet. The task explicitly scopes out streaming SSR and partial hydration. The immediate need is SSG — static content at build time. Building hydration infrastructure for an out-of-scope use case is premature.

P1 provides the cleanest upgrade path: the server `html()` can be extended with hydration markers later (evolving toward P2) without rewriting.

## Design

### New Entry Point: `@nisli/core/server`

```ts
// packages/framework/src/server.ts
import { isSignal, type ReadonlySignal } from './signal.js';

export interface ServerTemplateResult {
  toString(): string;
  __serverTemplate: true;
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): ServerTemplateResult {
  return {
    __serverTemplate: true as const,
    toString(): string {
      let out = '';
      for (let i = 0; i < strings.length; i++) {
        out += strings[i] ?? '';
        if (i < values.length) {
          out += resolveValue(values[i]);
        }
      }
      return out;
    },
  };
}

export function renderToString(result: ServerTemplateResult): string {
  return result.toString();
}
```

### Value Resolution

```ts
function resolveValue(value: unknown): string {
  // Signal → resolve to current .value
  if (isSignal(value)) {
    return resolveValue((value as ReadonlySignal<unknown>).value);
  }
  // ServerTemplateResult → recursively render
  if (value && typeof value === 'object' && '__serverTemplate' in value) {
    return (value as ServerTemplateResult).toString();
  }
  // Array → concatenate
  if (Array.isArray(value)) {
    return value.map(resolveValue).join('');
  }
  // null, undefined, false → empty
  if (value == null || value === false) {
    return '';
  }
  // Function (event handler) → strip
  if (typeof value === 'function') {
    return '';
  }
  // Primitive → stringify
  return String(value);
}
```

### Attribute Handling

The server `html()` does NOT need the auto-quoting state machine from ADR 0069. That state machine exists because comment markers (`<!--bk-N-->`) contain `>` which breaks unquoted attribute parsing. Server rendering resolves values inline — no comment markers, no `>` problem.

However, event handler attributes (`@click`, `class:name`) need stripping. The server `html()` handles this by:
- `@event` attributes: the value resolves to `""` (function → empty string), and the attribute name contains `@` which is invalid HTML — browsers ignore it
- `class:name` attributes: the value resolves to `"true"` or `"false"` — these become static attributes. A post-processing step or convention handles this.

For the initial implementation, attribute directives (`@click`, `class:name`, `html:inner`, `ref`) are left as-is in the output. They're harmless in static HTML and will be processed by the client on hydration (future work). This keeps the server `html()` simple.

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
import { signal } from '@nisli/core';
import { html, renderToString } from '@nisli/core/server';

const title = signal('Hello World');
const items = signal(['A', 'B', 'C']);

const result = html`
  <h1>${title}</h1>
  <ul>
    ${items.value.map(item => html`<li>${item}</li>`)}
  </ul>
`;

const htmlString = renderToString(result);
// "<h1>Hello World</h1><ul><li>A</li><li>B</li><li>C</li></ul>"
```

### What's NOT Included

- **Component rendering**: `component()` and `defineServer()` are out of scope. Server rendering works with raw `html()` templates only.
- **Hydration markers**: No markers in output. SSR'd content is fully static.
- **Client hydration**: No `hydrate()` function. Client JS re-renders from scratch.
- **Streaming SSR**: Out of scope per task definition.
- **`when()` / `each()` server equivalents**: Users call `.value` on signals and use standard JS (`Array.map`, ternary) in server templates. The reactive `when()` and `each()` are client-only (they return signals/TemplateResults that the server `html()` resolves via `resolveValue`).

## Assumptions

1. The primary use case is SSG (build-time static rendering), not interactive SSR with hydration
2. Template engine changes that affect string building are infrequent
3. If hydration is needed later, this module can be extended incrementally

## Trade-offs Accepted

1. Two `html()` implementations — mitigated by shared test suite comparing client and server output
2. No component rendering — acceptable for SSG where templates are composed manually
3. No hydration — client re-renders from scratch (acceptable for static content)

## Files Changed

| File | Change |
|------|--------|
| `packages/framework/src/server.ts` | New — server `html()` and `renderToString()` |
| `packages/framework/package.json` | Add `./server` export path |
| `packages/framework/src/server.test.ts` | New — tests for server rendering |

## Risks

1. **Divergence**: Server and client `html()` produce different output for the same template. Mitigated by a shared test suite that renders templates with both and compares.
2. **Attribute directives in output**: `@click`, `class:name` attributes appear in static HTML. Harmless but potentially confusing. Can add stripping in a follow-up.

## Future Work

- **Phase 2**: Server component rendering (`defineServer()`) — runs setup functions without DOM
- **Phase 3**: Hydration markers in server output
- **Phase 4**: Client `hydrate()` function — reconnects bindings to existing DOM
- **Phase 5**: Streaming SSR via async generator
