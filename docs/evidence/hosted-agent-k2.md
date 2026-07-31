# Hosted Agent K2 — controlled reliability evidence

Date: 2026-07-30

## Scope and decision

K2 is implemented as an additive hosted-agent reference path. It does not
enable hosted-agent execution in the product UI and does not modify
FlashBoard, Storyboard, or the central semantic-tool registries.

Controlled K2 implementation gate: **PASS**.

Production canary gate: **NO-GO until the K3 gaps below are closed**.

## Implemented guarantees

- Ordered narration and tool events are retained in a protected short-TTL
  session store and replayed from the last event cursor.
- The page lease is bound to `clientInstanceId`, held only in the live client
  adapter, and forwarded as an opaque header. A different tab or a new page
  without that lease cannot resume.
- The in-page ledger keys grouped editor work by `(sessionId, sequence)`.
  Concurrent/replayed delivery shares or returns the recorded complete batch;
  skipped and reordered mutating sequences fail closed.
- The client records the complete grouped result before posting it. A lost
  result response causes an identical retry, not a second editor execution.
- The server records one batch digest. Identical posts replay; conflicting
  replacements fail closed.
- Cancellation aborts provider/tool waits and prevents later provider
  authorization. If an already-authorized provider transport cannot abort, its
  completed response is settled honestly before the runtime stops without
  emitting tools or authorizing another round.
- A tool already executing may finish and post its authoritative result after
  cancellation, but the kernel does not continue the model loop.
- Full reload settles the live client as `interrupted`. Failure to deliver the
  unload request is covered by lease expiry; there is no persisted client
  ledger or cross-page takeover.
- Binary image/audio/video results use short-lived opaque `har_*` references.
  Data URLs in result batches are rejected. Current large text tool results
  remain allowed under the measured 32 MiB transport abuse ceiling.
- Diagnostics contain event kind, cursor, sequence, status, timing, and byte
  counts only. They exclude prompts, history, credentials, narration text,
  tool arguments/results, Data URLs, and binary bytes.
- The public proxy forwards the page lease but never reflects service
  assertions. D1 cancellation happens before the best-effort kernel-origin
  cancel notification.

## Controlled measurements and tests

- Disconnect before each event cursor: injected once for every cursor.
- Disconnect after each event: every replay response is limited to one event.
- Disconnect before result posting: injected.
- Disconnect after result acceptance but before acknowledgement: injected.
- Duplicate event and result delivery: injected.
- Editor executions for the grouped batch across all reconnects: `1`.
- Provider authorizations/settlements for the two-round replay: `2 / 2`.
- Large inline text fixture: greater than 256 KiB.
- Binary-reference fixture: approximately 680 KiB.
- Short-TTL load fixture: 100 terminal sessions, all purged after expiry.

Commands:

```text
vitest K2 reliability/security: 2 files, 12 tests passed
hosted-agent/billing/redaction/N0 regression: 13 files, 51 tests passed
tsc -p tsconfig.app.json --noEmit: passed
tsc -p tsconfig.functions.json --noEmit: passed
focused ESLint for hosted-agent implementation and tests: passed
```

## Deliberately open K3 / production gaps

1. The public start route is still the K0 read-only, one-iteration feasibility
   route. It does not start the K2 runtime or accept mutating K1 sessions.
2. The K0 D1 assertion/turn table still carries the one-iteration K0 protocol.
   Multi-round K2 identity, billing, and terminal-state storage require a
   separately reviewed D1 migration and production origin integration.
3. This repository contains the in-memory reference session/large-result
   stores. A multi-instance production origin needs an access-controlled,
   encrypted, short-TTL store with atomic event/result operations and an
   authenticated large-result download endpoint.
4. The public proxy forwards cancel best effort after authoritative D1
   cancellation. The matching production kernel-origin cancel endpoint is not
   deployed or exercised here.
5. The current Kie provider helper has no transport-level `AbortSignal`
   parameter. K2 safely prevents later work and settles a completed
   non-abortable round, but a real upstream cancellation optimization remains.
6. The exported fetch/client adapter is intentionally not wired into
   FlashBoard or the N0 activity UI in this lane.
7. D1 currently records reload interruption through the existing cancellation
   state rather than a distinct durable `interrupted` status. The live K2
   session and client surface do distinguish it.
8. No real Kie credential, private kernel deployment, production SSE boundary,
   multi-instance load, or authenticated binary download canary was run.
9. Feature-flagged hosted/BYO/Local routing, operational telemetry,
   representative-corpus latency budgets, and one-flag rollback are K3.
