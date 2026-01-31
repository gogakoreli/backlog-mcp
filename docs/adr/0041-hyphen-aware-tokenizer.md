# 0041. Hyphen-Aware Custom Tokenizer

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0147

## Context

Orama's default English tokenizer keeps hyphenated words as single tokens, causing inconsistent search behavior:
- `"first"` does NOT match `"keyboard-first"` ❌
- `"first"` DOES match `"first-time"` ✅ (position-dependent)

This is a real UX problem - users expect search to "just work."

### Root Cause

Orama's default tokenizer regex:
```javascript
/[^A-Za-zàèéìòóù0-9_'-]+/gim
```

The `'-` keeps hyphens as part of words, so `keyboard-first` becomes ONE token.

### Industry Standard

Elasticsearch uses `word_delimiter_graph` token filter with `preserve_original: true`:
- Index BOTH the original term AND split parts
- `"keyboard-first"` → `["keyboard-first", "keyboard", "first"]`

## Proposed Solutions

### Option 1: Custom Tokenizer (Selected)

Create a custom tokenizer that expands hyphenated words while preserving originals.

**Pros**:
- Simple implementation (~15 lines)
- Full control over tokenization
- Solves the hyphen problem completely
- No external dependencies

**Cons**:
- Loses stemming (e.g., "running" → "run")
- Loses stop word removal
- May need future enhancement

**Implementation Complexity**: Low

### Option 2: Wrap Default Tokenizer

Get the default tokenizer and wrap its `tokenize()` method to expand hyphenated tokens.

**Pros**:
- Preserves all default behavior (stemming, stop words)
- Just adds hyphen expansion

**Cons**:
- More complex implementation
- Requires understanding Orama internals
- May break with Orama updates

**Implementation Complexity**: Medium

### Option 3: Pre-process Content

Expand hyphenated words in document content before indexing.

**Pros**:
- No tokenizer changes needed

**Cons**:
- Modifies source data
- Doesn't help with search queries
- Inconsistent behavior

**Implementation Complexity**: Low but wrong approach

## Decision

**Selected**: Option 1 - Custom Tokenizer

**Rationale**:
1. Task backlog content is short (titles, descriptions) - stemming less critical
2. Exact/partial matches matter more than linguistic variations for task search
3. Simple, maintainable solution
4. Test suite validates behavior

**Trade-offs Accepted**:
- Loss of stemming (acceptable for task search)
- Loss of stop word removal (minimal impact)

## Consequences

**Positive**:
- `"first"` now matches `"keyboard-first"` ✅
- `"keyboard-first"` still matches exactly ✅
- Task IDs like `TASK-0001` searchable as whole and parts ✅
- Consistent hyphen handling regardless of position

**Negative**:
- No stemming (e.g., "running" won't match "run")
- No stop word removal (minor impact)

**Risks**:
- Future need for stemming → Can enhance tokenizer later
- Performance with many hyphenated terms → Unlikely given task content size

## Implementation Notes

```typescript
const hyphenAwareTokenizer: Tokenizer = {
  language: 'english',
  normalizationCache: new Map(),
  tokenize(input: string): string[] {
    if (typeof input !== 'string') return [];
    const tokens = input.toLowerCase().split(/[^a-z0-9'-]+/gi).filter(Boolean);
    const expanded: string[] = [];
    for (const token of tokens) {
      expanded.push(token);
      if (token.includes('-')) {
        expanded.push(...token.split(/-+/).filter(Boolean));
      }
    }
    return [...new Set(expanded)];
  }
};
```

Pass to Orama via `components.tokenizer` in `create()` call.
