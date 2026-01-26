# 0027. CLI Management Commands

**Date**: 2026-01-26
**Status**: Accepted

## Context

When backlog-mcp is installed via `npx` and fails or misbehaves, users have no way to diagnose or control the detached HTTP server from the CLI. Current limitations:

1. No `--version` flag to check installed version
2. No way to check if server is running without making HTTP requests
3. No way to stop server from CLI (must use `/shutdown` endpoint or kill process)
4. No validation feedback for `BACKLOG_DATA_DIR` path

This creates a poor troubleshooting experience, especially for users who install via `npx backlog-mcp` and encounter issues.

### Current State

CLI has 3 modes:
- Default (no args): Bridge mode - spawns detached HTTP server + stdio bridge
- `serve`: HTTP server in foreground
- `--help` / `-h`: Show help

The server-manager already has functions for checking status, getting version, and shutting down, but they're not exposed via CLI.

### Research Findings

- `server-manager.ts` exports `ensureServer()` but not the helper functions
- Version is available in `paths.getVersion()` from package.json
- Storage validation happens in `storage.init()` but errors aren't user-friendly
- Users expect standard CLI patterns: `--version`, `status`, `stop`

## Proposed Solutions

### Option 1: Flag-based CLI

**Description**: Add flags like `--version`, `--status`, `--stop`

**Pros**:
- Follows Unix conventions (`--version` is standard)
- Familiar to developers

**Cons**:
- Inconsistent with existing `serve` command pattern
- Mixing flags and commands is confusing UX
- More complex argument parsing

**Implementation Complexity**: Low

### Option 2: Command-based CLI

**Description**: Add commands: `version`, `status`, `stop`

**Pros**:
- Consistent with existing `serve` command
- Simple, predictable pattern
- Easy to extend with more commands
- Minimal code changes

**Cons**:
- `backlog-mcp version` less conventional than `--version`
- Slightly more typing

**Implementation Complexity**: Low

### Option 3: Subcommand Structure

**Description**: Nested commands like `server status`, `server stop`, `server start`

**Pros**:
- Most structured and scalable
- Clear command grouping

**Cons**:
- Overkill for 4 simple operations
- Breaks existing `serve` pattern
- More typing for users
- Higher complexity

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 2 - Command-based CLI

**Rationale**: 
- Maintains consistency with existing `serve` command
- Simplest implementation (reuse existing functions)
- Easy for users to remember: `backlog-mcp <command>`
- No breaking changes
- Room to add more commands later

**Trade-offs Accepted**:
- `backlog-mcp version` instead of `--version` (less conventional but more consistent)
- Keep `--help` as exception since it's universal

## Consequences

**Positive**:
- Users can diagnose server issues: `npx backlog-mcp status`
- Users can stop misbehaving servers: `npx backlog-mcp stop`
- Users can check version: `npx backlog-mcp version`
- Better troubleshooting experience
- Consistent command pattern

**Negative**:
- Slightly unconventional to not have `--version` flag
- Users need to learn new commands (mitigated by help text)

**Risks**:
- None - purely additive changes, no breaking changes

## Implementation Notes

**New commands**:
```bash
backlog-mcp version    # Show version from package.json
backlog-mcp status     # Check if server running, show port and version
backlog-mcp stop       # Shutdown server gracefully
```

**Implementation**:
1. Export helper functions from `server-manager.ts`: `isServerRunning`, `getServerVersion`, `shutdownServer`
2. Add command handlers in `cli/index.ts`
3. Update help text
4. Data dir validation already happens in `storage.init()` - no changes needed

**Code changes**:
- `src/cli/index.ts`: Add 3 new command branches
- `src/cli/server-manager.ts`: Export existing helper functions
- Minimal code (~30 lines total)
