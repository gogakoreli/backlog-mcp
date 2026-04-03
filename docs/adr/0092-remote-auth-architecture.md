---
title: "Remote Auth Architecture — GitHub OAuth + PKCE + Stateless JWT"
date: 2026-04-03
status: Accepted
---

# 0092. Remote Auth Architecture — GitHub OAuth + PKCE + Stateless JWT

## Context

The cloud deployment (`backlog-mcp.gogakoreli.workers.dev`) is a real product endpoint,
not a personal tool. Any MCP client that can reach the URL can attempt to connect.
Three distinct client types need to authenticate:

| Client | Flow |
|--------|------|
| Claude.ai web connector | OAuth 2.0 Authorization Code + PKCE |
| Claude Desktop | Direct Bearer token (API key) |
| ChatGPT | OAuth 2.0 Authorization Code + PKCE + Dynamic Client Registration |

The server runs on Cloudflare Workers — stateless, no persistent memory between requests,
no Redis, no KV (free tier). Any auth mechanism must work without server-side session storage.

---

## Decision

### 1. Two auth paths, unified token format

**GitHub OAuth** (primary): the user authenticates with GitHub; the server checks their
username against a hardcoded allowlist (`gkoreli`, `gogakoreli`). Any unauthorized GitHub
account is rejected at the callback before a token is ever issued.

**API key** (fallback): a shared secret set via the `API_KEY` env var. Accepted as a direct
`Bearer <key>` header. Shown as a form on the auth page alongside the GitHub button.

Both paths issue the same access token format — a signed HS256 JWT — so the MCP middleware
has a single verification path.

### 2. Stateless JWT everywhere — no storage needed

Three token types, all signed with `JWT_SECRET` via Web Crypto API (`crypto.subtle`):

| Token | `type` claim | TTL | Purpose |
|-------|-------------|-----|---------|
| GitHub state | `github_state` | 10 min | CSRF protection + carry OAuth params across GitHub redirect |
| Auth code | `auth_code` | 5 min | Short-lived code exchanged at `/oauth/token` |
| Access token | (standard) | 1 hr | Bearer token accepted by `/mcp/*` middleware |

The state JWT is the key insight: GitHub redirects back with the state param intact, so we
recover the original `redirect_uri`, `code_challenge`, and `client_state` without any
server-side storage. Works perfectly on stateless Workers.

### 3. PKCE (S256) — replaces client_secret for public clients

All OAuth flows use `code_challenge` / `code_verifier` (SHA-256, base64url). The token
endpoint verifies `SHA256(verifier) == challenge` before issuing an access token. This
proves the entity exchanging the code is the same one that started the flow, without
needing a stored client secret.

### 4. Auth landing page — user chooses, not auto-redirect

`GET /authorize` always renders an HTML page with:
- "Sign in with GitHub" button (links to `/oauth/github/start?<oauth-params>`)
- API key form (if `API_KEY` is configured)

The GitHub redirect is at `/oauth/github/start` (separate route). This preserves the
option for API key auth and avoids surprising users with an immediate GitHub redirect.

### 5. arctic v3 — battle-tested GitHub OAuth client

`arctic` (v3.7.0) handles the GitHub authorization URL construction and authorization code
exchange. It uses Web Crypto + fetch internally — works on Cloudflare Workers without
Node.js polyfills. We do not implement the OAuth client exchange ourselves.

### 6. ChatGPT compliance — DCR + protected resource metadata

Two additional endpoints for RFC compliance:

**`GET /.well-known/oauth-protected-resource`** (RFC 9728): required by ChatGPT to discover
which authorization server protects the MCP resource. Returns:
```json
{ "resource": "<origin>", "authorization_servers": ["<origin>"] }
```

**`POST /oauth/register`** (RFC 7591 Dynamic Client Registration): ChatGPT registers a
client before starting OAuth. Returns a random `client_id` UUID. Stateless — the `client_id`
is not stored or validated later. Security comes from PKCE + GitHub username allowlist, not
client identity.

**`registration_endpoint`** added to `/.well-known/oauth-authorization-server` so clients
that read discovery first also find DCR.

Without these, ChatGPT falls back to "User-Defined OAuth Client" mode, requiring the user
to manually supply credentials — an unacceptable UX for a product.

---

## Why not full DCR storage?

Storing client registrations in D1 and validating `client_id` on `/authorize` would add:

- A D1 schema migration
- A write on every registration
- A read on every authorization request
- A cleanup job for stale registrations

Security gain: blocks auth flows from unknown `client_id`s. In practice, the only entity
hitting `/authorize` is a MCP client controlled by you. Even if a rogue party obtained a
`client_id`, they still must pass PKCE verification (they don't have the `code_verifier`)
and the GitHub username check (they're not in the allowlist). Zero marginal security gain.

Full DCR storage is the right call if this becomes multi-tenant (different users, different
access scopes). Until then, stateless DCR is correct.

---

## Why not refresh tokens?

Access tokens expire in 1 hour. Refresh tokens were discussed but not implemented. The
tradeoff: refresh tokens require a revocation story (storage + lookup), otherwise a stolen
refresh token is valid indefinitely. On a stateless Worker with no KV, revocation means D1
writes on every refresh — more complexity than the 1-hour forced re-auth is worth for a
single-owner tool. Revisit if users report frequent session interruptions.

---

## Implementation

| File | Role |
|------|------|
| `src/server/hono-app.ts` | All auth routes: discovery, authorize, GitHub start/callback, token, DCR, protected resource |
| `src/worker-entry.ts` | Injects `apiKey`, `clientSecret`, `jwtSecret`, `githubClientId`, `githubClientSecret`, `allowedGithubUsernames` from Workers env bindings |
| `src/node-server.ts` | Same env vars read via `process.env` fallback inside `hono-app.ts` |
| `packages/server/package.json` | `"arctic": "^3.0.0"` — the only new dependency |

### Complete OAuth flow (Claude.ai / ChatGPT)

```
1. Client → GET /authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...
2. Server → renders auth page (GitHub button + API key form)
3. User clicks GitHub → GET /oauth/github/start?<same-params>
4. Server → signs state JWT (carries all OAuth params), redirects to GitHub
5. GitHub → user authenticates, redirects to GET /oauth/github/callback?code=...&state=<jwt>
6. Server → verifies state JWT, exchanges GitHub code via arctic, checks username allowlist
7. Server → issues auth_code JWT, redirects to redirect_uri?code=<jwt>&state=<client_state>
8. Client → POST /oauth/token { grant_type=authorization_code, code=<jwt>, code_verifier=... }
9. Server → verifies auth_code JWT, verifies PKCE, issues access_token JWT
10. Client → GET /mcp with Authorization: Bearer <access_token>
11. Server → verifies JWT signature + expiry, proceeds
```

---

## Consequences

- No KV, no D1 auth tables, no session storage — entire auth stack is stateless
- `JWT_SECRET` is the single secret that must be kept safe; rotation invalidates all active tokens
- GitHub username allowlist is hardcoded via `ALLOWED_GITHUB_USERNAMES` env var — no UI to manage it
- 1-hour token expiry; no refresh tokens (re-auth required after expiry)
- ChatGPT can complete OAuth automatically without user-supplied client credentials
