# Credit Burn Counter — Implementation Plan

Status: Reviewed implementation plan — ready for Phase 0
Date: 2026-07-31
Scope: Authenticated MasterSelects workspace, all hosted-AI credit consumers
Review: Completed by Claude Opus 5; findings incorporated below

## Purpose

Replace the static toolbar credit pill with a truthful, always-visible credit reserve meter that makes confirmed AI spend materially visible while an AI operation is running.

The shipped experience combines all four approved motion layers:

1. an always-visible reserve bar;
2. an odometer-style balance countdown with directional motion blur;
3. a particle drain from the balance toward the active AI surface;
4. an active-run spend readout plus a short settlement heat pulse.

The feature must feel dramatic without presenting an estimate as an authoritative balance, double-counting replayed billing events, shifting toolbar layout, or creating continuous idle rendering work.

## Product Decision

### Resting state

For an authenticated user, the meter is always present in the right side of the main toolbar. “Always” means that the reserve bar remains visible both while AI is idle and while AI is active. Signed-out users continue to see the existing `Sign in` surface rather than a synthetic zero-credit meter.

```text
[ CREDITS   2,468   RUN — ]
  ███████████████░░░░░░░░░    ← 2–3 px inset underline
```

The whole meter remains a 28 px-high button and continues to open the Account dialog. The reserve bar is an absolutely positioned 2–3 px inset underline inside that existing height, not a second toolbar row.

### Active state

Starting a hosted-AI operation changes content without changing the meter's outer width or height. A fixed CSS grid permanently reserves the run-status column, so the Account trigger and `NativeHelperStatus` do not shift when AI begins or settles. The bar remains visible and an aggregate confirmed run cost appears.

```text
[ AI ACTIVE   2,468   RUN −0 ]
  ███████████████░░░░░░░░░    ← same reserved footprint
```

At constrained widths, responsive content may shorten `CREDITS` to `CR` and `2 ACTIVE` to `2×`, but idle/active transitions still use the same reserved footprint. The toolbar remains at its existing 28 px height.

On every confirmed debit:

- changed digit columns roll downward like a mechanical odometer;
- outgoing glyph copies stretch downward with low-opacity motion trails;
- the bar eases to its new authoritative fill;
- a warm leading-edge pulse travels across the amount and bar;
- a bounded group of particles carries a small `−N` cue toward the active AI surface;
- `RUN −N` increases by the confirmed settlement delta.

After the final operation ends, the run total remains readable for 1.5 seconds, then the meter returns to its resting density while retaining the bar.

### Multiple simultaneous operations

The toolbar represents the account, not one panel. When hosted operations overlap:

- `RUN −N` is the aggregate confirmed spend of all currently active credit activities;
- the label becomes `2 ACTIVE`, `3 ACTIVE`, and so on;
- each settlement may target the registered surface belonging to that activity;
- if a target is hidden or unmounted, the particle motion terminates inside the meter instead of crossing to an unrelated panel;
- the active session does not end until the last tracked activity is terminal.

The Account dialog may later expose per-operation detail, but that is outside this implementation.

## Truth and Billing Contract

### Non-negotiable rule

Only a server-confirmed ledger debit may lower the displayed balance or increase `RUN −N`.

MasterSelects must not estimate token burn from elapsed time, narration length, streamed characters, model choice, or an advertised maximum. While a provider round is still running, the meter may shimmer and show `AI ACTIVE`, but its digits remain unchanged until settlement.

This means “live” is defined as **immediately after each authoritative billing settlement**, not as a fabricated decrement every second. Some single-round operations will therefore animate once, near completion. Multi-round hosted-agent turns can animate after every settled provider round.

### Current baseline

The current code already provides most of the authoritative data path:

