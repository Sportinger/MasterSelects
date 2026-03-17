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

MasterSelects is a **local-first application** that runs entirely in the browser. All media processing, rendering, and editing happen client-side using WebGPU, WebCodecs, and Web Workers. No user data is sent to external servers unless explicitly triggered by the user (e.g., AI API calls, transcription services).

**Trusted boundaries:**
- The browser origin (`localhost:5173` in dev, or the deployed domain)
- IndexedDB storage (encrypted API keys)
- OPFS storage (SAM2 model cache)

**External services (user-initiated only):**
- OpenAI API (AI chat, transcription)
- PiAPI (AI video generation)
- AssemblyAI / Deepgram (transcription)
- YouTube Data API (video search)
- Kling AI (direct video generation)
- Anthropic API (multicam EDL generation)

---

## Secret Handling

### Storage

API keys are stored **encrypted in IndexedDB** using the Web Crypto API:

- Each browser instance generates a unique AES-256-GCM encryption key
- The encryption key is stored in IndexedDB alongside the encrypted keys
- This protects against **casual inspection** (e.g., browsing IndexedDB in DevTools)
- It does **not** protect against same-origin scripts or browser extensions with storage access

### File Export (Disabled)

The `.keys.enc` file export/import feature has been **disabled**. The previous implementation used a deterministic passphrase hardcoded in source code, which provided only obfuscation rather than real security. Keys must be re-entered manually on new machines until a user-passphrase-based encryption scheme is implemented.

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

All log output is automatically scanned for common secret patterns and redacted before being stored in the log buffer. This applies to:

- Log messages (`log.info(...)`, `log.warn(...)`, etc.)
- Data objects attached to log entries
- Error messages and stack traces
- AI tool bridge responses (defense-in-depth)

### Patterns Detected

| Pattern | Example |
|---------|---------|
| OpenAI / Anthropic API keys | `sk-proj-...`, `sk-ant-...`, `sk-...` |
| Bearer tokens | `Bearer eyJ...` |
| `x-api-key` header values | `x-api-key: abc123...` |
| URL key parameters | `?key=AIzaSy...` |
| Long hex tokens (40+ chars) | `a1b2c3d4...` (40+ hex chars) |
| Long alphanumeric tokens | `AbCd...` (40+ chars) |

### Preserved (Not Redacted)

| Type | Why |
|------|-----|
| UUIDs | Used as clip/track IDs throughout the app |
| Hex color codes | Short hex strings like `#ff4444` |
| Short strings | Anything under 15 characters |
| Normal log text | Common messages, numbers, paths |

---

## Bridge Security

### Development (HMR Bridge)

In development mode, external AI agents can execute tools via `POST /api/ai-tools`. This bridge:

- Only runs when the Vite dev server is active (`import.meta.env.DEV`)
- Routes through HMR WebSocket to the browser tab
- Requires a per-session Bearer token
- Rejects non-loopback browser origins
- Restricts local file reads/listings to explicit allowed roots (`repo root`, temp, Desktop, Documents, Downloads, Videos, plus optional `MASTERSELECTS_ALLOWED_FILE_ROOTS`)

### Production (Native Helper Bridge)

In production, the Rust native helper provides a WebSocket + HTTP bridge:

- WebSocket on port `9876`, HTTP on port `9877`
- Binds to `127.0.0.1` (localhost only, not exposed to network)
- Authenticates via a random Bearer token generated at helper startup
- Restricts file reads, uploads, and path searches to explicit allowed directories rather than the full home directory

---

## Known Limitations

1. **IndexedDB encryption key stored alongside encrypted data.** The AES-256-GCM key is in the same IndexedDB, so a same-origin script with storage access could decrypt all keys. This is defense against casual inspection, not a full security boundary.

2. **No CSP headers in development.** The Vite dev server does not set Content-Security-Policy headers. Production deployments should configure appropriate CSP.

3. **Log redaction is pattern-based.** Novel secret formats not matching the known patterns will not be redacted. The patterns are tuned for the specific API services used by MasterSelects.

4. **Dev bridge token is local-process-scoped.** The HMR-based AI tool bridge requires a per-session Bearer token, but the token is written to `.ai-bridge-token` in the project root. Any local process with file read access can obtain the token. This prevents cross-origin web attacks but not local process compromise.

5. **API keys are sent to third-party services.** When using AI features, API keys are transmitted to external services (OpenAI, PiAPI, etc.) over HTTPS. Users should review the privacy policies of these services.

---

## Reporting Issues

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Contact the maintainers privately
3. Include steps to reproduce the issue
4. Allow reasonable time for a fix before disclosure

---

*Source: `src/services/security/redact.ts`, `src/services/logger.ts`, `src/services/apiKeyManager.ts`*
