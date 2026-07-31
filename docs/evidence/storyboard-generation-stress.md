# Storyboard generation, async, and reload stress evidence

Date: 2026-07-30

Scope: WP12 generation/async partition over the public WP3b, WP4, and WP5
contracts. This evidence is test-only. It does not call a real provider, spend
credits, or change production generation/kernel code.

## Covered invariants

| Invariant | Evidence |
|---|---|
| Exact approval and maximum-size batch | A 16-candidate hosted batch is approved for exactly 112 hosted credits. The current price is rechecked once per candidate before any start. |
| Concurrent idempotence | Two concurrent submissions with the same approval token coalesce to the same promise. Sixteen stable request keys create sixteen records, never thirty-two. |
| Partial submission retry | Two provider-boundary starts fail once. Their candidate-to-record linkage is persisted and marked failed. Retry reuses all sixteen records, starts only the two draft records, and every successful provider start occurs exactly once. |
| Cancel/spend honesty | 96 candidates cover awaiting approval, draft, processing, and completed lifecycles. Awaiting/draft cancellation reports no continuing billing; processing reports that billing may continue; completed work remains billable and ready. No refund is invented or existing refund evidence removed. |
| Large queue reload/resume | 140 persisted candidates/records cover 40 durable queued resubmits, 40 remote-task resumes, 20 unsafe replays requiring confirmation, 20 completed records awaiting import, and 20 failed jobs. Candidate links are recovered by record ID or request key after project/JSON reload. |
| Resume idempotence | The 80 safe restore actions execute once. Replaying the same action list starts no additional jobs; unsafe actions remain explicit confirmation items. |
| Restore failure isolation | A thrown restore `submit` is returned as a structured per-record failure, later resume actions still execute, and only the failed action remains retryable. |
| Terminal import failure, retry, and many candidates | 64 completed provider records with four outputs each produce 256 candidates. Half are imported/ready and half carry terminal per-output import failures. Record, output, media, failure state, and import error remain stable after JSON reload plus record/output/result reordering. The project type surface persists both import fields. Producer and real `FlashBoardMediaBridge` tests prove that marking one output does not fail its siblings or the completed job, errors are bounded, retry skips already imported outputs, and `awaiting-import` ends once every missing output is terminal. |
| Timeline attachment undo | Undo removes the generated timeline clip and restores the scene/candidate attachment state, while retaining the Media Pool asset, exact `File` handle, blob URL, generation record, output-to-media link, actual-credit evidence, and absence of any invented refund. Redo reattaches the same asset. |
| Bounded generation telemetry | Real partial submission, mixed restore execution, per-output import failure, and cancellation emit only aggregate count/status/success/failure or allowlisted disposition attributes. Prompts, references, user/project/record/task/output/media IDs, provider errors, and confirmation reasons never enter the telemetry journal. |
| WP3b linkage after reload | 30 scenes cover explicit card/reference promotion, explicit start-frame promotion, and no promotion. Concept roles, original prompt/reference provenance, narration record/request/output linkage, and duration metadata survive later scene edits plus project codec reload. Unpromoted concepts never become start frames or animatic stills. |

## Added suites

- `tests/unit/storyboardGenerationStressSubmission.test.ts`
- `tests/unit/storyboardGenerationStressRestore.test.ts`
- `tests/unit/storyboardGenerationStressReloadLinkage.test.ts`
- `tests/unit/storyboardGenerationStressUndoTelemetry.test.ts`

The suites use deterministic in-memory ports. Provider starts, restore calls,
state persistence, cancellation, pricing, history, and telemetry are observable
test seams; no network or billing side effect is possible.

## Verification results

Focused stress suites:

```text
vitest run tests/unit/storyboardGenerationStressSubmission.test.ts \
  tests/unit/storyboardGenerationStressRestore.test.ts \
  tests/unit/storyboardGenerationStressReloadLinkage.test.ts \
  tests/unit/storyboardGenerationStressUndoTelemetry.test.ts

4 test files passed
10 tests passed
```

Generation regression partition:

```text
16 test files passed
72 tests passed
```

This partition includes the existing approval, capability, stable-key,
submission, restore/cancel, candidate adapter/store, animatic candidate
preparation/promotion/media-reload/integration, and release telemetry suites
together with the four stress suites.

Scoped lint:

```text
eslint tests/unit/storyboardGenerationStressSubmission.test.ts \
  tests/unit/storyboardGenerationStressRestore.test.ts \
  tests/unit/storyboardGenerationStressReloadLinkage.test.ts \
  tests/unit/storyboardGenerationStressUndoTelemetry.test.ts

passed
```

Repository-wide test typecheck was attempted with
`tsc -p tsconfig.test.json --noEmit`. It is not currently a clean repository
gate and reports a large pre-existing diagnostics set across unrelated tests.
Filtering that output produced no diagnostic for a generation stress test.

Full build:

```text
npm run build

passed: tsc -b and Vite production build
```

Vite emitted its existing large-chunk advisory. Full `npm run lint` was
previously attempted and did not finish within 124 seconds in the shared,
concurrently changing worktree. Scoped lint for every generation stress file is
green. G5 therefore still requires a completed full-lint run.

## Remaining integration limits

1. **Billing/provider authority remains integration evidence.** Exact quote,
   max-spend, start count, and cancellation claims are verified at the client
   boundary. Actual D1 ledger enforcement, provider charge idempotence, and
   provider cancellation/refund behavior require hosted integration evidence.
2. **This is deterministic load coverage, not a performance benchmark.** The
   140-record restore and 256-candidate output sets detect identity, ordering,
   state, and duplicate-side-effect regressions. They do not establish a UI,
   memory, or latency budget.

## Partition verdict

The WP12 generation/async test partition and full production build are green
for the implemented public contracts. The earlier per-output
import/persistence and generation telemetry gaps are closed by production
wiring and regression tests. Release gate G5 still needs a completed full-lint
run; hosted billing/provider authority and formal performance evidence remain
integration concerns rather than unresolved client-contract defects.
