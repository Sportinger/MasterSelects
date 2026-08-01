# Kernel-Client.md — audit 2026-08-02

## Verified (spot checks that held)

- The client transport remains at `src/services/kernelClient/index.ts` and `types.ts`; both use only relative imports within that directory. `tests/unit/kernelClientIsolation.test.ts` enforces this boundary.
- Production kernel traffic defaults to the same-origin `/api/kernel/*` route when no local override is configured (`resolveKernelConfig()` in `src/services/kernelClient/kernelChatGateway.ts`). `functions/api/kernel/[[path]].ts` injects `KERNEL_AUTH_TOKEN` server-side and requires an authenticated user for `POST compile` and `POST runs/:id/complete`.
- Compiled calls require `stepId`, `tool`, and object `args` before execution (`parseResolvedCall()` in `src/services/kernelClient/kernelChatGateway.ts`). The browser executes them through `executeAIToolCalls(..., 'chat')` inside an agent transaction.
- The transport uses `Authorization: Bearer <token>` for authenticated direct-service requests (`KernelServiceClient.request()` in `src/services/kernelClient/index.ts`), and the browser does not send a bearer token on the production proxy path.
- Transcript moments still use index version `app-transcript-v2`, phrase transcript material, retain source timing in `words`, and collect `getSpeechMarkers` after transcript paging (`src/services/kernelClient/transcriptMoments.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “FlashBoard offers an eligible request to the kernel before constructing the community-provider prompt” → kernel is an explicit `provider === 'kernel'` path; Kie.ai/community chat takes its separate path. A kernel decline does not automatically run the other provider. Evidence: `src/services/flashboard/FlashBoardChatService.ts`.
- “Collection stops at ... 400 accepted transcript words” → `TRANSCRIPT_MOMENT_WORD_CAP` is `Number.POSITIVE_INFINITY`; transcript and marker pages use a 5,000-item page size. Evidence: `src/services/kernelClient/transcriptMoments.ts`.
- “The gateway reads exactly three localStorage entries” → it reads four: `ms.kernel.enabled`, `ms.kernel.token`, `ms.kernel.url`, and `ms.kernel.fallback`. `ms.kernel.fallback === 'true'` is an explicit local calibration opt-in; the default is fail-closed. Evidence: `src/services/kernelClient/kernelChatGateway.ts`; exact-key assertion: `tests/unit/kernelClientIsolation.test.ts`.
- The transaction sequence says commit precedes `/complete`, and that verification failures leave the changed timeline in place → the gateway executes inside a transaction, snapshots and calls `completeRun`, rolls back on transport failure, invalid completion, mismatch, or non-succeeded status, then commits only after verification succeeds. Evidence: `src/services/kernelClient/kernelChatGateway.ts`; mismatch regression: `tests/unit/kernelChatGatewayCutover.test.ts`.
- The fallback table says compile failures, aborts, and local tool failures silently continue through community chat → the gateway returns a handled declined report by default. Only `ms.kernel.fallback === 'true'` makes it return `handled: false`; the current FlashBoard kernel-provider caller then reports the kernel as unavailable rather than selecting another provider. Evidence: `src/services/kernelClient/kernelChatGateway.ts`, `src/services/flashboard/FlashBoardChatService.ts`.
- “The proxy forwards only health, compile, and complete” → those are the non-hosted allowlisted routes, but the proxy first delegates `hosted-agent` paths to `tryHandleHostedAgent`. Evidence: `functions/api/kernel/[[path]].ts`, `functions/lib/hostedAgent/route.ts`.
- “`kernelClientIsolation.test.ts` scans every kernel-client source” → its private-vocabulary scan covers five named files, while the strict import test covers only `index.ts` and `types.ts`. Evidence: `tests/unit/kernelClientIsolation.test.ts`.
- The troubleshooting claim that compile failures are fallback conditions is wrong under the current fail-closed default. Evidence: `src/services/kernelClient/kernelChatGateway.ts`.
- The monitor page at `<service origin>/kernel/monitor` cannot be verified in this client repository; the private server is explicitly out of scope. No client-side evidence found.

## Noteworthy / unusual

- `src/services/kernelClient/hostedAgent/` now contains K0–K3 and Fast V2 browser transport, resume, operation-settlement, and routing modules; the feature doc did not mention this major client capability. `docs/plans/Storyboard-Plan-Mode.md` reports public implementation present but production-canary acceptance pending external evidence (2026-07-30).
- Kernel runs now expose local progress stages and a structured `KernelRunReport`, rendered as pending progress and a run card in FlashBoard. Evidence: `src/services/kernelClient/runProgress.ts`, `src/services/kernelClient/runReport.ts`, `components/panels/flashboard/KernelRunCard.tsx`.
- The gateway can auto-satisfy one declared transcript precondition before recompiling when its caller enables `autoApprove`; FlashBoard enables it. Evidence: `src/services/kernelClient/kernelChatGateway.ts`, `src/services/flashboard/FlashBoardChatService.ts`.
- Rollback has special cleanup for a setup-created composition and can report an honest failure if transaction ownership is lost, rather than claiming a rollback. Evidence: `src/services/kernelClient/kernelChatGateway.ts`.
