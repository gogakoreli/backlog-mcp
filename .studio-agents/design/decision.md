# Decision

## Pre-Decision Questions

**Which proposal would I regret not doing in 6 months?**
Proposal 1. Not because it's ambitious, but because it's the one that actually ships. The problem is concrete and the fix is simple. In 6 months I'd regret overengineering this.

**Argue FOR the most ambitious (Proposal 2):**
If multiple tools need source_path resolution, having it in the storage layer avoids duplication. But right now only `backlog_create` needs it. YAGNI. If `write_resource` needs it later (or gets merged per TASK-0355), extracting a utility function from the handler is trivial.

**Real cost of playing it safe?**
If we later need source_path in other tools, we extract the ~5 lines of path resolution into a utility. That's a 5-minute refactor, not a regret.

## Self-Critique

- **Proposal 1**: Could be criticized as not forward-thinking. But the path resolution logic is literally: resolve path, validate, readFileSync. Extracting it later is trivial. The "not reusable" con is a non-issue.
- **Proposal 2**: Storage layer doing arbitrary filesystem I/O is a smell. Storage should read/write its own data directory, not reach into random user paths. This is tool-level concern, not storage-level.
- **Proposal 3**: Wrong mental model entirely. Artifacts should be snapshots. Rejected.

## Rubric Comparison

| Anchor | P1 | P2 | P3 |
|--------|----|----|-----|
| Time-to-ship | 5 | 4 | 3 |
| Risk | 5 | 4 | 2 |
| Testability | 5 | 4 | 3 |
| Future flexibility | 3 | 5 | 3 |
| Operational complexity | 5 | 5 | 2 |
| Blast radius | 5 | 4 | 2 |
| **Total** | **28** | **26** | **15** |

## Decision

<selected>1</selected>
<selectedname>source_path parameter on backlog_create</selectedname>
<rationale>Highest score across all anchors. The "future flexibility" gap vs Proposal 2 is negligible — extracting a utility function later is trivial. Proposal 2's architectural benefit (storage-level resolution) is actually a smell — storage shouldn't do arbitrary filesystem I/O. Tool handlers are the right place for this.</rationale>
<assumptions>1. Only backlog_create needs source_path for now. 2. If other tools need it, extracting a shared utility is easy. 3. File sizes are reasonable (no multi-GB files).</assumptions>
<tradeoffs>Path resolution logic is inline in one handler. If we need it elsewhere, we'll extract. Acceptable.</tradeoffs>
