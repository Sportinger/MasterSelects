# Security

[← Back to Index](../../README.md)

Security model, secret handling, and trust boundaries for MasterSelects.

---

## Table of Contents

- [Trust Model](#trust-model)
- [Secret Handling](#secret-handling)
- [Log Redaction](#log-redaction)
- [Bridge Security](#bridge-security)
- [Known Limitations](#known-limitations)
- [Reporting Issues](#reporting-issues)

---

## Trust Model

MasterSelects is a local-first application. Rendering, editing, and most analysis happen in the browser, but the app also has two explicit local bridge surfaces:
- The Vite dev bridge used in development
- The Native Helper bridge used for production/local companion workflows

The main trust boundaries are:
- The browser origin
- The dev bridge auth token injected by Vite
- The Native Helper auth token generated at startup
- Explicit allowed file roots
- IndexedDB for encrypted API keys
- OPFS for the SAM 2 model cache

External services are only contacted when the user enables a feature that needs them, such as AI chat, transcription, AI video generation, or multicam EDL generation.

Local Lemonade chat is treated as a local provider rather than a MasterSelects bridge. The app sends chat prompts, timeline summaries, tool definitions, and tool results to the configured Lemonade Server, but the configured endpoint is restricted to loopback hosts (`localhost`, `127.0.0.1`, or `::1`).

---

## Secret Handling

### Storage

API keys are stored encrypted in IndexedDB using the Web Crypto API:

- Each browser instance generates a unique AES-256-GCM key
- The encryption key is stored alongside the encrypted secrets in IndexedDB
- This blocks casual inspection, but not same-origin scripts or browser extensions with storage access

### File Export

The `.keys.enc` export/import path remains disabled. The previous implementation relied on a deterministic hardcoded passphrase, so it was only obfuscation. Keys must be re-entered manually on a new machine until a passphrase-based scheme is implemented.

### Key Types

| Key | Service | Storage |
|-----|---------|---------|
| `openai` | OpenAI API | Encrypted IndexedDB |
| `assemblyai` | AssemblyAI | Encrypted IndexedDB |
| `deepgram` | Deepgram | Encrypted IndexedDB |
| `piapi` | PiAPI gateway | Encrypted IndexedDB |
| `kieai` | Kie.ai | Encrypted IndexedDB |
| `youtube` | YouTube Data API | Encrypted IndexedDB |
| `klingAccessKey` | Kling AI | Encrypted IndexedDB |
| `klingSecretKey` | Kling AI | Encrypted IndexedDB |

---

## Log Redaction

All log output is scanned for common secret patterns and redacted before it is stored in the log buffer or exposed through the AI bridge.

This applies to:
- Log messages
- Data objects attached to log entries
- Error messages and stack traces
- AI tool bridge responses

### Patterns Detected

| Pattern | Example |
|---------|---------|
| OpenAI / Anthropic API keys | `sk-proj-...`, `sk-ant-...`, `sk-...` |
| Bearer tokens | `Bearer eyJ...` |
| `x-api-key` header values | `x-api-key: abc123...` |
| URL key parameters | `?key=AIzaSy...` |
| Long hex tokens | 40+ hex chars |
| Long alphanumeric tokens | 40+ chars |

### Preserved

| Type | Why |
|------|-----|
| UUIDs | Used as clip and track IDs |
| Hex color codes | Short hex strings like `#ff4444` |
| Short strings | Anything under the secret-length thresholds |
| Normal log text | Common messages, numbers, paths |

---

## Bridge Security

### Development Bridge

The Vite dev bridge exposes local HTTP endpoints for AI tooling and local file access. The browser only attaches the dev bridge token when `__DEV_BRIDGE_TOKEN__` is present.

The current flow is:
```
POST /api/ai-tools -> Vite server -> HMR -> browser -> executeAITool()
```

The bridge also serves local file endpoints used by the AI media tools:
- `/api/local-file`
- `/api/local-files`

Those routes are protected by:
- A bearer token injected by Vite
- Loopback-only origins
- Explicit allowed roots
- Absolute-path validation plus traversal rejection

Allowed roots are seeded from the Vite config from the project root, temp directory, Desktop, Documents, Downloads, and Videos, and can be extended through `MASTERSELECTS_ALLOWED_FILE_ROOTS`.

### Native Helper Bridge

The Native Helper runs on `127.0.0.1` only and uses its own random auth token:
- HTTP on port `9877`
- WebSocket on port `9876`
- `GET /ai-tools` and `GET /api/ai-tools` are status-only and do not require auth
- `POST /ai-tools` and `POST /api/ai-tools` require the bearer token
- `GET /startup-token` is localhost-only and lets the browser discover the helper token

The helper also writes its auth token to a temp file named `masterselects-helper.token` so the browser can discover it during startup.

The helper enforces:
- Bearer-token authentication for HTTP and WebSocket requests
- Origin checks for the WebSocket connection
- Explicit allowed file roots for file reads, uploads, and directory listing
- Rejection of traversal and UNC paths

The AI chat approval UI is separate from these bridge checks. It is a user-experience gate for mutating or sensitive tools, not the underlying security boundary.

### Lemonade Local Provider

Lemonade is not allowed to call the MasterSelects bridge directly. It only receives the chat request and can return text or OpenAI-compatible tool-call suggestions.

Those tool calls still execute through the normal chat path:
- The AI chat approval mode is applied before mutating or sensitive tools run
- Tool execution goes through the shared `executeAITool()` dispatcher
- Local file tools continue to rely on the dev bridge or Native Helper file-access checks

The Lemonade request includes `Authorization: Bearer lemonade` because Lemonade's OpenAI-compatible endpoint accepts that convention. It is a static compatibility header, not a secret and not equivalent to the dev bridge token or Native Helper startup token.

---

## Known Limitations

1. IndexedDB encryption is only defense against casual inspection. A same-origin script or extension with storage access can still read the keys.
2. Development does not add CSP headers by default.
3. Log redaction is pattern-based. Unrecognized secret formats may still leak if they reach the logger before redaction rules are added.
4. The dev bridge token is local-process-scoped. The token file is stored in the project root as `.ai-bridge-token`, so any local process with file access can read it.
5. The Native Helper can be started with `--no-auth`, but that disables the auth boundary entirely and is not recommended.
6. API keys are still sent to external services over HTTPS when you enable AI features that need them.
7. Lemonade runs outside the app. Any local process that controls the configured local Lemonade server can see the chat prompt, timeline summary, tool definitions, and tool results sent to it.

---

## Reporting Issues

If you discover a security vulnerability:

1. Do not open a public GitHub issue
2. Contact the maintainers privately
3. Include steps to reproduce the issue
4. Allow reasonable time for a fix before disclosure

---

*Source: `src/services/security/redact.ts`, `src/services/logger.ts`, `src/services/security/fileAccessBroker.ts`, `src/services/security/devBridgeAuth.ts`, `src/services/lemonadeProvider.ts`, `vite.config.ts`, `tools/native-helper/src/server.rs`, `tools/native-helper/src/main.rs`, `src/components/panels/AIChatPanel.tsx`*
