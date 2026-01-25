# 0022. Fix Missing /mcp/message POST Route

**Date**: 2026-01-25
**Status**: Accepted
**Backlog Item**: TASK-0090

## Context

The Fastify migration (ADR-0020) introduced a critical bug in the MCP SSE transport implementation. The HTTP server registers only a `/mcp` route, but the `SSEServerTransport` tells clients to POST messages to `/mcp/message`. This causes all MCP message POSTs to return 404 errors, breaking the MCP protocol over HTTP.

### Current State

**File**: `src/server/mcp-handler.ts`

```typescript
export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    if (request.method === 'GET') {
      // Creates SSEServerTransport with endpoint '/mcp/message'
      const transport = new SSEServerTransport('/mcp/message', reply.raw);
      // ... SSE connection established
    }
    
    if (request.method === 'POST') {
      // This code is UNREACHABLE because POST goes to /mcp/message, not /mcp
      const sessionId = url.searchParams.get('sessionId');
      // ...
    }
  });
}
```

**What happens:**
1. Client connects via `GET /mcp` → ✅ Works, returns SSE stream with sessionId
2. SSE stream tells client to POST to `/mcp/message?sessionId=...`
3. Client sends `POST /mcp/message?sessionId=...` → ❌ **404 Not Found**

### Research Findings

1. **StreamableHTTPServerTransport not available**: The MCP SDK v1.25.1 does not include `StreamableHTTPServerTransport`, so we cannot use the stateless single-route approach
2. **SSE protocol convention**: SSE transport typically uses separate endpoints for GET (stream) and POST (messages)
3. **stdio bridge works**: The stdio bridge (using mcp-remote) works correctly because it uses the SSE transport properly
4. **Direct HTTP clients broken**: Any MCP client connecting directly via HTTP SSE (ChatGPT, Claude Desktop) cannot send messages

## Proposed Solutions

### Option 1: Add Separate /mcp/message POST Route (SELECTED)

**Description**: Register a dedicated POST route for `/mcp/message` that handles MCP messages using the session Map.

**Implementation**:
```typescript
export function registerMcpHandler(app: FastifyInstance) {
  // GET /mcp - Establish SSE connection
  app.get('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    registerTools(server);
    registerResources(server);
    
    const transport = new SSEServerTransport('/mcp/message', reply.raw);
    sessions.set(transport.sessionId, transport);
    transport.onclose = () => sessions.delete(transport.sessionId);
    
    await server.connect(transport);
    return reply;
  });
  
  // POST /mcp/message - Handle MCP messages
  app.post('/mcp/message', async (request, reply) => {
    const sessionId = request.query.sessionId as string;
    
    if (!sessionId) {
      return reply.code(400).send({ error: 'Missing sessionId' });
    }
    
    const transport = sessions.get(sessionId);
    if (!transport) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    
    // Forward message to transport (API to be verified during implementation)
    await transport.handlePostMessage(request.raw, reply.raw);
    return reply;
  });
}
```

**Pros**:
- ✅ Fixes the bug immediately
- ✅ Minimal code change (low risk)
- ✅ Follows SSE protocol conventions (GET for stream, POST for messages)
- ✅ Works with current MCP SDK version
- ✅ Can be implemented and tested quickly

**Cons**:
- ❌ Still session-based (not serverless-ready)
- ❌ Two routes to maintain
- ❌ Violates ADR-0020 stateless goal

**Implementation Complexity**: Low (15 minutes)

### Option 2: Change SSEServerTransport Endpoint to /mcp

**Description**: Change the SSEServerTransport endpoint parameter to `/mcp` so POST requests go to the same route as GET.

**Implementation**:
```typescript
const transport = new SSEServerTransport('/mcp', reply.raw);
```

**Pros**:
- ✅ Single route
- ✅ Minimal code change

**Cons**:
- ❌ HIGH RISK - might break SSE protocol expectations
- ❌ Unclear if SSE transport supports same endpoint for GET and POST
- ❌ Still session-based
- ❌ Would need extensive testing to verify protocol compliance

**Implementation Complexity**: Low (5 minutes) but HIGH RISK

### Option 3: Refactor to Stateless Transport

**Description**: Wait for MCP SDK to add `StreamableHTTPServerTransport` or implement custom stateless transport.

**Pros**:
- ✅ Addresses architectural issue (stateless)
- ✅ Serverless-ready
- ✅ Aligns with ADR-0020 goals

**Cons**:
- ❌ Requires SDK update or custom implementation
- ❌ High complexity
- ❌ Leaves bug unfixed in the meantime
- ❌ Significant refactoring effort

**Implementation Complexity**: High (4-8 hours)

## Decision

**Selected**: Option 1 - Add Separate /mcp/message POST Route

**Rationale**: 
1. **Fixes critical bug immediately** - Direct HTTP MCP clients can send messages
2. **Low risk** - Follows established SSE protocol conventions
3. **Minimal change** - Only adds one route, doesn't modify existing logic
4. **Pragmatic** - Works with current SDK version
5. **Testable** - Can verify fix quickly with integration tests

**Trade-offs Accepted**:
- **Session-based architecture**: Remains session-based (not serverless-ready). This is acceptable because:
  - The stdio bridge (primary use case) works correctly
  - Serverless deployment is not an immediate requirement
  - Stateless refactor should be addressed separately when SDK supports it
- **Two routes**: Maintaining two routes is acceptable for SSE protocol compliance

## Consequences

**Positive**:
- ✅ MCP protocol over HTTP SSE works correctly
- ✅ Direct HTTP clients (ChatGPT, Claude Desktop) can connect
- ✅ stdio bridge continues to work
- ✅ Low risk of introducing new bugs
- ✅ Can add integration tests to prevent regression

**Negative**:
- ❌ Still session-based (can't deploy to serverless platforms)
- ❌ Two routes to maintain
- ❌ Doesn't address ADR-0020 stateless goal

**Risks**:
- **SSEServerTransport API uncertainty**: Need to verify correct method for handling POST messages (likely `handlePostMessage` or similar). Mitigation: Test during implementation.
- **Session cleanup**: Sessions must be cleaned up properly on disconnect. Mitigation: Already implemented with `transport.onclose` handler.

## Implementation Notes

1. **Verify SSEServerTransport API**: Check if method is `handlePostMessage`, `send`, or something else
2. **Remove unreachable POST handler**: The POST handler in `app.all('/mcp', ...)` is unreachable and should be removed
3. **Add integration tests**: Create tests that verify SSE connection and message handling
4. **Test with real MCP client**: Verify with curl or MCP inspector
5. **Document in README**: Update documentation to reflect two-route architecture

## Future Work

- **ADR-0023 (Future)**: Migrate to stateless transport when SDK supports `StreamableHTTPServerTransport`
- **Integration tests**: Add comprehensive SSE transport tests
- **Performance monitoring**: Monitor session Map size and cleanup
