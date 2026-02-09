# Backlog UI Framework — Complete Agent Guide

This document contains every rule for writing, reviewing, and migrating components using the reactive web component framework in `viewer/framework/`. Each rule includes the invariant, the bug it prevents, and correct/incorrect code examples.

**Framework source**: `viewer/framework/` (signal.ts, context.ts, emitter.ts, injector.ts, component.ts, template.ts, query.ts, index.ts)
**ADR documentation**: `docs/framework-adr/`
**Migrated component reference**: `viewer/components/task-filter-bar.ts`

---

## 1. Component Authoring (CRITICAL)

### `comp-setup-sync` — Setup function MUST be synchronous

The setup function runs inside `runWithContext()` which sets a module-level `currentComponent` variable. After the function returns, the context is gone. Any async code (await, .then, setTimeout) runs AFTER context is cleared.

```typescript
// ❌ WRONG — inject() will throw "called outside setup"
component('my-el', async (props) => {
  await someInit();
  const api = inject(BacklogAPI); // THROWS
});

// ✅ CORRECT — capture everything synchronously, use async later
component('my-el', (props) => {
  const api = inject(BacklogAPI); // works — sync in setup
  effect(() => {
    api.fetchData(props.id.value); // api captured in closure, safe
  });
  return html`...`;
});
```

### `comp-props-signals` — All props are `Signal<T>`; factory requires signals

Props are declared as a TypeScript interface. The framework wraps each prop in a `Signal`. Factory callers MUST pass `Signal<T>`, not plain `T`, because setup runs once — passing `.value` loses reactivity forever.

```typescript
interface TaskItemProps {
  task: Task;
  selected: boolean;
}

// ❌ WRONG — passing .value loses reactivity
TaskItem({ task: currentTask.value, selected: true })
//         ^ Error: Task is not assignable to Signal<Task>

// ✅ CORRECT — pass signals, child stays reactive
TaskItem({ task: currentTask, selected: isSelected })

// ✅ CORRECT — for truly static props, wrap in signal()
TaskItem({ task: signal(staticTask), selected: signal(false) })
```

Inside the component, props are accessed as signals:

```typescript
component<TaskItemProps>('task-item', (props) => {
  // props.task → Signal<Task>
  // props.selected → Signal<boolean>
  const title = computed(() => props.task.value.title);
  return html`<span>${title}</span>`;
});
```

### `comp-factory-composition` — Use factory for framework-to-framework boundaries

`component()` returns a typed factory function. Use it for composing framework components — TypeScript checks every prop at compile time.

```typescript
const TaskItem = component<TaskItemProps>('task-item', (props) => { ... });

// ✅ Factory — type-safe, compile-time checked
html`<div>${tasks.map(t => TaskItem({ task: sig, selected: sel }))}</div>`

// Missing prop → compile error
// Wrong type → compile error
// Typo → compile error
```

### `comp-html-for-vanilla` — Use `html` tag syntax for vanilla elements and interop

HTML tag syntax is for vanilla elements and migration interop. Auto-resolution routes through `_setProp()` for framework elements and `setAttribute()` for vanilla elements.

```typescript
// ✅ Vanilla elements — setAttribute is correct
html`<svg-icon src="${icon}" size="16"></svg-icon>`

// ✅ Interop with unmigrated parent — auto-resolution handles it
html`<task-item task="${taskSignal}"></task-item>`
```

### `comp-no-this` — No `this` in components

Components are pure functions. All state is via signals, services via `inject()`, DOM via `host` parameter.

```typescript
// ❌ WRONG
class MyComponent extends HTMLElement {
  this.count = 0;
}

// ✅ CORRECT
component('my-el', (props, host) => {
  const count = signal(0);
  return html`<span>${count}</span>`;
});
```

### `comp-no-innerhtml` — Never use innerHTML in framework components

The framework does targeted DOM patching via signal bindings. `innerHTML` destroys the entire subtree, losing all state, focus, scroll position, and event listeners.

