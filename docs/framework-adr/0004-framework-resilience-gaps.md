# 0004. Framework Resilience Gaps — Pre-Implementation Review

**Date**: 2026-02-08
**Status**: Proposed
**Depends on**: [0001-web-component-framework](./0001-web-component-framework.md)

## Purpose

ADR 0001 defines the framework architecture. This document identifies specific gaps, ambiguities, and missing primitives that will surface during implementation — each verified against the actual codebase or established framework implementations. Every item includes the evidence that motivates it and a concrete resolution proposal.

Items are tiered by when they block progress:
- **Tier 1**: Design ambiguities that block implementation (must resolve before writing code)
- **Tier 2**: Missing primitives that components will need within the first 2-3 migrations
- **Tier 3**: Hardening for long-session resilience

---

## Tier 1: Design Ambiguities

### Gap 1: `provide()` Scoping Mechanism Is Under-Specified

**The ambiguity**: ADR 0001 describes two behaviors that are incompatible without an explicit resolution mechanism:

> "`inject(Class)` checks if an instance exists (global singleton cache), creates one via `new Class()` if not"

> "`provide(Class, factory)` overrides the singleton for the **provider's subtree** (testing, custom construction)"

If `inject()` checks a global `Map` first, it returns the global singleton even inside a `provide()` subtree. The ADR doesn't specify how `inject()` discovers that it's inside a `provide()` scope.

**Why this matters**: This will surface the moment someone writes the first test using `provide()` to inject a mock. If the lookup order isn't defined, `provide()` silently does nothing and the test uses the real service.

**How other frameworks solve it**:
- Angular: hierarchical injector tree. Each component can have its own injector that inherits from its parent's. `providedIn: 'root'` creates a global singleton; component-level `providers: [...]` creates a scoped instance. Lookup walks up the injector tree.
- Vue 3: `provide()` and `inject()` use the component tree. `inject()` walks up the component parent chain looking for a matching `provide()`. No global fallback.
- Solid: No built-in DI. Uses context (similar to React context) which is tree-scoped.

**Proposed resolution — two-tier lookup**:

`inject()` during `setup()` uses this lookup order:
1. Check the current component's own overrides (set by `provide()` in this component's setup)
2. Walk up `host.parentElement` looking for ancestor components that called `provide()` for this token
3. Fall back to the global singleton cache (auto-create via `new Class()` if absent)

Step 2 is O(depth) per `inject()` call. For a shallow tree (3-4 levels in this app), this is negligible. The walk happens once during setup — not on every render or signal change.

`provide()` stores the factory on the component instance (a `Map<Token, Factory>` on the internal `BaseComponent`). `inject()` reads these maps during the ancestor walk.

This means `provide()` only works during component initialization, which is the correct constraint — you don't dynamically re-provide services at runtime.

**Impact on implementation**: Changes `injector.ts` from a simple global `Map` to a two-tier lookup (~15 additional lines). Changes `component.ts` to store a provider map on each component instance.

### Gap 2: Signal Lifecycle Inside `.map()` + Factory Composition

**The ambiguity**: ADR 0001's TaskList example shows:

```typescript
tasks.data.value.map(t =>
  TaskItem({ task: signal(t), selected: isSelected })
)
```

This is `Array.prototype.map` called on `.value` (a plain array). Every time the computed re-evaluates (data changes, filter changes, SSE update), `.map()` runs again, calling `signal(t)` for every item. This creates new `Signal` objects per render cycle. The old signals from the previous evaluation are orphaned — referenced only by the previous `TemplateResult` objects and their DOM bindings.

**Why this matters**: With SSE pushing updates every few seconds on a 100-item list, this creates hundreds of orphaned signals per minute. Each orphaned signal holds a closure over its value and its subscriber list. This is a memory leak that scales with list size × update frequency.

**How Solid solves it — reactive ownership scopes**: Solid's `<For each={list()}>` creates a reactive root (ownership scope) per list item, keyed by identity. When an item is removed from the list, its root is disposed — all signals, effects, and computeds created within that root are cleaned up. When an item is added, a new root is created. When an item's data changes but its key persists, the existing root's signals are updated in place — no new signals are created.

