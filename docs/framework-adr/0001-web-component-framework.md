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

## Proposal A: Pure Functions with Setup Context and Targeted DOM Patching

**Core idea**: All framework primitives — `signal()`, `computed()`, `effect()`, `inject()`, `listen()` — are **pure, standalone functions**, not class methods. Components declare a `setup()` function that runs inside an ambient context, so these functions can resolve the owning component without needing `this`. The class becomes a thin shell; all logic lives in composable functions.

**Design principle**: If it doesn't need `this`, it shouldn't be on `this`. Signals are just reactive atoms. `inject()` is just a tree lookup. `listen()` is just event registration with lifecycle. None of these are inherently tied to a class instance. They only need to know *which component is currently being set up* — and that's a single context variable, not inheritance.

### Architecture

```
viewer/framework/
├── signal.ts          # signal(), computed(), effect() — pure functions
├── component.ts       # defineComponent() + minimal BaseComponent shell
├── template.ts        # html tagged template → DOM binding engine
├── events.ts          # listen() — pure function, auto-cleanup via context
├── injector.ts        # createToken(), provide(), inject() — pure functions
├── context.ts         # Setup context: getCurrentComponent() + runWithContext()
└── index.ts           # Public API barrel export
```

### Setup Context (`context.ts`)

The glue that lets pure functions access the component they belong to, without `this`:

```typescript
// Framework-internal — not part of the public API
let currentComponent: BaseComponent | null = null;

export function runWithContext(component: BaseComponent, fn: () => void) {
  const prev = currentComponent;
  currentComponent = component;
  fn();
  currentComponent = prev;
}

export function getCurrentComponent(): BaseComponent {
  if (!currentComponent) {
    throw new Error('inject()/listen() called outside setup()');
  }
  return currentComponent;
}
```

This is the same pattern used by Angular's `inject()`, Solid's `createSignal()`, and Vue's `setup()`. The context exists only during component initialization — it's not a runtime thing.

### Signal Primitive (`signal.ts`) — Pure Functions

```typescript
import { signal, computed, effect } from './framework';

// These are standalone functions — no class, no this, no context needed
const [count, setCount] = signal(0);
count();            // read → 0 (auto-tracks if inside effect/computed)
setCount(5);        // write → notifies dependents
setCount(n => n + 1); // updater function

// Derived — lazy, cached, auto-tracks
const doubled = computed(() => count() * 2);

// Side effect — re-runs when deps change, returns dispose function
const dispose = effect(() => {
  console.log('count is', count());
  return () => { /* cleanup on re-run or dispose */ };
});
```

Signals are **completely decoupled from components**. They work anywhere: in a component setup, in a service, in a plain module, in a test. They're just reactive atoms with dependency tracking.

**Key design choice**: Push-pull hybrid. Writes push "dirty" flags up the graph. Reads pull fresh values lazily. Computed values aren't recalculated until actually read.

**Batch updates**: Multiple synchronous writes coalesce into one microtask flush via `queueMicrotask`. `setA(1); setB(2); setC(3)` triggers one update pass, not three.

### Component Model (`component.ts`) — Thin Shell + setup()

```typescript
import { defineComponent, html, signal, computed, inject, listen } from './framework';

// ---------- Example: TaskItem ----------
const TaskItem = defineComponent('task-item', (host) => {
  // Reactive state — plain function calls, no this
  const title = signal('');
  const status = signal('open');
  const selected = signal(false);
  const childCount = signal(0);

  // Inject services — resolved from ancestor providers via DOM tree
  const scope = inject(SidebarScope);

  // Derived state — auto-recomputes when dependencies change
  const statusLabel = computed(() => status().replace('_', ' '));

  // Events — auto-cleaned when component disconnects
  listen('.task-item click', () => {
    document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId: host.id } }));
  });
  listen('.enter-icon click', (e) => {
    e.stopPropagation();
    scope.set(host.dataset.id);
  });
  listen('document task-selected', (e) => {
    selected.set(e.detail.taskId === host.dataset.id);
  });

  // Template — returns binding map, not HTML string
  return html`
    <div class="task-item ${() => selected() ? 'selected' : ''}">
      <task-badge task-id="${() => host.dataset.id}"></task-badge>
      <span class="task-title">${title}</span>
      <span class="status-badge status-${status}">${statusLabel}</span>
      ${() => childCount() > 0 ? html`<span class="child-count">${childCount}</span>` : null}
    </div>
  `;
});
```

