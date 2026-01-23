# 0008. Personal Knowledge Graph with Organic Decay

**Date**: 2026-01-22
**Status**: Accepted
**Backlog Item**: TASK-0064

## Context

This isn't a task management tool. This is **personal agentic brain context** - a shared memory system for human-agent collaboration. The backlog is an external brain that helps surface the right work at the right time, learns patterns, and keeps you focused.

### The Real Problem

Users need to organize work across multiple dimensions (sprint, work type, priority) WITHOUT:
- Manual migration overhead
- Complex tools for every new requirement
- Rigid hierarchies that don't match mental models
- Backlog bloat (growing indefinitely without constraints)

### Current State

Backlog-mcp supports only one organizational dimension:
- `epic_id` field for hierarchy
- `backlog_list` filters by: `status`, `epic_id`, `type`, `limit`
- No constraints on backlog growth
- No staleness tracking
- No automatic decay or archival

### Vision: Personal Knowledge Graph

Not Jira. Not a task tracker. A **knowledge graph** where:
- Everything is a node (tasks, sprints, contexts, artifacts, people)
- Relationships connect nodes (not rigid hierarchy)
- Metadata enables learning (patterns, preferences, energy)
- Organic decay prevents bloat (stale items fade away)
- Constraints enforce focus (WIP limits, auto-archival)
- Agent collaborates (surfaces work, learns patterns, maintains graph)

## Proposed Solutions

### Core Design: Hybrid Knowledge Graph

Combine the simplicity of the "contexts" model with the power of the full graph model.

#### Data Model

```typescript
interface Resource {
  id: string;              // TASK-0001, SPRINT-0001, CONTEXT-oncall
  type: string;            // Extensible: task, epic, sprint, context, artifact, person
  title: string;
  description?: string;
  status?: string;         // open, in_progress, blocked, done, cancelled
  
  // Simple field, smart system
  contexts?: string[];     // Mix of IDs and labels
                          // IDs: SPRINT-0001, EPIC-0002 (validated, bidirectional)
                          // Labels: "oncall", "p0", "quick-win" (freeform)
  
  // Rich relationships (optional, add when needed)
  relationships?: {
    blocks?: string[];        // Tasks this blocks
    blocked_by?: string[];    // Tasks blocking this
    related?: string[];       // Related work
    depends_on?: string[];    // Dependencies
  };
  
  // Metadata for agent intelligence
  metadata?: {
    effort?: string;          // "quick-win" | "deep-work"
    energy?: string;          // "high" | "low" (when created)
    priority?: string;        // "p0" | "p1" | "p2"
    started_at?: string;      // When actually started
    touched_at?: string[];    // Every time worked on
  };
  
  // Organic decay tracking
  health?: {
    score?: number;           // 0-100, computed from activity
    last_activity?: string;   // Last meaningful interaction
    decay_rate?: number;      // How fast this decays (based on type/priority)
  };
  
  created_at: string;
  updated_at: string;
}
```

#### How It Works

**Simple for LLMs**:
- One primary field: `contexts` (mix of IDs and labels)
- System validates IDs, accepts labels
- System maintains bidirectional relationships automatically

**Powerful for agents**:
- Rich relationships when needed (blocks, depends_on)
- Metadata for learning patterns
- Health scores for prioritization
- Computed resources for queries

**Example**:
```typescript
// LLM writes
contexts: ["SPRINT-0001", "EPIC-0002", "oncall", "p0"]

// System interprets
// SPRINT-0001 → Validated ID, updates SPRINT-0001.children automatically
// EPIC-0002 → Validated ID, updates EPIC-0002.children automatically
// "oncall" → Label, accepted as-is
// "p0" → Label, accepted as-is

// System computes
health.score = 100 (just created)
health.last_activity = now
health.decay_rate = 5 (p0 decays slower)
```

### Innovation 1: Organic Decay System

**Core Insight**: Items naturally decay over time. Activity keeps them alive.

#### Health Score (0-100)

**Starts at**: 100 (newly created)

