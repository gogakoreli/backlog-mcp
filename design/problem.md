# Problem Articulation

<core>Spotlight-search uses fragile imperative DOM manipulation (effect + queueMicrotask + querySelectorAll + index-based lookup) to set innerHTML on 5 elements, when the framework already provides reactive primitives (`html:inner` directive and text interpolation) that handle this declaratively.</core>

## Why does this problem exist?

When spotlight-search was built, the `html:inner` directive may not have existed yet, or the developer wasn't aware it worked inside `each()`. The `each()` helper renders items asynchronously, so direct DOM queries after template creation fail — hence the `queueMicrotask()` workaround to defer until after rendering.

## Root causes

<dominant>The code predates or was unaware of the `html:inner` directive, which binds innerHTML reactively at template instantiation time — eliminating the need for post-render DOM queries.</dominant>

<alternative>The developer may have assumed `html:inner` wouldn't work inside `computed()` templates within `each()` callbacks, leading to the imperative approach.</alternative>

## What if our understanding is wrong?

<whatifwrong>If `html:inner` doesn't work reliably inside `each()` + `computed()` templates, the migration would break highlighting. However, `bindInnerHtml()` creates per-element effects with signal subscriptions — it's independent of `each()` timing. The framework docs and implementation confirm this.</whatifwrong>

## Scope

- 5 specific innerHTML sites in `spotlight-search.ts`
- 3 use highlighted HTML (need `html:inner`)
- 2 use plain escaped text (can use text interpolation `${title}`)
- Delete 3 `effect()` blocks entirely
- No changes to `div.innerHTML` utility (line 65) or `md-block.ts`

## Draft ADR sections

**Problem Statement**: Spotlight-search imperatively manipulates DOM to set innerHTML on 5 elements using effect/queueMicrotask/querySelectorAll patterns. This is fragile (index-based lookup can break if DOM structure changes), hard to maintain, and bypasses the reactive framework.

**Context**: The framework's `html:inner` directive (template.ts:667) supports signals and creates per-element reactive bindings. Text interpolation uses textContent which is inherently XSS-safe. Both work inside `each()` callbacks.
