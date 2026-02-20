# Problem Articulation: source_path for backlog_create

<core>LLM agents cannot create backlog artifacts from local files without reading the entire file content into their context window first. This is wasteful (burns tokens), lossy (large files get truncated/summarized), and unnecessary since the backlog-mcp server has direct filesystem access.</core>

## Root Causes

<dominant>There is no server-side file reading mechanism. The only way to provide content to `backlog_create` is via the `description` string parameter, which must be populated by the caller (the LLM).</dominant>

<alternative>Could the MCP protocol itself support file references? No — MCP tools receive JSON parameters, not file handles. The solution must be at the tool parameter level.</alternative>

## Constraints
- No new tools — extend `backlog_create`
- Backward compatible — existing `description` usage unchanged
- Server runs locally with filesystem access
- Must handle path resolution (absolute, relative, ~)

<whatifwrong>If agents rarely create artifacts from files, this isn't worth doing. But the user reports this as a frequent pain point — it's a core workflow.</whatifwrong>

## Adjacent Problems (awareness only, not in scope)
- `write_resource` also has creation capability that overlaps with `backlog_create` (tracked in TASK-0355)
- No batch file import (create multiple artifacts from a directory) — future work

## Draft ADR

### Problem Statement
LLM agents creating backlog artifacts from local files must read file content into their context window, then pass it as a string parameter. This round-trip is lossy for large files and wastes context tokens.

### Context
- backlog-mcp runs as a local server with full filesystem access
- `backlog_create` accepts `description` as an inline markdown string
- The artifact substrate already has `path` and `content_type` metadata fields
- Agents frequently need to store local files (research docs, design outputs, logs) as backlog artifacts

### Decision Drivers
- Minimize token waste in agent workflows
- Preserve file content fidelity (no LLM interpretation)
- Keep the tool API simple and backward compatible
