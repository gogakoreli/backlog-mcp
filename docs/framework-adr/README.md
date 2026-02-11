# Framework Architecture Decision Records

ADRs for the `viewer/framework/` web component framework layer.

These are separate from the main project ADRs in `docs/adr/` because the framework is a self-contained subsystem with its own design trajectory.

## ADRs

- [0001. Web Component Framework: Reactive Base Class with Signals and DI](./0001-web-component-framework.md) - Proposed - 2026-02-07
- [0002. Implementation Notes: Phase 1 Insights and Adjacent Proposals](./0002-implementation-notes.md) - Active - 2026-02-09
- [0003. Migration Gaps, Framework Debt, and Component Follow-Up Tracker](./0003-migration-gaps-and-debt-tracker.md) - Active - 2026-02-09
- [0004. Framework Resilience Gaps — Pre-Implementation Review](./0004-framework-resilience-gaps.md) - Proposed - 2026-02-08
- [0005. Props vs Attributes Auto-Resolution Gap](./0005-props-vs-attributes-auto-resolution.md) - Proposed - 2026-02-08
- [0006. Framework Review — Gap Resolution and Invariant Codification](./0006-framework-review-gap-resolution.md) - Accepted - 2026-02-09
- [0007a. Shared Reactive Services Replace expose() + Reactive List Rendering](./0007-shared-services-and-each.md) - Accepted - 2026-02-09
- [0007b. Template Engine Bug: class Attribute Overwrites class:name Directives](./0007-class-attribute-classList-conflict.md) - Accepted - 2026-02-09
- [0008. Effect Isolation and Loop Detection — Defense-in-Depth](./0008-effect-scheduling-and-batching-gaps.md) - Open - 2026-02-09
- [0012. Migration Phase 14 — resource-viewer, activity-panel, Final Migration](./0012-migration-phase-14-final.md) - Active - 2026-02-11
- [0015. Eliminate explicit batch() — automatic signal coalescing](./0015-eliminate-batch-automatic-coalescing.md) - Proposed - 2026-02-11
