# Kernel Client

[Back to Index](./README.md)

The kernel client is the browser-side boundary for the external MasterSelects
kernel service and the WP11 kernel-first strangler route. FlashBoard offers an
eligible request to the kernel before constructing the community-provider
prompt. The service compiles and verifies the plan; the browser remains the
only process that executes semantic editor tools and owns timeline history.

The app does not contain the kernel implementation, private prompts, expert
packs, or evaluation criteria.

---

## Local Configuration

The gateway reads exactly three `localStorage` entries:

| Key | Semantics |
|---|---|
| `ms.kernel.url` | Required external service base URL. Blank or missing values bypass kernel routing. |
| `ms.kernel.token` | Required bearer token. Blank or missing values bypass kernel routing. |
| `ms.kernel.enabled` | Presence-based cutover switch. URL + token enable kernel-first by default; only the exact string `false` disables it. |

This default-on behavior applies only when both URL and token are present. The
older explicit `true` flag is still accepted but is no longer required.

The token is read only to authenticate kernel requests. Same-origin scripts or
browser-profile access can expose `localStorage`, so use a scoped token and
protect the local profile.

## Compile, Execute, Complete

`tryKernelFirst()` implements one production transaction:

1. It calls the same `handleGetTimelineState` handler used by the semantic
   `getTimelineState` tool and sends that compact snapshot with the request to
   `POST /kernel/compile`. For transcript-bearing timeline clips, the app also
   reads bounded `getClipTranscript` pages through the semantic gateway and
   builds source-time moment handles locally. Paging stops at 400 transcript
   words across the request.
2. A compiled response must contain a run ID and validated concrete
   `resolvedCalls` (`stepId`, `tool`, and object `args`). The browser executes
   those calls in order through `executeAIToolCalls(..., 'chat')`.
3. A story response may request `setup.newComposition`. The app creates and
   opens that composition through the semantic `createComposition` tool before
   executing the resolved story calls, so the final snapshot and verification
   describe the new timeline.
4. The gateway opens one `beginAgentTransaction` for the task and invokes the
   semantic executor with nested history suppressed. A successful group is
   committed as one undo point. Any failed or missing tool result aborts the
   transaction, rolls the whole group back through `abortAgentTransaction`,
   warns in the console, and returns control to community chat.
5. After a successful commit, it rebuilds the snapshot with the same timeline
   handler and sends `{ finalSnapshot }` to
   `POST /kernel/runs/:runId/complete`.
6. A successful `fingerprintAssert.matches` result is shown in chat with the
   short fingerprint plus verified video/audio clip counts and occupied span from
   the verification report or compile summary. Story results use the concise
   `N Clips, belegt bis Xs` form and add a one-line assumption note when the
   compile summary reports assumptions.

The service endpoints are authenticated with `Authorization: Bearer <token>`.
The browser never asks the service to mutate editor state directly.

Transcript indexing remains app-side and uses the user's existing local
analysis. Moment payloads contain only the media-file ID, source-time start/end,
transcript text, confidence, and the `app-transcript-v1` index version. No raw
media, audio, video frames, or analysis artifacts are sent. These text-and-time
moments are sent solely to the kernel service configured in `ms.kernel.url` as
part of that user's compile request.

## Routing And Fallback

| Condition | Gateway result | FlashBoard behavior |
|---|---|---|
| Storage unavailable, URL/token missing, or `ms.kernel.enabled` exactly `false` | Not handled | Continue through the community provider. |
| Compile HTTP/network error or malformed response | Not handled | Continue through the community provider. |
| Compile status `aborted`, including `notMechanicalTask`, `storyPathNeedsProvider`, or `storyPathNeedsMoments` | Not handled | Fall back silently to the community provider. |
| Compile status `failed` | Handled failure | Surface the kernel failure without running tools. |
| Any local tool failure or executor exception | Roll back, then not handled | Warn in the console and continue through the community provider. |
| Completion transport/error response after a committed mutation | Handled failure | Surface the verification failure; do not run a second provider against mutated state. |
| Fingerprint mismatch | Handled failure | Surface the mismatch honestly; do not fall back because state was already mutated. |
| Completion succeeded and fingerprint matches | Handled verified result | Show video/audio counts, occupied span, and short fingerprint in chat. |

Compile-time availability failures fail open. Once all local calls have
succeeded and the single transaction has committed, completion failures fail
closed so the same prompt cannot mutate the already-changed timeline twice.

## Isolation Guarantee

`src/services/kernelClient/index.ts` and `types.ts` are the transport/type
boundary. They may import only relative modules resolving inside
`src/services/kernelClient/` and must not import stores, engines, app feature
implementations, or external packages.

`kernelChatGateway.ts`, `transcriptMoments.ts`, and `storyVerification.ts` are
deliberately app-side integration and presentation modules: they may use the
semantic tool executor and agent transaction API. They still contain no kernel
logic, prompt, rubric, or pack assets, and the moment builder does not read
timeline or media stores directly.

`tests/unit/kernelClientIsolation.test.ts` keeps the guard honest by applying
the strict import rules only to `index.ts` and `types.ts`, scanning every
kernel-client source for forbidden private vocabulary, requiring the
FlashBoard pre-hook to remain the only gateway import site, and freezing the
three storage key names.

## Troubleshooting

If FlashBoard unexpectedly uses community chat, check:

1. `ms.kernel.url` and `ms.kernel.token` are both present and nonblank.
2. `ms.kernel.enabled` is not the exact string `false`.
3. The configured service is reachable and accepts the bearer token.
4. `/kernel/compile` did not return `aborted` (including a story-provider or
   missing-moments fallback), an HTTP failure, or an invalid response.
5. The browser console has no rolled-back semantic tool failure warning.

If the timeline changed but verification failed, inspect the run ID and the
completion response. The gateway intentionally does not fall back after the
transaction commits.

---

*Source: `src/services/kernelClient/`,
`src/services/flashboard/FlashBoardChatService.ts`,
`tests/unit/kernelChatGatewayCutover.test.ts`,
`tests/unit/transcriptMoments.test.ts`,
`tests/unit/kernelClientIsolation.test.ts`*
