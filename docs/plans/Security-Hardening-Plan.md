# MasterSelects Security Hardening Plan

This plan is intentionally repo-specific. It is based on the current MasterSelects architecture, not on generic web-app advice.

## Objectives

- Close the easiest local attack paths in development and local-runtime mode.
- Introduce explicit trust boundaries for AI tool execution.
- Prevent accidental secret leakage through prompts, logs, and debug bridges.
- Keep the product usable for local AI-assisted editing without silently exposing broad local file or tool access.
- Add automated verification so security claims are backed by tests and CI.

## Non-Goals

- This plan does not turn a local-first browser app into a zero-trust system.
- This plan does not eliminate all risk from storing API keys client-side in the browser.
- This plan does not require a cloud backend for normal editing workflows.

## Current Attack Surface Summary

### Browser / Vite development surface

- `vite.config.ts`
  - `/api/local-file` serves arbitrary absolute paths with no auth.
  - `/api/local-files` lists arbitrary directories with no auth.
  - `/api/logs` syncs browser logs to disk for external inspection.
  - `/api/ai-tools` forwards HTTP requests into browser-side AI tool execution.
  - Dev endpoints currently return `Access-Control-Allow-Origin: *` on sensitive routes.

### Browser AI execution surface

- `src/main.tsx`
  - exposes `window.aiTools` globally.
- `src/services/aiTools/bridge.ts`
  - accepts HMR-triggered tool execution requests.
- `src/components/panels/AIChatPanel.tsx`
  - enables automatic tool execution with no confirmation layer between model output and mutating tool calls.
- `src/services/aiTools/handlers/media.ts`
  - can import local files through the dev file bridge.
- `src/services/aiTools/handlers/stats.ts`
  - can return logs and playback traces to AI callers.

### Secret handling surface

- `src/services/apiKeyManager.ts`
  - IndexedDB encryption protects against casual inspection, not against same-origin script execution.
  - file export uses a deterministic built-in passphrase, which is obfuscation rather than real secret protection.
- `src/services/claudeService.ts`
  - uses direct browser access to Anthropic from the client.
- `src/components/panels/AIChatPanel.tsx`
  - uses direct browser access to OpenAI from the client.

### Native helper surface

- `tools/native-helper/src/main.rs`
  - helper exposes WebSocket and HTTP services locally.
  - auth token generation exists, but runtime currently initializes state with `None`, so auth is effectively disabled.
- `tools/native-helper/src/server.rs`
  - HTTP server uses permissive CORS.
  - `/api/ai-tools` forwards tool execution to the connected editor session.
  - `/file` and `/upload` expose local file read/write within allowed prefixes.
- `tools/native-helper/src/utils.rs`
  - allowed prefixes currently include very broad paths such as the user home directory.

## Threat Model

### Threats we should treat as real

- A malicious website sending requests to `localhost` while the dev server or helper is running.
- A malicious browser extension reading or triggering browser-side AI capabilities.
- Prompt injection through transcripts, file names, imported metadata, logs, or external content.
- AI-driven exfiltration of local paths, logs, and debugging information.
- Overly broad local file access via helper or dev-server endpoints.
- Silent destructive edits triggered by model output.

### Threats we do not fully solve here

- Full compromise of the local machine.
- Malicious npm or Cargo dependencies already running trusted code locally.
- Memory scraping or browser compromise below the app level.

## Security Invariants

These should become hard rules in code and tests.

1. No external bridge may execute mutating or sensitive tools without explicit authorization.
2. No file-serving endpoint may expose arbitrary absolute paths without scoped allowlists.
3. No AI tool may read logs, local files, or debug traces unless that capability is explicitly declared.
4. Browser prompts, logs, and tool results must not contain raw API keys or helper tokens.
5. Native-helper AI bridging must require real session authentication.
6. Security-sensitive routes must fail closed.

## Implementation Workstreams

## Workstream 1: Introduce a formal AI tool policy layer

### Why

Today tool execution is driven mostly by tool names and handler wiring. There is no central policy model for:

- read-only vs mutating
- destructive vs reversible
- local-file access
- log/debug access
- bridge eligibility
- confirmation requirements

### Changes

- Add a `ToolPolicy` model in `src/services/aiTools/`.
- Extend tool metadata so every tool declares:
  - `riskLevel`: `low | medium | high`
  - `readOnly: boolean`
  - `requiresConfirmation: boolean`
  - `sensitiveDataAccess: boolean`
  - `localFileAccess: boolean`
  - `allowedCallers`: `chat | devBridge | nativeHelper | internal`
