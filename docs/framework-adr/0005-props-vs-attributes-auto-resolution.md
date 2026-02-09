# 0005. Props vs Attributes Auto-Resolution

**Date**: 2026-02-08
**Status**: Accepted
**Predecessor**: [0001-web-component-framework](./0001-web-component-framework.md), [0003-migration-gaps-and-debt-tracker](./0003-migration-gaps-and-debt-tracker.md)

## Problem Statement

ADR 0001 defines a two-layer rendering model: **factory composition** (type-safe, compile-time checked) for framework component boundaries, and **`html` templates** (convenient, runtime) for internal DOM and interop. The factory layer works correctly. The template layer's auto-resolution — detecting framework components and routing attribute bindings through `_setProp()` instead of `setAttribute()` — is **not implemented**, breaking the interop escape hatch.

## Problem Space

### The Two-Layer Model (from ADR 0001)

| Layer | What it does | Tool | Type safety |
|---|---|---|---|
| **Component composition** | Parent instantiates child components | Typed factory function | Compile-time — TypeScript checks every prop |
| **Internal DOM** | Component renders its own elements | `html` tagged template | Runtime — HTML strings are untyped |

**Factory composition** is the primary, recommended way to compose framework components:

```typescript
const TaskItem = component<TaskItemProps>('task-item', (props, host) => { ... });

// Type-safe — missing/wrong/misspelled props are compile-time errors
html`<div class="task-list">${tasks.map(t => TaskItem({ task: sig, selected: sel }))}</div>`
```

Factory props require `Signal<T>`, not plain `T`. This is deliberate: without re-renders, passing `.value` loses reactivity forever. The factory turns this foot-gun into a compile-time error.

**HTML tag syntax** is the escape hatch for vanilla elements and migration interop:

```typescript
// Vanilla elements — setAttribute is correct
html`<svg-icon src="${icon}" size="16"></svg-icon>`

// Migration interop — auto-resolution should route through _setProp
html`<task-item task="${taskSignal}" selected="${isSelected}"></task-item>`
```

### Why This Problem Exists

The template engine's `bindAttribute()` always calls `setAttribute()`. It doesn't check whether the target element is a framework component with `_setProp()` support. The factory path bypasses `bindAttribute()` entirely (it creates elements and calls `_setProp()` directly), so it works. But the HTML tag interop path doesn't.

### Who Is Affected

- **Migration**: Components like task-item currently read `host.dataset.*` once at mount (static, not reactive) because their parent hasn't migrated to factory composition yet
- **Interop**: During the migration period, unmigrated parents use HTML tags to render migrated children
- **Vanilla elements**: Not affected — they don't have `_setProp`, so `setAttribute` is correct

### Problem Boundaries

- **In scope**: Wiring up auto-resolution in `bindAttribute()` for the interop escape hatch
- **Out of scope**: Compile-time type checking for HTML tag syntax (TypeScript limitation)
- **Constraint**: Must not break vanilla web components (svg-icon, task-badge)

### Problem-Space Map

**Dominant cause:** `bindAttribute()` doesn't check for `_setProp()` on the element instance.

**Alternative root cause:** Maybe the interop path isn't needed — just migrate everything to factory composition at once.

**What if we're wrong:** If auto-resolution causes subtle bugs, the factory path is always available as the type-safe alternative. Auto-resolution is a convenience for interop, not a requirement.

## Context

### What Works Today

**Factory composition** (fully functional, type-safe):
```typescript
// Parent uses factory — TypeScript checks every prop
TaskItem({ task: currentTask, selected: isSelected })
// Missing prop → compile error
// Wrong type → compile error
// Typo → compile error
```

**Factory handles _setProp correctly** (template.ts):
```typescript
// Factory result handling — already calls _setProp
for (const [key, sig] of Object.entries(factory.props)) {
  (el as any)._setProp?.(key, sig.value);
  sig.subscribe((newVal) => (el as any)._setProp?.(key, newVal));
}
```

### What Doesn't Work

**HTML tag interop** (always uses setAttribute):
```typescript
html`<task-item task="${taskSignal}"></task-item>`
// → setAttribute('task', '[object Object]')  ← WRONG
// Should → _setProp('task', taskSignal.value) ← CORRECT
```

### Current Workarounds

```typescript
// task-item.ts — reads dataset once, not reactive
const id = host.dataset.id || '';  // Frozen at mount time
```

## Decision

**Implement auto-resolution via instance check in `bindAttribute()`.**

When the template engine processes an attribute binding on an element:
1. Check `typeof (el as any)._setProp === 'function'`
2. If yes → framework component → route through `_setProp()` (preserves object references, creates signals)
3. If no → vanilla element → use `setAttribute()` as before (existing behavior, unchanged)

This is ~15 lines of code. The element instance is already in hand — no registry lookup, no performance overhead.

### Why This Is the Right Approach

