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

### Problem 3: Untyped Global Event Pollution

Components communicate by spraying `document.dispatchEvent(new CustomEvent('task-selected', { detail: { taskId } }))` into the global void. This is problematic in several ways:

- **No type safety**: Event names are magic strings. Payloads are `any`. Nothing catches typos or shape mismatches at compile time.
- **Invisible contracts**: To understand what a component emits or consumes, you must read every line of its source. There's no declaration of "this component emits X and listens to Y."
- **Global namespace pollution**: All events live on `document`. Every component can hear every event. There's no scoping, no hierarchy, no intentional communication boundaries.
- **Coupling via hidden channels**: `task-item.ts:71` dispatches `task-selected` on `document`. `task-list.ts:59`, `main.ts:33`, and `url-state` all listen. But none of these know about each other — the coupling is invisible and fragile.

**Evidence**: `main.ts` is essentially a hand-written event router — 8 `document.addEventListener` calls wiring components to services. This is the "framework" the codebase accidentally grew.

### Problem 4: Events Are Detached from Templates

Event listeners are registered in one place (`listen('.task-row click', ...)` or `attachListeners()`) while the DOM elements they target are defined in another (the template). This creates coupling via CSS selectors — rename a class in the template and the event silently stops working. There's no way to see, from reading the template alone, which elements are interactive.

**Evidence**: `task-item.ts:39-77` — `attachListeners()` queries for `.task-item` and `.enter-icon` by selector after render. If the template changes the class name, the listener breaks silently.

### Problem 5: No Shared State Primitives

State is scattered across:
- Private class fields (`this.currentFilter`, `this.selectedTaskId`)
- URL params via `UrlState` singleton
- `localStorage` via `SidebarScope` singleton
- `data-*` attributes on DOM elements
- Imperative service singletons (`splitPane`, `backlogEvents`)

There is no unified way to declare "this component depends on X, re-render when X changes." Dependencies are implicit, wired up manually, and easy to get wrong.

### Problem 6: No Lifecycle Management

Components subscribe to global events and services but rarely unsubscribe. `ActivityPanel` is the only component that implements `disconnectedCallback` cleanup. All others leak listeners when removed from the DOM.

### Problem 7: CSS Is a Maintenance Bottleneck

`styles.css` is a single 600+ line global stylesheet with manual class names. Every new component means adding more hand-written CSS. Component styles are not colocated with component logic — they live in a separate file, requiring constant context-switching. Class naming is ad-hoc (`.task-item`, `.epic-separator`, `.empty-state-inline`), with no system or convention.

For AI-assisted development, this is especially problematic: an LLM generating a component must also know and maintain a separate CSS file with project-specific class names. There's no way for the AI to see what a component looks like from its source alone.

### What We Want

A lightweight framework layer — **not** React, **not** Angular, **no compiler, no virtual DOM, no runtime scheduler** — that gives us:
1. **Fine-grained reactivity** so only changed parts of the DOM update
2. **Declarative event binding** that auto-cleans on disconnect
3. **Signal-based state** with automatic dependency tracking
4. **Stateless dependency injection** for services (no global singletons with hard imports)
5. **A single `viewer/framework/` folder** housing all framework code
6. **Colocated styling** — styles visible in the component source, not a separate file

### Design Principle: Human-AI Coherence

This framework will be authored and maintained by humans and AI collaboratively. Every design choice should optimize for **coherence** — how easily both a human and an LLM can read, write, and reason about the code without special knowledge or hidden conventions.

This means:
- **No invented syntax** — use standard TypeScript and HTML, no DSLs
- **No hidden magic** — if something happens, it should be visible in the source
- **No `this`** — pure functions are universally understood by humans and LLMs
- **Implicit over explicit ceremony** — signals should just work in templates without calling them
- **Styles inline with structure** — an LLM should produce a complete component in one function
- **Predictable patterns** — every component follows the same shape, no variations

### Design Principle: Hard to Write Wrong

AI generates large volumes of code. The human review bottleneck is attention. Every error the compiler catches is one the human doesn't have to find in a code review.

This means:
- **Compile-time prop checking** — factory composition catches missing, misspelled, and wrongly-typed props at compile time, not as silent runtime `undefined`
- **Signal-typed props** — factory props require `Signal<T>`, making lost reactivity a compile error instead of a stale-data bug
- **One canonical way** — factory for components, `html` for internal DOM. Two valid ways to do the same thing = inconsistent codebase over time
- **Refactoring works** — renaming a prop in the interface updates all factory call sites via Find All References. HTML string attributes require regex search

### Design Principle: Framework Internals Are Maintainable by AI

The ~660 lines of framework code in `viewer/framework/` will also need bug fixes, optimizations, and new features — and those will be AI-assisted. The template binding engine (~270 lines) is the densest, most complex code in the system. A bug in the framework affects every component.

This means:
- **No cleverness** — framework code should read like a tutorial, not code golf
- **Named functions, not anonymous closures** — stack traces should be readable
- **Comment the "why" aggressively** — especially in the binding engine and signal graph
- **No micro-optimizations that obscure intent** — clarity beats saving 2μs
- **Each file is self-contained** — a developer (or LLM) can understand one framework file without reading all the others

### Constraints

- No build-time compiler or code transformation (beyond what esbuild already does)
- No virtual DOM — we diff at the data level, not the DOM level
- No runtime scheduler or fiber-like architecture
- Must be incrementally adoptable (migrate one component at a time)
- Must stay under ~3KB minified for all framework code combined
- Pure TypeScript, no external dependencies (Tailwind is a build-time tool, not a runtime dep)

---

## Proposal A: Pure Functions with Setup Context and Targeted DOM Patching

**Core idea**: All framework primitives — `signal()`, `computed()`, `effect()`, `inject()`, `listen()` — are **pure, standalone functions**, not class methods. Components declare a `setup()` function that runs inside an ambient context, so these functions can resolve the owning component without needing `this`. The class becomes a thin shell; all logic lives in composable functions.

**Design principle**: If it doesn't need `this`, it shouldn't be on `this`. Signals are just reactive atoms. `inject()` is just a tree lookup. `listen()` is just event registration with lifecycle. None of these are inherently tied to a class instance. They only need to know *which component is currently being set up* — and that's a single context variable, not inheritance.

### Architecture

```
viewer/framework/
├── signal.ts          # signal(), computed(), effect() — pure functions
├── query.ts           # query() — declarative async data loading with cache
├── component.ts       # component() + minimal BaseComponent shell + typed factory
├── template.ts        # html tagged template → DOM binding engine + @event
├── emitter.ts         # Emitter<T> base class — typed pub/sub for services
├── injector.ts        # provide(), inject() — class-as-token, auto-singleton
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

// Create a signal — returns a reactive container
const count = signal(0);

// Read: access .value (auto-tracks if inside effect/computed)
count.value             // → 0

// Write: assign to .value
count.value = 5;        // → notifies dependents

// Derived — lazy, cached, auto-tracks dependencies
const doubled = computed(() => count.value * 2);

// Side effect — re-runs when deps change, returns dispose function
const dispose = effect(() => {
  console.log('count is', count.value);
  return () => { /* cleanup on re-run or dispose */ };
});
```

Signals are **completely decoupled from components**. They work anywhere: in a component setup, in a service, in a plain module, in a test. They're just reactive atoms with dependency tracking.

#### Why `.value` and not `count()` — The Decision

In JavaScript, there is no way to make a plain variable reactive. When you write `const x = someSignal`, `x` holds a reference — reading `x` doesn't go through any proxy or trap. This is a language-level limitation that every framework hits:

| Framework | Read syntax | Write syntax | Requires compiler? |
|---|---|---|---|
| Svelte 5 | `count` | `count = 5` | Yes (`$state` rune) |
| Vue | `count.value` | `count.value = 5` | No |
| Angular 17+ | `count()` | `count.set(5)` | No |
| Solid | `count()` | `setCount(5)` | No |
| React | `count` | `setCount(5)` | No (but no tracking) |

Without a compiler, the only options are `.value` (property access) or `()` (function call). We evaluated both:

**`count()` (Solid/Angular style)**:
- Shorter by one character
- BUT: forgetting `()` is a **silent runtime bug**
- `count` without `()` gives you the function reference, which is truthy — `if (count)` is always true
- `count + 1` may produce `NaN` silently — TypeScript may not catch this in all contexts
- LLMs naturally write `count` when they see `const count = signal(0)` — the call syntax is easy to forget

**`count.value` (Vue style) — our choice**:
- Forgetting `.value` is a **compile-time error** — TypeScript catches `count + 1` (Signal<number> + number)
- `if (count)` is a TypeScript warning (object is always truthy) — caught by lint rules
- Read and write use the same syntax: `count.value` reads, `count.value = 5` writes — symmetric, no separate setter function
- The `.value` suffix is a visual marker that says "this is reactive" — both humans and LLMs learn this pattern once and apply it everywhere
- Vue has proven this ergonomic at massive scale over 5+ years

**The TypeScript safety argument is decisive.** With `()`, bugs hide until runtime. With `.value`, TypeScript catches them at compile time. In a codebase authored by humans and AI collaboratively, compile-time safety is worth the extra 6 characters.