- `functions/lib/hostedAgent/k1Runtime.ts` settles every provider round before continuing;
- the settlement response contains `creditBalance`, `creditsCharged`, `roundIndex`, and `totalCreditsCharged`;
- `HostedChatRoundSettlement` exposes a stable `ledgerEntryId` inside `functions/lib/chatBilling.ts`, but `settleHostedAgentK0Round`, `HostedAgentRoundSettlementResponse`, and `HostedAgentK1BillingPort.settleRound` currently drop it before it can reach the runtime event contract;
- K2 hosted-agent events are persisted, ordered, replayed after reconnect, and consumed through a cursor;
- `HostedAgentEvent` currently reports the aggregate `creditsCharged` only on `turn-complete`;
- `FlashBoardHostedAgentTransport` currently consumes narration and terminal events but does not receive a per-round balance event;
- the generic JSON AI gateway exposes optional `creditBalance` and `creditsCharged`, but no stable credit-mutation id;
- the hosted speech binary path currently exposes only `X-MasterSelects-Credit-Balance`, with no charge delta or mutation id;
- other hosted AI paths call `applyHostedCreditBalance` for both mutations and non-mutating reads/status polls, so a balance-bearing response alone cannot be treated as a debit.

### New hosted-agent event

Add an additive event variant to `HostedAgentEvent`:

```ts
{
  kind: 'billing-settled';
  eventId: string;
  sessionId: string;
  turnId: string;
  roundIndex: number;
  creditsCharged: number;
  totalCreditsCharged: number;
  creditBalance: number;
  ledgerEntryId: string | null;
}
```

Rules:

- emit it immediately after `settleRound` succeeds and before the post-settlement abort check;
- emit zero-cost settlements for protocol consistency, but do not trigger debit motion for them;
- propagate `ledgerEntryId` through `HostedChatRoundSettlement` → `settleHostedAgentK0Round` → `HostedAgentRoundSettlementResponse` → the HTTP settlement adapter → `HostedAgentK1BillingPort.settleRound` before constructing the event;
- retain `creditsCharged` on `turn-complete` and use it as the authoritative final per-turn total;
- aggregate agent activity spend as `max(previousTotal, totalCreditsCharged)` rather than summing round deltas, making replay and terminal reconciliation idempotent;
- namespace mutation identities as `${kind}:${ledgerSource}:${ledgerEntryIdOrSourceId}`;
- when a debit has no ledger entry, use `debit:hosted:ai_chat:${hostedAgentRoundIdempotencyKey(turnId, roundIndex)}` instead of inventing another round-key format;
- refunds and settlement compensations use a positive kind/source namespace, because they can share an underlying round `source_id` with the debit and must never collide with it;
- let the existing K2 event log and cursor replay the event; do not create a second ad-hoc SSE or polling channel.

Emitting before the abort check matters: a provider may finish chargeable work after cancellation was requested. That settled work must still reach the UI before the turn becomes canceled or interrupted.

The current K2 client cancels and throws as soon as its caller signal is aborted. Phase 1 must therefore add one bounded post-cancel replay using an independent signal. That drain processes only `billing-settled` and terminal accounting events; it must never execute a queued `tool-batch-request` after the user canceled. If the drain cannot complete, terminal account reconciliation restores the balance, but the run label may only claim the reconciled authoritative turn total.

### Balance concurrency and reconciliation

Several hosted operations can settle close together, and their network responses can arrive out of order. A late debit response must never make the visible balance rise.

For debit updates:

- deduplicate by the namespaced ledger identity or deterministic fallback mutation id;
- apply the lowest confirmed balance seen during the active debit window;
- record a hosted-agent activity's spend as the maximum authoritative `totalCreditsCharged` seen for its turn, including the final total on `turn-complete`;
- record non-agent one-shot spend once only when both a server-confirmed delta and a stable mutation id exist;
- never infer the activity delta from `previousBalance - nextBalance` when the server supplies `creditsCharged`;
- debounce one authoritative account refresh after all active operations become terminal;
- allow that refresh to reconcile concurrent refunds, grants, another tab, and any stale response snapshot.

The settlement `creditBalance` is a whole-account `SUM(amount)` snapshot taken after settlement, not necessarily that round ledger row's `balance_after`. It may already include spend from another operation or tab. Therefore the visible balance drop can legitimately be larger than the current activity's `RUN −N`; the run label follows the activity total, while the digits follow the accepted whole-account balance.

Balance-only responses, account loads, capability/model/voice reads, and status polls are `reconcile` updates. They may correct the exact balance and bar but never create debit particles, a `−N` cue, or additional run spend. An account-load error or the store's temporary/default zero must likewise never animate as a full drain.

