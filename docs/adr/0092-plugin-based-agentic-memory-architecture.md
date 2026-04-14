---
title: "0092. Plugin-Based Agentic Memory Architecture"
date: 2026-04-14
status: Accepted
backlog_item: TASK-0629
---

# 0092. Plugin-Based Agentic Memory Architecture

**Date**: 2026-04-14
**Status**: Accepted
**Backlog Item**: TASK-0629

## Problem Statement

Agents using backlog-mcp lose context between sessions. Every conversation starts cold. The backlog stores tasks, artifacts, evidence, and ADRs — but has no structured memory system that helps agents accumulate knowledge, recall past decisions, or start warm.

## Decision Journey

This ADR documents the full exploration path. We evaluated 6+ external systems before arriving at the decision to build natively.

### Phase 1: MemPalace Analysis

[MemPalace](https://github.com/MemPalace/mempalace) (45.6k stars, v3.3.0) — Python-based memory system using ChromaDB.

**Concepts worth stealing:**
- Layered memory stack (L0–L3) — ~600 token wake-up context
- Temporal knowledge graph with `valid_from`/`valid_until`
- Specialist agent diaries — per-agent memory partitions
- Zero-LLM write path — fully offline, no API cost

**Problems identified (confirmed by [lhl/agentic-memory](https://github.com/lhl/agentic-memory) independent analysis):**
- 96.6% LongMemEval is just ChromaDB vector search — palace structure not involved
- "+34% palace boost" is standard metadata filtering
- AAAK compression is lossy, regresses quality (84.2% vs 96.6% raw)
- Contradiction detection claimed but not implemented
- 9 days old at time of analysis, mostly CI/docs commits since
- The survey author refused to promote it to the main comparison — only system with that distinction

### Phase 2: Integration Approaches Explored

We explored multiple ways to use MemPalace from TypeScript:

| Approach | Verdict |
|---|---|
| **Run as separate MCP server** | ❌ Creates competing tools — `backlog_search` vs `mempalace_search`. Split-brain memory |
| **ChromaDB JS client** → talk to MemPalace's DB directly | ❌ Bypasses palace logic, just raw vector search — no better than Orama |
| **pythonia** (JSPyBridge) → call Python functions from TS | ✅ Cleanest bridge, but MemPalace is designed as a standalone system, not an embeddable library |
| **Embed as storage backend** (replace Orama) | ❌ MemPalace is a search wrapper around ChromaDB — replacing Orama with ChromaDB is a downgrade (no BM25, no hybrid search) |

**Key insight**: Running MemPalace as a separate MCP server invalidates backlog-mcp's search and context tools. They become competing tools. The agent has to choose between two memory systems with overlapping data.

### Phase 3: Broader Landscape Survey

Via [lhl/agentic-memory](https://github.com/lhl/agentic-memory) — the most comprehensive survey of agentic memory systems (40+ systems analyzed with deep dives).

| System | Language | Strengths | Fit for backlog-mcp |
|---|---|---|---|
| **Mem0** | Python + TS SDK | LLM-powered extraction, ADD/UPDATE/DELETE ops, hybrid search, YC-backed, 53k stars | ❌ Requires LLM on every write — adds cost/latency/API dependency |
| **Karta** | Rust | Dream engine (7 inference types), contradiction detection, decay, Zettelkasten graph | ❌ No JS bindings — would need NAPI bridge or sidecar |
| **ClawVault** | JavaScript (npm) | Task primitives, observation pipeline, session lifecycle, 449+ tests | Possible but opinionated — fights our entity model |
| **ENGRAM** | Python | Typed memory, strict evidence budgets, strong benchmarks | ❌ Python only |
| **memv** | Python | Nemori-inspired predict-calibrate, bi-temporal validity | ❌ Python only |

### Phase 4: The "Why Not Mem0" Realization

Mem0 was the strongest candidate — TypeScript SDK, intelligent extraction, real benchmarks. But:

- **Requires LLM on every write** — when an agent writes `evidence: ["Fixed auth by adding middleware"]`, Mem0 sends that to GPT-4.1-nano to extract memories. But the agent IS an LLM — it already produced structured output. A second LLM re-extracting what the first LLM wrote is redundant
- **Creates a lossy copy** — the backlog stores the raw truth (tasks, evidence, ADRs). Mem0 would create LLM-summarized "memories" that compete with the source of truth
- **API dependency** — every `backlog_update(status: "done")` would require an OpenAI API call

### Phase 5: The Backlog IS the Memory

The breakthrough realization: **backlog-mcp already stores everything an agent needs to remember.** Tasks, evidence, ADRs, artifacts, activity logs — this IS episodic memory. The problem isn't storage, it's surfacing.

What's missing isn't a memory database — it's memory *behavior* on top of the existing data:

| Capability | What it means | Exists today? |
|---|---|---|
| **Score decay** | Recent work ranks higher than old work | ❌ All tasks rank equally regardless of age |
| **Wake-up context** | Agent starts with dense ~600 token briefing | ❌ Agent must manually call `backlog_context` |
| **Implicit capture** | Task completions auto-become searchable memories | ❌ Evidence is stored but not optimized for recall |
| **Echo/fizzle** | Track which memories agents actually use | ❌ No feedback loop |
| **Temporal facts** | Facts that expire when reality changes | ❌ No `valid_from`/`valid_until` |

## Decision

**Build agentic memory natively in backlog-mcp as the DEFAULT implementation, behind a composable plugin interface.** Users can replace the memory layer with Mem0, Karta, MemPalace, or their own implementation.

### Architecture: Plugin Boundary

```
BacklogService (your code)
       │
       ▼
MemoryComposer (orchestrator — packages/memory)
       │
       ├── MemoryStore interface ◄── THE PLUGIN BOUNDARY
       │         │
       │         ├── OramaMemoryStore  (default, ships with backlog-mcp)
       │         ├── Mem0Store         (optional, npm install mem0ai)
       │         ├── MemPalaceStore    (optional, pip install mempalace)
       │         ├── KartaStore        (future, when JS bindings exist)
       │         └── YourOwnStore      (implement MemoryStore interface)
       │
       ▼
MCP Tools (backlog_wakeup, backlog_search, backlog_context)
```

BacklogService never touches memory storage directly — it goes through `MemoryComposer`, which delegates to whatever `MemoryStore` implementations are registered. The default is Orama-backed (zero deps, works out of the box). Users configure alternatives via config:

```json
{
  "memory": {
    "store": "orama"
  }
}
```

Or:

```json
{
  "memory": {
    "store": "mem0",
    "config": { "apiKey": "..." }
  }
}
```

The `MemoryStore` interface is the contract. Everything above it (BacklogService, MCP tools) doesn't change regardless of which store is plugged in. Everything below it (Orama, Mem0, Karta) is swappable.

### Rationale

- The backlog IS the source of truth — don't create a lossy copy in another system
- No LLM required on write path — the agent already produces structured output
- No API dependency — works offline, zero cost
- No Python bridge — native TypeScript on existing Orama infrastructure
- No competing tools — one memory system, not two
- The 5 missing capabilities are ~200 lines of application logic, not a library problem

### Assumptions That Must Hold

- Orama hybrid search (BM25 + vector) is sufficient for memory recall — no need for ChromaDB or Qdrant
- Agent-produced evidence is high enough quality that LLM re-extraction adds no value
- Score decay + echo/fizzle provides enough memory curation without LLM-based write gating

### Trade-offs Accepted

- No LLM-powered fact extraction — we depend on agents writing good evidence
- No contradiction detection initially — Karta's dream engine is inspiring but premature
- No cross-system memory — memories live in backlog-mcp only

### Future: Karta as Upgrade Path

The `packages/memory` plugin architecture (`MemoryStore` interface) allows swapping backends. If Karta ships JS bindings or an HTTP API, it can replace the native implementation without changing any backlog tools. The abstraction exists for this reason.

## Engineering Plan

### Phase 1: Score Decay
- Add `score *= Math.exp(-λ * daysSinceCreated)` to existing `scoring.ts`
- Recent tasks, evidence, and decisions rank higher than old ones
- ~5 lines in existing re-ranking pipeline

### Phase 2: Wake-Up Context
- New `backlog_wakeup` MCP tool
- Returns ~600 token dense payload: active tasks, recent completions, current blockers, last session summary
- Built from existing activity log + open task queries
- ~50 lines

### Phase 3: Implicit Memory Capture
- Hook in `BacklogService.update()` — when status→done, index evidence into a dedicated memory collection in Orama
- Hook in `BacklogService.create()` — when type=artifact, index content
- Memories are searchable via existing `backlog_search` with boosted relevance
- ~30 lines

### Phase 4: Echo/Fizzle Feedback
- Track which search results agents reference in subsequent tool calls
- Increment usage counter on referenced items, decay counter on ignored items
- Feed usage signal into scoring: `score *= (1 + log(usageCount))`
- ~40 lines

### Phase 5: Temporal Facts
- Add optional `valid_from`/`valid_until` to entity metadata
- Filter expired facts in search results
- ~20 lines

## Cross-References

Inspirations analyzed during this decision:

- [MemPalace](https://github.com/MemPalace/mempalace) — layered memory stack (L0–L3), zero-LLM write path, spatial metaphor
- [Mem0](https://github.com/mem0ai/mem0) — explicit memory ops (ADD/UPDATE/DELETE/NOOP), graph memory, LLM-powered extraction
- [Karta](https://github.com/rohithzr/karta) — dream engine, contradiction detection, Zettelkasten graph, probabilistic decay
- [ClawVault](https://github.com/Versatly/clawvault) — observation pipeline, session lifecycle, task primitives
- [ENGRAM](https://arxiv.org/abs/2511.12960) — typed memory (episodic/semantic/procedural), strict evidence budgets
- [lhl/agentic-memory](https://github.com/lhl/agentic-memory) — comprehensive survey of 40+ systems, benchmarks, and analyses
- [agentic-memory ANALYSIS-mempalace.md](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md) — independent MemPalace code audit

Key themes from the survey:
- Score decay: `relevance × exp(-λ × days)` — universal across all serious systems
- Echo/fizzle feedback loops — track which memories get used
- SQLite + FTS + local embeddings beats hosted vector DBs at <5K items
- Tiered retrieval: summary first (cheap), vector search fallback (thorough)
- Phased build order: core memory first, reliability second, intelligence last

## Existing Infrastructure (packages/memory)

The `packages/memory` package provides the plugin abstraction layer:

- `MemoryStore` interface — `store()`, `recall()`, `forget()`, `size()`
- `MemoryComposer` — routes to stores by layer, merges recall results
- `InMemoryStore` — zero-dep default for testing/session memory
- `MemPalaceStore` — pythonia bridge adapter (kept as option, not primary)

The native Orama-backed implementation will be added as the default store.