**However, in templates, signals are fully implicit.** The `html` tag function receives the raw signal object in each `${}` slot. It detects signals (via `[Symbol.signal]` brand), reads `.value` for initial render, and subscribes for updates. You just write `${count}` — the template engine handles everything. This is the crucial difference from Vue, where you'd write `{{ count.value }}` in templates (or use auto-unwrapping with `ref()`). Our tagged template design means the most natural template code IS the correct code.

```typescript
// In JS code (computed, effect, event handlers):
const doubled = computed(() => count.value * 2);  // explicit — TypeScript enforced

// In html templates:
html`<span>${count}</span>`                       // implicit — just works
```

**Key design choice**: Push-pull hybrid. Writes push "dirty" flags up the graph. Reads pull fresh values lazily. Computed values aren't recalculated until actually read.

**Batch updates**: Multiple synchronous `.value` writes coalesce into one microtask flush via `queueMicrotask`. `a.value = 1; b.value = 2; c.value = 3` triggers one update pass, not three.

### Component Model (`component.ts`) — Typed Props, Factory Composition, Two-Layer Rendering

The `component()` function is the single entry point for defining a web component. It serves two purposes: (1) registers a custom element, and (2) returns a **typed factory function** for compile-time-safe composition. Props are declared as a TypeScript interface and passed as a generic — fully typed, no magic strings.

#### Props-First Signature

The setup function receives `(props, host)` — props first, host second. Props are the primary data interface (used in 95% of components). `host` is the raw `HTMLElement` escape hatch for imperative DOM access (`scrollIntoView()`, `focus()`, third-party library interop). By making it second, the API signals what matters:

```typescript
import { component, html, signal, computed, inject, when } from './framework';

// Props contract — one interface, fully typed
interface TaskItemProps {
  task: Task;
  selected: boolean;
}

const TaskItem = component<TaskItemProps>('task-item', (props, host) => {
  // props.task → Signal<Task>        — fully typed, no strings
  // props.selected → Signal<boolean>  — framework creates signals internally
  // host → HTMLElement               — escape hatch, rarely needed

  // Inject services from DI — auto-singleton, no registration needed
  const navigation = inject(NavigationEvents);

  // Derived state
  const title = computed(() => props.task.value.title);
  const status = computed(() => props.task.value.status.replace('_', ' '));
  const id = computed(() => props.task.value.id);

  // Handlers — plain functions, read from typed props, not host.dataset
  const onSelect = () => navigation.emit('select', { id: id.value });

  // Template — events INLINE with @, signals IMPLICIT
  return html`
    <div class="flex items-center gap-2 px-3 py-2 rounded cursor-pointer
                hover:bg-white/5 transition-colors"
         class:bg-white/10=${props.selected}
         class:border-l-2=${props.selected}
         class:border-blue-400=${props.selected}
         @click=${onSelect}>
      <task-badge task-id="${id}"></task-badge>
      <span class="flex-1 truncate text-sm">${title}</span>
      <span class="text-xs px-2 py-0.5 rounded-full bg-white/10">${status}</span>
      ${when(props.task.value.childCount,
        html`<span class="text-xs text-gray-400">${props.task.value.childCount}</span>`
      )}
    </div>
  `;
});
```

Notice what's NOT in this component:
- No `document.dispatchEvent`
- No `new CustomEvent`
- No `document.addEventListener`
- No `listen('.some-selector click', ...)`
- No `this`
- No `.value` or `()` in the template
- No separate CSS file
- No magic string prop declarations — the TypeScript interface IS the contract
- No `host.dataset` reads — data flows through typed props, not data-attributes

#### How Props Work — Typed, Auto-Resolved

`component<P>()` takes the props interface as a generic. The `props` parameter is a mapped type:

```typescript
type ReactiveProps<P> = { [K in keyof P]: Signal<P[K]> };
```

Every prop becomes a read-only `Signal`. The framework creates these signals internally and wires up property setters on the custom element class. No `prop('name')` calls, no `attr('name', default)` — the interface IS the declaration.

**Runtime prop discovery**: TypeScript interfaces are erased at compile time — you can't iterate `keyof TaskItemProps` in JavaScript. The framework uses a `Proxy` on the element instance to intercept property sets and create signals on-demand. When a parent (via factory or HTML tag) first sets a property, the Proxy trap detects it, creates a backing `Signal`, and registers the property name. Subsequent sets update the signal's `.value`. This means prop names are discovered at first use, not declared in a separate runtime schema. The factory's TypeScript generic ensures only valid prop names reach the element — the Proxy is the bridge from type-safe compile-time contract to runtime signal creation.

#### Two-Layer Rendering Model — Factory at Boundaries, Templates Inside

Component composition and internal DOM rendering serve different needs. The architecture uses a **two-layer model** that matches the right tool to each:

| Layer | What it does | Tool | Type safety |
|---|---|---|---|
| **Component composition** | Parent instantiates child components | Typed factory function | Compile-time — TypeScript checks every prop |
| **Internal DOM** | Component renders its own `<div>`, `<span>`, etc. | `html` tagged template | Runtime — HTML strings are untyped |

This split exists because: (1) component boundaries are where most bugs hide (wrong props, missing props, wrong types), so they need compile-time enforcement; (2) internal DOM structure is where readability matters most (layout, nesting, attributes), so it needs HTML-like syntax.

**Factory composition — how parents instantiate children**:

`component()` returns a **typed factory function** alongside registering the custom element. The factory is the canonical way to compose components:

```typescript
// component() returns a callable factory
const TaskItem = component<TaskItemProps>('task-item', (props, host) => { ... });

// Parent uses the factory — TypeScript checks every prop
html`
  <div class="task-list">
    ${tasks.map(t => TaskItem({ task: currentTask, selected: isSelected }))}
  </div>
`

// Missing prop → compile-time error:
TaskItem({ task: currentTask })
//         ^ Error: Property 'selected' is missing in type...

// Wrong prop type → compile-time error:
TaskItem({ task: currentTask, selected: signal("yes") })
//                                      ^ Error: Signal<string> is not assignable to Signal<boolean>

// Typo in prop name → compile-time error:
TaskItem({ task: currentTask, selcted: isSelected })
//                             ^^^^^^ Error: Object literal may only specify known properties
```

The factory returns a `TemplateResult` — the same type that `html` templates produce. The DOM still has a real `<task-item>` custom element. The factory is just the type-safe way to produce it.

**Why factory props require `Signal<T>`, not plain `T`**:

In a signal-based framework without re-renders, reactivity must be explicit. When a parent passes a prop, the child needs to stay reactive to changes — not receive a frozen snapshot. The factory enforces this:

```typescript
// ✅ Correct — passes signal, child stays reactive
const currentTask = signal<Task>(initialTask);
const isSelected = signal(false);
TaskItem({ task: currentTask, selected: isSelected })

// ❌ Compile error — passing .value loses reactivity
TaskItem({ task: currentTask.value, selected: true })
//         ^ Error: Task is not assignable to Signal<Task>

// For truly static props, wrap in signal() — explicit and intentional
TaskItem({ task: signal(staticTask), selected: signal(false) })
```

This is a deliberate design choice. In React, passing a plain value is safe because the parent re-runs on every state change, producing fresh prop values. We don't re-run — our setup function executes once. If a parent passes `currentTask.value` (a snapshot) instead of `currentTask` (a signal), the child renders stale data forever. Making the factory require `Signal<T>` turns this foot-gun into a compile-time error.

The small ergonomic cost of `signal(staticValue)` for rare static props is worth the safety win of catching lost reactivity at compile time.

**HTML tag syntax — the escape hatch for interop**:

The custom element registration still works. `<task-item>` is a real HTML element in the browser registry. HTML tag syntax is available for:
- Vanilla HTML elements: `html\`<div class="...">\``
- Legacy component interop during migration: `html\`<old-component attr="val">\``
- Cases where children/slots make factories awkward (see Children/Slots below)

```typescript
// HTML tag syntax — still works, but untyped (no compile-time prop checking)
html`<task-item task=${currentTask} selected=${isSelected}></task-item>`
// Auto-resolution still applies: framework detects registered props and uses
// JS properties instead of setAttribute(). But missing/misspelled props are silent.
```

The rule is simple: **factory for framework components (type-safe), HTML tags for vanilla elements and interop (convenient).**

#### Children and Slots in Factory Composition

Most components are leaf components (task-item, task-badge, filter-bar) that don't have children. For the structural/layout components that do:

```typescript
// Default children — second argument to the factory
CardLayout({ title: signal('Tasks') }, html`
  ${TaskList({ scope: scopeId })}
  ${TaskDetail({ task: selected })}
`)

// Named slots — typed props, compile-time checked
interface SplitPaneProps {
  left: TemplateResult;
  right: TemplateResult;
  ratio: number;
}

const SplitPane = component<SplitPaneProps>('split-pane', (props) => { ... });

// Parent — TypeScript checks slot names and types
SplitPane({
  left: signal(html`${TaskList({ scope: scopeId })}`),
  right: signal(html`${TaskDetail({ task: selected })}`),
  ratio: signal(0.4),
})

// Typo → compile-time error:
SplitPane({ lft: signal(html`...`), right: signal(html`...`), ratio: signal(0.4) })
//          ^^^ Error: Object literal may only specify known properties
```

Named slots as typed props is actually **better** than HTML `<slot name="...">` syntax — the compiler checks slot names, types, and completeness. HTML slots with `slot="lft"` would be a silent runtime bug.

#### Components Without Props

For components that don't take any props (pure internal state), skip the generic. No props, no host — clean:

