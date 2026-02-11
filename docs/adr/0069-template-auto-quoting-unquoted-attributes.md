# 0069. Template Engine Auto-Quoting for Unquoted Attribute Expressions

**Date**: 2026-02-11
**Status**: Accepted
**Backlog Item**: TASK-0278

## Context

The `html` tagged template engine uses HTML comment markers (`<!--bk-N-->`) as placeholders for expression slots. When expressions appear in unquoted attribute positions (`@click=${fn}`), the `>` character in `-->` prematurely closes the HTML tag during `innerHTML` parsing. All subsequent attributes become literal text content instead of DOM attributes.

This is a silent failure — no error, no warning. The broken output renders `@click` as visible text.

### Affected patterns

```ts
// BROKEN — > in --> closes the tag
html`<button class:active=${sig} @click=${fn}>Text</button>`

// WORKS — > is safe inside quotes
html`<button class:active="${sig}" @click="${fn}">Text</button>`
```

### Scope

- `activity-panel.ts` — 18 instances
- `backlog-app.ts` — 1 instance

## Decision

Add a context-aware auto-quoting state machine to the `html()` function. Track `inTag` and `quoteChar` state across static string parts. When an expression slot is in unquoted attribute position (inside a tag, not inside quotes, preceding string ends with `=`), auto-wrap the marker in quotes.

### Why not just fix call sites?

Leaves a pit of failure. Every new developer will write the natural unquoted syntax and get silent breakage.

### Why not replace the marker format?

Replacing `<!--bk-N-->` with a non-HTML marker (e.g., `__bk_N__`) would require rewriting text node splitting logic. Text nodes are fragile (browser merging, whitespace normalization). The auto-quoting approach is 15 lines vs a major refactor.

### Why a state machine instead of a regex?

A naive regex (`/=\s*$/`) breaks on `"${a}=${b}"` patterns — it would add quotes inside already-quoted attributes. The state machine correctly distinguishes:
- Text position (`inTag=false`) → no quotes
- Quoted attribute (`quoteChar` set) → no quotes
- Unquoted attribute (`inTag=true`, `quoteChar=null`, ends with `=`) → auto-quote

## Implementation

~15 lines added to `html()` in `template.ts`. No changes to `processAttributes` or `processNode`.

## Consequences

- Both `@click="${fn}"` and `@click=${fn}` work transparently
- New binding types automatically support both syntaxes
- Theoretical false positive on `<p>x=${val}</p>` (text content ending with `=` outside a tag) — eliminated by `inTag` check
