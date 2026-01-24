# Task-Attached Resources Validator

Test that task-attached resources work correctly using the MCP tools.

## Test Workflow

1. **Create test task**
   ```
   backlog_create title="Resource Test" description="Testing task-attached resources"
   ```

2. **Create ADR resource**
   ```
   write_resource
     uri="mcp://backlog/resources/TASK-XXXX/adr-001.md"
     command="insert"
     content="# ADR 001\n\nTest content"
   ```

3. **Modify resource**
   ```
   write_resource
     uri="mcp://backlog/resources/TASK-XXXX/adr-001.md"
     command="insert"
     content="\n\n## Update\nModified content"
   ```

4. **Create multiple resources**
   ```
   write_resource uri="mcp://backlog/resources/TASK-XXXX/design.md" command="insert" content="# Design"
   write_resource uri="mcp://backlog/resources/TASK-XXXX/notes.md" command="insert" content="# Notes"
   ```

5. **Link resources to task**
   ```
   backlog_update
     id="TASK-XXXX"
     references=[
       {"url": "mcp://backlog/resources/TASK-XXXX/adr-001.md", "title": "ADR 001"},
       {"url": "mcp://backlog/resources/TASK-XXXX/design.md", "title": "Design"},
       {"url": "mcp://backlog/resources/TASK-XXXX/notes.md", "title": "Notes"}
     ]
   ```

6. **Verify task has references**
   ```
   backlog_get id="TASK-XXXX"
   ```

7. **Test lifecycle - delete task**
   ```
   backlog_delete id="TASK-XXXX"
   ```

8. **Verify task is gone**
   ```
   backlog_get id="TASK-XXXX"  # Should fail
   ```

## Success Criteria

✅ All write_resource calls succeed
✅ Task can be updated with references
✅ Task deletion succeeds
✅ Deleted task cannot be retrieved

## Report Format

Provide a brief summary:
- What worked
- What failed (if anything)
- Token efficiency vs traditional backlog_update

Keep it concise - no need to explore implementation details.