```typescript
// ❌ WRONG — destroys everything
host.innerHTML = `<div>${data}</div>`;

// ✅ CORRECT — targeted updates via signals
const content = signal(data);
return html`<div>${content}</div>`;
```

### `comp-host-escape-hatch` — Use host only for imperative DOM access

The `host` parameter is the raw `HTMLElement`. Use it only when you need imperative DOM APIs: `focus()`, `scrollIntoView()`, `getBoundingClientRect()`, third-party library init.

```typescript
component('my-el', (_props, host) => {
  // ✅ Legitimate use — imperative DOM API
  host.classList.add('loaded');

  // ❌ WRONG — use signals and templates instead
  host.innerHTML = '<div>content</div>';
});
```

### `comp-no-class-authoring` — Never extend HTMLElement for new components

All new components MUST use `component()`. The only exceptions are simple attribute-driven leaf components (svg-icon, task-badge) that have no internal state.

---

## 2. Signals & Reactivity (CRITICAL)

### `signal-value-read` — Use `.value` in JS, implicit in templates

Signal reads require `.value` in JavaScript code (TypeScript enforces this). In `html` templates, signals are implicit — the template engine detects them and subscribes automatically.

```typescript
const count = signal(0);
const doubled = computed(() => count.value * 2); // .value in JS

// In templates — implicit, no .value
html`<span>${count}</span><span>${doubled}</span>`
```

### `signal-immutable-writes` — Assign new references for object signals

Signals use `Object.is()` for equality. Mutating an object's property doesn't change the reference, so no update fires.

```typescript
const data = signal({ x: 1 });

// ❌ WRONG — same reference, Object.is returns true, NO update
data.value.x = 2;

// ✅ CORRECT — new reference triggers update
data.value = { ...data.value, x: 2 };
```

### `signal-computed-derived` — Use computed() for derived state

Never manually synchronize derived state in effects. `computed()` is lazy, cached, and auto-tracks dependencies.

```typescript
// ❌ WRONG — manual sync, error-prone, extra signal
const doubled = signal(0);
effect(() => { doubled.value = count.value * 2; });

// ✅ CORRECT — derived, lazy, cached
const doubled = computed(() => count.value * 2);
```

### `signal-effect-side-effects` — Effects are for side effects only

Effects should perform external operations (DOM manipulation, localStorage writes, network calls). Don't use effects to compute derived state — use `computed()` for that.

```typescript
// ✅ CORRECT — effect for side effect
effect(() => {
  localStorage.setItem('sort', currentSort.value);
});

// ✅ CORRECT — effect for DOM imperative work
effect(() => {
  const select = host.querySelector('select') as HTMLSelectElement | null;
  if (select) select.value = currentSort.value;
});
```

### `signal-batch-writes` — Batch multiple synchronous writes

Multiple synchronous `.value` writes coalesce into one update pass. Use `batch()` explicitly when updating multiple signals in an event handler.

```typescript
import { batch } from './framework';

// ✅ Batched — one update pass, not three
batch(() => {
  filter.value = 'active';
  sort.value = 'updated';
  page.value = 1;
});
```

Without `batch()`, each write schedules effects independently. Nested `batch()` calls are safe — flush only happens at the outermost level.

### `signal-no-async-in-setup-context` — Reactive primitives are synchronous

`inject()`, `effect()`, and `emitter.on()` rely on the setup context. They MUST be called synchronously during setup — never inside `await`, `.then()`, `setTimeout`, or any async boundary.

```typescript
// ❌ WRONG — context is gone after await
component('my-el', async (props) => {
  await delay(100);
  const api = inject(BacklogAPI); // THROWS
  effect(() => { ... }); // THROWS
});

// ✅ CORRECT — all registration is synchronous
component('my-el', (props) => {
  const api = inject(BacklogAPI);
  effect(() => { /* use api here */ });
  return html`...`;
});
```

