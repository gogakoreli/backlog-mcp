# write_resource Tool - Usage Guide

## Overview

The `write_resource` tool enables efficient editing of task descriptions using operation-based updates. Instead of reading and rewriting entire descriptions, you send only the changes.

**Efficiency**: 10-100x reduction in tokens for large descriptions!

## URI Format

```
mcp://backlog/tasks/{TASK-ID}/{field}
```

**Supported fields**:
- `description` - Task description (markdown body only)
- `file` - Entire markdown file (frontmatter + description)

**Examples**:
```
mcp://backlog/tasks/TASK-0039/description
mcp://backlog/tasks/TASK-0001/file
```

## Operations

### str_replace

Replace exact string match:

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "str_replace",
    old_str: "## Old Section\nOld content",
    new_str: "## New Section\nNew content"
  }
```

### append

Add content to end:

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "append",
    content: "\n## New Findings\n\nAdditional research..."
  }
```

### prepend

Add content to beginning:

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "prepend",
    content: "# Important Note\n\n"
  }
```

### insert

Insert at specific line (0-based):

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "insert",
    line: 5,
    content: "New line inserted at position 5"
  }
```

### delete

Remove exact string:

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "delete",
    content: "Section to remove\n"
  }
```

## Efficiency Comparison

### Old Way (Inefficient)

```javascript
// 1. Get entire task
backlog_get id="TASK-0039"
// → Returns 5000 char description

// 2. Modify in memory
// 3. Update with entire content
backlog_update id="TASK-0039" description="<entire 5000 chars>"

// Cost: ~10,000 tokens
```

### New Way (Efficient)

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={ type: "append", content: "\n## New Section\n..." }

// Cost: ~100 tokens
// 100x more efficient!
```

## Error Handling

### str_replace not found

```
Error: str_replace failed: old_str not found in content
```

**Solution**: Check current content with `backlog_get`, ensure exact match.

### Invalid URI

```
Error: Invalid URI format
Expected format: mcp://backlog/tasks/TASK-0039/description
```

**Solution**: Use correct URI format with task ID and field.

### Task not found

```
Error: Task not found: TASK-9999
```

**Solution**: Verify task ID exists with `backlog_list`.

## Best Practices

1. **Use append for adding sections** - No need to read first
2. **Use str_replace for surgical edits** - Precise changes
3. **Batch related changes** - Multiple operations if needed
4. **Check errors** - Handle str_replace failures gracefully

## When to Use

**Use write_resource when**:
- ✅ Appending new sections to long descriptions
- ✅ Replacing specific sections
- ✅ Making surgical edits
- ✅ Working with descriptions > 1000 chars

**Use backlog_update when**:
- ✅ Updating metadata (title, status, etc.)
- ✅ Replacing entire short descriptions
- ✅ Updating multiple fields at once

## Examples

### Add research findings

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "append",
    content: "\n## Research Findings\n\n- Found X\n- Discovered Y\n- Learned Z\n"
  }
```

### Update section

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "str_replace",
    old_str: "## Implementation Notes\n\nOld approach",
    new_str: "## Implementation Notes\n\nNew approach with better performance"
  }
```

### Add header

```javascript
write_resource
  uri="mcp://backlog/tasks/TASK-0039/description"
  operation={
    type: "prepend",
    content: "⚠️ **IMPORTANT**: This task is blocked\n\n"
  }
```

## Future Enhancements

- Batch operations (multiple edits in one call)
- ETag support for conflict resolution
- Version history
- Subscriptions for real-time updates

See [ADR-0001](../adr/0001-writable-resources-design.md) for complete design.
