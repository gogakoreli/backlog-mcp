# 0024. Dual-Mode Server Architecture for StreamableHTTPServerTransport

**Date**: 2026-01-25
**Status**: Proposed
**Backlog Item**: TASK-0090

## Context

ADR-0023 rejected StreamableHTTPServerTransport migration due to mcp-remote incompatibility. The previous agent concluded that migration was "impossible" because mcp-remote only supports the legacy SSE protocol.

**This ADR challenges that conclusion and proposes alternative solutions.**

### The Problem

We want to use **StreamableHTTPServerTransport** (recommended by MCP SDK) but the previous attempt failed because:
1. mcp-remote (our stdio bridge) only supports SSE protocol
2. StreamableHTTPServerTransport uses a different protocol
3. Migration would break stdio bridge functionality

### Research Findings

**Critical Discovery**: The MCP SDK provides ALL the primitives needed to solve this problem:

1. **StdioServerTransport** (`@modelcontextprotocol/sdk/server/stdio.js`)
   - Server-side stdio transport
   - Reads from stdin, writes to stdout
   - No HTTP involved

2. **StreamableHTTPClientTransport** (`@modelcontextprotocol/sdk/client/streamableHttp.js`)
   - Client-side HTTP transport
   - Supports the new Streamable HTTP protocol
   - Can be used to build custom bridges

3. **Dual Transport Example** (`examples/server/sseAndStreamableHttpCompatibleServer.js`)
   - SDK provides example of supporting both SSE and StreamableHTTP
   - Shows how to maintain backward compatibility

**Key Insight**: We don't need mcp-remote at all. The SDK provides everything we need to support both stdio and HTTP modes natively.

## Proposed Solutions

### Option 1: Dual-Mode Server (stdio + HTTP)

**Description**: Support two server modes with different transports:
- **HTTP mode**: Uses StreamableHTTPServerTransport (for web viewer, direct HTTP clients)
- **stdio mode**: Uses StdioServerTransport (for LLM clients like Claude, ChatGPT)

**Architecture**:
```typescript
// HTTP mode (default): backlog-mcp serve
const server = new McpServer({ name: 'backlog-mcp', version });
registerTools(server);
registerResources(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless
  enableJsonResponse: true,
});

await server.connect(transport);
await transport.handleRequest(req, res);

// stdio mode: backlog-mcp --stdio
const server = new McpServer({ name: 'backlog-mcp', version });
registerTools(server);
registerResources(server);

const transport = new StdioServerTransport();
await server.connect(transport);
await transport.start();
```

**CLI Interface**:
```bash
# HTTP mode (web viewer + direct HTTP clients)
backlog-mcp serve          # Default, port 3030

# stdio mode (LLM clients)
backlog-mcp --stdio        # For MCP client configs
```

**MCP Client Configuration**:
```json
{
  "mcpServers": {
    "backlog": {
      "command": "backlog-mcp",
      "args": ["--stdio"]
    }
  }
}
```

**Implementation**:
```typescript
// src/cli/index.ts
if (args.includes('--stdio')) {
  await startStdioServer();
} else {
  await startHttpServer();
}

// src/server/stdio-server.ts (NEW - ~30 lines)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index-resources.js';

export async function startStdioServer() {
  const server = new McpServer({
    name: 'backlog-mcp',
    version: pkg.version
  });

  registerTools(server);
  registerResources(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  await transport.start();
}

// src/server/mcp-handler.ts (MODIFIED - swap SSE for StreamableHTTP)
export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    const server = new McpServer({
      name: 'backlog-mcp',
      version: pkg.version
    });

    registerTools(server);
    registerResources(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
      enableJsonResponse: true,
    });

    reply.raw.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
```

**Pros**:
- ✅ Uses recommended SDK transports (no deprecated APIs)
- ✅ No dependency on mcp-remote
- ✅ Clean architecture (two simple modes)
- ✅ Stateless HTTP mode (serverless-ready)
- ✅ Standard MCP pattern (many servers support both modes)
- ✅ Web viewer works in HTTP mode
- ✅ stdio mode works with all LLM clients
- ✅ No extra processes (no bridge needed)
- ✅ Minimal code (~30 lines for stdio mode)

**Cons**:
- ⚠️ Two code paths to maintain (but both are simple)
- ⚠️ Users need to know which mode to use (but this is standard)
- ⚠️ Web viewer doesn't work in stdio mode (expected behavior)