### `signal-conditional-deps` — Dependencies are re-tracked every run

Before a computed or effect re-evaluates, ALL previous subscriptions are removed. Dependencies are discovered fresh on each run. This makes conditional dependencies correct:

```typescript
// This tracks `a` OR `b` depending on `flag`, and switches correctly
const result = computed(() => flag.value ? a.value : b.value);

// When flag changes from true → false:
// - a is unsubscribed, b is subscribed
// - Changes to a no longer trigger recomputation
```

### `signal-equality-object-is` — Signal equality uses Object.is()

Signal writes and computed value comparisons use `Object.is()`, not `===`. This correctly handles `NaN === NaN` (Object.is returns true, preventing infinite loops). Changing to `===` would cause `signal(NaN)` to notify on every write.

---

## 3. Template Engine (HIGH)

### `tmpl-implicit-signals` — Write `${signal}` not `${signal.value}` in templates

The `html` tagged template receives raw values in `${}` slots. It detects signals via `SIGNAL_BRAND`, reads `.value` for initial render, and subscribes for updates.

```typescript
const count = signal(0);
const label = computed(() => `Count: ${count.value}`);

// ❌ WRONG — reads value once, loses reactivity
html`<span>${count.value}</span>`

// ✅ CORRECT — template engine handles subscription
html`<span>${count}</span>`
html`<span>${label}</span>`
```

### `tmpl-event-colocated` — Use @event on the element

Events are part of the template, colocated with elements. No detached listeners, no selector coupling.

```typescript
// ❌ WRONG — selector coupling, breaks if class changes
host.querySelector('.save-btn')?.addEventListener('click', onSave);

// ✅ CORRECT — event on the element
html`<button @click=${onSave}>Save</button>`
```

Event handlers are wrapped in try/catch — a throwing handler logs the error but doesn't crash the component.

### `tmpl-event-modifiers` — Use built-in event modifiers

The template engine supports modifiers on `@event` bindings:

```typescript
html`
  <button @click.stop=${handler}>Click</button>         <!-- stopPropagation -->
  <form @submit.prevent=${onSubmit}>...</form>           <!-- preventDefault -->
  <button @click.once=${handler}>One time</button>       <!-- auto-unsubscribe -->
  <input @keydown.enter=${onSubmit} />                   <!-- filter by key -->
  <input @keydown.escape=${onCancel} />                  <!-- filter by key -->
`
```

Modifier order: `.stop`/`.prevent` wrap first, then `.once`, then keyboard filters.

### `tmpl-class-directive` — Use class:name for conditional classes

Toggle Tailwind classes cleanly without ternary expressions:

```typescript
// ❌ WRONG — ternary soup
html`<div class="p-2 ${selected.value ? 'bg-white/10' : ''}">`;

// ✅ CORRECT — class:name directive
html`<div class="p-2"
          class:bg-white/10=${selected}
          class:border-l-2=${selected}>`;
```

Uses `classList.toggle(name, bool)` — preserves other classes on the element.

### `tmpl-class-attribute-safe` — Reactive class attributes use classList, not setAttribute

The class attribute binding uses `classList.add/remove` internally (not `setAttribute('class', ...)`) so it composes safely with `class:name` directives on the same element. This means `class` with signal interpolations and `class:name` directives can coexist:

```typescript
// ✅ SAFE — class attribute + class:name directives on the same element
const type = signal('task');
const selected = signal(true);
html`<div class="item type-${type}" class:selected="${selected}">`;
// Changing type.value does NOT wipe out 'selected' class
```

See [ADR 0007](docs/framework-adr/0007-class-attribute-classList-conflict.md) for the full bug analysis.

### `tmpl-computed-views` — Use computed() for multi-branch rendering

For anything with 2+ branches, use `computed()` to select the template in JavaScript:

