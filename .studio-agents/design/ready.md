# Implementation Ready

## Checklist
- [x] ADR created at `docs/adr/0084-eisenhower-matrix-two-axis-priority.md`
- [ ] ADR log updated at `docs/adr/README.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements
- [x] Understand the implementation approach

<implementationplan>
1. **Schema**: Add `urgency?: number` and `importance?: number` to Task interface + CreateTaskInput
2. **Priority utils**: Create `src/storage/priority.ts` with `getQuadrant()` and `getPriorityScore()` functions
3. **backlog_create**: Add urgency/importance params to Zod schema
4. **backlog_update**: Add urgency/importance params (nullable to clear)
5. **backlog_list**: Add `quadrant` filter, `priority` sort option, include quadrant in response
6. **Viewer — task-item**: Show quadrant badge (color-coded)
7. **Viewer — filter-bar**: Add quadrant filter buttons
8. **Viewer — sort**: Add "Priority" sort option
9. **Tests**: Unit tests for priority utils, integration tests for tool changes
10. **ADR README**: Update log
</implementationplan>

<firststep>Schema change + priority utils with tests. This is the foundation everything else builds on.</firststep>
