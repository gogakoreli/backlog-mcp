# 0088. Monorepo Structure — Eliminate Type Duplication, Enable Growth

**Date**: 2026-02-21
**Status**: Proposed
**Triggered by**: TASK-0383 (type duplication discovered)

## Context

Three parallel type systems define the same entity concepts independently:

| Location | Target | Defines |
|---|---|---|
| `src/storage/schema.ts` | Node | `TASK_TYPES`, `TYPE_PREFIXES`, `parseTaskId()`, `Task` interface |
| `viewer/type-registry.ts` | Browser | `EntityType` enum, `TYPE_REGISTRY`, `getTypeFromId()` |
| `src/substrates/index.ts` | Dead code | `ENTITY_TYPES`, `SUBSTRATES`, Zod schemas, `parseEntityId()` |

All three define the same 5 entity types, prefix mappings, and ID utilities. They can't share code because `src/` (Node/tsdown) and `viewer/` (Browser/esbuild) have separate build pipelines with incompatible targets and no shared import path.

This isn't just a type problem — it's a structural one. The project has outgrown its single-package layout. Server, viewer, and shared logic are tangled in one flat repo with two ad-hoc build pipelines.

## Decision

Restructure as a **pnpm workspaces monorepo** with distinct packages.

### Target structure

```
packages/
  shared/        — Pure TS: entity types, prefixes, ID utils, status, interfaces
  server/        — MCP server, storage, tools, CLI (current src/)
  viewer/        — Web UI, components, framework (current viewer/)

pnpm-workspace.yaml
turbo.json       — (optional, add when build caching matters)
```

### Package responsibilities

**`@backlog-mcp/shared`** (internal, not published separately)
- Entity type list + prefix map (single canonical source)
- ID parse/format/validate utilities
- Status types and constants
- Base interfaces: `Reference`, `Entity` shape
- **Zero** Node or DOM imports — pure TypeScript only
- No Zod (server dependency) — plain interfaces only

**`@backlog-mcp/server`** (published as `backlog-mcp` on npm)
- MCP server, Fastify, storage, tools, CLI
- Imports `@backlog-mcp/shared` for types
- Wraps shared interfaces in Zod schemas for validation
- Bundles viewer dist at build time (serves static assets)
- Owns the `backlog-mcp` bin entry point

**`@backlog-mcp/viewer`** (internal, bundled into server)
- Web components, framework, styles
- Imports `@backlog-mcp/shared` for types
- Extends shared types with UI concerns (icons, gradients, `opensInPane`)
- esbuild bundles output to server's dist/viewer

### What gets deleted

- `src/substrates/index.ts` — useful parts absorbed into `shared`, rest discarded

### Publishing model

End users still install one package: `npx backlog-mcp`. The server package is the published artifact. Shared and viewer are internal workspace packages consumed at build time.

### Build orchestration

**Phase 1: pnpm workspaces** — `workspace:*` protocol for inter-package deps. Build order via scripts or simple dependency chain.

**Phase 2 (optional): turborepo** — Add when build caching and parallel task execution provide real value. Not needed at current scale (<100ms builds).

### Migration path

1. Create `packages/shared/` with extracted types
2. Move `src/` → `packages/server/`, `viewer/` → `packages/viewer/`
3. Wire up `pnpm-workspace.yaml` and tsconfig project references
4. Update build scripts, esbuild aliases, tsdown config
5. Update npm publish config (server package = published package)
6. Verify: `pnpm build`, `pnpm test`, `npx backlog-mcp` all work identically

## Consequences

- **Single source of truth** for entity types — add a type once, both sides see it
- **Clean dependency graph**: shared ← server, shared ← viewer, server embeds viewer
- **Enables growth**: new packages (CLI plugins, SDK, etc.) can depend on shared
- **Breaking for contributors**: directory structure changes, import paths change
- **Not breaking for users**: same npm package name, same CLI, same behavior
- **Risk**: migration is non-trivial — every import path changes, build configs rewritten