**Decays based on**:
- Time since last activity (touched_at)
- Priority (p0 decays slower than p2)
- Status (in_progress decays faster than open)
- Blocking others (decays slower if blocking people)

**Increases when**:
- Task is updated
- Task is commented on
- Task is referenced in other work
- Task blocks active work

**Decay formula**:
```
base_decay = days_since_activity * decay_rate
priority_multiplier = { p0: 0.5, p1: 1.0, p2: 1.5 }
blocking_multiplier = blocks_count > 0 ? 0.7 : 1.0
status_multiplier = { open: 0.8, in_progress: 1.2, blocked: 0.6 }

decay = base_decay * priority_multiplier * blocking_multiplier * status_multiplier
health_score = max(0, 100 - decay)
```

#### Decay Thresholds

- **100-80**: Healthy (green)
- **79-50**: Aging (yellow) - Agent surfaces: "This is getting stale"
- **49-20**: Decaying (orange) - Agent warns: "Act on this or it will archive"
- **19-0**: Critical (red) - Auto-archives in 7 days unless touched

#### Exposed Resources

```
mcp://backlog/health/decaying → Items with score < 50
mcp://backlog/health/critical → Items with score < 20
mcp://backlog/health/score/TASK-0001 → Health score + breakdown
```

**Agent behavior**:
```
Agent: *Reads mcp://backlog/health/decaying*
Agent: "You have 3 tasks decaying. TASK-0042 is at 35% health. Want to review?"
User: "What is it?"
Agent: "Judge model update - hasn't been touched in 12 days"
User: "Archive it"
Agent: *Updates status=cancelled, health.score=0*
```

### Innovation 2: Constraint-Based Focus

**Core Insight**: Constraints prevent bloat and enforce focus.

#### WIP Limits

**Per context**:
```typescript
context_limits: {
  "SPRINT-0001": { max_open: 10, max_in_progress: 3 },
  "EPIC-0002": { max_open: 20, max_in_progress: 5 },
  "personal": { max_open: 5, max_in_progress: 2 }
}
```

**Enforcement**:
- Creating task beyond limit → Agent warns: "Sprint is at capacity (10/10). Close something first?"
- Starting task beyond WIP → Agent blocks: "You have 3 tasks in progress. Finish one first."

**Exposed resources**:
```
mcp://backlog/limits/SPRINT-0001 → Current: 8/10 open, 2/3 in_progress
mcp://backlog/limits/violations → Contexts over limit
```

#### Auto-Archival Rules

**Stale items auto-archive when**:
- Health score < 10 for 7+ days
- Status=open for 90+ days with no activity
- Status=blocked for 30+ days with no updates

**Before archiving**:
- Agent warns 7 days before: "TASK-0042 will auto-archive in 7 days unless touched"
- Agent warns 1 day before: "Last chance: TASK-0042 archives tomorrow"
- Agent archives: "TASK-0042 archived due to inactivity"

**User can**:
- Touch task to reset health (backlog_update TASK-0042 metadata.touched_at=[now])
- Disable auto-archive (metadata.auto_archive=false)
- Adjust thresholds per context

#### Backlog Capacity Limits

**Global constraints**:
```typescript
global_limits: {
  max_total_open: 50,        // Total open tasks across all contexts
  max_per_epic: 20,          // Max open tasks per epic
  max_stale_ratio: 0.3       // Max 30% of tasks can be stale (score < 50)
}
```

**Enforcement**:
- Creating task beyond global limit → Agent blocks: "Backlog at capacity (50/50). Archive or complete tasks first."
- Stale ratio exceeded → Agent nags: "40% of your backlog is stale. Time for cleanup?"

### Innovation 3: Self-Maintaining System

**LLM perspective**: Simple
- Add things to `contexts` array
- System handles the rest

**System perspective**: Smart
- Validates IDs automatically
- Maintains bidirectional relationships
- Computes health scores
- Enforces constraints
- Suggests defaults

