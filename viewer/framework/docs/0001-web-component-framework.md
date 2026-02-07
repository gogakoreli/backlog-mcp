# 0001. Web Component Framework: Reactive Base Class with Signals and Dependency Injection

**Date**: 2026-02-07
**Status**: Proposed

## Context

The backlog viewer has grown to 15+ web components, all extending raw `HTMLElement` with no shared base class. This has produced a set of recurring pain points that compound as the codebase grows:

### Problem 1: Full DOM Destruction on Every State Change

Every component calls `this.innerHTML = \`...\`` on state change, which destroys and recreates the entire subtree. This means:
- All child component state is lost (scroll position, input focus, expanded sections)
- Event listeners attached in `attachListeners()` are destroyed and must be reattached
- The browser must re-parse HTML, rebuild the DOM tree, recalculate styles, and re-layout
- SSE events from the backend trigger `loadTasks()` which re-renders the *entire task list* even when a single task changed

**Evidence**: `task-list.ts:179` — `this.innerHTML = \`...\`` rebuilds every `<task-item>` on any filter, sort, scope, or SSE event. `task-item.ts:27` — each item destroys and rebuilds its own DOM on every attribute change.

### Problem 2: Repetitive, Verbose Event Listener Boilerplate

Every component manually sets up event listeners with the same casting pattern:
```typescript
document.addEventListener('filter-change', ((e: CustomEvent) => {
  this.currentFilter = e.detail.filter;
  this.loadTasks();
}) as EventListener);
```

**Evidence**: `task-list.ts:43-66` has 5 event listeners with identical boilerplate. `main.ts` has 8 more. `task-detail.ts:94` attaches click handlers after render via `setTimeout`. None of these are cleaned up in `disconnectedCallback`.

### Problem 3: No Shared State Primitives

State is scattered across:
- Private class fields (`this.currentFilter`, `this.selectedTaskId`)
- URL params via `UrlState` singleton
- `localStorage` via `SidebarScope` singleton
- `data-*` attributes on DOM elements
- Imperative service singletons (`splitPane`, `backlogEvents`)

There is no unified way to declare "this component depends on X, re-render when X changes." Dependencies are implicit, wired up manually, and easy to get wrong.

### Problem 4: No Lifecycle Management

Components subscribe to global events and services but rarely unsubscribe. `ActivityPanel` is the only component that implements `disconnectedCallback` cleanup. All others leak listeners when removed from the DOM.

### What We Want

A lightweight framework layer — **not** React, **not** Angular, **no compiler, no virtual DOM, no runtime scheduler** — that gives us:
1. **Fine-grained reactivity** so only changed parts of the DOM update
2. **Declarative event binding** that auto-cleans on disconnect
3. **Signal-based state** with automatic dependency tracking
4. **Stateless dependency injection** for services (no global singletons with hard imports)
5. **A single `viewer/framework/` folder** housing all framework code

### Constraints

- No build-time compiler or code transformation (beyond what esbuild already does)
- No virtual DOM — we diff at the data level, not the DOM level
- No runtime scheduler or fiber-like architecture
- Must be incrementally adoptable (migrate one component at a time)
- Must stay under ~3KB minified for all framework code combined
- Pure TypeScript, no external dependencies

---

## Proposal A: Signal-Driven Base Class with Targeted DOM Patching

**Core idea**: Signals as the single state primitive. Components declare signals, bind them to DOM regions, and the framework patches only the specific DOM nodes that depend on changed signals. No virtual DOM — instead, each signal knows exactly which DOM nodes it controls.

### Architecture

```
viewer/framework/
├── signal.ts          # Signal, Computed, Effect primitives
├── component.ts       # BaseComponent class (extends HTMLElement)
├── template.ts        # Tagged template literal → DOM binding engine
├── events.ts          # Declarative event binding with auto-cleanup
├── injector.ts        # Stateless DI container (provide/inject)
└── index.ts           # Public API barrel export
```

