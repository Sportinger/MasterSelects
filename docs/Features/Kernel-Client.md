# Kernel Client and Auto

## Purpose

FlashBoard exposes the general-purpose prompt path as **Auto**. Its Model menu
contains exactly `Codex Direct` and `Fast`, with Direct selected by default in
development and production. Both runtimes use the same browser-owned atomic
editor-tool catalog and execution boundary.

`Fast` maps to the kernel-owned Normal Path. That path can inspect an editor
snapshot, plan work, call public atomic tools, inspect results or review
frames, and refine work in later bounded rounds. The private kernel owns its
provider prompts, orchestration, sequencing, and Standard backend selection.

`Codex Direct` instead opens an authenticated same-origin WebSocket relay to
the isolated Codex app-server. It does not create a Normal Path turn, page
lease, verifier round, or Logic-mode request. Raw provider names, internal
Logic capability, and the compatibility Very Fast/Fast/Slow model classes are
not exposed as editor controls. The only separate product workflow is Story.

The internal protocol constant `fast-agent-v2` and some `fastV2*` source and
storage names remain compatibility identifiers for existing journals and D1
rows. They do not describe a second product path.

## Ownership boundary

The public editor owns:

- the bounded timeline and project snapshot;
- the flat, digest-pinned atomic tool catalog;
- tool schemas, local policy, authorization, confirmation, transactions,
  undo, deterministic execution, and bounded result projection;
- browser/session binding and the public Cloudflare/D1 relay.

The private kernel owns:

- prompts and provider input;
- tool categories and progressive discovery;
- fast-path selection and intent-to-operation compilation;
- sequencing, retries, result inspection, visual review, and refinement;
- API-versus-Codex backend selection and provider billing callbacks.

See [ADR-001](../architecture/ADR-001-Fast-V2-Kernel-Owned-Orchestration.md)
for the binding architectural rule.

## Public HTTP catalog

The Cloudflare boundary exposes **14 method/path shapes**. Five are the
signed-in browser Normal Path, seven are private service callbacks, and two
are the generic health and Seedance relays.

### Browser and generic routes

| Route | Authentication | Behavior |
|---|---|---|
| `GET /api/kernel/health` | Public | Relays private service readiness. |
| `POST /api/kernel/preproduction/seedance` | Signed-in user | Relays the special Seedance preproduction stage with the authenticated principal. |
| `GET /api/kernel/normal/capabilities` | Signed-in user | Advertises Standard/Logic availability and the single Normal Path execution profile. |
| `POST /api/kernel/normal/turns` | Signed-in user | Validates the bounded request, binds it to the user and page in D1, signs the private envelope, and starts or replays the turn. |
| `GET /api/kernel/normal/turns/:turnId/events` | Owning user and page binding | Relays ordered SSE events and renews the open-page lease. |
| `POST /api/kernel/normal/turns/:turnId/operation-results` | Owning user and page binding | Validates and relays one deterministic atomic-operation result. |
| `POST /api/kernel/normal/turns/:turnId/cancel` | Owning user and page binding | Marks the D1 turn terminal first, then best-effort cancels the private run. |

### Private service callbacks

These same-origin Cloudflare routes require the kernel service bearer plus a
turn-bound assertion. They are not browser APIs.

| Route | Purpose |
|---|---|
| `POST /api/kernel/normal/service/turns/:turnId/rounds/:round/authorize` | Atomically authorize one provider round. |
| `POST /api/kernel/normal/service/turns/:turnId/rounds/:round/settle` | Settle provider usage for one authorized round. |
| `POST /api/kernel/normal/service/turns/:turnId/rounds/:round/authorize-replay` | Reconcile a previously recorded authorization. |
| `POST /api/kernel/normal/service/turns/:turnId/rounds/:round/settle-replay` | Reconcile a previously recorded settlement. |
| `POST /api/kernel/normal/service/turns/:turnId/complete` | Complete a turn after settled work. |
| `POST /api/kernel/normal/service/turns/:turnId/complete-replay` | Reconcile an already recorded completion. |
| `POST /api/kernel/normal/service/turns/:turnId/fail` | Release reservations and fail the turn safely. |

There is no public V1 compatibility route. `/api/kernel/compile`,
`/api/kernel/runs/:runId/complete`, `/api/kernel/hosted-agent/*`, generic tool
result posting, and deferred operation settlements are removed and return
`404`.

### Codex Direct relay

