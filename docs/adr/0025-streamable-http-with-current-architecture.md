# 0025. Enable StreamableHTTPServerTransport with Current Architecture

**Date**: 2026-01-26
**Status**: Accepted
**Backlog Item**: TASK-0090

## Context

User requirement: "I like the current architecture, don't change the architecture."

### Current Architecture

- Single HTTP server on port 3030 (fastify-server.js)
- HTTP server handles BOTH MCP protocol (via SSEServerTransport) AND web viewer
- stdio bridge (bridge.ts) spawns HTTP server via server-manager.ts
- bridge.ts uses mcp-remote to connect stdio ↔ HTTP server
- Flow: CLI → bridge.ts → mcp-remote → HTTP server

### Problem

SSEServerTransport is deprecated. We need to migrate to StreamableHTTPServerTransport while maintaining the exact same architecture.

### Previous Attempts

**ADR-0023** (Rejected): Attempted direct migration but failed because:
- Changed server to use StreamableHTTPServerTransport
- Kept `--transport sse-only` in bridge.ts
- Protocol mismatch: SSEClientTransport (client) ↔ StreamableHTTPServerTransport (server)
- Result: "Body Timeout Error" and "400 Bad Request"

**ADR-0024** (Rejected by user): Proposed dual-mode server (separate stdio mode)
- User feedback: "I like the current architecture, don't change the architecture"
- Dual-mode changes the architecture

### Constraint

**DO NOT** propose dual-mode servers or separate stdio servers. Keep the single HTTP server + bridge pattern.

## Research Findings

### Critical Discovery: mcp-remote Supports StreamableHTTP

Examined mcp-remote source code and found:

```javascript
// node_modules/mcp-remote/dist/chunk-F76MHFRJ.js:19115-19125
const sseTransport = transportStrategy === "sse-only" || transportStrategy === "sse-first";
const transport = sseTransport 
  ? new SSEClientTransport(url2, {...})
  : new StreamableHTTPClientTransport(url2, {...});
```

**mcp-remote supports multiple transport strategies**:
- `sse-only` → Uses SSEClientTransport (legacy)
- `sse-first` → Tries SSE first, falls back to HTTP
- `http-first` → Tries HTTP first, falls back to SSE (default)
- `http-only` → Uses StreamableHTTPClientTransport

**Current usage in bridge.ts**:
```typescript
spawn(mcpRemotePath, [serverUrl, '--allow-http', '--transport', 'sse-only'], {
  stdio: 'inherit'
})
```

**Root cause of ADR-0023 failure**: We forced mcp-remote to use SSE (`--transport sse-only`) while the server used StreamableHTTP. Protocol mismatch.

### StreamableHTTPServerTransport API

From SDK documentation:

```typescript
class StreamableHTTPServerTransport {
  constructor(options?: {
    sessionIdGenerator?: (() => string) | undefined;
    enableJsonResponse?: boolean;
  });
  
  handleRequest(
    req: IncomingMessage, 
    res: ServerResponse, 
    parsedBody?: unknown
  ): Promise<void>;
}
```

**Modes**:
- Stateless: `sessionIdGenerator: undefined` (recommended)
- Stateful: `sessionIdGenerator: () => randomUUID()`

**Usage**: Single route handling all requests via `handleRequest()`.

## Proposed Solutions

### Option 1: Change Transport Flag to http-only ⭐ SELECTED

**How it keeps current architecture**:
- ✅ Single HTTP server on port 3030
- ✅ stdio bridge spawns and manages HTTP server
- ✅ HTTP server handles MCP + web viewer
- ✅ CLI → Bridge → HTTP Server flow
- ✅ Uses mcp-remote (no custom bridge)

**What changes**:
- Bridge: `--transport sse-only` → `--transport http-only` (1 line)
- Server: SSEServerTransport → StreamableHTTPServerTransport (~10 lines)
- Dependencies: None (already in SDK)

**Implementation**:

```typescript
// src/cli/bridge.ts (line 18)
const bridge = spawn(mcpRemotePath, [serverUrl, '--allow-http', '--transport', 'http-only'], {
  stdio: 'inherit'
});

// src/server/mcp-handler.ts
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    registerTools(server);
    registerResources(server);
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true
    });
    
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
```

**Why it works**:
- mcp-remote uses StreamableHTTPClientTransport
- Server uses StreamableHTTPServerTransport
- Both sides speak the same protocol
- No protocol translation needed

**Pros**:
- Minimal changes (~10 lines)
- Uses recommended SDK APIs
- Maintains exact architecture
- Clean stateless design
- No deprecated code
- No external dependencies

**Cons**:
- No fallback if issues arise
- All-or-nothing migration

**Complexity**: Low (1/10)
**Risk**: Low (2/10)
**Maintainability**: High (10/10)

**Critical Self-Critique**:
- What if http-only has undiscovered issues? → Test thoroughly before merging
- No gradual migration path? → Not needed if we test properly
- Single point of failure? → Same as current architecture

### Option 2: Use http-first with Dual Transport Support

**How it keeps current architecture**:
- ✅ Single HTTP server on port 3030
- ✅ stdio bridge spawns and manages HTTP server
- ✅ CLI → Bridge → HTTP Server flow

