# 0001. Writable Resources - Efficient Data Manipulation in MCP

**Date**: 2026-01-21
**Status**: Proposed
**Backlog Item**: TASK-0039

## Context

### The Problem

Agents working with MCP data face severe efficiency problems:
- Must read and write entire content when updating (e.g., 5000 char descriptions)
- Wastes tokens (10,000+ tokens for simple edits)
- Slow and expensive
- Gets exponentially worse as content grows
- Agents have powerful native tools (fs_write) but can't use them on MCP data

### Current State

backlog-mcp stores tasks as markdown files with YAML frontmatter. The MCP layer abstracts this as JSON objects with string fields. To update a description:
1. `backlog_get` → Receive entire task with 5000 char description
2. Modify description in memory
3. `backlog_update` → Send entire 5000 char description back

This is 100x less efficient than fs_write operations (str_replace, append, etc.).

### Vision

**Enable agents to efficiently manipulate MCP data using operation-based updates, bringing fs_write-like performance to all MCP servers.**

This isn't just about backlog-mcp - it's about establishing a universal pattern for the entire MCP ecosystem.

---

## Design Proposal: Writable Resources with URI Addressing

### Core Principles

1. **URI-Addressable Resources**: Every piece of data has a unique URI
2. **Operation-Based Updates**: Send only deltas, not full content
3. **Content-Type Aware**: Operations match the data type
4. **Self-Documenting**: Resources expose their capabilities
5. **Production-Ready**: Versioning, transactions, permissions built-in

---

## 1. URI Scheme Design

### Scheme: `mcp://`

**Format**: `mcp://server/path/to/resource`

