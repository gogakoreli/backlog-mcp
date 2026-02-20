# 0085. source_path parameter for backlog_create

**Date**: 2026-02-20
**Status**: Accepted
**Backlog Item**: TASK-0354

## Context

LLM agents frequently need to create backlog artifacts from local files. The current workflow requires the agent to read the file into its context window, then pass the content as the `description` string parameter to `backlog_create`. This round-trip through the LLM is lossy (large files get truncated or summarized), wasteful (burns context tokens), and unnecessary since the backlog-mcp server runs locally with direct filesystem access.

## Decision

Add an optional `source_path` parameter to `backlog_create`. When provided, the server reads the file directly from disk and uses its content as the task/artifact description. `source_path` is mutually exclusive with `description`.

Path resolution: absolute paths used as-is, `~` expanded to homedir, relative paths resolved from cwd. The server validates the file exists and is readable before proceeding.

## Rationale

- **Proposal 1 (selected)**: Inline resolution in the tool handler. Smallest change, highest score across all evaluation anchors (28/30).
- **Proposal 2 (rejected)**: Storage-layer resolution. More reusable but storage shouldn't do arbitrary filesystem I/O — that's a tool-level concern. If reuse is needed later, extracting a utility from the handler is trivial.
- **Proposal 3 (rejected)**: Symlink/reference-based. Wrong mental model — artifacts should be snapshots, not live references to mutable files.

## Consequences

- Agents can create artifacts from local files without reading content into context
- File content preserved byte-for-byte (no LLM interpretation)
- Path resolution logic lives in `backlog-create.ts` handler — if other tools need it, extract to a shared utility
- No changes to storage layer, schema, viewer, or other tools
