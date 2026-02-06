# 0063. Real-Time Viewer Updates via Server-Sent Events

**Date**: 2026-02-06
**Status**: Accepted

## Problem Statement

The web viewer polls for data on fixed intervals — task list every 5 seconds, activity panel every 30 seconds. When an AI agent creates or updates a task through MCP tools, the viewer doesn't reflect the change until the next poll cycle. This creates a disconnected experience: the user issues a command to an agent, then stares at a stale UI wondering if anything happened.

## Problem Space

### Why This Problem Exists

The viewer was built as a read-only dashboard with simple HTTP fetch calls. There was no mechanism to push server-side changes to the browser. Polling was the pragmatic first step — it works, requires no infrastructure, and was sufficient for early development.

### Who Is Affected

- **Users monitoring agent work in real-time**: The primary use case. A user delegates tasks to an AI agent and watches the backlog viewer to see progress.
- **Users with the viewer open alongside an MCP client**: Claude, ChatGPT (via OpenAI Apps SDK), Kiro, or Cursor making changes that should appear instantly.
- **Future cloud-hosted deployments**: Multiple clients and viewers connected to a single hosted backlog server — polling scales poorly here.

### Problem Boundaries

**In scope**:
- Real-time push of change notifications from server to viewer
- Replacing polling with event-driven refresh in viewer components
- Graceful degradation when push transport is unavailable
- Design that works for both localhost and cloud deployment

**Out of scope**:
- Bidirectional communication (viewer remains read-only; mutations via MCP tools only)
- Real-time collaborative editing
- Agent log streaming (covered separately in ADR 0016)
- Changes to MCP tool APIs

### Constraints

- **No new runtime dependencies** on the server side. Fastify handles SSE natively via raw response writing. The browser `EventSource` API is built-in.
- **Auth compatibility**. The server supports optional API key auth (`middleware/auth.ts`). The solution must work with auth enabled, including for cloud deployment.
- **Single-process today, potentially multi-instance tomorrow**. The server is currently one Fastify process. Cloud deployment may require horizontal scaling eventually.

## Context

### Current State

**Server architecture** (single Fastify process):
- `/mcp` — StreamableHTTP MCP endpoint, creates a new `McpServer` per request
- `/tasks`, `/search`, `/operations` — REST API for the viewer
- Static file serving for the viewer SPA
- `operations/middleware.ts` wraps `McpServer.registerTool()` to log every write tool call (`backlog_create`, `backlog_update`, `backlog_delete`, `write_resource`)

**Viewer polling**:
- `task-list.ts`: `setInterval(() => this.loadTasks(), 5000)` — polls every 5 seconds
- `activity-panel.ts`: `POLL_INTERVAL = 30000` — polls every 30 seconds
- `task-detail.ts`: re-fetches on task selection, no background refresh
- No mechanism to detect server-side changes between polls

**Operation logging flow** (the natural hook point):
```
Agent calls MCP tool (e.g., backlog_update)
  → operations/middleware.ts intercepts the call
  → operationLogger.log() writes to disk
  → Response returns to agent
  → [5-30 seconds later] viewer polls and sees the change
```

### Research Findings

**ADR 0016** previously evaluated SSE vs WebSocket for agent log streaming and chose SSE. The same transport analysis applies here, reinforced by the fact that our use case is strictly unidirectional (server → viewer).

