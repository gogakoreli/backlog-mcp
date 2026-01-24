# ADR 0009: Add read_resource Tool for Remote Deployment

**Status**: Proposed  
**Date**: 2026-01-23  
**Deciders**: Product team  
**Context**: Remote MCP server deployment with Kiro CLI

## Context

backlog-mcp correctly implements the MCP resources protocol via `registerResource()`, exposing:
- `mcp://backlog/tasks/{taskId}/file` - Task markdown files
- `mcp://backlog/resources/{taskId}/{filename}` - Task-attached resources
- `mcp://backlog/resources/{path}` - Repository resources

This works perfectly with MCP-compliant clients (MCP Inspector, Claude Desktop) that support the `resources/read` protocol.

### The Problem

**Local deployment**: Agents can use `fs_read` tool to directly access files on the local filesystem.

**Remote deployment**: When backlog-mcp runs as a remote HTTP server:
1. Agents cannot use `fs_read` to access the remote server's filesystem
2. Kiro CLI (our primary client) does not support the MCP resources protocol
3. Agents have no way to read task-attached resources (ADRs, design docs, etc.)

### MCP Resources Protocol Design

Per [MCP specification](https://modelcontextprotocol.info/docs/concepts/resources/):

> Resources are designed to be **application-controlled**, meaning that the client application can decide how and when they should be used.

Resources are intended for:
- User-selected context injection (e.g., "attach this ADR to the conversation")
- Client-controlled context loading
- NOT for agent-initiated programmatic access

However, in practice:
- Kiro CLI doesn't support resources protocol at all
- We need agents to read resources programmatically for remote deployment
- The "proper" MCP pattern doesn't work with our constraints

## Decision

Add `read_resource` tool as a **pragmatic workaround** for Kiro CLI's lack of resources protocol support in remote deployments.

```typescript
server.registerTool(
  'read_resource',
  {
    description: 'Read content from MCP resources (task-attached ADRs, design docs, etc.). Use for remote server access.',
    inputSchema: z.object({
      uri: z.string().describe('Resource URI (e.g., mcp://backlog/resources/TASK-0001/adr-001.md)'),
    }),
  },
  async ({ uri }) => {
    const { content, mimeType } = readMcpResource(uri);
    return { content: [{ type: 'text' as const, text: content }] };
  }
);
```

## Consequences

### Positive

- ✅ Enables remote deployment with Kiro CLI
- ✅ Agents can read task-attached resources programmatically
- ✅ Reuses existing `readMcpResource()` implementation
- ✅ Works alongside proper MCP resources protocol (for compliant clients)
- ✅ Minimal code (~15 lines)

### Negative

- ❌ Violates MCP design intent (resources should be application-controlled, not model-controlled)
- ❌ Duplicates functionality (resources protocol already exposes this data)
- ❌ Kiro-specific workaround that wouldn't be needed with compliant clients
- ❌ Agents can now programmatically read resources (not the intended pattern)

### Neutral

- 🔄 When Kiro adds resources protocol support, this tool becomes redundant but harmless
- 🔄 Other MCP clients can ignore this tool and use proper resources protocol
- 🔄 Local deployments can use either `fs_read` or `read_resource` tool

## Alternatives Considered

### 1. Wait for Kiro to implement resources protocol
**Rejected**: Blocks remote deployment indefinitely. We need a solution now.

### 2. Use a different MCP client
**Rejected**: Stuck with Kiro CLI for current workflow.

### 3. Expose resources via HTTP endpoint
**Rejected**: Breaks MCP abstraction, requires custom client code.

### 4. Keep resources protocol only, document limitation
**Rejected**: Makes remote deployment impossible with Kiro CLI.

## Implementation Notes

- Tool uses same `readMcpResource()` function as resources protocol handlers
- Single source of truth for resource reading logic
- Tool is optional - clients supporting resources protocol don't need it
- Error handling matches resources protocol behavior

## Future

When Kiro CLI adds MCP resources protocol support:
- This tool becomes redundant but remains for backward compatibility
- Agents can use either approach (tool or protocol)
- Consider deprecation notice in future major version

## References

- [MCP Resources Specification](https://modelcontextprotocol.info/docs/concepts/resources/)
- [ADR 0008: Task-Attached Resources](./0008-task-attached-resources.md)
- Kiro CLI documentation (no resources protocol support as of 2026-01-23)
