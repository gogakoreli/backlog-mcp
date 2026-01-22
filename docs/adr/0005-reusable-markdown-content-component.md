# 0005. Reusable Markdown Content Component

**Date**: 2026-01-22
**Status**: Accepted
**Backlog Item**: Refactoring (no task ID)

## Context

Currently, markdown rendering is duplicated between `task-detail` and `resource-viewer` components. Both create an `article.markdown-body` wrapper and append an `md-block` element, but the logic is copy-pasted.

### Current State

**task-detail.ts** renders task markdown:
```typescript
const article = document.createElement('article');
article.className = 'markdown-body';
const mdBlock = document.createElement('md-block');
mdBlock.textContent = task.description || '';
article.appendChild(mdBlock);
```

**resource-viewer.ts** renders resource markdown:
```typescript
const article = document.createElement('article');
article.className = 'markdown-body';
const mdBlock = document.createElement('md-block');
mdBlock.textContent = data.content;
article.appendChild(mdBlock);
```

### Problem

1. **Code duplication** - Same rendering logic in two places
2. **Inconsistency risk** - Changes to one component don't automatically apply to the other
3. **Maintainability** - If we need to modify markdown rendering (custom syntax, link handling, styling), we must update multiple files
4. **Conceptual mismatch** - Tasks are markdown files with frontmatter; resources can be markdown files. Both should use the same rendering approach.

### User Insight

"Tasks are technically just frontmatter markdown files. We should have a consistent reusable component. Why does it matter if we are viewing a task or a resource? They are in theory both markdown files."

## Proposed Solutions

### Option 1: Unified File Viewer Component

**Description**: Create a single `file-viewer` component that replaces both `task-detail` and `resource-viewer`. The component detects file type (task with frontmatter vs plain markdown vs code) and renders accordingly.

**Pros**:
- True unification - one component for all file viewing
- Consistent rendering everywhere
- Conceptually clean - "view any file"

**Cons**:
- **MASSIVE refactoring** - task-detail is deeply integrated with task list, URL state, event system
- **Breaking changes** - would require updating main.ts, all event handlers, URL state management
- **High complexity** - component handles tasks, markdown, code, all file types
- **High risk** - could break existing functionality during migration

**Implementation Complexity**: HIGH (200+ lines of changes)

**UX Impact**: Neutral - no visible change to users

**Verdict**: ❌ **Rejected** - Refactoring cost too high for the benefit. Risk of breaking existing functionality.

---

### Option 2: Shared Markdown Content Component

**Description**: Extract markdown rendering logic into a reusable `markdown-content` component. Keep `task-detail` and `resource-viewer` as containers that handle their specific concerns (metadata, headers, loading states), but delegate markdown rendering to the shared component.

**Pros**:
- **Reusable** - DRY principle, single source of truth for markdown rendering
- **Minimal refactoring** - Existing components keep their structure, just use the new component internally
- **Clean separation** - Markdown rendering is isolated and testable
- **No breaking changes** - Components still work the same externally
- **Easy to extend** - Future markdown enhancements (custom syntax, plugins) happen in one place
- **Consistent styling** - article.markdown-body wrapper applied uniformly

