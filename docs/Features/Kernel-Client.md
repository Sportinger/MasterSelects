# Kernel Client

[← Back to Index](./README.md)

The kernel client is the browser-side transport boundary for the optional
MasterSelects kernel service. It supports the WP11 strangler routing described
by the **Agent Kernel Plan**: FlashBoard offers a request to the service first
when kernel mode is configured, while retaining the existing community chat
path as the fallback.

The client contains no kernel implementation. It serializes requests, performs
HTTP calls to a separately running service, interprets the small run-status
envelope, and returns either a handled response or control to FlashBoard.

---

## Modes

| Mode | Browser behavior |
|---|---|
| Community mode | Kernel routing is disabled. FlashBoard uses its configured chat provider and app-side prompt/tool flow. |
| Kernel mode | The browser sends the request to the configured external service first. A successful or explicitly failed run is handled there; eligible availability and routing failures fall back to the community path. |

Kernel mode is opt-in. Its browser configuration does not bundle extra kernel
behavior into the app.

## Local Configuration

The gateway reads exactly three `localStorage` entries:

| Key | Semantics |
|---|---|
| `ms.kernel.enabled` | Routing is enabled only when the value is exactly `true`; any other value selects community mode. |
| `ms.kernel.url` | External service base URL. Empty or missing values default to `http://127.0.0.1:8787`. |
| `ms.kernel.token` | Bearer token for authenticated operations. Missing or blank tokens skip kernel routing. |

The token is read only to construct the service request. Same-origin scripts or
browser-profile access can expose `localStorage`, so use a scoped token and
protect the local profile.

## Routing And Fallback

FlashBoard invokes `tryKernelFirst()` before it constructs the community
provider system prompt.

| Condition | Gateway result | FlashBoard behavior |
|---|---|---|
| Flag off or storage unavailable/unreadable | Not handled | Continue through the community provider. |
| Token missing or blank | Not handled | Continue through the community provider. |
| HTTP error, timeout, network exception, or unrecognized success status | Not handled | Continue through the community provider. |
| Status `aborted` | Not handled | Continue through the community provider. |
| Status `failed` | Handled with the failure message and optional run ID | Show the failure; do not resend through a community provider. |
| Status `succeeded` | Handled with a verification fingerprint and optional run ID | Show success; do not invoke a community provider. |

Availability and routing failures fail open so community mode remains usable.
An explicit `failed` run is authoritative and is surfaced rather than silently
rerunning the request through another provider.

## Isolation Guarantee

`src/services/kernelClient/` is a transport-and-types-only boundary. Its three
source files may import only relative modules resolving inside that directory.
They must not import stores, engines, app feature implementations, or external
packages. Kernel logic, private prompts, evaluation criteria, and expert packs
are not client assets.

`tests/unit/kernelClientIsolation.test.ts` enforces the boundary by:

- resolving every static and dynamic module specifier in the client sources;
- rejecting implementation, prompt, pack, and evaluation leakage vocabulary;
- requiring the FlashBoard pre-hook to remain the only gateway import site
  under `src/`; and
- freezing all three `localStorage` key names so renames fail loudly.

## Troubleshooting

Check `GET /health` on the configured base URL. The default is
`http://127.0.0.1:8787/health`; this availability probe does not require the
bearer token used by kernel operations.

If FlashBoard unexpectedly uses the community path, check:

1. `ms.kernel.enabled` is the string `true`.
2. `ms.kernel.token` is present and not blank.
3. `ms.kernel.url` reaches the running service without a proxy or firewall
   issue.
4. The health endpoint responds before the request timeout.
5. The run did not return `aborted`, an HTTP failure, or an unknown status.

An explicit `failed` status is not a fallback cause. FlashBoard displays that
result so the failure and optional run ID remain visible.

---

*Source: `src/services/kernelClient/`,
`src/services/flashboard/FlashBoardChatService.ts`,
`tests/unit/kernelClientIsolation.test.ts`*
