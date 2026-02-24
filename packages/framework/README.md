# nisli

A reactive web component framework. Signals, templates, dependency injection — no build step, no virtual DOM, no dependencies.

## Install

```bash
npm install @nisli/core
```

## Quick Start

```typescript
import { signal, component, html } from '@nisli/core';

const Counter = component('x-counter', () => {
  const count = signal(0);
  return html`
    <button @click=${() => count.set(count() + 1)}>
      Count: ${count}
    </button>
  `;
});
```

## Features

- **Signals** — Fine-grained reactivity with `signal`, `computed`, `effect`
- **Components** — Web Components with a composition-style setup function
- **Templates** — Tagged template literals with automatic signal binding
- **Dependency Injection** — `inject` any class as a singleton, `provide` overrides for testing
- **Queries** — Declarative async data loading with caching and auto-refetch
- **Event Emitters** — Typed event bus with auto-disposal in component context
- **Lifecycle** — `onMount`, `onCleanup`, `useHostEvent`
- **Refs** — Direct element access via `ref()`
- **Control Flow** — `when()` for toggles, `each()` for keyed list rendering

## API

```typescript
// Reactivity
signal(value)           // Reactive signal
computed(() => expr)    // Derived signal (lazy, cached)
effect(() => { ... })   // Side effect that tracks dependencies

// Components
component('tag-name', (props, host) => html`...`)
component<Props>('tag-name', { props: [...] }, (props, host) => html`...`)

// Templates — signals are implicit, no .value needed
html`<div>${count}</div>`
html`<button @click=${handler}>Go</button>`
html`<div class:active=${isActive}>...</div>`

// Control flow
when(condition, () => html`...`)
each(items, item => item.id, (item) => html`...`)

// Dependency injection — class IS the token
inject(MyService)                    // Auto-creates singleton
provide(MyService, () => mock)       // Override (testing)

// Queries
const { data, loading, error } = query(
  () => ['tasks', id.value],         // Cache key (tracked)
  () => api.getTasks(id.value),      // Fetcher
)

// Lifecycle
onMount(() => { ... })
onCleanup(() => { ... })
useHostEvent('click', handler)

// Refs
const el = ref<HTMLDivElement>()
html`<div ${el}>...</div>`

// Events
class Nav extends Emitter<{ select: { id: string } }> {}
inject(Nav).emit('select', { id })
inject(Nav).on('select', ({ id }) => { ... })
```

## Size

~2,600 lines of TypeScript. Zero dependencies.

## Inspiration

nisli stands on the shoulders of giants:

- [React](https://react.dev) — Component model, declarative UI
- [Solid](https://www.solidjs.com) — Signals, fine-grained reactivity, no virtual DOM
- [Lit](https://lit.dev) — Web Components, tagged template literals
- [Angular](https://angular.dev) — Dependency injection, typed tokens
- [Vue](https://vuejs.org) — Composition-style setup functions, reactive system design

## License

MIT
