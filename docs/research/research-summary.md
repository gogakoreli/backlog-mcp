# MCP Resource Viewer Integration - Research & Design Summary

**Date**: 2026-01-22
**Epic**: EPIC-0002 (backlog-mcp 10x)
**Status**: Design Complete - Ready for Implementation

## Executive Summary

Conducted holistic research and product design for integrating MCP resource viewing into the backlog web viewer. The current experience forces users to open file:// references in external applications, breaking workflow continuity. After evaluating 5 design approaches with brutal self-critique, selected **Adaptive Split Pane** as the optimal solution.

## Problem Analysis

### Current Pain Points

1. **Broken workflow** - Clicking file:// links opens Finder/external editors
2. **No MCP resource exposure** - Only write_resource exists, no readable resources
3. **Poor research UX** - Can't compare task descriptions with implementation artifacts
4. **Inconsistent experience** - URLs viewable in-browser, files open externally

### User Workflow Discovery

Analyzed TASK-0058 (representative completed task):
- 11 file:// references (ADRs, logs, source code)
- Mix of .md, .ts, .json files
- Users need **parallel research workflow**: compare task context with implementation side-by-side
- Key insight: This is NOT sequential navigation, it's parallel investigation

## Design Proposals Evaluated

### 1. Modal Overlay ❌
- **Verdict**: Rejected - Disruptive, loses context
- Breaks core use case of comparing task with artifacts

### 2. Three-Pane Layout ⚠️
- **Verdict**: Acceptable but wasteful
- Always shows 3 panes even when not needed
- Lacks flexibility

### 3. Tab-Based Navigation ✅
- **Verdict**: Good fallback
- Familiar UX, works on all screens
- **Flaw**: Can't view task + resource simultaneously (fails core requirement)

### 4. Inline Expandable ❌
- **Verdict**: Rejected - Poor for long files
- Great for quick peeks, terrible for deep reading

### 5. Adaptive Split Pane ✅✅ **SELECTED**
- **Verdict**: Objectively best solution
- Side-by-side when needed, no waste when not
- Resizable divider for user control
- Matches actual parallel research workflow

## Decision Rationale

**Why Adaptive Split Pane Won:**

1. **Matches real workflow** - Users need side-by-side comparison for research
2. **Progressive disclosure** - Starts simple, adds complexity only when needed
3. **User control** - Resizable divider adapts to content needs
4. **Natural extension** - Builds on existing two-pane pattern
5. **Implementation complexity justified** - Extra ~180 lines worth it for UX

**Self-Critique Applied:**
- Initially biased toward tabs (simpler implementation)
- Challenged assumption: "Is this sequential or parallel workflow?"
- Realized: Engineers DO need side-by-side viewing for investigation
- Chose based on merit, not ease of implementation

## Architecture Design

### Backend Changes (~80 lines)

1. **Register MCP Resources** (`src/server.ts`)
   - `mcp://backlog/tasks/{taskId}/description`
   - `mcp://backlog/tasks/{taskId}/title`
   - `mcp://backlog/tasks/{taskId}/file`

2. **Add Resource Read Endpoint** (`src/viewer.ts`)
   - `GET /resource?path=/path/to/file`
   - Returns: `{ content, type, path }`
   - Detects mime type, reads file content

### Frontend Changes (~250 lines)

1. **`<resource-viewer>` Component** (`viewer/components/resource-viewer.ts`)
   - Syntax highlighting (highlight.js)
   - Markdown rendering (reuse md-block)
   - Loading/error states

2. **Split Pane Logic** (`viewer/main.ts`)
   - Detect resource-open events
   - Create split container
   - Draggable resize divider
   - URL state management

3. **Update `<task-detail>`** (`viewer/components/task-detail.ts`)
   - Intercept file:// clicks
   - Dispatch resource-open event

4. **Split Pane CSS** (`viewer/styles.css`)
   - Flexbox layout
   - Resize handle styling
   - Responsive breakpoints

### Total Implementation: ~330 lines

## Technical Specifications

### File Type Support (MVP)
- `.md` - Markdown rendering
- `.ts`, `.js`, `.json` - Syntax highlighting
- `.txt` - Plain text
- Fallback: Plain text for unknown types

### URL State Schema
```
?task=TASK-0001&resource=/path/to/file&split=60
```

### Responsive Strategy
- **Desktop (>768px)**: Adaptive split pane
- **Mobile (<768px)**: Collapse to tabs

### Performance
- Lazy load syntax highlighting library
- Truncate files >1MB
- Cache loaded resources
- Debounce resize events

### Accessibility
- Keyboard shortcuts: `Cmd+W` close, `Cmd+[/]` resize
- ARIA labels for regions
- Focus management
- Screen reader announcements

## Trade-offs Accepted

1. **Higher complexity** (~180 more lines than tabs) - Worth it for UX
2. **Bundle size** (+~50KB for syntax highlighting) - Acceptable for core feature
3. **Mobile complexity** - Mitigated by collapsing to tabs

## Success Metrics

1. Reduced /open-file endpoint usage (external app launches)
2. Increased /resource endpoint calls (in-browser viewing)
3. Qualitative user feedback on research workflow
4. Resource load time <500ms

## Next Steps

### Phase 1: MVP Implementation
1. Backend: Add /resource endpoint
2. Backend: Register MCP resources
3. Frontend: Create resource-viewer component
4. Frontend: Implement split pane logic
5. Frontend: Update task-detail to dispatch events
6. CSS: Split pane layout and resize handle
7. Testing: Manual testing with various file types

### Phase 2: Polish
1. Responsive behavior (mobile tabs)
2. Performance optimization (lazy loading)
3. Accessibility audit
4. User testing and feedback

### Phase 3: Future Enhancements
1. Resource search
2. Multi-resource tabs
3. Resource history
4. Diff view
5. Edit capability (integrate write_resource)

## Design Artifacts

- **ADR**: `/docs/adr/0004-mcp-resource-viewer-integration.md`
- **Research Summary**: This document
- **Implementation Plan**: See ADR Implementation Notes section

## Key Learnings

1. **Product research is essential** - Task description alone would have led to wrong solution
2. **Brutal self-critique works** - Caught bias toward simpler implementation
3. **User workflow analysis is critical** - Parallel vs sequential distinction was key
4. **Multiple proposals surface better solutions** - Option 5 emerged from comparing 4 others
5. **Implementation complexity is sometimes justified** - UX improvement worth the code

## Conclusion

The Adaptive Split Pane design provides the best UX for the core use case (parallel research workflow) while maintaining simplicity in the default state. The design is well-researched, thoroughly critiqued, and ready for implementation.

**Recommendation**: Proceed with implementation of Option 5 (Adaptive Split Pane) as documented in ADR 0004.