If a settlement arrives before account initialization completes, queue it behind the initial authoritative account state or accept its server balance as a non-animated bootstrap. Never apply the debit-only `min` rule against the store's default `0`.

Positive mutations such as grants and refunds do not use the debit-only `min` rule. They update from their authoritative response and use a separate positive animation. A failed-task refund animates only when the response says `refunded: true`; an idempotent replay with `refunded: false` reconciles silently. The final account refresh remains the convergence point.

### Permanent bar reference

A credit balance has no hard storage ceiling, so the bar must not silently pretend that `monthlyCredits` is an absolute maximum. Add `creditMeterReference` to the account/billing summary response.

The server defines a current credit-pool epoch beginning at `subscription.currentPeriodStart` when available, otherwise at the latest recurring monthly-plan grant, otherwise at the latest grant. It computes the reference as:

```text
max(
  current credit balance,
  plan monthly credits,
  MAX(balance_after) for entry_type = 'grant' inside the current pool epoch
)
```

Refunds and settlement compensations are positive `adjustment` rows and are deliberately excluded; otherwise a small refund after heavy spending would reset the meter close to 100%. The epoch prevents a historical high-tier plan from depressing the bar forever after a later downgrade. This supports gift credits above a plan allowance and moves the reference upward when a new grant establishes a larger pool.

Existing ledger helpers compute `balance_after` using a read-then-insert path, so concurrent grants can leave a stale snapshot. The reference query is presentation-only and must tolerate that by always including the exact current `SUM(amount)` balance. Phase 0 must fixture concurrent grants and decide whether the existing ledger append path needs separate atomic hardening; the meter must not be presented as financial quota enforcement.

The client uses `max(serverCreditMeterReference, creditBalance)` so a newly received grant cannot leave the reference temporarily below the visible balance before the next summary refresh. The bar fill is `clamp(creditBalance / effectiveReference, 0, 1)`. When the reference is zero, show an empty bar rather than dividing by zero. The Account tooltip must state both values and describe the reference as the current refill/high-water level; it must not label the meter as a monthly quota.

## Frontend Architecture

### One authoritative balance, separate ephemeral motion

Keep `useAccountStore().creditBalance` as the only application-level balance. Do not store a second durable “animated balance.”

Introduce a small coordinator and an ephemeral activity store:

```text
server settlement / hosted response
              │
              v
CreditBalanceCoordinator
      │                 │
      v                 v
accountStore       creditActivityStore
(truth)            (ephemeral motion intent)
      │                 │
      └────────┬────────┘
               v
       CreditBurnMeter UI
```

Suggested responsibilities:

#### `creditBalanceCoordinator.ts`

- accept normalized credit updates from hosted-agent events and existing hosted AI responses;
- deduplicate stable mutation ids for the current browser session;
- apply debit-safe balance ordering;
- update `accountStore` exactly once per accepted update;
- preserve the existing mirror into `billingSummary.creditBalance` so the toolbar and Account dialog cannot diverge;
- emit an ephemeral visual settlement only after the update is accepted;
- suppress decorative settlement when the accepted update is bootstrap/reconcile-only or produces no visible balance change;
- schedule/debounce terminal account reconciliation;
- clear user-bound state on logout or account identity change.

Suggested normalized update:

```ts
interface ConfirmedCreditUpdate {
  activityId?: string;
  activityTotalCredits?: number;
  balance: number;
  credits: number;
  kind: 'debit' | 'grant' | 'refund' | 'reconcile';
  mutationId: string;
  source: string;
}
```

#### `creditActivityStore.ts`

- track active credit-consuming operations by stable activity id;
- retain feature label, lifecycle status, optional DOM target id, start time, and confirmed spend;
- for hosted-agent turns, replace confirmed spend with `max(current, activityTotalCredits)` rather than adding replayable round deltas;
- expose aggregate active count and confirmed spend;
- queue short-lived visual settlement records;
- mark records consumed without losing account truth;
- cap retained mutation ids and visual records to prevent unbounded session memory.

Suggested activity lifecycle:

```ts
beginCreditActivity({ id, feature, targetId? });
recordConfirmedCreditUpdate(update);
endCreditActivity({ id, status: 'completed' | 'failed' | 'canceled' });
```

#### Existing `applyHostedCreditBalance`