```typescript
const content = computed(() => {
  if (loading.value) return html`<div class="animate-pulse">Loading...</div>`;
  if (error.value) return html`<div class="text-red-400">${error}</div>`;
  return html`<div>${data}</div>`;
});

return html`<div class="container">${content}</div>`;
```

### `tmpl-each-lists` — Use each() for reactive list rendering

`each()` renders an array of items reactively with keyed reconciliation. When the array signal changes, only affected DOM nodes are added, removed, or reordered.

```typescript
const tasks = signal([...]);

html`<div>${each(
  tasks,
  (task) => task.id,                     // key function
  (task, index) => html`                  // template function
    <div class="task-item">
      <span>${computed(() => task.value.title)}</span>
    </div>
  `,
)}</div>`
```

**Key rules:**
- First argument is a signal of an array
- Key function maps each item to a unique, stable key
- Template function receives `ReadonlySignal<T>` (not raw T) — use `.value` in computed/effect
- Each item updates in-place via its signal — no remount for data changes
- Cascading effects: after `flushEffects()` runs the each() effect, downstream text bindings need another `flushEffects()` in tests

```typescript
// ❌ WRONG — static array, no reactivity
const items = tasks.value.map(t => html`<li>${t.title}</li>`);

// ✅ CORRECT — reactive list with keyed reconciliation
each(tasks, t => t.id, (task) => html`<li>${computed(() => task.value.title)}</li>`)
```

### `tmpl-when-simple` — Use when() only for simple toggles

`when()` is for single-branch inline toggles. No else branch, no nesting.

```typescript
// ✅ Simple toggle
html`${when(hasUnsaved, html`<span class="text-yellow-400">Unsaved</span>`)}`

// ❌ WRONG — use computed() for multi-branch
html`${when(loading, html`<div>Loading...</div>`)}`
html`${when(!loading, html`<div>${content}</div>`)}`
```

Note: `when()` eagerly evaluates the template argument. For expensive branches, use `computed()`.

### `tmpl-xss-safe` — Text bindings are safe by default

Text bindings use `textNode.data = String(value)` — the browser treats it as text content, never parsing HTML. Attribute bindings use `setAttribute()`. User-generated content in `${}` slots is never parsed as HTML.

```typescript
const userInput = signal('<img onerror=alert(1)>');

// ✅ SAFE — renders as visible text, not HTML
html`<span>${userInput}</span>`

// ⚠️ DANGEROUS — href/src with user input needs validation
html`<a href="${userInput}">Link</a>` // javascript: URLs would execute
```

### `tmpl-comment-markers` — Framework uses <!--bk-N--> markers

Each `${}` in the tagged template becomes `<!--bk-0-->`, `<!--bk-1-->`, etc. Avoid this pattern in your content. The `bk-` prefix is the collision boundary.

---

## 4. Dependency Injection (HIGH)

### `di-class-as-token` — Use the class as the injection token

A class constructor is already a unique JavaScript object reference, already typed, already named. No `createToken()` needed for services.

```typescript
class BacklogAPI {
  async getTasks(filter: string): Promise<Task[]> { ... }
}

// ✅ Class IS the token
const api = inject(BacklogAPI);

// Only for non-class dependencies (config objects, primitives):
const AppConfig = createToken<{ apiUrl: string }>('AppConfig');
provide(AppConfig, () => ({ apiUrl: '/api' }));
```

### `di-auto-singleton` — inject() auto-creates singletons

`inject(Class)` checks the global cache, creates via `new Class()` if not present, and returns the singleton. No registration step needed.

```typescript
// First call — creates singleton
const api = inject(BacklogAPI);

// All subsequent calls — same instance
inject(BacklogAPI) === inject(BacklogAPI) // always true
```

Singleton identity is a hard contract. Breaking it means diverging state.

### `di-provide-for-overrides` — provide() is for testing only

`provide(Class, factory)` overrides the singleton. It immediately clears the cache for that token. Use it in tests and for subtree overrides.