`GET /api/direct-codex/ws` is a separate WebSocket boundary rather than one of
the 14 Normal Path method/path shapes. Cloudflare requires an allowed Origin
and a signed-in session, binds the authenticated user principal, injects the
server-side kernel credential, and relays to `/kernel/direct-codex/ws`. The
private relay validates that credential, bounds message and connection counts,
and is the only component allowed to connect to the loopback Codex app-server.
Before each Codex Direct turn, the kernel checks the user's prompt with content
moderation. Requests flagged for sexual, hateful, harassing, illicit, violent,
or self-harm instruction content are rejected with a message in the chat. The
kernel logs the rejection category, authenticated principal, time, and the
Cloudflare client IP for abuse investigation, without logging the prompt text.
If moderation is unavailable, the turn is rejected until it can be checked.
The `dev:full` and `dev:lan` WebSocket proxy also goes through this kernel
relay, using a local development principal and the connecting socket address.

## Auto lifecycle (internal Normal Path)

1. The signed-in browser reads `GET /api/kernel/normal/capabilities`.
2. It captures one revision-bound semantic snapshot and a digest-pinned flat
   catalog of allowed atomic tools.
3. `POST /api/kernel/normal/turns` creates the D1 billing/session binding and
   forwards a signed envelope to the private kernel.
4. The Intelligence Module selects the configured Standard backend according
   to server policy. Internal Logic compatibility remains kernel-owned but is
   not requested by the editor UI.
5. The kernel plans the next bounded action. A private fast path may compile
   directly to explicit public operation-plan steps; otherwise the model can
   browse categories and select atomic tools.
6. The editor revalidates every operation, executes it transactionally, and
   posts the projected result.
7. The kernel adds results, retryable errors, and captured review grids back to
   the next provider round. It may inspect, correct, or refine the edit until
   completion or the iteration/spend bound.
8. SSE emits narration, operation requests, billing settlement, and the final
   terminal event. Reload resume is accepted only when the persisted request,
   cursor, page binding, and canonical timeline checkpoint still match.

### Editable motion-graphic fast path

For a focused animated lower-third request, Fast can expose the private
`createEditableMotionGraphic` capability. It accepts semantic content, style,
placement, entrance, exit, and temporal-review intent, then compiles one bound
editor plan: hook preflight, native hook commit, and six-frame review capture.
The public editor receives only the allowed operations and creates text,
Motion backplates, and keyframes through its normal transaction and undo
boundary. See [Editable Motion Graphics](./Editable-Motion-Graphics.md).

The current hook preview operation is a revision-bound preflight. A truthful
shadow-rendered, digest-bound pre-commit preview remains future work; the
current temporal grid reviews the atomic committed result.

Planning is a request mode (`normal`, `plan`, or `read-only`) inside Normal
Path, not a separate route. `plan` may produce an explicit plan without
committing a mutation; `read-only` forbids mutation locally.

## Failure and security rules

- The browser cannot select a raw private provider or model ID. The editor UI
  exposes only `Codex Direct` and `Fast`; compatibility model-class and Logic
  fields are not presented as user-facing routes.
- Production Direct requires an allowed Origin and a signed-in session at the
  public relay, then a server-injected kernel credential and bounded principal
  at the private relay. The browser never receives either server credential.
- Every mutation is checked again by the editor; a kernel assertion never
  bypasses local tool policy or transaction ownership.
- D1 cancellation is authoritative before origin notification.
- A stale revision, state fingerprint, cursor, catalog digest, page lease, or
  client/session binding fails closed.
- Provider billing authorization and settlement are idempotent per turn and
  round.
- Capability-specific provider tools are included only when the request carries
  the matching server-validated execution context. General and read-only turns
  cannot receive a direct-edit capability by catalog accident.
- Retryable orchestration failures keep the run open while retry budget remains;
  the root becomes terminal only after the bounded attempts are exhausted.
- Media bytes stay in the editor unless an explicitly bounded reference is
  included in the request.

## Development topology

| Component | Default address |
|---|---|
| Editor and bridge | `http://localhost:5173` |
| Private kernel | `http://127.0.0.1:8787` |
| Local Cloudflare/D1 relay | `http://127.0.0.1:8788` |
| Codex app-server used by Direct and internal Logic | `ws://127.0.0.1:4500` |

Production Fast uses the same-origin `/api/kernel/*` Cloudflare boundary.
Production Direct uses `/api/direct-codex/ws`, which relays through the private
kernel origin configured by `KERNEL_ORIGIN` to the loopback-only app-server.
