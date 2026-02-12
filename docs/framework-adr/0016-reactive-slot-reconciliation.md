# 0016. Reactive slot reconciliation — eliminate nuke-and-rebuild

**Date**: 2026-02-11
**Status**: Proposed
**Backlog Item**: TASK-0282

## Problem

The template engine destroys and recreates all DOM nodes every time a computed signal returns a new `TemplateResult`. There is no reconciliation — structurally identical templates are treated as completely new content.

This means the signal system's fine-grained dependency tracking is wasted at the rendering layer. Signals correctly narrow invalidation to the exact computed that changed, but the template engine responds by tearing down the entire slot and rebuilding from scratch.

### The nuke-and-rebuild code

`viewer/framework/template.ts`, inside `processChildNode()` — the reactive slot effect:

```ts
// lines 396-410
const dispose = effect(() => {
  const newValue = (value as ReadonlySignal<unknown>).value;
  const liveParent = endMarker.parentNode;
  if (!liveParent) return;

  // Remove previous content — UNCONDITIONAL
  for (const r of currentResults) {
    try { r.dispose(); } catch (_) {}   // kills all effects, event listeners
  }
  for (const node of currentNodes) {
    node.parentNode?.removeChild(node);  // removes all DOM nodes
  }
  currentNodes = [];
  currentResults = [];

  // ... then mount the new TemplateResult from scratch
  // (re-parses HTML, re-creates all bindings, re-attaches all events)
```

Every time the signal changes, this effect:
1. Calls `dispose()` on every previous `TemplateResult` — killing all inner effects, event listeners, and child bindings
2. Removes every DOM node between the slot markers
3. Calls `mount()` on the new `TemplateResult` — re-parsing HTML, re-walking the DOM, re-creating all bindings

There is no check for "is this the same template shape as before?"

### No template identity exists

`TemplateResult` has no identity — it doesn't carry a reference to the `TemplateStringsArray` that created it:

```ts
// viewer/framework/template.ts lines 25-32
export interface TemplateResult {
  mount(host: HTMLElement): void;
  dispose(): void;
  __templateResult: true;
  // ← no `strings` property, no identity
}
```

The `html` function captures `strings` via closure but doesn't expose it:

```ts
// lines 120-127
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): TemplateResult {
  return {
    __templateResult: true as const,
    mount(host) { /* uses strings via closure */ },
    // ← strings is not stored as a property
```

### Dead template cache

A `templateCache` exists but is **never read** — it's dead code:

```ts
// line 41
const templateCache = new WeakMap<TemplateStringsArray, HTMLTemplateElement>();
// ← only declaration, zero reads anywhere in the file
```

This means every `mount()` call re-parses the HTML string via `template.innerHTML = htmlStr`, even for templates that have been mounted before. The cache was presumably intended to avoid this, but was never wired up.

### Concrete cascade: toggling task ↔ global activity

User clicks the ✕ "Show all activity" button. This calls:

```ts
// viewer/services/split-pane-state.ts lines 119-125
clearActivityFilter() {
  if (this.activePane.value === 'activity') {
    this.activityTaskId.value = null;           // signal write #1
    this.headerTitle.value = 'Recent Activity'; // signal write #2
    this.persist('activity:');
  }
}
```

Two signal writes. Here's what each triggers:

**Rebuild #1 — pane header** (backlog-app.ts lines 59-93)

`paneHeaderContent` computed reads `headerTitle.value`. Title changed → computed re-evaluates → returns new `html\`<div class="pane-title">${title}</div>\`` → slot nukes the header DOM and rebuilds.

```ts
// viewer/components/backlog-app.ts lines 59-93
const paneHeaderContent = computed(() => {
  const title = splitState.headerTitle.value;  // ← dependency
  // ...
  return html`
    <div class="pane-title">${title}</div>
    ${subtitle ? html`<div class="pane-subtitle">${subtitle}</div>` : null}
  `;
});
```

The only thing that changed is the title text. But the entire header DOM (div, text node, any subtitle) is destroyed and recreated.

**Rebuild #2 — filter header** (activity-panel.ts lines 393-403)

`filterHeader` computed reads `taskId.value` (derived from `activityTaskId`). Changed from an ID to `null` → returns `null` → slot removes the filter badge. This transition (template→null) is legitimate — the filter header should disappear.

```ts
const filterHeader = computed(() => {
  const id = taskId.value;  // ← dependency (was "TASK-0279", now null)
  if (!id) return null;     // ← correctly hides
  return html`<div class="activity-filter-header">...</div>`;
});
```

**Rebuild #3 — mode toggle** (activity-panel.ts lines 405-415)