**Example workflow**:
```
User: "Add task: fix bug"
Agent: *Reads mcp://backlog/context/current*
→ { current_sprint: "SPRINT-0002", oncall_active: true }
Agent: *Reads mcp://backlog/limits/SPRINT-0002*
→ { open: 8/10, in_progress: 2/3 } ✓ Under limit
Agent: backlog_create title="fix bug" contexts=["SPRINT-0002", "oncall", "p0"]
→ System validates SPRINT-0002, updates relationships, sets health=100
Agent: "Added to sprint (9/10 open). P0 oncall work."
```

### Innovation 4: Computed Resources for Intelligence

**Expose rich views**:
```
mcp://backlog/sprints/SPRINT-0001/tasks → All tasks in sprint
mcp://backlog/contexts/oncall/tasks → All oncall work
mcp://backlog/views/stale → Tasks with health < 50
mcp://backlog/views/quick-wins → Tasks with effort="quick-win" and health > 70
mcp://backlog/views/blocking-others → Tasks blocking other people
mcp://backlog/views/energy-match → Tasks matching current energy level
mcp://backlog/health/score/TASK-0001 → Health breakdown with recommendations
```

**Agent uses these naturally**:
```
User: "What should I work on?"
Agent: *Reads mcp://backlog/context/current*
→ { time: "2pm", energy: "low", oncall: true }
Agent: *Reads mcp://backlog/views/quick-wins*
Agent: *Reads mcp://backlog/views/blocking-others*
Agent: "You're oncall with low energy. Here are 3 quick wins. Also, TASK-0042 is blocking Sarah and decaying (score: 45)."
```

## Decision

**Selected**: Hybrid Knowledge Graph with Organic Decay

**Rationale**:

1. **Simple for LLMs**: One primary field (`contexts`), system does the heavy lifting
2. **Powerful for agents**: Rich relationships, metadata, health scores enable intelligence
3. **Self-maintaining**: Automatic relationship management, health computation, constraint enforcement
4. **Prevents bloat**: Organic decay + auto-archival + WIP limits keep backlog focused
5. **Enables learning**: Metadata + activity tracking enable pattern recognition
6. **Extensible**: Add new node types, relationships, constraints without breaking changes
7. **Backward compatible**: Keep `epic_id`, gradual migration

**Trade-offs Accepted**:
- Medium implementation complexity (~500 lines) vs simple labels (~50 lines)
- Health score computation overhead vs no decay tracking
- Constraint enforcement may frustrate users vs unlimited backlog growth
- System intelligence requires maintenance vs dumb storage

**Why constraints are essential**:
- Unlimited backlog = decision paralysis
- Decay forces action = prevents procrastination
- WIP limits = enforces focus
- Auto-archival = keeps backlog relevant

## Consequences

**Positive**:
- Multi-dimensional organization (sprint + work type + priority)
- No manual migration (multi-context membership)
- Prevents backlog bloat (organic decay + constraints)
- Enables intelligent agent behavior (health scores, computed views)
- Supports learning (metadata, activity tracking)
- Self-maintaining (automatic relationships, validation)
- Scales to future needs (extensible types, relationships)

**Negative**:
- More complex than simple labels
- Health score computation adds overhead
- Constraints may feel restrictive initially
- Requires agent to understand health/limits

**Risks**:
- **Health score formula may need tuning** → Mitigation: Make decay_rate configurable per context
- **Constraints too strict** → Mitigation: User can override, adjust limits
- **LLM forgets to check limits** → Mitigation: System enforces, returns errors
- **Auto-archival too aggressive** → Mitigation: 7-day warning, user can disable per task

## Implementation Notes

### Phase 1: Core Graph Model (Solves sprint problem)
- Add `contexts?: string[]` field
- Add `type: string` (extensible)
- System validates IDs, accepts labels
- Bidirectional relationship management
- Extend backlog_list to filter by context
- **~200 lines of code**

