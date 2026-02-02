# 0052. Spotlight Search UX Overhaul

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0166

## Problem Statement

Spotlight search has several UX issues: confusing percentage scores, missing resources in results, insufficient match context, and no filtering/sorting controls.

## Problem Space

### Why This Problem Exists

MVP implementation focused on functionality over UX polish. Percentage scores were added for debugging but never refined for end users. Resource search was added but may have integration issues. Match display shows only the first matching field.

### Who Is Affected

- Users searching for tasks/epics/resources
- Users trying to understand why results rank as they do
- Users wanting to filter or sort search results

### Problem Boundaries

**In scope**: Score display, resource search, match context, search controls (sort/filter)
**Out of scope**: Personalization, saved searches, advanced query syntax

### Problem-Space Map

**Dominant causes:**
- Percentage scores are meaningless to users (what does 82% mean?)
- Match context only shows first matching field
- No way to filter by type or sort by recency

**Alternative root causes:**
- Resources might be indexed but filtered out somewhere in the pipeline
- Users may want scores for power-user debugging

**What if we're wrong:**
- Maybe users DO want numeric scores - could make them optional/hidden

## Context

### Current State

- Spotlight shows percentage scores (e.g., "82%") normalized against max score
- Resources have code paths but may not appear in results
- Match display shows "Matched in title" for first matching field only
- No sort toggle or type filters in Spotlight

### Research Findings

1. Filter bar correctly has search trigger button (TASK-0161 completed)
2. Resource indexing code exists in `backlog-service.ts` and `orama-search-service.ts`
3. ADR-0051 implemented multi-signal ranking with title/type/recency bonuses
4. VS Code Command Palette and Raycast don't show numeric scores - just ranked order

### Prior Art

- VS Code Command Palette: Clean, fast, keyboard-driven, no scores
- Raycast: Beautiful search with categories and actions
- Linear: Minimal but informative search results
- Notion: Shows match context clearly

## Proposed Solutions

### Option 1: Minimal Surgical Fix `[SHORT-TERM]` `[LOW]`

**Description**: Remove confusing elements, fix bugs, minimal UI changes.

- Remove percentage scores entirely
- Fix resource search if broken
- Keep "Matched in X" as-is
- No new controls

**Differs from others by**:
- vs Option 2: No information enhancement
- vs Option 3: No new UI elements

**Pros**:
- Fastest to implement (~2-3 hours)
- No new complexity
- Can't break what doesn't exist

**Cons**:
- Doesn't improve match context
- No filtering/sorting capability
- Minimal UX improvement

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | 2-3 hours |
| Risk | 5 | Removing code is low risk |
| Testability | 5 | Easy to verify |
| Future flexibility | 2 | No foundation for enhancements |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Only affects score display |

### Option 2: Enhanced Match Display `[SHORT-TERM]` `[MEDIUM]`

**Description**: Improve information density without adding controls.

- Replace percentage with qualitative labels ("Best match", "Good match")
- Show ALL matched fields (not just first)
- Add match count per field
- No sort/filter controls

**Differs from others by**:
- vs Option 1: Richer information display
- vs Option 3: No interactive controls

**Pros**:
- Better information without complexity
- Users understand WHY something matched

**Cons**:
- No way to filter/sort results
- May clutter UI with too much info

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | 4-5 hours |
| Risk | 4 | New display logic, contained |
| Testability | 4 | Need to verify multi-field display |
| Future flexibility | 3 | Better foundation but no controls |
| Operational complexity | 5 | No new systems |
| Blast radius | 4 | Display changes could have edge cases |

### Option 3: Full Search Controls `[MEDIUM-TERM]` `[HIGH]`

**Description**: Add sort toggle and type filters to Spotlight.

- Remove percentage scores
- Add sort toggle: "Recent" | "Relevant" (default: Relevant)
- Add type filter pills: "All" | "Tasks" | "Epics" | "Resources"
- Show result count ("12 results")
- Add loading spinner
- Enhanced match display (all fields)
- Fix resource search

**Differs from others by**:
- vs Option 1: Adds interactive controls
- vs Option 2: Full filtering/sorting capability

**Pros**:
- Full control over search results
- Professional search UX
- Matches user expectations from other tools

**Cons**:
- More complex implementation
- More UI elements to maintain

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | 8-10 hours |
| Risk | 3 | New state management |
| Testability | 3 | More states to test |
| Future flexibility | 5 | Full foundation for future |
| Operational complexity | 4 | New UI state |
| Blast radius | 3 | Changes affect search flow |

## Decision

**Selected**: Option 3 - Full Search Controls

**Rationale**:
- Task requirements explicitly ask for sort toggle, type filters, loading indicator
- Option 1/2 would be incomplete deliveries
- Can implement cleanly without over-engineering

**For this decision to be correct, the following must be true**:
- Users actually want to filter/sort search results
- The UI won't become cluttered with controls
- Performance won't degrade with additional state

**Trade-offs Accepted**:
- More implementation time
- More UI complexity
- More states to test

## Consequences

**Positive**:
- Users can filter by type (Tasks/Epics/Resources)
- Users can sort by recency or relevance
- Clear result count and loading state
- Resources appear in search results
- No confusing percentage scores

**Negative**:
- More UI elements to maintain
- Additional API parameter (sort)
- More complex state management in Spotlight component

**Risks**:
- Filter/sort controls may clutter small screens (mitigation: responsive design)
- Recency sort may surface irrelevant old items (mitigation: still apply relevance threshold)

## Implementation Notes

### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 [Search input...                        ] [esc]      │
├─────────────────────────────────────────────────────────┤
│ [All] [Tasks] [Epics] [Resources]    Sort: [Recent ▼]   │
│                                      12 results         │
├─────────────────────────────────────────────────────────┤
│ Results...                                              │
└─────────────────────────────────────────────────────────┘
```

### API Changes

Add `sort` parameter to `/search` endpoint:
- `sort=relevant` (default): Use multi-signal ranking (ADR-0051)
- `sort=recent`: Sort by `updated_at` descending

### Score Display

Remove percentage scores entirely. The ranked order IS the relevance indicator.

### Match Context

Show all matched fields: "Matched in: title, description"