### Signal Primitive (`signal.ts`)

```typescript
// Core reactive atom — holds a value, tracks subscribers
const [count, setCount] = signal(0);
count();        // read → 0 (registers dependency if inside effect/computed)
setCount(5);    // write → notifies dependents
setCount(n => n + 1); // updater function

// Derived computation — lazy, cached, auto-tracks dependencies
const doubled = computed(() => count() * 2);

// Side effect — runs when dependencies change, returns cleanup
const dispose = effect(() => {
  console.log('count is', count());
  return () => { /* cleanup when re-run or disposed */ };
});
```

**Key design choice**: Signals use a **push-pull hybrid**. Writes push "dirty" notifications up the dependency graph. Reads pull fresh values lazily. This means computed values are not recalculated until actually read, avoiding wasted work.

**Batch updates**: Multiple synchronous signal writes are batched into a single microtask flush via `queueMicrotask`. This means `setA(1); setB(2); setC(3)` triggers one re-render, not three.

### Base Component (`component.ts`)

```typescript
class TaskItem extends BaseComponent {
  // Declare reactive state
  title = this.signal('');
  status = this.signal('open');
  selected = this.signal(false);

  // Inject services (resolved from parent providers)
  scope = this.inject(SidebarScope);

  // Declarative events — auto-cleaned on disconnect
  events = this.listen({
    '.task-item click': () => this.onSelect(),
    '.enter-icon click': (e) => { e.stop(); this.scope.set(this.id); },
    'document task-selected': (e) => this.selected.set(e.detail.taskId === this.id),
  });

  // Template — returns a binding map, not HTML string
  template() {
    return html`
      <div class="task-item ${() => this.selected() ? 'selected' : ''}">
        <task-badge task-id="${this.id}"></task-badge>
        <span class="task-title">${this.title}</span>
        <span class="status-badge status-${this.status}">${this.status}</span>
      </div>
    `;
  }
}
```

**What `template()` does differently**: The tagged `html` template literal does NOT produce an HTML string. It produces a `DocumentFragment` on first render, then on subsequent signal changes, it patches *only the specific `Text` nodes and attribute values* that are bound to the changed signal. The static HTML structure is parsed exactly once.

### Targeted DOM Patching (`template.ts`)

The template engine works in two phases:

**Phase 1 — First Render (Clone)**:
1. Parse the tagged template into a `<template>` element (cached per component class)
2. Clone the template's `DocumentFragment`
3. Walk the clone, find "holes" (signal bindings), and create `Binding` objects
4. Each `Binding` captures a reference to the exact DOM node + attribute/text it controls
5. Mount the fragment into the component's shadow DOM or light DOM

**Phase 2 — Updates (Patch)**:
1. When a signal fires, only the `Binding` objects subscribed to it execute
2. A text binding does `textNode.data = newValue` — one DOM operation
3. An attribute binding does `element.setAttribute(name, newValue)` — one DOM operation
4. A class binding does `element.classList.toggle(name, bool)` — one DOM operation
5. No diffing, no tree walking, no innerHTML

**List rendering** uses a keyed `repeat()` helper:
```typescript
html`
  <div class="task-list">
    ${repeat(this.tasks, task => task.id, task => html`
      <task-item data-id="${task.id}" ...></task-item>
    `)}
  </div>
`
```

`repeat()` uses key-based reconciliation: it adds new items, removes deleted items, and reorders moved items — but never recreates items whose data changed. Instead, existing items receive signal updates through their bindings.

### Dependency Injection (`injector.ts`)

Inspired by Angular's `inject()` but simpler — no decorators, no modules, no hierarchical injectors at the framework level. Instead, the DOM tree IS the injector hierarchy.

