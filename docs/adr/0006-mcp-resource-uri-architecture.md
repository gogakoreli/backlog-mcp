# 0006. MCP Resource URI Architecture

**Date**: 2026-01-22
**Status**: Superseded by ADR-0031
**Related**: ADR 0004 (MCP Resource Viewer Integration)

## Context

Currently, the backlog viewer uses `file://` URIs to reference resources (ADRs, logs, source code, artifacts). While this works, it has limitations:

- **Machine-specific paths** - `/Users/gkoreli/...` breaks on different machines
- **Not portable** - Can't share tasks across team members
- **Verbose** - Long absolute paths clutter markdown
- **No abstraction** - Direct file system coupling

We want to transition to MCP resource URIs (`mcp://backlog/...`) for:
- **Portability** - Works on any machine with backlog-mcp installed
- **Semantic clarity** - `mcp://backlog/resources/docs/adr/0004` is self-documenting
- **Abstraction** - Can change storage without breaking references
- **Future extensibility** - Can add metadata, permissions, versioning

### Key Constraint: Backward Compatibility

We must maintain `file://` support indefinitely because:
1. Existing tasks have hundreds of `file://` references
2. External tools (OS file browsers) understand `file://`
3. No flag day - gradual migration is essential
4. Fallback mechanism if MCP server unavailable

### Portability Consideration

When sharing markdown with LLMs without MCP access:
- Both `file://` and `mcp://` URIs are unresolvable
- LLM will request file content regardless of URI scheme
- backlog-mcp is small, open-source, easy to install (`npx backlog-mcp`)
- Can provide shell script to translate MCP URIs to local paths if needed

**Conclusion**: URI scheme doesn't affect external LLM portability. Use what works best for the ecosystem.

## Proposed MCP Resource URI Structure

### URI Scheme

```
mcp://backlog/tasks/{taskId}              → Task data (JSON)
mcp://backlog/tasks/{taskId}/file         → Task markdown file
mcp://backlog/resources/{relativePath}    → Any file in repo
mcp://backlog/artifacts/{path}            → Artifact files
```

### Examples

```
mcp://backlog/tasks/TASK-0001
  → Task 0001 data (id, title, status, description, etc.)

mcp://backlog/tasks/TASK-0001/file
  → /Users/gkoreli/.backlog/tasks/TASK-0001.md

mcp://backlog/resources/docs/adr/0004-mcp-resource-viewer.md
  → /Users/gkoreli/Documents/goga/backlog-mcp/docs/adr/0004-mcp-resource-viewer.md

mcp://backlog/resources/viewer/components/resource-viewer.ts
  → /Users/gkoreli/Documents/goga/backlog-mcp/viewer/components/resource-viewer.ts

mcp://backlog/artifacts/task-0060/artifact.md
  → /Users/gkoreli/.backlog/backlog-mcp-engineer/mcp-resource-viewer-implementation-2026-01-22/artifact.md
```

### Path Resolution Rules

1. **Tasks**: `mcp://backlog/tasks/{id}` → `$BACKLOG_DATA_DIR/tasks/{id}.md`
2. **Resources**: `mcp://backlog/resources/{path}` → `$REPO_ROOT/{path}`
3. **Artifacts**: `mcp://backlog/artifacts/{path}` → `$BACKLOG_DATA_DIR/../{path}`

Where:
- `$BACKLOG_DATA_DIR` = `~/.backlog/` (or `BACKLOG_DATA_DIR` env var)
- `$REPO_ROOT` = `/Users/gkoreli/Documents/goga/backlog-mcp` (detected from package.json)

## Implementation Architecture

### Backend: MCP Resource Registration

