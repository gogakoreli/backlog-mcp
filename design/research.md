# Research: Migrate spotlight-search innerHTML to html:inner directive

## Current State

`spotlight-search.ts` has 5 sites using imperative DOM manipulation (`effect()` + `queueMicrotask()` + `querySelectorAll()` + index-based lookup) to set `innerHTML` on rendered elements. This pattern exists because templates are inside `computed()` blocks, and the effect needs to wait for DOM rendering before querying elements.

### Sites

1. **Search result title** (~line 466): Highlighted HTML via `@orama/highlight` — sets `titleEl.innerHTML = highlighter.highlight(title, q).HTML`
2. **Search result snippet** (~line 474): Sets `snippetEl.innerHTML = rv.snippet.html`
3. **Recent searches tab title** (~line 525): Sets `titleEl.innerHTML = title` (escaped text)
4. **Recent activity tab title** (~line 560): Same as #3

### Framework Support

`bindInnerHtml()` in `template.ts:667` already supports signals — creates an effect that updates `innerHTML` reactively when the signal changes. Works inside `each()` because each item gets its own template instance with its own bindings.

Text interpolation `${signal}` uses `textContent` which is inherently XSS-safe.

## Key Findings

- Sites 1-2 need `html:inner` because content contains HTML markup (`<mark>` tags from highlighter)
- Sites 3-4 can use plain text binding `${title}` — `textContent` is inherently safe, eliminating the need for `escapeHtml()`
- Each `effect()` + `queueMicrotask()` block can be fully deleted after migration
- The `computed()` wrapping the template content can remain — `html:inner` bindings work inside computed templates
- No changes needed to `div.innerHTML` (line 65, utility) or `md-block.ts`

<insight>The imperative DOM manipulation exists solely to work around the timing of `each()` rendering. The `html:inner` directive and text interpolation eliminate this entirely because bindings are established at template instantiation time, not post-render.</insight>
