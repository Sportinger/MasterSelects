---
title: "Kernel Client"
---

[Back to Index](/features/readme/)

The kernel client is the browser-side boundary for the external MasterSelects
kernel service and the kernel-first route. FlashBoard invokes it when the
MasterSelectsAI kernel provider is selected; Kie.ai/community chat follows its
own provider path. The service compiles and verifies the plan; the browser
remains the only process that executes semantic editor tools and owns timeline
history.

## Transcript Moment Evidence

Story-path compile requests can include browser-built transcript moments.
Index version `app-transcript-v2` keeps the transcript text and source range
from v1, groups adjacent transcript spans into short natural phrases, and
includes the original source timings in `words`. Collection is uncapped and
pages transcript and speech-marker results in batches of 5,000. Moments can
also add three optional evidence groups:

- `pauses`: source-time start/end ranges from voice activity or speech markers
- `emphasis`: text, source start, and score from prosody evidence
- `markers`: breath, filler, or normalized disfluency point evidence

Each moment declares its honest `analysisSources`. The allowed values are
`transcript`, `voice-activity`, `speech-markers`, and `prosody`; a source is
added only when that source contributed evidence to that moment. Transcript is
always present for emitted moments. Marker pages are read through the semantic
`getSpeechMarkers` execution path after transcript paging. Separate optional
silence evidence is collected through `findSilentSections` and sent as
`silentRanges`.

---

## Production Default

Production builds route kernel traffic through the same-origin Pages proxy
`/api/kernel/*` by default. Its non-hosted routes forward `health`, `compile`,
and `runs/:id/complete`; hosted-agent routes are dispatched separately. The
proxy requires a signed-in app session for the compile and completion POST
routes and attaches the service bearer token server-side, so browsers never
hold a kernel credential on this path. The `localStorage` keys below remain
the explicit override, and `ms.kernel.enabled` = `false` is the kill switch in
every environment.

## Local Configuration

The gateway reads four `localStorage` entries:

| Key | Semantics |
|---|---|
| `ms.kernel.url` | Direct external service base URL override. Blank or missing values use the production proxy or bypass the gateway in development. |
| `ms.kernel.token` | Bearer token for a direct service override. Blank or missing values use the production proxy or bypass the gateway in development. |
| `ms.kernel.enabled` | Presence-based cutover switch. Only the exact string `false` disables the kernel. |
| `ms.kernel.fallback` | Local calibration opt-in. Only the exact string `true` lets a declined pre-execution run return `handled: false`; the default is fail-closed. |

In development, URL + token enable direct service access; a development bridge
token can supply local credentials. In production, no local credentials are
needed because the same-origin proxy is the default.

The direct-service token is read only to authenticate kernel requests.
Same-origin scripts or browser-profile access can expose `localStorage`, so
use a scoped token and protect the local profile.

## Compile, Execute, Complete

`tryKernelFirst()` implements one kernel transaction:

1. It calls the same `handleGetTimelineState` handler used by the semantic
   `getTimelineState` tool and sends that compact snapshot with the request to
   `POST /kernel/compile`.
2. A compiled response must contain a run ID and validated concrete
   `resolvedCalls` (`stepId`, `tool`, and object `args`). The browser executes
   those calls in order through `executeAIToolCalls(..., 'chat')`.
3. The gateway opens one `beginAgentTransaction` for the task and invokes the
   semantic executor with nested history suppressed. A successful group is
   committed as one undo point. Any failed or missing tool result aborts the
   transaction and rolls the whole group back through `abortAgentTransaction`.
4. Before committing, it rebuilds the snapshot with the same timeline handler
   and sends `{ finalSnapshot }` to `POST /kernel/runs/:runId/complete`.
5. The gateway commits only after a successful `fingerprintAssert.matches`
   result and succeeded completion status. Completion transport errors,
   unreadable replies, and verification failures roll the transaction back. A
   verified run is shown in chat with the short fingerprint plus verified
   video/audio clip counts and occupied span from the verification report or
   compile summary.

