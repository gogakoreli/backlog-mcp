# 0019. Minimal Runtime and Native Platform Alignment

**Date**: 2026-04-11
**Status**: Proposed
**Depends on**: [0014-compiled-positional-templates](./0014-compiled-positional-templates.md), [0017-framework-package-extraction](./0017-framework-package-extraction.md)

## Context

`@nisli/core` is intentionally small: signals, tagged templates, Web Component
registration, lifecycle cleanup, dependency injection, typed emitters, keyed
lists, refs, and declarative data loading. The framework has zero runtime
dependencies and no required build transform.

The current implementation is minimal at the API level, but not yet as minimal
as it could be in runtime work, shipped bytes, or package shape.

Review of `packages/framework` on 2026-04-11 found these concrete issues:

- `templateCache` exists but is unused; every `html().mount()` reparses the
  same static template strings and walks the full DOM tree again.
- Static component props can be wrapped into signals and subscribed even when
  they never change.
- `Signal.subscribe()` and computed `subscribe()` call subscribers once
  manually, then immediately call them again through the initial `effect()` run.
- The root barrel export makes the package convenient, but native ESM consumers
  have no fine-grained subpath imports for signals-only or template-only usage.
- The published `tsc` output retains implementation comments, so the shipped JS
  size reflects documentation style as much as runtime logic.
- Some internal identifiers are dead or drifted from earlier designs
  (`templateCache`, `ATTR_MARKER`, `computedAsReactiveNode`, `setupComplete`,
  and unused imports in `query.ts`).

The broader platform has also moved. Native browser features now cover more UI
surface area that a small framework should avoid owning by default:

- Declarative Shadow DOM for SSR/static HTML with shadow roots.
- Custom element states through `ElementInternals.states` and `:state()`.
- The Popover API for popovers, menus, and simple modal-like UI.
- CSS containment and `content-visibility` for large or offscreen DOM regions.
- View Transitions for app-level navigation transitions.
- Trusted Types for safer HTML injection boundaries.

Other features remain useful only as optional, feature-detected enhancements:

- `Element.setHTML()` and the Sanitizer API are not yet a safe baseline
  dependency for the core template path.
- `scheduler.postTask()` is not yet a safe replacement for `queueMicrotask()` in
  the signal scheduler.

## Decision

Keep the root philosophy: Nisli should be a thin reactive layer over native Web
Components, not a full app platform.

Prioritize runtime deletion and browser alignment in this order:

1. **Implement real template compilation and caching.** ADR 0014 remains the
   preferred direction. The immediate goal is to stop rebuilding marker HTML,
   reparsing templates, and walking every cloned DOM tree for every mount.

2. **Do not make static values reactive.** Component and factory mounting should
   set plain props and host classes once. Only actual signals should subscribe.

3. **Make `subscribe()` single-call on initialization.** Subscribing to a signal
   should produce one initial callback, not a manual call plus the first effect
   execution.

4. **Expose optional modules through subpath exports.** Keep `@nisli/core` as
   the ergonomic browser runtime entry point, but add granular imports for users
   who want smaller native-ESM graphs:

   ```ts
   import { signal, computed, effect } from '@nisli/core/signal';
   import { html, when, each } from '@nisli/core/template';
   import { component } from '@nisli/core/component';
   import { query, QueryClient } from '@nisli/core/query';
   ```

   `@nisli/core/static` already follows this pattern.

5. **Treat `query()` as optional framework policy.** Keep it available, but do
   not let data loading define the core runtime. If package size or conceptual
   surface becomes a problem, move query APIs to a separate subpath-only module
   or a later `@nisli/query` package.

6. **Publish a smaller build.** Preserve readable source in the repository, but
   avoid shipping comment-heavy JS as the only npm artifact. The first step can
   be `removeComments` in the framework build. A later step can add a minified
   browser artifact if direct CDN usage becomes a goal.

7. **Prefer platform features over framework primitives.** Do not add generic
   popover, modal, virtualizer, transition, sanitizer, or state-class APIs unless
   the platform feature is insufficient for a demonstrated use case.

## Native Platform Guidance

### Declarative Shadow DOM

Use Declarative Shadow DOM only when Nisli grows real static/SSR component
rendering or when a component explicitly needs style encapsulation. Do not make
Shadow DOM mandatory for normal components.

### CustomStateSet

Consider `ElementInternals.states` for host-level component state such as
selected, expanded, loading, and invalid. This can reduce class-string churn and
make custom elements feel more native.

This should be an opt-in component helper, not a replacement for normal class
bindings inside templates.

### Popover API

Use native `popover` for simple overlays before adding a framework abstraction.
Framework code should only help wire reactive state to native attributes when
repetition proves real.

### CSS Containment and content-visibility

Prefer app CSS for list and panel performance. The framework should not own a
virtualization primitive unless the viewer has measured DOM size or layout costs
that CSS containment cannot address.

### Trusted Types and HTML Injection

`html:inner` remains an explicit trusted escape hatch. Future work should narrow
it to `TrustedHTML` or a Nisli-branded trusted wrapper instead of accepting any
string. If `Element.setHTML()` becomes broadly available, it can be
feature-detected inside that trusted path.

### Scheduler API

Keep signal flushing on `queueMicrotask()`. A scheduler-backed priority system
would add complexity and depend on platform support that is not yet broad enough
for the core.

## Consequences

- ADR 0014 is still the main template performance plan; this ADR raises its
  priority because the current cache variable is present but unused.
- Some current convenience APIs should move toward subpath or optional status
  rather than expanding the root runtime.
- Minimalism is measured by runtime behavior and package graph shape, not only
  source line count.
- The framework should reject primitives that duplicate native browser features
  unless a concrete viewer requirement proves the native feature insufficient.

## Follow-Up Tasks

- Update the README quick start to use the real `.value` signal API.
- Remove dead framework internals and unused imports.
- Fix static prop subscription behavior in component factory mounting.
- Fix double initial subscriber calls.
- Implement or revive the compiled template cache from ADR 0014.
- Add granular package subpath exports for signal, template, component, query,
  lifecycle, emitter, and ref modules.
- Evaluate a framework build option that removes comments from published JS.