**Implementation Complexity**: Low (2-3 hours)
- Add stdio-server.ts (~30 lines)
- Update CLI to support --stdio flag (~10 lines)
- Swap SSE for StreamableHTTP in mcp-handler.ts (~5 line change)
- Update README with both modes
- Test both modes

**Risk**: Low
- Both transports are official SDK implementations
- Pattern is proven (many MCP servers use this approach)
- No breaking changes (HTTP mode remains default)

**Critical Self-Critique**:
- Is maintaining two code paths worth it? YES - they're both simple and use SDK transports
- Will users be confused? NO - this is standard in MCP ecosystem
- Could we just use stdio mode only? NO - we'd lose web viewer functionality
- Is this over-engineering? NO - this is the recommended pattern from SDK

---

### Option 2: Custom stdio Bridge with StreamableHTTPClient

**Description**: Build our own stdio bridge using StreamableHTTPClientTransport, replacing mcp-remote.

**Architecture**:
```
LLM Client (stdio) → Custom Bridge → StreamableHTTPClientTransport → HTTP Server (StreamableHTTPServerTransport)
```

**Implementation**:
```typescript
// src/cli/bridge-streamable.ts (NEW - ~80 lines)
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInterface } from 'node:readline';

async function runBridge(serverUrl: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl)
  );

  // Forward messages from stdin to HTTP
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  transport.onmessage = (message) => {
    console.log(JSON.stringify(message));
  };

  transport.onerror = (error) => {
    console.error('Bridge error:', error);
    process.exit(1);
  };

  await transport.start();

  readline.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      await transport.send(message);
    } catch (error) {
      console.error('Invalid JSON:', error);
    }
  });
}

const serverUrl = process.env.BACKLOG_SERVER_URL || 'http://localhost:3030/mcp';
runBridge(serverUrl);
```

**Pros**:
- ✅ Uses recommended SDK transports
- ✅ No dependency on mcp-remote
- ✅ Single HTTP server mode
- ✅ Web viewer still works
- ✅ Familiar deployment model (HTTP server + bridge)

**Cons**:
- ❌ Extra process (bridge)
- ❌ More complex deployment
- ❌ Bridge needs to be maintained
- ❌ Slightly more code (~80 lines vs ~30 lines)

**Implementation Complexity**: Medium (4-5 hours)
- Build custom bridge (~80 lines)
- Update CLI to use new bridge
- Test bridge with LLM clients
- Handle edge cases (reconnection, errors)

**Risk**: Medium
- Custom code (not just SDK usage)
- Need to handle reconnection logic
- Potential for bugs in bridge implementation

**Critical Self-Critique**:
- Why build a bridge when SDK provides StdioServerTransport? No good reason
- Is this simpler than Option 1? NO - it's more complex
- Does it provide any benefits over Option 1? NO - just maintains current deployment model
- Is current deployment model better? NO - dual-mode is cleaner

---

### Option 3: Dual Transport Support (SSE + StreamableHTTP)

**Description**: Support both SSE and StreamableHTTP on the same server, maintaining backward compatibility with mcp-remote.

**Architecture**:
```typescript
// /mcp - StreamableHTTP endpoint
app.all('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({...});
  // Handle StreamableHTTP requests
});

// /sse - Legacy SSE endpoint (for mcp-remote)
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res.raw);
  // Handle SSE connections
});

app.post('/messages', async (req, res) => {
  // Handle SSE messages
});
```

**Pros**:
- ✅ Backward compatible with mcp-remote
- ✅ Gradual migration path
- ✅ Single server mode

**Cons**:
- ❌ Still uses deprecated SSEServerTransport
- ❌ More complex code (two transport implementations)
- ❌ Doesn't solve the core problem (still using deprecated API)
- ❌ Higher maintenance burden
- ❌ Confusing for users (which endpoint to use?)

**Implementation Complexity**: High (6-8 hours)
- Implement both transports
- Manage two session maps
- Handle transport-specific logic
- Test both protocols
- Document which clients use which endpoint

**Risk**: High
- Complex code with two protocols
- Still using deprecated API
- Potential for bugs in dual-transport logic
- Unclear migration path (when to remove SSE?)

**Critical Self-Critique**:
- Does this solve the problem? NO - we're still using deprecated SSE
- Is this a long-term solution? NO - SSE will be removed from SDK eventually
- Is the complexity worth it? NO - we're adding complexity to keep deprecated code
- Why would we choose this? Only if we absolutely need mcp-remote compatibility
- Do we need mcp-remote? NO - SDK provides StdioServerTransport

