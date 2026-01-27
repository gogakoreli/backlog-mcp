# 0007. MCP Resource URI Implementation

**Date**: 2026-01-22
**Status**: Superseded by ADR-0031
**Backlog Item**: TASK-0061
**Related**: ADR 0006 (MCP Resource URI Architecture)

## Context

ADR 0006 defined the architecture for MCP resource URIs (`mcp://backlog/...`). Now we need to implement it. The key question is: **How do we structure the code to serve both MCP clients and HTTP clients without duplicating logic?**

### Current State

- MCP server uses `McpServer` from SDK with `registerTool()` for tools
- Web viewer uses HTTP endpoints (e.g., `/tasks`, `/resource`)
- Resource viewer intercepts `file://` links and dispatches `resource-open` events
- Split-pane service handles resource opening via `open(path)` method
- MCP SDK v1.25.3 supports `setRequestHandler()` with `ListResourcesRequestSchema` and `ReadResourceRequestSchema`

### Requirements

1. Register MCP resource handlers for external MCP clients
2. Add HTTP endpoint for web viewer to fetch MCP resources
3. Support both `file://` and `mcp://` URIs in link handler
4. Display both URI types in resource viewer header with copy buttons
5. Maintain backward compatibility with existing `file://` references
6. Write minimal code (~300 lines total)

## Proposed Solutions

### Option 1: Inline Resolution in Each Handler

**Description**: Implement `resolveMcpUri()` directly in `server.ts` and duplicate the logic in `viewer.ts` HTTP endpoint.

**Pros**:
- Simplest approach, no new files
- Fast to implement
- All code in one place

**Cons**:
- Duplicates URI resolution logic
- Harder to test in isolation
- Violates DRY principle
- Maintenance burden (fix bugs in two places)

**Implementation Complexity**: Low

### Option 2: Shared URI Resolver Module (SELECTED)

**Description**: Create `src/uri-resolver.ts` with `resolveMcpUri()` and `filePathToMcpUri()` functions. Use in both MCP resource handlers and HTTP endpoints.

**Pros**:
- Single source of truth for URI resolution
- Easy to test in isolation
- Follows existing codebase pattern (schema.ts, backlog.ts)
- DRY principle
- Future-proof (can add caching, validation, etc.)

**Cons**:
- Adds one new file
- Slightly more initial setup

**Implementation Complexity**: Low-Medium

### Option 3: Client-Side Resolution with Server Fallback

**Description**: Implement URI resolution in frontend (`viewer/utils/uri-resolver.ts`), try client-side first, fallback to server endpoint.

**Pros**:
- Faster (no HTTP roundtrip for local resolution)
- Works offline (if viewer is cached)

**Cons**:
- Duplicates resolution logic (frontend + backend)
- Security risk (path traversal vulnerabilities)
- Exposes file system structure to browser
- "Works offline" benefit is irrelevant (viewer requires HTTP server)
- Over-engineering for non-existent use case

**Implementation Complexity**: Medium-High

## Decision

**Selected**: Option 2 - Shared URI Resolver Module

**Rationale**:
- **DRY principle**: One place to fix bugs and add features
- **Testability**: Can unit test URI resolution independently
- **Architectural consistency**: Follows existing pattern (schema.ts, backlog.ts, etc.)
- **Serves both transports**: MCP handlers and HTTP endpoints use the same logic
- **Minimal overhead**: One new file (~50 lines) is acceptable for the benefits
- **Security**: Keeps path resolution on server side, not exposed to browser

**Trade-offs Accepted**:
- One additional file to maintain (acceptable for code quality)
- Slightly more initial setup (worth it for long-term maintainability)

## Implementation Plan

### 1. Create URI Resolver Module (`src/uri-resolver.ts`)

```typescript
export function resolveMcpUri(uri: string): string {
  // Parse mcp://backlog/... URIs to file paths
  // Throw clear errors for invalid URIs
}

export function filePathToMcpUri(filePath: string): string | null {
  // Reverse mapping: file path → mcp:// URI
  // Return null if not mappable
}

export function getRepoRoot(): string {
  // Detect repo root from package.json
}

export function getBacklogDataDir(): string {
  // Get backlog data directory from env or default
}
```

