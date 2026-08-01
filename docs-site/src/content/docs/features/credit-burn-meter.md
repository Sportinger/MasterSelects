---
title: "Live Credit Burn Meter"
---

The meter supports authenticated hosted-AI workflows, including agent chat, chat, image/video generation, speech, music, sound, and transcription.

---

## What users see

The right side of the 28 px editor toolbar shows the authenticated account's exact credit balance and a thin reserve bar. Starting a tracked hosted operation changes the fixed-size control to `AI ACTIVE` (or an active-operation count) and a `RUN` spend indicator without lowering the balance speculatively.

When the client accepts a server-confirmed ledger debit, the same settlement drives four synchronized cues:

- changed balance digits roll downward with short motion trails;
- the reserve bar eases to the new authoritative ratio and flashes at its leading edge;
- a bounded seven-particle drain and one amount cue travel toward the operation's target element, or use a local toolbar fallback;
- the `RUN` indicator reports confirmed spend for the active hosted-work session.

Overlapping operations show their active count and aggregate confirmed spend. After the last operation completes, fails, or is canceled, the `LAST` spend indicator remains visible for 1.5 seconds. Clicking the meter opens Account.

Grants and newly created refunds roll upward with a quieter green `+N CREDITS` or `+N REFUND` treatment. Replayed/no-op refunds and balance-only reads reconcile silently.

## Billing truth contract

The meter never estimates cost from elapsed time, output length, token counts, or a configured maximum. Balance motion and run spend require both a positive server-confirmed charge and a stable mutation identity.

Hosted-agent billing events carry the whole-account balance, round debit, cumulative turn debit, and ledger identity. The client maintains an event cursor, accepts ordered replay, and deduplicates namespaced mutation IDs. Agent run spend uses the maximum cumulative turn total rather than summing replayable round deltas.

If cancellation races with completed provider work, the client performs one 1.5-second accounting-only cancel/replay drain. It accepts settlement and terminal events but never executes a queued editor tool after cancellation. A debounced Account refresh after the final activity is the convergence point for other tabs, grants, refunds, and any unavailable drain.

Balance-only reads and account/bootstrap responses are reconciliation only. They may correct the exact number and bar, but cannot create spend motion or increment `RUN`.

## Reserve reference

The bar is not presented as a hard quota. Its server-provided `creditMeterReference` is the maximum of:

- the exact current balance;
- the plan's monthly credit amount;
- the highest grant balance inside the current subscription/refill epoch.

Refund and compensation adjustments are excluded from the reference high-water query. The client also floors the reference at the visible balance so a new grant cannot temporarily overflow the bar.

## Accessibility and performance

- The meter is a normal keyboard-focusable Account button with a descriptive `aria-label` and a single polite settlement announcement region.
- `prefers-reduced-motion: reduce` and hidden tabs receive the exact final balance immediately without particles, trails, shimmer, or heat travel.
- The numerical balance and the reference in the meter tooltip supplement the reserve bar's color cues.
- Idle state has no meter-owned animation loop or layout polling. A target rectangle is read when a particle settlement begins.
- Decorative settlement records are capped and rapid same-direction updates coalesce while account truth remains in `accountStore.creditBalance`.

## Main implementation

- `src/components/common/Toolbar.tsx`
- `src/components/common/CreditBurnMeter.tsx`
- `src/components/common/CreditBurnMeter.css`
- `src/components/common/useCreditBurnAnimation.ts`
- `src/services/credits/creditBalanceCoordinator.ts`
- `src/stores/creditActivityStore.ts`
- `src/services/cloudAiService.ts`
- `src/services/transcription/cloudProviders.ts`
- `src/services/flashboard/FlashBoardHostedAgentTransport.ts`
- `src/services/kernelClient/hostedAgent/k2Client.ts`
- `functions/lib/hostedAgent/k1Runtime.ts`
- `functions/lib/credits.ts`
