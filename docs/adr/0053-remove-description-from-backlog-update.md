# 0053. Remove description field from backlog_update tool

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0173

## Problem Statement

The `description` field in `backlog_update` is a destructive "replace entire content" operation mixed with surgical metadata updates, creating semantic inconsistency and data loss risk.

## Problem Space

### Why This Problem Exists

The original design didn't distinguish between metadata updates (status, evidence, references) and content updates (description). All fields were grouped in one tool for convenience.

### Who Is Affected

- LLM agents using backlog_update - may accidentally overwrite task content
- Users who lose work when agents replace descriptions
- System reliability - inconsistent semantics lead to bugs

### Problem Boundaries

- **In scope**: Remove description from backlog_update, update docs
- **Out of scope**: Changing backlog_create (creating from scratch is fine)
- **Constraint**: Must maintain backward compatibility for existing task files

### Problem-Space Map

**Dominant causes**: Semantic inconsistency - description is destructive while other fields are additive/specific

**Alternative root causes**: Could be a documentation/guidance issue - maybe agents just need better warnings

**What if we're wrong**: If agents actually need full description replacement frequently, removing it would force them into multiple write_resource calls. But evidence shows agents prefer surgical edits anyway.

## Context

### Current State

`backlog_update` accepts these fields:
- `id` (required) - Task ID
- `title` - New title
- `description` - **Replaces entire content** ← The problem
- `status` - New status
- `epic_id` - Parent epic
- `blocked_reason` - Array of reasons
- `evidence` - Array of completion proof
- `references` - Array of links

All fields except `description` are either atomic values or arrays that replace specific metadata. `description` replaces the entire markdown body.

### Research Findings

Real-world observation: Agents naturally prefer `write_resource` with `str_replace` for updating task content because it's:
- **Safer** - Only touches what needs to change
- **Auditable** - Each change is explicit and reviewable
- **Error-recoverable** - If one replace fails, others still succeed
- **Clear intent** - Shows exactly what changed

Evidence: Engineer agent used 5 surgical `str_replace` operations to update TASK-0134, explicitly stating preference for incremental edits.

### Prior Art

The `references` field has the same overwrite risk, already documented in task-completion-protocol.md with a warning to merge existing references before updating.

## Proposed Solutions

### Option 1: Simple Removal `[SHORT-TERM]` `[LOW]`

**Description**: Remove `description` field from backlog_update Zod schema. Update tool description to guide users to write_resource.

**Differs from others by**:
- vs Option 2: No transition period, immediate clean break
- vs Option 3: No new tools, uses existing write_resource

**Pros**:
- Minimal change, immediate fix
- No new code paths
- Clean separation of concerns

**Cons**:
- Agents must learn new pattern (write_resource)
- Breaking change for any agent using description field

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | 30 minutes, 3 files to change |
| Risk | 5 | Removing code is safer than adding |
| Testability | 5 | Easy - verify field is gone |
| Future flexibility | 4 | Clean separation enables future improvements |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Only affects agents using description field |

### Option 2: Deprecation Warning First `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Keep `description` but emit a warning when used, suggesting write_resource. Remove in next major version.

**Differs from others by**:
- vs Option 1: Gradual migration, no immediate breaking change
- vs Option 3: No new tools, just warnings

**Pros**:
- Agents can adapt gradually
- No breaking change

**Cons**:
- Delays the fix
- Adds complexity
- Warning might be ignored

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | Need warning infrastructure |
| Risk | 3 | Warning might be ignored, problem persists |
| Testability | 3 | Need to test warning emission |
| Future flexibility | 3 | Delays clean separation |
| Operational complexity | 3 | Warning system to maintain |
| Blast radius | 5 | No immediate breaking change |

### Option 3: Semantic Split with New Tool `[LONG-TERM]` `[HIGH]`

**Description**: Create `backlog_update_content` tool specifically for content operations, keep `backlog_update` for metadata only.

**Differs from others by**:
- vs Option 1: Adds new tool instead of removing field
- vs Option 2: Explicit separation instead of deprecation

**Pros**:
- Clear semantic separation
- Explicit API

**Cons**:
- More tools to maintain
- Agents must learn new tool
- Duplicates write_resource functionality

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 1 | New tool, tests, docs |
| Risk | 2 | More surface area for bugs |
| Testability | 3 | More code to test |
| Future flexibility | 3 | Duplicates write_resource |
| Operational complexity | 2 | Another tool to maintain |
| Blast radius | 4 | Additive change |

## Decision

**Selected**: Option 1 - Simple Removal

**Rationale**: The task explicitly calls for removal, and evidence shows agents already prefer write_resource. Option 2 delays the fix unnecessarily. Option 3 duplicates existing functionality (write_resource already handles content operations).

**For this decision to be correct, the following must be true**:
- Agents can successfully use write_resource for content updates
- No critical workflows depend on description in backlog_update
- The documentation update is sufficient to guide users

**Trade-offs Accepted**:
- Breaking change for any agent currently using description field
- Agents must learn the write_resource pattern

## Consequences

**Positive**:
- Clean separation: backlog_update = metadata, write_resource = content
- Eliminates accidental content overwrites
- Consistent semantics across all backlog_update fields

**Negative**:
- Breaking change for agents using description field
- Slightly more verbose for full content replacement (rare case)

**Risks**:
- Agents might not discover write_resource → Mitigated by updating tool description
- Some workflows might break → Low risk, evidence shows agents prefer surgical edits

## Implementation Notes

1. Remove `description` from backlog_update Zod schema in `src/tools/backlog-update.ts`
2. Update tool description to guide users: "For updating task content, use write_resource with `mcp://backlog/tasks/TASK-XXXX.md`"
3. Keep `description` in `backlog_create` (creating from scratch is fine)
4. Update README.md to document the pattern