Do not leave callers split between animated and non-animated updates indefinitely. Keep `applyHostedCreditBalance(number)` temporarily as a reconciliation-only compatibility wrapper, preserving its current update of both `creditBalance` and `billingSummary.creditBalance`, then migrate confirmed debit/refund call sites to the coordinator. Add a development warning or test that prevents new credit-consuming paths from bypassing the coordinator.

### Initial integration coverage

Phase 0 must first make non-agent mutations distinguishable from reads:

- add an optional stable `creditMutationId` (ledger entry id or echoed idempotency identity) to `CloudAiGatewayEnvelope`; its existing `creditsCharged` is not sufficient for replay-safe motion by itself;
- add `X-MasterSelects-Credits-Charged` and `X-MasterSelects-Credit-Mutation-Id` to charged binary responses such as hosted speech;
- classify a response with `creditBalance` but no positive delta/stable id as `reconcile`, never as motion;
- never derive debit motion from models, voices, capabilities, account/bootstrap reads, or repeated job-status polls;
- animate failed-task refunds only from a unique ledger identity with `refunded: true`.

The first implementation is complete only when these categories behave consistently:

| Credit consumer | Activity begins | Debit motion requires | Reconcile-only sources | Activity ends |
|---|---|---|---|---|
| Hosted FlashBoard agent chat | accepted hosted session | `billing-settled` with stable identity and cumulative turn total | terminal/account refresh | terminal hosted-agent event after bounded cancel drain |
| Hosted single-response chat/refine | request accepted | positive delta plus stable gateway mutation id | balance-only or error response | success, failure, or abort |
| Hosted image/video generation | job/request accepted | authoritative upfront/settled delta plus stable mutation id | status polls and duplicate job responses | job terminal state |
| Hosted speech/music generation | job/request accepted | positive delta and mutation-id response/header | balance-only header or capability read | job terminal state |
| Hosted transcription | request accepted | positive delta plus stable response/header id | balance-only response/header | success, failure, or abort |

When a provider cannot report an intermediate settlement, the meter still enters `AI ACTIVE`, but the numeric animation waits for its authoritative response.

### Destination anchors

AI surfaces that want cross-screen particle motion register a stable anchor, for example:

```html
<section data-credit-activity-anchor="activity-id">...</section>
```

The visual layer resolves the bounding rectangle only when a settlement begins. It does not poll layout. If the target is absent, offscreen, in another window, or farther than the configured safe distance, use the local fallback animation inside the toolbar.

## Component Design

Extract the current inline pill into:

- `src/components/common/CreditBurnMeter.tsx`
- `src/components/common/CreditBurnMeter.css`
- `src/components/common/useCreditBurnAnimation.ts`
- `src/services/credits/creditBalanceCoordinator.ts`
- `src/stores/creditActivityStore.ts`

`Toolbar.tsx` should stop selecting `creditBalance` directly, select only the authentication/account actions it still owns, and render the component. `CreditBurnMeter` selects its own narrow account/activity slices. The component owns display formatting and accessibility; the animation hook owns finite visual transitions; the store/coordinator own no DOM nodes.

The component keeps the existing 28 px outer height. Use a fixed-width CSS grid for label, numeric value, and permanently reserved run/status slot, with the bar absolutely inset along the bottom edge. Active, idle, and terminal-hold states must not change the component's measured outer size.

### Odometer

- render fixed-width digit columns with `font-variant-numeric: tabular-nums`;
- animate only columns that changed;
- keep separators static and locale-aware;
- use transform/opacity ghost glyphs for directional blur instead of a large live `filter: blur()` on the entire toolbar;
- duration scales sublinearly with the debit and is clamped to 450–1,200 ms;
- large drops may skip intermediate integers, but the final rendered number must be exact;
- a newer settlement may coalesce into an active animation rather than creating a long queue;
- never mutate the account-store value frame by frame.

### Reserve bar

- always visible for authenticated users;
- uses the server-provided `creditMeterReference`;
- uses the same authoritative start/end values as the digits;
- renders as a 2–3 px underline inside the existing 28 px pill rather than increasing toolbar height;
- includes a bright moving debit edge only during settlement;
- changes from neutral/cool to amber below 25% and critical red below 10%;
- color is supplemental; geometry and text still communicate the state;
- no looping animation while idle.