Direct service endpoints are authenticated with `Authorization: Bearer
<token>`. The browser never asks the service to mutate editor state directly.

## Routing And Fallback

| Condition | Gateway result | FlashBoard behavior |
|---|---|---|
| Storage unavailable, disabled kernel, or missing development credentials | Not handled | The selected kernel provider reports it as unavailable. |
| Compile HTTP/network error, malformed response, `aborted`, or `failed` | Handled declined result by default | Show the decline without switching providers. `ms.kernel.fallback` = `true` is the explicit local calibration exception. |
| Any local tool failure or executor exception | Roll back, then handled declined result by default | Timeline changes are rolled back; no provider is selected automatically. |
| Completion transport/error response | Roll back, then handled failure | Surface the verification failure; the transaction is not committed. |
| Fingerprint mismatch | Roll back, then handled failure | Surface the mismatch honestly; the transaction is not committed. |
| Completion succeeded and fingerprint matches | Handled verified result | Show video/audio counts, occupied span, and short fingerprint in chat. |

The selected kernel provider fails closed by default. The only pre-execution
fail-open behavior is the explicit `ms.kernel.fallback` local calibration
override. Completion happens before commit, so a failed verification does not
leave a committed kernel edit behind.

## Isolation Guarantee

`src/services/kernelClient/index.ts` and `types.ts` are the transport/type
boundary. They may import only relative modules resolving inside
`src/services/kernelClient/` and must not import stores, engines, app feature
implementations, or external packages.

`kernelChatGateway.ts` is deliberately the app-side integration layer: it may
import the semantic tool executor and the agent transaction API. It contains
no kernel logic, prompt, rubric, or pack assets.

`tests/unit/kernelClientIsolation.test.ts` keeps the guard honest by applying
the strict import rules only to `index.ts` and `types.ts`, scanning the named
transport, gateway, story-verification, and transcript-moment files for
forbidden private vocabulary, requiring FlashBoard to remain the only gateway
import site, and freezing the four storage key names.

## Hosted-Agent Client

`src/services/kernelClient/hostedAgent/` contains the public browser-side
hosted-agent transports, operation bridge, session resume, settlement, and
Fast V2 protocol adapters. The Pages kernel route dispatches hosted-agent
requests before the compile/complete allowlist.
## Troubleshooting

Every routing decision and decline reason is logged through the app logger:
run `Logger.enable('KernelGateway')` in the browser console and repeat the
prompt. Compile failures, transport errors, and rollback causes all appear
there with their reason strings. The FlashBoard UI also shows local kernel
progress and a structured run card for handled runs.

If the selected MasterSelectsAI provider is unavailable or declines a run,
check:

1. In production: the user is signed in (the `/api/kernel/*` proxy rejects
   anonymous compile and completion POSTs) and `ms.kernel.enabled` is not the
   exact string `false`.
2. In development: `ms.kernel.url` and `ms.kernel.token` are both present and
   nonblank, unless the development bridge provides local credentials.
3. The configured direct service is reachable (`GET <url>/kernel/health`) and
   accepts the bearer token; production normally uses `GET /api/kernel/health`.
4. `/kernel/compile` did not return `aborted`, `failed`, an HTTP failure, or
   an invalid response (see the gateway log). These conditions are handled
   declines by default, not an automatic community-provider fallback.
5. The browser console has no rolled-back semantic tool failure warning.

Operators with service access can additionally watch requests flow through
the kernel in real time via the service's own login-protected monitor page at
`<service origin>/kernel/monitor`; its content is outside this repository.

If verification failed, inspect the run ID and completion response. The
gateway attempts rollback before reporting that failure and does not select a
second provider automatically.

---

*Source: `src/services/kernelClient/`,
`src/services/flashboard/FlashBoardChatService.ts`,
`functions/api/kernel/[[path]].ts`,
`tests/unit/kernelChatGatewayCutover.test.ts`,
`tests/unit/kernelClientIsolation.test.ts`*
