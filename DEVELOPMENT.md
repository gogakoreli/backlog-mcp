# Development Guide

## Quick Start

```bash
pnpm install
pnpm dev  # Starts MCP server + web viewer with hot reload
```

## Architecture

- **UI is read-only** - all mutations happen via MCP tools from the LLM
- **URL is single source of truth** - components have `setState()` for rendering, no internal state sync
- **Simple over complex** - prefer polling over SSE + file watchers

## Code Style

- Minimal code - only what's needed to solve the problem
- Declarative with named functions, not inline callbacks
- No hacks or flags for state management

## Data Model

- Epics and tasks share same storage (`data/tasks/`), differentiated by `type` field
- ID format: `EPIC-0001` for epics, `TASK-0001` for tasks
- References are `{url, title}` objects, not plain strings

## Web Viewer Patterns

### Icons
- No emojis - use SVG icons from `viewer/icons/index.ts`
- Futuristic gradient style matching `logo.svg` (linearGradient in defs)
- Epic: gold/orange hexagon, Task: cyan/purple diamond

### Styling
- Components inherit colors from parent elements
- Don't override font sizes unless necessary
- Selection states must be consistent across all item types
- Tree connectors use `::before`/`::after` pseudo-elements

### Filters
- "All" option goes last in filter lists
- Child tasks without visible parent show as orphans (not hidden)

## File Structure

```
src/
  schema.ts    # Task interface, ID generation, createTask factory
  server.ts    # MCP tool definitions
  viewer.ts    # HTTP server for web viewer

viewer/
  components/  # Web components (task-list, task-item, task-detail, etc.)
  icons/       # SVG icon exports
  utils/       # api.ts, url-state.ts
  styles.css   # All styling
  main.ts      # App initialization
```

## Testing MCP Tools

```bash
# Build and test
pnpm build && pnpm test

# Manual JSON-RPC call
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backlog_list","arguments":{}}}' | node dist/server.js
```
