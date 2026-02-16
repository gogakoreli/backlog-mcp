# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for backlog-mcp.

## What is an ADR?

An ADR documents an important architectural decision along with its context and consequences. It helps future contributors understand why certain choices were made.

## Active ADRs

- [0079. Use Orama Native Filtering and Schema Best Practices](./0079-orama-native-filtering.md) - Migrate to enum schema types, native where filtering, properties restriction, insertMultiple - 2026-02-16
- [0072. Normalize-Then-Multiply Search Scoring Architecture](./0072-normalize-then-multiply-scoring.md) - Replace additive reranking with normalized multiplicative scoring pipeline - 2026-02-12
- [0071. Migrate spotlight-search innerHTML to html:inner directive](./0071-migrate-spotlight-search-innerhtml-to-html-inner-directive.md) - Replace imperative DOM manipulation with html:inner directives and text bindings - 2026-02-12
- [0070. Shared Resource Link Routing Hook](./0070-shared-resource-link-routing-hook.md) - Shared useResourceLinks hook for file:// and mcp:// link interception - 2026-02-11
- [0069. Template Engine Auto-Quoting for Unquoted Attribute Expressions](./0069-template-auto-quoting-unquoted-attributes.md) - Context-aware state machine to auto-quote markers in unquoted attribute positions - 2026-02-11
- [0068. Unified URL State: Single ?id= Param with localStorage Sidebar Scope](./0068-unified-url-state-single-id-param.md) - Replace ?epic=&task= with ?id=, sidebar scope in localStorage - 2026-02-07
- [0067. Substrates Backend Integration](./0067-substrates-backend-integration.md) - Evolve schema, storage, and MCP tools to support 5 entity types with parent_id - 2026-02-06
- [0066. Frontend Type Registry for Substrates Viewer UI](./0066-frontend-type-registry-substrates-viewer.md) - Centralized type registry for rendering 5 substrate types in the web viewer - 2026-02-07
- [0062. Spotlight Default Tabs: Recent Searches and Recent Activity](./0062-spotlight-default-tabs.md) - Tabbed default view with recent searches tracking and recent activity display - 2026-02-05
- [0061. Activity Panel Polish and Code Quality](./0061-activity-panel-polish.md) - Non-null assertion fixes, sort dropdown, task-scoped filter UX, write_resource timestamp fix - 2026-02-05
- [0060. Activity Summary System](./0060-activity-summary-system.md) - MCP tool for activity data, summary resources, UI integration - 2026-02-04
- [0059. Journal View Epic Grouping and UX Overhaul](./0059-journal-epic-grouping-and-ux-overhaul.md) - Group completed tasks by epic, show epic titles, adjacent proposals - 2026-02-05
- [0058. Activity Panel Production Quality Refactor](./0058-activity-panel-production-quality.md) - Extract date utilities, add tests, UX improvements, server optimization - 2026-02-05
- [0057. Activity Panel Timezone Fix, Mode Persistence, and Task Titles](./0057-activity-panel-timezone-persistence-titles.md) - Fix timezone bug, persist mode, show task titles, group by task - 2026-02-05
- [0056. Activity Day Grouping and Daily Work Journal View](./0056-activity-day-grouping-and-journal-view.md) - Day separators in timeline, changelog-style journal view with navigation - 2026-02-04
- [0055. Activity Panel Phase 2](./0055-activity-panel-phase-2.md) - Actor attribution, diff2html, count badge, polling, logger refactor - 2026-02-02
- [0054. Operation Logging and Activity View](./0054-operation-logging-and-activity-view.md) - Log MCP tool operations and display in web viewer activity panel - 2026-02-02
- [0053. Remove description field from backlog_update](./0053-remove-description-from-backlog-update.md) - Enforce safer incremental editing via write_resource - 2026-02-02
- [0052. Spotlight Search UX Overhaul](./0052-spotlight-search-ux-overhaul.md) - Remove confusing scores, add type filters, sort toggle, result count, loading spinner - 2026-02-02
- [0051. Multi-Signal Search Ranking](./0051-multi-signal-search-ranking.md) - Add recency and type importance signals to search ranking - 2026-02-02
- [0050. Search Ranking: Title Match Bonus](./0050-search-ranking-title-bonus.md) - Post-search re-ranking to prioritize title matches over description-only matches - 2026-02-02
- [0049. Keep Orama Over Algolia](./0049-keep-orama-over-algolia.md) - Evaluation confirms Orama is the right choice for backlog-mcp search - 2026-02-02
- [0048. Resource Search Integration in Spotlight](./0048-resource-search-integration.md) - Index resources in search, show in Spotlight alongside tasks/epics - 2026-02-01
- [0047. Unified Search API with Proper Types](./0047-unified-search-api.md) - New /search endpoint returning UnifiedSearchResult[] for type-safe search - 2026-02-01
- [0046. Reuse task-badge in Spotlight](./0046-reuse-task-badge-in-spotlight.md) - Replace custom icon+id with task-badge component for consistency - 2026-01-31
- [0045. Fix Spotlight Snippet Display](./0045-fix-spotlight-snippet-display.md) - Fix snippet not displaying by using innerHTML instead of md-block - 2026-01-31
- [0044. Search API Relevance Scores](./0044-search-api-relevance-scores.md) - Return Orama scores from search API for Spotlight UI - 2026-01-31
- [0043. Spotlight Search UX Improvements](./0043-spotlight-search-ux-improvements.md) - Fix navigation bugs, add rich snippets, reuse icons, show scores - 2026-01-31
- [0042. Hybrid Search with Local Embeddings](./0042-hybrid-search-local-embeddings.md) - Semantic search via transformers.js with graceful BM25 fallback - 2026-01-31
- [0041. Hyphen-Aware Custom Tokenizer](./0041-hyphen-aware-tokenizer.md) - Custom tokenizer that expands hyphenated words for consistent search - 2026-01-31
- [0040. Search Storage Decoupling](./0040-search-storage-decoupling.md) - Decouple SearchService from BacklogStorage via composition layer - 2026-01-31
- [0039. Spotlight-Style Search UI](./0039-spotlight-search-ui.md) - Cmd+J keyboard-driven search modal with highlighted match snippets - 2026-01-31
- [0038. Comprehensive Search Capability](./0038-comprehensive-search-capability.md) - Text search across all task fields with future RAG path - 2026-01-31
- [0037. Partial Array Updates with add_/remove_ Convention](./0037-partial-array-updates-convention.md) - add_references/remove_references for partial updates without data loss - 2026-01-29
- [0036. Ruthless Pruning System](./0036-ruthless-pruning-system.md) - Hybrid decay + grooming + warnings to combat over-commitment - 2026-01-28
- [0035. Logging Infrastructure](./0035-logging-infrastructure.md) - File-based structured logging for debugging and visibility - 2026-01-28
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
