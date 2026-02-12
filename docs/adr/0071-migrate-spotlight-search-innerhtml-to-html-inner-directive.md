# 0071. Migrate spotlight-search innerHTML to html:inner directive

**Date**: 2026-02-12
**Status**: Accepted
**Backlog Item**: TASK-0283

## Context

`spotlight-search.ts` uses imperative DOM manipulation (`effect()` + `queueMicrotask()` + `host.querySelectorAll()` + index-based lookup) to set `innerHTML` on 5 rendered elements. This pattern exists because templates are inside `computed()` blocks within `each()` callbacks, and the developer needed to wait for DOM rendering before querying elements.

The framework's `html:inner` directive (`bindInnerHtml()` in `template.ts:667`) already supports reactive signals and creates per-element bindings at template instantiation time. Text interpolation uses `textContent` which is inherently XSS-safe.

## Decision

Replace all 5 imperative innerHTML sites with framework-native reactive bindings:

- 3 highlighted HTML sites → `html:inner=${computedSignal}` directive
- 2 plain text sites → `${title}` text interpolation (removing unnecessary `escapeHtml()`)

Delete the corresponding `effect()` + `queueMicrotask()` blocks entirely.

## Alternatives Considered

1. **Extract highlight renderer components** — Over-engineered for 5 sites. Premature component extraction with speculative reuse benefit.
2. **Do-nothing with lint rule** — Doesn't fix the fragile index-based DOM queries. Risk of silent highlighting breakage on template changes.

## Consequences

- Removes ~40 lines of imperative DOM manipulation code
- Eliminates fragile index-based DOM queries that could silently break
- Uses existing framework primitives as intended
- No visible behavior change for users
- The `computed()` template wrapper pattern remains (future simplification opportunity)