```typescript
// Define an injection token
const SidebarScope = createToken<SidebarScopeService>('SidebarScope');

// Provider component (typically the app root)
class BacklogApp extends BaseComponent {
  providers = this.provide({
    [SidebarScope]: () => new SidebarScopeService(),
    [EventBus]: () => new BacklogEventsService(),
    [UrlState]: () => new UrlStateService(),
  });
}

// Consumer component (anywhere in the tree)
class TaskList extends BaseComponent {
  scope = this.inject(SidebarScope);   // resolved from nearest ancestor provider
  events = this.inject(EventBus);
}
```

Resolution walks up the DOM tree from the requesting component to find the nearest ancestor that provides the requested token. Values are created lazily (on first inject) and cached on the provider. This is essentially the same pattern as React's Context but using the real DOM tree.

### Event System (`events.ts`)

```typescript
// Declarative map — all listeners auto-removed on disconnectedCallback
events = this.listen({
  // Scoped to this component's shadow/light DOM
  '.btn click': (e) => this.handleClick(e),
  '.input input debounce:300': (e) => this.search(e.target.value),

  // Global listeners (document-level custom events)
  'document task-selected': (e) => this.onTaskSelected(e.detail),
  'document filter-change': (e) => this.onFilter(e.detail),

  // Service subscriptions (SSE, etc.)
  'service backlogEvents.onChange': (event) => this.onBackendChange(event),
});
```

The `listen()` method parses the key string at component creation, attaches listeners in `connectedCallback`, and detaches them in `disconnectedCallback`. The `debounce:N` modifier is built in. The `service` prefix subscribes to injectable service callbacks.

### Migration Path

Components can be migrated one at a time:
1. Old `HTMLElement` components and new `BaseComponent` components coexist
2. The DI container falls back to the existing singleton imports when no provider is found
3. `html` tagged templates and `innerHTML` can coexist during transition
4. No changes to the build system — esbuild handles everything as-is

### Strengths
- Zero-overhead updates: signal → exact DOM node, no diffing
- Familiar mental model (signals are mainstream: Solid, Angular 17+, Preact, TC39 proposal)
- Template is parsed once, cloned per instance, then only bindings execute
- True fine-grained reactivity — updating one task's status touches one `<span>`, not the whole list
- DI makes testing trivial (inject mocks) and eliminates hard-coded singleton imports

### Weaknesses
- Tagged template engine is the most complex piece (~200 lines) — needs careful implementation
- List reconciliation (repeat/keyed) is inherently tricky
- New abstraction to learn for contributors

---

## Proposal B: Proxy-Based Reactive Properties with Morphdom Patching

**Core idea**: Instead of signals, use ES Proxy to make plain object properties reactive. Instead of targeted binding, use `morphdom` (or a minimal clone of it) to diff real DOM → real DOM after a full template re-render. Simpler mental model, less framework code.

### Architecture

```
viewer/framework/
├── reactive.ts        # Proxy-based reactive state with dirty tracking
├── component.ts       # BaseComponent with auto-render on property change
├── morph.ts           # Minimal DOM morph (real DOM → real DOM diff)
├── events.ts          # Same declarative event system as Proposal A
├── injector.ts        # Same DI as Proposal A
└── index.ts
```

### Reactive Properties (`reactive.ts`)

```typescript
class TaskItem extends BaseComponent {
  // All properties on `this.state` are reactive
  state = this.reactive({
    title: '',
    status: 'open',
    selected: false,
    childCount: 0,
  });

  template() {
    const { title, status, selected } = this.state;
    return `
      <div class="task-item ${selected ? 'selected' : ''}">
        <task-badge task-id="${this.id}"></task-badge>
        <span class="task-title">${title}</span>
        <span class="status-badge status-${status}">${status.replace('_', ' ')}</span>
      </div>
    `;
  }
}
```

Writes to `this.state.title = 'new'` trigger a batched re-render. The `reactive()` method wraps the object in a Proxy that intercepts `set` and schedules a microtask render.

### Morphdom Patching (`morph.ts`)

Instead of targeted bindings, the component re-renders its full template string on every change, then uses a real-DOM-to-real-DOM morph algorithm:

