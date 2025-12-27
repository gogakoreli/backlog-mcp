# backlog-mcp

Minimal task backlog MCP server for Claude and AI agents.

> **Quick start**: Tell your LLM: `Add backlog-mcp to .mcp.json and use it to track tasks`

## Task Schema

```typescript
{
  id: string;           // TASK-0001
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  created_at: string;   // ISO8601
  updated_at: string;   // ISO8601
  blocked_reason?: string;
  evidence?: string[];
}
```

## MCP Tool

Single unified tool with action parameter:

```
backlog action="list"                         # List all tasks
backlog action="list" summary=true            # Get counts by status
backlog action="list" status=["open"]         # Filter by status
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

- Default: `data/backlog.json` (local to project)
- Global: Set `BACKLOG_DATA_DIR=~/.backlog` for cross-project persistence
- Completed/cancelled tasks auto-archive to `archive.json`
- Atomic writes via temp + rename

## License

MIT
