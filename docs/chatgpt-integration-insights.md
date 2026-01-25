# ChatGPT Apps SDK Integration - Key Insights

**Date**: 2026-01-25  
**Context**: Research for integrating backlog-mcp with OpenAI Apps SDK

## Executive Summary

OpenAI Apps SDK enables building interactive applications that run **inside ChatGPT** as native experiences. Your existing MCP server is 95% compatible - just add `structuredContent` and UI resource registration. Can test TODAY in personal ChatGPT with developer mode (no approval needed).

## Critical Insights

### 1. Your Existing Code is Already Compatible ✅

**What you have:**
- ✅ MCP server with tools
- ✅ Web viewer (HTML/CSS/JS)
- ✅ Clean Fastify architecture

**What you need to add:**
- `structuredContent` in tool responses (1 line per tool)
- UI resource registration (10 lines)
- `window.openai` API calls in viewer HTML (5 lines)

**Migration effort:** ~30 minutes, not weeks.

### 2. No Approval Needed for Personal Use

**Developer Mode:**
- Enable in ChatGPT settings
- Add your MCP server URL
- Test immediately
- No review, no waiting

**Approval only needed for:**
- Public distribution in app store
- Not needed for personal/team use

### 3. MCP HTTP Server Bridge Solutions

| Solution | Use Case | Auth | Complexity |
|----------|----------|------|------------|
| **AIM CLI (`aim mcp create remote-mcp-proxy`)** | Amazon internal services | Midway/AWSAuth | Low |
| **mcp-remote (geelen)** | Existing remote servers | OAuth 2.1 | Low |
| **Remote-MCP (ssut)** | Build custom infrastructure | tRPC, type-safe | Medium |

**For Kiro CLI + HTTP servers:** Use `aim mcp create remote-mcp-proxy`

### 4. Tech Stack Decision

**Chosen: Fastify + Official MCP SDK**