1. **Delivers on ADR 0001 design** — auto-resolution as originally specified
2. **Trivial implementation** — property check on existing instance, not a registry lookup
3. **No new syntax** — HTML tag interop works transparently
4. **Safe fallback** — vanilla elements without `_setProp` get `setAttribute` as before
5. **Enables migration** — unmigrated parents can render migrated children correctly

### Guidance: When to Use Which Layer

| Scenario | Use | Why |
|---|---|---|
| Framework component → framework component | **Factory** | Type-safe, compile-time checked |
| Framework component → vanilla element | **HTML tag** | No factory exists, setAttribute is correct |
| Unmigrated component → migrated component | **HTML tag + auto-resolution** | Migration interop, auto-resolution handles it |
| Inside `each()` list rendering | **Factory** | Type-safe, reactive props via Signal<T> |

**Rule of thumb**: Factory for framework components (type-safe), HTML tags for vanilla elements and interop (convenient).

### For This Decision to Be Correct

1. All framework components are defined before any template renders (true — `main.ts` imports synchronously)
2. No vanilla web component accidentally has a `_setProp` method (true — framework convention, not standard API)
3. The Proxy handles any prop name lazily (true — creates signals on demand)

### Trade-offs Accepted

- No compile-time type safety for HTML tag bindings (TypeScript limitation — use factory for type safety)
- Auto-resolution is "best effort" for interop, not a substitute for factory composition
- Mixed attributes with signals rebuild the entire string on any signal change (acceptable — attribute strings are short)

## Implementation

### Change to `template.ts` — `bindAttribute()`

```typescript
function bindAttribute(
  el: Element,
  name: string,
  value: unknown,
  bindings: Binding[],
  disposers: (() => void)[],
): void {
  // Standard HTML attributes always use setAttribute, even on framework components
  const isHtmlAttr = name === 'class' || name === 'id' || name === 'style'
    || name === 'slot' || name.startsWith('data-') || name.startsWith('aria-');
  const hasPropSetter = !isHtmlAttr && typeof (el as any)._setProp === 'function';

  if (hasPropSetter) {
    // Framework component — route through _setProp
    if (isSignal(value)) {
      const dispose = effect(() => {
        (el as any)._setProp(name, (value as ReadonlySignal<unknown>).value);
      });
      disposers.push(dispose);
    } else {
      (el as any)._setProp(name, value);
    }
    return;
  }

  // Vanilla element — existing setAttribute logic (unchanged)
  // ...
}
```

Without the HTML attribute exclusion, `class="task-item"` on a framework component would route through `_setProp`, creating an unused signal instead of setting the DOM attribute. The exclusion list covers attributes that are always DOM-level: `class`, `id`, `style`, `slot`, `data-*`, `aria-*`.

### Change to `template.ts` — Mixed Attribute Interpolation

A second bug was discovered during implementation: `class="status-badge status-${status}"` (mixed static text + dynamic expression) would discard the static parts. The template engine extracted only the marker's value and replaced the entire attribute.

The fix unifies all attribute paths through `bindAttribute()`:

```typescript
// In processAttributes():
const markers = [...attrValue.matchAll(/<!--bk-(\d+)-->/g)];

// Single expression = entire value: preserve raw type and signal
if (markers.length === 1 && attrValue === markers[0][0]) {
  bindAttribute(el, name, values[Number(markers[0][1])], bindings, disposers);
}
// Mixed static + dynamic: resolve markers, wrap in computed() if reactive
else {
  const resolve = () => attrValue.replace(/<!--bk-(\d+)-->/g, (_, i) => {
    const v = values[Number(i)];
    const raw = isSignal(v) ? v.value : v;
    return raw == null || raw === false ? '' : String(raw);
  });
  const hasSignals = markers.some(m => isSignal(values[Number(m[1])]));
  bindAttribute(el, name, hasSignals ? computed(resolve) : resolve(), bindings, disposers);
}
```

Three cases, one entry point:
- **Single expression** (`attr="${expr}"`) → raw value to `bindAttribute()` (preserves type, signal reactivity)
- **Mixed with signals** (`attr="static-${signal}"`) → `computed()` that rebuilds the string reactively
- **Mixed without signals** (`attr="static-${plain}"`) → resolved string, set once

### Migration Impact

After this change, the interop path works correctly. Components can be migrated incrementally:

1. **Phase 1** (now): Migrated children read `host.dataset.*` (static workaround)
2. **Phase 2** (after auto-resolution): Migrated children use `props.*` signals, unmigrated parents pass via HTML attributes — auto-resolution routes through `_setProp`
3. **Phase 3** (after parent migrates): Parent uses factory composition — full type safety

## Related Work

- **ADR 0001**: Original framework design — defines two-layer model and auto-resolution
- **ADR 0003**: Migration gaps tracker — Gap 6 (observedAttributes bridge) is superseded by this
- **ADR 0004**: Resilience gaps — pre-implementation review