```typescript
// Test setup
provide(BacklogAPI, () => new MockBacklogAPI());
const api = inject(BacklogAPI); // returns mock

// provide() clears cache — previous singleton is gone
```

### `di-sync-only` — inject() must be called during setup

`inject()` requires the setup context. Call it synchronously in the component setup function.

### `di-bootstrap-eager` — Bootstrap services must be eagerly created

Services that must not miss events during startup (SSE connections, etc.) must be eagerly instantiated in `main.ts` before the component tree mounts:

```typescript
// main.ts — bootstrap before components mount
const sse = inject(SSEEvents);
sse.connect(); // starts receiving events immediately
```

### `di-no-failed-cache` — Failed construction is never cached

If `new Class()` or the factory throws, the error propagates but no instance is stored. The next `inject()` call retries construction. This prevents permanently broken services from a temporary failure.

### `di-circular-detection` — Circular dependencies throw immediately

An `instantiating` set detects circular dependencies. If A's constructor calls `inject(B)` and B's constructor calls `inject(A)`, it throws immediately instead of stack overflow.

---

## 5. Typed Emitters (MEDIUM-HIGH)

### `emitter-typed-events` — Extend Emitter<T> with a typed event map

Replace `document.dispatchEvent(new CustomEvent(...))` with typed emitter services:

```typescript
class NavigationEvents extends Emitter<{
  select: { id: string };
  filter: { filter: string; type: string };
}> {}

// Producer
const nav = inject(NavigationEvents);
nav.emit('select', { id: props.task.value.id });
// Type error if payload shape is wrong

// Consumer
nav.on('select', ({ id }) => setSelectedId(id));
// Type-safe — id is string, not any
```

### `emitter-inject-singleton` — Inject emitters via DI

Emitters are services. `inject(NavigationEvents)` returns the same singleton everywhere. Producers and consumers automatically share the same instance.

### `emitter-auto-dispose` — on() auto-disposes in component context

If `on()` is called during component setup (when `hasContext()` is true), the unsubscribe function is auto-registered as a disposer. On disconnect, the subscription is cleaned up.

Outside component context (services, tests), the caller gets the unsubscribe function and must manage it.

### `emitter-to-signal` — Bridge events into the reactive system

`toSignal()` creates a signal that updates on every event:

```typescript
const nav = inject(NavigationEvents);
const selectedId = nav.toSignal('select', e => e.id, null);
// selectedId is Signal<string | null>
// Updates every time 'select' is emitted
```

If called inside component context, auto-disposes. Outside context, the subscription is permanent.

### `emitter-copy-on-emit` — emit() iterates a copy of subscribers

`emit()` copies the subscriber set before iterating. It's safe to unsubscribe during a callback. One broken subscriber cannot prevent others from executing — errors are logged with `console.error`.

---

## 6. Declarative Data Loading (MEDIUM-HIGH)

### `query-key-function` — First arg is a key function with tracked signals

Any signals read inside the key function are automatically tracked. When they change, the query re-fetches.

```typescript
const tasks = query(
  () => ['tasks', props.scopeId.value], // tracked: scopeId
  () => api.getTasks(props.scopeId.value),
);
// When scopeId changes → auto-refetch
```

### `query-cache-key` — Same key = shared cache

Queries with the same key share cached results. If two components use `['tasks', scopeId.value]` with the same `scopeId`, only one network request fires.

```typescript
// Component A
const tasks = query(() => ['tasks', scope.value], () => api.getTasks(scope.value));

// Component B — same key → shares cached result, no duplicate request
const tasks = query(() => ['tasks', scope.value], () => api.getTasks(scope.value));
```

### `query-generation-guard` — Stale responses are auto-discarded

Every `doFetch()` captures a `generation` from `++fetchGeneration`. Before writing to signals, it checks `generation === fetchGeneration && !disposed`. If another fetch started, the older result is silently dropped.

### `query-enabled-guard` — Conditionally skip fetches

The `enabled` option is both a guard AND a tracked dependency:

```typescript
const tasks = query(
  () => ['tasks', scopeId.value],
  () => api.getTasks(scopeId.value),
  { enabled: () => !!scopeId.value } // skip when null
);
```

Signals read inside `enabled()` are tracked — when they change, the effect re-evaluates.

### `query-invalidate-prefix` — Prefix-based cache invalidation

`invalidate(['tasks'])` matches `['tasks']`, `['tasks', '1']`, `['tasks', '1', 'x']`. It deserializes each key and checks element-by-element — NOT string prefix matching.

```typescript
const client = inject(QueryClient);
await api.updateTask(id, patch);
client.invalidate(['tasks']); // all task queries refetch
```

### `query-disposed-check` — Async writes check disposal

Every async operation checks `!disposed` before writing to signals. Without this, a query that resolves after component unmount would write to detached signals — a memory leak.

### `query-catch-required` — Every async call in effect needs .catch()

`effect()` is synchronous. Async promises inside must have `.catch(() => {})` to prevent unhandled rejection warnings:

```typescript
// Inside effect:
doFetch().catch(() => {}); // prevents unhandled rejection
// Actual error handling is inside doFetch via try/catch
```

---

## 7. Error Handling & Resilience (MEDIUM)

### `error-setup-boundary` — Setup errors render a fallback

If `setup()` throws, the error is caught, logged, and a fallback `<div style="color:red">` is rendered. Sibling components are completely unaffected. The component stays "mounted" so `disconnectedCallback` can clean up.

```typescript
// Custom error handling (optional)
component<Props>('my-el', (props) => { ... }, {
  onError: (error, host) => html`<div class="text-red-400">Failed: ${error.message}</div>`
});
```

### `error-effect-survives` — Effect errors don't kill the effect

If an effect throws, `console.error` and continue. The effect is NOT disposed. A temporary failure (network timeout, missing element) shouldn't permanently kill the effect — it will re-run on the next signal change.

### `error-handler-wrapped` — @event handlers are try/caught

Handler errors are logged but don't crash the component or prevent other handlers. A broken click handler must not take down the entire UI.

### `error-cleanup-swallowed` — Cleanup errors are always swallowed

Cleanup function errors are caught and ignored. Cleanup failure must not prevent the effect from running again or from being disposed.

### `error-circular-detection` — Circular dependencies fail fast

Both computed (via `computing` flag) and DI (via `instantiating` set) detect circular dependencies and throw immediately — no infinite loops or stack overflows.

---

## 8. Migration & Interop (MEDIUM)

### `migration-same-tag` — Keep the same custom element tag name

`<task-filter-bar>` before = `<task-filter-bar>` after. The `main.ts` import path stays the same. All consumers work without changes.

### `migration-same-events` — Dispatch document CustomEvents during transition

Until ALL listeners of an event are migrated, the event MUST still be dispatched on `document`. Tag with `HACK:DOC_EVENT`:

```typescript
// HACK:DOC_EVENT — migrate to Emitter when task-list is migrated
document.dispatchEvent(new CustomEvent('filter-change', {
  detail: { filter, type: currentType.value, sort: currentSort.value },
}));
```

### `migration-same-api` — Maintain public method signatures

If external code calls `filterBar.setState(filter, type, query)`, the migrated component must accept the same arguments. Tag with `HACK:EXPOSE`:

```typescript
// HACK:EXPOSE — replace with component expose() API when Gap 1 is resolved
(host as any).setState = (filter: string, _type: string, _query: string | null) => {
  currentFilter.value = filter;
};
```

### `migration-hack-tags` — Tag every backward-compat hack

Every hack must be tagged so they can be found and cleaned up later:

| Tag | Meaning | Cleanup trigger |
|---|---|---|
| `HACK:EXPOSE` | Monkey-patched public method | `expose()` API implemented |
| `HACK:DOC_EVENT` | Document CustomEvent dispatch | All listeners migrated to Emitter |
| `HACK:REF` | querySelector in effect | `ref()` primitive implemented |
| `HACK:CROSS_QUERY` | Cross-component querySelector | Service extraction + DI |
| `HACK:STATIC_LIST` | Static array rendering | `each()` implemented |

