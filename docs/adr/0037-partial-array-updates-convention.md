# 0037. Partial Array Updates with add_/remove_ Convention

**Date**: 2026-01-29
**Status**: Proposed
**Backlog Item**: TASK-0135

## Context

### The Incident

TASK-0134 was created by the triage agent with malformed references:
```yaml
references:
  - url: 'mcp://backlog/tasks/TASK-0115'    # WRONG - missing .md
  - url: 'mcp://backlog/tasks/TASK-0130'    # WRONG - missing .md
```

The correct format is `mcp://backlog/tasks/TASK-XXXX.md`. This revealed a deeper problem: agents don't reliably handle array field updates.

### The Core Problem

When an agent wants to add ONE reference to a task, the current workflow requires:

1. Fetch task with `backlog_get` 
2. Extract existing references array
3. Merge new reference with existing ones
4. Call `backlog_update` with complete merged list

**Why agents fail at this:**
- LLMs optimize for minimal tool calls
- The "fetch first" step feels redundant when you just want to add something
- Agents forget to preserve existing data when they do fetch
- The mental model of "update" implies "add to" not "replace all"

This is not a bug in agent behavior - it's a UX problem with the API design. The API's "full replace" semantics don't match the agent's intent of "add this reference."

### Why This Is an MCP-Specific Problem

Traditional REST APIs have the same issue, but human developers:
- Read documentation carefully
- Build helper functions for common patterns
- Debug and fix when data is lost

LLM agents:
- Infer behavior from tool descriptions
- Optimize for fewest tool calls
- Don't notice when data is silently lost
- Can't build reusable abstractions

MCP tool design must account for how agents naturally think, not just what's technically correct.

### Research Findings

**Industry patterns:**
- RFC 7396 (JSON Merge Patch): "Arrays cannot be partially updated... you have to include the entire array"
- GitHub MCP Server: Uses full replace for `labels` in `issue_write` - same problem exists
- Paperless MCP Server: Uses `add_tags` / `remove_tags` parameters in single `bulk_edit_documents` tool - **this is the solution**

**The emerging MCP pattern:** Single tool with explicit `add_*` and `remove_*` parameters, not separate tools.

### Current Array Properties in backlog-mcp

| Property | Add needed? | Remove needed? | Verdict |
|----------|-------------|----------------|---------|
| `references` | Very common | Rare but needed | **Needs add/remove** |
| `evidence` | Common | Very rare | Full replace OK |
| `blocked_reason` | Rare | Rare | Full replace OK |

Only `references` truly benefits from partial update semantics.

## Proposed Solutions

### Option A: Specific Solution (references only)

Add `add_references` and `remove_references` to schema. No convention, just explicit fields.

**Pros:** Simple, explicit
**Cons:** Doesn't teach reusable pattern, field explosion if needed elsewhere

### Option B: Convention-Based Dynamic Schema

Document convention, implement dynamically for any array property.

**Pros:** Generalizes elegantly
**Cons:** MCP schemas are static - dynamic fields won't be discoverable. **Rejected.**

### Option C: Hybrid Convention (Recommended)

Document the `add_*/remove_*` convention, but implement explicitly for properties that need it. Start with `references` only.

**Pros:**
- Teaches convention (agents can predict pattern)
- Explicit schema (discoverable)
- Start small, expand as needed
- Matches Paperless MCP pattern

**Cons:**
- Slight redundancy (convention + explicit fields)

## Decision

**Selected**: Option C - Hybrid Convention

### Schema Changes

```typescript
// Existing (unchanged)
references: z.array(z.object({ 
  url: z.string(), 
  title: z.string().optional() 
})).optional().describe(
  'REPLACES all references. Formats: https://..., mcp://backlog/tasks/TASK-XXXX.md'
),

// New
add_references: z.array(z.object({ 
  url: z.string(), 
  title: z.string().optional() 
})).optional().describe(
  'Append references to existing (partial update)'
),

remove_references: z.array(z.string()).optional().describe(
  'Remove references by URL match (partial update)'
),
```

### Behavior Specification

**Order of operations:**
1. If `remove_references` provided → filter out matching URLs
2. If `add_references` provided → append (dedupe by URL, update title if exists)
3. If `references` provided → full replace (ignores add/remove)

**Edge cases:**
- `references: []` → clears all references
- `add_references` with existing URL → updates title only
- `remove_references` with non-existent URL → no-op (no error)
- Both `add_references` and `references` → `references` wins (full replace)

### Convention Documentation

Brief note in tool description:
```
"Note: Array fields may support add_/remove_ variants for partial updates (e.g., add_references, remove_references)."
```

## Consequences

**Positive:**
- Agents can add references without fetching first
- Data loss from accidental overwrites eliminated
- Pattern is teachable and predictable
- Backward compatible

**Negative:**
- Three fields for references concept
- Agents must learn which to use (but names are self-documenting)

**Risks:**
- Agents might still use `references` for single adds → mitigated by clear description

## Implementation Notes

1. Update `backlog-update.ts` schema with new fields
2. Update handler to implement order of operations
3. Add tests for edge cases
4. Update tool description with convention note

**Not implementing (yet):**
- `add_evidence` / `remove_evidence` - not needed
- `add_blocked_reason` / `remove_blocked_reason` - not needed