---

### Option 4: Fork and Patch mcp-remote

**Description**: Fork mcp-remote, add StreamableHTTPClientTransport support, maintain our own version.

**Pros**:
- ✅ Maintains current architecture
- ✅ Could contribute back upstream

**Cons**:
- ❌ Maintenance burden (need to keep fork updated)
- ❌ Duplicates SDK functionality
- ❌ Delays our migration (need to implement in mcp-remote first)
- ❌ Not sustainable long-term

**Implementation Complexity**: Very High (2-3 days)
- Fork mcp-remote
- Understand mcp-remote codebase
- Implement StreamableHTTP support
- Test thoroughly
- Maintain fork

**Risk**: Very High
- Long-term maintenance burden
- Upstream changes need to be merged
- May not be accepted upstream
- Delays our migration

**Critical Self-Critique**:
- Is this worth the effort? NO - SDK already provides what we need
- Should we maintain a fork? NO - unnecessary maintenance burden
- Could we contribute upstream? MAYBE - but why? SDK has better solution
- Is this solving the right problem? NO - we're working around a non-problem

---

### Option 5: Wait for mcp-remote Update

**Description**: Keep using SSEServerTransport until mcp-remote adds StreamableHTTP support.

**Pros**:
- ✅ No work required
- ✅ No risk

**Cons**:
- ❌ No progress
- ❌ Using deprecated API indefinitely
- ❌ Dependent on external maintainer
- ❌ May never happen

**Implementation Complexity**: None

**Risk**: High
- SSE may be removed from SDK before mcp-remote updates
- No control over timeline
- Technical debt accumulates

**Critical Self-Critique**:
- Is this acceptable? NO - we have better options
- Will mcp-remote be updated? UNKNOWN - no timeline
- Can we wait? NO - we should migrate to recommended APIs
- Is this the easy way out? YES - but not the right way

## Evaluation Matrix

| Criteria | Option 1: Dual-Mode | Option 2: Custom Bridge | Option 3: Dual Transport | Option 4: Fork mcp-remote | Option 5: Wait |
|----------|---------------------|-------------------------|--------------------------|---------------------------|----------------|
| **Cleanliness** | 10/10 | 7/10 | 4/10 | 3/10 | 2/10 |
| **Maintainability** | 10/10 | 7/10 | 4/10 | 2/10 | 3/10 |
| **Complexity** | 9/10 (low) | 7/10 (medium) | 4/10 (high) | 2/10 (very high) | 10/10 (none) |
| **Risk** | 9/10 (low) | 7/10 (medium) | 5/10 (high) | 3/10 (very high) | 3/10 (high) |
| **Future-proof** | 10/10 | 8/10 | 3/10 | 4/10 | 1/10 |
| **TOTAL** | **48/50** | **36/50** | **20/50** | **14/50** | **19/50** |

## Decision

**Selected**: Option 1 - Dual-Mode Server (stdio + HTTP)

**Rationale**:

1. **Uses recommended SDK APIs**: Both StdioServerTransport and StreamableHTTPServerTransport are official, non-deprecated SDK implementations.

2. **Cleanest architecture**: No bridges, no deprecated code, no external dependencies. Just two simple server modes using SDK transports.

3. **Standard MCP pattern**: Many MCP servers support both stdio and HTTP modes. This is the expected pattern in the ecosystem.

4. **Minimal complexity**: ~30 lines for stdio mode, ~5 line change for HTTP mode. Total implementation: 2-3 hours.

5. **No breaking changes**: HTTP mode remains default (web viewer works), stdio mode is opt-in via `--stdio` flag.

6. **Future-proof**: Both transports are actively maintained by MCP SDK team. No risk of deprecation.

7. **Eliminates mcp-remote dependency**: We don't need mcp-remote anymore. SDK provides everything we need.

**Why not Option 2 (Custom Bridge)?**
- More complex (80 lines vs 30 lines)
- Extra process to manage
- Solves a problem that doesn't exist (SDK already has StdioServerTransport)
- No benefits over Option 1

**Why not Option 3 (Dual Transport)?**
- Still uses deprecated SSEServerTransport
- Doesn't solve the core problem
- High complexity for no long-term benefit
- Confusing for users