```typescript
// src/server.ts

import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const tasks = storage.list({ limit: 1000 });
  const resources: Resource[] = [];
  
  // Task resources
  tasks.forEach(task => {
    resources.push({
      uri: `mcp://backlog/tasks/${task.id}`,
      name: `Task ${task.id}: ${task.title}`,
      mimeType: 'application/json',
      description: task.description?.substring(0, 100)
    });
    
    resources.push({
      uri: `mcp://backlog/tasks/${task.id}/file`,
      name: `${task.id}.md`,
      mimeType: 'text/markdown'
    });
  });
  
  // File system resources (ADRs, source code, etc.)
  // Dynamically discover or register known paths
  resources.push({
    uri: 'mcp://backlog/resources/docs/adr',
    name: 'Architecture Decision Records',
    mimeType: 'text/markdown'
  });
  
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  
  // Parse and resolve MCP URI to file path
  const filePath = resolveMcpUri(uri);
  
  if (!existsSync(filePath)) {
    throw new Error(`Resource not found: ${uri}`);
  }
  
  const content = readFileSync(filePath, 'utf-8');
  const mimeType = detectMimeType(filePath);
  
  return {
    contents: [{
      uri,
      mimeType,
      text: content
    }]
  };
});

function resolveMcpUri(uri: string): string {
  const url = new URL(uri);
  
  if (url.hostname !== 'backlog') {
    throw new Error(`Invalid MCP URI: ${uri}`);
  }
  
  const path = url.pathname.substring(1); // Remove leading /
  
  if (path.startsWith('tasks/')) {
    const match = path.match(/^tasks\/([^/]+)(\/file)?$/);
    if (!match) throw new Error(`Invalid task URI: ${uri}`);
    
    const taskId = match[1];
    return storage.getFilePath(taskId);
  }
  
  if (path.startsWith('resources/')) {
    const relativePath = path.substring('resources/'.length);
    return join(getRepoRoot(), relativePath);
  }
  
  if (path.startsWith('artifacts/')) {
    const relativePath = path.substring('artifacts/'.length);
    return join(getBacklogDataDir(), '..', relativePath);
  }
  
  throw new Error(`Unknown MCP URI pattern: ${uri}`);
}
```

### Frontend: Hybrid Link Handler

```typescript
// viewer/components/resource-viewer.ts or link handler

async function handleResourceLink(href: string) {
  if (href.startsWith('file://')) {
    // Legacy file:// URIs - direct file access
    const path = href.replace('file://', '');
    splitPane.open(path);
  } 
  else if (href.startsWith('mcp://backlog/')) {
    // MCP URIs - fetch via MCP protocol
    try {
      const content = await fetchMcpResource(href);
      splitPane.openContent(content, href);
    } catch (error) {
      // Fallback: try to resolve to file:// path
      const filePath = tryResolveMcpToFile(href);
      if (filePath) {
        splitPane.open(filePath);
      } else {
        throw error;
      }
    }
  }
  else {
    // Relative paths or other schemes
    console.warn(`Unsupported URI scheme: ${href}`);
  }
}

async function fetchMcpResource(uri: string): Promise<ResourceContent> {
  // Call MCP server to read resource
  // This would use MCP client SDK or HTTP API
  const response = await fetch(`/mcp/resource?uri=${encodeURIComponent(uri)}`);
  return response.json();
}

function tryResolveMcpToFile(uri: string): string | null {
  // Best-effort local resolution as fallback
  // Same logic as backend resolveMcpUri()
  try {
    return resolveMcpUri(uri);
  } catch {
    return null;
  }
}
```

### Viewer Backend: MCP Proxy Endpoint

```typescript
// src/viewer.ts - Add MCP resource proxy