### `migration-auto-resolve` — Props auto-resolve on framework elements

The template engine's `bindAttribute()` checks for `_setProp()` on the element. Framework components get prop routing; vanilla elements get `setAttribute()`. Standard HTML attributes (`id`, `style`, `slot`, `data-*`, `aria-*`) always use `setAttribute()`. The `class` attribute is handled specially by `bindClassAttribute()` (uses `classList` operations, see `tmpl-class-attribute-safe`).

### `migration-skip-leaf` — Skip attribute-driven leaf components

svg-icon, task-badge, md-block — these are pure attribute-driven leaf components or third-party wrappers. The framework adds no value. Leave them as plain HTMLElement subclasses.

---

## 9. Testing (LOW-MEDIUM)

### `test-flush-effects` — Flush effects after signal changes

Effects are batched. After changing a signal in tests, call `flushEffects()` to synchronously run pending effects:

```typescript
import { signal, effect, flushEffects } from './framework';

const count = signal(0);
const results: number[] = [];
effect(() => results.push(count.value));

flushEffects(); // runs the effect
expect(results).toEqual([0]);

count.value = 5;
flushEffects(); // runs the effect again
expect(results).toEqual([0, 5]);
```

### `test-cascading-flush` — Cascading effects need multiple flushes

Each flush cycle only runs effects that were pending at the START. Effects scheduled DURING a cycle run in the next one:

```typescript
const source = signal(0);
const derived = signal(0);
effect(() => { derived.value = source.value * 10; }); // A
effect(() => { results.push(derived.value); });         // B

source.value = 2;
flushEffects(); // runs A → derived = 20 → schedules B
flushEffects(); // runs B → reads derived = 20
```

### `test-provide-mock` — Use provide() for test mocks

Override services before the first `inject()` call:

```typescript
provide(BacklogAPI, () => ({
  getTasks: vi.fn().mockResolvedValue([]),
} as unknown as BacklogAPI));

const api = inject(BacklogAPI); // returns mock
```

### `test-reset-injector` — Reset between tests

Call `resetInjector()` in `beforeEach` or `afterEach` to clear the singleton cache. Without this, test order matters and mocks leak between tests.

```typescript
import { resetInjector } from './framework';

afterEach(() => {
  resetInjector();
});
```

### `test-query-client-isolated` — Isolated QueryClient per test

Provide a fresh `QueryClient` in tests to prevent cache leaks:

```typescript
provide(QueryClient, () => new QueryClient());
```

---

## Cross-Module Dependencies

These are the critical dependency chains. A bug in an upstream module propagates to everything downstream.

| Dependent | Depends on | Why |
|---|---|---|
| emitter.ts `on()` | context.ts `hasContext()` | Auto-disposal registration |
| component.ts `connectedCallback` | context.ts `runWithContext()` | Enables inject/effect/on inside setup |
| component.ts `mountTemplate()` | template.ts `TemplateResult.mount()` | Renders the component's DOM |
| template.ts text bindings | signal.ts `effect()` | Reactive DOM updates |
| template.ts `isSignal()` check | signal.ts `SIGNAL_BRAND` | Detects signals in expression slots |
| query.ts `doFetch()` | signal.ts `effect()` | Auto-refetch when dependencies change |
| query.ts cache sharing | injector.ts `inject(QueryClient)` | Global singleton cache |
| query.ts disposal | context.ts `getCurrentComponent()` | Registers cleanup on disconnect |

**Critical path**: signal.ts → context.ts → component.ts → template.ts

---

## Component Template — Complete Example

