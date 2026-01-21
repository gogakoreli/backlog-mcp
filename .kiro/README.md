# MCP Writable Resources Validation

This directory contains the **MCP Resource Validator** - an expert Kiro agent that validates the revolutionary writable resources concept for MCP.

## The Innovation

Traditional MCP updates waste tokens by sending entire content. Writable resources bring **fs_write-like efficiency** to MCP:

- **10-100x token reduction** for large content edits
- **fs_write-compatible API** (strReplace, insert, insertLine)
- **Operation-based updates** - send only what changes

## Files

- `agents/mcp-resource-validator.json` - Expert validation agent configuration
- `mcp-resource-validator-prompt.md` - Comprehensive test plan and validation criteria

## Running Validation

```bash
# Build and run full validation suite
pnpm test:integration
```

This will:
1. Build the project
2. Launch the MCP Resource Validator agent
3. Execute comprehensive test plan
4. Measure token efficiency gains
5. Validate data integrity and error handling

## What Gets Validated

- ✅ Core operations (append, strReplace, insert at line)
- ✅ Token efficiency (compare vs traditional backlog_update)
- ✅ Error handling (invalid URIs, missing tasks, string not found)
- ✅ Data integrity (frontmatter preservation, no corruption)
- ✅ API usability (fs_write-compatible interface)

## Manual Validation

Run the agent interactively:

```bash
kiro-cli chat --agent mcp-resource-validator
```

Then ask it to execute specific tests or the full validation plan.

## Success Criteria

- All operations work correctly
- Measurable 10-100x token savings
- Frontmatter always preserved
- Clear, helpful error messages
- API feels natural to developers familiar with fs_write
