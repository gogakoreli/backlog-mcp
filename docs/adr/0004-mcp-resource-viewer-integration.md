# 0004. MCP Resource Viewer Integration - In-Browser File Viewing

**Date**: 2026-01-22
**Status**: Accepted
**Backlog Item**: EPIC-0002

## Context

### Problem Statement

Users viewing tasks in the backlog web viewer encounter file:// URLs in references and evidence fields. Currently, clicking these links triggers the system's default file handler (e.g., Finder on macOS, external text editors), which:

1. **Breaks workflow continuity** - User leaves the web viewer context
2. **Poor UX for quick reference checks** - Opening external apps for a quick peek is heavyweight
3. **No integration with MCP resources** - The MCP server exposes writable resources but not readable ones
4. **Inconsistent experience** - Some references are URLs (viewable), others are files (external)

### Current State

**Backend:**
- `write_resource` tool exists for editing task fields via mcp:// URIs
- No MCP resources registered (no `server.registerResource()` calls)
- Viewer server has `/open-file` endpoint that uses `exec('open ...')` to launch external apps
- No endpoint for reading file contents

**Frontend:**
- Two-pane layout: task list | task detail
- file:// links in references/evidence trigger external file opening
- No in-browser file viewing capability
- No syntax highlighting or markdown rendering for referenced files

### User Workflow Analysis

When investigating completed tasks, users need to:
1. Read task description and understand requirements
2. Check ADR documents to understand design decisions
3. Review implementation logs to see what was built
4. Examine source code files to verify implementation
5. Cross-reference multiple files to understand full context

**Key insight**: This is a **parallel research workflow**, not sequential navigation. Users need to compare task descriptions with implementation artifacts side-by-side.

### Research Findings

Examined TASK-0058 as representative example:
- 11 file:// references (ADRs, logs, source files)
- Mix of .md, .ts, .json files
- References span multiple directories (.backlog artifacts, source code)
- Users need to quickly scan these files without losing task context

## Proposed Solutions

### Option 1: Modal Overlay Pattern

**Description**: Click file:// link opens a modal overlay on top of the current task view. Modal displays file content with syntax highlighting. Close button returns to task view.

**Pros**:
- Simple implementation (~100 lines)
- No layout changes to existing UI
- Familiar pattern (like image lightboxes)
- Works on any screen size

**Cons**:
- Disruptive - completely hides task context
- Can't compare task description with file content
- No way to keep multiple files open
- Feels like a popup, not integrated
- Poor UX for research workflows

**Implementation Complexity**: Low

**UX Assessment**: ❌ **Poor** - Breaks the core use case of comparing task context with implementation artifacts.

---

### Option 2: Three-Pane Layout

**Description**: Add permanent third pane to the right. Layout becomes: task list | task detail | resource viewer. Resources appear in dedicated pane when clicked.

**Pros**:
- Side-by-side viewing of task and resource
- Dedicated space for file content
- Can keep resource open while browsing tasks
- Clear separation of concerns

**Cons**:
- Always shows 3 panes even when not viewing resources (wasted space)
- Screen real estate becomes cramped on smaller screens
- Complex layout management (which pane has focus?)
- Unclear behavior: does resource pane clear when switching tasks?
- Forces users into a specific layout

**Implementation Complexity**: Medium

**UX Assessment**: ⚠️ **Acceptable** - Good for desktop power users, but wastes space and lacks flexibility.

---

### Option 3: Tab-Based Navigation

**Description**: Task detail pane becomes tabbed interface. Tab 1 is always the task details. Clicking file:// links opens new tabs (Tab 2, 3, etc.). Users can switch between task and multiple resources using tabs.

**Pros**:
- Familiar browser-like UX pattern
- Can keep multiple resources open
- Works on any screen size (responsive)
- Clear focus - one tab is active at a time
- No wasted space when not viewing resources
- Simple tab management (close button per tab)

**Cons**:
- Can't see task and resource simultaneously
- Requires tab switching to compare content
- Tab bar could get cluttered with many files
- Still a sequential workflow, not parallel

