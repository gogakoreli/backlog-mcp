# 0017. Framework Package Extraction — Standalone Reactive Web Component Library

**Date**: 2026-02-24
**Status**: Accepted

## Context

Since ADR 0001, the framework has grown from a proposed reactive base class into a complete web component library: signals, computed values, effects, a tagged template engine with `when`/`each` reconciliation, dependency injection, typed event emitters, declarative data loading (`query`), lifecycle hooks, and element refs.

All of this lived in `packages/viewer/framework/` — a subdirectory of the viewer package. The framework had zero imports from the viewer or any other package, yet it wasn't recognized as an independent unit at the package level.

Meanwhile, the monorepo had already established a multi-package pattern:
- `@backlog-mcp/shared` — shared types
- `@backlog-mcp/viewer` — web UI
- `backlog-mcp` (server) — MCP server + HTTP

The framework was the odd one out: a self-contained library with its own tests, its own API surface, and zero dependencies — but no package identity.

## Decision

Extract the framework into `packages/framework/` as `nisli` — a private workspace package with:

- **Zero dependencies** — pure TypeScript, no npm packages
- **Single barrel export** — `"." → "./src/index.ts"`, consistent with `@backlog-mcp/shared`
- **Source-linked** — consumed directly as TypeScript source via workspace symlinks, no build step
- **Own test suite** — 215 tests across 11 files, running independently via vitest
- **`publishConfig`** — ready for future npm publish if the framework is ever released standalone

The viewer imports the framework as `nisli` — the real package name, no aliases.

### Dependency graph

```
@backlog-mcp/shared ────→ @backlog-mcp/viewer ←──── nisli
                               ↓ (static file copy)
                          backlog-mcp (server)
```

Framework and shared are independent leaf packages. Viewer depends on both. Server copies the viewer's built assets — it never imports the viewer or framework as modules.

## Rationale

1. **The framework is a product, not a utility folder.** ~660 lines implementing a complete reactive web component system deserves its own identity, versioning, and test isolation.

2. **Independent evolution.** Signal performance optimizations and template engine improvements evolve on a different cadence than UI components. Separate package = separate concerns.

3. **Future optionality.** Private today, but properly packaged means it could be published as a standalone open-source micro-framework. The `publishConfig` is already in place.

4. **Consistency.** Every other logical unit in the monorepo is a package. The framework was the exception.

## Vision

`nisli` is a minimal, zero-dependency reactive web component framework. It is intentionally small and opinionated:

- **Signals over virtual DOM** — fine-grained reactivity without diffing
- **Tagged templates over JSX** — no build transform required
- **Web Components native** — `customElements.define`, Shadow DOM optional, standard lifecycle
- **DI over prop drilling** — `inject`/`provide` for cross-cutting concerns
- **Declarative data loading** — `query()` for async state with caching and invalidation

The framework exists to prove that you don't need a large runtime to build reactive web applications. It can serve as both a practical tool and an educational reference for how reactive systems work under the hood.

## Consequences

- All viewer imports changed from `@framework/*` (path alias) to `nisli` (real package)
- The `@framework` alias was removed from tsconfig, vitest config, and esbuild config
- Multi-line deep imports were consolidated into single barrel imports per file (net -75 lines)
- `useHostEvent` was added to the barrel export (was previously only accessible via deep import)
- Framework ADR docs remain in `docs/framework-adr/` — they document the framework's design history regardless of where the code lives
- The SKILL.md and AGENTS.md references were updated to point to `packages/framework/`
