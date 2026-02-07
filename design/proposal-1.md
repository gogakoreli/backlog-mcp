# Proposal 1: Rename-and-Redirect

<name>Rename-and-Redirect</name>
<approach>Rename `?epic=&task=` to `?id=` by aliasing in url-state.ts, keep sidebar scope in URL as hidden `_scope` param, redirect old URLs.</approach>
<timehorizon>[SHORT-TERM]</timehorizon>
<effort>[LOW]</effort>

<differs>Keeps sidebar scope in URL (as a hidden param) rather than moving it to localStorage. Minimal code changes — mostly renaming params and adding a redirect.</differs>

## Design

### Changes
1. **url-state.ts**: Replace `epic`/`task` with `id` and `_scope` in State type. `_scope` is the sidebar container ID. Add `get()` migration: if `epic`/`task` found, rewrite to `id`/`_scope`.
2. **main.ts**: `task-selected` → sets `id`. `epic-navigate` → sets `_scope` + `id`.
3. **All components**: Replace `state.epic` with `state._scope`, `state.task` with `state.id`.

### What it solves
- Clean primary URL: `?id=TASK-0005` (users can ignore `_scope`)
- Backward compat via redirect
- Minimal code changes

### What it doesn't solve
- Sidebar drilling still pushes URL history (back button issue)
- `_scope` still leaks into URL (just renamed)
- Event model still conflated (`epic-navigate` does double duty)

## Evaluation

- **Product design**: Partially aligned — URL is cleaner but scope still leaks
- **UX design**: No UX change — same behavior, different param names
- **Architecture**: Band-aid — doesn't separate concerns
- **Backward compatibility**: Good — redirect handles old URLs
- **Performance**: No impact

## Rubric

| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | Mostly find-and-replace across components |
| Risk | 5 | Minimal behavioral change, just param renaming |
| Testability | 4 | Easy to verify URL params change correctly |
| Future flexibility | 2 | Still couples scope to URL, needs rework later |
| Operational complexity | 5 | No new infrastructure, same architecture |
| Blast radius | 5 | If redirect fails, old URLs still partially work |

## Pros
- Very fast to implement (< 1 hour)
- Zero behavioral change for users
- Low risk of regressions

## Cons
- Doesn't solve the actual problem (scope in URL)
- Back button still undoes sidebar drilling
- Will need to be redone when properly separating concerns
- `_scope` param is a code smell