```typescript
import { signal, computed, effect, component, html, when, inject } from '../framework';

interface MyComponentProps {
  itemId: string;
  expanded: boolean;
}

const MyComponent = component<MyComponentProps>('my-component', (props, host) => {
  // ── Inject services (synchronous) ────────────────────────────
  const api = inject(BacklogAPI);
  const nav = inject(NavigationEvents);

  // ── Local state ──────────────────────────────────────────────
  const loading = signal(false);
  const data = signal<Item | null>(null);

  // ── Derived state ────────────────────────────────────────────
  const title = computed(() => data.value?.title ?? 'Loading...');
  const isActive = computed(() => data.value?.status === 'active');

  // ── Side effects ─────────────────────────────────────────────
  effect(() => {
    const id = props.itemId.value;
    if (!id) return;
    loading.value = true;
    api.getItem(id).then(item => {
      data.value = item;
      loading.value = false;
    }).catch(() => {
      loading.value = false;
    });
  });

  // ── Event handlers ───────────────────────────────────────────
  const onSelect = () => nav.emit('select', { id: props.itemId.value });

  // ── Computed view (multi-branch) ─────────────────────────────
  const content = computed(() => {
    if (loading.value) return html`<div class="animate-pulse">Loading...</div>`;
    if (!data.value) return html`<div class="text-gray-500">No data</div>`;
    return html`
      <div class="flex items-center gap-2" @click=${onSelect}>
        <span class="font-medium">${title}</span>
        <span class="text-xs" class:text-green-400=${isActive}>${data.value.status}</span>
      </div>
    `;
  });

  // ── Template ─────────────────────────────────────────────────
  return html`
    <div class="p-3 rounded border border-white/10"
         class:bg-white/5=${props.expanded}>
      ${content}
      ${when(props.expanded, html`
        <div class="mt-2 text-sm text-gray-400">
          Additional details here
        </div>
      `)}
    </div>
  `;
});

export { MyComponent };
```

---

## Shared Reactive Services (Cross-Component Communication)

Instead of `expose()` (rejected — see ADR 0007), use shared injectable services with signal properties for cross-component communication:

```typescript
// Service definition
class AppState {
  readonly selectedTaskId = signal<string | null>(null);
  readonly filter = signal('active');
}

// Producer component
const state = inject(AppState);
state.selectedTaskId.value = taskId;

// Consumer component — reacts automatically
const state = inject(AppState);
effect(() => {
  const id = state.selectedTaskId.value;
  if (id) loadTask(id);
});
```

This replaces:
- `HACK:EXPOSE` — no methods to expose, state is shared via signals
- `HACK:CROSS_QUERY` — no querySelector needed, inject the service
- Direct method calls via `(el as any).method()` — write to a signal instead

---

## Known Framework Gaps (Active)

These are documented gaps from the ADRs. Code using workarounds MUST be tagged.

| Gap | Severity | Tag | Status |
|---|---|---|---|
| `expose()` replaced by shared services | HIGH | `HACK:EXPOSE` | **Resolved** (ADR 0007) — use injectable services |
| `ref()` primitive | MEDIUM | `HACK:REF` | **Resolved** (ADR 0006) — use `ref()` |
| No Emitter integration (migration period) | LOW | `HACK:DOC_EVENT` | Deferred |
| Reactive list rendering `each()` | MEDIUM | `HACK:STATIC_LIST` | **Resolved** (ADR 0007) — use `each()` |
| Effect auto-disposal | MEDIUM | — | **Resolved** (ADR 0006) — auto-wired in component context |
| No `observedAttributes` → signal bridge | LOW | — | Deferred (skip leaf migration) |

### Resolved Gaps

| Gap | Resolution | ADR |
|---|---|---|
| `ref()` primitive | Implemented in `ref.ts` | ADR 0006 |
| Effect auto-disposal | `setContextHook()` in signal.ts, wired in component.ts | ADR 0006 |
| `class` attribute overwrites `class:name` directives | `bindClassAttribute()` uses classList instead of setAttribute | ADR 0007 |