**URI Resolution Rules**:
- `mcp://backlog/tasks/{id}` → `$BACKLOG_DATA_DIR/tasks/{id}.md`
- `mcp://backlog/tasks/{id}/file` → Same as above
- `mcp://backlog/resources/{path}` → `$REPO_ROOT/{path}`
- `mcp://backlog/artifacts/{path}` → `$BACKLOG_DATA_DIR/../{path}`

### 2. Register MCP Resource Handlers (`src/server.ts`)

```typescript
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveMcpUri } from './uri-resolver.js';

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const tasks = storage.list({ limit: 1000 });
  const resources = tasks.flatMap(task => [
    {
      uri: `mcp://backlog/tasks/${task.id}`,
      name: `${task.id}: ${task.title}`,
      mimeType: 'application/json',
      description: task.description?.substring(0, 100)
    },
    {
      uri: `mcp://backlog/tasks/${task.id}/file`,
      name: `${task.id}.md`,
      mimeType: 'text/markdown'
    }
  ]);
  
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const filePath = resolveMcpUri(uri);
  
  if (!existsSync(filePath)) {
    throw new Error(`Resource not found: ${uri}`);
  }
  
  const content = readFileSync(filePath, 'utf-8');
  
  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: content
    }]
  };
});
```

### 3. Add HTTP Proxy Endpoint (`src/viewer.ts`)

```typescript
// GET /mcp/resource?uri=mcp://backlog/...
if (req.url?.startsWith('/mcp/resource?')) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const uri = url.searchParams.get('uri');
  
  if (!uri?.startsWith('mcp://backlog/')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid MCP URI' }));
    return;
  }
  
  try {
    const filePath = resolveMcpUri(uri);
    const content = readFileSync(filePath, 'utf-8');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
    
    let frontmatter = {};
    let bodyContent = content;
    if (ext === 'md') {
      const matter = await import('gray-matter');
      const parsed = matter.default(content);
      frontmatter = parsed.data;
      bodyContent = parsed.content;
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      content: bodyContent,
      frontmatter,
      type: mimeMap[ext] || 'text/plain',
      path: filePath,
      uri,
      ext 
    }));
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Resource not found', 
      uri,
      message: (error as Error).message 
    }));
  }
  return;
}
```

### 4. Update Link Handler (`viewer/components/resource-viewer.ts`)

```typescript
// Intercept both file:// and mcp:// links
setTimeout(() => {
  article.querySelectorAll('a[href^="file://"], a[href^="mcp://"]').forEach(link => {
    const href = link.getAttribute('href')!;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('resource-open', { 
        detail: { uri: href },
        bubbles: true 
      }));
    });
  });
}, 0);
```

### 5. Update Resource Loading (`viewer/components/resource-viewer.ts`)

```typescript
async loadResource(uri: string) {
  this.loading = true;
  
  try {
    let data;
    
    if (uri.startsWith('mcp://backlog/')) {
      // Fetch via MCP proxy endpoint
      const response = await fetch(`/mcp/resource?uri=${encodeURIComponent(uri)}`);
      if (!response.ok) throw new Error(`Failed to load resource: ${response.statusText}`);
      data = await response.json();
    } else {
      // Existing file:// logic
      const path = uri.replace('file://', '');
      const response = await fetch(`/resource?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(`Failed to load resource: ${response.statusText}`);
      data = await response.json();
    }
    
    this.data = data;
    this.render();
  } catch (error) {
    this.error = (error as Error).message;
  } finally {
    this.loading = false;
  }
}
```

### 6. Add URI Header with Copy Buttons (`viewer/components/resource-viewer.ts`)

```typescript
private renderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'resource-header';
  
  const uriSection = document.createElement('div');
  uriSection.className = 'uri-section';
  
  // Show current URI
  const currentUri = this.data?.uri || this.data?.path;
  if (currentUri) {
    uriSection.appendChild(this.createUriRow(currentUri, 'Current URI'));
  }
  
  // Show alternative URI if mappable
  const altUri = this.getAlternativeUri(currentUri);
  if (altUri) {
    uriSection.appendChild(this.createUriRow(altUri, 'Alternative URI'));
  }
  
  header.appendChild(uriSection);
  return header;
}

private createUriRow(uri: string, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'uri-row';
  
  const labelEl = document.createElement('span');
  labelEl.className = 'uri-label';
  labelEl.textContent = label;
  
  const uriEl = document.createElement('code');
  uriEl.className = 'uri-value';
  uriEl.textContent = uri;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-outline btn-sm';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(uri);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy', 2000);
  };
  
  row.appendChild(labelEl);
  row.appendChild(uriEl);
  row.appendChild(copyBtn);
  
  return row;
}

private getAlternativeUri(uri: string): string | null {
  // Simple heuristic mapping
  if (uri.startsWith('file://')) {
    // Try to map file:// to mcp://
    const path = uri.replace('file://', '');
    if (path.includes('/.backlog/tasks/')) {
      const match = path.match(/TASK-\d+|EPIC-\d+/);
      if (match) return `mcp://backlog/tasks/${match[0]}`;
    }
    if (path.includes('/backlog-mcp/')) {
      const repoPath = path.split('/backlog-mcp/')[1];
      return `mcp://backlog/resources/${repoPath}`;
    }
  } else if (uri.startsWith('mcp://backlog/')) {
    // Could map back to file:// but less useful
    return null;
  }
  return null;
}
```

## Consequences

**Positive**:
- Clean separation of concerns (URI resolution is isolated)
- Easy to test and maintain
- Serves both MCP clients and HTTP clients with same logic
- Backward compatible with existing `file://` references
- Extensible (can add caching, validation, etc.)

**Negative**:
- One additional file to maintain (acceptable trade-off)
- Slightly more code than inline approach (~50 extra lines)

**Risks**:
- **Path traversal vulnerabilities**: Mitigated by strict URI validation in `resolveMcpUri()`
- **Breaking existing file:// links**: Mitigated by keeping both schemes working
- **MCP server unavailable**: Mitigated by fallback to file:// in link handler

## Testing Strategy

1. **Unit tests** for `uri-resolver.ts`:
   - Valid MCP URIs resolve correctly
   - Invalid URIs throw clear errors
   - Reverse mapping works for common paths
   
2. **Integration tests** for MCP handlers:
   - ListResources returns task resources
   - ReadResource fetches content correctly
   - 404 for missing resources

3. **E2E tests** for viewer:
   - Clicking `mcp://` links opens resources
   - Clicking `file://` links still works
   - Copy buttons work
   - Both URIs display in header

4. **Backward compatibility tests**:
   - Existing `file://` references continue working
   - No breaking changes to existing tasks

## Success Metrics

- [ ] MCP resources registered and listable via MCP protocol
- [ ] `mcp://` URIs resolve correctly in viewer
- [ ] `file://` URIs still work (backward compatibility)
- [ ] Copy MCP URI button in resource viewer header
- [ ] No breaking changes to existing functionality
- [ ] Code is testable and maintainable

## Implementation Notes

### Error Handling

- Invalid MCP URI → Throw with clear message
- Resource not found → 404 with URI in error
- MCP server error → Log and fallback to file://
- File read error → 500 with details

### Security Considerations

- Validate URI format before resolution
- Prevent path traversal (no `..` in paths)
- Keep resolution logic server-side only
- Sanitize error messages (don't leak file paths)

### Performance

- No caching initially (premature optimization)
- File I/O is fast enough for local use
- Can add caching later if needed

### Future Enhancements

- Resource templates (MCP SDK supports this)
- Resource metadata (tags, descriptions)
- Versioning (`mcp://backlog/resources/docs/adr/0006@v2`)
- Search by content
- Permissions/access control