**Why not Option 4 (Fork mcp-remote)?**
- Massive maintenance burden
- Duplicates SDK functionality
- Not sustainable

**Why not Option 5 (Wait)?**
- No progress
- Dependent on external maintainer
- We have better solutions available now

**Trade-offs Accepted**:
- Two code paths to maintain (but both are simple and use SDK transports)
- Users need to know which mode to use (but this is standard in MCP ecosystem)
- Web viewer doesn't work in stdio mode (expected behavior, not a limitation)

## Consequences

**Positive**:
- ✅ Clean, maintainable architecture
- ✅ Uses recommended SDK APIs (no deprecated code)
- ✅ No dependency on mcp-remote
- ✅ Stateless HTTP mode (serverless-ready)
- ✅ Standard MCP pattern (familiar to users)
- ✅ Web viewer continues to work
- ✅ stdio mode works with all LLM clients
- ✅ Minimal implementation effort
- ✅ Low risk
- ✅ Future-proof

**Negative**:
- ⚠️ Two code paths (but both simple)
- ⚠️ Users need to choose mode (but standard pattern)

**Risks**:
- **User confusion about modes**: Mitigation: Clear documentation, sensible defaults (HTTP mode default)
- **Bugs in stdio mode**: Mitigation: Use official SDK transport, thorough testing
- **Breaking changes in SDK**: Mitigation: Both transports are stable, actively maintained

## Implementation Plan

### Phase 1: Add stdio Mode (2 hours)

1. Create `src/server/stdio-server.ts`:
   ```typescript
   import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
   import { registerTools } from '../tools/index.js';
   import { registerResources } from '../resources/index-resources.js';
   import { readFileSync } from 'node:fs';
   import { join, dirname } from 'node:path';
   import { fileURLToPath } from 'node:url';

   const __dirname = dirname(fileURLToPath(import.meta.url));
   const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

   export async function startStdioServer() {
     const server = new McpServer({
       name: 'backlog-mcp',
       version: pkg.version
     });

     registerTools(server);
     registerResources(server);

     const transport = new StdioServerTransport();
     await server.connect(transport);
     await transport.start();
   }
   ```

2. Update `src/cli/index.ts` to support `--stdio` flag
3. Test stdio mode with MCP client

### Phase 2: Migrate HTTP Mode to StreamableHTTP (1 hour)

1. Update `src/server/mcp-handler.ts`:
   - Replace `SSEServerTransport` with `StreamableHTTPServerTransport`
   - Remove session Map
   - Use stateless mode
   - Single route: `app.all('/mcp', ...)`

2. Remove `src/cli/bridge.ts` (no longer needed)
3. Remove mcp-remote dependency from package.json

### Phase 3: Testing (1 hour)

1. Test HTTP mode:
   - Web viewer works
   - Direct HTTP clients work
   - Stateless operation verified

2. Test stdio mode:
   - Works with Claude Desktop
   - Works with other MCP clients
   - Tool calls work
   - Resource access works

### Phase 4: Documentation (30 minutes)

1. Update README.md:
   ```markdown
   ## Usage

   ### HTTP Mode (Web Viewer + Direct HTTP Clients)

   ```bash
   backlog-mcp serve
   ```

   Open http://localhost:3030 in your browser.

   ### stdio Mode (LLM Clients)

   Add to your MCP client configuration:

   ```json
   {
     "mcpServers": {
       "backlog": {
         "command": "backlog-mcp",
         "args": ["--stdio"]
       }
     }
   }
   ```
   ```

2. Update ADR-0023 status to "Superseded by ADR-0024"
3. Update ADR README

## Next Steps

1. Implement Phase 1 (stdio mode)
2. Test stdio mode thoroughly
3. Implement Phase 2 (migrate HTTP to StreamableHTTP)
4. Test HTTP mode thoroughly
5. Update documentation
6. Update backlog task TASK-0090 to "done"
7. Create artifact.md with implementation details

## Related ADRs

- **ADR-0023**: Rejected StreamableHTTP migration (superseded by this ADR)
- **ADR-0022**: Current SSEServerTransport implementation (will be replaced)
- **ADR-0014**: stdio-HTTP bridge implementation (will be replaced with native stdio mode)

## References

- [MCP SDK StdioServerTransport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/server/stdio.ts)
- [MCP SDK StreamableHTTPServerTransport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/server/streamableHttp.ts)
- [MCP SDK Dual Transport Example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/sseAndStreamableHttpCompatibleServer.ts)