### Phase 2: Organic Decay (Prevents bloat)
- Add `health` field with score computation
- Track `touched_at` activity
- Expose health resources (mcp://backlog/health/*)
- Agent surfaces decaying items
- **~150 lines of code**

### Phase 3: Constraints (Enforces focus)
- Add WIP limits per context
- Add global capacity limits
- Add auto-archival rules
- System enforces on create/update
- Expose limit resources (mcp://backlog/limits/*)
- **~100 lines of code**

### Phase 4: Rich Relationships (Enables blocking, dependencies)
- Add `relationships` field (blocks, depends_on, related)
- Bidirectional management
- Expose blocker resources
- **~100 lines of code**

### Phase 5: Learning Metadata (Enables pattern recognition)
- Add `metadata` field (effort, energy, priority)
- Track temporal patterns
- Agent learns preferences
- **~100 lines of code**

**Total**: ~650 lines for full vision

### Data Model Evolution

**Current**:
```typescript
interface Task {
  id: string;
  title: string;
  status: Status;
  epic_id?: string;  // Single parent
  // ...
}
```

**Phase 1** (backward compatible):
```typescript
interface Resource {
  id: string;
  type: string;  // task, epic, sprint, context
  title: string;
  status?: string;
  contexts?: string[];  // Replaces epic_id (but keep for compat)
  // ...
}
```

**Phase 2** (add decay):
```typescript
interface Resource {
  // ... Phase 1 fields
  health?: {
    score: number;
    last_activity: string;
    decay_rate: number;
  };
}
```

**Phase 3** (add constraints):
```typescript
// Context-level config
interface ContextLimits {
  max_open: number;
  max_in_progress: number;
  auto_archive_days: number;
}
```

**Phase 4** (add relationships):
```typescript
interface Resource {
  // ... Phase 2 fields
  relationships?: {
    blocks?: string[];
    blocked_by?: string[];
    related?: string[];
    depends_on?: string[];
  };
}
```

**Phase 5** (add metadata):
```typescript
interface Resource {
  // ... Phase 4 fields
  metadata?: {
    effort?: string;
    energy?: string;
    priority?: string;
    started_at?: string;
    touched_at?: string[];
  };
}
```

### Tool Changes

**backlog_create** - Extend:
```typescript
{
  type?: string,           // Extensible (task, epic, sprint, context)
  contexts?: string[],     // Mix of IDs and labels
  relationships?: {...},   // Optional rich relationships
  metadata?: {...}         // Optional metadata
}
```

**backlog_update** - Extend:
```typescript
{
  contexts?: string[],     // Update contexts
  relationships?: {...},   // Update relationships
  metadata?: {...}         // Update metadata
}
```

**backlog_list** - Extend:
```typescript
{
  context?: string,        // Filter by context (ID or label)
  health_min?: number,     // Filter by health score
  health_max?: number,
  blocks_any?: boolean,    // Only tasks blocking others
  // ... existing filters
}
```

### MCP Resources to Expose

**Core**:
- `mcp://backlog/tasks/TASK-0001`
- `mcp://backlog/sprints/SPRINT-0001`
- `mcp://backlog/contexts/oncall`

**Computed views**:
- `mcp://backlog/sprints/SPRINT-0001/tasks`
- `mcp://backlog/contexts/oncall/tasks`
- `mcp://backlog/views/stale`
- `mcp://backlog/views/quick-wins`
- `mcp://backlog/views/blocking-others`

**Health**:
- `mcp://backlog/health/decaying`
- `mcp://backlog/health/critical`
- `mcp://backlog/health/score/TASK-0001`

**Limits**:
- `mcp://backlog/limits/SPRINT-0001`
- `mcp://backlog/limits/violations`

**Context**:
- `mcp://backlog/context/current` (active sprint, oncall status, time, energy)

### Health Score Computation

```typescript
function computeHealthScore(resource: Resource): number {
  const now = Date.now();
  const lastActivity = resource.health?.last_activity || resource.updated_at;
  const daysSinceActivity = (now - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
  
  // Base decay
  const decayRate = resource.health?.decay_rate || 5;
  let decay = daysSinceActivity * decayRate;
  
  // Priority multiplier (p0 decays slower)
  const priority = resource.metadata?.priority || 'p1';
  const priorityMultiplier = { p0: 0.5, p1: 1.0, p2: 1.5 }[priority] || 1.0;
  decay *= priorityMultiplier;
  
  // Blocking multiplier (blocking others decays slower)
  const blocksCount = resource.relationships?.blocks?.length || 0;
  const blockingMultiplier = blocksCount > 0 ? 0.7 : 1.0;
  decay *= blockingMultiplier;
  
  // Status multiplier
  const status = resource.status || 'open';
  const statusMultiplier = { 
    open: 0.8,        // Open tasks decay slower
    in_progress: 1.2, // In-progress tasks decay faster (should finish!)
    blocked: 0.6,     // Blocked tasks decay slower (not your fault)
    done: 0,          // Done tasks don't decay
    cancelled: 0      // Cancelled tasks don't decay
  }[status] || 1.0;
  decay *= statusMultiplier;
  
  return Math.max(0, Math.min(100, 100 - decay));
}
```

### Constraint Enforcement

```typescript
function enforceConstraints(context: string, action: 'create' | 'update'): void {
  const limits = getContextLimits(context);
  const current = getContextStats(context);
  
  if (action === 'create' && current.open >= limits.max_open) {
    throw new Error(`Context ${context} at capacity (${current.open}/${limits.max_open}). Close tasks first.`);
  }
  
  if (action === 'update' && current.in_progress >= limits.max_in_progress) {
    throw new Error(`WIP limit reached (${current.in_progress}/${limits.max_in_progress}). Finish tasks first.`);
  }
}
```

### Auto-Archival Logic

```typescript
async function checkAutoArchival(): Promise<void> {
  const critical = await storage.list({ health_max: 10 });
  
  for (const task of critical) {
    const daysCritical = getDaysBelowThreshold(task, 10);
    
    if (daysCritical >= 7 && task.metadata?.auto_archive !== false) {
      await storage.update(task.id, { 
        status: 'cancelled',
        description: task.description + '\n\n[Auto-archived due to inactivity]'
      });
      console.log(`Auto-archived ${task.id} after 7 days below health threshold`);
    } else if (daysCritical === 6 || daysCritical === 0) {
      // Warn user via health resource
      console.log(`Warning: ${task.id} will auto-archive in ${7 - daysCritical} days`);
    }
  }
}
```

### Backward Compatibility

**Keep `epic_id` field**:
- Read: If `contexts` empty, use `epic_id`
- Write: If `epic_id` set, add to `contexts` automatically
- Gradual migration: LLM uses `contexts`, old tasks still work

**Example**:
```typescript
// Old task
{ id: "TASK-0001", epic_id: "EPIC-0002" }

// System reads as
{ id: "TASK-0001", contexts: ["EPIC-0002"] }

// LLM updates
backlog_update TASK-0001 contexts=["SPRINT-0001", "EPIC-0002"]

// New task
{ id: "TASK-0001", epic_id: "EPIC-0002", contexts: ["SPRINT-0001", "EPIC-0002"] }
```

### Teaching LLMs

**Tool description** (embedded examples):
```
backlog_create - Create task, epic, sprint, or context

Parameters:
  type: Type of resource (task, epic, sprint, context)
  contexts: Array of IDs or labels this belongs to
    - IDs: SPRINT-0001, EPIC-0002 (validated, creates relationships)
    - Labels: "oncall", "p0", "quick-win" (freeform)
  
Examples:
  Sprint: type="sprint" title="Sprint [01/14 - 01/28]"
  Task in sprint: contexts=["SPRINT-0001", "EPIC-0002"]
  Oncall work: contexts=["SPRINT-0001", "oncall", "p0"]
  
Tip: Read mcp://backlog/context/current for active sprint/epic
Tip: Read mcp://backlog/limits/SPRINT-0001 to check capacity
```

**Self-documenting data**: LLM reads existing tasks, learns patterns

**Immediate feedback**: System validates, returns errors with suggestions

**Health monitoring**: Agent proactively surfaces decaying items
