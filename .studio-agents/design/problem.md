# Problem Articulation: Eisenhower Matrix for backlog-mcp

## The Problem in My Own Words

<core>backlog-mcp has no concept of priority. All tasks are equal — the only ordering is by recency (updated/created date). When a user or agent asks "what should I work on next?", the system can only list tasks chronologically. It cannot distinguish between a critical bug causing data loss and a nice-to-have UI polish task. The user specifically struggles with a common productivity anti-pattern: gravitating toward intellectually stimulating work (Q4: interesting but not important) while procrastinating on high-impact work (Q1/Q2: important, possibly urgent). The system currently makes this invisible — there's no signal that says "you're working on the wrong thing."</core>

## Why This Problem Exists

backlog-mcp was designed as a task tracker for LLM agents — a place to store and retrieve work items. Priority was never part of the data model because the initial use case was "remember what needs to be done," not "decide what to do next." As the system evolved into a more complete work management tool (with epics, milestones, search, viewer), the absence of prioritization became a gap.

## Who Is Affected

1. **The user (human)**: Can't quickly see what's most important. Defaults to working on whatever feels interesting or recent. The Eisenhower Matrix conversation was literally triggered by this pain.
2. **LLM agents**: When asked "what should I work on?", agents have no priority signal. They either ask the user or make a judgment call based on task descriptions — inconsistent and unreliable.
3. **The viewer**: Shows a flat list sorted by date. No visual distinction between critical and trivial work.

## Scope and Boundaries

**In scope:**
- Priority data model (urgency + importance fields on Task)
- MCP tool integration (set/query priority via backlog_update, backlog_list, backlog_create)
- Viewer integration (matrix view or priority-aware list)
- Computed quadrant from urgency × importance

**Out of scope (for now):**
- AI-powered auto-prioritization (future enhancement — requires LLM calls)
- Sprint planning / time-boxing
- Team-level priority (this is a single-user system)
- Complex scoring frameworks (RICE, WSJF)

## Root Causes

<dominant>The dominant root cause is a missing data model dimension. Tasks have status (what state is it in?) and type (what kind of thing is it?) but no priority (how important/urgent is it?). Without this dimension, no tool — human or AI — can make informed prioritization decisions from the backlog alone.</dominant>

<alternative>An alternative root cause is the lack of priority *visibility*. Even if the user mentally knows what's important, the system doesn't surface it. The viewer shows all tasks equally. There's no "you have 3 urgent+important tasks you haven't touched" signal. The problem might be less about data and more about UX — making priority impossible to ignore.</alternative>

<whatifwrong>What if priority fields aren't the right abstraction? Maybe the user doesn't need to manually tag urgency/importance — maybe the system should infer it from signals (blocking chains, age, epic alignment, keywords). If manual tagging is too much friction, users won't do it, and the feature becomes dead weight. The design must account for this: either make tagging effortless, or provide automated suggestions, or both.</whatifwrong>

## What Has Been Tried

Nothing in backlog-mcp. The user's Eisenhower Matrix analysis in this conversation was done manually by me (the AI assistant) reading task descriptions and making judgment calls. That worked as a one-off but isn't repeatable or persistent.

## Adjacent Problems

1. **"What should I work on next?" as a first-class tool**: Beyond just priority fields, there could be a `backlog_recommend` or `backlog_triage` tool that returns a prioritized work queue. This is the agent-facing version of the Eisenhower Matrix.

2. **Task staleness / decay**: Tasks that sit open for weeks without progress may need urgency escalation. A "staleness" signal could feed into priority. This is related but separate — it's about priority changing over time, not initial assignment.

## Draft ADR Sections

### Problem Statement
backlog-mcp lacks a priority model. Tasks cannot be ranked by urgency or importance, making it impossible for users or agents to systematically determine what to work on next. The system defaults to recency-based ordering, which conflates "recently touched" with "most important."

### Context
- backlog-mcp serves as a work management system for LLM agents and their human operators
- The Task schema has status, type, and temporal fields but no priority dimension
- The viewer shows tasks sorted by updated/created date with no priority visualization
- Users report gravitating toward interesting work over important work — the system provides no corrective signal
- Industry standard: Eisenhower Matrix (urgency × importance → 4 quadrants) is the simplest effective prioritization framework