### Particle drain

- create a maximum of 6–8 pooled particles per coalesced settlement;
- include one readable `−N` cue near the origin; do not repeat the amount on every particle;
- use a compositor-only curved transform and opacity fade;
- begin at the value/bar edge and travel toward the registered AI anchor;
- terminate before covering the active AI text or controls;
- fall back to a short downward/inward drain if the target cannot be resolved;
- do not mount a permanent full-screen canvas or run a persistent animation loop.

### Run label and heat pulse

- show confirmed aggregate spend only;
- show `RUN −0` while work is active but no settlement is known;
- use `LAST −N` during the 1.5-second terminal hold;
- for overlapping work, show the active count and aggregate spend;
- keep the run/status slot permanently width-reserved even when its idle text is visually absent;
- reset only after the last active operation is terminal and the hold completes;
- a failed or canceled operation retains its confirmed spend during the hold;
- zero-cost operations end without a fake debit pulse.

### Positive balance changes

Refunds and grants use a quieter inverse treatment:

- digits roll upward;
- the bar refills;
- a cool green `+N REFUND` or `+N CREDITS` cue appears briefly;
- particles do not fly toward an AI consumer;
- reduced-motion rules still apply.

## Motion State Machine

```text
IDLE
  └─ begin activity ─> ACTIVE_WAITING

ACTIVE_WAITING
  ├─ confirmed debit ─> SETTLING ─> ACTIVE_WAITING
  ├─ another activity ─> ACTIVE_WAITING (count +1)
  └─ last activity terminal ─> TERMINAL_HOLD

TERMINAL_HOLD
  ├─ new activity ─> ACTIVE_WAITING
  └─ 1.5 s elapsed ─> IDLE

Any state
  ├─ grant/refund ─> POSITIVE_SETTLEMENT ─> previous logical state
  ├─ logout/account switch ─> RESET
  └─ hidden tab/reduced motion ─> apply exact state without decorative travel
```

The logical activity state and the decorative animation state remain separate so an interrupted CSS/WAAPI animation cannot lose or alter a debit.

## Accessibility and User Control

- preserve the component as a keyboard-focusable button opening Account;
- provide a stable `aria-label`, for example: `2,468 credits available. 12 credits used by active AI operations.`;
- announce confirmed settlements through one visually hidden `aria-live="polite"` region, never for every animation frame;
- coalesce announcements that arrive within 500 ms;
- under `prefers-reduced-motion: reduce`, update digits and bar immediately, remove particles, blur trails, shimmer, and heat travel, but retain exact text and the persistent bar;
- stop decorative motion when `document.hidden` and reconcile immediately on visibility restore;
- do not convey low balance with color alone;
- maintain visible focus styling and current Account tooltip behavior;
- keep the final number selectable by assistive technology even though visual digit columns are decorative.

## Performance Budgets

- zero meter-owned `requestAnimationFrame` loops while idle; the existing unrelated toolbar/project polling is outside this feature's budget;
- no layout reads except once at the beginning of a particle settlement;
- at most one overlay layer and eight particles for a coalesced event;
- transform and opacity are the primary animated properties;
- `will-change` exists only while motion is active;
- no toolbar-wide CSS filter or backdrop invalidation;
- cap queued visual settlements and immediately converge after background-tab throttling;
- animation code must not subscribe the whole `Toolbar` to per-frame state.

## Implementation Phases

### Phase 0 — Lock contracts and fixtures

- define the normalized credit update and activity lifecycle contracts;
- define the current credit-pool epoch and add `creditMeterReference` to `CloudMeResponse`/`BillingSummaryResponse` as appropriate;
- add `billing-settled` to `HostedAgentEvent` and server payload types;
- add `ledgerEntryId` to every hosted-agent settlement contract/adapter between `HostedChatRoundSettlement` and the K1 runtime;
- extend charged JSON/binary AI responses with a stable mutation identity and charge delta, then inventory every balance-bearing read/poll as reconcile-only;
- define per-turn cumulative-max semantics for hosted-agent run spend and namespaced identity semantics for debit/refund/compensation;
- add fixtures for single-round, multi-round, zero-cost, cancellation-after-settlement, lost-cursor replay, concurrent debit, settlement compensation, refund replay with `refunded: false`, concurrent grants, and account-load failure/default zero;
- keep protocol changes additive and backwards compatible.

