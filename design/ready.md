# Implementation Ready (TASK-0285)

- [x] ADR created at `docs/adr/0072-normalize-then-multiply-scoring.md`
- [x] ADR log updated at `docs/adr/README.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements
- [x] Understand the implementation approach

<implementationplan>
1. Rewrite `rerankWithSignals()` — normalize scores, replace additive bonuses with multiplicative factors, add prefix matching
2. Update title boost from 2 to 5 in both `search()` and `searchAll()`
3. Update golden tests — adjust score threshold assertions for new 0-2 range
4. Run all tests, verify passing
5. Commit
</implementationplan>

<firststep>Rewrite the rerankWithSignals() function and RANKING_BONUS constants in orama-search-service.ts</firststep>