**Rationale**:
- Single scheme for all MCP resources
- Server identification built into path
- Familiar to developers (like http://, file://)
- Runtime can route based on server prefix

### Resource Hierarchy for backlog-mcp

```
mcp://backlog/tasks                              → All tasks (collection)
mcp://backlog/tasks?status=open                  → Filtered tasks
mcp://backlog/tasks/TASK-0039                    → Task object (JSON)
mcp://backlog/tasks/TASK-0039/description        → Description field (text/markdown)
mcp://backlog/tasks/TASK-0039/title              → Title field (text/plain)
mcp://backlog/tasks/TASK-0039/status             → Status field (text/plain)
mcp://backlog/tasks/TASK-0039/evidence           → Evidence array (JSON)
mcp://backlog/tasks/TASK-0039/evidence/0         → First evidence item
mcp://backlog/tasks/TASK-0039/file               → Raw markdown file
mcp://backlog/tasks/TASK-0039/metadata           → Frontmatter only

mcp://backlog/epics                              → All epics
mcp://backlog/epics/EPIC-0002                    → Specific epic
mcp://backlog/epics/EPIC-0002/tasks              → Tasks in epic

mcp://backlog/archive                            → Archived tasks
```

**Design Decisions**:
- Hierarchical: Parent/child relationships clear
- Predictable: Consistent patterns across resources
- Human-readable: Easy to construct and understand
- Extensible: Can add new resource types without breaking

---

## 2. Content Types and Operations

### Text Resources (text/markdown, text/plain)

**Supported Operations**:
- `str_replace`: Replace exact string match
- `insert`: Insert at line number
- `append`: Add to end
- `prepend`: Add to beginning
- `delete`: Remove exact string match

**Example**:
```json
{
  "method": "resources/write",
  "params": {
    "uri": "mcp://backlog/tasks/TASK-0039/description",
    "operation": {
      "type": "str_replace",
      "old_str": "## Old Section\nOld content",
      "new_str": "## New Section\nNew content"
    }
  }
}
```

### Structured Data (application/json)

**Object Operations**:
- `set`: Set field value
- `merge`: Deep merge object
- `delete_field`: Remove field

**Array Operations**:
- `array_append`: Add to end
- `array_prepend`: Add to beginning
- `array_insert`: Insert at index
- `array_remove`: Remove by index or value

**Example**:
```json
{
  "method": "resources/write",
  "params": {
    "uri": "mcp://backlog/tasks/TASK-0039/evidence",
    "operation": {
      "type": "array_append",
      "value": "Updated description with new findings"
    }
  }
}
```

---

## 3. Resource Discovery and Capabilities

### Resource Metadata

Resources expose their capabilities:

```json
{
  "method": "resources/read",
  "params": { "uri": "mcp://backlog/tasks/TASK-0039/description" }
}
→ Response:
{
  "uri": "mcp://backlog/tasks/TASK-0039/description",
  "mimeType": "text/markdown",
  "size": 5234,
  "etag": "abc123",
  "capabilities": {
    "readable": true,
    "writable": true,
    "subscribable": true,
    "operations": ["str_replace", "insert", "append", "prepend", "delete"]
  },
  "permissions": {
    "read": true,
    "write": true,
    "delete": false
  },
  "contents": "# Task Description\n..."
}
```

### Resource Schema Discovery

Agents can discover resource structure:

```json
{
  "method": "resources/schema",
  "params": { "uri": "mcp://backlog/tasks/TASK-0039" }
}
→ Response:
{
  "uri": "mcp://backlog/tasks/TASK-0039",
  "type": "object",
  "properties": {
    "description": {
      "uri": "mcp://backlog/tasks/TASK-0039/description",
      "type": "text/markdown",
      "writable": true,
      "description": "Task description in markdown format"
    },
    "title": {
      "uri": "mcp://backlog/tasks/TASK-0039/title",
      "type": "text/plain",
      "writable": true,
      "maxLength": 200
    },
    "status": {
      "uri": "mcp://backlog/tasks/TASK-0039/status",
      "type": "text/plain",
      "writable": true,
      "enum": ["open", "in_progress", "blocked", "done", "cancelled"]
    }
  }
}
```

**Benefits**:
- Self-documenting resources
- Agents discover capabilities dynamically
- Type-safe operations
- Clear validation rules

---

## 4. Versioning and Conflict Resolution

### Optimistic Locking with ETags

```json
// Read with ETag
resources/read uri="mcp://backlog/tasks/TASK-0039/description"
→ { "contents": "...", "etag": "abc123" }

// Conditional write
resources/write 
  uri="mcp://backlog/tasks/TASK-0039/description"
  etag="abc123"  // Must match current version
  operation={ type: "append", content: "..." }

// If ETag doesn't match → 409 Conflict
→ {
    "error": {
      "code": "conflict",
      "message": "Resource was modified by another agent",
      "current_etag": "def456",
      "suggestion": "Read the resource again and retry your operation"
    }
  }
```

### Version History (Optional)

```json
resources/list_versions uri="mcp://backlog/tasks/TASK-0039/description"
→ [
    { 
      "version": 3, 
      "etag": "def456", 
      "timestamp": "2026-01-21T12:00:00Z", 
      "author": "agent-1",
      "operation": { "type": "append", "content": "..." }
    },
    { 
      "version": 2, 
      "etag": "abc123", 
      "timestamp": "2026-01-21T11:30:00Z", 
      "author": "agent-2",
      "operation": { "type": "str_replace", ... }
    }
  ]

resources/read uri="mcp://backlog/tasks/TASK-0039/description" version=2
→ { "contents": "...", "etag": "abc123" }
```

**Benefits**:
- Safe concurrent editing
- Audit trail
- Rollback capability
- Conflict detection

---

## 5. Query Parameters and Filtering

### Collection Queries

```
mcp://backlog/tasks?status=open
mcp://backlog/tasks?status=open&status=in_progress
mcp://backlog/tasks?epic_id=EPIC-0002
mcp://backlog/tasks?limit=50&offset=0
mcp://backlog/tasks?sort=updated_at&order=desc
mcp://backlog/tasks?search=authentication
```

### Advanced Filtering

```
mcp://backlog/tasks?filter=status:open,epic_id:EPIC-0002
mcp://backlog/tasks?filter=created_at>2026-01-01
mcp://backlog/tasks?filter=title~"auth"
```

### Aggregations

```
mcp://backlog/tasks?aggregate=count&group_by=status
→ { "open": 5, "in_progress": 3, "done": 42 }
```

**Benefits**:
- Powerful querying without custom tools
- URI becomes a complete query language
- Familiar REST-like patterns

---

## 6. Transactions and Batch Operations

### Batch Write

```json
{
  "method": "resources/write_batch",
  "params": {
    "operations": [
      {
        "uri": "mcp://backlog/tasks/TASK-0039/description",
        "operation": { "type": "append", "content": "\n## New Section\n..." }
      },
      {
        "uri": "mcp://backlog/tasks/TASK-0039/status",
        "operation": { "type": "set", "value": "in_progress" }
      },
      {
        "uri": "mcp://backlog/tasks/TASK-0039/evidence",
        "operation": { "type": "array_append", "value": "Updated description" }
      }
    ],
    "atomic": true  // All succeed or all fail
  }
}
```

**Transaction Semantics**:
- `atomic: true` → All operations succeed or all rollback
- `atomic: false` → Best effort, return success/failure per operation

**Use Cases**:
- Update description and status together
- Move task between epics atomically
- Archive task (move file + update metadata)

---

## 7. Subscriptions and Real-Time Updates

### Subscribe to Resource Changes

```json
{
  "method": "resources/subscribe",
  "params": {
    "uri": "mcp://backlog/tasks/TASK-0039/description"
  }
}

// Server sends notifications when resource changes
→ {
    "method": "resources/changed",
    "params": {
      "uri": "mcp://backlog/tasks/TASK-0039/description",
      "etag": "new-etag",
      "change": {
        "type": "str_replace",
        "old_str": "...",
        "new_str": "..."
      },
      "author": "agent-2",
      "timestamp": "2026-01-21T12:05:00Z"
    }
  }
```

### Subscribe to Collections

```json
resources/subscribe uri="mcp://backlog/tasks?status=open"
→ Get notified when tasks are added/removed from filtered set
```

**Use Cases**:
- Multiple agents collaborating on same task
- Real-time dashboards
- Conflict detection
- Audit trails

---

## 8. Permissions and Access Control

### Resource Permissions

```json
resources/read uri="mcp://backlog/tasks/TASK-0039/description"
→ {
    "contents": "...",
    "permissions": {
      "read": true,
      "write": true,
      "delete": false,
      "share": true
    }
  }
```

### Permission Enforcement

```json
resources/write uri="mcp://backlog/archive/TASK-0001/description"
  operation={ type: "append", content: "..." }
→ 403 Forbidden
{
  "error": {
    "code": "permission_denied",
    "message": "Archived tasks are read-only"
  }
}
```

**For backlog-mcp**:
- All tasks readable by all agents
- Active tasks writable
- Archived tasks read-only
- Protected fields: id, created_at, type

---

## 9. Error Handling and Validation

### Error Response Format

```json
{
  "error": {
    "code": "operation_failed",
    "message": "str_replace failed: old_str not found",
    "details": {
      "operation": "str_replace",
      "old_str": "## Old Section",
      "searched_content_preview": "## Current Section\n## Another Section\n...",
      "suggestion": "Check if the content has changed. Use resources/read to get current content."
    }
  }
}
```

### Error Codes

- `not_found` - Resource doesn't exist
- `permission_denied` - No write permission
- `conflict` - ETag mismatch (concurrent edit)
- `operation_failed` - Operation couldn't be applied
- `invalid_operation` - Operation not supported for this resource type
- `validation_failed` - Content doesn't meet validation rules

### Validation Example

```json
resources/write uri="mcp://backlog/tasks/TASK-0039/status"
  operation={ type: "set", value: "invalid_status" }
→ {
    "error": {
      "code": "validation_failed",
      "message": "Invalid status value",
      "details": {
        "field": "status",
        "value": "invalid_status",
        "allowed_values": ["open", "in_progress", "blocked", "done", "cancelled"]
      }
    }
  }
```

---

## 10. Agent Runtime Integration

### Agent-Agnostic Core: MCP Tool

**Primary Approach**: Implement as standard MCP tool `write_resource`

```javascript
// Any agent, any MCP runtime
@backlog/write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={ type: "append", content: "..." }
```

**Benefits**:
- ✅ Agent-agnostic (works with Kiro, Claude Desktop, any MCP client)
- ✅ No runtime coupling
- ✅ Standard MCP protocol
- ✅ Works today, no spec changes needed

### Optional Enhancement: Runtime Hooks (Kiro)

For Kiro users who want native fs_write experience:

```javascript
// Agent uses fs_write naturally
fs_write 
  path="mcp://backlog/tasks/TASK-0039/description"
  command="append"
  content="..."

// Kiro hook intercepts, translates to write_resource
// Completely optional - core works without it
```

**Implementation**: Separate package `mcp-fs-proxy-hook`
- PreToolUse hook intercepts fs_write with mcp:// paths
- Translates to write_resource MCP call
- Returns result via stderr, blocks original fs_write
- Users opt-in by installing hook

### Path to Standardization

**Long-term**: Propose `resources/write` as MCP protocol extension
- Like `resources/read` but for writing
- Universal operation, not server-specific tool
- Becomes part of MCP spec

**Evolution**:
1. Implement as tool (today)
2. Prove value and adoption
3. Propose RFC to MCP community
4. Standardize as protocol operation
5. Migrate from tool to protocol

---

## Implementation Phases

### Phase 1: Core Implementation (Week 1)

**Goal**: Implement agent-agnostic MCP tool

**Tasks**:
1. Add `write_resource` MCP tool to backlog-mcp
2. Implement URI parsing (mcp://backlog/tasks/TASK-0039/description)
3. Support core operations: str_replace, append, prepend
4. Map operations to file edits (using gray-matter for frontmatter)
5. Add comprehensive tests
6. Error handling with helpful messages

**Deliverable**: Working MCP tool demonstrating 10-100x efficiency gains

**Effort**: 3-4 hours

### Phase 2: Production Features (Week 2)

**Goal**: Make it production-ready

**Tasks**:
1. Add ETag support for conflict resolution
2. Implement batch operations
3. Add all operation types (insert, delete, array ops)
4. Robust error handling with helpful messages
5. Validation for all operations
6. Performance testing

**Effort**: 3-4 hours

### Phase 3: Advanced Features (Week 3)

**Goal**: Enable advanced workflows

**Tasks**:
1. Resource schema discovery
2. Query parameters and filtering
3. Permissions system
4. Subscriptions (if MCP supports)
5. Version history (optional)

**Effort**: 4-6 hours

### Phase 4: Documentation & Ecosystem (Ongoing)

**Goal**: Drive adoption

**Tasks**:
1. Comprehensive documentation with examples
2. Efficiency comparison benchmarks
3. Write RFC for MCP protocol extension (resources/write)
4. Present to MCP community
5. Create optional Kiro hook package (mcp-fs-proxy-hook)
6. Encourage other MCP servers to adopt pattern

**Effort**: Ongoing

---

## Success Metrics

### Technical Metrics

- ✅ 10-100x reduction in tokens for large content edits
- ✅ Faster operations (no need to read first for append/prepend)
- ✅ Works for local and remote MCP servers
- ✅ Backward compatible (existing tools still work)
- ✅ <100ms latency for write operations

### Adoption Metrics

- ✅ Implemented in backlog-mcp as MCP tool
- ✅ Documented with clear examples
- ✅ Positive feedback from users (5+ testimonials)
- ✅ Adopted by 2+ other MCP servers
- ✅ Proposed as MCP protocol extension
- ✅ Optional Kiro hook package available

### Ecosystem Impact

- ✅ Becomes standard pattern in MCP ecosystem
- ✅ Referenced in MCP best practices
- ✅ Used by 100+ agents
- ✅ Reduces aggregate token usage by 50%+

---

## Risks and Mitigations

### Risk 1: MCP Protocol Compatibility

**Risk**: Proposed features may not align with MCP spec
**Mitigation**: Start with MCP-compatible subset, propose extensions separately

### Risk 2: Complexity

**Risk**: Too many features, hard to implement/use
**Mitigation**: Phased rollout, start with core features only

### Risk 3: Adoption

**Risk**: Other MCP servers don't adopt the pattern
**Mitigation**: Prove value first, create compelling documentation, engage community early

### Risk 4: Performance

**Risk**: Operations may be slower than expected
**Mitigation**: Benchmark early, optimize hot paths, consider caching

### Risk 5: Concurrent Edits

**Risk**: Conflict resolution may be insufficient
**Mitigation**: Start with optimistic locking (ETags), add operational transform if needed

---

## Alternatives Considered

### Alternative 1: Custom MCP Tools

Create tools like `backlog_edit_description` that mirror fs_write operations.

**Pros**: Simple, no protocol changes
**Cons**: Every MCP server needs custom tools, doesn't scale, agents learn different APIs

**Decision**: Rejected - doesn't solve the ecosystem problem

### Alternative 2: Expose File Paths (Local Only)

Return file paths in task objects, let agents use fs_write directly.

**Pros**: Maximum efficiency for local MCP
**Cons**: Breaks abstraction, doesn't work for remote MCP, security concerns

**Decision**: Rejected - too narrow, breaks MCP principles

### Alternative 3: Virtual Filesystem (FUSE)

Mount MCP resources as local filesystem.

**Pros**: Completely transparent to agents
**Cons**: Very complex, platform-specific, doesn't work for remote MCP

**Decision**: Rejected - too complex, limited applicability

### Alternative 4: Automatic Diffing in Runtime

Runtime automatically computes diffs and sends only changes.

**Pros**: Transparent optimization
**Cons**: Magic behavior, still requires MCP server support, complex

**Decision**: Rejected - too implicit, prefer explicit operations

---

## Decision

**Selected**: Writable Resources via MCP Tool (agent-agnostic)

**Primary Implementation**: `write_resource` MCP tool
- Works with any MCP client (Kiro, Claude Desktop, etc.)
- No runtime coupling
- Standard MCP protocol
- Can be called by any agent

**Optional Enhancement**: Kiro hook for fs_write integration
- Separate package for users who want it
- Not required for core functionality
- Provides native tool experience

**Path to Standardization**: Propose as MCP protocol extension
- Start as tool, prove value
- Propose `resources/write` protocol operation
- Evolve to universal standard

**Rationale**:
- Works for local AND remote MCP servers
- Agent-agnostic (no runtime coupling)
- Scales to entire MCP ecosystem
- Familiar patterns (URIs, operations)
- Extensible (can add features incrementally)
- Production-ready (versioning, transactions, permissions)
- Clear path to standardization

**Trade-offs Accepted**:
- Agents need to learn new tool (but similar to fs_write)
- Not as transparent as native fs_write (but optional hook provides that)
- May require MCP protocol extension for full standardization (but works as tool today)

---

## Next Steps

1. **Review this proposal** - Get feedback from stakeholders
2. **Refine the design** - Incorporate feedback
3. **Create implementation plan** - Break down Phase 1 into tasks
4. **Start coding** - Implement Phase 1 in backlog-mcp
5. **Document and share** - Write blog post, share with community

---

## References

- MCP Specification: https://modelcontextprotocol.io/
- REST API Design Best Practices
- Git's operational model (diffs, patches)
- Operational Transform / CRDTs for collaborative editing
- HTTP PATCH method (RFC 5789)
