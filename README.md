# backlog-mcp

Minimal task backlog MCP server. Works with any LLM agent or CLI editor that supports MCP integration (Claude, Kiro, Cursor, Codex, etc).

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

## MCP Tools

```
backlog_list                              # List active tasks (open, in_progress, blocked)
backlog_list status=["done"]              # Show completed tasks
backlog_list counts=true                  # Get counts by status
backlog_list limit=10                     # Limit results

backlog_get id="TASK-0001"                # Get single task
backlog_get id=["TASK-0001","TASK-0002"]  # Batch get multiple tasks

backlog_create title="Fix bug"            # Create task
backlog_create title="Fix bug" description="Details..."

backlog_update id="TASK-0001" status="done"                    # Mark done
backlog_update id="TASK-0001" status="blocked" blocked_reason="Waiting on API"
backlog_update id="TASK-0001" evidence=["Fixed in CR-12345"]   # Add completion proof

backlog_delete id="TASK-0001"             # Permanently delete
```

## Installation

Add to your MCP config (`.mcp.json` or your MCP client config):

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

<a href="https://glama.ai/mcp/servers/@gkoreli/backlog-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@gkoreli/backlog-mcp/badge" alt="backlog-mcp MCP server" />
</a>
