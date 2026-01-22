# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for backlog-mcp.

## What is an ADR?

An ADR documents an important architectural decision along with its context and consequences. It helps future contributors understand why certain choices were made.

## Active ADRs

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
