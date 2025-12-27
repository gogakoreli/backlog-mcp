# backlog-mcp

MCP server for task tracking. Use it to manage your backlog during this session.

## Quick Start

The backlog MCP tools are already available if configured. Use them directly:

```
backlog_list          # List tasks (use summary=true for counts)
backlog_create        # Create task with title and optional description
backlog_get           # Get task by ID (TASK-0001)
backlog_update        # Update status, title, description, evidence
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