**What changes**:
- Bridge: `--transport http-first` (tries HTTP, falls back to SSE)
- Server: Support BOTH SSEServerTransport AND StreamableHTTPServerTransport
- Two route sets: `/mcp` (SSE) and `/mcp` (StreamableHTTP)

**Implementation**: ~50 lines (dual transport handling)

**Pros**:
- Fallback to SSE if HTTP fails
- Gradual migration path
- Safety net

**Cons**:
- Maintains deprecated code
- High complexity (two protocols)
- Two code paths to maintain
- Confusing for debugging

**Complexity**: High (8/10)
**Risk**: Medium (5/10)
**Maintainability**: Low (4/10)

**Critical Self-Critique**:
- This is a half-measure that adds complexity without clear benefit
- If http-only works, this is unnecessary overhead
- If http-only doesn't work, we need to understand why, not add fallback
- Maintaining two protocols defeats the purpose of migration
- **Rejected**: Unnecessary complexity

### Option 3: Custom Minimal Bridge (~50 lines)

**How it keeps current architecture**:
- ✅ Single HTTP server on port 3030
- ✅ stdio bridge spawns and manages HTTP server
- ✅ CLI → Bridge → HTTP Server flow

**What changes**:
- Remove mcp-remote dependency
- Create custom bridge using SDK's StreamableHTTPClientTransport
- Bridge reads stdin, forwards to HTTP, writes responses to stdout

**Implementation**: ~50 lines new code

```typescript
// src/cli/custom-bridge.ts
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const httpTransport = new StreamableHTTPClientTransport(serverUrl);
const stdioTransport = new StdioServerTransport();

// Forward messages between transports
httpTransport.onmessage = (msg) => stdioTransport.send(msg);
stdioTransport.onmessage = (msg) => httpTransport.send(msg);

await httpTransport.start();
await stdioTransport.start();
```

**Pros**:
- No external dependency on mcp-remote
- Full control over bridge behavior
- Uses recommended SDK APIs

**Cons**:
- Reinvents what mcp-remote already does
- More code to maintain
- mcp-remote handles auth, retries, error handling, OAuth
- Our custom bridge doesn't

**Complexity**: Medium (6/10)
**Risk**: Medium (5/10)
**Maintainability**: Medium (6/10)

**Critical Self-Critique**:
- Why reinvent the wheel when mcp-remote already supports http-only?
- This adds maintenance burden for no benefit
- mcp-remote is battle-tested with 67 versions, our custom bridge isn't
- This is engineering for engineering's sake
- We'd lose OAuth support, retry logic, error handling
- **Rejected**: Unnecessary reinvention

### Option 4: Protocol Adapter Layer

**How it keeps current architecture**:
- ⚠️ Adds extra layer between bridge and server
- Single HTTP server on port 3030
- stdio bridge spawns adapter, adapter spawns HTTP server

**What changes**:
- Keep `--transport sse-only` in bridge
- Add adapter process between mcp-remote and server
- Adapter translates SSE protocol ↔ StreamableHTTP protocol
- Flow: CLI → bridge → mcp-remote (SSE) → adapter → HTTP server (StreamableHTTP)

**Implementation**: ~100 lines (protocol translation)

**Pros**:
- No changes to mcp-remote usage
- Server uses StreamableHTTP

**Cons**:
- High complexity (protocol translation)
- Extra process/layer
- Translating between protocols is error-prone
- Adds latency
- Debugging nightmare (three layers)

**Complexity**: Very High (9/10)
**Risk**: High (8/10)
**Maintainability**: Very Low (2/10)

**Critical Self-Critique**:
- This is absurd - why translate when both sides support the same protocol?
- Adds complexity for no reason
- Maintenance nightmare
- Defeats the purpose of using standard protocols
- Performance overhead
- **Rejected**: Absurdly complex

### Option 5: Test-First Validation

**How it keeps current architecture**:
- Same as Option 1

**What changes**:
- Test with `--transport http-only` first (manual validation)
- If successful, migrate server
- If issues found, document and explore alternatives

**Pros**:
- Evidence-based approach
- Low risk
- Validates assumptions

**Cons**:
- Takes more time
- Not really a distinct design

**Complexity**: Low (1/10)
**Risk**: Very Low (1/10)
**Maintainability**: High (10/10)

**Critical Self-Critique**:
- This is just Option 1 with extra steps
- The research already shows http-only should work
- Testing is good practice, but this isn't a distinct "design"
- **Merged into Option 1**: Test thoroughly as part of implementation

## Evaluation Matrix

| Criteria | Opt 1 | Opt 2 | Opt 3 | Opt 4 | Opt 5 |
|----------|-------|-------|-------|-------|-------|
| Maintains architecture | 10/10 | 10/10 | 10/10 | 9/10 | 10/10 |
| Cleanliness | 10/10 | 5/10 | 7/10 | 2/10 | 10/10 |
| Maintainability | 10/10 | 4/10 | 6/10 | 2/10 | 10/10 |
| Complexity (lower better) | 10/10 | 4/10 | 6/10 | 1/10 | 9/10 |
| Risk (lower better) | 8/10 | 7/10 | 5/10 | 3/10 | 9/10 |
| **TOTAL** | **48/50** | **30/50** | **34/50** | **17/50** | **48/50** |

