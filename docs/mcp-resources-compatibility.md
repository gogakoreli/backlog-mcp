# MCP Resources Protocol Support

## Current Status

backlog-mcp implements the MCP resources protocol via `registerResource()`. Resources are exposed at:

- `mcp://backlog/tasks/TASK-0001.md` - Task markdown files
- `mcp://backlog/resources/TASK-0001/adr.md` - Task-attached resources
- `mcp://backlog/resources/investigation.md` - Standalone resources

## URI Design

Pure catch-all: `mcp://backlog/{path}` → `{dataDir}/{path}`

No special suffixes like `/description` or `/file` - just direct path mapping.

## Modifying Resources

Use `write_resource` tool with operations:
- `str_replace` - Replace exact string match
- `append` - Add content to end
- `prepend` - Add content to beginning
- `insert` - Insert at specific line
- `delete` - Remove content
