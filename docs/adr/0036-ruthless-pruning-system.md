# 0036. Ruthless Pruning System

**Date**: 2026-01-28
**Status**: Proposed
**Backlog Item**: TASK-0129

## Context

### The Problem

The backlog has exposed a fundamental issue: **over-commitment to equally good ideas**.

Current state:
- 15 open epics
- 69 open tasks
- All genuinely good ideas
- All treated with equal priority
- Result: 6.7% attention per epic = nothing done well

This isn't a capture problem, organization problem, or focus problem. It's a **commitment hoarding** problem. The user commits to every good idea, can't let go, and spreads attention so thin that nothing gets the depth it deserves.

### The Insight

"When all are treated equally, they all get just average treatment."

The skill needed isn't better productivity—it's **killing good ideas so great ideas can live**. This is "kill your darlings" applied to life, not writing. The darlings aren't bad; that's what makes killing them hard and necessary.

### Research Findings

**Buffett's 25/5 Rule**: Write 25 goals, circle top 5, actively AVOID the other 20. The remaining 20 aren't "someday"—they're distractions that prevent achieving what matters.

**Essentialism (Greg McKeown)**: "It's not about getting more things done—it's about getting the right things done." Ruthless elimination of the non-essential, even good opportunities.

**WIP Limits (Kanban)**: Hard constraints on work in progress. As WIP exceeds capacity, throughput declines. Lower WIP = higher focus = faster completion.

**The ONE Thing (Gary Keller)**: Single most important task creates domino effect. Extraordinary results come from narrowing focus, not expanding it.

**Commitment Devices (Behavioral Economics)**: Self-imposed constraints that bind future behavior. Pre-commitment makes deviation costly.

**Sunk Cost Fallacy**: We keep things because we invested in them, not because they're valuable. Must evaluate based on future value, not past investment.

**Auto-Decay Systems**: Tools like Sunsama auto-archive tasks that roll over multiple days. Forces attention or natural death.

## Proposed Solutions

### Option 1: The Constraint Model

**Philosophy**: Hard limits force choice. You CAN'T over-commit—the system prevents it.

