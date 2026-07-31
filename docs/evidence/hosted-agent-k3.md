# Hosted Agent K3 — canary review and production runbook

Date: 2026-07-30

## Cutover decision

**Controlled K3 evaluator: PASS. Production hosted-agent cutover: NO-GO.**

The repository now contains a fail-closed feature decision, one-flag rollback
proof, bounded redacted telemetry, and an executable five-category parity
evaluator. It still lacks the real production origin, multi-round D1 authority,
encrypted multi-instance session store, actual product routing integration,
production SSE/Kie billing canary, telemetry sink, and a production latency
budget. The evaluator refuses to return `go` while any one is missing.

No Cloudflare setting, D1 row, secret, remote origin, Kie.ai provider, or
production deployment was read or changed during K3.

## Feature flag and routing truth

Server-owned environment inputs:

```text
HOSTED_AGENT_K3_ENABLED
HOSTED_AGENT_K3_CANARY_PERCENT
HOSTED_AGENT_K3_EMERGENCY_ROLLBACK
```

Defaults fail closed: disabled, zero percent, and emergency rollback enabled.
Only the exact combination `ENABLED=true`, a valid percentage, and
`EMERGENCY_ROLLBACK=false` may select a stable cohort, and only after the
caller supplies complete production evidence and a reachable kernel.

Routing invariants:

- managed hosted Kie.ai may enter the stable canary cohort;
- a personal/BYO Kie.ai key always stays on `legacy-direct`;
- Local AI always stays on `local-direct`;
- missing prerequisites or kernel reachability falls back to legacy-direct;
- `HOSTED_AGENT_K3_ENABLED=false` restores every managed Kie.ai cohort to
  legacy-direct without a project migration;
- `HOSTED_AGENT_K3_EMERGENCY_ROLLBACK=true` is an independent kill switch.

These decisions are implemented as leaf modules only. They are deliberately
not wired into FlashBoard while production readiness is false.

## Bounded telemetry

The K3 buffer accepts only fixed metadata:

- event kind and enumerated failure code;
- hosted/direct provider route;
- hashed 24-hex session correlation;
- bounded latency, byte, credit, reconnect, round, and tool-count numbers;
- timestamp.

There are no fields for prompts, narration, transcripts, tool names,
arguments/results, credentials, URLs, images, or arbitrary diagnostics.
Unknown caller properties are not copied. Default retention is one hour,
maximum retention is 24 hours, the default cap is 2,048 events, and the hard
cap is 10,000. The aggregate dashboard exposes counts, p50/p95 latency,
credits, reconnects, and tool totals rather than raw event content.

The current implementation is an in-memory reference buffer with an optional
metadata-only sink. A production telemetry destination and retention policy
still require deployment review.

## Executable parity corpus

`runHostedAgentK3Canary` executes both a legacy and hosted adapter for:

1. timeline read;
2. grouped timeline edit;
3. media analysis;
4. visual verification;
5. long inspect/edit/verify loop.

For every task it compares:

- tool group shape and authoritative success;
- grouped transaction and one-undo-entry contract for mutations;
- final editor-state digest;
- charged credits;
- narration content/order;
- provider round count;
- absolute hosted latency and hosted-minus-legacy overhead.

The returned report contains only task IDs, categories, booleans, fixed failure
codes, blocking reasons, and the final `go`/`no-go` decision. It does not retain
the narration or tool payloads used by the adapters.

K0 measured only an in-process 256 KiB proxy-handler latency of
2.179–3.397 ms and asserted a 2,000 ms controlled ceiling. K3 exposes that as
`source: controlled-k0`, but explicitly rejects it as production latency
evidence. A real POP → origin → Kie.ai task corpus must establish the production
budget.

## How to execute the real canary

1. Deploy the private hosted-agent origin with the K2 event/result/cancel
   contract.
2. Replace the memory session/reference stores with encrypted,
   access-controlled, atomic multi-instance storage and short TTL deletion.
3. Generalize the signed assertion and D1 ledger from K0's single round to the
   K1/K2 server-authoritative iteration limit; verify settlement replay and
   explicit completion in production.
4. Add the authenticated large-result download endpoint.
5. Wire the leaf route decision into the existing provider selector without
   changing BYO or Local behavior.
6. Provide legacy-direct and hosted production adapters to
   `runHostedAgentK3Canary`.
7. Run the complete five-category corpus with real representative project
   fixtures. Supply a latency budget marked `source: production-canary`.
8. Set every `HostedAgentK3ProductionEvidence` field to true only from captured
   operational proof. The report must return:

   ```text
   controlledCorpusPassed: true
   productionEvidenceComplete: true
   rollbackProven: true
   blockingReasons: []
   cutoverDecision: go
   ```

9. Configure the reviewed telemetry sink and retention, then start at a small
   percentage with emergency rollback disabled.
10. Exercise rollback in the deployed environment by setting
    `HOSTED_AGENT_K3_ENABLED=false`; prove that managed Kie.ai returns to
    legacy-direct, BYO remains legacy-direct, Local remains local-direct, and no
    project data migration occurs.

If any parity, billing, replay, latency, privacy, or route-truth check fails,
set `HOSTED_AGENT_K3_EMERGENCY_ROLLBACK=true` and keep the cutover at NO-GO.

## Current external blockers

All eight production-evidence fields remain unverified in this repository:

- private origin deployed;
- real production SSE replay;
- real Kie.ai round plus D1 billing parity;
- multi-round D1 identity/iteration authority;
- encrypted multi-instance session/reference store;
- actual hosted/BYO/Local product routing integration;
- production telemetry sink and retention;
- deployed feature-flag rollback.

Additionally, the current Kie helper still lacks transport-level abort wiring,
and the public hosted-agent start route remains the K0 read-only,
one-iteration feasibility route.
