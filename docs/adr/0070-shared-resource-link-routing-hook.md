# 0070. Shared Resource Link Routing Hook

**Date**: 2026-02-11
**Status**: Accepted
**Backlog Item**: TASK-0279

## Context

After the framework migration (Phases 12-15, ADR 0013), `file://` and `mcp://` links in task-detail are broken. The resource-viewer has a working interception pattern using `useHostEvent(host, 'md-render')` that routes these protocols to the split-pane viewer, but task-detail was never given this capability. Additionally, the reference list renders all links as `<a target="_blank">` regardless of protocol — browsers cannot navigate to `file://` or `mcp://` in new tabs.

## Problem Space

Two distinct issues:
1. **md-block link interception**: Links inside rendered markdown need protocol-aware routing. Currently only resource-viewer has this.
2. **Reference list rendering**: The `each()` callback in task-detail creates identical `<a target="_blank">` elements for all protocols. `file://` and `mcp://` need click handlers that route to `SplitPaneState`.

## Decision

Extract a shared `useResourceLinks(host)` lifecycle hook that:
- Listens for `md-render` events on the host element
- Intercepts `file://` and `mcp://` link clicks
- Routes them to `SplitPaneState.openResource()` / `openMcpResource()`

Both task-detail and resource-viewer call this hook. The reference list in task-detail gets protocol-aware rendering with visual protocol labels.

## Alternatives Considered

1. **Inline duplication** — Copy interception into task-detail. Fast but duplicates logic.
2. **App-level delegated handler** — Single click handler on backlog-app root. Violates ADR 0013 spirit, harder to test, fragile with shadow DOM.

## Consequences

- Single source of truth for link interception
- Future components with md-block get routing by calling one hook
- Resource-viewer's inline interception replaced with shared hook (behavior identical)
- Protocol labels on references give users visual context