**Implementation Complexity**: Medium (~150 lines)

**UX Assessment**: ✅ **Good** - Solid fallback option, but doesn't support parallel research workflow.

---

### Option 4: Inline Expandable Resources

**Description**: file:// links have an expand/collapse icon. Clicking expands file content inline within the task detail. Multiple resources can be expanded simultaneously. Collapse to hide.

**Pros**:
- Zero navigation - everything in context
- Can expand multiple files at once
- Scroll to see everything in one flow
- No layout changes needed
- Very simple implementation (~80 lines)

**Cons**:
- Long files make the page extremely long
- Scrolling becomes tedious with many expanded files
- No dedicated space for focused file reading
- Poor performance with large files
- Cluttered visual hierarchy

**Implementation Complexity**: Low

**UX Assessment**: ⚠️ **Acceptable** - Great for quick peeks at short files, poor for deep reading or long files.

---

### Option 5: Adaptive Split Pane (RECOMMENDED)

**Description**: Default two-pane layout (task list | task detail). When user clicks file:// link, the right pane splits vertically into (task detail | resource viewer). Split is resizable with draggable divider. Close button on resource viewer returns to single pane. Can switch resources without closing split.

**Pros**:
- Side-by-side viewing when needed (parallel research workflow)
- No wasted space when not viewing resources (progressive disclosure)
- Resizable divider gives user control over space allocation
- Clean, focused UX - complexity only appears when needed
- Aligns with existing two-pane pattern (natural extension)
- URL state can preserve split state and open resource
- Supports core use case: comparing task with implementation

**Cons**:
- Higher implementation complexity (~330 lines)
- Need to handle responsive behavior (collapse to tabs on mobile?)
- Resize logic requires careful state management
- More complex CSS for split pane layout

**Implementation Complexity**: Medium-High

**UX Assessment**: ✅ **Excellent** - Best match for actual user workflow. Balances simplicity (default state) with power (split view when needed).

---

## Decision

**Selected**: Option 5 - Adaptive Split Pane

### Rationale

After brutal self-critique, the adaptive split pane is the objectively best solution:

1. **Matches actual workflow**: Users investigating completed tasks need to compare task descriptions with ADRs, logs, and source code side-by-side. This is a parallel research workflow, not sequential navigation.

2. **Progressive disclosure**: The UI starts simple (two panes) and only adds complexity when the user needs it (split view). This respects the principle of not wasting screen space.

3. **User control**: Resizable divider lets users allocate space based on their needs (e.g., more space for long source files, less for short ADRs).

4. **Natural extension**: The existing two-pane layout already establishes the pattern. Splitting the right pane is a natural, intuitive extension.

5. **Implementation complexity is justified**: The extra ~180 lines of code (vs tabs) are worth it for the superior UX in the core use case. This is a research/investigation tool, and side-by-side viewing is essential.

### Why Not Other Options?

- **Modal (Option 1)**: Rejected - Completely breaks context, poor for research workflows
- **Three-Pane (Option 2)**: Rejected - Wastes space, lacks flexibility
- **Tabs (Option 3)**: Good fallback, but doesn't support parallel viewing (core requirement)
- **Inline (Option 4)**: Rejected - Poor for long files, cluttered UX

### Trade-offs Accepted

1. **Higher implementation complexity** - Worth it for UX improvement
2. **Responsive design challenge** - Will need mobile strategy (likely collapse to tabs)
3. **State management complexity** - Split state, resize state, open resource state

## Consequences

### Positive

1. **Superior research workflow** - Users can compare task context with implementation artifacts
2. **Reduced context switching** - No need to open external editors
3. **Consistent experience** - All references (URLs and files) viewable in-browser
4. **MCP resource integration** - Exposes task data as readable MCP resources
5. **Syntax highlighting** - Code files are readable with proper formatting
6. **Markdown rendering** - ADRs and logs render beautifully

### Negative

1. **Implementation effort** - ~330 lines of new code across backend and frontend
2. **Bundle size increase** - Need syntax highlighting library (~50KB)
3. **Maintenance burden** - Split pane logic needs testing and edge case handling