```typescript
const ThemeToggle = component('theme-toggle', () => {
  const dark = signal(false);
  const toggle = () => { dark.value = !dark.value; };

  return html`
    <button class="p-2 rounded" @click=${toggle}>
      ${computed(() => dark.value ? 'Light Mode' : 'Dark Mode')}
    </button>
  `;
});
```

No generic, no props parameter, no host. When you need the raw element (rare):

```typescript
const AutoFocus = component('auto-focus', (_props, host) => {
  // host is the escape hatch — use it for imperative DOM APIs
  host.focus();
  // ...
});
```

#### Why the Tag Name String Stays

The string `'task-item'` in `component('task-item', ...)` is a web platform requirement: `customElements.define('tag-name', Class)` demands a hyphenated string. Every web component framework passes this string — Lit, Stencil, FAST, all of them. The only ways to avoid it would require a compiler (derive from variable name) or build tooling magic (file convention). Both are ruled out by our constraints.

It's the **only** magic string in the entire API. Everything else is typed.

**What `component()` does internally**:
1. Creates a class extending `HTMLElement` (you never write `class ... extends` yourself)
2. Registers property setters for each key in the props interface, each backed by a `Signal`
3. Returns a **typed factory function** that creates `TemplateResult` nodes with prop bindings
4. In `connectedCallback`, calls `runWithContext(this, setupFn)` — the only moment the context exists
5. The `setup()` function's pure function calls (`signal()`, `inject()`) register against the context
6. `setup()` returns an `html` template result, which gets mounted — including `@event` bindings
7. In `disconnectedCallback`, all subscriptions, effects, and event bindings are disposed automatically
8. If the setup function throws, the error boundary catches it and renders a fallback (see Error Boundaries below)

The component author never touches `connectedCallback`, `disconnectedCallback`, `attributeChangedCallback`, or `this`. Props are the primary interface; `host` is the escape hatch for imperative DOM access.

### Inline Events via `@event` — Events Live Where Elements Live

Events are **part of the template**, not separate from it:

```typescript
// Events are colocated with the elements they belong to
return html`
  <button @click=${onSave}>Save</button>
  <input @input=${onSearch} @keydown.escape=${onClear} />
  <div @mouseenter=${onHover} @mouseleave=${onLeave}>...</div>
`;
```

This eliminates the selector-coupling problem entirely. There's no `.btn click` string that must match a class in the template. The `@click` is ON the element — you can see from reading the template exactly which elements are interactive and what they do.

The `html` tag function processes `@event` attributes as event bindings:
1. Extracts the handler reference from the `${}` slot
2. Attaches it to the specific DOM element during mount
3. Removes it during unmount
4. Supports modifiers: `@click.stop`, `@input.debounce.300`, `@keydown.enter`

This is the same `@event` convention used by Lit and Vue templates — proven, familiar, and self-documenting.

### Conditional Rendering — `when()` for Toggles, `computed()` for Branches

#### Simple Toggle: `when()`

`when()` is scoped to **single-branch inline toggles** — show or hide one element:

```typescript
// Simple toggle — when() is the right tool
html`
  <button @click=${onSave}>Save</button>
  ${when(hasUnsavedChanges, html`<span class="text-yellow-400">Unsaved</span>`)}
`;
```

`when(condition, template)` — show template when condition is truthy. That's it. No else branch, no nesting.

#### Multi-State: Computed Views

For anything with 2+ branches, use `computed()` to select the right template in JavaScript — where `if`/`else` works naturally:

```typescript
const TaskDetail = component<TaskDetailProps>('task-detail', (props) => {
  const loading = signal(true);
  const error = signal<string | null>(null);

  // Complex conditional logic stays in JS — where if/else works naturally
  const content = computed(() => {
    if (loading.value) return html`<div class="animate-pulse">Loading...</div>`;
    if (error.value) return html`<div class="text-red-400">${error}</div>`;
    return html`
      <div class="task-detail">
        <h1>${props.task.value.title}</h1>
        <span>${props.task.value.status}</span>
      </div>
    `;
  });

  // Template stays clean — just one slot
  return html`<div class="container">${content}</div>`;
});
```

This requires **zero new API**. `computed()` already exists. `html` templates already work as values. The template engine handles signal-containing-template in slots (it has to, for `when()` to work at all). We're just using existing primitives.

**The principle**: `when()` is for simple inline toggles. For anything with 2+ branches, use `computed()` + `if`/`else` in JS, and reference it as a single `${view}` in the template. No nesting, no callback hell, each branch visually separate.

### Conditional Classes — `class:name` Directive

Toggling Tailwind classes based on state is a universal need. Ternary expressions in class strings get ugly fast:

```typescript
// Without class: directive — ternary soup
html`<div class="p-2 rounded ${selected.value ? 'bg-white/10 border-l-2 border-blue-400' : ''}">`;

// With class: directive — clean, each class toggled independently
html`<div class="p-2 rounded"
          class:bg-white/10=${selected}
          class:border-l-2=${selected}
          class:border-blue-400=${selected}>`;
```

`class:name=${signal}` is a **binding directive** processed by the template engine. When the signal is truthy, the class is added; when falsy, removed. Uses `classList.toggle(name, bool)` — one DOM operation, no string parsing.

This is the same convention used by Svelte (`class:active={isActive}`) and Vue (`:class`). It reads naturally: "this element has class `bg-white/10` when `selected` is true."

### List Rendering — `.map()` + `key`

Lists use the universally known `.map()` pattern with a `key` attribute for reconciliation:

```typescript
html`
  <div class="task-list">
    ${tasks.map(t => html`
      <task-item key=${t.id} task=${t}></task-item>
    `)}
  </div>
`
```

- `.map()` — universally known, every LLM writes it correctly
- `key=${t.id}` — React convention, everyone recognizes it
- No separate `repeat()` import, no key function argument, no unfamiliar API

**How it works**: `Signal<T[]>` has a `.map(fn)` method that returns a reactive mapped list. When the array signal changes, the framework uses the `key` attribute from each template fragment for keyed reconciliation — inserts new items, removes deleted ones, reorders moved ones, but never recreates items that just moved.

In the template slot, `tasks.map(fn)` returns a `ReactiveList` object that the template engine handles natively — same as it handles signals, just for collections.

### Error Boundaries

`component()` wraps the setup function in a try/catch. If the setup function (or any effect within it) throws, the error boundary catches it and renders a fallback:

```typescript
const TaskItem = component<TaskItemProps>('task-item', (props) => {
  // If anything here throws, the component renders an error state
  // instead of crashing the entire app
  const api = inject(BacklogAPI);
  // ...
});
```

The default fallback renders a minimal error indicator. Components can opt into custom error handling:

```typescript
const TaskDetail = component<TaskDetailProps>('task-detail', (props) => {
  // ...
}, {
  onError: (error, host) => html`<div class="text-red-400 p-2">Failed to load task</div>`
});
```

Errors are caught at the component boundary — one broken component doesn't take down sibling or parent components. This is critical for resilience when AI-generated components may have bugs.

**Runtime error handling**: Setup-time try/catch only covers synchronous initialization. Errors also occur in `effect()` callbacks (signal changes trigger re-computation), async operations (`query()` failures after mount), and `@event` handlers (`@click` handler throws). The framework handles each:

- **Effect errors**: `effect()` wraps each execution in try/catch. If an effect throws, it logs the error, renders the component's error fallback, and disposes the effect to prevent infinite re-throws. Other effects on the same component continue running.
- **Event handler errors**: The `@event` binding wraps handlers in try/catch. A throwing handler logs the error and prevents propagation — the component stays mounted.
- **Async errors via `query()`**: `query()` catches fetcher rejections and surfaces them via `tasks.error` signal. Components use `computed()` views to render error states reactively (see the TaskList example above). This systematizes the existing pattern in `task-list.ts` where `loadTasks()` has try/catch with fallback HTML.

