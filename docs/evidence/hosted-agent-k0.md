# Hosted Agent K0 feasibility evidence

Date: 2026-07-30
Scope: public repository K0 slice, Cloudflare Pages Function boundary, local D1,
and a controlled upstream fixture. This is not production-canary evidence.

## Decision

**Repository feasibility: pass. Production Kernel Lite canary: no-go until the
external evidence below exists.**

K0 chooses an extension of the existing Cloudflare kernel proxy rather than a
second public origin. The wire contract remains a K0 draft. K1 must not claim a
production hosted-agent loop from this slice alone.

## Proven boundary

- `POST /api/kernel/hosted-agent/turns` requires the authenticated Cloudflare
  user and accepts only `toolExecutionMode: "read-only"` in K0.
- `GET /api/kernel/hosted-agent/turns/:turnId/events` forwards
  `Last-Event-ID`, the D1-bound session/client metadata, and an internal
  assertion. It preserves the upstream SSE content type, cache policy, event
  cursor, session ID, and buffering metadata. Streams have a reconnectable
  55-second lease rather than the old unconditional JSON rewrite and
  240-second request shape.
- `POST /api/kernel/hosted-agent/turns/:turnId/tool-results` validates the
  open-page session and forwards the original JSON bytes. Its 32 MiB guard is
  only a transport abuse limit; it is not a chosen product inline-result
  budget.
- Service-only authorize, settle, and complete routes require both the kernel
  bearer credential and a 120-second HS256 assertion. The assertion binds the
  D1 user, external turn, billing turn mapping, session, open client instance,
  model, provider protocol, K0 protocol version, nonce, accepted maximum spend,
  and the single K0 iteration.
- The new `hosted_agent_k0_turns` row and the existing `ai_chat_turns`,
  `ai_chat_turn_rounds`, and `credit_ledger` rows are cross-checked on every
  service operation. The existing atomic/idempotent hosted-chat settlement is
  reused; K0 does not introduce a second credit ledger.
- A provider decision never completes the turn implicitly. Settlement uses
  `terminalAction: "continue"`; the separate signed `/complete` call records
  `explicit_complete`.
- Provider persistence contains usage fields and a SHA-256 result digest only.
  The Cloudflare K0 route does not persist prompts, unrestricted tool results,
  images, assertion values, or raw provider output.

The assertion requires a dedicated `KERNEL_SERVICE_ASSERTION_SECRET` of at
least 32 characters. It does not silently fall back to `KERNEL_AUTH_TOKEN`.

## Measured controlled-fixture run

Command:

```text
.\node_modules\.bin\vitest.cmd run tests/unit/hostedAgentK0Assertion.test.ts tests/unit/hostedAgentK0Vertical.test.ts --reporter=verbose
```

Result: 2 files, 4 tests passed.

| Measurement | Result |
|---|---:|
| Tool-result JSON at the browser/Cloudflare boundary | 262,410 bytes |
| Exact tool-result bytes forwarded to the upstream fixture | 262,410 bytes |
| Cloudflare-to-origin tool-result egress represented by the fixture | 262,410 bytes |
| Initial + reconnect SSE bodies read by the client | 999 bytes |
| In-process proxy-handler latency for the 262,410-byte tool result | 2.179–3.397 ms across three runs |
| Provider rounds | 1 |
| Kie provider credits reported by the fixture | 1 |
| MasterSelects credits charged | 6 |
| Extra charge on identical settlement replay | 0 |
| D1 spend ledger rows for the round | 1 |
| Explicit terminal marker | `explicit_complete` |

The latency number is an in-process baseline with a controlled upstream, not a
network SLO. It excludes TLS, Cloudflare POP-to-origin transit, the private
kernel, Kie.ai, and model time. The 262,410-byte value is both client ingress to
Cloudflare and one equal-size Cloudflare-to-origin egress; it does not measure
later kernel-to-provider duplication.

The stream fixture emitted ordered IDs `1, 2`. A reconnect with
`Last-Event-ID: 1` reached the upstream unchanged and replayed `2, 3`. Response
content type remained `text/event-stream; charset=utf-8`.

The D1 fixture started with 100 credits. One response reporting one Kie credit
settled to 6 MasterSelects credits through the existing multiplier. Replaying
the same idempotency key and result digest returned the stored settlement with
a 94-credit balance and no second ledger row. A different digest was rejected,
round index 1 was rejected by the D1-bound one-iteration limit, and completion
remained a separate call.

## Redaction result

The vertical test sends unique sentinels in the system prompt, model prompt,
playbook/context, and the 256 KiB tool result. A joined read of the K0 turn,
billing turn, billing round, and ledger proves none of those sentinels or the
large result was stored. The round's replay payload contains only usage,
provider credits, the result digest, and the literal redaction marker
`usage-and-digest-only`.

The proxy returns an allowlisted response-header set; the service assertion is
not reflected to the browser.

## D1 migration smoke

Local Wrangler command:

```text
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local
```

Result: `0015_hosted_agent_k0.sql` applied successfully (4 commands).

A follow-up local query found all three required tables:
`ai_chat_turns`, `ai_chat_turn_rounds`, and `hosted_agent_k0_turns`.
No remote migration or production write was performed.

## External evidence still required

Production Kernel Lite remains a no-go because the repository cannot yet prove:

1. A deployed private kernel implements these hosted-agent paths and does not
   log the service assertion, exact prompts, transcripts, or tool results.
2. The production Cloudflare boundary carries reconnectable SSE across real
   POP/origin infrastructure with the same headers and without buffering.
3. A real Kie.ai round uses the signed callback boundary, reports trusted
   provider usage, and matches the current hosted billing result.
4. Real prompts, flattened history, grouped tool batches, representative
   timeline snapshots, worst-case text results, and image references meet a
   measured payload/egress/latency budget. K0 intentionally does not convert
   the 256 KiB fixture into a product limit.
5. The private runtime has an encrypted access-controlled short-TTL
   session/event store and deletes it after completion, cancellation, failure,
   or lease expiry.
6. Production has separately configured
   `KERNEL_SERVICE_ASSERTION_SECRET`, the hosted-agent origin, and rollback
   controls. No secret value was inspected or written during K0.
7. Cross-boundary cancellation and an in-flight provider failure have real
   operational evidence. D1 already rejects later authorization after local
   cancellation, but origin process termination is not proven here.
8. K1 record/replay proves exact prompt/history, narration, grouped tools,
   editor state, spend, and quality parity against `legacy-direct`.

Until those checks pass, keep `legacy-direct` and Local AI behavior unchanged
and do not enable a hosted-agent canary.
