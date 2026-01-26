# 0028. System Configuration Visibility

**Date**: 2026-01-26
**Status**: Accepted

## Context

Users are experiencing confusion about where backlog-mcp is reading and writing task data. When the server starts, there's no indication of which data directory is being used. When debugging issues (like empty task lists), users have to manually investigate where the server is looking for data.

### Current State

**Server startup logs**:
```
Backlog MCP server running on http://localhost:3030
- Viewer: http://localhost:3030/
- MCP endpoint: http://localhost:3030/mcp
```

**Problems**:
- No indication of data directory location
- No way to verify configuration from logs
- Status command shows port/version but not data directory
- UI has no visibility into system configuration

**User pain points**:
1. Server starts with no indication of where data is stored
2. Empty results require manual debugging to find data directory
3. No way to verify correct configuration from UI
4. Confusion when `BACKLOG_DATA_DIR` env var is not set or incorrect

### Research Findings

- Data directory is configurable via `BACKLOG_DATA_DIR` env var
- Defaults to `./data` (relative path) if not set
- Users expect to use `~/Documents/goga/.backlog` consistently
- Current implementation provides no transparency about resolved paths
- Status command exists but doesn't show data directory

## Proposed Solutions

### Option 1: Minimal Logging + Footer Info

**Description**: Add data directory to startup logs and show in UI footer

**Components**:
- Server startup: Add one line showing resolved data directory path
- Status command: Add data directory to output
- UI footer: Small text showing data directory (always visible)

**Pros**:
- Minimal code changes (~10 lines)
- Quick to implement
- Information always visible in UI

**Cons**:
- Footer clutters UI permanently
- Not scalable for additional config options
- No structured API for programmatic access

**Implementation Complexity**: Low

### Option 2: Status API + Collapsible Banner

**Description**: Create status API and show info in collapsible banner at top of UI

**Components**:
- Server startup: Add data directory to console output
- Status API: `/api/status` endpoint with config + system info
- Status command: Fetch from API and display
- UI banner: Collapsible banner at top showing config (dismissible)

**Pros**:
- API enables programmatic access
- Banner can be dismissed
- Extensible for future config

**Cons**:
- Banner pattern feels like warning/alert (wrong semantic)
- More complex than minimal approach
- Banner might be annoying if always shown

**Implementation Complexity**: Medium

### Option 3: Hybrid Approach (Logging + API + Gear Icon Modal)

**Description**: Add configuration visibility at all touchpoints with minimal UI clutter

**Components**:
1. **Server startup logs**: Add data directory path (absolute, resolved)
2. **Status command**: Add data directory to CLI output
3. **Status API**: `/api/status` endpoint returning system info
4. **UI gear icon**: Small icon in header that opens modal with system info

**API Response**:
```json
{
  "version": "0.24.0",
  "port": 3030,
  "dataDir": "/Users/gkoreli/Documents/goga/.backlog",
  "taskCount": 91,
  "uptime": 3600
}
```

**UI Modal Content**:
- Version
- Data directory (with copy button)
- Task count
- Server uptime
- Port

**Pros**:
- Solves all user pain points (startup, debugging, UI)
- Minimal UI clutter (icon only, info on demand)
- API useful for monitoring/debugging
- Follows common UX pattern (gear icon = system info)
- Extensible for future system info needs
- Modal allows showing rich information without cluttering UI

**Cons**:
- Medium implementation effort (~100 lines total)
- Requires new API endpoint
- Requires new UI component

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 3 - Hybrid Approach (Logging + API + Gear Icon Modal)

**Rationale**: 

This approach provides the most complete solution to the user's pain points while maintaining clean UX:

1. **Startup logs** solve the immediate "where is it running from" question
2. **Status command** enables CLI-based debugging
3. **Status API** provides programmatic access for monitoring/tooling
4. **Gear icon modal** gives UI visibility without clutter

The gear icon pattern is well-established for system info/settings and respects user attention - information is available on demand rather than always visible. The modal format allows showing comprehensive system information (version, data dir, stats) without compromising the clean task management UI.

While this requires more implementation effort than the minimal approach, the value justifies the cost:
- Prevents future confusion and debugging time
- Provides foundation for system monitoring
- Follows UX best practices
- Extensible for future needs

**Trade-offs Accepted**:
- Medium implementation complexity vs. minimal approach
- Need to maintain API endpoint
- Modal component adds to bundle size (minimal impact)

## Consequences

**Positive**:
- Users immediately see data directory on server startup
- CLI status command provides quick config verification
- UI provides self-service debugging (no need to check logs)
- API enables future monitoring/alerting tools
- Reduces support burden (users can self-diagnose config issues)
- Extensible pattern for adding more system info

**Negative**:
- Additional code to maintain (~100 lines)
- API endpoint increases surface area
- Modal component adds slight complexity to viewer

**Risks**:
- **Risk**: Modal might not be discoverable
  - **Mitigation**: Use standard gear icon, add tooltip "System Info"
- **Risk**: API might expose sensitive information
  - **Mitigation**: Only expose non-sensitive config (no secrets, no internal paths beyond data dir)

## Implementation Notes

**Server startup logs** (`src/server/fastify-server.ts`):
```typescript
console.log(`Backlog MCP server running on http://localhost:${port}`);
console.log(`- Viewer: http://localhost:${port}/`);
console.log(`- MCP endpoint: http://localhost:${port}/mcp`);
console.log(`- Data directory: ${path.resolve(getBacklogDataDir())}`); // ADD THIS
```

**Status API** (`src/server/viewer-routes.ts`):
```typescript
app.get('/api/status', async () => {
  const dataDir = path.resolve(getBacklogDataDir());
  const tasks = storage.list({ limit: 10000 });
  return {
    version: packageJson.version,
    port: app.server.address().port,
    dataDir,
    taskCount: tasks.length,
    uptime: process.uptime()
  };
});
```

**Status command** (`src/cli/index.ts`):
- Fetch from `/api/status` and display data directory

**UI Component** (`viewer/components/system-info-modal.ts`):
- Web Component with modal overlay
- Fetch from `/api/status` on open
- Display info in readable format
- Copy button for data directory path

**UI Integration** (`viewer/main.ts`):
- Add gear icon to header (top-right corner)
- Wire up click handler to open modal
