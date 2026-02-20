# ADR 0085: source_path parameter for backlog_create

See [docs/adr/0085-source-path-for-backlog-create.md](/Users/gkoreli/Documents/goga/backlog-mcp/docs/adr/0085-source-path-for-backlog-create.md)

Decision: Add optional `source_path` to `backlog_create` tool handler. Server reads file directly from disk, uses content as description. Inline resolution in handler — no storage layer changes.