### Risks & Mitigations

**Risk 1**: Split pane is too complex for mobile screens
- **Mitigation**: Detect screen width, collapse to tabs on mobile (<768px)

**Risk 2**: Large files cause performance issues
- **Mitigation**: Lazy load file content, add file size warning, truncate very large files

**Risk 3**: Syntax highlighting library bloats bundle
- **Mitigation**: Use lightweight library (highlight.js core + selective languages), lazy load

## Implementation Notes

### Backend Changes

**1. Register MCP Resources** (`src/server.ts`)
```typescript
// Register resources for each task
server.registerResource({
  uri: 'mcp://backlog/tasks/{taskId}/description',
  name: 'Task Description',
  mimeType: 'text/markdown',
  read: async (uri) => {
    const taskId = parseTaskId(uri);
    const task = storage.get(taskId);
    return task?.description || '';
  }
});
```

**2. Add Resource Read Endpoint** (`src/viewer.ts`)
```typescript
// GET /resource?path=/path/to/file
// Returns: { content: string, type: string, path: string }
```

### Frontend Changes

**1. Create `<resource-viewer>` Component** (`viewer/components/resource-viewer.ts`)
- Syntax highlighting for code files (highlight.js)
- Markdown rendering for .md files (reuse md-block)
- Plain text fallback
- Loading states
- Error handling

**2. Add Split Pane Logic** (`viewer/main.ts`)
- Detect resource-open events
- Create split pane container
- Handle resize with draggable divider
- Update URL state (e.g., `?task=TASK-0001&resource=/path/to/file`)
- Close resource handler

**3. Update `<task-detail>`** (`viewer/components/task-detail.ts`)
- Intercept file:// link clicks
- Dispatch 'resource-open' event with file path
- Prevent default external opening

**4. Add Split Pane CSS** (`viewer/styles.css`)
- Flexbox layout for split pane
- Resize handle styling
- Responsive breakpoints

### File Type Support

**Phase 1** (MVP):
- `.md` - Markdown rendering (reuse md-block)
- `.ts`, `.js`, `.json` - Syntax highlighting
- `.txt` - Plain text
- Fallback: Plain text for unknown types

**Phase 2** (Future):
- `.py`, `.java`, `.go` - More language support
- `.png`, `.jpg` - Image preview
- `.pdf` - PDF viewer (iframe or pdf.js)

### URL State Schema

```
?task=TASK-0001&resource=/path/to/file&split=60
```

- `task`: Current task ID
- `resource`: Currently open resource path (optional)
- `split`: Split pane percentage (optional, default 50)

### Responsive Strategy

- **Desktop (>768px)**: Adaptive split pane
- **Mobile (<768px)**: Collapse to tabs (fallback to Option 3)

### Performance Considerations

- Lazy load syntax highlighting library
- Truncate files >1MB with "View full file" link
- Cache loaded resources in memory
- Debounce resize events

### Accessibility

- Keyboard shortcuts: `Cmd+W` to close resource, `Cmd+[` / `Cmd+]` to resize
- ARIA labels for split pane regions
- Focus management when opening/closing resources
- Screen reader announcements for state changes

## Success Metrics

1. **Reduced external app launches** - Track /open-file endpoint usage (should decrease)
2. **Resource viewer usage** - Track /resource endpoint calls
3. **User feedback** - Qualitative feedback on research workflow improvement
4. **Performance** - Resource load time <500ms for typical files

## Future Enhancements

1. **Resource search** - Search within open resource
2. **Multi-resource tabs** - Open multiple resources in tabs within split pane
3. **Resource history** - Recently viewed resources
4. **Diff view** - Compare two resources side-by-side
5. **Edit capability** - Edit resources inline (integrate with write_resource)

## References

- ADR 0001: Writable Resources Design (foundation for this work)
- TASK-0058: Example task with 11 file:// references
- MCP Resources Spec: https://modelcontextprotocol.io/docs/concepts/resources
