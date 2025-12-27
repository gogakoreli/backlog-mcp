# backlog-mcp

MCP server for task tracking. Use it to manage your backlog during this session.

## Quick Start

The backlog tool is already available if configured. Use it directly:

```
backlog action="list"                              # List tasks
backlog action="list" summary=true                 # Get counts
backlog action="get" id="TASK-0001"                # Get task
backlog action="create" title="..."                # Create task
backlog action="update" id="..." set_status="done" # Update task
```

## Task Statuses

`open` → `in_progress` → `blocked` → `done` / `cancelled`

Tasks marked `done` or `cancelled` auto-archive to `data/archive.json`.

## Install (if not configured)

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": ["-y", "backlog-mcp"]
    }
  }
}
```

## Build Commands

```bash
npm install      # Install dependencies
npm run build    # Compile TypeScript
npm start        # Run MCP server
npm test         # Run tests
```
