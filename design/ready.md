# Implementation Ready

## Checklist

- [x] ADR created at `design/ADR.md` (to be copied to `docs/framework-adr/0015-eliminate-batch-automatic-coalescing.md`)
- [x] Re-read the ADR
- [x] Re-read the task requirements
- [x] Understand the implementation approach

## Note on scope

TASK-0280 is a **design task** — "Produce an ADR with recommendation." The task explicitly says "This is a long-term architecture design task, not a quick fix."

The deliverable is the ADR itself. Implementation (removing batch(), adding flush(), refactoring url-state, updating tests) would be a separate task.

<implementationplan>
The ADR documents a 7-step implementation plan:
1. Add `flush()` export to signal.ts (additive, no risk)
2. Remove `batchDepth`, `batch()`, and dual scheduling path from signal.ts
3. Remove `batch()` from all 25 call sites across 8 files
4. Refactor url-state.ts: remove `pushing` flag
5. Update tests: remove batch-specific tests, add microtask coalescing tests
6. Update ADR 0002 implementation notes
7. Run full test suite, verify viewer behavior
</implementationplan>

<firststep>Copy ADR to its permanent location in docs/framework-adr/ and update the README.</firststep>
