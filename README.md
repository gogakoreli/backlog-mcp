# backlog-mcp

Minimal task backlog MCP server. Works with any LLM agent or CLI editor that supports MCP integration (Claude, Kiro, Cursor, Codex, etc).

> **Quick start**: Tell your LLM: `Add backlog-mcp to .mcp.json and use it to track tasks`

## Web Viewer

Start the server and open `http://localhost:3030` (production) or `http://localhost:3040` (dev) for a visual task browser.

```bash
pnpm dev  # Starts MCP server + web viewer with hot reload (port 3040)
```

Features:
- Split pane layout with task list and detail view
- Filter by Active/Completed/All
- GitHub-style markdown rendering
- Click file path to open in editor
- URL state persistence

## Task Schema

Tasks and epics are stored as individual markdown files with YAML frontmatter:

```markdown
---
id: TASK-0001
title: Fix bug in authentication
type: task
epic_id: EPIC-0002
status: open
created_at: '2024-01-10T10:00:00Z'
updated_at: '2024-01-10T10:00:00Z'
blocked_reason: Waiting for API access
evidence:
  - Fixed in CR-12345
  - Validated in beta
references:
  - url: https://github.com/org/repo/issues/123
    title: Related GitHub issue
---

## Description

The authentication flow has an issue where...

## Context

This came from Slack thread: https://...
```

**ID format:** `TASK-0001` for tasks, `EPIC-0001` for epics  
**Type values:** `task` (default), `epic`  
**Status values:** `open`, `in_progress`, `blocked`, `done`, `cancelled`

## MCP Tools

### Tasks & Epics

```
backlog_list                              # List active tasks (open, in_progress, blocked)
backlog_list status=["done"]              # Show completed tasks
backlog_list type="epic"                  # List only epics
backlog_list epic_id="EPIC-0002"          # Tasks in specific epic
backlog_list counts=true                  # Get counts by status
backlog_list limit=10                     # Limit results

backlog_get id="TASK-0001"                # Get single task
backlog_get id=["TASK-0001","TASK-0002"]  # Batch get multiple tasks

backlog_create title="Fix bug"            # Create task
backlog_create title="Fix bug" description="Details..." epic_id="EPIC-0002"
backlog_create title="Q1 Goals" type="epic"  # Create epic

backlog_update id="TASK-0001" status="done"                    # Mark done
backlog_update id="TASK-0001" status="blocked" blocked_reason="Waiting on API"
backlog_update id="TASK-0001" evidence=["Fixed in CR-12345"]   # Add completion proof

backlog_delete id="TASK-0001"             # Permanently delete
```

### Resources (MCP Resources Protocol)

Access tasks and resources via MCP resource URIs:

```
mcp://backlog/tasks/TASK-0001.md          # Task markdown file
mcp://backlog/resources/TASK-0001/adr.md  # Task-attached resource
mcp://backlog/resources/investigation.md  # Standalone resource
```

Modify resources via `write_resource` tool with operations like `str_replace`, `append`, `insert`.

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
pnpm install && pnpm build
pnpm start
```

## CLI Commands

```bash
backlog-mcp              # Run as stdio MCP server (default)
backlog-mcp serve        # Run HTTP server with viewer
backlog-mcp version      # Show version
backlog-mcp status       # Check if server is running
backlog-mcp stop         # Stop the server
backlog-mcp --help       # Show help
```

**Troubleshooting:**
```bash
npx backlog-mcp status   # Check if server is running
npx backlog-mcp stop     # Stop misbehaving server
npx backlog-mcp version  # Check installed version
```

## Configuration

Environment variables (create `.env` file for local development):

```bash
# Copy example config
cp .env.example .env

# Edit with your values
BACKLOG_DATA_DIR=/Users/yourname/.backlog  # Where to store tasks
BACKLOG_VIEWER_PORT=3030                    # HTTP server port
```

**For agents/LLMs:** Read the actual `.env` file to understand the configured values, not the defaults in code.

## Storage

- Default: `data/tasks/` and `data/archive/` (local to project)
- Global: Set `BACKLOG_DATA_DIR=~/.backlog` for cross-project persistence
- Completed/cancelled tasks auto-archive to `archive/`

## License

MIT

<a href="https://glama.ai/mcp/servers/@gkoreli/backlog-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@gkoreli/backlog-mcp/badge" alt="backlog-mcp MCP server" />
</a>