1. Component calls `template()` which returns an HTML string
2. Framework parses the string into a temporary `DocumentFragment`
3. Morph algorithm walks old DOM and new fragment in parallel
4. Matching nodes (by tag + key attribute) are updated in place
5. New nodes are inserted, removed nodes are detached
6. Text nodes are updated if content differs

This is the approach used by Turbo/Stimulus (via idiomorph), htmx, and Phoenix LiveView.

### Strengths
- Extremely simple mental model: "change a property, template re-runs, DOM auto-updates"
- Template is plain HTML string — no tagged template learning curve
- Morphing preserves focus, scroll position, and CSS transitions automatically
- Implementation is smaller (~150 lines for a minimal morph)
- Closest to what exists today — smallest conceptual leap for migration

### Weaknesses
- **O(n) diffing on every change** — morph must walk the entire subtree even if one attribute changed
- Still re-runs the full template function, recreating the HTML string, on every state change
- Cannot achieve truly fine-grained updates (changing one signal can't skip non-affected subtrees)
- Morph algorithms have edge cases with keyed lists, `<select>`, contenteditable, and third-party DOM mutations
- String-based templates cannot express conditional logic as cleanly (ternary soup)

---

## Proposal C: Hybrid — Signals for State, Morphdom for DOM

**Core idea**: Use signals from Proposal A for state management and dependency tracking, but use morphdom from Proposal B for DOM application. This gets the ergonomic state model without the complexity of the targeted binding engine.

### How It Works

```typescript
class TaskItem extends BaseComponent {
  title = this.signal('');
  status = this.signal('open');
  selected = this.signal(false);

  // Template returns a string (like Proposal B)
  template() {
    return `
      <div class="task-item ${this.selected() ? 'selected' : ''}">
        <task-badge task-id="${this.id}"></task-badge>
        <span class="task-title">${this.title()}</span>
        <span class="status-badge status-${this.status()}">${this.status()}</span>
      </div>
    `;
  }
}
```

The `template()` method is wrapped in an `effect()`. When any signal read inside `template()` changes, the effect re-runs, producing a new HTML string. The morph algorithm applies the diff to the live DOM.

### Strengths
- Signals provide computed/effect/batch primitives for complex derived state
- Template is still a plain string — no binding engine complexity
- Morph handles DOM preservation
- Best middle ground between complexity and capability

### Weaknesses
- Inherits morph's O(n) diffing cost
- Signals exist but their fine-grained nature is wasted — every signal change re-runs the full template
- Two mental models to understand (signals + morph) without the full benefit of either
- "Worst of both worlds" risk: signal complexity without signal performance

---

## Comparison Matrix

| Criterion | A: Signals + Targeted Binding | B: Proxy + Morphdom | C: Signals + Morphdom |
|---|---|---|---|
| **Update granularity** | Signal → exact DOM node | Full subtree morph | Full subtree morph |
| **Performance at scale** | O(1) per signal change | O(n) tree walk per change | O(n) tree walk per change |
| **SSE update cost** | Update 1 task = patch 1 row | Update 1 task = morph entire list | Update 1 task = morph entire list |
| **Template complexity** | Tagged template (new concept) | Plain HTML string (familiar) | Plain HTML string (familiar) |
| **Framework code size** | ~600 lines (~3KB min) | ~400 lines (~2KB min) | ~500 lines (~2.5KB min) |
| **Implementation risk** | Higher (binding engine, repeat) | Lower (morph is well-understood) | Medium |
| **Migration effort** | Medium (new template syntax) | Low (templates stay as strings) | Medium (add signals, keep strings) |
| **Ceiling for optimization** | Very high (surgical updates) | Limited (always walks tree) | Limited (always walks tree) |
| **State management** | Signals (computed, effect, batch) | Proxy (simple get/set) | Signals (computed, effect, batch) |
| **Testability** | High (signals are pure) | Medium (need DOM for proxy) | High (signals are pure) |
| **Event handling** | Same across all proposals | Same across all proposals | Same across all proposals |
| **Dependency injection** | Same across all proposals | Same across all proposals | Same across all proposals |

---

## Recommendation: Proposal A — Signal-Driven Base Class with Targeted DOM Patching

### Rationale

1. **The core problem is needless re-rendering**. The user's primary complaint — "new data arrives from the backend and it causes to re-render the entire freakin DOM tree" — is a granularity problem. Proposals B and C improve on `innerHTML` but still walk the full subtree. Only Proposal A achieves O(1) updates: one signal change → one DOM mutation.

2. **The complexity is front-loaded, not ongoing**. The binding engine in `template.ts` is ~200 lines of code written once. After that, every component author gets fine-grained reactivity for free by writing natural-looking tagged templates. The alternative — morphdom — is simpler to implement but imposes O(n) cost on every component, forever.

3. **Signals are the industry direction**. TC39 has a signals proposal. Angular, Solid, Preact, Qwik, and Vue (refs) all converge on this model. Building on signals means the mental model will be familiar to anyone who has touched modern frontend in the last two years.

4. **The repeat() problem is solvable**. Keyed list reconciliation is well-understood (same algorithm in every framework). We can start with a simple append/remove strategy and optimize to full keyed reconciliation later.

5. **The DI system pays for itself immediately**. Replacing 15 hard-coded singleton imports with injectable tokens makes every component testable in isolation — something currently impossible without mocking module imports.

6. **Incremental adoption eliminates migration risk**. Old components keep working. New components use `BaseComponent`. The two can coexist indefinitely. There is no "big bang" rewrite.

### Implementation Order

| Phase | What | Unblocks |
|---|---|---|
| 1 | `signal.ts` — Signal, Computed, Effect with batching | Everything |
| 2 | `component.ts` — BaseComponent lifecycle, `this.signal()`, `this.inject()` | Component migration |
| 3 | `events.ts` — Declarative `this.listen()` with auto-cleanup | Cleaner event wiring |
| 4 | `template.ts` — Tagged `html` with binding engine | Fine-grained rendering |
| 5 | `injector.ts` — Provider/inject with DOM-tree resolution | Testability, decoupling |
| 6 | Migrate `task-item` as proof-of-concept (smallest leaf component) | Validate the approach |
| 7 | Migrate `task-list` with `repeat()` (biggest pain point) | Prove list perf |

### File Structure

```
viewer/framework/
├── signal.ts          # ~120 lines — Signal, Computed, Effect, batch
├── component.ts       # ~100 lines — BaseComponent extends HTMLElement
├── template.ts        # ~200 lines — Tagged html, Binding, repeat()
├── events.ts          # ~80 lines  — Declarative listen() with auto-cleanup
├── injector.ts        # ~60 lines  — createToken, provide, inject
└── index.ts           # ~10 lines  — Re-exports
```

Total: ~570 lines of framework code, 0 external dependencies, 0 build plugins.

## Consequences

### Positive
- SSE updates patch individual task rows instead of rebuilding the entire list
- Event listeners are declarative, auto-cleaned, and type-safe
- State is explicit (signals) instead of implicit (scattered private fields)
- Components become testable via DI (inject mock services)
- New components are ~40% less code than current equivalents
- Framework code lives in one folder, clearly separated from application code
- No new build tooling — esbuild handles tagged templates natively

### Negative
- Contributors must learn signals and tagged template binding syntax
- The template binding engine is the most complex piece and must be robust
- Debugging reactive chains requires understanding the push-pull propagation model
- Two component styles coexist during migration (HTMLElement and BaseComponent)

### Risks
- Tagged template performance: parsing + cloning must be fast. Mitigated by caching parsed templates per component class.
- Memory: each binding holds a DOM node reference. Mitigated by cleanup in `disconnectedCallback`.
- Edge cases in `repeat()` (reordering, nested lists). Mitigated by starting with simple append/remove and upgrading to keyed reconciliation.