Exit gate: type-level and contract tests prove old terminal events still parse, new settlement events serialize/replay, and no known read/poll path can be mistaken for a credit mutation.

### Phase 1 — Emit authoritative live settlements

- return `ledgerEntryId` through the hosted-agent billing port and HTTP settlement adapter;
- emit `billing-settled` after every successful provider-round settlement;
- ensure K2 persistence/replay keeps ordering and ids;
- add a bounded settlement/terminal-only replay after user cancellation without executing queued tool batches;
- handle the event in `FlashBoardHostedAgentTransport`;
- pass it into the credit coordinator before subsequent tool execution or terminal UI cleanup;
- feed `turn-complete.creditsCharged` into the same per-turn cumulative-max path as the final authoritative total.

Exit gate: a multi-round hosted-agent fixture produces non-decreasing cumulative settlement totals before `turn-complete`, including after reconnect/lost cursor and after cancel, with no duplicate debit or post-cancel tool execution.

### Phase 2 — Add coordinator and activity lifecycle

- implement update normalization, deduplication, debit ordering, and terminal reconciliation;
- instrument activity begin/end in hosted agent, chat/refine, generation, speech/music, and transcription flows;
- migrate authoritative balance response call sites from the compatibility setter;
- keep `billingSummary.creditBalance` mirrored with the top-level balance;
- gate bootstrap/default/error/reconcile updates so they never animate as spend;
- handle account switch, logout, refresh, abort, failure, refund replay, and positive settlement compensation;
- expose selectors that do not rerender unrelated consumers.

Exit gate: parallel operations and out-of-order responses converge to the server balance, while every unique settlement contributes once to the correct run total.

### Phase 3 — Build the permanent meter and motion

- extract `CreditBurnMeter` from `Toolbar`;
- implement the fixed-footprint 28 px grid, responsive labels, and permanent 2–3 px reserve underline;
- implement odometer, motion trails, heat pulse, run label, and particle pool;
- add anchor registration and local fallback motion;
- add positive settlement treatment;
- add reduced-motion and hidden-tab behavior.

Exit gate: component tests and real-browser visual checks cover rest, active waiting, settling, concurrent, low balance, zero balance, refund, reduced motion, and narrow toolbar states.

### Phase 4 — Harden, document, and release

- run unit, hosted-agent vertical, K2 replay/security, UI, build, and lint checks relevant to changed files;
- capture before/after screenshots plus a short real-browser recording of a multi-round turn;
- verify 100%, 125%, 150%, and 200% interface/browser zoom;
- verify dark theme, narrow window, hidden FlashBoard, account dialog click, and keyboard focus;
- document the billing truth contract and the difference between active work and confirmed spend;
- add a changelog entry only after all release gates pass.

Exit gate: no balance mismatch, duplicate animation, persistent idle work, or inaccessible motion remains in the release evidence.

## File-Level Change Map

Expected primary files; exact boundaries may be adjusted to match adjacent refactors already in the worktree.

| Area | Expected files |
|---|---|
| Hosted event contract | `src/services/kernelClient/hostedAgent/contracts.ts` |
| Hosted round emission/adapter | `functions/lib/hostedAgent/k1Runtime.ts`, `functions/lib/hostedAgent/billing.ts`, `functions/lib/hostedAgent/route.ts`, `functions/lib/hostedAgent/k2Session.ts` as required by the current adapter path |
| Replay/client consumption | `src/services/kernelClient/hostedAgent/k2Client.ts`, `src/services/flashboard/FlashBoardHostedAgentTransport.ts` |
| Account API contract/reference | `functions/lib/credits.ts`, billing/account response builders, `src/services/cloud/apiContracts.ts` |
| Credit coordination | `src/services/credits/creditBalanceCoordinator.ts`, `src/stores/accountStore.ts`, `src/stores/creditActivityStore.ts` |
| Toolbar UI | `src/components/common/Toolbar.tsx`, `src/components/common/CreditBurnMeter.tsx`, `src/components/common/CreditBurnMeter.css`, `src/components/common/useCreditBurnAnimation.ts` |
| Other hosted consumers/contracts | `src/services/cloudAiService.ts`, `functions/api/ai/*` response builders, hosted transcription paths, FlashBoard generation/refine controllers and job lifecycle adapters |
| Tests | hosted-agent K1/K2 tests, credit coordinator/store tests, `CreditBurnMeter` component tests, browser visual evidence |
| Docs | this plan, the relevant billing/FlashBoard feature docs, changelog after completion |

