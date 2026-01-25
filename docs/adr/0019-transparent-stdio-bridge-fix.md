# 0019. Use mcp-remote for stdio Bridge

**Date**: 2026-01-25
**Status**: Accepted
**Supersedes**: ADR-0014 (implementation approach)

## Context

ADR-0014 implemented a custom stdio-to-HTTP bridge, but it had blocking issues during initialization. After research, we discovered `mcp-remote` - a battle-tested, MIT-licensed bridge that does exactly what we need.

### Problem

The custom bridge implementation was blocking because it incorrectly used the MCP Client SDK, which added a protocol layer instead of being a transparent proxy.

### Research Findings

**mcp-remote** (https://github.com/geelen/mcp-remote):
- Battle-tested stdio-to-SSE bridge used by Claude Desktop, Cursor, Windsurf
- Handles OAuth, reconnection, error handling
- Uses `StdioServerTransport` and `SSEClientTransport` correctly
- MIT licensed
- 1.2k stars, actively maintained
- Supports both HTTP and SSE transports with fallback

## Decision

**Use mcp-remote as a dependency** instead of building our own bridge.

**Implementation**:
```typescript
// Install mcp-remote
pnpm add mcp-remote

// Bridge spawns mcp-remote as subprocess
const mcpRemotePath = 'node_modules/mcp-remote/dist/proxy.js';
const bridge = spawn(process.execPath, [
  mcpRemotePath, 
  `http://localhost:${port}/mcp`,
  '--allow-http'  // Allow local HTTP connections
], {
  stdio: 'inherit'
});
```

**Rationale**:
1. **Battle-tested**: Used by thousands of users in production
2. **Correct architecture**: Properly implements transparent proxy
3. **Zero maintenance**: We don't maintain bridge code
4. **Feature-rich**: OAuth, reconnection, error handling built-in
5. **Simple**: ~20 lines of code vs ~200 lines custom implementation

## Consequences

**Positive**:
- ✅ No blocking issues
- ✅ Battle-tested, production-ready
- ✅ Zero bridge maintenance burden
- ✅ Automatic updates via npm
- ✅ Supports both HTTP and SSE (with fallback)

**Negative**:
- ⚠️ Additional dependency (~39 packages)
- ⚠️ Slightly larger install size

**Trade-offs Accepted**:
- Dependency on external package (acceptable - it's stable and widely used)
- OAuth features we don't need (acceptable - no overhead if unused)

## Implementation Notes

**Bridge code** (`src/cli/bridge.ts`):
- Ensure HTTP server is running
- Spawn mcp-remote with `--allow-http` flag (for local connections)
- Inherit stdio (transparent passthrough)

**No changes needed**:
- HTTP server remains unchanged
- CLI remains unchanged
- All existing functionality preserved

## Related ADRs

- [0014. stdio-to-HTTP Bridge Implementation](./0014-stdio-http-bridge-implementation.md) - Superseded
- [0013. HTTP MCP Server Architecture](./0013-http-mcp-server-architecture.md) - Parent architecture
