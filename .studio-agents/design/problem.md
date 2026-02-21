# Problem Articulation: write_resource create guard — TASK-0373

## Problem Statement

<core>The `write_resource` handler's `isTaskUri()` guard only recognizes TASK and EPIC prefixes, leaving ARTF, FLDR, and MLST entity files unprotected from destructive `create` overwrites that strip YAML frontmatter.</core>

## Why This Exists

When the guard was originally written, only TASK and EPIC entity types existed. The substrates expansion (TASK-0255) added FLDR, ARTF, and MLST types but didn't update `isTaskUri`. Classic "new entity types added, old guard not updated" gap.

## Who Is Affected

LLM agents that call `write_resource create` on artifact files. The actual incident destroyed `ARTF-0008.md`'s frontmatter — id, status, type, timestamps, references all gone.

## Root Causes

- **Dominant**: `isTaskUri` regex is hardcoded to `(TASK|EPIC)` instead of matching all entity prefixes or all files in `tasks/`
- **Alternative**: Could argue the guard shouldn't exist at all and `create` should be frontmatter-aware — but that's TASK-0355's scope

## What If Our Understanding Is Wrong

If we broaden `isTaskUri` to match ALL files under `tasks/`, we'd also block `create` for any non-entity files someone might put there. But the `tasks/` directory is exclusively for entity files managed by the storage layer, so this is correct behavior.

## Constraints

- Must not break `str_replace`, `insert`, `append` on task files (those are the intended edit paths)
- Must not break `create` on resource files (`mcp://backlog/resources/*`)
- `isTaskUri` is also used for timestamp updates — broadening it correctly applies timestamps to all entity types

## Adjacent Problem (awareness only)

TASK-0355 asks whether `write_resource create` should exist at all. This fix is compatible with any direction that task goes — it's a minimal safety guard regardless.

## ADR Draft — Problem Statement

**Title**: Broaden write_resource entity file protection to all entity types

**Status**: Proposed

**Context**: The `write_resource` handler guards against `create` operations on entity files in the `tasks/` directory to prevent frontmatter destruction. The guard uses `isTaskUri()` which only matches `TASK-NNNN.md` and `EPIC-NNNN.md`, but the system has 5 entity types: TASK, EPIC, FLDR, ARTF, MLST.

**Problem**: Entity files with ARTF, FLDR, or MLST prefixes can be overwritten by `write_resource create`, destroying their YAML frontmatter metadata.