The principle: errors are **contained** (one component can't crash another), **visible** (error state renders, not silent failure), and **recoverable** (signals can update and re-trigger rendering after an error).

### Declarative Data Loading — `query()` Primitive

Data fetching lives in **services**, injected via DI. Components orchestrate, services execute. Clear separation:

```typescript
// Service — plain class, the class itself IS the injection token
class BacklogAPI {
  async getTasks(filter: string): Promise<Task[]> { ... }
  async updateTask(id: string, patch: Partial<Task>): Promise<Task> { ... }
}
```

No `createToken()`. The class constructor is already a unique JavaScript object reference — it works as a `Map` key. It's already typed. It already has a name. There's nothing a token adds that the class doesn't already have.

#### The Problem with Manual Data Loading

Without a data loading primitive, every component that fetches data writes this:

```typescript
// ❌ Manual pattern — 15 lines of identical plumbing per component
const tasks = signal<Task[]>([]);
const loading = signal(true);
const error = signal<string | null>(null);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    tasks.value = await api.getTasks(props.scopeId.value);
  } catch (e) {
    error.value = e.message;
  }
  loading.value = false;
};

load();
effect(() => { props.scopeId.value; load(); }); // re-fetch when scope changes
```

This boilerplate will appear in every data-fetching component. The LLM will write it. It'll get it *slightly wrong* each time — forgetting to reset error, forgetting the re-fetch effect, forgetting `loading.value = false` in the catch branch. Humans reviewing will skim past it because it looks like the same pattern. And none of these bugs produce compile-time errors.

#### `query()` — React Query-Adjacent, Signal-Native

`query()` is a declarative async primitive that absorbs this boilerplate. It's ~50 lines of framework code, built on top of signals:

```typescript
import { query } from './framework';

// Declarative — one line replaces 15 lines of boilerplate
const tasks = query(
  () => ['tasks', props.scopeId.value],           // cache key (auto-tracks signals)
  () => api.getTasks(props.scopeId.value),         // fetcher
);

// Fully typed return — all fields are signals
tasks.data      // Signal<Task[] | undefined>  — the resolved data
tasks.loading   // Signal<boolean>             — true while fetching
tasks.error     // Signal<Error | null>        — the caught error, if any
tasks.refetch() // () => void                  — manual re-trigger

// Use in templates — implicit signal reads
const content = computed(() => {
  if (tasks.loading.value) return html`<skeleton-list></skeleton-list>`;
  if (tasks.error.value) return html`<div class="text-red-400">${tasks.error}</div>`;
  if (!tasks.data.value?.length) return html`<empty-state></empty-state>`;
  return html`${tasks.data.value.map(t => TaskItem({ key: t.id, task: signal(t), selected: isSelected }))}`;
});
```

**What `query()` handles that manual code forgets:**

| Concern | Manual pattern | `query()` |
|---|---|---|
| Loading state management | Developer must set/reset in try/catch/finally | Automatic |
| Error state management | Developer must reset before fetch, set in catch | Automatic |
| Re-fetch on dependency change | Developer must wire up effect manually | Automatic — signal reads in key function are tracked |
| Race conditions (stale responses) | Developer must track request IDs | Automatic — stale responses are discarded |
| Deduplication | Not handled — same request fires multiple times | Same cache key = single in-flight request |
| Cache | Not handled | Results cached by key, configurable staleness |

#### Cache Key Design

The first argument to `query()` is a **key function** that returns an array. This serves two purposes:

1. **Dependency tracking**: Any signals read inside the key function are automatically tracked. When they change, the query re-fetches.
2. **Cache identity**: Queries with the same key share cached results. If two components both call `query(() => ['tasks', scopeId.value], ...)` with the same `scopeId`, only one network request fires.

```typescript
// Key function reads scopeId — auto-refetches when scope changes
const tasks = query(
  () => ['tasks', props.scopeId.value],
  () => api.getTasks(props.scopeId.value),
);

// Key function reads filter AND scope — refetches when either changes
const filtered = query(
  () => ['tasks', props.scopeId.value, filter.value],
  () => api.getTasks(props.scopeId.value, filter.value),
);
```

This is the same key-based cache model as React Query / TanStack Query — proven at massive scale, immediately familiar to any developer (or LLM) who has used it.

#### `query()` Options

```typescript
const tasks = query(
  () => ['tasks', scopeId.value],
  () => api.getTasks(scopeId.value),
  {
    staleTime: 30_000,       // cache is fresh for 30s (default: 0 — always refetch)
    retry: 2,                // retry failed requests up to 2 times (default: 0)
    enabled: () => !!scopeId.value,  // skip fetch when scope is null
    initialData: [],         // synchronous initial value before first fetch
    onSuccess: (data) => {}, // callback after successful fetch
    onError: (err) => {},    // callback after failed fetch
  }
);
```

All options are optional. The zero-config default (`query(key, fetcher)`) handles 90% of use cases. Options exist for the 10% that needs caching, conditional fetching, or retry logic.

#### `QueryClient` — Global Cache via DI

The cache lives in a `QueryClient` service, injected via DI like everything else:

```typescript
class QueryClient {
  invalidate(keyPrefix: unknown[]): void;  // invalidate matching queries
  prefetch(key: unknown[], fetcher: () => Promise<unknown>): void;
  clear(): void;
}

// Invalidate all task queries after a mutation
const client = inject(QueryClient);
await api.updateTask(id, patch);
client.invalidate(['tasks']);  // all queries whose key starts with ['tasks'] refetch

// In tests — provide a mock or isolated client
provide(QueryClient, () => new QueryClient());
```

`QueryClient` is auto-singleton (like all DI services). Components don't import it directly unless they need cache manipulation. `query()` uses it internally via the setup context.

#### Full TaskList Example — Before and After

```typescript
// ✅ With query() — clean, declarative, no boilerplate
interface TaskListProps {
  scopeId: string | null;
}

const TaskList = component<TaskListProps>('task-list', (props) => {
  const nav = inject(NavigationEvents);
  const sse = inject(SSEEvents);

  const tasks = query(
    () => ['tasks', props.scopeId.value],
    () => inject(BacklogAPI).getTasks(props.scopeId.value),
  );

  // Surgical SSE updates — patch the cache, no refetch needed
  sse.on('taskChanged', ({ id, patch }) => {
    if (!tasks.data.value) return;
    tasks.data.value = tasks.data.value.map(t => t.id === id ? { ...t, ...patch } : t);
  });

  // Refetch when filter changes
  nav.on('filter', () => tasks.refetch());

  const content = computed(() => {
    if (tasks.loading.value) return html`<skeleton-list></skeleton-list>`;
    if (tasks.error.value) return html`<div class="text-red-400 p-4">${tasks.error}</div>`;
    if (!tasks.data.value?.length) return html`<empty-state></empty-state>`;
    return html`${tasks.data.value.map(t =>
      TaskItem({ key: t.id, task: signal(t), selected: isSelected })
    )}`;
  });

  return html`
    <div class="flex flex-col gap-1 p-2">
      <list-header count=${computed(() => tasks.data.value?.length ?? 0)}></list-header>
      ${content}
    </div>
  `;
});
```

**The pattern**:
- **`query()`** handles fetch, loading, error, cache, re-fetch — declaratively
- **Services** define the API calls (injected, never imported directly)
- **Emitters** trigger manual refetches or cache mutations (SSE events, filter changes)
- **`computed()`** selects the right template based on query state
- **Factory functions** compose child components with compile-time prop checking

### Typed Event Emitters — Replace `document.dispatchEvent`

Instead of spraying untyped `CustomEvent`s onto `document`, components communicate through **typed emitter services**. An emitter is just a service class that extends `Emitter<T>` — no separate "channel" concept, no `createChannel()`, same DI as everything else:

```typescript
// ---- Emitter definition (shared types file) ----
// It's just a class. The interface defines the event contract.

class NavigationEvents extends Emitter<{
  select: { id: string };
  filter: { filter: string; type: string };
  search: { query: string };
}> {}

// ---- Producer (task-item) ----
interface TaskItemProps { task: Task; }

const TaskItem = component<TaskItemProps>('task-item', (props) => {
  const nav = inject(NavigationEvents);  // auto-singleton, same as any service
  const onSelect = () => nav.emit('select', { id: props.task.value.id });
  // ...
});

// ---- Consumer (task-list) ----
const TaskList = component('task-list', () => {
  const nav = inject(NavigationEvents);  // same instance as producer

  // Subscribe — auto-disposed on disconnect
  nav.on('select', ({ id }) => setSelectedId(id));
  nav.on('filter', ({ filter, type }) => { /* ... */ });

  // Or: derive a signal directly from an event
  const selectedId = nav.toSignal('select', e => e.id, null);
  // ...
});
```

`Emitter<T>` is a tiny base class (~30 lines) in `framework/emitter.ts` that provides typed `emit()`, `on()`, and `toSignal()`. It's not a DI concept — it's just a class you extend when your service needs pub/sub.

**What typed emitters give us**:
- **Type safety**: `nav.emit('select', { id: 123 })` is a compile error — `id` must be `string`
- **Explicit contracts**: The class definition IS the documentation. You can see every event it carries.
- **Same DI as everything else**: `inject(NavigationEvents)` — no special `createChannel()` or `provide()` needed
- **No magic strings**: Event names are typed keys, not arbitrary strings on `document`
- **Auto-cleanup**: Subscriptions are tied to the component lifecycle via the setup context
- **Signal integration**: `toSignal()` bridges events directly into the reactive system

This replaces ALL of `main.ts`'s hand-written event routing. The 8 `document.addEventListener` calls become typed emitter subscriptions on auto-singleton services.

### Composability — Shared Logic as Plain Functions

Because everything is a plain function, you can extract and share reactive logic:

```typescript
// Shared composable — works in any component's setup()
function useSelection(nav: NavigationEvents, getId: () => string) {
  const selectedId = nav.toSignal('select', e => e.id, null);
  return computed(() => selectedId.value === getId());
}

// Used in TaskItem setup — reads from typed props, not host.dataset:
const selected = useSelection(nav, () => props.task.value.id);

// Used in TaskDetail setup:
const selected = useSelection(nav, () => currentTaskId.value);
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
4. A `class:name` binding does `element.classList.toggle(name, bool)` — one DOM operation
5. No diffing, no tree walking, no innerHTML

**List rendering** uses `.map()` with keyed reconciliation:
```typescript
html`
  <div class="task-list">
    ${tasks.map(t => html`
      <task-item key=${t.id} task=${t}></task-item>
    `)}
  </div>
`
```

`.map()` uses key-based reconciliation: adds new items, removes deleted items, reorders moved items — but never recreates items whose data merely changed. Existing items receive signal updates through their bindings.

### Dependency Injection (`injector.ts`) — Class-as-Token, Auto-Singleton

Two insights from Angular's evolution simplify DI dramatically:

1. **The class IS the token.** A class constructor is already a unique JavaScript object reference, already typed, already named. No `createToken()` needed.
2. **`provide()` is optional for services.** `inject(BacklogAPI)` auto-creates a singleton on first call — no one needs to "register" it first. `provide()` only exists for overriding (testing, custom construction).

```typescript
import { inject, provide } from './framework';

// ---- Services — just classes, nothing special ----
class BacklogAPI {
  async getTasks(filter: string): Promise<Task[]> { ... }
}

class SSEEvents extends Emitter<{
  taskChanged: { id: string; patch: Partial<Task> };
  taskCreated: { task: Task };
}> {}

class NavigationEvents extends Emitter<{
  select: { id: string };
  filter: { filter: string; type: string };
}> {}

// ---- Consumer — inject() just works, auto-singleton ----
const TaskList = component('task-list', () => {
  const api = inject(BacklogAPI);         // auto-created on first inject()
  const nav = inject(NavigationEvents);   // same instance everywhere
  const sse = inject(SSEEvents);          // typed, no ceremony
  // ...
});

// ---- Testing — provide() overrides the auto-singleton ----
const TestHarness = component('test-harness', () => {
  provide(BacklogAPI, () => new MockBacklogAPI());  // children get the mock
  // ...
});
```

`inject(Class)` checks if an instance exists (global singleton cache), creates one via `new Class()` if not, and returns it — fully typed. `provide(Class, factory)` overrides the singleton for the provider's subtree (testing, custom construction). Falls back to a module-level registry for backward compat with existing singletons during migration.

For the rare case of non-class dependencies (config objects, primitives), `createToken<T>(name)` exists as an escape hatch:

```typescript
// Rare: non-class dependency needs an explicit token
const AppConfig = createToken<{ apiUrl: string; debug: boolean }>('AppConfig');
provide(AppConfig, () => ({ apiUrl: '/api', debug: true }));
const config = inject(AppConfig);
```

But for the 99% case — service classes and emitters — the class IS the token, `inject()` auto-creates, and there's nothing to register. One concept, zero ceremony.

**Bootstrap services — eager instantiation**: Auto-singleton means a service doesn't exist until the first `inject()` call. Most services are fine with this — they're created when the first component that needs them mounts. But some services must exist *before* the component tree mounts: `SSEEvents` must connect to the backend and buffer events during page load, before any component calls `inject(SSEEvents)`. These **bootstrap services** are eagerly instantiated in the app entry point:

```typescript
// main.ts — bootstrap services created before any component mounts
const sse = inject(SSEEvents);    // eagerly create + connect
sse.connect();                     // starts receiving events immediately

// Components that mount later get the same singleton instance
// and receive events that arrived during page load via buffered replay
```

This mirrors the current `backlogEvents.connect()` pattern in `main.ts`. The rule: **lazy by default, eager for services that must not miss events during startup.** Document bootstrap services in `main.ts` with a comment block.

**Everything is a service.** API clients, storage adapters, SSE connections, typed event emitters — they're all just classes. Some extend `Emitter<T>` for pub/sub, some don't. The DI system doesn't care. `inject(AnyClass)` always works the same way.

### Data Flow Summary

Three data-in primitives, each returning signals:

| Primitive | Source | Type | Use case |
|---|---|---|---|
| `signal(initial)` | Component-local state | Read/write Signal | Internal state |
| `props.name` (via interface generic) | Parent component | Read-only Signal | Typed data from parent |
| `inject(Class)` | Auto-singleton DI | Service instance | Shared services, cross-component communication |

The mental model: **props** for data from parents (typed via interface), **signals** for local UI state, **inject** for shared services (including emitters for cross-component events). All props are signals. All three work in templates without `.value`.

### Migration Path

Components can be migrated one at a time:
1. Old `HTMLElement` components and new `component()` components coexist in the same DOM
2. `inject()` falls back to existing singleton imports when no ancestor provider is found
3. `html` tagged templates and `innerHTML` can coexist during the transition
4. No changes to the build system — esbuild handles everything as-is
5. The `host` parameter gives escape-hatch access to the raw element for edge cases

### Strengths
- Zero-overhead updates: signal → exact DOM node, no diffing
- **Pure functions everywhere** — no `this`, no class authoring, no inheritance
- **Typed props via interface** — `component<Props>()` with full TypeScript inference, no magic strings
- **Auto-resolved prop/attr passing** — framework knows what's a prop, no `.prop` syntax needed
- **Events colocated with elements** — `@click=${handler}` ON the element, not via detached selector
- **Typed emitters** replace `document.dispatchEvent(new CustomEvent(...))` pollution
- **`.map()` + `key`** for lists — universally known, no custom `repeat()` API
- **`class:name` directive** for conditional Tailwind classes — no ternary soup
- **Error boundaries** — one broken component doesn't crash the app
- **Computed views** for multi-branch rendering — just `if`/`else` returning templates
- **Composable** — extract shared logic into plain functions (like React hooks but no rules)
- **Implicit signals in templates** — `${title}` just works, `.value` only needed in JS logic
- Signals work standalone (in services, tests, modules) — not coupled to components
- Template is parsed once, cloned per instance, then only bindings execute
- True fine-grained reactivity — updating one task's status touches one `<span>`, not the whole list
- DI via pure `inject()` makes testing trivial without mocking module imports

### Weaknesses
- Tagged template engine + `@event` processing is the most complex piece (~250 lines) — needs careful implementation
- List reconciliation (keyed `.map()`) is inherently tricky
- Setup context pattern may confuse contributors unfamiliar with Angular/Solid/Vue 3
- `signal()` reads require `.value` in JS code (fundamental JS limitation — no way around this without a compiler)

---

## Proposal B: Proxy-Based Reactive Properties with Morphdom Patching

**Core idea**: Instead of signals, use ES Proxy to make plain object properties reactive. Instead of targeted binding, use `morphdom` (or a minimal clone of it) to diff real DOM → real DOM after a full template re-render. Simpler mental model, less framework code.

### Architecture

```
viewer/framework/
├── reactive.ts        # Proxy-based reactive state with dirty tracking
├── component.ts       # component() with reactive state
├── morph.ts           # Minimal DOM morph (real DOM → real DOM diff)
├── events.ts          # listen() — same pure function approach as Proposal A
├── injector.ts        # inject()/provide() — same as Proposal A
├── context.ts         # Same setup context as Proposal A
└── index.ts
```

### Reactive Properties (`reactive.ts`)

```typescript
import { component, reactive, inject } from './framework';

const TaskItem = component('task-item', (host) => {
  const state = reactive({
    title: '',
    status: 'open',
    selected: false,
    childCount: 0,
  });

  const nav = inject(NavigationEvents);
  const scope = inject(SidebarScopeService);

  nav.on('select', ({ id }) => { state.selected = id === host.dataset.id; });

  const onSelect = () => nav.emit('select', { id: host.dataset.id! });

  // Returns render function — plain HTML string, re-runs on any state change
  return () => `
    <div class="flex items-center gap-2 px-3 py-2 ${state.selected ? 'bg-white/10' : ''}"
         onclick="this.dispatchEvent(new Event('select', { bubbles: true }))">
      <task-badge task-id="${host.dataset.id}"></task-badge>
      <span class="flex-1 truncate text-sm">${state.title}</span>
      <span class="text-xs">${state.status.replace('_', ' ')}</span>
    </div>
  `;
});
```

`reactive()` wraps the object in a Proxy. Writes to `state.title = 'new'` schedule a batched re-render via microtask. The setup function returns a **render function** (not a template result) — a closure that produces an HTML string each time.

**Note**: Plain string templates cannot support `@click=${handler}` syntax — that requires tagged template parsing. Proposal B must use inline `onclick` attributes or re-query DOM elements for event binding after morph, which is the problem we're trying to solve.

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
import { component, signal, computed, inject } from './framework';

const TaskItem = component('task-item', (host) => {
  const title = signal('');
  const status = signal('open');
  const selected = signal(false);

  const nav = inject(NavigationEvents);
  const statusLabel = computed(() => status.value.replace('_', ' '));

  nav.on('select', ({ id }) => { selected.value = id === host.dataset.id; });

  // Returns a render function (plain string), signals must use .value explicitly
  return () => `
    <div class="flex items-center gap-2 px-3 py-2 ${selected.value ? 'bg-white/10' : ''}">
      <task-badge task-id="${host.dataset.id}"></task-badge>
      <span class="flex-1 truncate text-sm">${title.value}</span>
      <span class="text-xs">${statusLabel.value}</span>
    </div>
  `;
});
```

The returned render function is wrapped in an `effect()`. When any signal read inside it changes, the effect re-runs, producing a new HTML string. The morph algorithm applies the diff to the live DOM.

**Note**: Like Proposal B, plain strings cannot support `@click` syntax. And unlike Proposal A's tagged templates where signals are implicit (`${title}`), plain string templates require `.value` everywhere — `${title.value}`. Forgetting `.value` in a string template produces `[object Object]` in the rendered HTML — a visible but annoying bug.

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

## Adjacent Significant Improvements

Beyond the core framework, there are architectural improvements that become possible (or significantly easier) once the foundation is in place.

### 1. Granular SSE → Signal Bridge

**Current problem**: When a `task_changed` SSE event arrives, `task-list.ts` re-fetches ALL tasks from the API and re-renders the entire list. Every SSE event = full network round-trip + full DOM rebuild.

**With signals + typed emitters**: The SSE service extends `Emitter` and emits granular events. Individual task-item components subscribe to changes for their specific ID. When TASK-0042 changes, only the `<task-item>` for that task updates — no re-fetch, no list rebuild.

```typescript
// SSE service — just a class that extends Emitter
class SSEEvents extends Emitter<{
  taskChanged: { id: string; patch: Partial<Task> };
  taskCreated: { task: Task };
  taskDeleted: { id: string };
}> {
  // Connects to backend SSE endpoint and emits typed events
}

// Inside task-list setup — surgical updates via emitter
const sse = inject(SSEEvents);
sse.on('taskChanged', ({ id, patch }) => {
  tasks.value = tasks.value.map(t => t.id === id ? { ...t, ...patch } : t);
});
```

This transforms SSE from "nuke and rebuild" to "surgical patch." The task list only re-renders when tasks are added/removed — not when individual tasks change.

### 2. Derived Stores — Computed Over Collections

**Current problem**: Filtering, sorting, and scoping logic is imperative code in `task-list.ts:95-139`. It runs on every change, always against the full array.

**With signals**: The data pipeline becomes a chain of computed signals, each layer derived from the one before:

```typescript
const allTasks = signal<Task[]>([]);
const filter = signal('active');
const sortBy = signal('updated');
const scopeId = signal<string | null>(null);

const filtered = computed(() => filterTasks(allTasks.value, filter.value));
const sorted = computed(() => sortTasks(filtered.value, sortBy.value));
const scoped = computed(() => scopeTasks(sorted.value, scopeId.value, allTasks.value));
```

Each layer is lazy and cached. Changing `sortBy` only recomputes `sorted` and `scoped` — not `filtered`. Changing `filter` recomputes from `filtered` down. The framework batches all updates into one render pass.

### 3. Optimistic UI Updates

**Current problem**: After an MCP tool modifies a task, the flow is: backend saves → event bus emits → SSE pushes → client re-fetches → DOM rebuilds. This creates visible latency.

**With signals**: The SSE emitter can carry a `patch` object. The component applies the patch optimistically to its local signals immediately, before the full re-fetch completes. If the re-fetch returns different data, the signal updates again (self-correcting).

### 4. Component DevTools

**With signals and typed emitters**: Because all state flows through signals and all communication flows through emitter services, it becomes trivial to build a dev panel that shows:
- All active signals and their current values
- All emitter messages in real-time
- The dependency graph (which signal feeds which computed/effect)
- Component tree with injected services

This is impossible with the current architecture where state is scattered across private fields, localStorage, URL params, and untyped events.

---

## Template Alternatives Analysis

Since we're not building a compiler, the template question is: what's the best way to describe DOM structure in plain TypeScript?

### Option 1: Tagged Template Literals (`html\`...\``) — Recommended

```typescript
return html`
  <div class="flex items-center gap-2 px-3 py-2">
    <span class="flex-1 truncate">${title}</span>
    <span class="text-xs">${statusLabel}</span>
    ${when(isContainer, html`<span class="text-gray-400">${childCount}</span>`)}
  </div>
`;
```

**How it works**: The `html` tag receives the static string parts and dynamic values separately. Static HTML is parsed once into a `<template>` element and cached. Dynamic "holes" become `Binding` objects. Signals are detected automatically (via `[signalBrand]` symbol) and subscribed — no explicit `.value` or `()` in templates.

**Why this wins**:
- Looks like normal HTML — both humans and LLMs write it naturally
- Framework gets access to raw signal objects *before* string coercion
- Static structure parsed once, cloned per instance, only bindings update
- `@event` syntax for inline event binding: `<button @click=${handler}>` (like Lit)
- Proven at scale (Lit, uhtml, hundreds of production apps)
- Zero build step — esbuild passes tagged templates through untouched

### Option 2: JSX — Not Possible Without a Compiler

```typescript
return <div className="flex items-center"><span>{title}</span></div>
```

JSX is syntactic sugar that *must* be compiled to `createElement()` calls. TypeScript's JSX transform could do it, but that means every component file needs `.tsx` extension and a JSX factory configured — which is a compiler step we explicitly want to avoid. Also, JSX factory functions produce virtual DOM nodes that need reconciliation, pulling us toward a VDOM architecture.

**Verdict**: Ruled out by our no-compiler constraint.

### Option 3: htm (Hyperscript Tagged Templates)

```typescript
const html = htm.bind(h);
return html`<div class="flex"><span>${title}</span></div>`;
```

htm by the Preact team makes tagged templates look like JSX. It works standalone without Preact. However, it translates templates into `h(tag, props, children)` hyperscript calls, producing a virtual node tree. We'd then need our own render/reconcile layer to turn those vnodes into DOM. This re-invents the VDOM problem.

**Verdict**: Adds a dependency and a VDOM-like indirection layer. Our tagged template can do the same job directly against the real DOM.

### Option 4: Plain Template Strings

```typescript
return () => `<div class="flex"><span>${title.value}</span></div>`;
```

What we have today. By the time the framework sees this, it's a flat string with values baked in — the framework can't know which parts changed. Requires full re-parse and morph/diff on every update. Also requires explicit `.value` reads (LLMs will forget).

**Verdict**: Used in Proposals B and C. Works but has O(n) performance ceiling.

### Option 5: Hyperscript / `createElement()` Calls

```typescript
return h('div', { class: 'flex' }, h('span', {}, title));
```

Maximum control, but unreadable for anything beyond trivial templates. No human or LLM wants to write nested function calls for UI. This is what JSX compiles *down to* — it exists so people don't have to write it.

**Verdict**: Poor human-AI coherence. Ruled out.

### Conclusion

Tagged template literals with implicit signal reads are the **best option in the no-compiler design space**. The authoring experience is:

```typescript
// What you write — almost identical to JSX + Tailwind
return html`
  <div class="flex items-center gap-2 p-3 rounded hover:bg-white/5"
       class:bg-blue-500/20=${selected}
       @click=${onSelect}>
    <task-badge task-id="${id}"></task-badge>
    <span class="flex-1 truncate text-sm">${title}</span>
    ${when(hasChildren,
      html`<span class="text-xs text-gray-400"
                 @click.stop=${onDrillIn}>${childCount}</span>`
    )}
  </div>
`;
```

This is as close to "just write HTML with expressions and events" as you can get without a compiler. Structure, styling, data, and interaction — all in one place. An LLM produces this naturally.

---

## CSS Strategy: Tailwind CSS

### Why Tailwind

The current codebase has a 600+ line `styles.css` file with hand-written, project-specific class names. This creates several problems for human-AI collaborative development:

1. **Context split**: To understand a component, you must read both the TS file and search through `styles.css` for its classes
2. **Naming burden**: Every new element needs a unique class name invented on the spot
3. **AI blind spot**: An LLM generating a component can't see what it looks like from the component source alone — the styles are elsewhere
4. **Dead CSS**: Removing a component doesn't remove its styles. Over time, `styles.css` accumulates orphaned rules

Tailwind solves all of these by making styles **colocated** and **declarative**:

```typescript
// Before: component.ts + styles.css (two files, context-switching)
this.innerHTML = `<div class="task-item selected">...`;
// .task-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
// .task-item.selected { background: rgba(255,255,255,0.1); border-left: 2px solid #60a5fa; }

// After: just component.ts (one file, complete picture)
return html`
  <div class="flex items-center gap-2 px-3 py-2"
       class:bg-white/10=${selected}
       class:border-l-2=${selected}
       class:border-blue-400=${selected}>
`;
```

### Why LLMs Excel with Tailwind

Tailwind is likely the single highest-signal styling system in LLM training data:
- Utility classes are **self-documenting** — `flex items-center gap-2` reads like a description
- **No project-specific knowledge** needed — Tailwind classes are universal across all codebases
- An LLM can produce a pixel-accurate component in one shot because styles and structure are one thing
- No context-switching to a CSS file means fewer hallucinated class names

### Tailwind v4 + esbuild Setup

Tailwind v4 works with esbuild via `esbuild-plugin-tailwindcss`. The setup is minimal:
- Add `@import "tailwindcss"` to a CSS entry file
- Add the esbuild plugin
- No `tailwind.config.js` needed — v4 uses CSS-first configuration

Build performance: v4's Oxide engine is 3.5-10x faster than v3, incremental builds in microseconds. Output CSS is typically <10KB after minification.

### Shadow DOM Compatibility

**Not an issue for this project.** All current components use **light DOM** (`this.innerHTML`), not shadow DOM. Tailwind's global CSS applies directly. If we ever need shadow DOM isolation for specific components, we can use the `@layer` approach or simply keep those components in light DOM.

### Migration Path

1. Add `tailwindcss` and `esbuild-plugin-tailwindcss` as dev dependencies
2. Add `@import "tailwindcss"` to a new `viewer/app.css`
3. New components use Tailwind classes in their `html` templates
4. Gradually replace custom classes in `styles.css` as components are migrated
5. `styles.css` shrinks to near-zero as migration completes

---

## Why Not Lit?

The most obvious question: why build a custom framework when Lit exists? Lit (~5KB) uses the same core approach — tagged `html` templates with targeted DOM binding, `@event` syntax, reactive properties, no virtual DOM. It's maintained by Google and battle-tested across YouTube, Chrome DevTools, and thousands of production apps.

We evaluated Lit seriously. Proposal A's design is directly informed by studying Lit's architecture. Here's why we build the parts we need rather than adopt Lit wholesale:

### 1. Shadow DOM Default Fights Tailwind

Lit defaults to Shadow DOM. To use light DOM, every component must override `createRenderRoot() { return this; }`. This project uses light DOM exclusively — all 16 components use `this.innerHTML`. Shadow DOM creates a styling boundary that blocks Tailwind utility classes from reaching component internals. Opting into light DOM also disables Lit's `static styles` CSS mechanism, losing one of Lit's features just to get the DOM model we already have.

### 2. Four Binding Prefixes (The Sigil Tax)

Lit requires developers to choose the correct prefix for every binding: `attr=${val}` (attribute), `.prop=${val}` (property), `?hidden=${bool}` (boolean attribute), `@click=${fn}` (event). Get it wrong and you get silent bugs — `<my-el data=${complexObject}>` serializes to `[object Object]` (should use `.data`), `<div hidden=${false}>` sets `hidden=""` which is still truthy (should use `?hidden`). Proposal A eliminates this with auto-resolution: the framework detects registered props and uses JS properties automatically. One syntax, framework figures it out.

### 3. Class Ceremony and Lifecycle Complexity

Lit requires class-based components with `this` everywhere. Its reactive update cycle has 7+ hooks: `constructor`, `connectedCallback`, `shouldUpdate`, `willUpdate`, `update`, `render`, `updated`, `firstUpdated` — plus `scheduleUpdate`, `performUpdate`, `getUpdateComplete`, `requestUpdate`. Derived state requires manual `changedProperties.has()` checking. Proposal A replaces all of this with a single setup function and `computed()` for derived state.

### 4. No Native Signals

Lit's reactivity is property-based: `@property()` and `@state()` decorators on class fields, scoped to the component. Properties can't be shared across components or used in standalone services. Lit's signals support (`@lit-labs/signals`) is explicitly experimental ("not recommended for production use"), requires a `SignalWatcher` mixin, a separate `watch()` directive, and depends on an unstable TC39 polyfill. Proposal A has signals as the core primitive — templates detect them implicitly, no mixin or directive needed.

### 5. No Dependency Injection

Lit has no DI. Lit Context (based on the community protocol) requires explicit `createContext()` tokens, `@provide`/`@consume` decorators, and DOM-tree-based scoping. For a service like `BacklogAPI` that every component needs, that's 6+ lines of ceremony per consumer. Proposal A: `inject(BacklogAPI)` — one line, auto-singleton, class IS the token.

### 6. Separate `repeat()` API for Keyed Lists

Lit's `.map()` doesn't do keyed reconciliation. For keyed lists, you need `repeat()` from `lit/directives/repeat.js` with a different API shape. Proposal A uses `.map()` + `key` attribute — the universally known pattern.

### The Honest Trade-off

Lit's template engine is battle-tested across years of edge-case fixes. Our `template.ts` will encounter bugs Lit already solved. But the scope is fundamentally different: Lit handles Shadow DOM, SSR, streaming, async rendering, and edge cases for millions of users across thousands of apps. We have 16 components with known use cases. The complexity budget is not comparable. And adopting Lit would mean building signals + DI + typed emitters on top of it anyway — the novel parts of this framework aren't in the template engine.

**The constraint "no external UI framework dependencies" exists because**: a UI framework dependency means every component inherits that framework's opinions, lifecycle model, and upgrade cadence. The project's 14 runtime dependencies (fastify, orama, marked, etc.) are backend/content-processing — none affect the viewer's component architecture. Adding a UI framework is a categorically different kind of dependency.

---

## Comparison Matrix

| Criterion | A: Signals + Targeted Binding | B: Proxy + Morphdom | C: Signals + Morphdom |
|---|---|---|---|
| **Update granularity** | Signal → exact DOM node | Full subtree morph | Full subtree morph |
| **Performance at scale** | O(1) per signal change | O(n) tree walk per change | O(n) tree walk per change |
| **SSE update cost** | Update 1 task = patch 1 row | Update 1 task = morph entire list | Update 1 task = morph entire list |
| **Template style** | Tagged `html` + implicit signals | Plain string + explicit reads | Plain string + explicit `signal()` calls |
| **AI coherence** | High — `${title}` just works in templates | Medium — `${state.title}` | Medium — `${title.value}` or `[object Object]` |
| **Props** | Typed via interface generic + factory composition (compile-time checked) | Untyped / manual | Untyped / manual |
| **Consumer type safety** | Compile-time — missing/wrong props caught by TypeScript | None — silent runtime undefined | None — silent runtime undefined |
| **Data loading** | `query()` — declarative, cached, auto-refetch | Manual boilerplate | Manual boilerplate |
| **Framework code size** | ~680 lines (~3.5KB min) | ~400 lines (~2KB min) | ~500 lines (~2.5KB min) |
| **Implementation risk** | Higher (binding engine, keyed lists) | Lower (morph is well-understood) | Medium |
| **Migration effort** | Medium (new template syntax) | Low (templates stay as strings) | Medium (add signals, keep strings) |
| **Ceiling for optimization** | Very high (surgical updates) | Limited (always walks tree) | Limited (always walks tree) |
| **State management** | Signals (computed, effect, batch) | Proxy (simple get/set) | Signals (computed, effect, batch) |
| **Composability** | High — extract to shared functions | Medium — reactive() is component-tied | High — signals are standalone |
| **Testability** | High (signals are pure, inject mocks) | Medium (need DOM for proxy) | High (signals are pure, inject mocks) |
| **Component authoring** | `component()` + pure functions | `component()` + pure functions | `component()` + pure functions |
| **Inter-component events** | Typed emitters via DI | Typed emitters via DI | Typed emitters via DI |
| **DOM event binding** | Inline `@click` in template | `onclick` attr or post-morph query | `onclick` attr or post-morph query |
| **Event colocation** | Events on element (visible in template) | Detached from template | Detached from template |
| **CSS strategy** | Tailwind (all proposals) | Tailwind (all proposals) | Tailwind (all proposals) |

---

## Scored Rubric (1-5, higher is better)

| Anchor | A: Signals + Binding | B: Proxy + Morph | C: Signals + Morph | Justification |
|---|---|---|---|---|
| **Time-to-ship** | 3 | 4 | 3 | A has the most complex single piece (template.ts). B is the smallest conceptual leap. C is between. |
| **Risk** | 3 | 4 | 3 | A's binding engine and keyed reconciliation are the highest-risk pieces. B's morph is well-understood. Mitigated by scoping list reconciliation to insert/remove for v1. |
| **Testability** | 5 | 3 | 4 | A's signals are pure and standalone — testable without DOM. DI enables mock injection. B's proxy requires a DOM context. C's signals are testable but morph isn't. |
| **Future flexibility** | 5 | 2 | 3 | A's O(1) update model has no performance ceiling. B's O(n) morph is a permanent constraint. C gets signal composability but morph limits DOM performance. |
| **Operational complexity** | 4 | 5 | 4 | A has ~680 lines of framework code to maintain. B has ~400 lines. C has ~500 lines. All are small enough for one developer to own. |
| **Blast radius** | 4 | 4 | 4 | All three support incremental migration — old and new components coexist. No big-bang rewrite. |
| **Weighted total** | **24** | **22** | **21** | A wins on testability and future flexibility — the dimensions that compound over time. B wins on time-to-ship and operational simplicity — dimensions that matter once. |

**Note on weighting**: For a project that will be maintained long-term with AI-assisted development, testability and future flexibility carry more weight than initial time-to-ship. A framework that's harder to build but produces better components forever is preferable to one that's easier to build but imposes permanent performance and ergonomic constraints.

---

## Assumptions (For This Decision to Be Correct)

For Proposal A to be the right choice, the following must be true:

1. **The template binding engine can be implemented correctly in ~270 lines without critical bugs.** Specifically: text bindings, attribute bindings, `@event` bindings, `class:name` directives, nested template composition, `when()` conditional rendering, and keyed list insert/remove (without move detection in v1). If this proves significantly harder than estimated, the fallback is Proposal C (signals + morph) which preserves all primitives except fine-grained DOM patching.

2. **The maintenance burden of ~680 lines of owned framework code is lower than tracking Lit's upgrade cadence and working around its defaults.** Lit releases 2-3 minor versions per year. Each version may change behavior in the template engine, reactive properties, or lifecycle hooks. Our framework code changes only when we decide to change it.

3. **The project will continue to grow and the 16 components represent a minimum, not a maximum.** If the project stayed frozen at 16 components, the framework investment would be marginal. The value compounds as components are added, because each new component gets signals, DI, typed props, and fine-grained rendering for free.

4. **Keyed list reconciliation with insert/remove (no move detection) is sufficient for the task list's actual operations (filter, sort, scope, SSE update).** The task list is <100 items. If profiling reveals move detection matters, it can be added later without changing the component API.

5. **AI-assisted development continues to be the primary authoring mode.** The design choices around compile-time safety (`.value`, typed factory props, `Signal<T>` requirements) are optimized for catching AI-generated mistakes at compile time rather than code review. If AI stops being the primary author, these choices are still good engineering but the "Human-AI Coherence" framing becomes less relevant.

---

## Recommendation: Proposal A — Pure Functions with Signals and Targeted DOM Patching

### Rationale

1. **The core problem is needless re-rendering**. The primary complaint — "new data arrives from the backend and it causes to re-render the entire freakin DOM tree" — is a granularity problem. Proposals B and C improve on `innerHTML` but still walk the full subtree. Only Proposal A achieves O(1) updates: one signal change → one DOM mutation.

2. **Implicit signals in templates maximize human-AI coherence**. In Proposal A's tagged templates, `${title}` just works — the tag function detects the signal and subscribes automatically. In JS code, `.value` is enforced by TypeScript — forgetting it is a compile error, not a silent runtime bug. In Proposal B, `${state.title}` works but proxies have edge cases with destructuring. In Proposal C, plain strings require `${title.value}` everywhere — forgetting it renders `[object Object]`. Only Proposal A gives you implicit reads where it matters most (templates) AND type safety where it matters most (JS logic).

3. **Typed props via interface eliminate an entire class of bugs**. `component<TaskItemProps>('task-item', (props) => ...)` gives full TypeScript inference on the `props` object. The returned factory function gives consumers compile-time checking on every prop. Missing props, misspelled props, and wrong types are all compile-time errors — not silent runtime `undefined`.

4. **Pure functions are the right default**. `signal()`, `inject()`, `listen()` don't need a class. Making them standalone functions means they compose naturally — extract shared logic into a `useSelection()` or `useSSE()` function, call it from any component's `setup()`. No mixins, no multiple inheritance, no decorator magic. This is the same insight that drove React hooks, Vue 3 Composition API, and Angular's functional `inject()`.

5. **Tailwind + tagged templates = complete components in one function**. An LLM (or human) can produce a fully styled, reactive component without leaving the setup function. No separate CSS file, no invented class names, no context-switching. The component source is the single source of truth for behavior, state, and appearance.

6. **The complexity is front-loaded, not ongoing**. The binding engine in `template.ts` is ~200 lines of code written once. After that, every component author gets fine-grained reactivity for free by writing natural-looking tagged templates. Morphdom is simpler to implement but imposes O(n) cost on every component, forever.

7. **Signals are the industry direction**. TC39 has a signals proposal. Angular, Solid, Preact, Qwik, and Vue all converge on this model. Building on signals means the mental model will be familiar to anyone who has touched modern frontend in the last two years.

8. **The DI system pays for itself immediately**. Replacing 15 hard-coded singleton imports with `inject(Class)` — auto-singleton, zero registration — makes every component testable in isolation. `provide()` overrides for testing, but the common path needs nothing.

9. **Incremental adoption eliminates migration risk**. Old `HTMLElement` components keep working. New `component()` components coexist in the same DOM tree. There is no "big bang" rewrite.

### Implementation Order

| Phase | What | Unblocks |
|---|---|---|
| 1 | `signal.ts` — `signal()`, `computed()`, `effect()` with batching | Everything |
| 2 | `context.ts` — `runWithContext()`, `getCurrentComponent()` | Pure function DI |
| 3 | `emitter.ts` — `Emitter<T>` base class, typed emit/on/toSignal | Replace CustomEvent pollution |
| 4 | `injector.ts` — `inject()`, `provide()`, class-as-token, auto-singleton | Testability, decoupling |
| 5 | `component.ts` — `component()` shell + lifecycle + typed props + typed factory + error boundaries | Component authoring + type-safe composition |
| 6 | `template.ts` — Tagged `html` with binding engine + `@event` + `class:name` + `.map()`/`key` | Fine-grained rendering |
| 7 | `query.ts` — `query()` + `QueryClient` for declarative async data loading | Eliminate data loading boilerplate |
| 8 | Migrate `task-item` as proof-of-concept (smallest leaf, factory composition) | Validate the approach |
| 9 | Migrate `task-list` with `.map()` + `key` + `query()` (biggest pain point) | Prove list perf + data loading |
| 10 | Add Tailwind v4 to build pipeline | Colocated styling |

### File Structure

```
viewer/framework/
├── signal.ts          # ~120 lines — signal(), computed(), effect(), batch
├── query.ts           # ~50 lines  — query(), QueryClient, cache-key dedup, auto-refetch
├── context.ts         # ~20 lines  — runWithContext(), getCurrentComponent()
├── component.ts       # ~120 lines — component(), lifecycle wiring, typed props, typed factory, error boundaries
├── template.ts        # ~270 lines — html tagged template, Binding, @event, class:name, .map()/key
├── emitter.ts         # ~30 lines  — Emitter<T> base class, typed emit/on/toSignal
├── injector.ts        # ~60 lines  — inject(), provide(), class-as-token, auto-singleton
└── index.ts           # ~10 lines  — Re-exports
```

Total: ~680 lines of framework code, 0 external dependencies, 0 build plugins.

## Consequences

### Positive
- SSE updates patch individual task rows instead of rebuilding the entire list
- **No `this` in component authoring** — pure functions all the way down
- **Typed factory composition** — `component<Props>()` returns a factory that gives compile-time errors for missing, misspelled, or wrongly-typed props
- **Signal-typed props** — factory requires `Signal<T>`, making lost reactivity a compile error instead of a stale-data bug
- **Two-layer rendering model** — factory at component boundaries (type-safe), `html` templates inside (readable)
- **Props-first signature** — `(props, host)` signals that props are the primary interface; `host` is the escape hatch
- **Implicit signal reads in templates** — `${title}` just works, `.value` only in JS logic
- **Events colocated with elements** — `@click=${handler}` on the element, not detached via selectors
- **Typed emitters replace global event pollution** — no more `document.dispatchEvent(new CustomEvent(...))`
- **`query()` primitive** — declarative async data loading eliminates 15-line boilerplate per component, handles loading/error/cache/refetch
- **`.map()` + `key` for lists** — universally known pattern, no custom API to learn
- **`class:name` directive** — clean conditional Tailwind classes without ternary expressions
- **Computed views for multi-branch rendering** — `if`/`else` in JS, single `${content}` in template
- **Error boundaries** — broken components render fallbacks instead of crashing the app
- **Children/slots as typed props** — named slots are compile-time checked, unlike HTML `<slot name="...">` which fails silently
- **Self-contained components** — Tailwind + tagged templates + inline events = complete component in one function
- **Composable** — shared reactive logic extracted as plain functions, reusable across components
- **Refactoring works** — renaming a prop updates all factory call sites via Find All References; HTML attribute strings require regex
- Signals work anywhere (services, tests, standalone modules) — not coupled to components
- State is explicit (signals) instead of implicit (scattered private fields)
- Components become testable via `inject()` (provide mock services)
- `main.ts` shrinks from 70-line event router to just `backlogEvents.connect()` + imports
- New components are ~40% less code than current equivalents
- Framework code lives in one folder, clearly separated from application code
- No new build tooling beyond Tailwind esbuild plugin — tagged templates work natively
- **High AI coherence** — an LLM can produce correct, styled, reactive components naturally
- **Hard to write wrong** — the primary authoring paths (factory, query, inject) all produce compile-time errors for common mistakes

### Negative
- Contributors must learn signals, tagged template bindings, emitters, query, and the setup context pattern
- The template binding engine + `@event` processing + factory binding is the most complex piece and must be robust
- Debugging reactive chains requires understanding the push-pull propagation model (Phase 2: dev tooling — see below)
- Two component styles coexist during migration (raw HTMLElement and component())
- `signal()` reads require `.value` in JS code — fundamental JS limitation, no way around without a compiler
- Static props in factories need `signal(value)` wrapping — small ergonomic cost for reactivity safety
- Tailwind adds a dev dependency and esbuild plugin (though zero runtime cost)

### Risks
- Tagged template performance: parsing + cloning must be fast. Mitigated by caching parsed templates per component class.
- Memory: each binding holds a DOM node reference. Mitigated by cleanup in `disconnectedCallback`.
- Emitter over-use: simple parent→child communication shouldn't need an emitter. Mitigated by using typed props for direct parent-child, emitters only for cross-tree communication.
- Edge cases in keyed `.map()` reconciliation (reordering, nested lists). Mitigated by starting with simple append/remove and upgrading to full keyed reconciliation.
- `query()` cache staleness: stale data served when it shouldn't be. Mitigated by default `staleTime: 0` (always refetch) and explicit `invalidate()` after mutations.
- Tailwind class verbosity in complex components. Mitigated by extracting common patterns into composable functions that return class strings.
- Bootstrap service timing: emitters created via lazy `inject()` may miss events dispatched during page load. Mitigated by eagerly instantiating bootstrap services in `main.ts` before the component tree mounts (documented pattern above).
- Runtime errors in effects and event handlers could crash or leave components in inconsistent state. Mitigated by wrapping effect executions and `@event` handlers in try/catch with error boundary fallback rendering (documented in Error Boundaries above).

### Phase 2: Developer Tooling (Post-Framework)

The signal-based architecture enables tooling that's impossible with the current scattered-state approach. These are not blockers for the initial framework, but should follow shortly after:

- **`debugSignal(name, signal)`** — logs reads and writes with stack traces; useful for tracing why a computed isn't updating
- **Signal graph visualization** — dev mode that dumps the dependency graph (which signal feeds which computed/effect)
- **Stale effect warnings** — dev mode that warns when an effect never re-runs (likely a missing signal read)
- **Query devtools** — show all active queries, their cache state, and loading timelines (similar to React Query devtools)

These are small utilities (~20-50 lines each) that can be tree-shaken in production builds.
