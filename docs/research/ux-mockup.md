# UX Mockup: Adaptive Split Pane Resource Viewer

## State 1: Default (No Resource Open)

```
┌─────────────────────────────────────────────────────────────────┐
│ Backlog Viewer                                    [Filter: All] │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                              │
│  TASK LIST       │  TASK DETAIL                                 │
│                  │                                              │
│  □ TASK-0001     │  ┌────────────────────────────────────────┐ │
│  □ TASK-0002     │  │ TASK-0058                              │ │
│  ■ TASK-0058     │  │ Status: done                           │ │
│  □ EPIC-0001     │  └────────────────────────────────────────┘ │
│                  │                                              │
│                  │  Fix type system: Add strict type safety... │
│                  │                                              │
│                  │  ## Problem                                  │
│                  │  TypeScript type errors reveal...            │
│                  │                                              │
│                  │  ## References                               │
│                  │  • 📄 TASK-0058 Final Log                   │
│                  │  • 📄 ADR 0004 - Strict Type System         │
│                  │  • 💻 core/agent.ts                         │
│                  │                                              │
│                  │  ## Evidence                                 │
│                  │  ✅ Type System Fixed                        │
│                  │                                              │
└──────────────────┴──────────────────────────────────────────────┘
```

**User Action**: Clicks "ADR 0004 - Strict Type System" link

---

## State 2: Split Pane Active (Resource Open)

```
┌─────────────────────────────────────────────────────────────────┐
│ Backlog Viewer                                    [Filter: All] │
├──────────────────┬─────────────────────┬────────────────────────┤
│                  │                     ║                        │
│  TASK LIST       │  TASK DETAIL        ║  RESOURCE VIEWER       │
│                  │                     ║                        │
│  □ TASK-0001     │  ┌────────────────┐ ║  ┌──────────────────┐ │
│  □ TASK-0002     │  │ TASK-0058      │ ║  │ 0004-strict-...  │ │
│  ■ TASK-0058     │  │ Status: done   │ ║  │           [✕]    │ │
│  □ EPIC-0001     │  └────────────────┘ ║  └──────────────────┘ │
│                  │                     ║                        │
│                  │  Fix type system... ║  # 0004. Strict Type   │
│                  │                     ║  System                │
│                  │  ## Problem         ║                        │
│                  │  TypeScript type... ║  **Date**: 2026-01-22  │
│                  │                     ║  **Status**: Accepted  │
│                  │  ## References      ║                        │
│                  │  • 📄 Final Log     ║  ## Context            │
│                  │  • 📄 ADR 0004 ←    ║                        │
│                  │  • 💻 core/agent.ts ║  The type system is... │
│                  │                     ║                        │
│                  │  ## Evidence        ║  ## Proposed Solutions │
│                  │  ✅ Type System...  ║                        │
│                  │                     ║  ### Option 1: Flatten │
│                  │                     ║  capabilities...       │
│                  │                     ║                        │
└──────────────────┴─────────────────────┴────────────────────────┘
                                        ↕
                                   Resize Handle
```

**Key Features**:
- ║ = Draggable resize divider
- [✕] = Close button (returns to State 1)
- Arrow (←) shows which reference is currently open
- Both panes scroll independently
- User can resize to allocate more space to either side

---

## State 3: Resized Split (More Space for Code)

```
┌─────────────────────────────────────────────────────────────────┐
│ Backlog Viewer                                    [Filter: All] │
├──────────────────┬──────────┬──────────────────────────────────┤
│                  │          ║                                  │
│  TASK LIST       │  TASK    ║  RESOURCE VIEWER                 │
│                  │  DETAIL  ║                                  │
│  □ TASK-0001     │          ║  ┌────────────────────────────┐ │
│  □ TASK-0002     │  TASK-   ║  │ core/agent.ts         [✕]  │ │
│  ■ TASK-0058     │  0058    ║  └────────────────────────────┘ │
│  □ EPIC-0001     │          ║                                  │
│                  │  Fix...  ║  1  import { AgentConfig } from  │
│                  │          ║  2  './types.js';                │
│                  │  ## Prob ║  3                               │
│                  │  TypeS.. ║  4  export function Agent<       │
│                  │          ║  5    C extends Record<string,   │
│                  │  ## Refs ║  6      any>                     │
│                  │  • Final ║  7  >(config: AgentConfig<C>) {  │
│                  │  • ADR   ║  8    return {                   │
│                  │  • agent ║  9      ...config,               │
│                  │          ║  10     capabilities: config     │
│                  │          ║  11       .capabilities,         │
│                  │          ║  12   };                         │
│                  │          ║  13 }                            │
│                  │          ║                                  │
│                  │          ║  // Syntax highlighting active   │
│                  │          ║  // Line numbers visible         │
└──────────────────┴──────────┴──────────────────────────────────┘
                              ↕
                         Resize Handle
```

