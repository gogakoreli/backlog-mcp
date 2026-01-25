# ADR 0018: Local LLM as Meta-Learning Optimization Layer

**Status**: Proposed  
**Date**: 2026-01-25  
**Deciders**: gkoreli  
**Related**: TASK-0089, TASK-0023, EPIC-0002

## Context

Backlog-mcp currently functions as a task tracker with MCP integration. However, research into context engineering and tool use optimization reveals a much more powerful vision: **a self-optimizing agentic work system** that makes main agents more efficient over time.

### The Problem Space

**Context Problems**:
- Insights get lost when sessions end
- Context evaporates on project switches  
- Every LLM interaction starts from zero
- Knowledge fragments across chat histories

**Tool Use Problems**:
- Inefficient tool calls (e.g., `backlog_get` in loops instead of `backlog_list`)
- Over-fetching data (full task when only title needed)
- Over-hydrating context (wasting tokens)
- Missing relevant context (epic info when needed)
- Redundant queries (asking for same data twice)
- Invalid parameters (typos, wrong formats)
- No learning from failures (same mistakes repeated)

**Efficiency Problems**:
- Token waste from poor context assembly
- Latency from suboptimal tool sequences
- Retries from preventable errors
- Static performance (no improvement over time)

### Research Foundation

**Proven Patterns from Literature**:

1. **LLM Routing** ([RouteLLM](https://lmsys.org/blog/2024-07-01-routellm/), [IBM Research](https://research.ibm.com/blog/LLM-routers))
   - Small models route queries to optimal tools based on learned patterns
   - Reduces cost while maintaining quality
   - Learns from preference data

2. **Meta-Learning Tool Use** ([MetaAgent](https://arxiv.org/html/2508.00271v1))
   - LLMs learn tool-use strategies through "meta tool learning" WITHOUT parameter changes
   - Feedback loop: propose → execute → measure → refine
   - Learns from failures to improve future tool selection

3. **Error Detection & Correction** ([HiTEC](https://arxiv.org/html/2506.00042v1), [ToolScan](https://arxiv.org/html/2411.13547v2))
   - Systematic diagnosis of tool-calling errors
   - Benchmark for identifying error patterns
   - Structured reflection improves performance by +5.59%

4. **Persistent Memory** ([Zep](https://arxiv.org/abs/2501.13956), Mem0)
   - Temporal knowledge graphs for agent memory
   - 85%+ accuracy vs 70% for vectors alone
   - Hybrid approach (vectors + graphs) wins

5. **Context Engineering** ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
   - THE 2025/2026 shift: curate entire context stack, not just prompts
   - Context engineering > prompt engineering
   - Ambient context via MCP resources

## Decision

Implement a **local LLM-powered optimization layer** that serves dual roles:

### Role 1: Context Curator
- Assembles optimal context from backlog (tasks, epics, artifacts, insights)
- Learns what context YOU need for different scenarios
- Pushes ambient context via MCP resources (`resource://backlog/active-context`)
- Human-in-the-loop curation (reconcile flow)

### Role 2: Tool Use Optimizer
- Routes tool calls efficiently based on learned patterns
- Detects anti-patterns in real-time (before execution)
- Learns from failures through structured reflection
- Optimizes multi-step tool sequences
- Continuously improves without retraining main model

## Architecture

### System Components

```
┌──────────────────────────────────────────────────────────┐
│ Main Agent (Claude, Kiro, Cursor, etc.)                 │
│ • Receives optimized context via MCP resources          │
│ • Gets tool suggestions before execution                │
│ • Tool calls validated for anti-patterns                │
│ • Learns from failures through reflection                │
└──────────────────────────────────────────────────────────┘
                          ↕ (bidirectional)
┌──────────────────────────────────────────────────────────┐
│ Local LLM Optimization Layer (Llama 3.2 3B via Ollama)  │
│                                                          │
│ Context Curator:                                         │
│ • Semantic search (vector embeddings)                    │
│ • Relationship traversal (knowledge graph)               │
│ • Token budget management                                │
│ • Ambient context push                                   │
│                                                          │
│ Tool Use Optimizer:                                      │
│ • Query routing (which tool?)                            │
│ • Parameter optimization (best params?)                  │
│ • Anti-pattern detection (inefficiencies?)               │
│ • Failure reflection (what went wrong?)                  │
│ • Sequence optimization (better order?)                  │
│                                                          │
│ Meta-Learner:                                            │
│ • Learns YOUR patterns (context + tool use)              │
│ • Adapts without retraining main model                   │
│ • Improves efficiency over time                          │
└──────────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────────┐
│ Storage Layer                                            │
│                                                          │
│ Backlog Data (~/.backlog/):                              │
│ • tasks/ - Task markdown files                           │
│ • artifacts/ - Unstructured content                      │
│ • epic-contexts/ - Curated epic knowledge                │
│                                                          │
│ Learning Store (~/.backlog/learning/):                   │
│ • tool-patterns.json - Success patterns                  │
│ • anti-patterns.json - Failure patterns                  │
│ • context-preferences.json - Context assembly rules      │
│ • optimization-history.json - Performance metrics        │
│                                                          │
│ Vector Store (~/.backlog/embeddings/):                   │
│ • task-embeddings.db - Semantic search index             │
│                                                          │
│ Knowledge Graph (~/.backlog/graph/):                     │
│ • relationships.json - Entity relationships              │
│ • temporal-edges.json - Time-based connections           │
└──────────────────────────────────────────────────────────┘
```

### New MCP Tools

**Context Engineering Tools**:
1. `backlog_assemble_context(for_task?, for_epic?, max_tokens?)` → Intelligent context assembly
2. `backlog_capture_insight(content, context, type)` → Structured insight capture
3. `backlog_reconcile_context(epic_id)` → Human-in-the-loop curation
4. `resource://backlog/active-context` → Ambient context push (MCP resource)

**Tool Optimization Tools**:
5. `backlog_suggest_tool(user_query, context?)` → Route to optimal tool + params
6. `backlog_validate_call(tool_name, params)` → Anti-pattern detection
7. `backlog_reflect_on_failure(tool, params, error, context)` → Error diagnosis
8. `backlog_optimize_sequence(goal, planned_calls)` → Multi-step optimization
9. `backlog_analyze_tool_usage(time_range?, epic_id?)` → Meta-insights

### Learning Mechanisms

**What the Local LLM Learns**:

**Tool Selection Patterns**:
- When to use `backlog_list` vs `backlog_get`
- When `hydrate=true` is needed vs wasteful
- Which filters are most effective for different queries
- When to batch operations vs sequential calls

**Anti-Patterns** (detected in real-time):
- `backlog_get` in loops → suggest `backlog_list`
- Over-fetching data → optimize params to fetch only needed fields
- Over-hydrating context → reduce token waste
- Missing epic context → suggest inclusion when relevant
- Redundant queries → cache or combine calls

**Failure Patterns**:
- Invalid task IDs (format errors, typos)
- Missing required fields in updates
- Illogical status transitions
- Broken references

**Success Patterns**:
- Effective query sequences that accomplish goals efficiently
- Optimal context assembly strategies for different task types
- Efficient task decomposition flows

**Feedback Loop**:
```
Main Agent → Tool Call Intent
    ↓
Local LLM → Validates & Optimizes
    ↓
Executes → Records Outcome (success/failure)
    ↓
Learns → Updates Patterns
    ↓
Next Time → Applies Learned Optimization
```

## Implementation Phases

### Phase 1: Foundation (MVP)
**Goal**: Basic context engineering with semantic search

**Deliverables**:
- Implement `hydrate=true` flag (dereference file:// refs, pull epic context)
- Add vector embeddings (sentence-transformers: all-MiniLM-L6-v2)
- Tool: `backlog_assemble_context` (vector-based semantic search)
- Storage: `~/.backlog/embeddings/`

**Value**: Semantic search, intelligent context assembly  
**Complexity**: Low  
**Timeline**: 1-2 weeks

### Phase 2: Knowledge Graph
**Goal**: Structured relationships and multi-hop reasoning

**Deliverables**:
- Add explicit relationships (belongs_to, blocks, relates_to, references)
- Temporal edges (created_at, updated_at, accessed_at)
- Multi-hop reasoning queries
- Storage: `~/.backlog/graph/`

**Value**: 85%+ accuracy (vs 70% vectors alone), relationship queries  
**Complexity**: Medium  
**Timeline**: 2-3 weeks

### Phase 3: Local LLM Intelligence
**Goal**: Tool optimization and ambient context

**Deliverables**:
- Ollama integration (Llama 3.2 3B)
- Tools: `backlog_suggest_tool`, `backlog_validate_call`
- Ambient context push via `resource://backlog/active-context`
- Storage: `~/.backlog/learning/`

**Value**: Personalized optimization, proactive context  
**Complexity**: High  
**Timeline**: 3-4 weeks

### Phase 4: Meta-Learning
**Goal**: Continuous improvement from feedback

**Deliverables**:
- Fine-tuning on personal patterns (LoRA via Unsloth)
- Tools: `backlog_reflect_on_failure`, `backlog_optimize_sequence`
- Anti-pattern detection
- Performance metrics tracking

**Value**: Self-optimizing system, continuous improvement  
**Complexity**: High  
**Timeline**: 4-6 weeks

## Technical Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Local LLM | Ollama + Llama 3.2 3B | Fast, runs locally, 3B is sweet spot for efficiency |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) | Tiny (80MB), fast, good quality |
| Vector Store | ChromaDB or JSON | Simple, no heavy dependencies |
| Knowledge Graph | NetworkX → JSON | Lightweight, easy to inspect/debug |
| Fine-tuning | Unsloth + LoRA/QLoRA | Efficient, low memory, fast iteration |
| Learning Store | JSON files in `~/.backlog/learning/` | Simple, inspectable, version-controllable |

## Anti-Patterns Detected

The system will detect and correct these common inefficiencies:

1. **Loop Anti-Pattern**: `backlog_get` called multiple times → suggest `backlog_list` with filter
2. **Over-Fetch Anti-Pattern**: Fetching full task when only title/status needed → optimize params
3. **Over-Hydrate Anti-Pattern**: `hydrate=true` when references not needed → reduce token waste
4. **Missing Context Anti-Pattern**: Creating task without epic context → suggest epic_id
5. **Redundant Query Anti-Pattern**: Asking for same data twice → cache or combine
6. **Invalid Format Anti-Pattern**: Task ID typos (TASK-24 vs TASK-0024) → auto-correct
7. **Missing Evidence Anti-Pattern**: Marking task done without evidence → suggest based on similar tasks

## Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Token efficiency | Current usage | -30% tokens per task | Track tokens in context assembly |
| Latency | Current sequences | -40% tool calls | Count calls per goal completion |
| Error rate | Current failures | -50% failed calls | Track validation catches |
| Self-improvement | Static | +10% monthly | Performance improvement over time |
| Context quality | N/A | 4.5/5 user rating | User feedback on context relevance |

## Risks & Mitigations

### Risk 1: Complexity Creep
**Risk**: System becomes heavyweight, loses "simple and hackable" constraint  
**Impact**: High - violates core design principle  
**Mitigation**:
- Phased approach - each phase delivers standalone value
- Make advanced features optional (graceful degradation)
- Keep core backlog functionality simple
- Document escape hatches for power users

### Risk 2: Resource Requirements
**Risk**: Too heavy for average laptop (LLM + embeddings + graph)  
**Impact**: Medium - limits adoption  
**Mitigation**:
- Make local LLM optional (fallback to simple retrieval)
- Use lightweight models (3B, not 70B)
- Lazy loading (only load when needed)
- Provide cloud deployment option

### Risk 3: Training Data Quality
**Risk**: Bad patterns get reinforced (garbage in, garbage out)  
**Impact**: High - system learns wrong lessons  
**Mitigation**:
- Human-in-the-loop reconciliation (approve before learning)
- Validation rules before pattern storage
- Ability to reset/prune learned patterns
- Confidence thresholds (only learn from high-confidence outcomes)

### Risk 4: Cold Start Problem
**Risk**: Useless until significant task history exists  
**Impact**: Medium - poor initial experience  
**Mitigation**:
- Start with simple RAG (works immediately)
- Seed with common patterns (pre-trained knowledge)
- Add learning incrementally as data accumulates
- Provide value even with zero history (semantic search)

### Risk 5: Context Window Overflow
**Risk**: Assembled context exceeds main agent's window  
**Impact**: Medium - breaks main agent  
**Mitigation**:
- Token budget parameter (max_tokens)
- Intelligent truncation (keep most relevant)
- Summarization for large contexts
- Warn when approaching limits

### Risk 6: Privacy Concerns
**Risk**: Learning store contains sensitive information  
**Impact**: Low - local-first design  
**Mitigation**:
- All data stays local (no cloud sync)
- Learning store in `~/.backlog/` (user-controlled)
- Clear documentation on what's stored
- Easy purge/reset mechanism

## Alternatives Considered

### Alternative 1: Cloud-Based Optimization
**Description**: Use cloud LLM for optimization instead of local  
**Pros**: More powerful models, no local resources  
**Cons**: Privacy concerns, latency, cost, requires internet  
**Decision**: Rejected - violates local-first principle

### Alternative 2: Rule-Based Optimization
**Description**: Hard-code anti-patterns and optimizations  
**Pros**: Simple, predictable, no ML needed  
**Cons**: Doesn't learn, doesn't adapt to user, brittle  
**Decision**: Rejected - doesn't improve over time

### Alternative 3: Main Agent Self-Optimization
**Description**: Let main agent (Claude, etc.) handle optimization  
**Pros**: No additional infrastructure  
**Cons**: Expensive, no persistence, no learning across sessions  
**Decision**: Rejected - doesn't solve persistence problem

### Alternative 4: Vector-Only (No Graph, No LLM)
**Description**: Just add semantic search, skip graph and LLM  
**Pros**: Simple, lightweight  
**Cons**: 70% accuracy vs 85%, no tool optimization, no learning  
**Decision**: Considered for Phase 1 only, not endgame

## Key Insights

1. **Context engineering is THE 2025/2026 shift** - Anthropic research confirms this is where the field is moving
2. **Hybrid approach wins** - Vectors (70%) + Graphs (85%+) = best results
3. **Meta-learning without retraining** - Local LLM learns patterns without changing main model parameters
4. **Reflection improves performance** - +5.59% from structured error reflection (research-backed)
5. **MCP resources enable ambient context** - Push, not pull (game-changer for UX)
6. **Tool use optimization is separate from memory** - Dual role for local LLM unlocks both
7. **Self-optimization is the endgame** - System gets better over time, not static
8. **Local-first enables privacy** - All learning stays on user's machine
9. **Phased approach reduces risk** - Each phase delivers value independently

## Consequences

### Positive
- Main agents become MORE efficient over time (not static)
- Learns from mistakes WITHOUT expensive retraining
- Reduces token waste (better context, better tool calls)
- Reduces latency (optimal routing, fewer retries)
- Improves coherence (persistent context + learned patterns)
- Self-optimizing (continuous improvement from feedback)
- Privacy-preserving (all local)
- Transforms backlog-mcp from task tracker → agentic work system

### Negative
- Significant implementation complexity (4 phases, 3-6 months)
- Requires local LLM infrastructure (Ollama)
- Learning store adds storage overhead
- Cold start period before optimization kicks in
- Risk of learning bad patterns if not careful
- Maintenance burden for optimization layer

### Neutral
- Changes product positioning (task tracker → optimization layer)
- Requires user education (new mental model)
- May attract different user base (power users vs casual)

## References

- **TASK-0023**: Backlog as LLM Context Engineering Tool
- **EPIC-0002**: backlog-mcp 10x (parent epic)
- **MetaAgent**: https://arxiv.org/html/2508.00271v1
- **RouteLLM**: https://lmsys.org/blog/2024-07-01-routellm/
- **HiTEC**: https://arxiv.org/html/2506.00042v1
- **ToolScan**: https://arxiv.org/html/2411.13547v2
- **Reflexion**: https://arxiv.org/html/2509.18847v1
- **Zep**: https://arxiv.org/abs/2501.13956
- **Anthropic Context Engineering**: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- **IBM LLM Routing**: https://research.ibm.com/blog/LLM-routers

## Next Steps

1. ✅ Create TASK-0089 (this ADR's implementation task)
2. ⬜ Design Phase 1 implementation (hydrate + vectors)
3. ⬜ Prototype `backlog_assemble_context` tool
4. ⬜ Validate with real usage before Phase 2
5. ⬜ Create sub-tasks for each phase
6. ⬜ Update EPIC-0002 with this vision