## Decision

**Selected**: Option 1 - Change transport flag to http-only and migrate server to StreamableHTTPServerTransport

**Rationale**:

1. **Maintains exact architecture**: Single HTTP server + bridge pattern unchanged
2. **Simplest solution**: Just change the transport flag (~10 lines)
3. **Uses mcp-remote's built-in support**: No custom code needed
4. **Fixes root cause**: Previous failure was protocol mismatch, this aligns both sides
5. **Uses recommended APIs**: StreamableHTTPServerTransport is the non-deprecated option
6. **Clean stateless design**: No session management needed
7. **No external dependencies**: Everything already in SDK

**Why this maintains architecture**:
- ✅ Single HTTP server on port 3030 (unchanged)
- ✅ stdio bridge spawns and manages server (unchanged)
- ✅ HTTP server handles MCP + web viewer (unchanged)
- ✅ CLI → Bridge → HTTP Server flow (unchanged)
- ✅ Uses mcp-remote for bridge (unchanged)
- ✅ Only changes: protocol version (SSE → StreamableHTTP)

**Trade-offs Accepted**:
- No fallback to SSE (acceptable - we're migrating away from deprecated API)
- All-or-nothing migration (acceptable - changes are minimal and testable)

## Implementation Plan

### Phase 1: Update Bridge (5 minutes)

**File**: `src/cli/bridge.ts`

```typescript
// Line 18: Change transport flag
const bridge = spawn(mcpRemotePath, [serverUrl, '--allow-http', '--transport', 'http-only'], {
  stdio: 'inherit'
});
```

### Phase 2: Update Server (15 minutes)

**File**: `src/server/mcp-handler.ts`

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Remove sessions Map (no longer needed)

export function registerMcpHandler(app: FastifyInstance) {
  // Single route for all requests
  app.all('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    registerTools(server);
    registerResources(server);
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true
    });
    
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
```

**Changes**:
- Remove `sessions` Map (line 12)
- Remove GET `/mcp` route (line 15-28)
- Remove POST `/mcp/message` route (line 30-45)
- Add single `app.all('/mcp', ...)` route
- Use StreamableHTTPServerTransport instead of SSEServerTransport
- Use stateless mode (`sessionIdGenerator: undefined`)

### Phase 3: Testing (30 minutes)

**Test scenarios**:

1. **stdio bridge mode**:
   ```bash
   pnpm start
   # Test with Claude Desktop or other MCP client
   ```

2. **Direct HTTP mode**:
   ```bash
   pnpm dev
   # Test web viewer at http://localhost:3030
   ```

3. **Integration tests**:
   ```bash
   pnpm test
   # Verify all 60 tests pass
   ```

4. **Manual validation**:
   - Create task via stdio
   - List tasks via stdio
   - Update task via stdio
   - View tasks in web viewer
   - Verify no errors in logs

### Phase 4: Documentation (10 minutes)

**Update README.md**:
- Note migration to StreamableHTTPServerTransport
- Update any protocol-specific documentation
- Add note about mcp-remote transport flag

## Consequences

### Positive

- ✅ Uses recommended non-deprecated API
- ✅ Maintains exact architecture user likes
- ✅ Minimal code changes (~10 lines)
- ✅ Clean stateless design
- ✅ No external dependencies
- ✅ Future-proof (StreamableHTTP is the standard)
- ✅ Fixes ADR-0023 failure root cause

### Negative

- ⚠️ No fallback to SSE (acceptable - migrating away from deprecated API)
- ⚠️ All-or-nothing migration (acceptable - changes are minimal)

### Risks

**Risk 1**: Undiscovered issues with http-only transport
- **Likelihood**: Low (mcp-remote has 67 versions, http-only is well-tested)
- **Mitigation**: Thorough testing before merging
- **Fallback**: Can revert to sse-only if critical issues found

**Risk 2**: Breaking changes for users
- **Likelihood**: None (architecture unchanged, protocol is internal)
- **Mitigation**: N/A - no user-facing changes

**Risk 3**: Integration test failures
- **Likelihood**: Low (protocol change is transparent to tests)
- **Mitigation**: Run full test suite, fix any issues

## Key Insights

1. **Previous failure root cause**: ADR-0023 changed server but not client → protocol mismatch
2. **mcp-remote already supports StreamableHTTP**: Just need to use the right flag
3. **Architecture can stay the same**: Only protocol version changes
4. **Simplicity wins**: Minimal changes, maximum benefit
5. **Research pays off**: Deep dive into mcp-remote source revealed the solution

## References

- [MCP SDK StreamableHTTPServerTransport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/server/streamableHttp.ts)
- [mcp-remote source code](https://github.com/geelen/mcp-remote)
- [ADR-0023: Rejected Migration Attempt](./0023-migrate-to-streamable-http-transport.md)
- [ADR-0024: Rejected Dual-Mode Server](./0024-dual-mode-server-for-streamable-http.md)
