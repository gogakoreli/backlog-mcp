# 0014. Compiled Positional Templates — Eliminating Comment Markers

**Date**: 2026-02-11
**Status**: Proposed
**Depends on**: [0001-web-component-framework](./0001-web-component-framework.md), [0002-implementation-notes](./0002-implementation-notes.md)

## Context

The template engine (`template.ts`, 905 lines) uses HTML comment nodes in two
ways:

1. **Expression slot markers**: Each `${}` in a tagged template becomes
   `<!--bk-N-->` in the HTML string. After `innerHTML` parsing, the framework
   walks the entire DOM tree, finds these Comment nodes, and replaces them
   with reactive bindings.

2. **Runtime boundary markers**: Dynamic content regions (`when()`, `each()`,
   signal-holding-template slots) use Comment nodes (`slot-start`/`slot-end`,
   `each-start`/`each-end`, etc.) as position anchors so the framework knows
   which nodes to remove/replace when content changes.

This approach works and is the industry standard — Lit (`<!--?lit$...-->`),
uhtml (`<!--isµN-->`), Aurelia (`<!-- view -->`), and every other no-compiler
tagged template engine uses the same pattern. The W3C Web Components group
explicitly acknowledged this in their [March 2025 meeting](https://www.w3.org/2025/03/26-webcomponents-minutes.html):

> "people use comment nodes as markers to do this, and use regular mutation
> stuff to mutate them" — Ryosuke Niwa (Apple)

However, the comment-based approach has structural inefficiencies:

- **Full DOM tree walk on every instantiation**: `processNode()` (line 183)
  recursively visits EVERY node in the cloned template to check if it's a
  comment marker. For `task-item` (~10 nodes, 6 bindings), 4 nodes are
  checked unnecessarily. For `task-list` (~25 nodes, 10 bindings), 15 nodes
  are wasted checks.

- **Regex matching in attribute processing**: `processAttributes()` (line 215)
  runs `/<!--bk-(\d+)-->/` against every attribute value on every element.
  Most attributes are static — the regex always fails on them.

- **Comment nodes pollute the live DOM**: Each expression slot leaves a
  Comment node (or replaces it with a binding). Dynamic regions add 2 Comment
  nodes per region. A task-list with 50 items has ~100 extra Comment nodes.

- **Marker string construction**: The `html()` function (line 128) builds an
  HTML string with markers, already tracking `inTag`/`quoteChar` state
  (lines 140-155) — a partial state machine that could be doing more useful
  work.

This ADR proposes replacing the comment marker system with **compiled
positional templates** — a static analysis of template strings that produces
a binding blueprint, enabling direct path-based binding without DOM walking
or comment markers.

---

## The Perspective Shift

The current architecture is a **parse-then-find** pipeline:

```
template strings → HTML string with markers → innerHTML → DOM with comments
→ walk entire DOM → find comments → replace with bindings
```

We build something, then search through it. Comments exist because we need
breadcrumbs to find our way back to expression positions after the browser's
parser runs.

The shift: **we never lose track of the positions in the first place.**

Tagged template literals give us `strings` and `values` interleaved. The
`strings` array is the same object reference per call site (JS spec
guarantee — used for our `WeakMap` cache). The strings contain ALL structural
information about the template. We can analyze them ONCE to know exactly
where every expression lands — text position, attribute value, event handler,
class toggle — and at what DOM path.

The new pipeline:

```
template strings → compile blueprint (once, cached) → clean innerHTML (once, cached)
→ clone template → walk blueprint → bind at paths (direct navigation)
```

The blueprint is a small array (typically 3-10 entries). Walking it is O(bindings).
Walking the DOM tree is O(nodes). For our components, bindings < nodes, often
by 2-3x.

---

## Proposal A: Compiled Positional Templates (Recommended)

### Architecture

Three phases, each at a different frequency:

#### Phase 1: Template Compilation (once per call site, ever)

A state machine processes the static strings to produce a **binding
blueprint** — a flat array describing each expression's type and DOM path.

```typescript
interface BindingSlot {
  index: number;        // expression index in values array
  kind: 'text' | 'attr' | 'event' | 'class' | 'ref' | 'innerHtml' | 'child';
  path: number[];       // DOM navigation: [childIndex, childIndex, ...]
  name?: string;        // attribute name, event name, or class name
  modifiers?: string[]; // event modifiers (.stop, .prevent, .enter)
  parts?: StaticPart[]; // for mixed static+dynamic attributes
}

interface StaticPart {
  type: 'static' | 'expr';
  value?: string;       // static text
  index?: number;       // expression index
}
```

The state machine also produces a **clean HTML string** — the static strings
joined with minimal placeholders. No comment markers anywhere.

**State machine** (~120 lines): Tracks four states as it processes each
character of each static string:

| State | Meaning | Transitions |
|-------|---------|-------------|
| `TEXT` | Between tags, in text content | `<` → `TAG_OPEN` |
| `TAG_OPEN` | Inside `<tag ...>`, reading tag name or between attrs | `>` → `TEXT`, `"` or `'` → `ATTR_VALUE` |
| `ATTR_NAME` | Reading an attribute name | `=` → before `ATTR_VALUE` |
| `ATTR_VALUE` | Inside quoted attribute value | closing quote → `TAG_OPEN` |

When the state machine reaches the boundary between `strings[i]` and
`strings[i+1]` (= expression position `i`), the current state determines
the expression's context:

| State at boundary | Expression kind | Example |
|-------------------|-----------------|---------|
| `TEXT` | `child` (template/signal) or `text` | `<span>${name}</span>` |
| `ATTR_VALUE` with `@` prefix | `event` | `@click="${handler}"` |
| `ATTR_VALUE` with `class:` prefix | `class` | `class:active="${sig}"` |
| `ATTR_VALUE` with `ref` name | `ref` | `ref="${myRef}"` |
| `ATTR_VALUE` with `html:inner` name | `innerHtml` | `html:inner="${content}"` |
| `ATTR_VALUE` (regular) | `attr` | `id="${id}"` |

The state machine simultaneously tracks element nesting depth to compute
DOM paths. Each opening tag increments a child counter at the current depth;
each closing tag pops the depth stack.

**Evidence this is feasible**: The current `html()` function already runs a
partial state machine (lines 140-155 of template.ts) tracking `inTag` and
`quoteChar`. The compiled approach formalizes and extends this existing logic.

#### Phase 2: Template Preparation (once per call site)

```typescript
const { blueprint, cleanHtml } = compileTemplate(strings);
const templateEl = document.createElement('template');
templateEl.innerHTML = cleanHtml;
templateCache.set(strings, { templateEl, blueprint });
```

We still use `innerHTML` — the browser's C++ parser is faster and more
correct than anything we'd write in JS. But the HTML it parses has NO
markers. It's clean, minimal HTML.

#### Phase 3: Template Instantiation (every render)

```typescript
const fragment = templateEl.content.cloneNode(true) as DocumentFragment;

for (const slot of blueprint) {
  const node = navigatePath(fragment, slot.path);
  createBinding(node, slot, values[slot.index], bindings, disposers);
}
```

We iterate the **blueprint** (small array), not the **DOM tree**. For each
entry, we navigate directly to the target node via its path —
`fragment.childNodes[0].childNodes[2]` — which is O(depth), typically 2-3
steps.

#### Text Positions: Construct, Don't Split

A naive positional approach would try to split browser-created text nodes
at computed offsets. This is fragile — browser whitespace normalization,
HTML entities, and edge cases make offset calculations unreliable.

The correct approach: **don't try to surgically modify what the browser
created. Replace it with what we know is correct.**

For `html`<span>Hello ${name}, welcome!</span>``

Clean HTML: `<span>Hello , welcome!</span>` → browser creates one text node.

The blueprint knows: expression 0 is text inside the span at path [0],
with static prefix `"Hello "` and static suffix `", welcome!"` (both
extracted directly from the template strings — no offset calculation).

During instantiation:
```typescript
const span = navigatePath(fragment, [0]);
span.textContent = '';  // discard the browser's merged text
span.append('Hello ', boundTextNode, ', welcome!');
```

We REPLACE the content entirely using the static parts we already have
from the template strings. No splitting, no offsets, no assumptions about
browser behavior. The strings array IS the source of truth for static
content — we just reconstruct it with bindings interleaved.

For pure dynamic text (`<span>${title}</span>`), the clean HTML produces
an empty span. We simply append the bound text node. Trivial.

#### Dynamic Regions: Reference-Based Anchors

For `when()`, `each()`, and signal-holding-template slots, the current
approach uses Comment nodes as boundary markers that must be FOUND in the
DOM later. The blueprint approach eliminates this entirely.

During instantiation, when the blueprint encounters a child expression
that holds dynamic content (a signal, a `when()` result, an `each()`),
it creates an empty text node as an anchor and **holds a direct reference
to it** in the binding closure:

```typescript
const anchor = document.createTextNode('');
parent.insertBefore(anchor, nextSibling);
// The binding closure captures `anchor` — no searching needed later

// When the signal changes:
effect(() => {
  // Remove old content (tracked by the binding)
  for (const node of currentNodes) node.remove();
  // Insert new content before the anchor we already hold
  parent.insertBefore(newContent, anchor);
});
```

The anchor is never "found" — it's created during instantiation and
captured in the binding's closure. This is fundamentally different from
the comment approach where markers are embedded in HTML, parsed by the
browser, and then searched for via DOM walking.

Empty text nodes work as anchors because:
- **Invisible**: render nothing, no whitespace contribution
- **Layout-neutral**: don't affect box model or inline flow
- **Selector-neutral**: not matched by CSS or `querySelector`
- **Stable**: we control the DOM — no external `normalize()` calls
- **We hold the reference**: no need to find them, ever

For dev-mode debugging, anchors could use `'\u200B'` (zero-width space)
to make them findable in DevTools, while production uses empty string.

### Concrete Example: task-item Template

Current template (from `task-item.ts:77`):

```typescript
return html`
  <div class="task-item type-${props.type}"
       class:selected="${props.selected}"
       class:current-epic="${props.currentEpic}"
       @click="${handleItemClick}">
    ${badge}
    <span class="task-title">${props.title}</span>
    ${dueDateHtml}
    ${childCountHtml}
    ${enterIconHtml}
    ${statusHtml}
  </div>
`;
```

**Current approach**: Builds HTML string with 10 `<!--bk-N-->` markers.
Parses via innerHTML. Walks ~12 DOM nodes. Finds 10 comment markers via
recursive `processNode()`. Replaces each with a binding.

**Compiled approach**: The state machine analyzes the 11 static strings
once and produces:

```
Blueprint (10 entries):
  [0] attr   path:[0] name:'class'    parts:['task-item type-', EXPR(0)]
  [1] class  path:[0] name:'selected'  index:1
  [2] class  path:[0] name:'current-epic' index:2
  [3] event  path:[0] name:'click'     index:3
  [4] child  path:[0] childPos:0       index:4  (badge)
  [5] text   path:[0,1] (inside span)  index:5  (title)
  [6] child  path:[0] childPos:2       index:6  (dueDateHtml)
  [7] child  path:[0] childPos:3       index:7  (childCountHtml)
  [8] child  path:[0] childPos:4       index:8  (enterIconHtml)
  [9] child  path:[0] childPos:5       index:9  (statusHtml)

Clean HTML:
  <div class="task-item type-"><span class="task-title"></span></div>
```

Instantiation: clone template, navigate to `childNodes[0]` once, apply
all 10 bindings directly. No tree walk, no comment search, no regex.

For a 100-item task list via `each()`, this eliminates ~1200 unnecessary
node checks (12 nodes × 100 items) and ~1000 failed regex matches.

### Text Position Handling

Text expressions don't use splitting or offset calculations. The blueprint
records the static parts from the template strings, and during instantiation
we **reconstruct** the text content with bindings interleaved.

**Pure dynamic text** (`<span>${title}</span>`):
Clean HTML: `<span></span>`. During instantiation, append a bound text
node as the span's child. Trivial.

**Mixed static + dynamic** (`<span>Hello ${name}, welcome!</span>`):
Clean HTML: `<span>Hello , welcome!</span>`. During instantiation, clear
the span's content and reconstruct: `span.append('Hello ', boundNode, ', welcome!')`.
The static parts `"Hello "` and `", welcome!"` come directly from the
template strings array — no parsing, no offset calculation.

**Multiple expressions in text** (`<span>${first} ${last}</span>`):
Clean HTML: `<span> </span>`. During instantiation, clear and reconstruct:
`span.append(boundNode1, ' ', boundNode2)`. The static part `" "` is
`strings[1]` (the text between the two expressions).

**Why this is robust**: The static parts are the template strings themselves
— the exact values the developer wrote. We never depend on what the browser
did with the clean HTML text content. We discard it and rebuild from our
source of truth.

### Mixed Attribute Handling

Multiple expressions in one attribute value:

```typescript
html`<div data-info="${a}-${b}"></div>`
```

Static strings: `['<div data-info="', '-', '"></div>']`
Clean HTML: `<div data-info="-"></div>`

Blueprint entry:
```
{ kind: 'attr', path: [0], name: 'data-info',
  parts: [{ type: 'expr', index: 0 }, { type: 'static', value: '-' },
          { type: 'expr', index: 1 }] }
```

During binding, if any part is a signal, create a `computed` that
concatenates all parts (same logic as current lines 289-298 of template.ts).
If all parts are static, set the attribute once.

---

## Proposal B: Pure DOM Construction (No innerHTML)

Takes the compiled approach further — the state machine produces a **DOM
construction program** instead of clean HTML, eliminating innerHTML entirely.

```typescript
type DomOp =
  | { op: 'el', tag: string }
  | { op: 'text', value: string }
  | { op: 'attr', name: string, value: string }
  | { op: 'push' }   // enter children
  | { op: 'pop' }    // exit to parent
  | { op: 'bind', slot: BindingSlot }
```

Execution is a simple loop calling `createElement`, `createTextNode`,
`setAttribute`, `appendChild` — all direct DOM API calls.

**Pros over Proposal A**:
- Zero innerHTML (fully CSP-safe, no parser invocation)
- Single pass: build DOM + create bindings simultaneously
- No template element caching needed (the program IS the cache)
- Purest architecture — tagged template → DOM, nothing in between

**Cons vs Proposal A**:
- Loses `cloneNode(true)` optimization (C++ cloning is fast for large templates)
- Must handle HTML edge cases ourselves (void elements: `br`, `img`, `input`,
  `hr`; boolean attributes: `hidden`, `disabled`)
- More framework code for the construction loop (~40 extra lines)
- The browser's parser is the source of truth for HTML correctness; our
  state machine is not

**Performance**: For small templates (5-20 elements, which is all of ours),
single-pass construction is competitive with clone + path-bind. For large
templates (50+ elements), cloning wins because C++ `cloneNode` is faster
than JS `createElement` loops.

---

## Proposal C: Status Quo (Comment Markers)

Keep the current architecture. Comments are the industry standard, they
work, and the performance difference is negligible at our scale.

**Pros**: Zero implementation risk. Zero migration effort. Battle-tested.

**Cons**: Carries the structural inefficiencies described in Context.
Does not align with the DOM Parts trajectory. The full-tree-walk cost
scales linearly with template size × instantiation count.

---

## Comparison Matrix

| Criterion | A: Compiled Positional | B: Pure DOM Construction | C: Status Quo |
|-----------|----------------------|------------------------|---------------|
| Comment markers in HTML | None | None | `<!--bk-N-->` per expression |
| Comment nodes in live DOM | None (reference-held text anchors) | None (reference-held text anchors) | Yes (markers + boundaries) |
| innerHTML usage | Once per template (clean) | Never | Once per template (with markers) |
| DOM tree walk | None (blueprint iteration) | None (single-pass build) | Full recursive walk per instantiation |
| Binding discovery | Compile-time (string analysis) | Compile-time (string analysis) | Runtime (find comment nodes) |
| Template caching | Template element + blueprint | Program array only | Template element only |
| Instantiation cost | Clone O(1) + path bind O(bindings) | Build O(nodes) + inline bind | Clone O(1) + walk O(nodes) + bind |
| List item creation (100 items) | 100 × path bind | 100 × single-pass build | 100 × full walk + bind |
| Signal updates | O(1) direct mutation | O(1) direct mutation | O(1) direct mutation |
| HTML correctness | Browser parser (authoritative) | Our state machine (subset) | Browser parser (authoritative) |
| CSP compatibility | innerHTML (same as today) | No innerHTML (fully CSP-safe) | innerHTML (same as today) |
| DOM Parts alignment | High (blueprint ≈ Parts) | High (program ≈ Parts) | Low (comments ≠ Parts) |
| Blueprint testability | Pure data, no DOM needed | Pure data, no DOM needed | Requires DOM to verify markers |
| Text position handling | Reconstruct from strings | Inline during build | Comment marker replacement |
| Dynamic region anchors | Direct references (no search) | Direct references (no search) | Comment search via DOM walk |
| Implementation risk | Medium | Higher (HTML edge cases) | None |
| Framework code change | ~120 lines added, ~100 removed | ~160 lines added, ~100 removed | None |

---

## Scored Rubric (1-5, higher is better)

| Criterion | A: Compiled Positional | B: Pure DOM | C: Status Quo | Justification |
|-----------|----------------------|-------------|---------------|---------------|
| **Performance** | 4 | 4 | 3 | A and B eliminate O(nodes) walk. B trades clone speed for single-pass. C walks every node every time. |
| **Correctness risk** | 4 | 3 | 5 | A uses browser parser (safe). B must handle HTML edge cases. C is proven. |
| **Architectural purity** | 5 | 5 | 3 | A and B separate analysis from instantiation. C interleaves finding and binding. |
| **Future alignment** | 5 | 5 | 2 | A/B blueprint maps to DOM Parts. C's comments are what DOM Parts replaces. |
| **Implementation effort** | 3 | 2 | 5 | A is moderate (~120 lines state machine). B adds HTML subset handling. C is zero. |
| **Testability** | 5 | 5 | 3 | A/B blueprint is pure data, testable without DOM. C requires DOM for marker verification. |
| **Migration risk** | 4 | 3 | 5 | A preserves the `html` API — zero component changes. B same. C is no change. |
| **Weighted total** | **30** | **27** | **26** | A wins on architecture + future + testability. C wins on effort + risk. B is purest but riskiest. |

---

## Recommendation: Proposal A — Compiled Positional Templates

### Rationale

1. **The binding blueprint is a strictly better intermediate representation
   than comment markers.** It's a pure data structure computed once from
   static strings. It can be tested without a DOM. It maps directly to the
   future DOM Parts API. Comment markers are an implementation artifact that
   exists only because the current code doesn't analyze the template strings
   deeply enough.

2. **The state machine already partially exists.** Lines 140-155 of
   template.ts track `inTag` and `quoteChar` to handle unquoted attribute
   positions. The compiled approach extends this existing logic into a
   complete template analyzer. It's not a new concept — it's finishing what
   the current code started.

3. **O(bindings) beats O(nodes) for every template in our codebase.** Our
   components have 5-25 DOM nodes but only 3-10 bindings. The blueprint
   walk is 2-3x fewer iterations than the tree walk. For `each()` with 100
   items, this compounds to thousands of eliminated checks.

4. **The browser's parser remains the source of truth.** Unlike Proposal B,
   we don't implement our own HTML parser. The clean HTML (no markers) is
   parsed by `innerHTML` — the same native parser, just with cleaner input.
   HTML correctness is not our responsibility.

5. **Zero component API changes.** The `html` tagged template function
   signature is unchanged. Every existing component works without
   modification. The change is entirely internal to `template.ts`.

6. **DOM Parts migration path.** The W3C is designing DOM Parts as native
   positional references. Our blueprint structure is isomorphic to what
   DOM Parts provides. When DOM Parts ships, migration is mechanical:
   replace `navigatePath()` with native `Part` references. The comment-based
   approach would require a larger rewrite.

### What Changes in template.ts

**Removed** (~100 lines):
- `MARKER_PREFIX`, `MARKER_SUFFIX`, `createMarker()` (lines 45-56)
- HTML string construction with markers in `html.mount()` (lines 133-155)
- `processNode()` recursive DOM walker (lines 183-213)
- Comment marker regex matching in `processAttributes()` (5 regex patterns,
  lines 235-295)
- Comment node detection in `processNode()` (lines 192-203)
- All `document.createComment()` calls (8 occurrences)

**Added** (~130 lines):
- `compileTemplate(strings)` — state machine producing blueprint + clean HTML
- `BindingSlot` interface and `StaticPart` type
- `navigatePath(root, path)` — trivial path traversal (~10 lines)
- Text content reconstruction for mixed static+dynamic text (~15 lines)

**Modified** (~50 lines):
- `html.mount()` — use cached blueprint instead of building marker HTML
- `replaceMarkerWithBinding()` → `createChildBinding()` — same logic,
  different entry point (receives node from path, not from marker search)
- Dynamic region anchors: hold direct references to empty text nodes
  created during instantiation (no searching, no comments)

**Net**: ~905 lines → ~885 lines. Slight reduction, significant
architectural improvement.

### Backward Compatibility

- **Component API**: Unchanged. `html`, `when`, `each` signatures identical.
- **Binding behavior**: All binding types preserved (text, attribute, class,
  event, ref, innerHtml, child).
- **Test suite**: All 124 existing framework tests must pass. The tests
  verify behavior (DOM output, reactivity, disposal), not implementation
  (comment markers). No test changes expected.
- **Dynamic regions**: `when()`, `each()`, signal-in-template all work
  identically — only the anchor node type changes (empty text vs comment).

### Testing Strategy

The compiled approach enables a new category of tests that don't need DOM:

**Blueprint tests** (pure, no happy-dom):
```typescript
describe('compileTemplate', () => {
  it('detects text expression', () => {
    const strings = Object.assign(['<span>', '</span>'], { raw: ['<span>', '</span>'] });
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].kind).toBe('child');
    expect(blueprint[0].path).toEqual([0]);
  });

  it('detects attribute expression', () => {
    const strings = Object.assign(['<div id="', '"></div>'], { raw: ['<div id="', '"></div>'] });
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].kind).toBe('attr');
    expect(blueprint[0].name).toBe('id');
  });

  it('detects @event expression', () => {
    const strings = Object.assign(['<button @click="', '">X</button>'],
      { raw: ['<button @click="', '">X</button>'] });
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].kind).toBe('event');
    expect(blueprint[0].name).toBe('click');
  });

  it('computes correct DOM paths for nested elements', () => {
    const strings = Object.assign(
      ['<div><span>', '</span><span>', '</span></div>'],
      { raw: ['<div><span>', '</span><span>', '</span></div>'] }
    );
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].path).toEqual([0, 0]); // first span's child
    expect(blueprint[1].path).toEqual([0, 1]); // second span's child
  });

  it('handles class: directive', () => {
    const strings = Object.assign(
      ['<div class:active="', '"></div>'],
      { raw: ['<div class:active="', '"></div>'] }
    );
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].kind).toBe('class');
    expect(blueprint[0].name).toBe('active');
  });

  it('handles mixed static+dynamic attribute', () => {
    const strings = Object.assign(
      ['<div class="prefix-', ' suffix"></div>'],
      { raw: ['<div class="prefix-', ' suffix"></div>'] }
    );
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].kind).toBe('attr');
    expect(blueprint[0].parts).toEqual([
      { type: 'static', value: 'prefix-' },
      { type: 'expr', index: 0 },
      { type: 'static', value: ' suffix' },
    ]);
  });

  it('handles event modifiers', () => {
    const strings = Object.assign(
      ['<button @click.stop.prevent="', '">X</button>'],
      { raw: ['<button @click.stop.prevent="', '">X</button>'] }
    );
    const { blueprint } = compileTemplate(strings as any);
    expect(blueprint[0].modifiers).toEqual(['stop', 'prevent']);
  });
});
```

These tests are FAST (no DOM), PRECISE (test the analysis directly), and
COMPREHENSIVE (every expression context is independently verifiable).

The existing DOM-based tests (`template.test.ts`, `each.test.ts`) continue
to verify end-to-end behavior unchanged.

---

## Implementation Plan

| Step | What | Lines | Risk |
|------|------|-------|------|
| 1 | Write `compileTemplate()` state machine + blueprint types | ~120 | Medium — state machine edge cases |
| 2 | Write blueprint unit tests (pure, no DOM) | ~80 | Low |
| 3 | Write `navigatePath()` + text reconstruction helpers | ~25 | Low |
| 4 | Modify `html.mount()` to use blueprint instead of markers | ~40 | Medium — must preserve all binding behavior |
| 5 | Replace comment-based dynamic regions with reference-held text anchors | ~20 | Low — same logic, different anchor type |
| 6 | Remove marker system (`createMarker`, `processNode`, marker regex, all `createComment`) | -100 | Low — deletion |
| 7 | Run full test suite, fix any regressions | — | Medium |
| 8 | Manual testing with `pnpm dev` across all components | — | Low |

**Total effort**: ~1 session. The state machine is the only non-trivial
piece. Everything else is mechanical refactoring.

---

## Assumptions

1. **Template strings are well-formed HTML.** The state machine handles the
   HTML subset used in our templates (quoted attributes, standard/custom
   elements, void elements). It does not handle malformed HTML, unquoted
   attributes with `>` characters, or `<script>`/`<style>` content models.
   This is acceptable — our templates are generated by developers/AI using
   consistent patterns.

2. **Text content is reconstructed, not split.** For text positions with
   mixed static + dynamic content, we discard the browser's merged text
   node and rebuild from the template strings (our source of truth). This
   means we never depend on the browser's text normalization behavior.
   The static parts come directly from the `strings` array — the exact
   values the developer wrote.

3. **Empty text node anchors are stable.** We control the DOM within our
   components — no external code calls `normalize()` on our elements. The
   anchors are held by direct reference in binding closures, never searched
   for. If a third-party library (e.g., md-block) normalizes our DOM,
   anchors could be removed. Mitigation: md-block operates in its own
   subtree, not within framework-managed DOM.

4. **The `strings` reference identity guarantee holds.** The JS spec
   guarantees that tagged template `strings` arrays are the same reference
   per call site. If a transpiler or bundler breaks this guarantee (none
   currently do), the WeakMap cache would miss and recompile on every call.
   This is a correctness issue, not a crash — just slower.

---

## Consequences

### Positive
- Zero comment markers in HTML strings or live DOM
- Zero comment nodes as runtime boundary markers — direct references instead
- O(bindings) instantiation instead of O(nodes) tree walk
- Blueprint is a pure, testable data structure
- Cleaner DOM tree (no comment noise in DevTools)
- Text content reconstructed from template strings (source of truth), not
  dependent on browser text normalization
- Dynamic region anchors held by reference, never searched for
- Aligns with W3C DOM Parts trajectory
- State machine formalizes the partial analysis already in `html()`
- Enables future Proposal B upgrade (pure DOM construction) without API change

### Negative
- State machine is ~120 lines of new framework code to maintain
- Empty text node anchors are less visible in DevTools than comments
  (mitigated by dev-mode zero-width space)
- The state machine must be kept in sync with supported template patterns
  (new directive types require state machine updates)

### Risks
- State machine bugs could produce incorrect blueprints, causing bindings
  to target wrong DOM nodes. Mitigated by comprehensive blueprint unit tests
  and the existing end-to-end test suite.
- Performance regression if `navigatePath()` is slower than expected for
  deeply nested templates. Mitigated by our templates being shallow (max
  depth 4-5 levels).

---

## Future: Upgrade Path to Proposal B

If profiling reveals template instantiation as a bottleneck (unlikely at
our scale, but possible with very large lists), Proposal B can be
implemented as a drop-in replacement:

1. Extend `compileTemplate()` to produce a `DomOp[]` program instead of
   (or in addition to) clean HTML
2. Add a `executeDomProgram(program, values)` function (~40 lines)
3. Skip innerHTML and cloneNode entirely
4. Same blueprint, same binding logic, same component API

This is a performance optimization, not an architectural change. The
blueprint structure supports both approaches.

## Future: DOM Parts Migration

When the DOM Parts API ships in browsers:

1. Replace empty text node anchors with native `ChildNodePart`
2. Replace `navigatePath()` with native `Part` position references
3. The blueprint structure maps 1:1 to DOM Parts — each `BindingSlot`
   becomes a `Part` instance

The compiled positional approach is the natural stepping stone to DOM Parts.
The comment-based approach would require a larger rewrite because comments
and Parts have fundamentally different semantics.
