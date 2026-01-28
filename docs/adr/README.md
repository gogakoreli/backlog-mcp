# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for backlog-mcp.

## What is an ADR?

An ADR documents an important architectural decision along with its context and consequences. It helps future contributors understand why certain choices were made.

## Active ADRs

- [0034. Fix Status Filter Mapping](./0034-fix-status-filter-mapping.md) - Add 'completed' filter mapping to backend to fix broken Completed filter button - 2026-01-28
- [0033. Folder-Style Epic Navigation](./0033-folder-style-epic-navigation.md) - Complete folder-style navigation for nested epics with breadcrumbs, URL state, and clean home page - 2026-01-27
- [0032. Fix Copy Markdown Button](./0032-fix-copy-markdown-button.md) - Add raw field to task API response to restore copy markdown functionality - 2026-01-27
- [0027. CLI Management Commands](./0027-cli-management-commands.md) - Add version, status, stop commands for better server control and troubleshooting - 2026-01-26
- [0026. Build System Modernization and Path Resolution](./0026-build-system-modernization.md) - Migrate to tsdown, centralize path resolution, fix static asset serving - 2026-01-26
- [0025. Enable StreamableHTTPServerTransport with Current Architecture](./0025-streamable-http-with-current-architecture.md) - Change mcp-remote transport flag to http-only, maintain exact architecture - 2026-01-26
- [0022. Fix Missing /mcp/message POST Route](./0022-fix-missing-mcp-message-route.md) - Add separate POST route for MCP messages to fix SSE transport - 2026-01-25
- [0019. Complete HTTP Architecture Migration](./0019-complete-http-architecture-migration.md) - Direct copy of missing endpoints to achieve 100% feature parity and delete old code - 2026-01-25
- [0018. Restore Flexible Static File Serving](./0018-restore-flexible-static-file-serving.md) - Pattern-based static file serving to fix 404 errors and prevent future regressions - 2026-01-24
- [0017. Agent 4 Production Hardening and Testing](./0017-agent4-production-hardening.md) - Minimal critical path: tests, bug fix, graceful shutdown for production readiness - 2026-01-25
- [0016. Real-time Agent Log Streaming to Viewer UI](./0016-agent-log-streaming-architecture.md) - File watching + SSE + ANSI parsing for real-time log streaming without agent changes - 2026-01-25
- [0015. Ralph Wiggum Loop for Iterative Agent Delegation](./0015-ralph-wiggum-loop-for-delegation.md) - Integrate Ralph Wiggum technique for self-improving agent workflows with fresh context per iteration - 2026-01-24
- [0014. stdio-to-HTTP Bridge Implementation](./0014-stdio-http-bridge-implementation.md) - MCP Client SDK bridge with auto-spawn and version management - 2026-01-25
- [0013. HTTP MCP Server Architecture with Built-in stdio Bridge](./0013-http-mcp-server-architecture.md) - HTTP-first architecture with auto-bridge for cloud deployment and persistent viewer - 2026-01-24
- [0012. Fix Nested Epic Rendering in Viewer](./0012-nested-epic-rendering-fix.md) - Filter root epics only to prevent duplicate rendering of nested epics - 2026-01-24
- [0011. Viewer Version Management with Detached Process](./0011-viewer-version-management.md) - Automatic viewer restart on version mismatch using detached process and HTTP version endpoint - 2026-01-24 (Superseded by ADR-0013)
- [0010. Unified Resource Path Resolution](./0010-unified-resource-path-resolution.md) - Centralized URI resolver for consistent MCP and HTTP resource handling - 2026-01-24
- [0009. Read Resource Tool for Remote Deployment](./0009-read-resource-tool-for-remote-deployment.md) - Pragmatic workaround for Kiro CLI's lack of resources protocol support - 2026-01-23
- [0008. Task-Attached Resources](./0008-task-attached-resources.md) - Separate resources directory with lifecycle management for ADRs and design docs - 2026-01-23
- [0007. MCP Resource URI Implementation](./0007-mcp-resource-uri-implementation.md) - Shared URI resolver module for MCP and HTTP clients - 2026-01-22
- [0006. MCP Resource URI Architecture](./0006-mcp-resource-uri-architecture.md) - Hybrid file:// and mcp:// URI support for portable resource references - 2026-01-22
- [0005. Reusable Markdown Content Component](./0005-reusable-markdown-content-component.md) - Extract shared markdown rendering logic into reusable component for consistency - 2026-01-22
- [0004. MCP Resource Viewer Integration - In-Browser File Viewing](./0004-mcp-resource-viewer-integration.md) - Adaptive split pane for viewing file:// references in web viewer with MCP resource support - 2026-01-22
- [0003. Remove Archive Directory - Single Source of Truth](./0003-remove-archive-directory.md) - Eliminate duplicate ID bugs by using single directory - 2026-01-21
- [0002. Fix Epic ID Generation to Prevent Overwrites](./0002-epic-id-generation-fix.md) - Efficient getAllIds() method prevents ID collisions when creating epics - 2026-01-21
- [0001. Writable Resources - Efficient Data Manipulation in MCP](./0001-writable-resources-design.md) - Comprehensive design for operation-based resource updates enabling 10-100x efficiency gains - 2026-01-21

## Superseded ADRs

None currently.

## Rejected ADRs

- [0024. Dual-Mode Server Architecture for StreamableHTTPServerTransport](./0024-dual-mode-server-for-streamable-http.md) - Rejected by user: "I like the current architecture" (Superseded by ADR-0025) - 2026-01-25
- [0023. Migrate to StreamableHTTPServerTransport](./0023-migrate-to-streamable-http-transport.md) - Blocked by protocol mismatch (didn't change transport flag) (Superseded by ADR-0025) - 2026-01-25

## Proposed ADRs

None currently.

## Format

Each ADR follows this structure:
- **Context**: What problem are we solving?
- **Proposed Solutions**: What options did we consider?
- **Decision**: What did we choose and why?
- **Consequences**: What are the implications?
- **Implementation**: How do we build it?