**What `defineComponent()` does internally**:
1. Creates a class extending `HTMLElement` (you never write `class ... extends` yourself)
2. In `connectedCallback`, calls `runWithContext(this, setupFn)` — this is the only moment the context exists
3. The `setup()` function's pure function calls (`signal()`, `inject()`, `listen()`) register themselves against the context
4. `setup()` returns an `html` template result, which gets mounted
5. In `disconnectedCallback`, all registered listeners and effects are disposed automatically

The component author never touches `connectedCallback`, `disconnectedCallback`, `attributeChangedCallback`, or `this`. The setup function receives `host` (the raw element) for the rare cases you need it (reading `dataset`, `id`, etc.).

### Why This Is Better Than `this.signal()` / `this.inject()`

| `this.method()` style (old proposal) | Pure function style (this proposal) |
|---|---|
| `title = this.signal('')` | `const title = signal('')` |
| `scope = this.inject(SidebarScope)` | `const scope = inject(SidebarScope)` |
| `events = this.listen({...})` | `listen('.btn click', handler)` |
| Requires class inheritance | `defineComponent()` — no class authoring |
| Logic locked inside a class body | Composable — extract to shared functions |
| Can't share logic between components | Extract a function, call it from any setup |
| Testing requires instantiating the class | Test signals/services in isolation, no DOM needed |

**Composability** is the killer advantage. Because everything is a plain function, you can extract and share reactive logic:

```typescript
// Shared composable — works in any component's setup()
function useSelection(getId: () => string) {
  const selected = signal(false);
  listen('document task-selected', (e) => {
    selected.set(e.detail.taskId === getId());
  });
  return selected;
}

// Used in TaskItem setup:
const selected = useSelection(() => host.dataset.id!);

// Used in TaskDetail setup:
const selected = useSelection(() => currentTaskId());
```

This is a "composable" / "hook" without React's rules-of-hooks constraints. It's just a function that calls other functions. No ordering rules, no conditional call restrictions.

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
    ${repeat(tasks, task => task.id, task => html`
      <task-item data-id="${task.id}" ...></task-item>
    `)}
  </div>
`
```

`repeat()` uses key-based reconciliation: adds new items, removes deleted items, reorders moved items — but never recreates items whose data merely changed. Existing items receive signal updates through their bindings.

### Dependency Injection (`injector.ts`) — Pure Functions

```typescript
import { createToken, provide, inject } from './framework';

// Define tokens — plain constants
const SidebarScope = createToken<SidebarScopeService>('SidebarScope');
const EventBus = createToken<BacklogEventsService>('EventBus');
const UrlState = createToken<UrlStateService>('UrlState');

// Provider (app root setup)
const BacklogApp = defineComponent('backlog-app', (host) => {
  provide(SidebarScope, () => new SidebarScopeService());
  provide(EventBus, () => new BacklogEventsService());
  provide(UrlState, () => new UrlStateService());
  // ...
});

// Consumer (any descendant setup)
const TaskList = defineComponent('task-list', (host) => {
  const scope = inject(SidebarScope);   // walks DOM tree to find provider
  const events = inject(EventBus);
  // ...
});
```

`inject()` calls `getCurrentComponent()` internally, walks up `host.parentElement` to find the nearest ancestor that called `provide()` for that token. Values are lazy-created and cached. Falls back to a module-level registry for backward compat with existing singletons during migration.