- Add a single policy gate before `executeAITool()` and before any bridge execution path.
- Remove reliance on `MODIFYING_TOOLS` as the only execution-safety classification. Keep it for history grouping only, or derive it from policy metadata.

### Files

- `src/services/aiTools/types.ts`
- `src/services/aiTools/definitions/*.ts`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/handlers/index.ts`
- new files under `src/services/aiTools/policy/`

### Required tests

- `tests/unit/aiToolPolicy.test.ts`
  - every tool has policy metadata
  - mutating tools are marked correctly
  - sensitive tools are not callable from disallowed bridges
  - unknown tools fail closed

### Exit criteria

- No tool can execute without a policy lookup.
- Tool definitions and policy registry remain in sync via tests.

## Workstream 2: Harden the Vite dev bridges

### Why

The Vite dev server is currently the easiest browser-adjacent attack path.

### Changes

- Restrict sensitive dev endpoints to `import.meta.env.DEV` and local loopback only.
- Replace `Access-Control-Allow-Origin: *` with strict local-origin checks.
- Require a random per-session dev bridge token for:
  - `/api/ai-tools`
  - `/api/local-file`
  - `/api/local-files`
  - `/api/logs`
- Reject requests with missing or invalid token before doing any work.
- Fail closed on malformed `Origin`, `Host`, or token headers.
- Make `/api/ai-tools` read-only by default unless an explicit unsafe flag is enabled.
- Make dev bridge startup print the session token and warning banner in the terminal.
- Disable `window.aiTools` global exposure outside guarded modes, or expose only a limited wrapper in production.

### Files

- `vite.config.ts`
- `src/main.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/logger.ts`
- new helper module such as `src/services/security/devBridge.ts`

### Required tests

- `tests/security/devBridgeRoutes.test.ts`
  - valid token succeeds
  - missing token returns `401`
  - bad origin returns `403`
  - mutating tool rejected when bridge is read-only
  - invalid JSON returns `400`

### Exit criteria

- Sensitive dev endpoints are unusable from arbitrary browser pages without the session token.
- Dev bridge behavior is explicitly visible and opt-in.

## Workstream 3: Restrict local file access to explicit roots

### Why

Both the dev server and native helper expose local file access. The current helper allowlist includes the home directory, which is too broad for a tool-execution environment.

### Changes

- Replace broad path-prefix rules with explicit roots:
  - current project root
  - temp download/cache dirs controlled by the app
  - user-approved import directories
  - optional user-approved media library roots
- Remove blanket home-directory fallback from the helper allowlist.
- On the dev side, stop serving arbitrary absolute paths.
- Add a local-file access broker that resolves file handles from approved roots instead of raw path strings where feasible.
- Normalize paths safely and reject traversal, UNC edge cases, and alias tricks.
- Ensure directory listing and file fetch share the same authorization path.

### Files

- `vite.config.ts`
- `src/services/aiTools/handlers/media.ts`
- `src/services/fileSystemService.ts`
- `tools/native-helper/src/utils.rs`
- `tools/native-helper/src/server.rs`
- `tools/native-helper/src/session.rs`

### Required tests

- `tests/security/localFileAccess.test.ts`
  - allowed project/download path succeeds
  - disallowed path under home directory fails
  - traversal attempts fail
  - directory listing uses same restrictions as file reads
- Rust tests in `tools/native-helper/src/` or `tools/native-helper/tests/`
  - `is_path_allowed` accepts only explicit allowed roots
  - Windows path normalization remains correct

### Exit criteria

- Raw path access is limited to explicit, explainable roots.
- The helper no longer treats the full home directory as safe.

## Workstream 4: Add explicit user approval for risky AI actions

### Why

The AI chat path currently executes model-selected tools directly. Undo helps usability, but it is not a security boundary.

### Changes

- Add a confirmation layer in `AIChatPanel` for tools marked:
  - `requiresConfirmation`
  - `riskLevel = high`
  - `localFileAccess = true`
  - `sensitiveDataAccess = true`
- Add a setting for approval mode:
  - `auto` for low-risk read-only tools
  - `confirm-mutating`
  - `confirm-all-sensitive`
- Batch execution must be pre-expanded for policy evaluation so a single `executeBatch` cannot smuggle disallowed sub-actions.
- External bridges should not be allowed to bypass this. For non-interactive bridge calls, either:
  - reject risky actions, or
  - require an explicit capability token or allowlist.

### Files

- `src/components/panels/AIChatPanel.tsx`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/handlers/batch.ts`
- `src/stores/settingsStore.ts`
- relevant settings UI files under `src/components/common/settings/`

