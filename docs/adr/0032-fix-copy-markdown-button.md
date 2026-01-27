# 0032. Fix Copy Markdown Button

**Date**: 2026-01-27
**Status**: Accepted
**Backlog Item**: TASK-0099

## Context

The "Copy Markdown" button in the web viewer is broken. It previously worked and would copy the entire task file content including YAML frontmatter (the raw .md file content). Users rely on this feature to quickly copy task content for sharing or external processing.

### Current State

The web viewer has a "Copy Markdown" button in the task detail pane header. The button's click handler expects a `task.raw` property containing the raw markdown file content:

```typescript
// viewer/components/task-detail.ts (lines 70-74)
const copyRawBtn = paneHeader.querySelector('.copy-raw');
if (copyRawBtn && task.raw) {
  copyRawBtn.addEventListener('click', () => navigator.clipboard.writeText(task.raw));
}
```

### Research Findings

Investigation revealed:

1. **API endpoint** (`/tasks/:id` in `src/server/viewer-routes.ts`): Returns only `storage.get(id)` which provides the parsed Task object
2. **Storage layer** (`src/storage/backlog.ts`): Has two methods:
   - `get(id)`: Returns parsed Task object (no raw content)
   - `getMarkdown(id)`: Returns raw markdown string with frontmatter
3. **Root cause**: The viewer route never populates the `raw` field, so the button has no data to copy

The button logic is correct; it just lacks the data it needs.

## Proposed Solutions

### Option 1: Add raw field to viewer route response

**Description**: Modify the `/tasks/:id` endpoint to call both `storage.get(id)` and `storage.getMarkdown(id)`, then include the raw markdown as a `raw` field in the response.

**Pros**:
- Minimal code change (2-3 lines)
- Matches what the client code already expects
- No UX degradation (no extra HTTP requests)
- Backward compatible
- Simple and straightforward

**Cons**:
- Increases response size by including both parsed and raw content
- Couples the viewer route to this specific UI need

**Implementation Complexity**: Low

### Option 2: Create separate endpoint for raw markdown

**Description**: Add a new `/tasks/:id/raw` endpoint that returns only the raw markdown. Update the button to fetch from this endpoint when clicked.

**Pros**:
- Separation of concerns
- Doesn't bloat the main task response
- More RESTful API design

**Cons**:
- Extra HTTP request on button click (slower UX, potential for errors)
- More complex client code (async fetch on click, error handling)
- Requires changes in both server and client

**Implementation Complexity**: Medium

### Option 3: Use existing /resource endpoint

**Description**: Include `filePath` in the task response and update the button to fetch via the existing `/resource?path={filePath}` endpoint.

**Pros**:
- Reuses existing infrastructure
- No new server code needed

**Cons**:
- Exposes file system paths to the browser (security concern)
- Requires two-step process (get task, then get resource)
- More complex client logic
- Breaks if file paths change

**Implementation Complexity**: Low-Medium

## Decision

**Selected**: Option 1 - Add raw field to viewer route response

**Rationale**: 

Option 1 is objectively the best solution because:

1. **Simplicity**: One-line change in the server, zero changes in the client
2. **UX**: No performance degradation, button works instantly
3. **Expectations**: The client code already expects `task.raw` to exist
4. **Pragmatism**: Task descriptions are typically small (< 10KB), so the bandwidth overhead is negligible
5. **Maintainability**: Future developers will understand this immediately

The bandwidth concern (sending both parsed and raw) is not significant enough to justify the complexity of Options 2 or 3. Premature optimization would harm code clarity and UX.

**Trade-offs Accepted**:
- Slightly larger response size (typically < 10KB extra per task)
- Viewer route is coupled to the copy button's needs (acceptable for a viewer-specific endpoint)

## Consequences

**Positive**:
- Copy markdown button works immediately
- No breaking changes to existing code
- Minimal code to maintain
- Fast implementation and testing

**Negative**:
- Response payload includes redundant data (parsed + raw)
- If task descriptions become very large (> 100KB), bandwidth impact could be noticeable

**Risks**:
- None significant. If bandwidth becomes an issue in the future, we can add a query parameter like `?include_raw=true` to make it optional (backward compatible)

## Implementation Notes

1. Modify `src/server/viewer-routes.ts` in the `/tasks/:id` handler:
   - Call `storage.getMarkdown(id)` in addition to `storage.get(id)`
   - Add `raw` field to the response object
2. Add test to verify the `raw` field is present and matches `storage.getMarkdown()` output
3. Verify the button works in the browser
