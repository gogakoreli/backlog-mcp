# Implementation Ready

- [x] ADR created at `docs/adr/0086-broaden-write-resource-entity-protection.md`
- [ ] ADR log updated at `docs/adr/README.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements
- [x] Understand the implementation approach

<implementationplan>
1. Change `isTaskUri` in `src/resources/manager.ts` from regex to `startsWith`
2. Add tests for `write()` method in `src/__tests__/resource-manager.test.ts`
3. Run tests to verify
4. Update ADR README
</implementationplan>

<firststep>Change the one-line `isTaskUri` method</firststep>
