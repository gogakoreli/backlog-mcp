# 0054. Operation Logging and Activity View

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0175

## Problem Statement

Users need visibility into what MCP tool operations have been performed on their backlog. Currently, when agents make changes via MCP tools, there's no audit trail or way to review what happened. The kiro-cli renders tool parameters as ugly escaped JSON, making verification difficult.

## Problem Space

### Why This Problem Exists

1. The MCP server was designed for tool execution, not observability
2. kiro-cli controls how tool calls are rendered - we can't fix that from the server side
3. No logging infrastructure exists for tool operations

### Who Is Affected

- Users who want to verify what agents did to their backlog
- Users debugging agent behavior
- Users wanting an audit trail ("what happened today?")

### Problem Boundaries

**In scope**:
- Logging write operations (create, update, delete, write_resource)
- API to query operation logs
- Web viewer UI to display activity

**Out of scope**:
- Git integration
- Real-time websocket updates
- Log rotation/archival
- Side-by-side diff view

### Adjacent Problems

1. **Task versioning**: Users might want to see task history over time, not just operations. Operation logs are a partial solution.
2. **Resource change tracking**: Similar need for resources, not just tasks.

Captured for future work, not addressed in this change.

### Problem-Space Map

**Dominant causes**: No operation logging exists; kiro-cli renders JSON poorly; no UI for operation history

**Alternative root causes**: Could be a symptom of missing observability infrastructure; could be that users need task versioning (git-like) instead

**What if we're wrong**: If users don't need operation logs, we're adding complexity for no benefit. If kiro-cli fixes their rendering, this becomes less critical (but still useful for audit).

## Context

### Current State

- MCP tools execute and return results, nothing persisted
- No way to see what operations were performed
- SplitPaneService exists for third-pane content (resource viewer)
- Viewer has established component patterns (Web Components)

### Research Findings

- MCP SDK's `registerTool` accepts a callback that can be wrapped
- SplitPaneService can be extended to support different content types
- JSONL is appropriate for append-only operation logs
- diff2html library (~50KB) provides unified diff rendering

### Prior Art

- Task says to use "Middleware approach - central logging wrapper"
- Task specifies JSONL format and specific fields (ts, tool, params, result)

## Proposed Solutions

### Option 1: Callback Wrapper `[SHORT-TERM]` `[MEDIUM]`

**Description**: Wrap each tool's callback function at registration time with logging. Store in JSONL. Add activity panel to viewer.

**Differs from others by**:
- vs Option 2: Logging happens inside tool handlers, not at transport level
- vs Option 3: No abstraction layer, direct JSONL writes

**Pros**:
- Simple, well-understood pattern
- Minimal changes to existing code
- Easy to filter to write operations only
- Low risk - logging failure doesn't affect tool execution

**Cons**:
- Tightly coupled to current tool structure
- Limited extensibility for future features

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 4 | ~1-2 days, straightforward implementation |
| Risk | 4 | Low risk - wrapping callbacks is well-understood |
| Testability | 4 | Easy to test - mock storage, verify log entries |
| Future flexibility | 2 | Tightly coupled to current tool structure |
| Operational complexity | 5 | Simple JSONL append, no new systems |
| Blast radius | 5 | Logging failure doesn't affect tool execution |

### Option 2: Transport-Level Interception `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Intercept at MCP transport level to log all requests/responses. More comprehensive but more complex.

**Differs from others by**:
- vs Option 1: Different interception point (transport vs callback)
- vs Option 3: Logs raw MCP protocol, not semantic operations

**Pros**:
- Captures ALL MCP messages
- Could enable replay/debugging features
- More comprehensive audit trail

**Cons**:
- Higher risk - modifying transport layer could break MCP
- More complex to implement
- Logs more data than needed

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | 3-5 days, need to understand MCP transport internals |
| Risk | 2 | Higher risk - modifying transport layer could break MCP |
| Testability | 3 | Harder to test - need to mock transport |
| Future flexibility | 4 | Could enable replay, debugging features |
| Operational complexity | 3 | More complex logging format, more data |
| Blast radius | 2 | Transport issues could break all MCP communication |

### Option 3: Event-Driven Operation Bus `[LONG-TERM]` `[LOW]`

**Description**: Create an event bus that tools emit to. Decouples logging from tool execution. Enables future subscribers.

**Differs from others by**:
- vs Option 1: Different ownership model (tools emit, subscribers consume)
- vs Option 2: Semantic events, not raw protocol

**Pros**:
- Highly extensible
- Supports future webhooks, real-time updates
- Clean separation of concerns

**Cons**:
- Introduces new abstraction to maintain
- Overkill for current requirements
- More complex mental model

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | 2-3 days, need to design event schema |
| Risk | 3 | Medium risk - new abstraction to maintain |
| Testability | 5 | Excellent - event emitters are easy to test |
| Future flexibility | 5 | Highly extensible, supports webhooks, real-time |
| Operational complexity | 3 | New event bus system to understand |
| Blast radius | 4 | Event failures isolated from tool execution |

## Decision

**Selected**: Option 1 - Callback Wrapper

**Rationale**: 
- Highest rubric score (24 vs 16 vs 23)
- Aligns with task requirements ("Middleware approach - central logging wrapper")
- Matches specified storage format (JSONL)
- Lowest risk for the defined scope
- Option 3 would be valuable for webhooks/real-time, but those are explicitly out of scope

**For this decision to be correct, the following must be true**:
- The MCP SDK's registerTool callback signature remains stable
- JSONL append performance is acceptable for expected operation volume
- Users primarily need to see recent operations, not complex queries

**Trade-offs Accepted**:
- Limited extensibility (acceptable given current scope)
- Tightly coupled to tool structure (can refactor later if needed)

## Consequences

**Positive**:
- Users can verify agent operations in clean UI
- Audit trail for debugging
- Workaround for kiro-cli rendering issues

**Negative**:
- Additional storage (JSONL file grows over time)
- Slight overhead on tool execution (logging)

**Risks**:
- JSONL file could grow large without rotation (mitigated: out of scope, add later)
- Logging failure could cause issues (mitigated: wrap in try-catch, fail silently)

## Implementation Notes

### Backend Components

1. **OperationLogger** (`src/operations/logger.ts`)
   - Append-only JSONL writer to `$BACKLOG_DATA_DIR/.internal/operations.jsonl`
   - `log(tool, params, result)` method
   - Extract resource ID from params for filtering

2. **withLogging wrapper** (`src/operations/middleware.ts`)
   - Higher-order function that wraps tool callbacks
   - Filters to write operations only
   - Logs after successful execution

3. **Operations API** (`src/server/viewer-routes.ts`)
   - `GET /operations?limit=50` - recent operations
   - `GET /operations?task=TASK-0174` - filtered by task

### Frontend Components

4. **SplitPaneService extension** - Add `openActivity(taskId?)` method
5. **ActivityPanel component** - Renders operation list with expandable rows
6. **Task detail activity button** - Clock icon with badge in header
7. **Global activity button** - Next to spotlight search

### Dependencies

- diff2html for diff rendering
