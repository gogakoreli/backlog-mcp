# 0029. Reusable Copy Button Feedback System

**Date**: 2026-01-26
**Status**: Accepted
**Backlog Item**: TASK-0095

## Context

The viewer has multiple copy buttons throughout the UI (copy task ID, copy epic ID, copy markdown, copy data directory path). Currently, there are **three inconsistent implementations** of copy feedback:

1. **split-pane.ts** (URI copy button): Changes text to "✓", reverts after 2s
2. **system-info-modal.ts** (data directory): Changes text to "Copied!", reverts after 2s
3. **task-detail.ts** (task/epic IDs, markdown): No feedback at all

### Current State

**Problems:**
- Inconsistent UX across the application
- Duplicated feedback logic in multiple files
- Some buttons have no feedback (poor UX)
- Text replacement destroys button structure (icons, badges)

**Example of problematic code:**
```typescript
// split-pane.ts
copyBtn.onclick = () => {
  navigator.clipboard.writeText(uri);
  copyBtn.textContent = '✓';  // Destroys any child elements!
  setTimeout(() => copyBtn.textContent = 'Copy', 2000);
};
```

**Buttons with complex content:**
```html
<button onclick="navigator.clipboard.writeText('TASK-0042')">
  <task-badge task-id="TASK-0042"></task-badge>
  <svg-icon src="copy.svg"></svg-icon>
</button>
```

Changing `textContent` would destroy the `<task-badge>` and `<svg-icon>` elements.

### Research Findings

**Modern app patterns:**
- GitHub: Floating tooltip positioned with JS
- VS Code: Monaco tooltip system
- Figma: Floating tooltip with smooth animation
- Linear: Floating tooltip with perfect positioning

**Key insight:** Successful products use positioned tooltip elements, not CSS pseudo-elements.

## Proposed Solutions

### Option 1: CSS ::after Pseudo-element Tooltip

**Description**: Use `data-copy` attribute and show tooltip via CSS `::after` pseudo-element.

```typescript
// Global event delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) {
    navigator.clipboard.writeText(btn.dataset.copy);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
});
```

```css
[data-copy].copied::after {
  content: 'Copied!';
  position: absolute;
  /* ... styling ... */
}
```

**Pros:**
- Minimal code (~20 lines CSS, ~10 lines JS)
- Preserves button content
- Declarative (just add attribute)
- No DOM manipulation

**Cons:**
- Gets cut off by parent `overflow: hidden`
- Can't adjust for viewport edges (mobile issues)
- Z-index conflicts with other UI elements
- Limited animation capabilities
- Can't escape parent positioning context

**Implementation Complexity**: Low

---

### Option 2: Floating Tooltip Element ⭐ RECOMMENDED

**Description**: Create a single reusable tooltip element positioned with `getBoundingClientRect()`.

```typescript
export function initCopyButtons() {
  const tooltip = document.createElement('div');
  tooltip.id = 'copy-tooltip';
  document.body.appendChild(tooltip);
  
  document.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest('[data-copy]');
    if (!btn) return;
    
    const text = btn.getAttribute('data-copy')!;
    await navigator.clipboard.writeText(text);
    
    const rect = btn.getBoundingClientRect();
    tooltip.textContent = 'Copied!';
    tooltip.style.left = `${rect.left + rect.width/2}px`;
    tooltip.style.top = `${rect.top - 8}px`;
    tooltip.classList.add('show');
    
    setTimeout(() => tooltip.classList.remove('show'), 1500);
  });
}
```

**Pros:**
- Never gets cut off (positioned relative to viewport)
- Smart positioning (can adjust for screen edges)
- Smooth animations (fade + slide)
- Single element reused (minimal DOM overhead)
- Matches modern app patterns
- Works perfectly on mobile
- Room to extend (arrow pointer, custom text, icons)

**Cons:**
- ~15 more lines of code than CSS-only approach
- Requires positioning logic

**Implementation Complexity**: Low-Medium

---

### Option 3: Web Component `<copy-button>`

**Description**: Create a custom element that encapsulates copy behavior.

```html
<copy-button text="TASK-0042">
  <task-badge task-id="TASK-0042"></task-badge>
  <svg-icon src="copy.svg"></svg-icon>
</copy-button>
```

**Pros:**
- Most encapsulated
- Can handle complex feedback

**Cons:**
- Requires rewriting ALL existing copy buttons
- Overkill for simple behavior
- Increases bundle size
- High migration cost

**Implementation Complexity**: High

## Decision

**Selected**: Option 2 - Floating Tooltip Element

**Rationale:**