**Why NOT FastMCP:**
- ❌ Runs own HTTP server (can't integrate with viewer easily)
- ❌ Requires two servers + reverse proxy
- ❌ Overkill for personal use

**Why YES Fastify + Official SDK:**
- ✅ One server for both MCP and viewer
- ✅ Full control over routing
- ✅ Stateless mode built-in
- ✅ Simple deployment

### 5. Sessions Are Required (Even for 1 User)

**Why:** MCP protocol uses dual connections:
- POST requests (send commands)
- GET SSE stream (receive responses)

**Session ID links them together** - not for "multiple users", but for protocol design.

**For personal use:** In-memory sessions are fine (no Redis needed).

### 6. Authentication Strategy

**Phase 1 (Personal Use):**
```typescript
// Simple API key
if (apiKey !== `Bearer ${process.env.API_KEY}`) {
  reply.code(401).send({ error: 'Unauthorized' });
}
```

**Phase 2 (Production):**
- OAuth 2.1 with MCP authorization spec
- Use Auth0/Stytch (managed providers)
- Dynamic Client Registration (DCR)
- PKCE support

### 7. State Management Pattern

**Three types of state:**

| State Type | Visibility | Persistence | Use For |
|------------|------------|-------------|---------|
| `structuredContent` | ChatGPT + UI | Per-message | Data ChatGPT reasons about |
| `widgetState` | UI only | Per-widget | UI state (filters, selections) |
| `_meta` | UI only | Per-message | Internal data, secrets |

**Critical:** `structuredContent` is visible to ChatGPT - never put secrets there.

### 8. Stateless Mode is Critical

```typescript
// For cloud deployment
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless
  enableJsonResponse: true
});
```

**Why:** Serverless platforms (Vercel, Railway) don't persist memory between requests.

### 9. `window.openai` API Capabilities

**Most useful for backlog app:**

```javascript
// Read tool output
const tasks = window.openai.toolOutput.tasks;

// Call MCP tools from UI
await window.openai.callTool('backlog_update', { id, status: 'done' });

// Persist UI state
window.openai.setWidgetState({ selectedFilter: 'active' });

// Send follow-up
await window.openai.sendFollowUpMessage({ 
  prompt: 'What should I work on next?' 
});

// Request fullscreen
await window.openai.requestDisplayMode({ mode: 'fullscreen' });

// Theme support
const isDark = window.openai.theme === 'dark';
```

### 10. Minimal Tool Changes Required

**Before (current):**
```typescript
return { 
  content: [{ type: 'text', text: JSON.stringify(result) }] 
};
```

**After (ChatGPT compatible):**
```typescript
return {
  content: [{ type: 'text', text: `Found ${tasks.length} tasks` }],
  structuredContent: result, // ChatGPT sees this
  _meta: {
    'openai/outputTemplate': 'ui://widget/backlog.html',
    'openai/toolInvocation/invoking': 'Loading tasks...',
    'openai/toolInvocation/invoked': 'Tasks loaded'
  }
};
```

## Top 10 Anti-Patterns to Avoid

1. **Secrets in `structuredContent`** - Use `_meta` instead
2. **Not calling `setWidgetState`** - State lost on re-render
3. **No server-side validation** - Always validate, never trust model input
4. **Bloated structured content** - Keep under 4k tokens, paginate
5. **Wrong MIME type** - Must be `text/html+skybridge` not `text/html`
6. **No `window.openai` fallback** - Check `if (window.openai)` for standalone mode
7. **Missing CORS headers** - ChatGPT can't connect without proper CORS
8. **Session state in stateless mode** - Use database, not in-memory Map
9. **Not using stateless mode** - Required for serverless deployment
10. **Prompt injection in descriptions** - Enforce security in code, not instructions

## Implementation Checklist (TODAY)

### Part 1: Update MCP Server (15 min)

- [ ] Create `src/resources/ui-widget.ts`
- [ ] Register UI resource with `mimeType: 'text/html+skybridge'`
- [ ] Update all tools to return `structuredContent`
- [ ] Add `_meta['openai/outputTemplate']` to tools
- [ ] Import and register UI widget in `mcp-handler.ts`

### Part 2: Update Viewer HTML (15 min)

- [ ] Add `window.openai` detection
- [ ] Read from `window.openai.toolOutput` if available
- [ ] Fallback to fetch API for standalone mode
- [ ] Replace API calls with `window.openai.callTool()`
- [ ] Add `setWidgetState()` for UI state persistence

### Part 3: Deploy and Test (30 min)

- [ ] Deploy to Railway/Fly.io or use ngrok
- [ ] Enable developer mode in ChatGPT
- [ ] Add connector with HTTPS URL
- [ ] Test: "Show my tasks"
- [ ] Test: Click buttons in UI
- [ ] Verify state persists

**Total time: ~1 hour**

## Architecture Decisions

### Single Server vs Two Servers

**Chosen: Single Fastify Server**

```
One Server (port 3030)
├─ /mcp          → MCP endpoint (ChatGPT)
├─ /tasks        → Read-only API (standalone viewer)
├─ /             → Viewer UI
└─ /health       → Health check
```

**Why:**
- ✅ Simpler deployment (one process)
- ✅ Shared storage (file-based)
- ✅ Easier debugging
- ✅ Lower complexity

**Rejected: Two Servers (FastMCP + Fastify)**
- ❌ Need reverse proxy
- ❌ More complex deployment
- ❌ Overkill for personal use

### Framework Decision

**Chosen: Fastify + Official MCP SDK**

**Why NOT FastMCP:**
- Runs own HTTP server (can't integrate with viewer)
- Requires two servers
- OAuth proxy not needed for personal use

**Why YES Fastify:**
- 3x faster than Express
- TypeScript-first
- One server for both MCP and viewer
- Full control

### Storage Strategy

**Current: File-based (JSON + markdown)**

**Works for ChatGPT because:**
- ✅ Both MCP and viewer read same files
- ✅ Low concurrency (personal use)
- ✅ Simple backup (copy folder)

**Future: Migrate to SQLite/PostgreSQL**
- When: Multi-user support needed
- Why: Better concurrency, transactions

## Key Technical Details

### MCP Protocol Requirements

**Stateful protocol with dual connections:**
```
Client → Server
  POST /mcp (commands)
  GET /mcp (SSE stream)
```

**Session ID links them** - required by protocol, not optional.

### ChatGPT Integration Flow

```
User: "Show my tasks"
  ↓
ChatGPT calls backlog_list tool
  ↓
Server returns:
  - structuredContent: { tasks: [...] }
  - _meta: { 'openai/outputTemplate': 'ui://widget/backlog.html' }
  ↓
ChatGPT fetches ui://widget/backlog.html
  ↓
Renders HTML in iframe
  ↓
HTML reads window.openai.toolOutput.tasks
  ↓
User clicks "Mark done"
  ↓
HTML calls window.openai.callTool('backlog_update', {...})
  ↓
Server updates task
  ↓
Returns new structuredContent
  ↓
UI auto-updates
```

### Deployment Platforms

**Recommended for file-based storage:**
- Railway (~$5/mo, persistent volumes)
- Fly.io (~$3/mo, persistent volumes)

**For database migration:**
- Vercel (free tier, serverless)
- Render (free tier)

## Resources

### Documentation
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [Apps SDK Examples](https://github.com/openai/openai-apps-sdk-examples)
- [Fastify Docs](https://fastify.dev/)

### Tools
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) - Test MCP servers
- [ngrok](https://ngrok.com/) - Expose localhost to internet
- [Railway](https://railway.app/) - Deploy with persistent storage

### Community
- [#mcp-gateway](https://amazon.enterprise.slack.com/archives/C08LCN218PM) - Amazon MCP support
- [MCP Discord](https://discord.gg/mcp) - Community support

## Next Actions

**TODAY:**
1. Add `structuredContent` to tools (15 min)
2. Register UI resource (10 min)
3. Update viewer HTML (15 min)
4. Deploy with ngrok (5 min)
5. Test in ChatGPT (5 min)

**TOMORROW:**
- Iterate on UI/UX based on testing
- Add more tool metadata for better discovery
- Optimize structured content size

**NEXT WEEK:**
- Deploy to Railway/Fly.io (production)
- Add OAuth if sharing with others
- Consider public distribution

## Conclusion

**You're 30 minutes away from a working ChatGPT integration.** Your existing clean Fastify architecture is perfect - just add the Apps SDK glue code and deploy.

**The killer feature:** Natural language + interactive UI in one experience. Users can say "Show my tasks" and get a fully interactive task list inline in ChatGPT, then click buttons to update tasks without leaving the conversation.

**This is a game-changer for productivity tools.** 🚀