**User Action**: Dragged divider left to give more space to code file

---

## Mobile View (<768px): Tabs Fallback

```
┌─────────────────────────────────────┐
│ Backlog Viewer        [☰]           │
├─────────────────────────────────────┤
│                                     │
│  [Task Details] [ADR 0004] [✕]      │
│  ─────────────  ──────────          │
│                                     │
│  # 0004. Strict Type System         │
│                                     │
│  **Date**: 2026-01-22               │
│  **Status**: Accepted               │
│                                     │
│  ## Context                         │
│                                     │
│  The type system is too loose...    │
│                                     │
│  ## Proposed Solutions              │
│                                     │
│  ### Option 1: Flatten              │
│  capabilities to agent level        │
│                                     │
│  ```typescript                      │
│  const agent = Agent({              │
│    capabilities: {                  │
│      foo: capability(...)           │
│    }                                │
│  })                                 │
│  ```                                │
│                                     │
└─────────────────────────────────────┘
```

**Responsive Behavior**:
- Split pane collapses to tabs on narrow screens
- Swipe gestures to switch tabs
- Tab bar scrolls horizontally if many tabs

---

## Interaction Details

### Opening a Resource
1. User clicks file:// link in references/evidence
2. Right pane smoothly animates to split (300ms)
3. Resource viewer appears with loading spinner
4. Content loads and renders with syntax highlighting
5. Scroll position resets to top of resource

### Switching Resources
1. User clicks different file:// link
2. Resource viewer content fades out (150ms)
3. New content loads
4. Content fades in (150ms)
5. Split pane stays open, no re-animation

### Closing Resource
1. User clicks [✕] button or presses Cmd+W
2. Split pane smoothly animates back to single pane (300ms)
3. Task detail expands to fill space
4. URL updates to remove ?resource parameter

### Resizing Split
1. User hovers over divider (cursor changes to ↔)
2. User drags divider left or right
3. Both panes resize in real-time (no lag)
4. Minimum width: 300px per pane
5. URL updates with ?split=60 (percentage)

---

## Visual Design Details

### Colors
- Divider: `#e1e4e8` (light gray)
- Divider hover: `#0969da` (blue)
- Resource viewer background: `#ffffff`
- Code background: `#f6f8fa` (light gray)
- Syntax highlighting: GitHub theme

### Typography
- Task detail: System font, 16px
- Code: Monospace, 14px
- Line numbers: 12px, gray

### Spacing
- Pane padding: 24px
- Divider width: 4px (8px hit area)
- Resource header height: 48px

### Animations
- Split open/close: 300ms ease-in-out
- Content fade: 150ms ease
- Resize: No animation (real-time)

---

## Accessibility

### Keyboard Navigation
- `Tab` - Navigate between panes
- `Cmd+W` - Close resource viewer
- `Cmd+[` - Shrink resource pane
- `Cmd+]` - Expand resource pane
- `Esc` - Close resource viewer

### Screen Reader
- "Resource viewer opened: ADR 0004"
- "Split pane resized to 60%"
- "Resource viewer closed"

### Focus Management
- Opening resource: Focus moves to resource viewer
- Closing resource: Focus returns to clicked link
- Keyboard resize: Announce new percentage

---

## Edge Cases Handled

1. **Very long files** - Truncate at 1MB, show "View full file" link
2. **Binary files** - Show "Cannot preview binary file" message
3. **Missing files** - Show "File not found" error with path
4. **Network errors** - Show retry button
5. **Multiple rapid clicks** - Debounce, only load latest
6. **Narrow screens** - Collapse to tabs at <768px
7. **No JavaScript** - Graceful degradation (external links work)

---

## Future Enhancements (Not in MVP)

1. **Multi-tab resources** - Open multiple resources in tabs within split pane
2. **Resource search** - Cmd+F to search within resource
3. **Resource history** - Recently viewed resources dropdown
4. **Diff view** - Compare two resources side-by-side
5. **Edit mode** - Edit resource inline (integrate write_resource)
6. **Fullscreen resource** - Maximize resource to full window
7. **Pin resource** - Keep resource open when switching tasks
