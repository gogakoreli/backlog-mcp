# MCP Resources Protocol Support

## Current Status

backlog-mcp correctly implements the MCP resources protocol via `registerResource()`. Resources are exposed at:

- `mcp://backlog/tasks/{taskId}/file` - Task markdown files
- `mcp://backlog/resources/{taskId}/{filename}` - Task-attached resources (ADRs, design docs)
- `mcp://backlog/resources/{path}` - Repository resources

## MCP Client Compatibility

### ✅ Fully Supported
- **Claude Desktop** - Can read resources via MCP protocol
- **MCP Inspector** - Can list and read resources
- **Any MCP client implementing resources/read**

### ❌ Not Supported
- **Kiro CLI** - Only supports MCP tools protocol, not resources protocol (as of 2026-01-23)

## Workarounds for Kiro CLI

Since Kiro CLI doesn't support the MCP resources protocol, use direct file access:

```bash
# Instead of reading via MCP protocol
# Use fs_read tool with the actual file path
fs_read path="/Users/username/.backlog/resources/TASK-0001/adr-001.md"
```

## Future

When Kiro CLI adds MCP resources protocol support, agents will be able to:
- List available resources via `resources/list`
- Read resources via `resources/read` 
- Subscribe to resource updates via `resources/subscribe`

No changes needed to backlog-mcp server - it already implements the protocol correctly.

## References

- [MCP Resources Specification](https://modelcontextprotocol.info/docs/concepts/resources/)
- [Kiro CLI Documentation](https://kiro.dev/docs/cli/)