### Required tests

- `tests/unit/aiApprovalFlow.test.tsx`
  - read-only tools auto-run
  - mutating tools pause for confirmation
  - rejected confirmation prevents execution
  - `executeBatch` with sensitive sub-tools is blocked or confirmed correctly

### Exit criteria

- High-risk actions cannot run purely because a model requested them.

## Workstream 5: Reduce secret and debug-data exposure

### Why

Logs, prompts, and tool results are currently rich enough to accidentally carry sensitive material.

### Changes

- Redact common secret patterns from logger output and AI-visible traces:
  - `Authorization: Bearer ...`
  - `x-api-key`
  - helper tokens
  - exported key material
- Mark `getLogs`, `getPlaybackTrace`, and similar tools as sensitive in the policy layer.
- Prevent AI tools from accessing full logs by default; return filtered/redacted views only.
- Replace deterministic `.keys.enc` export with user-supplied passphrase encryption, or remove file export until that exists.
- Update docs to state clearly that browser-side key storage defends mainly against casual local inspection, not same-origin script execution.
- Avoid logging raw request bodies or raw API responses where secrets may appear.

### Files

- `src/services/logger.ts`
- `src/services/aiTools/handlers/stats.ts`
- `src/services/apiKeyManager.ts`
- `src/services/claudeService.ts`
- `src/components/panels/AIChatPanel.tsx`
- docs under `docs/Features/`

### Required tests

- `tests/unit/logRedaction.test.ts`
  - secrets are redacted from logs
  - `getLogs` never returns raw API keys
- `tests/unit/apiKeyManager.test.ts`
  - exported key bundles require user passphrase or export is unavailable

### Exit criteria

- AI-visible debug surfaces are redacted and policy-gated.

## Workstream 6: Fix native-helper authentication and bridge permissions

### Why

The native helper already has auth concepts, but runtime currently initializes unauthenticated state. That leaves the AI bridge far more open than intended.

### Changes

- Change helper startup so it generates or loads a real auth token by default.
- Require auth for:
  - WebSocket command channel
  - HTTP `/api/ai-tools`
  - HTTP `/file`
  - HTTP `/upload`
  - filesystem command paths
- Pass the token explicitly from the frontend client.
- Tighten helper CORS and optionally require an auth header for HTTP requests even on loopback.
- Limit which registered editor session can receive AI tool forwarding.
- Consider binding AI bridge enablement to an explicit CLI flag or settings switch.
- Add rate limiting or bounded pending request counts for the AI bridge.
- Ensure helper-origin checks fail closed rather than only logging warnings.

### Files

- `tools/native-helper/src/main.rs`
- `tools/native-helper/src/server.rs`
- `tools/native-helper/src/session.rs`
- `tools/native-helper/src/protocol/*.rs`
- `src/services/nativeHelper/NativeHelperClient.ts`
- any helper install/bootstrap docs

### Required tests

- Rust integration tests for:
  - auth required on startup
  - bad token rejected
  - unauthenticated AI tool forwarding rejected
  - unauthenticated file upload/read rejected
- frontend tests for:
  - helper client sends token
  - unauthenticated helper errors surface correctly

### Exit criteria

- Native-helper AI and file surfaces require real authentication.

## Workstream 7: CI security checks and regression harness

### Why

Without automation, hardening work will drift.

### Changes

- Add `.github/workflows/security.yml` with:
  - `npm ci`
  - `npm run lint`
  - `npm run test`
  - security-focused Vitest suite
  - `npm audit --audit-level=high`
  - `cargo audit` in `tools/native-helper`
  - secret scanning with `gitleaks`
- Add optional CodeQL workflow for:
  - TypeScript / JavaScript
  - Rust
- Tag security tests so they can run in PRs and locally.

### Files

- `.github/workflows/security.yml`
- optional `.github/workflows/codeql.yml`
- `package.json`
- `tools/native-helper/Cargo.toml` or CI install steps as needed

### Required tests

- CI itself
- basic smoke tests for security workflow in PRs

### Exit criteria

- Security regressions break CI before merge.

## Workstream 8: Documentation and operational defaults

### Why

The repo currently documents the AI bridge as a feature. It should also document the trust model and safe defaults.

### Changes

- Update `docs/Features/AI-Integration.md` with:
  - trust boundaries
  - bridge modes
  - approval model
  - known limitations
