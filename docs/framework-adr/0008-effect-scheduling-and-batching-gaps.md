# 0008. Effect Isolation and Loop Detection — Defense-in-Depth

**Date**: 2026-02-09
**Status**: Open — framework engineer action recommended
**Triggered by**: UI freeze in task-list on page load (Phase 11 migration)
**Depends on**: [0007-shared-services-and-each](./0007-shared-services-and-each.md)

## Context

During the Phase 11 migration, the viewer UI froze on page load. The task-list
effect ran 5+ times in rapid succession, each time tearing down and rebuilding
the entire list DOM.

## Root Cause: Application Bugs

The freeze was caused by three implementation mistakes, all violating documented
framework rules:

1. **Manual DOM in effect** — The render effect used `replaceChildren()` and
   `document.createElement()` to build the task list, instead of `each()` for
   reactive list rendering (`tmpl-each-lists`). This was a migration workaround
   (`HACK:STATIC_LIST`) written before `each()` existed (ADR 0007). It should
   have been replaced when `each()` shipped.

2. **Duplicate fetch** — `doFetch()` was called both at setup time and via
   `setState()` from backlog-app, causing two concurrent fetches that each
   resolved with new array references.

3. **Unbatched writes** — `setState()` wrote 5 signals individually instead of
   using `batch()` (`signal-batch-writes`), causing multiple intermediate
   effect re-runs.

## What Amplified It: `activeObserver` Leak

The application bugs alone would have caused wasteful re-renders but not an
infinite loop. What turned "wasteful" into "catastrophic" was a framework-level
leak: `connectedCallback` does not isolate `activeObserver`.

When the render effect ran `replaceChildren()`, child `connectedCallback` fired
synchronously. Child signal reads during mount leaked into the parent effect as
spurious dependencies. When any child signal changed, the parent effect
re-triggered, tearing down all children and creating new ones — a loop.

```
Parent effect (activeObserver = parentNode)
  └─ container.replaceChildren(listDiv)
       └─ child connectedCallback fires synchronously
            └─ runWithContext(host, () => setup(...))   // saves currentComponent only
            └─ mountTemplate → processNode
                 └─ replaceMarkerWithBinding reads signal.value
                      └─ activeObserver is STILL parentNode
                           └─ child signal tracked as parent dependency → loop
```

**This leak does not cause loops when framework patterns are followed:**

- **`each()`** — reconciliation is idempotent. Leaked deps cause a no-op
  re-run (items unchanged → same keys → reuse entries → no new mounts).
- **Computed views** — the text-binding effect reads the computed, gets the
  same cached TemplateResult, and skips re-mount.
- **The loop requires** manual DOM creation inside an effect
  (`replaceChildren`, `innerHTML`), which violates `signal-effect-side-effects`
  and `comp-no-innerhtml`.

## Lesson Learned

The real failure was keeping a migration workaround (`HACK:STATIC_LIST`) past
its expiration date. The workaround was correct when written — `each()` didn't
exist yet. Once ADR 0007 shipped `each()`, the workaround became a liability.
Migration hacks must be replaced as soon as the proper primitive is available.

## Suggested Framework Improvements (Defense-in-Depth)

### 1. Isolate `activeObserver` in `connectedCallback`

Low severity — patterns avoid the dangerous case, but the leak causes
unnecessary effect re-runs even in correct code.

```typescript
connectedCallback() {
  const prevObserver = activeObserver;
  activeObserver = null;
  try { /* setup, mountTemplate, runMountCallbacks */ }
  finally { activeObserver = prevObserver; }
}
```

### 2. Effect loop detection

Low severity — skill rules prevent the pattern, but a guard catches mistakes
early instead of freezing the UI silently.

```typescript
if (++node.runCount > MAX_RERUNS) {
  throw new Error(
    `Effect exceeded maximum re-run limit (${MAX_RERUNS}). ` +
    `This usually means the effect writes to a signal it reads.`
  );
}
```

## Fixes Applied

1. Replaced manual DOM effect with `each()` + `TaskItem` factory composition
2. Removed duplicate `doFetch()` at setup
3. Wrapped `setState()` signal writes in `batch()`


## Gap 3: Factory `class` Prop Support

**Severity**: Medium — every factory-composed component that needs external CSS
classes requires an imperative workaround.

**Problem**: When using factory composition (`comp-factory-composition`), there
is no way to pass a CSS class to the created element. The factory only forwards
declared props via `_setProp()`. Standard HTML attributes like `class` are not
part of the component's typed props interface.

**Current workaround** (tagged `HACK:FACTORY_CLASS`):

```typescript
const icon = SvgIcon({ src: signal(ringIcon) });
(icon as unknown as HTMLElement).classList.add('separator-icon');
```

This breaks the factory abstraction — the caller reaches into the returned
element imperatively instead of declaratively.

**Desired behavior**: Factory composition should support a `class` prop that
any component can receive, applied via `classList` on the host element:

```typescript
// Option A: Built-in class support in ComponentFactory type
const icon = SvgIcon({ src: signal(ringIcon), class: signal('separator-icon') });

// Option B: Second argument to factory for host attributes
const icon = SvgIcon({ src: signal(ringIcon) }, { class: 'separator-icon' });
```

**Why this matters**: The `comp-factory-composition` rule now mandates factory
usage for ALL custom elements. Without `class` support, any component needing
external styling requires an escape hatch that undermines the rule.

## Gap 4: Static Props Require `signal()` Wrapper

**Severity**: Low — verbose but not incorrect.

**Problem**: Factory props are typed as `Signal<T>`. Passing a static value
requires wrapping in `signal()` even when the value will never change:

```typescript
// ringIcon is a static import — will never change
const icon = SvgIcon({ src: signal(ringIcon) });
```

**Desired behavior**: Accept both `Signal<T>` and plain `T`:

```typescript
const icon = SvgIcon({ src: ringIcon });           // static — no wrapper
const icon = SvgIcon({ src: computed(() => url) }); // reactive — signal
```

This would require the factory to detect whether a value is a signal and wrap
plain values automatically. The `SIGNAL_BRAND` check already exists in the
template engine for this purpose.


## Migration Note: innerHTML Children Persist Under `mountTemplate`

**This is NOT a framework gap** — it is a transient interop issue during
migration. Once all consumers use factory composition, this disappears.

**Situation**: `mountTemplate()` uses `appendChild`, so pre-existing innerHTML
children from unmigrated consumers persist alongside the component template.
For example, task-detail creates `<copy-button><task-badge>...</task-badge></copy-button>`
via innerHTML — those children survive after CopyButton's template mounts.

**Resolution**: Migrate the remaining innerHTML consumers (task-detail,
system-info-modal, activity-panel, spotlight-search) to factory composition.
Tagged `HACK:MOUNT_APPEND` in copy-button.ts for cleanup tracking.