## Test Matrix

### Billing and protocol

- one round with a positive debit emits one `billing-settled` before terminal completion;
- multiple tool rounds emit non-decreasing `totalCreditsCharged`, including zero-delta rounds;
- a zero-credit round does not trigger debit motion;
- a post-provider cancellation drains an already-confirmed settlement without executing a queued tool batch;
- replaying the same event id and ledger entry does not charge or animate twice;
- replay from a lost/null cursor converges through cumulative-max turn spend;
- `turn-complete.creditsCharged` reconciles the final per-turn maximum without creating a duplicate visual update;
- failed settlement emits no debit event;
- a compensated unproven settlement produces no debit motion and its positive adjustment cannot collide with the debit identity;
- balance-bearing models/voices/capabilities/status-poll responses reconcile without debit motion;
- the permanent meter reference survives reload, gift credits above the plan allowance, refunds after heavy spend, concurrent grants, and a later plan downgrade.

### Coordinator and concurrency

- late higher balance snapshots cannot visually restore credits after a newer debit;
- two simultaneous activities receive their own spend while the aggregate remains exact;
- terminal reconciliation corrects concurrent cross-tab spend;
- refund/grant updates can increase the balance without being rejected by the debit ordering rule;
- `refunded: false` replay reconciles silently and does not replay positive motion;
- default zero and account-load failure never animate as spend;
- balance and `billingSummary.creditBalance` remain mirrored;
- logout and account switch clear activity and dedupe state;
- bounded event retention cannot grow without limit.

### UI and motion

- idle authenticated, active waiting, settlement, terminal hold, and signed-out states;
- digit carry across `9 → 8`, `10 → 9`, `1,000 → 999`, and large deltas;
- locale separators remain stable and do not roll as digits;
- bar fill at 100%, 25%, 10%, 0%, and zero reference;
- particle target present, absent, hidden, and unmounted during flight;
- overlapping settlements coalesce and still land on the exact final value;
- positive refund/grant animation;
- `prefers-reduced-motion`, hidden tab, keyboard navigation, and `aria-live` coalescing;
- account button click and focus behavior remain unchanged;
- idle/active/terminal states keep the same 28 px outer height and measured width;
- narrow toolbar does not overlap project, account, native-helper, or recording controls.

### Verification commands

Use focused tests during implementation, followed by the repository gates appropriate to the final diff:

```powershell
npx vitest run tests/unit/hostedAgentK1Parity.test.ts tests/unit/hostedAgentK2Security.test.ts
npx vitest run tests/unit/creditBalanceCoordinator.test.ts tests/unit/CreditBurnMeter.test.tsx
npm run lint
npm run build
```

The exact focused filenames may change when the tests are added. Do not run or claim unrelated exhaustive media/GPU suites unless the implementation touches them.

## Acceptance Criteria