### Event System (`events.ts`) — Pure Functions

```typescript
// Inside any setup() function:

// Local DOM events — scoped to this component's subtree
listen('.btn click', (e) => handleClick(e));
listen('.input input', (e) => search(e.target.value), { debounce: 300 });

// Global custom events
listen('document task-selected', (e) => onTaskSelected(e.detail));
listen('document filter-change', (e) => onFilter(e.detail));

// Service subscriptions
listen(EventBus, 'onChange', (event) => onBackendChange(event));
```

`listen()` reads the setup context to know which component owns this listener. It registers the listener for attachment in `connectedCallback` and removal in `disconnectedCallback`. The component author never writes lifecycle code.

### Migration Path

Components can be migrated one at a time:
1. Old `HTMLElement` components and new `defineComponent` components coexist in the same DOM
2. `inject()` falls back to existing singleton imports when no ancestor provider is found
3. `html` tagged templates and `innerHTML` can coexist during the transition
4. No changes to the build system — esbuild handles everything as-is
5. The `host` parameter gives escape-hatch access to the raw element for edge cases

### Strengths
- Zero-overhead updates: signal → exact DOM node, no diffing
- **Pure functions everywhere** — no `this`, no class authoring, no inheritance
- **Composable** — extract shared logic into plain functions (like React hooks but no rules)
- Signals work standalone (in services, tests, modules) — not coupled to components
- Template is parsed once, cloned per instance, then only bindings execute
- True fine-grained reactivity — updating one task's status touches one `<span>`, not the whole list
- DI via pure `inject()` makes testing trivial without mocking module imports

### Weaknesses
- Tagged template engine is the most complex piece (~200 lines) — needs careful implementation
- List reconciliation (repeat/keyed) is inherently tricky
- Setup context pattern may confuse contributors unfamiliar with Angular/Solid/Vue 3
- Calling `signal()`/`inject()` outside `setup()` throws — must be clearly documented

---

## Proposal B: Proxy-Based Reactive Properties with Morphdom Patching

**Core idea**: Instead of signals, use ES Proxy to make plain object properties reactive. Instead of targeted binding, use `morphdom` (or a minimal clone of it) to diff real DOM → real DOM after a full template re-render. Simpler mental model, less framework code.

### Architecture

```
viewer/framework/
├── reactive.ts        # Proxy-based reactive state with dirty tracking
├── component.ts       # defineComponent() with reactive state
├── morph.ts           # Minimal DOM morph (real DOM → real DOM diff)
├── events.ts          # listen() — same pure function approach as Proposal A
├── injector.ts        # inject()/provide() — same as Proposal A
├── context.ts         # Same setup context as Proposal A
└── index.ts
```

### Reactive Properties (`reactive.ts`)

```typescript
import { defineComponent, reactive, inject, listen } from './framework';

const TaskItem = defineComponent('task-item', (host) => {
  // Reactive state — plain object, writes auto-trigger re-render
  const state = reactive({
    title: '',
    status: 'open',
    selected: false,
    childCount: 0,
  });

  const scope = inject(SidebarScope);

  listen('.task-item click', () => { /* ... */ });

  // Template returns plain HTML string
  return () => `
    <div class="task-item ${state.selected ? 'selected' : ''}">
      <task-badge task-id="${host.dataset.id}"></task-badge>
      <span class="task-title">${state.title}</span>
      <span class="status-badge status-${state.status}">${state.status.replace('_', ' ')}</span>
    </div>
  `;
});
```

`reactive()` wraps the object in a Proxy. Writes to `state.title = 'new'` schedule a batched re-render via microtask. The setup function returns a **render function** (not a template result) — a closure that produces an HTML string each time.

### Morphdom Patching (`morph.ts`)

On every batched change:
1. The render function is called, producing a new HTML string
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
- Same pure function model for `inject()`, `listen()` as Proposal A