**Cons**:
- Adds another component to the codebase (but it's justified)
- Slightly more indirection (component wraps md-block)

**Implementation Complexity**: LOW (~80 lines total: 50 new component + 30 updates)

**UX Impact**: Positive - guaranteed consistent markdown rendering

**Verdict**: ✅ **SELECTED** - Best balance of reusability, maintainability, and low risk.

---

### Option 3: Utility Function Approach

**Description**: Create a `renderMarkdown(content)` utility function that returns DOM elements. Both components call this function instead of duplicating the logic.

**Pros**:
- **Simplest** - Just extract common code into a function
- **No new components** - Minimal architectural change
- **Easy to implement** - ~20 lines of code

**Cons**:
- **Less encapsulated** - Components still have rendering logic, just call a helper
- **Not component-oriented** - Doesn't follow web component patterns
- **Harder to extend** - Adding features (event handling, state) requires updating the function signature
- **No lifecycle management** - Can't use connectedCallback, disconnectedCallback, etc.

**Implementation Complexity**: VERY LOW (~30 lines total)

**UX Impact**: Neutral

**Verdict**: ⚠️ **Acceptable but not ideal** - Solves duplication but doesn't provide proper encapsulation. Utility functions are fine for simple helpers, but markdown rendering has enough complexity (event handling, DOM manipulation) to warrant a component.

## Decision

**Selected**: Option 2 - Shared Markdown Content Component

**Rationale**:
1. **User's explicit request**: "Create a reusable component out of it and literally use the same component for the resource viewer"
2. **Proper componentization**: Markdown rendering is complex enough (DOM creation, event handling, styling) to warrant a dedicated component
3. **Low risk**: Minimal changes to existing components, no breaking changes
4. **High maintainability**: Future markdown enhancements happen in one place
5. **Consistent UX**: Guaranteed identical rendering across all markdown views

**Trade-offs Accepted**:
- Adds one more component to the codebase (acceptable - it's well-justified)
- Slight indirection (component wraps md-block) - acceptable for the benefits

## Consequences

**Positive**:
- ✅ DRY principle - markdown rendering logic in one place
- ✅ Consistent rendering - tasks and resources use identical markdown display
- ✅ Maintainable - changes to markdown rendering happen in one component
- ✅ Testable - can unit test markdown-content component in isolation
- ✅ Extensible - easy to add features like custom syntax, link handling, etc.

**Negative**:
- One more component to maintain (minimal cost)
- Slight increase in component nesting depth

**Risks**:
- None significant - isolated change with no breaking changes

## Implementation Notes

### New Component: `markdown-content.ts`

```typescript
export class MarkdownContent extends HTMLElement {
  private _content: string = '';

  set content(value: string) {
    this._content = value;
    this.render();
  }

  get content(): string {
    return this._content;
  }

  private render() {
    const article = document.createElement('article');
    article.className = 'markdown-body';
    
    const mdBlock = document.createElement('md-block');
    mdBlock.textContent = this._content;
    article.appendChild(mdBlock);
    
    this.innerHTML = '';
    this.appendChild(article);
    
    // Intercept file:// links
    this.querySelectorAll('a[href^="file://"]').forEach(link => {
      const path = link.getAttribute('href')!.replace('file://', '');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('resource-open', { 
          detail: { path },
          bubbles: true 
        }));
      });
    });
  }
}

customElements.define('markdown-content', MarkdownContent);
```

### Update `task-detail.ts`

Replace:
```typescript
const article = document.createElement('article');
article.className = 'markdown-body';
article.innerHTML = metaHtml;
const mdBlock = document.createElement('md-block');
mdBlock.textContent = task.description || '';
article.appendChild(mdBlock);
this.innerHTML = '';
this.appendChild(article);
```

With:
```typescript
const metaDiv = document.createElement('div');
metaDiv.innerHTML = metaHtml;
const markdownContent = document.createElement('markdown-content') as any;
markdownContent.content = task.description || '';
this.innerHTML = '';
this.appendChild(metaDiv);
this.appendChild(markdownContent);
```

### Update `resource-viewer.ts`

Replace:
```typescript
if (data.ext === 'md') {
  const article = document.createElement('article');
  article.className = 'markdown-body';
  const mdBlock = document.createElement('md-block');
  mdBlock.textContent = data.content;
  article.appendChild(mdBlock);
  contentDiv.innerHTML = '';
  contentDiv.appendChild(article);
}
```

With:
```typescript
if (data.ext === 'md') {
  const markdownContent = document.createElement('markdown-content') as any;
  markdownContent.content = data.content;
  contentDiv.innerHTML = '';
  contentDiv.appendChild(markdownContent);
}
```

### Import in `main.ts`

Add:
```typescript
import './components/markdown-content.js';
```

### Testing

1. Verify task-detail still renders tasks correctly with metadata
2. Verify resource-viewer renders .md files correctly
3. Verify file:// links work in both contexts
4. Verify styling is consistent (article.markdown-body applied)
5. Check that no regressions in existing functionality

### Estimated Effort

- New component: ~50 lines
- Update task-detail: ~15 lines
- Update resource-viewer: ~10 lines
- Import in main: ~1 line
- **Total**: ~80 lines of changes

**Time**: 30 minutes

## Success Metrics

- [ ] markdown-content component created and registered
- [ ] task-detail uses markdown-content for description rendering
- [ ] resource-viewer uses markdown-content for .md files
- [ ] No visual regressions in task or resource viewing
- [ ] file:// links work in both contexts
- [ ] Code duplication eliminated
