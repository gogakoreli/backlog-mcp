# 0011. Viewer Version Management with Detached Process

**Date**: 2026-01-24
**Status**: Accepted
**Backlog Item**: TASK-0071

## Context

When a new version of backlog-mcp is released, the viewer UI stays on the old version because:
- Viewer and MCP server currently run in the same process
- First agent to start holds port 3030
- Subsequent agents skip viewer startup (port already in use)
- Killing the viewer kills the MCP server, disrupting the agent session

### Current State

In `src/server.ts`, the `main()` function calls `startViewer(viewerPort)` without awaiting it:

```typescript
async function main() {
  const viewerPort = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  startViewer(viewerPort);  // Not awaited, runs async

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

In `src/viewer.ts`, `startViewer()` checks if the port is in use and exits early:

```typescript
export async function startViewer(port: number = 3030): Promise<void> {
  if (await isPortInUse(port)) {
    console.error(`Backlog viewer already running on port ${port}`);
    return;  // Just exits if port in use
  }
  // ... creates HTTP server
}
```

The viewer is tightly coupled to the MCP server process lifecycle.

### Research Findings

- Node.js `child_process.spawn()` with `detached: true` allows spawning independent processes
- HTTP version endpoint is a standard pattern for service version checking
- `lsof` command can find PID listening on a specific port (macOS/Linux)
- Detached processes with `stdio: 'ignore'` and `.unref()` run independently of parent

## Proposed Solutions

### Option 1: Detached Process with Version Management

**Description**: Create standalone viewer entry point that spawns as detached process. MCP server checks version on startup via HTTP endpoint, kills and respawns viewer if version mismatch.

**Architecture**:
- `src/viewer-standalone.ts` - Entry point that only runs viewer
- `src/viewer-manager.ts` - Version management logic with clean, reusable functions
- `/version` endpoint on viewer HTTP server returns package version
- MCP server uses `ensureViewer()` instead of `startViewer()`

**Pros**:
- Automatic version management - zero user intervention
- Viewer survives MCP server restarts
- Multiple MCP servers can share single viewer instance
- Excellent UX - completely transparent to users
- Clean separation of concerns

**Cons**:
- `lsof` is macOS/Linux only (Windows needs different approach)
- Port-based PID lookup could theoretically kill wrong process if port 3030 used by non-viewer
- Process management adds complexity
- Need to handle edge cases (viewer crashes, version check fails, etc.)

**Implementation Complexity**: Medium

### Option 2: Shared Viewer Service with PID File

**Description**: Viewer writes PID and version to `~/.backlog-viewer.lock` file. MCP server reads lock file to check version and PID, kills and respawns if version mismatch.

**Architecture**:
- Lock file at `~/.backlog-viewer.lock` contains `{ pid, version, port }`
- Viewer writes lock file on startup, deletes on graceful shutdown
- MCP server reads lock file instead of using `lsof`
- More reliable PID tracking

**Pros**:
- More reliable than port-based PID lookup
- Cross-platform friendly (no lsof dependency)
- Explicit version tracking in lock file
- Can store additional metadata (startup time, etc.)

**Cons**:
- Lock file management adds complexity
- Stale lock files if viewer crashes (need cleanup logic)
- Need to handle lock file corruption
- More moving parts to maintain

**Implementation Complexity**: Medium-High

### Option 3: Viewer as Separate Long-Running Service

**Description**: Viewer becomes a separate npm script/command that users run manually. MCP server just checks if viewer is running, never manages it.

**Architecture**:
- Add `pnpm viewer` script to package.json
- MCP server only checks if port 3030 is in use
- Users responsible for starting/restarting viewer
- No process management in MCP server

**Pros**:
- Simplest implementation
- No process management complexity
- No risk of killing wrong process
- Clear separation - viewer is independent service

**Cons**:
- Terrible UX - users must manually restart viewer after updates
- Defeats the purpose of automatic version management
- Users will forget to restart viewer
- Inconsistent experience across agent sessions

**Implementation Complexity**: Low

## Decision

**Selected**: Option 1 - Detached Process with Version Management

**Rationale**: 

Option 1 provides the best user experience with automatic version management while maintaining acceptable technical complexity. The platform limitation (lsof on macOS/Linux) is acceptable because:

1. **Target audience**: Developers using local MCP servers primarily on macOS/Linux
2. **Graceful degradation**: If lsof fails, we log a warning and skip restart (viewer keeps running)
3. **Risk mitigation**: Port 3030 collision is unlikely in local dev environment
4. **Future extensibility**: Can add Windows support with netstat later if needed

Option 2 adds unnecessary complexity (lock file management, stale file cleanup) without significant benefits over Option 1. The lock file approach is more robust but overkill for a local development tool.

Option 3 is unacceptable due to poor UX - it requires manual intervention and defeats the purpose of the task.

**Trade-offs Accepted**:
- Platform limitation (macOS/Linux only for automatic restart)
- Small risk of killing wrong process if port 3030 used by non-viewer
- Need to handle edge cases with graceful fallbacks

## Consequences

**Positive**:
- Viewer automatically updates when new backlog-mcp version is installed
- Multiple MCP servers can share single viewer instance
- Viewer survives MCP server crashes/restarts
- Zero user intervention required
- Clean architecture with reusable functions

**Negative**:
- Windows users won't get automatic viewer restart (graceful fallback)
- Process management adds ~100 lines of code
- Need to test edge cases (crashes, network errors, etc.)

**Risks**:
- **Risk**: Could kill wrong process if port 3030 used by non-viewer
  - **Mitigation**: Unlikely in local dev, user will notice immediately if it happens
- **Risk**: Version check fails due to network error
  - **Mitigation**: Graceful fallback - skip restart, log warning
- **Risk**: Viewer crashes after spawn
  - **Mitigation**: Next MCP server start will detect and respawn

## Implementation Notes

### Key Functions in `src/viewer-manager.ts`

- `ensureViewer()` - Main orchestration: check if running, compare versions, restart if needed
- `isViewerRunning()` - Check if port 3030 is in use
- `getViewerVersion()` - Fetch version from `http://localhost:3030/version`
- `getCurrentVersion()` - Read version from package.json
- `killViewer()` - Find PID with lsof, kill process
- `spawnDetachedViewer()` - Spawn viewer as detached process
- `getPidOnPort(port)` - Helper using lsof to find PID
- `sleep(ms)` - Helper for waiting

### Detached Process Pattern

```typescript
import { spawn } from 'child_process';

spawn('node', [viewerStandalonePath], {
  detached: true,    // Process runs independently
  stdio: 'ignore'    // Don't inherit stdio
}).unref();          // Allow parent to exit
```

### Version Endpoint

Add to `src/viewer.ts` before 404 handler:

```typescript
if (req.url === '/version') {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(pkg.version);
  return;
}
```

### Build Configuration

Ensure `viewer-standalone.ts` is compiled to `dist/viewer-standalone.js`. TypeScript compiler will handle this automatically with current tsconfig.json.

### Testing Strategy

- Unit tests with mocked `spawn`, `execSync`, and `fetch`
- Test version mismatch triggers restart
- Test graceful handling of failures (lsof fails, version check fails, etc.)
- Integration test: spawn viewer, verify it's detached, kill parent, verify viewer survives
