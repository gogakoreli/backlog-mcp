# Development Guide

## Quick Start

```bash
pnpm install
pnpm dev  # Starts MCP server + web viewer with hot reload
```

## CLI Commands

```bash
backlog-mcp              # Run as stdio MCP server (default)
backlog-mcp serve        # Run HTTP server with viewer
backlog-mcp version      # Show version
backlog-mcp status       # Check if server is running (port, version, URLs)
backlog-mcp stop         # Stop the server gracefully
backlog-mcp --help       # Show help
```

**Development workflow:**
```bash
pnpm dev                 # Start dev server (port 3040, hot reload)
pnpm build               # Build for production
node dist/cli/index.mjs status  # Check local build
node dist/cli/index.mjs stop    # Stop local server
```

## Server Architecture

### Production Mode (Kiro/MCP Clients)

When running via `backlog-mcp` (or `pnpm start`):
- **HTTP server** spawns as a detached background process on port 3030 (default)
- **stdio bridge** runs in foreground, connects to HTTP server via `mcp-remote`
- HTTP server persists across sessions (shared by multiple MCP clients)
- Auto-restarts on version upgrades

### Development Mode

When running `pnpm dev`:
- Runs HTTP server directly in foreground (not detached) on port 3040
- Uses `tsx watch` for hot reload on file changes
- Ctrl+C cleanly shuts down via SIGINT handler
- Reads port from `.env` file (`BACKLOG_VIEWER_PORT`)

**Key difference**: Production uses detached process for persistence, dev uses foreground process for easy restart.

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
