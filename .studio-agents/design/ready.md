# Implementation Ready

- [x] ADR created at `docs/adr/0085-source-path-for-backlog-create.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements (TASK-0354)
- [x] Understand the implementation approach

<implementationplan>
1. Add `source_path` to Zod schema in `backlog-create.ts` with `.refine()` for mutual exclusion with `description`
2. Add path resolution + file reading logic in the handler (before `createTask` call)
3. Add tests
4. Build and verify
</implementationplan>

<firststep>Modify the Zod schema and handler in `src/tools/backlog-create.ts`</firststep>