### Weaknesses
- **O(n) diffing on every change** — morph must walk the entire subtree even if one attribute changed
- Still re-runs the full render function, recreating the HTML string, on every state change
- Cannot achieve truly fine-grained updates (changing one property can't skip non-affected subtrees)
- Morph algorithms have edge cases with keyed lists, `<select>`, contenteditable, and third-party DOM mutations
- String-based templates cannot express conditional logic as cleanly (ternary soup)
- No computed/effect primitives — derived state must be manually managed

---

## Proposal C: Hybrid — Signals for State, Morphdom for DOM

**Core idea**: Use signals from Proposal A for state management and dependency tracking, but use morphdom from Proposal B for DOM application. Gets the ergonomic state model without the complexity of the targeted binding engine.

### How It Works

```typescript
import { defineComponent, signal, computed, inject, listen } from './framework';

const TaskItem = defineComponent('task-item', (host) => {
  const title = signal('');
  const status = signal('open');
  const selected = signal(false);

  const statusLabel = computed(() => status().replace('_', ' '));

  listen('document task-selected', (e) => {
    selected.set(e.detail.taskId === host.dataset.id);
  });

  // Returns a render function (plain string), not a binding template
  return () => `
    <div class="task-item ${selected() ? 'selected' : ''}">
      <task-badge task-id="${host.dataset.id}"></task-badge>
      <span class="task-title">${title()}</span>
      <span class="status-badge status-${statusLabel()}">${statusLabel()}</span>
    </div>
  `;
});
```

The returned render function is wrapped in an `effect()`. When any signal read inside it changes, the effect re-runs, producing a new HTML string. The morph algorithm applies the diff to the live DOM.

### Strengths
- Signals provide computed/effect/batch primitives for complex derived state
- Template is still a plain string — no binding engine complexity
- Morph handles DOM preservation
- Same pure function model as Proposals A and B
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
| **Template complexity** | Tagged `html` template (new concept) | Plain HTML string (familiar) | Plain HTML string (familiar) |
| **Framework code size** | ~570 lines (~3KB min) | ~400 lines (~2KB min) | ~500 lines (~2.5KB min) |
| **Implementation risk** | Higher (binding engine, repeat) | Lower (morph is well-understood) | Medium |
| **Migration effort** | Medium (new template syntax) | Low (templates stay as strings) | Medium (add signals, keep strings) |
| **Ceiling for optimization** | Very high (surgical updates) | Limited (always walks tree) | Limited (always walks tree) |
| **State management** | Signals (computed, effect, batch) | Proxy (simple get/set) | Signals (computed, effect, batch) |
| **Composability** | High — extract to shared functions | Medium — reactive() is component-tied | High — signals are standalone |
| **Testability** | High (signals are pure, inject mocks) | Medium (need DOM for proxy) | High (signals are pure, inject mocks) |
| **Component authoring** | `defineComponent()` + pure functions | `defineComponent()` + pure functions | `defineComponent()` + pure functions |
| **DI / Events** | Pure `inject()` / `listen()` | Pure `inject()` / `listen()` | Pure `inject()` / `listen()` |

---

## Recommendation: Proposal A — Pure Functions with Signals and Targeted DOM Patching

### Rationale

1. **The core problem is needless re-rendering**. The primary complaint — "new data arrives from the backend and it causes to re-render the entire freakin DOM tree" — is a granularity problem. Proposals B and C improve on `innerHTML` but still walk the full subtree. Only Proposal A achieves O(1) updates: one signal change → one DOM mutation.

2. **Pure functions are the right default**. `signal()`, `inject()`, `listen()` don't need a class. Making them standalone functions means they compose naturally — extract shared logic into a `useSelection()` or `useSSE()` function, call it from any component's `setup()`. No mixins, no multiple inheritance, no decorator magic. This is the same insight that drove React hooks, Vue 3 Composition API, and Angular's functional `inject()`.

3. **The complexity is front-loaded, not ongoing**. The binding engine in `template.ts` is ~200 lines of code written once. After that, every component author gets fine-grained reactivity for free by writing natural-looking tagged templates. Morphdom is simpler to implement but imposes O(n) cost on every component, forever.

4. **Signals are the industry direction**. TC39 has a signals proposal. Angular, Solid, Preact, Qwik, and Vue all converge on this model. Building on signals means the mental model will be familiar to anyone who has touched modern frontend in the last two years.

5. **The DI system pays for itself immediately**. Replacing 15 hard-coded singleton imports with injectable tokens via pure `inject()` makes every component testable in isolation — something currently impossible without mocking module imports.

6. **Incremental adoption eliminates migration risk**. Old `HTMLElement` components keep working. New `defineComponent` components coexist in the same DOM tree. There is no "big bang" rewrite.

### Implementation Order

| Phase | What | Unblocks |
|---|---|---|
| 1 | `signal.ts` — `signal()`, `computed()`, `effect()` with batching | Everything |
| 2 | `context.ts` — `runWithContext()`, `getCurrentComponent()` | Pure function DI/events |
| 3 | `component.ts` — `defineComponent()` shell + lifecycle | Component authoring |
| 4 | `events.ts` — `listen()` with auto-cleanup via context | Cleaner event wiring |
| 5 | `injector.ts` — `createToken()`, `provide()`, `inject()` | Testability, decoupling |
| 6 | `template.ts` — Tagged `html` with binding engine | Fine-grained rendering |
| 7 | Migrate `task-item` as proof-of-concept (smallest leaf) | Validate the approach |
| 8 | Migrate `task-list` with `repeat()` (biggest pain point) | Prove list perf |

### File Structure

```
viewer/framework/
├── signal.ts          # ~120 lines — signal(), computed(), effect(), batch
├── context.ts         # ~20 lines  — runWithContext(), getCurrentComponent()
├── component.ts       # ~80 lines  — defineComponent(), lifecycle wiring
├── template.ts        # ~200 lines — html tagged template, Binding, repeat()
├── events.ts          # ~80 lines  — listen() with auto-cleanup
├── injector.ts        # ~60 lines  — createToken(), provide(), inject()
└── index.ts           # ~10 lines  — Re-exports
```

Total: ~570 lines of framework code, 0 external dependencies, 0 build plugins.

## Consequences

### Positive
- SSE updates patch individual task rows instead of rebuilding the entire list
- **No `this` in component authoring** — pure functions all the way down
- **Composable** — shared reactive logic extracted as plain functions, reusable across components
- Signals work anywhere (services, tests, standalone modules) — not coupled to components
- Event listeners are declarative, auto-cleaned, and type-safe via `listen()`
- State is explicit (signals) instead of implicit (scattered private fields)
- Components become testable via `inject()` (provide mock services)
- New components are ~40% less code than current equivalents
- Framework code lives in one folder, clearly separated from application code
- No new build tooling — esbuild handles tagged templates natively

### Negative
- Contributors must learn signals, tagged template bindings, and the setup context pattern
- The template binding engine is the most complex piece and must be robust
- Debugging reactive chains requires understanding the push-pull propagation model
- Two component styles coexist during migration (raw HTMLElement and defineComponent)
- Calling `inject()`/`listen()` outside `setup()` throws — must be clearly documented

### Risks
- Tagged template performance: parsing + cloning must be fast. Mitigated by caching parsed templates per component class.
- Memory: each binding holds a DOM node reference. Mitigated by cleanup in `disconnectedCallback`.
- Setup context confusion: calling `inject()` outside setup throws. Mitigated by clear error messages ("inject() must be called inside defineComponent setup").
- Edge cases in `repeat()` (reordering, nested lists). Mitigated by starting with simple append/remove and upgrading to keyed reconciliation.