`modeToggle` computed reads `taskId.value`. Changed from truthy to `null` → was returning `null`, now returns the toggle buttons → slot mounts new DOM. This transition (null→template) is also legitimate.

```ts
const modeToggle = computed(() => {
  if (taskId.value) return null;  // ← was hiding (taskId was set)
  return html`                     // ← now showing (taskId is null)
    <div class="activity-mode-toggle">
      <button ...>Timeline</button>
      <button ...>Journal</button>
    </div>
  `;
});
```

**Rebuild #4 — entire operation list** (activity-panel.ts lines 417-440+)

The effect at lines 99-110 re-fetches operations because `activityTaskId` changed. `operations.value` gets a new array → `mainContent` computed re-evaluates → returns new `html\`...\`` with the full list → slot nukes every day group, every task group, every operation card, and rebuilds all of them.

```ts
// The effect that triggers the fetch
effect(() => {
  const _taskId = splitState.activityTaskId.value;  // ← dependency
  if (_pane === 'activity') {
    loadOperations().catch(() => {});  // → operations.value = new array
  }
});

// The computed that rebuilds the entire list
const mainContent = computed(() => {
  const ops = operations.value;  // ← dependency (new array reference)
  // ...
  return renderTimelineView();   // → returns html`...` with ALL operations
});

function renderTimelineView() {
  const dayGroups = groupByDay(operations.value);
  return html`
    <div class="activity-list">
      ${dayGroups.map(dayGroup => html`
        <div class="activity-day-separator">...</div>
        ${groupByTask(dayGroup.operations).map(taskGroup => renderTaskGroup(taskGroup))}
      `)}
    </div>
  `;  // ← every operation card is a new TemplateResult
}
```

Rebuilds #2 and #3 are legitimate shape transitions (null↔template). Rebuilds #1 and #4 are the problem — same template shape, different values, full DOM teardown.

### Scale across the codebase

41 `computed(() => { ... })` blocks across 11 component files. Every one that returns `html\`...\`` has this behavior:

| File | computed blocks | Notes |
|------|:-:|-------|
| spotlight-search.ts | 10 | Search results, tabs, previews |
| document-view.ts | 8 | Header, dates, parent badge, metadata |
| activity-panel.ts | 6 | Filter, mode toggle, main content, operations |
| task-detail.ts | 4 | Header, actions, content |
| backlog-app.ts | 3 | Pane header, pane content, pane view |
| system-info-modal.ts | 2 | Modal content |
| task-item.ts | 2 | Item rendering |
| task-filter-bar.ts | 2 | Filter buttons |
| resource-viewer.ts | 2 | Content view |
| task-badge.ts | 1 | Badge rendering |
| task-list.ts | 1 | List rendering |

### What gets lost on rebuild

- Scroll position within the activity list
- CSS transition/animation state
- Expanded/collapsed state of DOM elements (e.g. `<details>`)
- Browser-managed state (input focus, text selection)
- Any imperative DOM state set by effects
- Event listeners (re-attached on mount, but any debounce/throttle state is lost)

## Problem space

### Why this happens

The `html` tagged template function returns a new `TemplateResult` closure every time it's called. Two calls to the same tagged template literal:

```ts
html`<div class="title">${"Hello"}</div>`
html`<div class="title">${"World"}</div>`
```

produce two `TemplateResult` objects with identical DOM structure but different values. The slot handler sees two different objects and has no way to know they share the same shape.

### The information that already exists but isn't used

JavaScript tagged template literals guarantee that the same call site always produces the same `TemplateStringsArray` reference:

```ts
function example() {
  // These two calls get the SAME strings array reference (===)
  html`<div>${x}</div>`  // strings === strings from previous call
  html`<div>${y}</div>`  // same call site, same strings reference
}
```

This is a language-level guarantee (spec §13.2.8.3). If the slot handler could compare the `strings` reference of the old and new `TemplateResult`, it would know whether the DOM structure is identical and could patch values in-place.

### Design dimensions

1. **Template identity** — `TemplateResult` needs to expose its `strings` reference. If `oldResult.strings === newResult.strings`, the DOM structure is identical — only the `values` array differs. Patch the values, don't rebuild.

2. **What "patch" means** — Each value position maps to a binding (text node, attribute, child slot, event handler). Patching means updating each binding's value without tearing down the DOM. The binding infrastructure already exists (the `Binding` types with their `dispose` methods) — it just needs an update path alongside the dispose path.

3. **Template cache** — The dead `templateCache` WeakMap should be wired up. `mount()` currently calls `template.innerHTML = htmlStr` every time. With the cache, same `strings` → same parsed `HTMLTemplateElement` → just `cloneNode(true)` instead of re-parsing.

