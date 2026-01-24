# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for backlog-mcp.

## What is an ADR?

An ADR documents an important architectural decision along with its context and consequences. It helps future contributors understand why certain choices were made.

## Active ADRs

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

None yet.

## Format

Each ADR follows this structure:
- **Context**: What problem are we solving?
- **Proposed Solutions**: What options did we consider?
- **Decision**: What did we choose and why?
- **Consequences**: What are the implications?
- **Implementation**: How do we build it?
