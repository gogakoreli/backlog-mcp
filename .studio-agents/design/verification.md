# Verification: Problem Understanding

## Dominant Cause
`isTaskUri` regex hardcoded to `(TASK|EPIC)` — added before substrates expansion introduced ARTF, FLDR, MLST. Confirmed by reading the code.

## Alternative Cause
The guard approach itself (regex-based URI matching) is fragile — any new entity type requires updating the regex. A path-based check (`tasks/` directory) would be more robust.

## What If Wrong
If we're wrong about `tasks/` being exclusively for entity files, broadening the guard could block legitimate `create` operations. Verified: `tasks/` is managed exclusively by `TaskStorage` for entity files. No non-entity files belong there.

<ready>YES — problem is well-understood, single regex change with clear scope. All three cause categories verified against code.</ready>