1. Authenticated users always see the reserve bar in the toolbar.
2. Starting hosted AI immediately shows an active state without lowering the balance speculatively.
3. Every confirmed hosted-agent round debit reaches the toolbar before the next visible round/terminal completion while connected; cancellation performs one bounded accounting-only drain before falling back to reconciliation.
4. Digits, bar, heat pulse, particles, and run total respond to the same accepted settlement.
5. The displayed balance always ends at the server-authoritative value.
6. Reconnect, lost-cursor replay, duplicate terminal data, concurrent operations, and out-of-order responses cannot double-animate, double-count run spend, or visibly restore spent credits.
7. Failed, canceled, or interrupted operations show only spend that was actually settled; post-cancel replay never executes editor tools.
8. New refunds and grants visibly increase the balance with a distinct non-spend treatment, while replayed/no-op refunds reconcile silently.
9. Reduced-motion users receive exact immediate updates with no decorative motion.
10. The meter creates no idle animation loop or repeated layout work.
11. The meter remains 28 px high, does not resize between idle and active states, works at supported zoom levels, and keeps opening the Account dialog.
12. Tests cover billing order, deduplication, concurrency, animation state, accessibility, and permanent-bar semantics.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| “Live” is perceived as token-by-token | Label and document confirmed settlement semantics; do not animate estimates |
| Replayed K2 events animate twice | Namespaced mutation ids, cumulative-max per-turn spend, debit-safe balance application, and bounded coordinator deduplication |
| Concurrent responses make balance jump upward | Debit-only lowest-balance rule plus terminal account reconciliation |
| Bar denominator misrepresents a quota | Current-pool-epoch grant high-water reference, refund exclusion, and explicit tooltip wording |
| Whole-account balance drops more than one run total | Keep digits tied to account snapshot and `RUN` tied to the activity's cumulative total |
| Cancel hides an already-settled round | Bounded accounting-only replay after cancel plus terminal account reconciliation |
| Motion distracts from editing | Short bounded bursts, event coalescing, no idle loop, reduced-motion support |
| Cross-screen particles cover controls | Resolve target once, cap path/distance, terminate before target, local fallback |
| Large debit creates a long number animation | Sublinear duration, skipped intermediates, exact final snap |
| Failed/canceled work appears free | Emit already-settled work before terminal abort handling |
| Existing hosted paths bypass the UI | Coordinator migration table plus regression tests around legacy setter use |
| Dirty parallel work causes file conflicts | Keep the new component/coordinator isolated and re-read touched files immediately before implementation |

## Explicit Non-Goals

- predicting provider cost before settlement;
- showing raw input/output/reasoning token counts in the toolbar;
- changing pricing or debit policy;
- replacing the Account usage history;
- persisting decorative animation state into project files;
- running a continuous particle canvas or game-style economy simulation;
- redesigning the entire toolbar or FlashBoard panel.

## Review Incorporation

Review completed on 2026-07-31 by the local Claude Code CLI using the canonical `claude-opus-5` model in read-only mode. The reviewer inspected the plan and the bounded set of current hosted billing, replay, account, gateway, and toolbar files. No repository files were modified by the reviewer.

### Findings adopted

| Opus finding | Change incorporated into this plan |
|---|---|
| `ledgerEntryId` exists in `HostedChatRoundSettlement` but is dropped before the K1/runtime contract | Phase 0/1 now propagates it through billing response, HTTP adapter, port, event, and client |
| Debit and compensation can share a round source id under different ledger sources | Mutation identities are namespaced by kind, source, and ledger/source id |
| Per-round deltas are not replay-safe for the run label after lost cursor/reload | Hosted-agent activity spend now uses the maximum cumulative turn total; `turn-complete` is the final reconciliation |
| Client cancellation currently throws without receiving the last settled round | Phase 1 adds a bounded post-cancel accounting-only replay that cannot execute tool batches |
| Non-agent balance responses lack consistent delta/id contracts and reads/polls also sync balance | Phase 0 adds gateway/header mutation identities, splits debit motion from reconcile-only updates, and inventories polling/read paths |
| A “most recent positive entry” bar reference is corrupted by refunds/compensations | The meter uses a current-pool-epoch grant high-water reference and excludes adjustment rows |
| The initial two-line concept does not fit the existing 28 px toolbar | The final layout is a fixed-footprint 28 px grid with a permanent 2–3 px inset underline and reserved run slot |
| Account/default-zero, mirrored billing summary, and refund replay need explicit handling | Phase 2 and tests now suppress bootstrap/error motion, preserve both balance mirrors, and animate only new refunds |
| Tests missed compensation, cancel drain, lost-cursor replay, refund replay, and reference stability | All are now explicit fixtures, test cases, and exit-gate requirements |

### Refinement beyond the review wording

The review suggested a grant-only `MAX(balance_after)` reference. This plan narrows that maximum to the current credit-pool epoch so a historical Studio-plan high-water mark cannot make a later Free/Starter balance appear permanently empty. The server still includes current exact balance and plan allowance as lower bounds because existing `balance_after` writes can be stale under concurrent grants.

### Implementation readiness after review

The product direction and motion architecture are approved. Implementation must begin with Phase 0 contract work; starting directly with the visual component would recreate the exact identity, polling, cancellation, and toolbar-layout failures identified by the review.
