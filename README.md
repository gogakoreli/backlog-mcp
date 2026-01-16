# backlog-mcp

Minimal task backlog MCP server for Claude and AI agents.

> **Quick start**: Tell your LLM: `Add backlog-mcp to .mcp.json and use it to track tasks`

## Web Viewer

Start the server and open `http://localhost:3030` for a visual task browser.

```bash
npm run dev  # Starts MCP server + web viewer with hot reload
```

Features:
- Split pane layout with task list and detail view
- Filter by Active/Completed/All
- GitHub-style markdown rendering
- Click file path to open in editor
- URL state persistence

## Task Schema

Tasks are stored as individual markdown files with YAML frontmatter:

```markdown
---
id: TASK-0001
title: Fix bug in authentication
status: open
created_at: '2024-01-10T10:00:00Z'
updated_at: '2024-01-10T10:00:00Z'
blocked_reason: Waiting for API access
evidence:
  - Fixed in CR-12345
  - Validated in beta
---

## Description

The authentication flow has an issue where...

## Context

This came from Slack thread: https://...
```

**Status values:** `open`, `in_progress`, `blocked`, `done`, `cancelled`

## MCP Tool

Single unified tool with action parameter:

```
backlog action="list"                         # List all active tasks
backlog action="list" summary=true            # Get counts by status
backlog action="list" status=["open"]         # Filter by status
backlog action="list" status=["done"]         # Show completed tasks (last 10)
backlog action="list" status=["done"] archived_limit=20  # Show last 20 completed
backlog action="get" id="TASK-0001"           # Get task details
backlog action="create" title="Fix bug"       # Create task
backlog action="update" id="TASK-0001" set_status="done"  # Update task
```

## Installation

Add to your MCP config (`.mcp.json` or Claude Desktop config):

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

Or build from source:

```bash
git clone https://github.com/gkoreli/backlog-mcp.git
cd backlog-mcp
npm install && npm run build
npm start
```

## Storage

- Default: `data/tasks/` and `data/archive/` (local to project)
- Global: Set `BACKLOG_DATA_DIR=~/.backlog` for cross-project persistence
- Completed/cancelled tasks auto-archive to `archive/`

## License

MIT