**Mechanism**:
- Maximum 5 active epics (system refuses to create #6)
- Maximum 20 open tasks total
- To add new item → must archive/cancel existing first
- "One in, one out" enforced by system

**User Experience**:
```
> backlog_create title="New Epic Idea"
❌ Cannot create: You have 5 active epics (maximum).
   Archive or cancel one first:
   - EPIC-0002: Backlog MCP (last touched: 2 days ago)
   - EPIC-0007: Studio Agents (last touched: 5 days ago)
   ...
```

**Metaphor**: A parking lot with 5 spaces. Car 6 can't enter until one leaves.

**Pros**:
- Forces decision at moment of creation
- Simple, clear, unambiguous rules
- Impossible to accumulate—system enforces discipline
- No willpower required

**Cons**:
- Feels restrictive and punishing
- May create anxiety at the "kill" moment
- Arbitrary numbers (why 5? why 20?)
- Doesn't distinguish legitimate parallel work from over-commitment
- Could block urgent work if at limit

**Implementation Complexity**: Low
- Add count check before create
- Return error with suggestions when at limit

---

### Option 2: The Decay Model

**Philosophy**: Ideas that don't get attention die naturally. No manual killing needed—neglect is the killer.

**Mechanism**:
- Every task/epic has a "life" timer (configurable, default 30 days)
- Any interaction (view, update, reference) resets the timer
- Timer visible: "12 days remaining"
- At 0 → auto-archived with status "decayed"
- Dashboard shows items "dying" (3 days left, 1 day left...)

**User Experience**:
```
EPIC-0003: TypeScript DSL
Status: open | Life: 3 days ⚠️
Last touched: 27 days ago

[Touch to Reset] [Let Die] [Archive Now]
```

Weekly digest:
```
🪦 Decayed this week:
- TASK-0045: Research caching strategies
- TASK-0067: Explore voice capture

🌱 Still alive (touched recently):
- EPIC-0002: Backlog MCP (reset 2 days ago)
- TASK-0129: Ruthless Pruning (reset today)

⚠️ Dying soon:
- EPIC-0005: Grokking Harness (4 days left)
- TASK-0023: Context Engineering (6 days left)
```

**Metaphor**: A garden. Plants you water live. Plants you ignore wilt and become compost.

**Pros**:
- No painful manual "kill" decisions
- Natural selection—what you actually care about survives
- Reveals true priorities through behavior, not stated intention
- Automatic cleanup of abandoned ideas
- Low cognitive overhead once set up

**Cons**:
- May lose genuinely good ideas during busy periods (vacation, crunch)
- Requires trust in the system
- "Touching" to keep alive could become a chore/game
- Doesn't prevent initial over-commitment, just cleans up after
- Long-term important but not urgent items may die unfairly

**Implementation Complexity**: Medium
- Add `last_touched` and `decay_days` fields to schema
- Background job or on-access check for decay
- New "decayed" status or use existing "cancelled"
- Dashboard/digest for decay visibility

---

### Option 3: The Visibility Model

**Philosophy**: Make over-commitment visible and painful. Don't prevent it—illuminate the cost.

**Mechanism**:
- Dashboard shows attention spread: "15 epics = 6.7% attention each"
- Weekly "re-commitment" ritual: review each epic, explicitly confirm or archive
- "Attention debt" metric tracks how spread you are over time
- Warnings but no hard blocks

**User Experience**:

Dashboard:
```
📊 Attention Spread

You have tokens to spend: 100%

Current allocation:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EPIC-0002 ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 6.7%
EPIC-0007 ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 6.7%
EPIC-0001 ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 6.7%
... (12 more epics)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ Recommendation: 3-5 active epics for meaningful progress
   Current: 15 epics (3x over recommended)
```

Weekly ritual prompt:
```
🔄 Weekly Re-commitment (Sunday 6pm)

Review your 15 active epics. For each, choose:
[Continue] [Pause] [Archive]

EPIC-0002: Backlog MCP
Last activity: 2 days ago | Tasks: 12 open, 8 done
→ [Continue]

EPIC-0005: Grokking Harness  
Last activity: 45 days ago | Tasks: 3 open, 0 done
→ [Archive] "Haven't touched in 6 weeks"

...
```

**Metaphor**: A budget app. You can spend anywhere, but you see the tradeoffs in real-time.

**Pros**:
- Respects autonomy—you choose
- Makes invisible cost visible
- Periodic ritual creates reflection habit
- No arbitrary limits
- Educational—builds awareness over time

**Cons**:
- Relies on willpower (which is the original problem)
- Can be ignored/dismissed
- Doesn't force action—just suggests
- Weekly ritual may become annoying checkbox
- Visibility without constraint may not change behavior

**Implementation Complexity**: Medium
- Attention spread calculation
- Weekly prompt/notification system
- Re-commitment UI flow
- Tracking of ritual completion

---

## Decision

**Selected**: Hybrid Approach - Decay + Periodic Grooming + Soft Warnings

None of the pure approaches is sufficient alone:
- **Constraints alone** are too rigid and don't account for legitimate complexity
- **Decay alone** may kill important long-term items unfairly
- **Visibility alone** relies on willpower that's already proven insufficient

### The Hybrid Design

**1. Decay for Tasks (Natural Selection)**
- Tasks decay after 30 days of no interaction
- Decay is visible ("14 days remaining")
- Auto-archive to "decayed" status
- Can be resurrected from archive if needed

**2. Forced Grooming for Epics (Periodic Ritual)**
- Weekly prompt to review all active epics
- Must explicitly [Continue] or [Archive] each one
- Can't dismiss without decision
- Skipping = all epics auto-pause until reviewed

**3. Soft Warnings (Awareness)**
- Warning when creating epic #6+: "You have 5 epics. Adding more spreads attention thinner. Continue?"
- Dashboard shows attention spread
- No hard blocks, but friction and visibility

### Why This Combination

- **Tasks decay naturally** → cleans up abandoned work without painful decisions
- **Epics require explicit re-commitment** → forces periodic reflection on big commitments
- **Warnings create friction** → makes over-commitment a conscious choice, not default

This respects that:
- Some over-commitment is legitimate (work + side projects + career)
- But it should be conscious, not accidental
- And the system should help clean up what you've actually abandoned

## Consequences

**Positive**:
- Abandoned tasks die automatically (no guilt, no decision fatigue)
- Epics require periodic conscious commitment (can't just accumulate)
- Over-commitment is visible and has friction (but not blocked)
- Backlog naturally stays healthier over time
- Builds habit of regular reflection

**Negative**:
- More complex than single approach
- Decay timer needs tuning (30 days may be wrong)
- Weekly ritual could feel like a chore
- May lose some good ideas to decay during busy periods

**Risks**:
- **Decay too aggressive**: Important but not urgent items die. Mitigation: 30-day default is generous; can adjust per-item.
- **Ritual fatigue**: Weekly review becomes checkbox. Mitigation: Keep it short; only epics, not all tasks.
- **Gaming the system**: Touching items just to reset timer. Mitigation: Decay is for cleanup, not punishment; if you care enough to touch it, it should live.

## Implementation Notes

### Phase 1: Decay System
1. Add `last_touched: Date` to task schema
2. Add `decay_days: number` (default 30, configurable)
3. Update `last_touched` on any interaction (get, update, reference)
4. Add decay check to `backlog_list` - show "X days remaining"
5. Background or on-access auto-archive when decayed
6. New filter: `status: decayed` or reuse `cancelled`

### Phase 2: Epic Grooming Ritual
1. Add `last_reviewed: Date` to epic schema
2. Weekly prompt mechanism (how? CLI? Viewer? Notification?)
3. Grooming UI: list epics, require [Continue]/[Archive] for each
4. Track grooming completion; nag if skipped

### Phase 3: Soft Warnings
1. Count check on epic creation
2. Warning message with current count and recommendation
3. Dashboard attention spread visualization
4. Proceed anyway option (no hard block)

### Open Questions
- How to deliver weekly grooming prompt? (CLI startup? Email? Viewer banner?)
- Should decay timer be per-item configurable or global?
- What happens to tasks under a "paused" epic?
- Should decayed items be recoverable? For how long?

## References

- [Buffett's 25/5 Rule](https://modelthinkers.com/mental-model/buffetts-two-lists)
- [Essentialism by Greg McKeown](https://www.sumreads.com/books/essentialism.html)
- [WIP Limits in Kanban](https://www.launchnotes.com/blog/mastering-wip-limits-in-kanban-a-comprehensive-guide)
- [The ONE Thing by Gary Keller](https://summaries.muthu.co/posts/productivity_and_habits/the-one-thing/)
- [Commitment Devices](https://en.wikipedia.org/wiki/Commitment_device)
- [Sunk Cost Fallacy](https://fastercapital.com/content/Abandonment--The-Sunk-Cost-Fallacy--Learning-to-Let-Go.html)
- [Sunsama Auto-Archive](https://help.sunsama.com/docs/archive)