1. **Visual Quality**: Never gets cut off, always visible, smooth animations
2. **Long-term Resilience**: Simple positioning logic, easy to maintain, room to grow
3. **Modern Pattern**: Matches what successful products do (GitHub, VS Code, Linear)
4. **Mobile-friendly**: Smart positioning adjusts for viewport edges
5. **Minimal Cost**: Only ~15 more lines than CSS-only, but professional-grade UX

**Why not Option 1 (CSS ::after)?**
- Fundamental limitations with overflow and positioning
- Would create visual bugs in certain contexts
- Not how modern apps solve this problem

**Why not Option 3 (Web Component)?**
- Over-engineered for the problem
- High migration cost for minimal benefit

**Trade-offs Accepted:**
- Slightly more code than pure CSS approach
- Need to handle positioning edge cases

## Consequences

**Positive:**
- Consistent "Copied!" feedback across all copy buttons
- Professional visual polish
- Bulletproof positioning (never cut off)
- Easy to extend with features (custom text, icons, colors)
- Accessible (can add aria-live region)
- Maintainable long-term

**Negative:**
- ~30 lines of positioning logic to maintain
- Need to test edge cases (viewport edges, scrolling)

**Risks:**
- **Positioning bugs on mobile**: Mitigate with viewport edge detection
- **Z-index conflicts**: Mitigate with high z-index on tooltip
- **Performance with rapid clicks**: Mitigate by canceling previous timeout

## Implementation Notes

### Files to Create/Modify

1. **Create** `viewer/utils/copy-button.ts`:
   - `initCopyButtons()` function
   - Global event delegation
   - Tooltip positioning logic
   - Accessibility (aria-live region)

2. **Modify** `viewer/main.ts`:
   - Import and call `initCopyButtons()` in DOMContentLoaded

3. **Modify** `viewer/styles.css`:
   - Add `#copy-tooltip` styles
   - Fade + slide animation
   - Dark background, white text, rounded corners

4. **Update existing buttons**:
   - `task-detail.ts`: Add `data-copy` to ID and markdown buttons
   - `split-pane.ts`: Replace custom logic with `data-copy`
   - `system-info-modal.ts`: Replace custom logic with `data-copy`

### Positioning Logic

```typescript
// Smart positioning with viewport edge detection
const rect = btn.getBoundingClientRect();
const tooltipWidth = 80; // approximate

let left = rect.left + rect.width / 2;
let top = rect.top - 8;

// Adjust if too close to right edge
if (left + tooltipWidth / 2 > window.innerWidth) {
  left = window.innerWidth - tooltipWidth / 2 - 8;
}

// Adjust if too close to left edge
if (left - tooltipWidth / 2 < 0) {
  left = tooltipWidth / 2 + 8;
}

tooltip.style.left = `${left}px`;
tooltip.style.top = `${top}px`;
```

### Accessibility

Add hidden aria-live region for screen reader announcements:

```typescript
const liveRegion = document.createElement('div');
liveRegion.setAttribute('role', 'status');
liveRegion.setAttribute('aria-live', 'polite');
liveRegion.className = 'sr-only';
document.body.appendChild(liveRegion);

// On copy:
liveRegion.textContent = 'Copied to clipboard';
setTimeout(() => liveRegion.textContent = '', 1500);
```

### Animation Timing

- **Fade in**: 200ms
- **Display**: 1500ms total
- **Fade out**: 200ms (starts at 1300ms)
- **Total cycle**: 1500ms

### Error Handling

```typescript
try {
  await navigator.clipboard.writeText(text);
  showTooltip('Copied!');
} catch (err) {
  showTooltip('Failed to copy');
  console.error('Copy failed:', err);
}
```

### Testing Checklist

- [ ] Copy buttons in task detail header (ID badges)
- [ ] Copy markdown button
- [ ] Copy URI button in resource viewer
- [ ] Copy data directory in system info modal
- [ ] Tooltip never cut off by overflow
- [ ] Tooltip adjusts for viewport edges
- [ ] Works on mobile (small screens)
- [ ] Screen reader announces "Copied to clipboard"
- [ ] Rapid clicks don't stack tooltips
- [ ] Graceful error handling if clipboard API fails

## Future Enhancements

Potential extensions (not in initial scope):

1. **Custom tooltip text**: `data-copy-label="Copied task ID!"`
2. **Success/error icons**: Show checkmark or X icon
3. **Arrow pointer**: Visual indicator pointing to button
4. **Copy animation**: Brief highlight on button itself
5. **Keyboard support**: Copy on Enter/Space when focused
