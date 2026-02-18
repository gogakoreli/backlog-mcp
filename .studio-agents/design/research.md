# Research: Eisenhower Matrix as Integral backlog-mcp Feature

## Problem Statement

The user (and agents) need a way to prioritize backlog tasks by urgency and importance — the Eisenhower Matrix framework. Currently backlog-mcp has no priority model at all. Tasks are sorted only by updated/created date. The user specifically struggles with gravitating toward "interesting" work over "important" work, and wants the system to make this visible.

## How Existing Tools Implement Eisenhower

### Todoist (label-based, most relevant)
- **Approach A — Two labels**: `@important` and `@urgent`, combined via filter queries (`@urgent & @important` = Q1, `@important & !@urgent` = Q2, etc.)
- **Approach B — Priority levels**: Maps P1-P4 directly to quadrants (P1=urgent+important, P2=important+not-urgent, P3=urgent+not-important, P4=neither)
- Label approach is more flexible (independent axes), priority approach is simpler (single field)

### Notion (database properties)
- Uses select/multi-select database properties for urgency and importance
- Drag-and-drop into quadrant board views
- Template-based — users create their own matrix views from database properties

### ClickUp / Taskade (AI-powered)
- Auto-prioritization agents that score tasks on urgency, importance, deadlines
- ClickUp Brain ranks tasks based on urgency, importance, and deadlines automatically
- Taskade agents analyze task content to propose priority sequences

## AI-Powered Prioritization Patterns

### Signals that can infer urgency
- **Blocked/blocking chains**: If task X blocks 3 other tasks → high urgency
- **Age/staleness**: Open for 30+ days without progress → urgency increases
- **Due dates**: Milestones with approaching deadlines → high urgency
- **Keywords**: "bug", "fix", "broken", "race condition", "500 error" → urgency signals
- **Status**: `blocked` tasks that block others → urgent to unblock

### Signals that can infer importance
- **Epic alignment**: Tasks under a strategic epic → higher importance
- **Reference count**: Tasks referenced by many other tasks → higher importance
- **Type**: Bugs in core functionality > UI polish > nice-to-have features
- **Evidence of impact**: Description mentions "data loss", "users affected", "every session"

### Industry frameworks (for reference, not direct implementation)
- **RICE**: Reach × Impact × Confidence / Effort — too complex for personal backlog
- **WSJF**: (Business Value + Time Criticality + Risk Reduction) / Job Size — SAFe-oriented
- **ICE**: Impact × Confidence × Ease — simpler but still 3 dimensions
- **Eisenhower**: 2 axes (urgency × importance) — right complexity for personal/small-team use

## Current backlog-mcp Architecture

### Task schema (no priority fields exist)
```typescript
interface Task {
  id: string; title: string; description?: string;
  status: Status; type?: TaskType;
  epic_id?: string; parent_id?: string;
  references?: Reference[];
  created_at: string; updated_at: string;
  blocked_reason?: string[]; evidence?: string[];
  due_date?: string; content_type?: string;
}
```

### Current filtering/sorting
- Filter bar: status (active/completed/all), type (task/epic/folder/etc), sort (updated/created)
- `backlog_list`: filters by status, type, parent_id, query, limit
- `backlog_search`: full-text + vector search, no priority awareness
- No priority-based filtering or sorting anywhere

### Viewer
- Split-pane: task list + task detail
- Filter bar with status/type buttons and sort dropdown
- No matrix/grid view, no priority visualization

## Key Design Constraints

1. **Backward compatibility**: Existing tasks have no urgency/importance fields — must work with missing values
2. **Optional, not mandatory**: Priority fields should be opt-in, not required for task creation
3. **Agent-friendly**: Agents should be able to set and query priority via MCP tools
4. **Human-friendly**: Viewer should visualize the matrix and allow manual adjustment
5. **Lightweight**: No heavy dependencies, no external AI calls for basic functionality
6. **Composable**: The priority model should work with existing filtering/sorting, not replace it

<insight>The highest-value design is a hybrid: two independent numeric fields (urgency 1-5, importance 1-5) on the Task schema, with a computed quadrant derived from thresholds. This gives the flexibility of Todoist's label approach (independent axes) with the simplicity of a single quadrant view. Manual tagging via backlog_update, optional AI-assisted suggestions via a new tool, and a matrix view in the viewer. The key insight from the user's own problem statement is that visibility is the core need — making it impossible to ignore that "interesting" Q4 work is displacing "important" Q1/Q2 work.</insight>
