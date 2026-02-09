# 0007. Template Engine Bug: class Attribute Overwrites class:name Directives

**Date**: 2026-02-09
**Status**: Accepted
**Depends on**: [0006-framework-review-gap-resolution](./0006-framework-review-gap-resolution.md)

## Bug Report

When a template has both a reactive `class` attribute (containing signal interpolations) and `class:name` directives on the same element, changes to the `class` attribute's signals wipe out all classes toggled by `class:name` directives.

### Reproduction

```typescript
const type = signal('task');
const selected = signal(true);

html`<div class="task-item type-${type}" class:selected="${selected}"></div>`;
```

**Expected**: Changing `type` from `'task'` to `'epic'` updates the class to `task-item type-epic selected`.
**Actual**: Changing `type` to `'epic'` sets class to `task-item type-epic` -- `selected` is lost.

### Initially Misdiagnosed

The bug was initially attributed to happy-dom's HTML parser dropping `class:selected` attributes when a `class` attribute with markers was present on the same element. This led to a **workaround** in `task-item.ts`: pre-computing a static `baseClass` string to avoid markers in the class attribute.

Diagnostic tests proved this diagnosis was wrong. Happy-dom preserves `class:name` attributes correctly in all scenarios, including alongside `class` attributes with marker text.

---

## Root Cause

The bug is in the template engine's `bindAttribute()` function.

### The Conflict

Two independent binding systems manage the same DOM property:

1. **`class` attribute binding** (via `bindAttribute`): When the class attribute has signal interpolations (e.g., `class="task-item type-${type}"`), the template engine creates a reactive binding that calls `el.setAttribute('class', resolvedValue)` whenever any signal in the attribute changes.

2. **`class:name` directive** (via `bindClass`): Each `class:name` directive creates a separate reactive binding that calls `el.classList.toggle(name, !!value)` when the associated signal changes.

### Why It Fails

`setAttribute('class', ...)` **replaces the entire class string**, destroying any classes added by `classList.toggle()`. When the `type` signal changes:

1. The class attribute effect re-runs: `el.setAttribute('class', 'task-item type-epic')` -- replaces ALL classes
2. The `class:selected` effect does NOT re-run (its signal didn't change)
3. Result: `selected` class is gone

### Why Initial Render Works

On initial render, both effects run in creation order. The class attribute effect runs first (setting the base classes), then the `class:selected` effect runs (adding `selected`). The visible result is correct. The bug only manifests when the class attribute's signals change after mount.

---

## Fix: classList-Based Class Attribute Binding

### Approach

Replace `setAttribute('class', ...)` with `classList.add/remove` for reactive class attribute bindings. The new `bindClassAttribute()` function tracks which classes "belong" to the class attribute and only manages those, leaving `class:name` directive classes untouched.

### Implementation

New function `bindClassAttribute()` in `template.ts`:

```typescript
function bindClassAttribute(el, value, bindings, disposers) {
  let initialized = false;
  let prevClasses: string[] = [];

  const applyClasses = (raw: unknown) => {
    if (!initialized) {
      // Clear parser's class attribute (contains marker text like "<!--bk-0-->")
      el.setAttribute('class', '');
      initialized = true;
    }
    const next = String(raw).split(/\s+/).filter(Boolean);

    // Remove only classes we previously added
    for (const cls of prevClasses) {
      if (!next.includes(cls)) el.classList.remove(cls);
    }
    // Add new classes
    for (const cls of next) {
      if (!prevClasses.includes(cls)) el.classList.add(cls);
    }
    prevClasses = next;
  };

  // Signal or static binding...
}
```

`bindAttribute()` now delegates to `bindClassAttribute()` when `name === 'class'`.

### Why This Is Resilient

1. **No interference**: `classList.add/remove` only touches the classes it owns. Classes added by `class:name` directives (via `classList.toggle()`) are completely independent.
2. **Correct on signal changes**: When the class attribute's signal changes, only the attribute's own classes are updated. Directive classes are untouched because `classList.remove` only removes previously-tracked classes.
3. **No marker artifacts**: The initial `setAttribute('class', '')` clears the parser's raw marker text (e.g., `"task-item type-<!--bk-0-->"`) before the first application.
4. **Works in all environments**: No reliance on parser behavior for `class:name` attributes. Both browsers and happy-dom handle `classList` identically.

---

## Tests Added

Two regression tests in `template.test.ts` under the `class:name directive` describe block:

| Test | Validates |
|---|---|
| `survives when reactive class attribute changes (classList vs setAttribute)` | Single `class:name` directive survives class attribute signal change |
| `multiple class:name directives survive class attribute signal changes` | Multiple `class:name` directives survive simultaneously |

---

## Invariant

### `tmpl-class-attribute-safe` -- Reactive class attributes use classList, not setAttribute

The class attribute binding MUST use `classList.add/remove` to manage its classes. It MUST NOT use `setAttribute('class', ...)` which would overwrite classes managed by `class:name` directives.

This invariant ensures `class="base-${signal}"` and `class:name="${signal}"` compose correctly on the same element.

---

## Impact

- **task-item.ts**: Removed the `baseClass` workaround. Template now uses `class="task-item type-${props.type}"` directly alongside `class:selected` and `class:current-epic`, as originally intended.
- **All components**: `class` attribute with signal interpolations can now safely coexist with `class:name` directives.
- **No breaking changes**: Static class attributes (no markers) still work identically.