**Industry patterns for real-time dashboards**:
- **GitHub**: SSE for notification streaming, REST for mutations
- **Linear**: SSE for live updates, GraphQL for queries/mutations
- **Vercel**: SSE for deployment logs and status updates
- **Figma**: WebSocket (but they need bidirectional for collaborative editing — we don't)

All of these use **thin notifications** — the server pushes "something changed", the client re-fetches what it needs. This avoids sync/ordering problems that come with fat event payloads.

**Cloud deployment context**: The server already supports HTTP-based MCP (`StreamableHTTPServerTransport`) and serves the web UI over HTTP. Cloud hosting is imminent — one planned use case is exposing the backlog to ChatGPT via the OpenAI Apps SDK. In a cloud scenario, multiple MCP clients (Claude, ChatGPT, Kiro) and multiple viewer tabs may be connected simultaneously. The solution must handle N concurrent SSE connections efficiently.

## Proposed Solutions

### Option 1: SSE with In-Process EventEmitter `[SHORT-TERM]` `[LOW]`

**Description**: Add a `GET /events` SSE endpoint to Fastify. Use a Node.js `EventEmitter` singleton as the in-process event bus. The operation logging middleware emits events after each write operation. The SSE endpoint holds open connections and forwards events to all connected viewers. Viewer components subscribe to a shared `EventSource` and do targeted re-fetches instead of polling.

**Architecture**:
```
Agent (MCP tool call)
  → operations/middleware.ts logs operation
  → EventEmitter.emit('change', { type, id, tool })
  → GET /events SSE endpoint pushes to all viewers
  → Viewer EventSource receives event
  → Components re-fetch only what changed
```

**Differs from others by**:
- vs Option 2: No external dependency (ws library), unidirectional only
- vs Option 3: No abstraction layer for the event bus, tied to in-process EventEmitter

**Pros**:
- Zero new dependencies — Fastify raw response for SSE, native browser EventSource
- Simple implementation — ~150 lines server-side, ~80 lines client-side
- EventSource auto-reconnects on disconnect (built into browser API)
- Heartbeat keeps connections alive through proxies and load balancers
- Proven pattern (GitHub, Linear, Vercel all use SSE for dashboards)

**Cons**:
- EventEmitter is in-process — breaks if server goes multi-instance (load balancer, cluster mode)
- Native `EventSource` API doesn't support custom headers — API key auth must use query parameter or cookies
- Unidirectional only — if viewer ever needs to send data upstream, need separate mechanism

**Auth approach**: Pass API key as query parameter (`/events?token=xxx`). Acceptable for localhost. For cloud, would need to migrate to cookie/session-based auth regardless (EventSource limitation is shared by all SSE implementations).

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | ~4 hours, no new dependencies |
| Risk | 4 | Minimal changes to existing code, additive only |
| Testability | 4 | EventBus is a simple emitter, SSE endpoint testable with HTTP client |
| Future flexibility | 2 | In-process EventEmitter doesn't survive multi-instance |
| Operational complexity | 5 | No new systems, no new dependencies |
| Cloud readiness | 2 | Breaks under horizontal scaling |
| **Total** | **22/30** | |

### Option 2: WebSocket with @fastify/websocket `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Add WebSocket support via `@fastify/websocket`. Use a `ws` connection for real-time push. Viewer opens a WebSocket on load, server pushes change events.

**Differs from others by**:
- vs Option 1: Bidirectional, requires library dependency, more complex connection lifecycle
- vs Option 3: No event bus abstraction, direct WebSocket broadcasting

**Pros**:
- Bidirectional — ready if viewer ever becomes read-write
- Custom headers work on upgrade handshake — auth is straightforward
- Binary data support (not needed now, but available)
- Lower overhead per message than SSE (no HTTP framing)

**Cons**:
- New dependency: `@fastify/websocket` + `ws` (~150KB)
- More complex connection lifecycle: upgrade handshake, ping/pong, reconnection logic (browser has no auto-reconnect like EventSource)
- Bidirectional capability is wasted — viewer is read-only by design, mutations go through MCP tools
- Must implement reconnection logic manually on the client side
- WebSocket connections are stateful — harder to load-balance than SSE

**Auth approach**: Custom headers on WebSocket upgrade request — cleaner than SSE query params.

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | ~8 hours, new dependency, reconnection logic |
| Risk | 3 | WebSocket lifecycle is more complex, more failure modes |
| Testability | 3 | WebSocket testing requires connection setup/teardown |
| Future flexibility | 4 | Bidirectional ready, but YAGNI for read-only viewer |
| Operational complexity | 3 | New dependency, connection state management |
| Cloud readiness | 2 | Stateful connections are harder to load-balance |
| **Total** | **18/30** | |

### Option 3: SSE with Pluggable EventBus Interface `[LONG-TERM]` `[LOW]`

**Description**: Same as Option 1 (SSE transport, thin notifications), but abstract the event bus behind an interface. Start with an in-process `EventEmitter` implementation. The interface is designed so it can be swapped to Redis Pub/Sub, NATS, or any external broker when the server goes multi-instance for cloud deployment.

**Architecture**:
```
                    ┌─────────────────────────────┐
                    │       EventBus Interface     │
                    │  emit(event)                 │
                    │  subscribe(callback)         │
                    │  unsubscribe(callback)       │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    LocalEventBus      RedisEventBus      NatsEventBus
   (EventEmitter)     (future: cloud)    (future: cloud)
     [DEFAULT]
```

**Event payload** (thin notification with sequence number):
```typescript
interface BacklogEvent {
  seq: number;         // Monotonic sequence number per server instance
  type: 'task_changed' | 'task_created' | 'task_deleted' | 'resource_changed';
  id: string;          // e.g., "TASK-0042" or resource path
  tool: string;        // e.g., "backlog_update"
  actor: string;       // Who made the change
  ts: string;          // ISO timestamp
}
```

**Sequence number protocol**:
- Server increments `seq` monotonically for each event
- Viewer tracks last received `seq`
- On reconnect, viewer sends `Last-Event-ID` header (SSE built-in)
- Server replays missed events from in-memory ring buffer (last N events)
- If gap is too large, viewer does a full refresh (graceful degradation)

**Differs from others by**:
- vs Option 1: Adds interface abstraction + sequence numbers + ring buffer for replay
- vs Option 2: Keeps SSE transport (simpler), adds cloud-ready event bus interface

**Pros**:
- All benefits of Option 1 (zero deps, auto-reconnect, proven pattern)
- Sequence numbers enable reliable delivery and gap detection
- `Last-Event-ID` is a built-in SSE feature — no custom protocol needed
- Ring buffer provides replay for short disconnections without external storage
- EventBus interface is a clean seam for cloud scaling — swap implementation, not consumers
- Single-file change to go from local EventEmitter to Redis Pub/Sub
- No over-engineering: the interface is 3 methods, the local implementation is ~20 lines

**Cons**:
- Slightly more code than Option 1 (~50 lines for interface + ring buffer)
- Ring buffer is bounded — long disconnections still require full refresh
- Interface abstraction adds one level of indirection (minimal cognitive cost)

**Auth approach**: Same as Option 1 (query parameter for now, cookie/session for cloud). This is a transport-level concern, orthogonal to the EventBus design.

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 4 | ~6 hours, slightly more than Option 1 |
| Risk | 4 | Same low risk as Option 1, additive changes only |
| Testability | 5 | Interface enables mock event bus in tests |
| Future flexibility | 5 | Pluggable bus + sequence numbers = cloud-ready |
| Operational complexity | 5 | No new systems today, clean upgrade path |
| Cloud readiness | 5 | Designed for multi-instance from day one |
| **Total** | **28/30** | |

## Decision

**Selected**: Option 3 — SSE with Pluggable EventBus Interface

**Rationale**:

1. **Scores highest (28/30)** with best balance across all dimensions, especially cloud readiness and future flexibility — the two areas where Option 1 falls short.

2. **The cost of the abstraction is trivial**. The EventBus interface is 3 methods (`emit`, `subscribe`, `unsubscribe`). The local implementation is a thin wrapper around `EventEmitter`. This is ~50 lines more than Option 1, not a meaningful complexity increase.

3. **Sequence numbers are worth it**. Without them, any SSE reconnection requires a full data refresh. With them, short disconnections (network blip, server restart) are handled gracefully via `Last-Event-ID` replay. This is especially important for cloud deployment where connections are less stable than localhost.

4. **Cloud deployment is imminent, not hypothetical**. The server already supports HTTP MCP and HTTP UI. OpenAI Apps SDK integration is planned. Designing the event bus interface now avoids a retrofit later when the cost of change is higher.

5. **SSE over WebSocket** because the viewer is read-only by design. Mutations flow through MCP tools — this is a core architectural principle, not a temporary limitation. WebSocket's bidirectional capability would be wasted complexity. If this ever changes, SSE + REST POST is a proven pattern (GitHub, Linear) that doesn't require WebSocket.

6. **Thin notifications over fat events** because they're simpler to implement, don't create sync/ordering problems, and let the viewer decide what to re-fetch based on its own state. A viewer showing the task list re-fetches the task list; a viewer showing task detail re-fetches that task. No wasted data, no stale cache concerns.

**Why not Option 1?**
- Almost identical, but the in-process EventEmitter with no interface makes cloud migration a breaking refactor instead of an implementation swap. The 50-line abstraction cost is worth the insurance.

**Why not Option 2?**
- Adds complexity (new dependency, manual reconnection, stateful connections) to gain bidirectional capability we explicitly don't need. The viewer-is-read-only principle makes WebSocket's key advantage irrelevant.

**For this decision to be correct, the following must be true**:
- The viewer remains read-only (mutations via MCP tools only)
- SSE connections work through whatever proxy/CDN is used for cloud hosting (they do — SSE is standard HTTP)
- The in-memory ring buffer is sufficient for replay (long disconnections fall back to full refresh)
- The EventBus interface with 3 methods is sufficient for future backends (Redis, NATS, etc.)

**Trade-offs accepted**:
- Native `EventSource` doesn't support custom headers → use query parameter auth for now, migrate to cookies for cloud
- Ring buffer is bounded → long disconnections trigger full refresh (acceptable)
- Slightly more code than the minimal Option 1 → worth it for cloud readiness

## Implementation Notes

### Server-Side Components

#### 1. EventBus Interface and Local Implementation

**New file**: `src/events/event-bus.ts`

```typescript
export interface BacklogEvent {
  seq: number;
  type: 'task_changed' | 'task_created' | 'task_deleted' | 'resource_changed';
  id: string;
  tool: string;
  actor: string;
  ts: string;
}

export interface EventBus {
  emit(event: Omit<BacklogEvent, 'seq'>): void;
  subscribe(callback: (event: BacklogEvent) => void): void;
  unsubscribe(callback: (event: BacklogEvent) => void): void;
}
```

**New file**: `src/events/local-event-bus.ts`

- Wraps Node.js `EventEmitter`
- Maintains monotonic sequence counter
- Ring buffer (last 1000 events) for replay on reconnect
- `replaySince(seq: number): BacklogEvent[]` method for `Last-Event-ID` support

#### 2. SSE Endpoint

**Modified file**: `src/server/viewer-routes.ts`

New route: `GET /events`
- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Subscribes to EventBus on connection
- Writes events as SSE format: `id: {seq}\ndata: {json}\n\n`
- Sends heartbeat comment (`: heartbeat\n\n`) every 30 seconds to keep connection alive
- On `Last-Event-ID` header, replays missed events from ring buffer
- Cleans up subscription on client disconnect
- Respects auth middleware (API key via query parameter when using EventSource)

#### 3. Middleware Integration

**Modified file**: `src/operations/middleware.ts`

After `operationLogger.log()`, emit event on the EventBus:
```typescript
eventBus.emit({
  type: toolToEventType(tool),
  id: extractResourceId(tool, params, result),
  tool,
  actor: actor.name,
  ts: new Date().toISOString(),
});
```

This is a 5-line addition to the existing middleware. The operation logger continues to work exactly as before.

### Client-Side Components

#### 4. EventSource Client Service

**New file**: `viewer/services/event-source-client.ts`

- Creates `EventSource` connection to `/events`
- Dispatches DOM custom events on the document: `backlog:task-changed`, `backlog:task-created`, `backlog:task-deleted`, `backlog:resource-changed`
- Tracks connection state (connected, reconnecting, disconnected)
- Falls back to polling if SSE connection fails 3 times consecutively
- Singleton, initialized once in `main.ts`

#### 5. Component Updates

**Modified file**: `viewer/components/task-list.ts`
- Listen for `backlog:task-changed`, `backlog:task-created`, `backlog:task-deleted` → call `loadTasks()`
- Remove `setInterval(() => this.loadTasks(), 5000)` when SSE is connected
- Keep polling as fallback when SSE is disconnected

**Modified file**: `viewer/components/task-detail.ts`
- Listen for `backlog:task-changed` where `event.detail.id` matches displayed task → re-fetch task
- No change when event is for a different task

**Modified file**: `viewer/components/activity-panel.ts`
- Listen for any `backlog:*` event → refresh operations list
- Remove 30-second polling when SSE is connected
- Keep polling as fallback

**Modified file**: `viewer/components/spotlight-search.ts`
- Listen for `backlog:*` events → refresh recent activity tab if open

### Files Summary

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/events/event-bus.ts` | EventBus interface + BacklogEvent type |
| Create | `src/events/local-event-bus.ts` | In-process implementation with ring buffer |
| Create | `src/events/index.ts` | Public exports, singleton instance |
| Create | `viewer/services/event-source-client.ts` | Browser EventSource wrapper |
| Modify | `src/operations/middleware.ts` | Emit events after logging |
| Modify | `src/server/viewer-routes.ts` | Add `GET /events` SSE endpoint |
| Modify | `viewer/components/task-list.ts` | Subscribe to events, remove polling |
| Modify | `viewer/components/task-detail.ts` | Re-fetch on relevant change events |
| Modify | `viewer/components/activity-panel.ts` | Subscribe to events, remove polling |
| Modify | `viewer/main.ts` | Initialize EventSource client |

### Event Flow (Complete)

```
1. Agent calls backlog_update(id: "TASK-0042", status: "done")
2. MCP handler processes the tool call
3. operations/middleware.ts:
   a. operationLogger.log("backlog_update", params, result)  [existing]
   b. eventBus.emit({ type: "task_changed", id: "TASK-0042", ... })  [new]
4. LocalEventBus:
   a. Assigns seq: 147
   b. Stores in ring buffer
   c. Notifies all subscribers
5. GET /events SSE endpoint:
   a. Receives callback from EventBus
   b. Writes to all connected response streams:
      id: 147
      data: {"seq":147,"type":"task_changed","id":"TASK-0042","tool":"backlog_update","actor":"claude","ts":"..."}
6. Browser EventSource:
   a. Receives message event
   b. Parses JSON payload
   c. Dispatches: document.dispatchEvent(new CustomEvent('backlog:task-changed', { detail: event }))
7. task-list.ts:
   a. Hears 'backlog:task-changed'
   b. Calls this.loadTasks() → re-fetches /tasks
   c. UI updates to show TASK-0042 as "done"
8. task-detail.ts (if showing TASK-0042):
   a. Hears 'backlog:task-changed', checks event.detail.id === "TASK-0042"
   b. Calls this.loadTask("TASK-0042") → re-fetches /tasks/TASK-0042
   c. Detail view updates
9. activity-panel.ts:
   a. Hears 'backlog:task-changed'
   b. Calls this.loadOperations() → re-fetches /operations
   c. New operation appears in timeline
```

### Graceful Degradation

The system operates in three modes:

1. **SSE connected** (normal): Events drive all updates. No polling. Lowest server load.
2. **SSE reconnecting** (transient): Browser `EventSource` auto-reconnects. `Last-Event-ID` replays missed events. Polling resumes during gap.
3. **SSE unavailable** (fallback): After 3 failed connection attempts, falls back to current polling intervals (5s for task list, 30s for activity). Works exactly as today.

This means the feature is purely additive — if anything goes wrong with SSE, the viewer degrades to its current behavior.

### Cloud Scaling Path

When the server moves to multi-instance deployment:

1. Create `src/events/redis-event-bus.ts` implementing the same `EventBus` interface
2. Use Redis Pub/Sub to broadcast events across instances
3. Ring buffer moves to a Redis list (bounded, with TTL)
4. Swap the singleton in `src/events/index.ts` based on environment config
5. Zero changes to the SSE endpoint, middleware, or viewer code

Estimated effort for Redis migration: ~100 lines, 2-3 hours.

## Consequences

**Positive**:
- Viewer updates instantly when agents make changes (sub-100ms vs 5-30 seconds)
- Server load decreases — event-driven refresh instead of continuous polling
- Activity panel shows new operations immediately
- Foundation for cloud deployment with pluggable EventBus
- Sequence numbers enable reliable delivery across reconnections
- Purely additive — graceful degradation to current polling behavior

**Negative**:
- SSE connections consume a file descriptor per connected viewer tab
- Ring buffer consumes memory (1000 events ~= 200KB, negligible)
- `EventSource` auth requires query parameter instead of header (acceptable for localhost, revisit for cloud)

**Risks**:
- Proxy/CDN buffering could delay SSE events → Mitigation: heartbeat every 30s forces flush; `X-Accel-Buffering: no` header for nginx
- Too many viewer tabs could exhaust file descriptors → Mitigation: unlikely for local tool; for cloud, standard connection limits apply
- EventBus interface might need additional methods for cloud backends → Mitigation: interface is minimal (3 methods), easy to extend