4. **Null transitions** — Computeds often return `null` for "hidden" and `html\`...\`` for "visible" (the `when()` pattern). The reconciler must handle: null→template (mount), template→null (dispose+remove), templateA→templateB where A and B have different `strings` (dispose+remove+mount), templateA→templateA' where they share `strings` (patch values).

5. **Nested computeds** — A template may embed other computeds (`${paneHeaderContent}` inside `${splitPaneView}`). These are independent reactive slots with their own effects. Patching the outer template must not interfere with inner slots that manage themselves.

6. **Disposal semantics** — Today, `dispose()` tears down the entire effect graph inside a template. A patch-in-place approach must NOT call dispose — it must update bindings while keeping effects alive. This requires bindings to support value updates, not just creation and disposal.

### What other frameworks do

- **Lit**: `TemplateResult` stores `strings` reference. On re-render, Lit checks `oldResult.strings === newResult.strings`. If same, it walks the parts list and patches only changed values. DOM structure is never rebuilt for same-shape templates.
- **Solid**: Compiled output. Signals update text/attribute nodes directly via fine-grained subscriptions. No template diffing needed — each dynamic expression is its own reactive scope.
- **Preact/React**: Virtual DOM diff. Different tradeoff (full tree diff vs targeted updates), but same-shape JSX produces same virtual nodes that get patched.

All three preserve DOM when the template structure hasn't changed.

## Invariants

Any solution MUST preserve these guarantees. Violating any of them is a regression.

### 1. Same-shape templates MUST NOT rebuild DOM

If a computed re-evaluates and returns a `TemplateResult` with the same `TemplateStringsArray` reference as the previous one, zero DOM nodes may be created, removed, or reordered. Only text content, attributes, and event handlers may be updated in-place.

**Test**: A computed that returns `html\`<div class="${cls}">${text}</div>\`` with different `cls`/`text` values must update the existing `<div>` — never remove and re-append it.

### 2. Different-shape templates MUST fully teardown before mount

If the `TemplateStringsArray` references differ (different call site, or transition from template to null), the old template's `dispose()` must be called and all old DOM nodes removed before the new template mounts. No leaked effects, no orphaned event listeners.

**Test**: Switching from `html\`<div>A</div>\`` to `html\`<span>B</span>\`` (different template) must dispose the old one completely.

### 3. Null transitions MUST dispose cleanly

`null → template`: mount fresh. `template → null`: call `dispose()`, remove all DOM. No intermediate state where both old and new content exist simultaneously.

**Test**: `when(condition, () => html\`...\`)` toggling must not leak DOM nodes or effects.

### 4. Inner reactive slots MUST be independent

A template embedding `${someComputed}` creates an inner reactive slot. Patching the outer template's values must not interfere with inner slots — they manage their own lifecycle via their own effects.

**Test**: Outer template patches a class attribute. Inner computed re-evaluates independently. Neither triggers the other's update path.

### 5. Effects inside templates MUST survive patches

Effects created during `mount()` (event handlers, text bindings, attribute bindings) must remain alive across value patches. `dispose()` is only called on full teardown, never on same-shape patch.

**Test**: An `@click` handler inside a patched template must still fire after the patch. An `effect()` tracking a signal inside the template must still run.

### 6. Template cache MUST be keyed by TemplateStringsArray identity

Same `strings` reference → same parsed HTML structure → reuse the cached `HTMLTemplateElement` via `cloneNode(true)`. Different `strings` reference → parse fresh. The cache must not grow unboundedly (WeakMap keyed on `strings` handles this naturally since `TemplateStringsArray` is GC'd when the module unloads).

**Test**: Mounting the same tagged template 1000 times calls `template.innerHTML` once and `cloneNode` 999 times.

### 7. Binding updates MUST be idempotent

Patching a value position with the same value it already holds must be a no-op. No DOM writes, no event re-attachment, no style recalc triggers.

**Test**: Patching `html\`<div>${"same"}</div>\`` with `"same"` again must not touch `textNode.data`.

### 8. Array slot updates MUST NOT regress each() behavior

`each()` already does keyed list diffing. The reconciliation for single-value slots must not break or duplicate the `each()` code path. If a slot holds an array of `TemplateResult`s (from `.map()`), the existing nuke-and-rebuild is acceptable — `each()` is the correct tool for lists.

**Test**: `${items.map(i => html\`...\`)}` continues to work (nuke-and-rebuild). `${each(items, ...)}` continues to do keyed diffing.

### 9. No observable behavior change for components

Existing components must work identically without modification. The optimization is internal to the template engine — components don't opt in or out. Any component that works today must work after this change with fewer DOM mutations, not different DOM mutations.

**Test**: Full viewer test suite passes. Manual verification that activity panel, spotlight search, document view, and task detail all render correctly.
