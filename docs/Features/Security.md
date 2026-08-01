# Security

[Back to Index](../../README.md)

Security model, credential handling, and trust boundaries for MasterSelects.

---

## Table of Contents

- [Trust Model](#trust-model)
- [Secret Handling](#secret-handling)
- [Log Redaction](#log-redaction)
- [Bridge Security](#bridge-security)
- [Hosted AI Chat Logging](#hosted-ai-chat-logging)
- [Known Limitations](#known-limitations)
- [Reporting Issues](#reporting-issues)

---

## Trust Model

MasterSelects is local-first for editing and browser-side processing. It also has explicit local bridge surfaces:

- The Vite development bridge
- The Native Helper WebSocket and HTTP bridge

The main trust boundaries are:

- The browser origin and authenticated session cookie
- The Vite dev-bridge token injected only into development builds
- The Native Helper token generated at startup
- Explicit allowed file roots
- IndexedDB for the optional encrypted YouTube Data API credential
- OPFS for downloaded SAM 2 and stem-separation model caches
- Cloudflare D1 for hosted accounts, billing, usage, AI audit data, chat logs, and credit claims

External services are contacted only when their feature is used, including hosted AI, cloud transcription or generation, Google Fonts, Google's optional YouTube Data API integration, and model downloads. The demo video is served by MasterSelects and does not connect to YouTube.

German and English legal pages are available at `/impressum`, `/datenschutz`, `/imprint`, and `/privacy`. The website free-credit offer is requested only after the user activates it. Its browser-binding cookie expires with the offer, up to one hour.

Hosted AI requests go through Cloudflare Functions, require an authenticated session and credits, and use server-managed provider credentials. The current chat UI exposes the Kie-hosted model catalog.

Credit-claim links contain high-entropy codes, while D1 stores only their SHA-256 hashes. Public claim routes expose claim metadata; redemption is a same-origin POST that requires a signed-in session, checks the supplied email, and honours any recipient lock. The website offer additionally uses a six-digit redeem code whose domain-separated hash is stored in D1. A signed, HttpOnly, SameSite cookie binds that offer to the browser that acquired it.

---

## Secret Handling

### Storage

The only optional browser-stored credential is the YouTube Data API key:

- It is encrypted with a per-browser AES-256-GCM key in IndexedDB.
- The encryption key is stored in the same IndexedDB database, so this prevents casual inspection rather than hostile same-origin code or extensions.
- The Integrations settings panel stores, loads, clears, and masks this credential.

Hosted AI and generation provider credentials are managed by MasterSelects services and are not stored in browser settings.

### Key Types

| Key | Service | Storage |
|-----|---------|---------|
| `youtube-api-key` | Optional YouTube Data API v3 integration | AES-256-GCM encrypted IndexedDB (`multicam-settings` / `api-keys`) |
| Hosted AI and generation credentials | MasterSelects service providers | Server-side environment configuration; not exposed to browser settings |

---

## Log Redaction

Browser log entries are scanned for common secret patterns before they enter the in-memory log buffer. AI tool statistics reapply redaction when returning buffered logs. Hosted AI audit and chat-log storage use separate recursive redaction before D1 persistence.

This applies to:

- Log messages
- Data objects attached to log entries
- Error messages and stack traces
- AI-tool statistics returned from the browser
- Hosted AI payloads and errors persisted to D1

### Patterns Detected

| Pattern | Example |
|---------|---------|
| OpenAI / Anthropic-style API keys | `sk-proj-...`, `sk-ant-...`, `sk-...` |
| Bearer tokens | `Bearer eyJ...` |
| `x-api-key` header values | `x-api-key: abc123...` |
| URL key parameters | `?key=AIzaSy...` |
| Long hex tokens | 40+ hex characters |
| Long alphanumeric tokens | 40+ alphanumeric or underscore characters |

### Preserved

| Type | Why |
|------|-----|
| UUIDs | Used as clip and track IDs |
| Hex color codes | Short hex strings such as `#ff4444` |
| Short strings | Below the secret-length thresholds |
| Normal log text | Common messages, numbers, and paths |

---

## Bridge Security

### Development Bridge

The Vite development bridge exposes local HTTP endpoints for AI tooling and file access. Development builds receive `__DEV_BRIDGE_TOKEN__`; production builds receive an empty value.

The current flow is:
```
POST /api/ai-tools -> Vite server -> HMR -> browser -> executeAITool()
```

Bridge preflight endpoints:

- `GET /api/ai-tools` is status-only and does not require auth.
- `GET /api/ai-tools/auth-check` requires the bearer token and returns `{ "status": "ok" }`.
- `POST /api/ai-tools` requires the bearer token and forwards tool execution to a selected browser tab.

The bridge also serves authenticated local-file endpoints:

- `/api/local-file`
- `/api/local-files`

Authenticated bridge routes check a bearer token. Browser requests with an `Origin` header must use `localhost` or `127.0.0.1`; CORS headers are issued only for those origins. File routes require an existing absolute non-UNC path that resolves inside an allowed root. Default roots are the repository, optional project root, system temp directory, and the user's Desktop, Documents, Downloads, and Videos directories; `MASTERSELECTS_ALLOWED_FILE_ROOTS` can add roots.

### Native Helper

The Native Helper binds its WebSocket server to `127.0.0.1:9876` by default and its HTTP server to `127.0.0.1:9877`. It generates a new token at startup unless launched with `--no-auth`:

- `GET /startup-token` is served only on the loopback HTTP listener and returns the current token for browser discovery.
- WebSocket clients must send the token in the protocol `Auth` command before they can run other commands.

The helper writes its token to the system temporary directory as `masterselects-helper.token`; on Unix it attempts mode `0600`.

The helper checks configured origins for HTTP CORS and WebSocket handshakes, permits its configured MasterSelects and local origins, and accepts Cloudflare Pages origins. Its file and upload routes require authentication and enforce absolute paths inside helper-owned allowed roots.

The Native Helper has no external-agent/editor-tool forwarding route. External agent control is development-only through the separately authenticated Vite/MCP path.

---

## Hosted AI Chat Logging

Hosted `/api/ai/chat` calls may write best-effort rows to the D1 `chat_logs` table. Logging does not block the chat response. Billing settlement and replay data are stored separately in hosted-chat turn records.

Stored chat-log fields include:

- authenticated user id, request id, idempotency key, and model id
- redacted request/audit payload
- redacted provider response and extracted tool calls
- token counts, credit cost, duration, status, and error code

Authenticated users can inspect their own history through:

- `GET /api/ai/chat-history`
- `GET /api/ai/chat-history?id=<log-id>`

Local editor tool execution does not itself write to `chat_logs`.

---

## Known Limitations

1. IndexedDB encryption protects the optional YouTube credential from casual inspection only. Same-origin code or browser extensions with storage access can still read it.
2. The development server sets cross-origin isolation headers but does not set a general CSP. The deployed middleware sets a CSP only for the admin page.
3. Browser log redaction is pattern-based; unrecognised secret formats can still leak through logged data.
4. The dev bridge token is written to `.ai-bridge-token` in the repository by default, so local processes that can read that file can use the bridge.
5. Launching Native Helper with `--no-auth` disables its HTTP and WebSocket authentication boundary.
6. The Native Helper discovery endpoint returns its token to any client that can reach its loopback HTTP listener.
7. Hosted AI prompts, responses, tool calls, and billing metadata are stored in D1 when the hosted chat route is used; persisted chat payloads are redacted but still contain user-supplied content.
8. The helper's token-file permission hardening is Unix-specific; the code does not set an equivalent Windows ACL.

---

## Reporting Issues

If you discover a security vulnerability:

1. Do not open a public GitHub issue.
2. Contact the maintainers privately.
3. Include steps to reproduce the issue.
4. Allow reasonable time for a fix before disclosure.

---

*Source: `src/services/security/redact.ts`, `src/services/logger.ts`, `src/services/youtubeCredentialManager.ts`, `src/components/common/settings/IntegrationCredentialsSettings.tsx`, `tools/devBridge/auth.ts`, `tools/devBridge/vitePlugin.ts`, `tools/devBridge/localFileEndpoints.ts`, `tools/native-helper/src/main.rs`, `tools/native-helper/src/server.rs`, `tools/native-helper/src/http_server.rs`, `tools/native-helper/src/websocket_server.rs`, `functions/api/ai/chat.ts`, `functions/api/ai/chat-history.ts`, `functions/lib/chatLog.ts`, `functions/lib/creditClaims.ts`, `functions/lib/websiteFreeCreditOffer.ts`*