- Update `tools/native-helper/README.md` with:
  - token requirements
  - HTTP/WS auth examples
  - safe startup modes
- Add a short security runbook:
  - how to enable local AI bridge safely
  - how to rotate tokens
  - how to verify restrictions locally

### Exit criteria

- A new contributor can understand what is safe by default and what is intentionally privileged.

## Rollout Phases

## Phase 0: Immediate blockers

Implement first, before larger refactors:

- remove wildcard CORS from sensitive Vite dev routes
- add dev bridge token
- gate `/api/ai-tools`
- gate native-helper AI bridge with real auth
- remove home-directory fallback from native helper allowlist

## Phase 1: Policy foundation

- land `ToolPolicy`
- classify every tool
- add policy tests

## Phase 2: Approval and local file restrictions

- add confirmation UX
- constrain local-file tools to explicit roots
- harden batch execution

## Phase 3: Secret handling and docs

- log redaction
- key export redesign
- documentation updates

## Phase 4: CI and review enforcement

- security workflow
- CodeQL
- release checklist updates

## Recommended PR Breakdown

1. `security/dev-bridge-auth`
   - Vite token/origin checks
   - no wildcard CORS on sensitive routes
   - tests for dev routes

2. `security/tool-policy`
   - `ToolPolicy`
   - policy tests
   - no approval UI yet

3. `security/ai-approval`
   - confirmation UX
   - batch gating
   - tests

4. `security/local-file-boundaries`
   - frontend file broker changes
   - helper allowlist tightening
   - tests

5. `security/native-helper-auth`
   - actual token use
   - authenticated HTTP/WS bridge
   - Rust tests

6. `security/log-redaction-and-docs`
   - redaction
   - key export improvements
   - docs

7. `security/ci`
   - workflow files
   - audit tooling

## Verification Matrix

### Functional

- AI chat still works for read-only queries.
- approved mutating edits still work end-to-end.
- local import still works from approved directories.
- native helper still supports project save/load and downloads after auth changes.

### Security

- bridge requests without token fail
- cross-origin requests fail
- sensitive tools rejected from disallowed callers
- logs are redacted
- helper file reads outside allowed roots fail
- helper AI bridge fails unauthenticated

### Regression

- `npm run test`
- targeted `vitest` security suite
- `npm run build`
- relevant helper tests

## Open Design Decisions

These need explicit decisions before implementation begins.

1. Should external bridges ever be allowed to run mutating tools non-interactively?
2. Should browser-side direct provider access remain, or should OpenAI/Anthropic calls move behind the helper?
3. Should local-file access eventually move from raw paths to user-approved handles or project-scoped registries only?
4. Is `.keys.enc` worth keeping if it cannot be made meaningfully secure?

## Recommended Decisions

To keep scope controlled, use these defaults unless new requirements emerge:

- External bridges are read-only by default.
- Mutating external bridge actions require explicit enablement plus confirmation.
- Native helper auth is mandatory by default.
- Dev bridge auth is mandatory in development whenever sensitive endpoints are enabled.
- Broad local path access is removed in favor of explicit roots.
- Secret export is disabled until passphrase-based export is implemented.

## Initial File Ownership Map

### Workstream A: Dev bridge and browser policy

- `vite.config.ts`
- `src/main.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/aiTools/types.ts`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/definitions/*.ts`
- `src/components/panels/AIChatPanel.tsx`
- browser-side tests under `tests/security/` and `tests/unit/`

### Workstream B: Native helper hardening

- `tools/native-helper/src/main.rs`
- `tools/native-helper/src/server.rs`
- `tools/native-helper/src/session.rs`
- `tools/native-helper/src/utils.rs`
- `src/services/nativeHelper/NativeHelperClient.ts`
- helper tests

### Workstream C: Secret handling, logs, docs, CI

- `src/services/logger.ts`
- `src/services/apiKeyManager.ts`
- `src/services/aiTools/handlers/stats.ts`
- `docs/Features/AI-Integration.md`
- `tools/native-helper/README.md`
- `.github/workflows/security.yml`
- optional CodeQL workflow

## Success Criteria

This plan is successful only if all of the following are true:

- Sensitive local bridges are authenticated and fail closed.
- AI tools have explicit, tested policy metadata.
- High-risk AI actions require approval or are blocked from unattended bridges.
- Local file access is constrained to explicit roots.
- Logs and AI-visible debug outputs are redacted.
- Native-helper AI forwarding requires real auth.
- Security checks run automatically in CI.