// GET /mcp/resource?uri=mcp://backlog/...
if (req.url?.startsWith('/mcp/resource?')) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const uri = url.searchParams.get('uri');
  
  if (!uri || !uri.startsWith('mcp://backlog/')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid MCP URI' }));
    return;
  }
  
  try {
    // Resolve MCP URI to file path
    const filePath = resolveMcpUri(uri);
    const content = readFileSync(filePath, 'utf-8');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
    
    // Parse frontmatter if markdown
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

## Migration Strategy

### Phase 1: Implement MCP Resources (Backward Compatible)

1. Register MCP resource handlers in server.ts
2. Add `/mcp/resource` proxy endpoint to viewer.ts
3. Update link handler to support both `file://` and `mcp://`
4. Keep all existing `file://` references working

**No breaking changes** - purely additive.

### Phase 2: Start Using MCP URIs

1. New task references use `mcp://` URIs
2. LLMs start generating `mcp://` references
3. Old `file://` references continue working
4. Gradual organic migration

### Phase 3: Tooling Support

1. Add "Copy MCP URI" button to resource viewer header
2. Add command to convert `file://` → `mcp://` in markdown
3. Add validation to warn about machine-specific paths

### Phase 4: Optional Cleanup

1. Migrate high-value references (ADRs, frequently accessed files)
2. Leave low-value references as `file://` (no harm)
3. Never force migration - both work forever

## Backward Compatibility Guarantees

### Will NOT Break

✅ Existing `file://` references continue working indefinitely
✅ External tools can still use `file://` URIs
✅ No changes required to existing tasks
✅ Fallback mechanism if MCP server unavailable

### Will Break (Acceptable)

⚠️ Machine-specific `file://` paths won't work on different machines (already broken)
⚠️ MCP URIs require backlog-mcp installed (acceptable - it's our tool)

## Risks and Mitigations

### Risk: MCP Server Unavailable

**Mitigation**: Fallback to direct file:// resolution
```typescript
try {
  return await fetchMcpResource(uri);
} catch {
  return await fetchFileResource(resolveMcpToFile(uri));
}
```

### Risk: URI Resolution Complexity

**Mitigation**: Keep resolution logic simple and well-tested
- Clear mapping rules
- Comprehensive tests
- Fallback to file:// on errors

### Risk: Breaking Old References

**Mitigation**: Never remove `file://` support
- Both schemes work forever
- No forced migration
- Gradual, organic transition

## Success Metrics

- [ ] MCP resources registered and listable
- [ ] `mcp://` URIs resolve correctly in viewer
- [ ] `file://` URIs still work (backward compatibility)
- [ ] LLMs can read resources via MCP protocol
- [ ] Copy MCP URI button in resource viewer
- [ ] No breaking changes to existing tasks

## Future Enhancements

1. **Resource metadata** - Add tags, descriptions, permissions
2. **Versioning** - `mcp://backlog/resources/docs/adr/0004@v2`
3. **Search** - Find resources by content, not just path
4. **Permissions** - Control access to sensitive resources
5. **Caching** - Cache frequently accessed resources
6. **Sync** - Sync resources across machines

## Decision

**Implement hybrid MCP + file:// URI support**

- Register MCP resources for tasks and file system resources
- Support both `file://` and `mcp://` in link handler
- Use `mcp://` for new references going forward
- Keep `file://` working indefinitely for backward compatibility
- Gradual migration with no breaking changes

**Rationale**:
- Provides portability benefits of MCP URIs
- Maintains backward compatibility with existing references
- Allows gradual, organic migration
- No forced changes or flag day
- Best of both worlds

## Implementation Notes

### MCP SDK Usage

The MCP SDK provides request schemas for resource operations:
- `ListResourcesRequestSchema` - List available resources
- `ReadResourceRequestSchema` - Read resource content
- `ListResourceTemplatesRequestSchema` - List resource templates (future)

### Error Handling

- Invalid MCP URI → 400 Bad Request
- Resource not found → 404 Not Found
- MCP server error → Fallback to file:// resolution
- File read error → 500 Internal Server Error

### Testing Strategy

1. Unit tests for URI resolution logic
2. Integration tests for MCP resource handlers
3. E2E tests for viewer link handling
4. Backward compatibility tests for file:// URIs

### Documentation

- Update README with MCP URI examples
- Document URI resolution rules
- Provide migration guide for file:// → mcp://
- Add troubleshooting guide for URI resolution issues
