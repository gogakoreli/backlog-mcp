---
name: backlog-ui-framework
description: Reactive web component framework guidelines for the backlog viewer. This skill should be used when writing, reviewing, migrating, or refactoring components in `viewer/components/` that use the framework primitives from `packages/framework/`. Triggers on tasks involving component creation, signal-based state, template rendering, dependency injection, emitter events, or query-based data loading.
license: MIT
metadata:
  author: backlog-team
  version: "1.0.0"
---

# Backlog UI Framework — Agent Skill

Comprehensive guide for building reactive web components using the custom signals-based framework in `packages/framework/`. Contains rules across 9 categories covering component authoring, reactivity, templates, dependency injection, events, data loading, error handling, migration, and testing.

## When to Apply

Reference these guidelines when:
- Creating new web components in `viewer/components/`
- Migrating existing `HTMLElement`-based components to the reactive framework
- Writing or reviewing signal-based reactive state
- Implementing `html` tagged templates with bindings and `@event` handlers
- Using `inject()` / `provide()` for dependency injection
- Setting up `query()` for declarative data loading
- Wiring typed `Emitter` events between components
- Reviewing code for memory leaks, XSS, or lifecycle issues
- Writing tests for framework components

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Component Authoring | CRITICAL | `comp-` |
| 2 | Signals & Reactivity | CRITICAL | `signal-` |
| 3 | Template Engine | HIGH | `tmpl-` |
| 4 | Dependency Injection | HIGH | `di-` |
| 5 | Typed Emitters | MEDIUM-HIGH | `emitter-` |
| 6 | Declarative Data Loading | MEDIUM-HIGH | `query-` |
| 7 | Error Handling & Resilience | MEDIUM | `error-` |
| 8 | Migration & Interop | MEDIUM | `migration-` |
| 9 | Testing | LOW-MEDIUM | `test-` |

## Quick Reference

### 1. Component Authoring (CRITICAL)

- `comp-setup-sync` - Setup function MUST be synchronous; capture services sync, use them async
- `comp-props-signals` - All props are `Signal<T>`; factory requires signals, not plain values
- `comp-factory-composition` - ALL custom elements MUST use factory composition; HTML tag syntax is ONLY for native elements (div, span, button)
- `comp-html-for-vanilla` - HTML tag syntax (`<tag>`) is ONLY for native HTML elements; never for custom elements
- `comp-no-this` - No `this` in components; use pure functions with props and host
- `comp-no-innerhtml` - Never use `innerHTML`; use `html` tagged templates for targeted DOM patching
- `comp-host-escape-hatch` - `host` is the second param; use it only for imperative DOM access
- `comp-no-class-authoring` - Never extend HTMLElement directly for new components; use `component()`
- `comp-host-attrs` - Use second factory arg `{ class: '...' }` for host-level CSS classes (ADR 0009)
- `comp-prop-input` - Factory props accept `T | Signal<T>` — plain values are auto-wrapped (ADR 0009)

### 2. Signals & Reactivity (CRITICAL)

- `signal-value-read` - Always use `.value` in JS code; signals are implicit in `html` templates
- `signal-immutable-writes` - Mutating objects doesn't trigger updates; assign a new reference
- `signal-computed-derived` - Use `computed()` for derived state, not manual sync in effects
- `signal-effect-side-effects` - Effects are for side effects only (DOM, network, localStorage)
- `signal-batch-writes` - Use `batch()` for multiple synchronous signal writes
- `signal-no-async-in-setup-context` - `inject()`, `effect()`, `emitter.on()` must be called synchronously in setup
- `signal-untrack` - Use `untrack()` to read signals without tracking them as dependencies (ADR 0009)
- `signal-conditional-deps` - Dependencies are re-tracked on every run; conditional reads track correctly
- `signal-equality-object-is` - Signal equality uses `Object.is()`, not `===`

### 3. Template Engine (HIGH)

