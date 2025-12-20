# backlog-mcp

Minimal task backlog as an MCP server. Records state, doesn't enforce workflow.

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `backlog_list` | List tasks. Filter by status. Use `summary=true` for counts. |
| `backlog_get` | Get task by ID |
| `backlog_create` | Create task |
| `backlog_update` | Update any field (title, description, status, blocked_reason, evidence) |

## Usage

```bash
npm install
npm run build
npm start
```

Or add to Claude Desktop config:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "node",
      "args": ["/path/to/backlog-mcp/dist/server.js"]
    }
  }
}
```

## Storage

Single file: `data/backlog.json` (atomic writes via temp + rename)

## License

MIT