The key insight from Ryan Carniato's "Reactivity to Rendering" article: "every time the parent effect re-runs we will be re-creating everything created during that function's execution. So on creation we can register all computations created under that scope... And on re-running or disposal we dispose those computations as well."

**Proposed resolution — `.map()` owns signal lifecycle**:

The `.map()` method on `Signal<T[]>` (the framework's reactive map, not `Array.prototype.map`) should:

1. Create a **reactive scope** per item, keyed by the `key` attribute
2. On first render: create scope, run the map callback within it, capture all signals/effects created
3. On update (same key, new data): **update the existing scope's prop signals** — don't create new ones. The factory's internal prop signals get their `.value` updated, not replaced.
4. On removal (key gone): **dispose the scope** — all signals, effects, computeds within it are released
5. On addition (new key): create a new scope, same as step 2

This means the TaskList example should use the framework's reactive `.map()`, not `Array.prototype.map`:

```typescript
// ✅ Framework's reactive .map() — manages signal lifecycle per item
tasks.data.map(t =>
  TaskItem({ task: signal(t), selected: isSelected }),
  t => t.id  // key function
)

// ❌ Array.prototype.map — creates orphaned signals
tasks.data.value.map(t =>
  TaskItem({ task: signal(t), selected: isSelected })
)
```

**Impact on implementation**: The `.map()` implementation in `template.ts` grows from pure DOM reconciliation to signal lifecycle management. Estimated ~40 additional lines. The reactive scope concept (~20 lines) is reusable for `when()` conditional rendering too.

### Gap 3: `.map()` Reconciliation Scope Contradicts Itself

**The contradiction**: Three sections of ADR 0001 make incompatible claims:

1. Template section (line ~905): "reorders moved items — but never recreates items whose data merely changed"
2. Assumptions section: "Keyed list reconciliation with insert/remove (no move detection) is sufficient"
3. Test section: includes a reorder test case, but hedges with "(If v1 uses clear+recreate, assert items are at least correct.)"

**Why this matters**: The implementation needs a clear spec. "Reorders moved items" requires a diffing algorithm (LIS-based or similar). "Insert/remove only" is dramatically simpler. The test section's hedge suggests the author is aware of the ambiguity but hasn't committed.

**Evidence that insert/remove is sufficient**: The task list is <100 items. Reordering happens on sort change (user clicks a sort button — infrequent, not per-keystroke). The performance difference between "move DOM nodes" and "remove all, re-insert in new order" for <100 lightweight `<task-item>` elements is imperceptible (<5ms either way on modern hardware). Move detection adds ~50-80 lines of complex diffing code (LIS algorithm) with subtle edge cases.

**Proposed resolution**: Commit to **insert/remove/update for v1, no move detection**. Reorder = remove all items from the DOM container, re-insert in new order. Existing component instances and their signal scopes are preserved (matched by key) — only their DOM position changes. This is O(n) DOM operations for a reorder but O(1) signal operations (no scopes created or destroyed).

Update the template section to match: "Keyed reconciliation matches existing items by key. Additions create new scopes. Removals dispose scopes. Reorders reposition existing DOM nodes without recreating them or their reactive scopes. Move detection (minimizing DOM operations during reorder) is deferred to v2 if profiling shows it matters."

Update the reorder test to assert: "DOM nodes are in correct order AND are the same references as before (not recreated). Signal scopes are preserved."

**Impact on implementation**: Simplifies `template.ts` list reconciliation by ~50 lines vs. full move detection. The component API is unchanged — upgrading to move detection later is an internal optimization.

---

## Tier 2: Missing Primitives

### Gap 4: No Element Refs — Forces `querySelector` Fallback

**The problem**: ADR 0001 identifies selector-coupling as a core problem (Problem 4) and eliminates it for event binding via `@event`. But it provides no alternative for getting a reference to a specific child DOM element inside the template.

**Codebase evidence of the need**:

- `spotlight-search.ts:82-84` — `this.querySelector('.spotlight-input') as HTMLInputElement` to focus the search input after open. This is the most common ref use case: focus management.
- `spotlight-search.ts:89-99` — `this.querySelectorAll('.spotlight-filter-btn')` and `.spotlight-sort-btn` to attach click handlers. (Solved by `@event` in the new framework — not a ref concern.)
- `task-detail.ts:94` — `setTimeout(() => this.bindEventHandlers(task), 0)` to wait for DOM before querying `.epic-link`. (Solved by `@event` — not a ref concern.)
- `backlog-app.ts:80-85` — `this.querySelector('task-filter-bar') as any` to call methods on child components. (Solved by typed props/emitters — not a ref concern.)

After filtering out cases solved by `@event` and typed emitters, the remaining `querySelector` needs are:
1. **Focus management**: focusing an input after mount or after a state change
2. **DOM measurement**: `getBoundingClientRect()` for positioning (tooltips, dropdowns)
3. **Third-party library init**: passing a DOM element to a chart/editor library constructor
4. **Scroll management**: `scrollIntoView()` on a specific element

These are narrow but real. Without refs, the first time someone needs to focus an input, they'll write `host.querySelector('.my-input')` — reintroducing the selector-coupling the framework exists to eliminate.

**How other frameworks solve it**:
- Lit: `ref()` directive from `lit/directives/ref.js`. `html\`<input ${ref(myRef)}>\``
- Vue 3: `ref` attribute. Template refs set after mount.
- Solid: `ref` attribute. `<input ref={myInput}>`
- React: `useRef()` hook. `<input ref={myRef}>`

All major frameworks have this. It's a fundamental primitive.

**Proposed resolution — `ref()` primitive**:

```typescript
const inputEl = ref<HTMLInputElement>();

return html`
  <input ${inputEl} @keydown.enter=${onSubmit} />
`;

// After mount, inputEl.current is the DOM element
onMount(() => inputEl.current?.focus());
```

The template engine sees a `Ref` object in an expression position (not inside an attribute value), and assigns the DOM element to `ref.current` during mount, sets it to `null` during unmount.

**Impact on implementation**: ~15 lines in `template.ts` (detect `Ref` in expression slot, assign element). ~5 lines for the `ref()` factory function. Add to `index.ts` exports.

### Gap 5: No Post-Mount Lifecycle Hook

**The problem**: In ADR 0001's component model, `setup()` runs during `connectedCallback` and returns a template result. The framework mounts the template to the DOM *after* setup returns. This means during setup, the component's own DOM children don't exist yet.

Code that needs to run after the template is mounted to the DOM — focus an element, measure dimensions, initialize a third-party library, register an observer — has no hook.

**Codebase evidence**:

- `task-detail.ts:94` — `setTimeout(() => this.bindEventHandlers(task), 0)`. The `setTimeout` is a workaround for "DOM isn't ready yet." The comment-free `setTimeout` with `0` delay is the classic signal that a lifecycle hook is missing.
- `backlog-app.ts:62-90` — `init()` is called after `render()`. It attaches event listeners to rendered DOM elements and initializes services. In the new framework, event listeners are handled by `@event`, but service initialization that depends on mounted DOM (e.g., `resizeService.init()` which observes DOM elements) still needs a post-mount hook.

**Why `effect()` doesn't cover this**: Effects are signal-driven — they re-run when dependencies change. A post-mount hook runs exactly once after the DOM is committed, regardless of signals. Using `effect()` with no signal dependencies (runs once) is semantically confusing and doesn't guarantee the DOM is mounted.

**How other frameworks solve it**:
- Solid: `onMount(() => { ... })` — runs once after first render. `onCleanup(() => { ... })` — runs on unmount.
- Vue 3: `onMounted(() => { ... })` and `onUnmounted(() => { ... })`.
- Lit: `firstUpdated()` lifecycle method.

**Proposed resolution — `onMount()` and `onCleanup()`**:

```typescript
const TaskDetail = component<TaskDetailProps>('task-detail', (props) => {
  const inputEl = ref<HTMLInputElement>();

  onMount(() => {
    // DOM is committed — safe to focus, measure, observe
    inputEl.current?.focus();

    const observer = new ResizeObserver(entries => { ... });
    observer.observe(host);

    // Return cleanup function — runs on disconnectedCallback
    return () => observer.disconnect();
  });

  return html`<input ${inputEl} />`;
});
```

`onMount(callback)` registers a callback on the setup context. The framework calls it after the template is mounted to the DOM. If the callback returns a function, that function is called during `disconnectedCallback`.

`onCleanup(callback)` is a standalone cleanup registration — for cases where you need cleanup without mount logic (e.g., clearing a timer created during setup).

**Impact on implementation**: ~10 lines in `component.ts` (store mount callbacks on context, call after template mount). ~5 lines for `onMount()` and `onCleanup()` functions. Add to `index.ts` exports.

### Gap 6: XSS Safety Is Not Documented as a Design Invariant

**The problem**: ADR 0001 doesn't mention HTML escaping or XSS protection. The template engine processes signal values into DOM nodes — the question of whether those values are treated as text or HTML is a security-critical design decision that must be explicit.

**Codebase evidence that XSS is a real concern**:

The current codebase manually escapes in multiple places:
- `spotlight-search.ts:218-222` — `escapeHtml()` method: creates a div, sets `textContent`, reads `innerHTML`. Manual escaping.
- `task-list.ts:10-13` — `escapeAttr()` function: replaces `"` and `'` with HTML entities. Manual escaping.
- `task-detail.ts:8-14` — `linkify()` creates `<a>` tags from user-provided URLs. Potential XSS vector if URL contains malicious content.

The fact that the current codebase has THREE separate manual escaping implementations proves that user-generated content flows through templates. The framework must handle this automatically — relying on component authors to remember to escape is the current fragile pattern we're replacing.

**How the template engine naturally handles this**: Tagged template literals give the framework raw values in `${}` slots *before* string coercion. The framework controls how those values reach the DOM:

- **Text bindings** (`<span>${value}</span>`) → `textNode.data = String(value)` — inherently safe. The browser treats it as text content, never parsing HTML entities or tags.
- **Attribute bindings** (`<div title="${value}">`) → `element.setAttribute(name, String(value))` — safe for data attributes. The browser escapes the value within the attribute.
- **Nested templates** (`${html`<span>...</span>`}`) → treated as trusted `TemplateResult` objects. They came from the developer's source code, not user input.

This is the same model used by Lit, and it's safe by default for the common cases.

**The dangerous cases** (narrow but must be documented):
- `href` and `src` attributes: `<a href="${userInput}">` — a `javascript:` URL would execute. Mitigation: document that `href`/`src` with user input should be validated. Optionally, the template engine can warn or block `javascript:` URLs in dev mode.
- Intentional raw HTML: sometimes you need to render HTML from a trusted source (e.g., markdown-rendered content). This requires an explicit opt-in: `unsafeHTML(trustedString)`.

**Proposed resolution — document as a design invariant + add `unsafeHTML`**:

Add to ADR 0001's template section:

> **Security invariant**: Text bindings (`${value}`) always use `textNode.data`, never `innerHTML`. Attribute bindings always use `setAttribute()`. User-generated content in `${}` slots is never parsed as HTML. To intentionally render trusted HTML strings, use `unsafeHTML(string)` — an explicit opt-in that signals danger in code review.

Add a test: `signal('<img onerror=alert(1)>')` in a text binding renders as visible text `<img onerror=alert(1)>`, not as an HTML element.

**Impact on implementation**: 0 lines if the binding engine already uses `textNode.data` (which it should for performance). ~10 lines for `unsafeHTML()` directive. 1 test case.

### Gap 7: Error Recovery Mechanism Is Missing

**The problem**: ADR 0001 says errors are "contained, visible, and recoverable" but never explains how a component exits the error state. The error boundary catches setup-time throws and renders a fallback. But then:

- The setup function already threw — it won't re-run on its own
- Effects that threw are disposed — they won't re-trigger
- The parent doesn't know the child errored — it can't intervene
- The user sees an error fallback with no way to recover

**How other frameworks solve it**:
- Solid: `<ErrorBoundary>` passes a `reset()` function to the fallback component. Calling `reset()` clears the error state and re-runs the children.
- React: Error boundaries use `key` prop changes or `setState` to reset. The common pattern is a "Try Again" button that changes a key, forcing re-mount.
- Vue 3: `onErrorCaptured()` hook. Recovery is manual — the parent decides.

**Proposed resolution — retry callback in error fallback**:

```typescript
const TaskDetail = component<TaskDetailProps>('task-detail', (props) => {
  // ...
}, {
  onError: (error, retry) => html`
    <div class="text-red-400 p-2">
      Failed to load: ${error.message}
      <button @click=${retry}>Retry</button>
    </div>
  `
});
```

`retry` re-runs the setup function from scratch: disposes any surviving effects/subscriptions, clears the component's DOM, runs setup again within a fresh context. If setup succeeds, the error fallback is replaced with the real template. If it throws again, the error fallback re-renders with the new error.

For the default error fallback (no `onError` option), include a retry button automatically.

**Impact on implementation**: ~10 lines in `component.ts` (store setup function reference, implement retry logic that re-runs setup within `runWithContext`).

---

## Tier 3: Long-Session Hardening

### Gap 8: Migration Interop — Old and New Components Can't Communicate

**The problem**: ADR 0001 says "Old `HTMLElement` components and new `component()` components coexist in the same DOM" but doesn't address how they communicate during the transition period.

**Codebase evidence**: `task-item.ts:57-67` communicates with three other components via three different mechanisms:

```typescript
// 1. Direct DOM manipulation across component boundaries
document.querySelectorAll('task-item .task-item').forEach(item => {
  item.classList.toggle('selected', ...);
});

// 2. Direct method calls via querySelector
const detailPane = document.querySelector('task-detail');
(detailPane as any).loadTask(taskId);

// 3. Global CustomEvent
document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }));
```

If `task-item` is migrated to the new framework (using typed emitters) but `task-list` and `task-detail` are still old-style (listening on `document` for `CustomEvent`), the new `task-item` emits via `NavigationEvents` emitter — but the old components never hear it. They're listening on `document` for `'task-selected'` CustomEvents.

**The migration order matters**: ADR 0001's Phase 8 migrates `task-item` first (smallest leaf). But `task-item` is the primary *producer* of events that `task-list`, `task-detail`, and `main.ts` all consume. Migrating the producer first without a bridge breaks all consumers.

**Proposed resolution — emitter bridge during migration**:

During the migration period, emitters that replace existing `CustomEvent` patterns should also dispatch on `document` for backward compatibility:

```typescript
class NavigationEvents extends Emitter<{
  select: { id: string };
}> {
  // Bridge: also dispatch CustomEvent for old components
  constructor() {
    super();
    this.on('select', (detail) => {
      document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId: detail.id } }));
    });
  }
}
```

This bridge is temporary — removed once all consumers are migrated. It's explicit (visible in the emitter class), not hidden framework magic.

Alternatively, reverse the migration order: migrate consumers first (task-list, task-detail), then producers (task-item). Consumers can listen to both emitters AND document events during transition. But this is a larger first migration step.

**Impact on implementation**: 0 framework lines — this is an application-level pattern. But it should be documented in ADR 0001's migration section as a known concern with a recommended approach.

### Gap 9: `when()` Eagerly Evaluates the Template Argument

**The concern**: ADR 0001 shows:

```typescript
${when(hasUnsavedChanges, html`<span class="text-yellow-400">Unsaved</span>`)}
```

In JavaScript, tagged template literals evaluate eagerly at the call site. Even when `hasUnsavedChanges` is `false`, the `html\`...\`` is parsed and a `TemplateResult` is created. It's just not mounted to the DOM.

**Why this is minor**: For simple templates like `html\`<span>Unsaved</span>\``, the cost is negligible — the static HTML is cached after first parse, and creating a `TemplateResult` object is cheap. Signals referenced inside the unmounted template are NOT subscribed (subscription happens at mount time), so there's no wasted reactivity.

**When it would matter**: If the `when()` branch contains expensive synchronous computation in `${}` slots (not signal reads — those are lazy — but function calls that do work):

```typescript
// This computes expensiveTransform() even when hidden is true
${when(!hidden, html`<div>${expensiveTransform(data.value)}</div>`)}
```

**How Lit handles it**: Lit's `when()` directive takes callbacks: `when(condition, () => html\`...\`, () => html\`...\`)`. The callbacks are lazy — the template is only created when the condition matches.

**Proposed resolution — document the trade-off, offer lazy form**:

The eager form (`when(cond, html\`...\``) is fine for 95% of cases and reads cleaner. For the rare case where lazy evaluation matters, support a callback form:

```typescript
// Eager (default, fine for simple templates)
${when(show, html`<span>Visible</span>`)}

// Lazy (for expensive branches)
${when(show, () => html`<div>${expensiveComputation()}</div>`)}
```

The template engine checks if the second argument is a function or a `TemplateResult` and handles both.

**Impact on implementation**: ~3 lines in the `when()` implementation (check `typeof arg === 'function'`, call it if so).

---

## Summary

| # | Gap | Tier | Blocks | Resolution Cost |
|---|---|---|---|---|
| 1 | `provide()` scoping mechanism | Design | Phase 4 (injector.ts) | ~20 lines |
| 2 | Signal lifecycle in `.map()` | Design | Phase 6 (template.ts) | ~60 lines (scope mgmt) |
| 3 | `.map()` reconciliation scope | Design | Phase 6 (template.ts) | 0 lines (decision only) |
| 4 | Element refs | Missing primitive | Phase 8 (first migration) | ~20 lines |
| 5 | `onMount` / `onCleanup` | Missing primitive | Phase 8 (first migration) | ~15 lines |
| 6 | XSS safety invariant | Missing primitive | Phase 6 (template.ts) | ~10 lines + 1 test |
| 7 | Error recovery (retry) | Missing primitive | Phase 5 (component.ts) | ~10 lines |
| 8 | Migration interop bridge | Hardening | Phase 8 (first migration) | 0 framework lines (app pattern) |
| 9 | `when()` lazy evaluation | Hardening | Phase 6 (template.ts) | ~3 lines |

Total additional framework code: ~138 lines across all gaps. This brings the estimated framework size from ~680 to ~818 lines — still well under the 3KB minified budget.

### Items Considered and Rejected

The following were evaluated but determined to be non-issues for this project's scale and architecture:

**Computed garbage collection via weak subscriptions**: With ~16 components mounting once and staying mounted (single-page task viewer), orphaned computeds are negligible. Even worst case — 100 list items unmounting with 5 computeds each = 500 leaked nodes, trivial memory. Would matter for a framework used at massive scale with virtual scrolling, but not here.

**`query()` + SSE race condition**: The proposed race (SSE patches data, then `query()` refetches and overwrites with stale server data) requires eventual consistency between the SSE source and the fetch endpoint. This project uses a single fastify server — the server that sends the SSE event is the same server that handles the fetch. The data is strongly consistent. The direct mutation pattern (`tasks.data.value = tasks.data.value.map(...)`) is correct for this architecture.

**Signal debug labels**: Useful for developer experience but not a resilience concern. Can be added as a non-breaking enhancement at any time. Not blocking.

**Service initialization ordering**: `backlog-app.ts` currently relies on ordered service initialization (`urlState.subscribe` before `urlState.init`). In the new framework, bootstrap services are eagerly instantiated in `main.ts` with explicit ordering — this is the developer's responsibility and is already documented in ADR 0001's bootstrap services section. No framework change needed.