- `tmpl-implicit-signals` - Write `${count}` not `${count.value}` in templates
- `tmpl-event-colocated` - Use `@click=${handler}` on the element, not detached listeners
- `tmpl-event-modifiers` - Use `.stop`, `.prevent`, `.once`, `.enter`, `.escape` modifiers
- `tmpl-class-directive` - Use `class:name=${signal}` for conditional classes, not ternary soup
- `tmpl-class-attribute-safe` - Reactive class attributes use classList, safe alongside class:name directives (ADR 0007)
- `tmpl-computed-views` - Use `computed()` for multi-branch conditional rendering
- `tmpl-when-simple` - Use `when()` only for simple single-branch toggles
- `tmpl-xss-safe` - Text bindings use `textNode.data`; never parse user input as HTML
- `tmpl-comment-markers` - Framework uses `<!--bk-N-->` markers; avoid this pattern in content

### 4. Dependency Injection (HIGH)

- `di-class-as-token` - Use the class itself as the injection token; no `createToken()` for services
- `di-auto-singleton` - `inject(Class)` auto-creates a singleton; no registration needed
- `di-provide-for-overrides` - `provide()` is for testing and subtree overrides only
- `di-sync-only` - `inject()` must be called synchronously during setup
- `di-bootstrap-eager` - Bootstrap services (SSE, etc.) must be eagerly created in `main.ts`
- `di-no-failed-cache` - Failed construction is never cached; next `inject()` retries

### 5. Typed Emitters (MEDIUM-HIGH)

- `emitter-typed-events` - Extend `Emitter<T>` with a typed event map; no `CustomEvent` strings
- `emitter-inject-singleton` - Inject emitters via DI; they are auto-singleton services
- `emitter-auto-dispose` - `on()` inside component context auto-disposes on disconnect
- `emitter-to-signal` - Use `toSignal()` to bridge events into the reactive system
- `emitter-copy-on-emit` - `emit()` iterates a copy; safe to unsubscribe during callback

### 6. Declarative Data Loading (MEDIUM-HIGH)

- `query-key-function` - First arg is a key function returning an array; signals inside are tracked
- `query-cache-key` - Same cache key = same cached result; design keys for proper deduplication
- `query-generation-guard` - Stale responses are discarded via generation counter; no race conditions
- `query-enabled-guard` - Use `enabled` option to conditionally skip fetches
- `query-invalidate-prefix` - `invalidate(['tasks'])` matches all keys starting with `['tasks']`
- `query-disposed-check` - All async writes check `!disposed` before updating signals

### 7. Error Handling & Resilience (MEDIUM)

- `error-setup-boundary` - Setup errors render a fallback; sibling components unaffected
- `error-effect-survives` - Effect errors are logged, not thrown; the effect stays alive
- `error-effect-loop-guard` - Effects that re-run >100 times in 2s are auto-disposed (ADR 0009)
- `error-handler-wrapped` - `@event` handlers are try/caught; broken handlers don't crash the UI
- `error-cleanup-swallowed` - Cleanup/disposer errors are swallowed; disposal always completes
- `error-circular-detection` - Both computed and DI have circular dependency detection

### 8. Migration & Interop (MEDIUM)

- `migration-same-tag` - Keep the same custom element tag name after migration
- `migration-same-events` - Dispatch document CustomEvents until all listeners migrate
- `migration-same-api` - Maintain public method signatures via `(host as any).method = ...`
- `migration-hack-tags` - Tag every backward-compat hack: `HACK:EXPOSE`, `HACK:DOC_EVENT`, `HACK:REF`
- `migration-auto-resolve` - Template auto-resolves `_setProp` vs `setAttribute`; `class` uses classList (ADR 0007)

### 9. Testing (LOW-MEDIUM)

- `test-flush-effects` - Call `flushEffects()` after signal changes to run pending effects
- `test-cascading-flush` - Cascading effects need multiple `flushEffects()` calls
- `test-provide-mock` - Use `provide(Class, () => mock)` before `inject()` in tests
- `test-reset-injector` - Call `resetInjector()` between tests to clear singleton cache
- `test-query-client-isolated` - Provide a fresh `QueryClient` in tests for cache isolation

## How to Use

Read the full compiled document for detailed explanations and code examples: `AGENTS.md`

Each section contains:
- The invariant or rule explained
- Why it matters (the bug it prevents)
- Incorrect code example with explanation
- Correct code example with explanation
- References to framework source files
