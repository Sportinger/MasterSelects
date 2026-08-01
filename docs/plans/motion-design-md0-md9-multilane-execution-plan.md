# Motion Design MD0-MD9 Multilane Execution Plan

> **SUPERSEDED 2026-08-01.** Do not execute from this document.
> Active plan: [`motion-design-md3-md9-execution-plan.md`](./motion-design-md3-md9-execution-plan.md).
>
> This plan assumed four concurrent agents in one worktree. It was executed by a
> single agent, so the lane model, write leases, integration windows, and
> MDX0-MDX6 coordination gates were pure overhead. The MD0-MD2 closure record,
> the rebaseline table, the Non-Goals, and the frozen MD3/MD6/MD7 contract
> decisions below remain valid as history and are carried forward by the new
> plan. Everything about lanes, leases, waves, and coordination gates is retired.

Status: Superseded; retained for the MD0-MD2 closure record and frozen contracts
Date: 2026-07-31
Working branch: `master`
Worktree model: one shared worktree, one main integrator, at most three worker lanes
Change policy: no commit and no push unless the user explicitly changes that instruction

Parent plan: [`motion-design-ai-completion-plan.md`](./motion-design-ai-completion-plan.md)
Detailed MD2 packet plan: [`motion-design-phase2-authoring-execution-plan.md`](./motion-design-phase2-authoring-execution-plan.md)
Historical architecture: [`../completed/plans/motion-design-system-plan.md`](../completed/plans/motion-design-system-plan.md)

## Purpose

Finish every remaining Motion Design 1.0 requirement from `MD0` through `MD9`
with safe parallel execution in the same dirty worktree.

This plan converts the product phases in the parent plan into executable work
packets with:

- explicit dependency and contract-freeze gates;
- three durable worker lanes plus one main integration lane;
- exclusive write ownership for high-conflict files;
- small integration windows instead of concurrent edits to shared seams;
- AI, persistence, history, preview, nested-preview, and export work inside each
  vertical slice rather than in a final catch-up phase;
- test and visible-evidence requirements for every phase gate.

This document is the execution source of truth for parallel work. The parent
plan remains the source of truth for product scope and the formal `MD0`-`MD9`
exit gates.

## Non-Goals

- Do not create one agent per product phase.
- Do not allow multiple agents to edit central types, stores, registries,
  renderer entry points, or export entry points concurrently.
- Do not treat schema scaffolding, disabled UI, or an AI definition without a
  working handler as a completed capability.
- Do not introduce a second keyframe store, a second property model, duplicated
  timeline clips per procedural instance, or per-instance media decoders.
- Do not mutate the currently open editor project for implementation evidence.
- Do not broaden Motion Design 1.0 into arbitrary JavaScript expressions,
  general vector illustration, particles, or 3D replication.

## Current Rebaseline

The phase checkbox remains open until its complete exit gate and evidence are
green, even where most implementation already exists.

| Phase | Current implementation state | Work still required before gate closure |
|---|---|---|
| MD0 Existing MVP + AI | Complete; lower-third AI batch, history, save/reopen, direct/nested preview/export, and restore evidence recorded | Phase gate closed; later waves must keep its regression evidence green |
| MD1 Shapes/Appearances | Complete across schema, renderer, UI, AI, persistence, four-surface goldens, and lifecycle tests | Phase gate closed; texture media remains intentionally assigned to MD5 |
| MD2 Authoring/Animation | Complete; unified graph, AI sequence, motion paths/handles/onions, history, panel restoration, and six disposable baselines recorded | Phase gate closed; later waves must preserve the canonical single-graph/keyframe workflow |
| MD3 Replicator Core | Grid MVP and partial durable/property/render scaffolding exist; persisted default `maxInstances` says 10,000 while renderer/capabilities/AI still enforce 100 | Separate requested/user/device/effective limits; complete Grid/Linear/Radial semantics, offsets, real 10k capacity/performance, caching, bounds/culling, stats, full UI/AI/persistence/history/parity |
| MD4 Modifiers/Falloffs | Some durable placeholders exist | Ordered deterministic modifier runtime, stable seeds/indexing, falloff references, UI/AI authoring, GPU plan where appropriate, parity and performance evidence |
| MD5 Media Motion | Texture/direct-media concepts are reserved but intentionally unavailable | Image/video/nested sources, timing modes, decoder/render reuse, relink behavior, UI/AI/persistence, preview/export parity |
| MD6 Structure | Null creation, `parentClipId`, transform composition, history snapshot fields, and link visuals exist; PickWhip is disabled and parent mutations lack the complete domain transaction | Persist/remap parent ids across project/clipboard/edit operations; time-explicit parent evaluation; defined animated-reparent policy and world preservation; null UX/handles; explicit mixed-space policy; group decision; AI/history/parity |
| MD7 Adjustment/Render Graph | Adjustment clip/store/persistence scaffolding and general worker render contracts exist; builders currently discard adjustments and `useRenderGraph` is false | One ordered compositor-operation executor across the currently separate main/nested/target/export paths, accumulated-lower-layer semantics, supported-effect matrix, nesting/export parity, UI/AI and rollout-flag resolution |
| MD8 Reusable Content | A tested media-free appearance-preset codec exists; `.msmotion` is otherwise only a generated clip filename, not a template format | Versioned project-local preset catalogs/templates, dependency reporting, safe bounded expression language, content catalog, semantic AI workflows, one-batch undo, parity and security evidence |
| MD9 Release | Open | Migrations, legacy fixtures, full regression/stress/platform/device-loss/golden/performance passes, dead-code removal, final docs and visible evidence |

Existing code is evidence for the rebaseline, not permission to skip a vertical
slice. Each lane must first verify the current behavior and preserve compatible
working pieces.

## Completion Invariant for Every Capability

A packet is not done until its capability has all applicable parts:

1. versioned durable data and migration/default behavior;
2. shared validation and domain operations;
3. editor creation and editing UI;
4. property-registry descriptors and clip-aware capability discovery;
5. shared keyframe behavior for every animatable numeric value;
6. semantic AI reads and mutations using the same domain operations as the UI;
7. definition, handler, policy, dispatcher, batch, prompt/playbook, and catalog
   parity for model-exposed tools;
8. one undoable transaction with entity ids and revision reporting;
9. copy/paste, duplicate, split/trim, save/load, reload, and nesting behavior;
10. main preview, target preview where applicable, nested preview, and export
    parity;
11. unit, store, UI, AI, render, bridge, architecture, and performance coverage
    appropriate to the packet;
12. updated feature documentation and disposable visible evidence.

If a part is intentionally not applicable, the lane handoff must state why.

## Dependency Graph

```text
Close MD0 + MD1 + MD2 evidence gates
                 |
                 v
       Freeze shared 1.0 contracts
          /          |          \
         v           v           v
 MD3 Replicator   MD6 Structure   MD7 Render Graph
      |                |               |
      v                |               |
 MD4 Modifiers         |               |
      |                |               |
      +-------> MD5 Media <-------------+
                       |
      MD1-MD7 schemas and operations stable
                       |
                       v
              MD8 Reusable Content
                       |
                       v
                MD9 Release Hardening
```

Clarifications:

- MD7 contract work can proceed beside MD3 and MD6, but implementation may not
  bypass the existing compositor/render-frame snapshot boundary.
- MD5 may design source/timing contracts early, but direct media replication
  cannot integrate until MD3 freezes the instance/source-time contract.
- The pure MD8 expression parser and version-envelope codec may be developed
  early in isolation. Preset/template integration and catalog release wait for
  stable MD1-MD7 schemas.
- MD9 tests and fixtures are added continuously, but the release gate is last.

## Concurrency Model

Four execution slots are used as follows:

| Lane | Persistent responsibility | Phase sequence |
|---|---|---|
| L0 Main Integration and Gates | Contracts, shared seams, architecture ownership, AI registry integration, project/store integration, cross-surface tests, evidence ledger, final release gates | MD0-MD2 closeout, then all integration windows, then MD9 release decision |
| L1 Procedural Instances | Replicator evaluation and GPU data, layouts, modifiers, falloffs, procedural performance | MD3 then MD4; contribute isolated MD8 procedural fixtures and MD9 performance tests |
| L2 Structure and Reuse | Parent graph, nulls/groups, presets/templates, expression evaluator, reusable-content domain | MD6 then MD8 core; contribute MD9 migrations/structural regression |
| L3 Compositor and Media | Adjustment render planning, accumulated-layer operations, texture/direct-media runtime, source-time reuse | MD7 contract/core then MD5; contribute MD8 media fixtures and MD9 render/platform evidence |

The lane identity describes exclusive ownership, not a permanently assigned
person. Agents may rotate between waves, but a write scope may have only one
owner at a time.

## Shared-Worktree Ownership

### L0-only high-conflict seams

Only the main integrator may modify these paths during an active wave unless a
written lease transfer is recorded before work starts:

- `src/architecture/**`;
- `src/types/motionDesign.ts`, `src/types/index.ts`, `src/types/timeline*.ts`;
- `src/services/project/types/**`, project load/save/hydration entry points;
- `src/stores/timeline/motionClipSlice.ts`, timeline store barrels, shared
  timeline types/selectors, serialization and history entry points;
- central Timeline files, `MotionShapeTab.tsx`, panel barrels, and
  `PreviewCanvasMount.tsx`;
- `src/engine/motion/MotionRenderer.ts` and shared render dispatcher/compositor
  entry points;
- central layer-builder collectors/barrels and export entry points;
- current monolithic Motion Design AI definition/handler files, AI
  definition/handler/policy registries, batch registry, model catalog, and
  FlashBoard prompt/playbooks;
- parent/completion plans, phase checklist, architecture gates, and final
  evidence index.

L0 integrates the smallest additive adapter after a worker packet is green. A
worker must not pre-emptively patch a reserved seam.

### L1 default write scope

- new or exclusively leased modules under
  `src/services/motionDesign/replicator/**` and
  `src/services/motionDesign/modifiers/**`;
- new or exclusively leased modules under `src/engine/motion/replicator/**`;
- `MotionBuffers.ts`, `MotionPipeline.ts`, and Motion WGSL files only when the
  wave manifest grants L1 an exact lease and L3 is not touching them;
- isolated Replicator/Modifier Properties subcomponents and leaf property
  descriptor modules;
- uniquely named MD3/MD4 unit, render, determinism, and performance tests;
- lane-specific evidence files and fixtures.

### L2 default write scope

- new modules under `src/services/motionDesign/structure/**`,
  `src/services/motionDesign/presets/**`,
  `src/services/motionDesign/templates/**`, and
  `src/services/motionDesign/expressions/**`;
- isolated Null/Parent/Group and Preset/Template/Expression UI components;
- leaf project codecs that do not modify shared project schema/load/save entry
  points until L0 integration;
- uniquely named MD6/MD8 domain, UI, security, round-trip, and migration tests;
- lane-specific evidence files and fixtures.

### L3 default write scope

- new modules under `src/services/motionDesign/media/**` and
  `src/services/motionDesign/adjustment/**`;
- new modules under `src/engine/motion/media/**` and a dedicated
  Motion-adjustment render-planning directory agreed during contract freeze;
- isolated Texture/Media and Adjustment UI components;
- source-time/decode-reuse planners that consume, rather than replace, the
  canonical media runtime and render-frame snapshot contracts;
- uniquely named MD5/MD7 render, media-runtime, ordering, and parity tests;
- lane-specific evidence files and fixtures.

### Ownership rules

1. Before every wave, L0 records exact write and forbidden-write globs in the
   architecture lane/ownership registries where the active architecture requires
   them.
2. A file may have one writer only. Directory ownership does not override an
   explicit L0 reservation.
3. Before touching any dirty file, reread it and inspect its current diff.
4. If another change appears in an owned file, stop writing that file and hand
   the integration to L0.
5. Workers create leaf modules, adapters, fixtures, and distinct test files.
   L0 patches barrels and shared entry points during integration windows.
6. No lane runs unrelated formatting, mass import sorting, generated-file
   rewrites, destructive Git commands, commit, or push.
7. No lane mutates the open user project. Browser/evidence work uses a disposable
   project with a deterministic fixture id.
8. Cross-lane communication happens through frozen contracts and handoff notes,
   never through concurrent edits to the same implementation seam.

## Gate Model

In addition to the parent phase gates, execution uses these coordination gates:

| Gate | Meaning |
|---|---|
| `MDX0_BASELINE_CLOSED` | MD0-MD2 required evidence and refreshed regressions are green; documentation matches the implemented unified graph workflow |
| `MDX1_OWNERSHIP_REGISTERED` | Active lane write sets, forbidden sets, shared seams, and integration owner are recorded and architecture tests pass |
| `MDX2_CONTRACTS_FROZEN` | Replicator, parent graph, adjustment/render graph, media source-time, capability, revision, and persistence version contracts are reviewed and fixture-tested |
| `MDX3_FOUNDATIONS_INTEGRATED` | MD3, MD6, and MD7 vertical slices are integrated and their formal parent gates are green |
| `MDX4_PROCEDURAL_MEDIA_INTEGRATED` | MD4 and MD5 vertical slices are integrated and their formal parent gates are green |
| `MDX5_REUSABLE_CONTENT_INTEGRATED` | MD8 presets/templates/expressions/AI workflows are integrated and green |
| `MDX6_RELEASE_GREEN` | MD9 full release matrix passes and every formal MD0-MD9 checkbox is evidence-backed |

No wave may claim completion from targeted tests alone. Targeted tests permit a
handoff; integration and phase gates require the broader matrix defined below.

## Wave 0 - Close the Existing MD0-MD2 Gates

No new MD3-MD8 product capability is integrated before this wave is green.
Read-only audits and contract proposals may proceed.

### Wave 0 repair write manifest — 2026-07-31

The completion audit found implementation/test debt in addition to missing
browser evidence. These are the only worker write leases active for the repair
pass:

| Lane | Exclusive write lease |
|---|---|
| L1 MD0 | New `src/services/aiTools/motionDesignMd0Evidence.ts`, new `tests/unit/motionDesignMd0Evidence.test.ts`, new `scripts/run-motion-design-md0-evidence.mjs` |
| L2 MD1 | New `src/services/motionDesign/evidence/md1GoldenFixture.ts`, new `src/services/motionDesign/evidence/md1PixelComparison.ts`, new `src/services/aiTools/devBridge/browser/debugActions/motionDesignMd1Evidence.ts`, new `scripts/run-motion-design-md1-evidence.mjs`, and new `tests/unit/motionDesignMd1EvidenceManifest.test.ts`, `motionDesignMd1Lifecycle.test.ts`, `motionDesignPromptParity.test.ts` |
| L3 MD2 | `src/components/preview/motionPathGeometry.ts`, `MotionPathOverlay.tsx`, `useMotionPathEditing.ts`, and new `tests/unit/motionPathViewportWaveD.test.tsx` |

L0 retains every registration/barrel/policy file, FlashBoard prompt/playbook,
active plan, feature documentation, and evidence status file. Workers may not
call the bridge or browser. Actual PNG/report generation is deferred until an
isolated browser session exists and is verified not to be the open user project.

MD2 disposable-evidence preparation used a second isolated lease packet:

| Lane | Exclusive write lease |
|---|---|
| L1 runner | New `scripts/run-motion-design-md2-evidence.mjs` and `tests/unit/motionDesignMd2EvidenceRunner.test.ts` |
| L2 browser action | New `src/services/aiTools/devBridge/browser/debugActions/motionDesignMd2Evidence.ts` and `tests/unit/motionDesignMd2Lifecycle.test.ts`; after the worker returned no files, L0 explicitly reclaimed this lease before writing |
| L3 fixture/capture | New `src/services/motionDesign/evidence/md2EvidenceFixture.ts`, `md2DomCapture.ts`, and their two focused tests |
| L0 integration | Debug Action registration, plan/evidence documents, adversarial review, and final gates |

No two lanes wrote the same file during preparation. L0 later ran the actions
only against one exact, unique, unsaved, chat-free disposable session after
verifying it was not the open user project.

### Wave 0 integration checkpoint — 2026-07-31

- MD0 focused evidence: 12/12; adjacent regression: 110/110; hidden
  handler/policy/registry integration: 68/68.
- MD1 focused fixture, lifecycle, prompt, runner-safety, and state-restore
  evidence: 22/22.
- MD2 shared-history, viewport, and disposable-runner closeout: 8 files/64
  tests. The original Wave D handle suite remains 11/11; the new exact-target
  runner, lifecycle, fixture, and DOM-PNG packet contributes 24/24.
- Current Wave 0 matrix: 77 files and 1,375 tests green. This comprises 38
  Motion/AI/Graph files (717), 33 Render/Nested/History files (336), four
  Store/Project files (254), and two architecture registries (68).
- The matrix first exposed one Motion-owned LOC-budget failure in
  `useLayerSync.ts`. L0 reduced the host again through the existing leaf adapter,
  then reran architecture and adjacent Motion tests green without raising the
  budget.
- Application TypeScript and targeted ESLint pass. The refreshed
  `npm run build:deploy` passes with 10,410 transformed modules.
- MD0 was rerun after the history-runtime and explicit-duration fixes. MD0 has
  two final lower-third PNGs/report; MD1 has four surface baselines/report; MD2
  has six Graph/Motion-Path/render baselines/report. All top-level results pass.
- No user project was mutated, and no commit or push was made.

`MD0_EXISTING_MVP_COMPLETE`, `MD1_SHAPES_AND_APPEARANCES_COMPLETE`,
`MD2_AUTHORING_AND_ANIMATION_COMPLETE`, and `MDX0_BASELINE_CLOSED` are closed.

### L0 Main

- Snapshot the scoped dirty baseline and record unrelated known failures.
- Reconcile the parent plan and MD2 execution record with the current unified
  global graph behavior.
- Update `docs/Features/Motion-Design.md`, which still describes pins, global
  graph mode, and motion paths as unimplemented.
- Prepare disposable projects and exact frame/time/export fingerprints.
- Run the final cross-surface and architecture regressions.
- Check MD0, MD1, and MD2 only when their evidence is complete.

### L1 evidence packet

- Capture the MD0 lower-third AI construction in a disposable project.
- Prove one-batch undo, save/reload, preview, nested preview, and export parity.
- Record exact AI tool sequence, resolved ids/revisions, representative frame,
  export fingerprint, renderer/runtime/GPU details, and discovered defects.

### L2 evidence packet

- Capture MD1 pixel goldens across rectangle, ellipse, polygon, star, ordered
  fills/strokes, gradients, opacity/blend, masks, effects, and nesting.
- Prove copy/paste, split, duplicate, save/reload, and appearance-id/keyframe
  preservation with deterministic fixtures.

### L3 evidence packet

- Capture the MD2 slide-and-overshoot required scenario.
- Prove that timeline diamonds, the global graph, viewport path edits, AI
  sequences, preview, nested preview, and export use the same keyframe ids,
  values, times, easing, and handles.
- Verify graph open/close layout restoration and property/series visibility
  controls introduced after the original Wave C record.

### Wave 0 exit

- `MD0_EXISTING_MVP_COMPLETE`, `MD1_SHAPES_AND_APPEARANCES_COMPLETE`, and
  `MD2_AUTHORING_AND_ANIMATION_COMPLETE` are evidence-backed and checked.
- Focused suites, architecture suites, application typecheck, production build,
  and scoped diff check are green or an unrelated baseline failure is precisely
  recorded and subsequently cleared before release.
- `MDX0_BASELINE_CLOSED` is green.

## Wave 1 - Contract Freeze and Architecture Registration

This wave prevents three implementation lanes from inventing incompatible
schemas or evaluation paths.

Read-only preflight audit:
[`wave1-contract-preflight.md`](../evidence/motion-design/wave1-contract-preflight.md).
It records the current gaps and proposed leases. `MDX0_BASELINE_CLOSED` is now
green and its ownership proposal has been converted into executable registries.

### Wave 1 ownership registration - 2026-07-31

- `motionDesignGateRegistry.ts` registers the complete MDX0-MDX6 dependency
  chain and Motion-specific exit-criteria evidence.
- `motionDesignLaneWriteManifest.ts` registers L0 shared-seam ownership and
  disjoint L1/L2/L3 leaf write sets with explicit forbidden paths.
- High-conflict ownership records `motionDesign.ts`, `MotionRenderer.ts`, the
  aggregate Motion contract directory, and this execution plan as L0-only.
- The Motion registry plus complete architecture registry pass 8/8 tests;
  targeted ESLint and application TypeScript pass.

`MDX1_OWNERSHIP_REGISTERED` and `MDX2_CONTRACTS_FROZEN` are closed. The frozen
leaf and aggregate decisions, 274 contract tests, and independent release audit
are recorded in
[`wave1-contract-freeze-report.md`](../evidence/motion-design/wave1-contract-freeze-report.md).

### L0 shared contract packet

- Allocate stable ids and schema-version/migration rules for layouts, modifiers,
  falloffs, parent graphs, adjustment operations, texture sources, presets,
  templates, and expressions.
- Define capability descriptors, limits, error/diagnostic envelopes, mutation
  entity/revision envelopes, and batch semantics.
- Define one evaluated `MotionFrameState` path consumed by preview, nested
  preview, and export.
- Register active lane ownership and architecture gates before shared-boundary
  implementation starts.

### L1 MD3/MD4 contract packet

- Specify Grid, Linear, and Radial layouts with requested/effective counts.
- Specify cumulative versus absolute position/rotation/scale/opacity offsets,
  grid pattern offsets, radial auto-orient, stable instance ordering, and bounds.
- Distinguish requested count, optional user limit, device/render-target limit,
  and effective count. Do not retain one ambiguous `maxInstances` field as all
  four concepts.
- Specify deterministic Random, Noise, Oscillator, and Field modifier plans,
  explicit seeds, stable per-instance index semantics, and shape-id falloffs.
- Define revision/cache keys, capacity/clamp diagnostics, stats, and CPU reference
  fixtures before GPU implementation.
- Replace the word "interactive" with a recorded reference GPU, composition
  resolution, preview quality, instance count, and measurable frame/upload/memory
  budget before the MD3 performance gate can close.

### L2 MD6/MD8 contract packet

- Specify a validated acyclic 2D parent graph, evaluation at an explicit timeline
  time, and exact world-transform preservation rules for set/clear/reparent and
  undo.
- Decide whether animated reparenting preserves the world transform only at the
  operation time, rejects cases that would require baking, or exposes an explicit
  bounded bake. Do not imply all-time preservation without implementing it.
- Decide group semantics before implementing them. Prefer no group layer over an
  ambiguous duplicate of nested compositions.
- Do not reuse `linkedGroupId`; it belongs to existing clip/link-group behavior,
  not Motion structural grouping.
- Specify versioned project-local preset and `.msmotion` template envelopes,
  stable-id remapping, dependency reporting, and one-batch instantiate semantics.
- Specify a tiny tokenized expression grammar and pure evaluator. No `eval`,
  `Function`, property access, loops, imports, or arbitrary function calls.
- Freeze clip-local `time`, zero- versus one-based `index`, effective `count`,
  stored seed/random semantics, expression-versus-keyframe precedence, finite
  output rules, and source/token/AST/evaluation budgets. The broader Math Scene
  evaluator may inform the parser design but is not safe to reuse unchanged.

### L3 MD7/MD5 contract packet

- Introduce and fixture-test one ordered discriminated operation stream, such as
  source-layer versus adjustment-operation entries, instead of forcing an
  adjustment into source-only `Layer`/`LayerRenderData` contracts.
- Specify one canonical bottom-to-top render order for accumulated lower layers,
  adjustment time range, masks, opacity, blend, nested compositions, and multiple
  adjustments. Resolve existing preview/export ordering-comment disagreements
  with shared ordering fixtures before implementation.
- Define adjustment transform behavior explicitly or reject it before mutation;
  do not silently apply source-layer transform semantics to the accumulator.
- Produce an explicit supported-effect compatibility matrix; unsupported effects
  fail before mutation.
- Specify image/video/nested source ids, runtime leases outside persistence,
  fit/fill/stretch/tile controls, and source-time modes.
- Specify the unique `(source id, resolved source time, render parameters)` reuse
  key so a video wall never creates one decoder/render path per instance.
- Respect active `P5_EXPORT_RENDER_SESSION_CONTRACT` and
  `P6_RENDER_FRAME_SNAPSHOT` architecture gates; update their ownership/gate
  records rather than routing around them.

### Wave 1 exit

- Contract fixtures prove serialization, migration defaults, determinism, stable
  ids, invalid-input behavior, and preview/export-consumable evaluated state.
- No unresolved ownership overlap remains.
- `MDX1_OWNERSHIP_REGISTERED` and `MDX2_CONTRACTS_FROZEN` are green.

## Wave 2 - Parallel Foundations: MD3, MD6, and MD7

Workers build only inside their assigned scopes. L0 integrates one lane at a
time while the other workers remain out of shared seams.

### Wave 2 integration checkpoint - 2026-07-31

- The MD3 frame-state/runtime foundation is integrated across main preview,
  target preview, nested preview, and export. The latest completed MD3 matrix is
  22 files and 294 tests, with application TypeScript green.
- The named-hardware 10,000-instance CPU reference evaluation and 480,000-byte
  buffer-packing evidence is recorded in
  [`../evidence/motion-design/md3-replicator-core.md`](../evidence/motion-design/md3-replicator-core.md).
  Visible WebGPU evidence remains open because the isolated evidence tab is not
  connected to the browser-control session.
- Main's adversarial MD3 re-audit found additional end-to-end blockers in exact
  Target/RAM-preview frame provenance, export resource-planning failures,
  repeated nested-composition instances, render fingerprints, and fail-closed
  traversal/diagnostics. The formal MD3 checkbox therefore remains open while
  those fixes are integrated and reviewed.
- MD6 integration has started: parent operations use the exact high-frequency
  operation time, apply rejects stale transform/keyframe state, nearby
  keyframes are moved to the exact operation time, dangling parent edges can be
  cleared through the normal transaction, and the ParentChildLink animation
  now reaches idle. Focused adapter/lifecycle/RAF tests and application
  TypeScript are green. Null batching, full edit/load sanitization, product UI,
  AI, nested behavior, and parity evidence remain open.
- The MD7 contract leaf is frozen and the isolated timeline-stack adapter is in
  progress. No MD3, MD6, MD7, or MDX3 formal gate is closed by this checkpoint.
- MD6 now has exact-time parent-chain evaluation across root/nested preview and
  export, frozen world-preserving transactions, edit/load remapping, Motion Null
  creation, and the timeline Pick Whip. The evidence and remaining gate blockers
  are recorded in
  [`../evidence/motion-design/md6-structure.md`](../evidence/motion-design/md6-structure.md).
- MD7 now has one accumulated-lower-layer adjustment operation path across main,
  target, nested, export, and the CPU worker preview, plus supported-effect
  preflight, Adjustment properties, Add-menu authoring, and semantic
  create/configure/move/trim/remove AI operations with real single-step
  undo/redo. The current evidence and remaining GPU-worker/visible-evidence
  blockers are recorded in
  [`../evidence/motion-design/md7-adjustment-render-graph.md`](../evidence/motion-design/md7-adjustment-render-graph.md).
- The open editor still has no browser-control binding; the editor bridge also
  rejects the configured token. Formal MD6/MD7 gates remain unchecked until the
  disposable visible scenarios and final combined regression matrix are green.
- No live user project was mutated, and no commit or push was made.

### Final Wave 2 gate-closure leases - 2026-08-01

Wave 3 remains dependency-blocked until the three formal Wave 2 phase gates and
`MDX3_FOUNDATIONS_INTEGRATED` are proven. The final repair pass uses these exact
same-worktree leases; L0 retains all shared UI/render/AI/store/project seams and
all disposable browser evidence:

| Lane | Packet | Exact writable leaf scope | L0 integration seam |
|---|---|---|---|
| L1 | `MD3_GATE_CLOSURE_AUDIT` | `src/services/motionDesign/replicator/**`, new `motionReplicatorGateClosure*.test.ts` only | supported-hardware browser/WebGPU evidence and formal gate ledger |
| L2 | `MD6_NULL_VIEWPORT_MODEL` | new `nullViewportController.ts` and `motionParentViewportControllerMd6.test.ts` only | Preview overlay/gesture wiring, UI regression, disposable scenario |
| L3 | `MD7_WORKER_GPU_ADJUSTMENT_PLAN` | new `workerGpuAdjustmentPlan.ts` and `motionAdjustmentWorkerGpuPlanMd7.test.ts` only | worker render-host integration, GPU parity regression, disposable scenario |

Every worker is forbidden from architecture, shared types, stores, components,
engine/render, project, AI, and documentation files. The exact machine-readable
leases live in `motionDesignActiveWavePackets`.

### Wave 2 adversarial review closure - 2026-08-01

The three leaf handoffs were independently reviewed before formal closure. The
review found and fixed real integration defects; green leaf tests alone were not
treated as gate evidence.

- MD6 Main integration fixed double-composed parent transforms, stale commits,
  child preview propagation, letterbox offsets, capture cleanup, fail-open
  track state, empty history batches, focus visibility, and unchanged-axis
  keyframe writes. The resulting 13-file / 92-test structure matrix is green.
- MD7 Main replaced generic effect reconstruction with a direct frozen-pass GPU
  executor, added dedicated color/separable-blur passes, namespaced masks,
  source-over mask union, source-id binding, and allocation cleanup.
- The bounded `MD7_RUNTIME_ENVELOPE_GATES` L3 window owned only the new envelope,
  the two named runtime seams, and its dedicated test. After its green handoff,
  those shared seams returned to L0 for producer clock/timeline/composition
  integration. Same-window leases remained disjoint; sequential ownership is
  registered in `motionDesignWave2ReviewClosureWindows`.
- The Worker boundary now rejects stale, expired, non-exact, wrong-target,
  wrong-composition, wrong-frame, wrong-time, or wrong-source packets before
  decoder/GPU work and forbids adjustment plans on autonomous streams.
- Formal Wave 2 closure is still blocked by mixed strict-Worker-GPU sources
  (the title-above-adjustment scenario) and visible supported-hardware evidence.
  No MD3, MD6, MD7, or MDX3 checkbox is closed by this review checkpoint.

### MD7 mixed-source closure windows - 2026-08-01

The adversarial mixed-source audit rejected a software `nested-frame` as formal
Worker-GPU parity evidence. Nested compositions require a recursively validated
GPU frame-stack packet with their own occurrence namespace and, whenever an
Adjustment exists inside the child, their own exact frozen Adjustment plan.
OffscreenCanvas/Canvas 2D remains a degraded-preview or raw-raster ingestion
tool only; it may not execute effects, masks, blends, Adjustment semantics, or
nested ordering for the MD7 parity claim.

The remaining packets execute in these dependency windows. Paths within one
window are disjoint; shared runtime seams return to L0 only in Window 6.

| Window | Packet | Owner | Dependency / result |
|---|---|---|---|
| 3 | `MD7_RECURSIVE_FRAME_STACK_CONTRACT` | L3 | Replace provisional software nested payload with exact recursive identity, execution mode, budgets, cycle/depth limits, and recursive transfer ownership |
| 3 | `MD7_GENERIC_PLAN_ADAPTER` | L3 | Completed; legacy video input retained, mixed source kinds freeze deterministically, unsupported/duplicate/conflicting bindings fail closed |
| 3 | `MD7_TARGET_RESOURCE_LIFETIME` | L0 | Completed implementation; detach, replacement, unregister, and dispose/reset release surface-owned compositor resources; bitmap allocations are registered before upload |
| 4 | `MD7_FRAME_STACK_HOST_PROJECTOR` | L0 | After recursive contract; project evaluated raw Image/Text/Solid/Motion/Nested sources without DOM/store/GPU handles or double-baked effects |
| 4 | `MD7_FRAME_STACK_MATERIALIZER` | L3 | After recursive contract; Worker raw uploads, Motion admission/renderer, namespaced resource ledger |
| 4 | `MD7_LAZY_SOURCE_EXECUTOR` | L3 | After recursive contract; source GPU work occurs at its matching frozen `resolve-source` pass, never eagerly |
| 5 | `MD7_RECURSIVE_STACK_EXECUTOR` | L3 | After materializer and lazy executor; depth-first exact parent/child pass traces |
| 5 | `MD7_FRAME_STACK_TRANSPORT_ENVELOPE` | L0 | After recursive contract; atomic command/bridge DTO, exact root identity and plan/binding bijection |
| 6 | `MD7_FRAME_STACK_SERIAL_INTEGRATION` | L0 | After projector, recursive executor, and transport; production host/bridge/handler/compositor integration |
| 7 | `MD7_FRAME_STACK_VISIBLE_EVIDENCE` | L0 | After integration; supported-hardware pixel/readback proof for direct, target, nested, and export surfaces |

The machine-readable leases and dependencies live in
`motionDesignMd7MixedSourcePackets`. The currently open editor is visible to the
user, but browser control still reports no session and the editor bridge rejects
its token. Window 7 and every formal phase checkbox therefore remain open.

### L1 - MD3 Replicator Core

Packets execute in order inside L1:

1. Pure reference evaluator for Grid, Linear, and Radial layouts, including
   pattern offset, radial auto-orient, all transform/opacity offsets, requested
   and effective counts, stable instance indices, and bounds.
2. Dynamic buffer/capacity management for at least 10,000 simple instances;
   dirty-range uploads, cache-by-definition/revision, safe texture dimensions,
   stroke padding, culling, truncation diagnostics, and observable stats.
3. Renderer/shader adapter that matches CPU reference fixtures and avoids
   per-instance React objects, clips, persisted records, or decoders.
4. Registry descriptors and isolated UI sections for all authorable fields.
5. Shared domain operations and semantic Replicator AI operation module; L0
   integrates the existing handler/definition/policy/prompt seams.
6. Persistence/history/copy/split/nesting/export integration and the required
   40-by-25 animated-pattern scenario.

MD3 exit requires the formal `MD3_REPLICATOR_CORE_COMPLETE` gate, including
10k performance evidence on named supported hardware.

### L2 - MD6 Structure

Packets execute in order inside L2:

1. Pure parent-graph validator/planner: cycle rejection, missing-parent behavior,
   mixed 2D/3D policy, graph revision, affected ids, and exact world-transform
   preservation.
2. Undoable domain operations for create null, set/clear parent, and atomic
   create-null-and-parent-selected.
3. Isolated null controls, viewport handles, pick-whip/selection UX, and clear
   diagnostics for blocked relationships.
4. Lock, visibility, label, selection, timing, copy/paste, project, reload, and
   history behavior. Persist `parentClipId` in timeline/project DTOs and remap it
   for clipboard, duplicate, split, paste, deletion, and complete-construction
   copy operations.
5. Group implementation only if the frozen decision defines behavior clearer
   than nested composition reuse; otherwise remove/disable misleading group UI
   and document it as out of the 1.0 implementation.
6. Semantic AI operation modules using the same parent planner; L0 integrates
   shared store/AI seams and the required lower-third null-parent scenario.

MD6 exit requires the formal `MD6_STRUCTURE_COMPLETE` gate.

### L3 - MD7 Adjustment Layers and Render Graph

Packets execute in order inside L3:

1. Pure adjustment render planner over ordered accumulated lower-layer results,
   time range, masks, opacity, blend, nesting, and multiple adjustments.
2. Shared compositor-operation executor in an isolated leaf module. L0 routes
   the existing main, nested, target-preview, and export loops through it during
   integration; none may retain conflicting order or effect preprocessing.
3. Supported-effect adapter for the initial blur/color set, with compatibility
   validation before mutation and deterministic ordering.
4. Shared evaluated render operation consumed identically by main preview,
   target preview where applicable, nested composition, and export.
5. Isolated Adjustment properties UI and diagnostics.
6. Semantic create/configure/move/trim/remove operation modules; L0 integrates
   shared store/AI/effect seams.
7. Resolve `useRenderGraph`: make it a real tested rollout gate or remove it.
8. Capture the timed color-and-blur montage scenario with a title above the
   adjustment remaining unaffected.

MD7 exit requires the formal `MD7_ADJUSTMENT_LAYERS_COMPLETE` gate.

### Integration order for Wave 2

1. L0 integrates frozen shared types/defaults/migrations.
2. L0 integrates MD3 store/property/UI/AI/render seams and runs the matrix.
3. L0 integrates MD6 store/timeline/preview/AI seams and runs the matrix.
4. L0 integrates MD7 layer-builder/compositor/export/effect/AI seams and runs
   the matrix.
5. Cross-feature regression proves shapes, graph editing, parenting, effects,
   nesting, and export still agree.

Wave 2 exits only when MD3, MD6, MD7, and `MDX3_FOUNDATIONS_INTEGRATED` are
green.

## Wave 3 - Parallel Expansion: MD4, MD5, and MD8 Foundations

### L1 - MD4 Modifiers and Falloffs

- Implement ordered Random, Noise, Oscillator, and Field plans over registry-
  compatible target properties.
- Preserve modifier ids and keyframes across add/update/remove/reorder.
- Implement explicit seeds, stable instance indices, shape-id falloff references,
  feather/invert/clip behavior, and fail-closed missing-reference diagnostics.
- Compile/cache plans by stable revision; use compute/storage buffers only when
  evidence shows the boundary is appropriate.
- Add isolated stack/falloff UI and semantic AI operation modules.
- Prove deterministic reload pixels, bounded performance/stats, and the required
  radial-field scenario.

### L3 - MD5 Texture Fills and Direct Media Replicators

- Implement image, video, and nested-composition texture sources without durable
  runtime handles.
- Implement position, scale, rotation, fit/fill/stretch/tile, freeze, reverse,
  loop, ping-pong, and deterministic per-instance time offset.
- Reuse one source decode/render result for equal source-time keys and report
  reuse/cache/limit diagnostics.
- Quantize source time deterministically for cache keys. Equal
  `(source id, resolved source time, render parameters)` requests share one frame;
  different per-instance times use a bounded frame/decoder pool, never a decoder
  per instance.
- Use the exact-frame WebCodecs/export-compatible path and cached `VideoFrame` or
  texture batches where concurrent source times cannot be served correctly by a
  single HTML video element.
- Implement direct media Replicator targets without timeline clip duplication.
- Preserve settings when media is missing and relinked.
- Add isolated source/timing UI and semantic attach/replace/clear AI operations;
  never accept arbitrary local paths.
- Prove the required one-source tiled video-wall scenario and export parity.

### L2 - isolated MD8 foundations only

Before MD4/MD5 schemas are green, L2 may implement and test only:

- the versioned preset/template envelope and codec;
- dependency inventory and stable-id remapping planners;
- the pure expression tokenizer/parser/validator/evaluator for `time`, `index`,
  `count`, `sin`, `cos`, and seeded `random`;
- authoring-time validation, render-time fail-closed behavior, budgets, and
  security tests.

L2 may not yet freeze the complete template catalog, patch shared project
schemas, or expose model tools.

### Wave 3 integration order and exit

1. Integrate MD4 and prove no MD3 regression.
2. Integrate MD5 and prove one-source reuse plus MD3/MD4 compatibility.
3. Integrate only the independent MD8 codec/parser modules.
4. Freeze MD1-MD7 public preset/template capability schemas.

Wave 3 exits when formal MD4 and MD5 gates plus
`MDX4_PROCEDURAL_MEDIA_INTEGRATED` are green.

## Wave 4 - MD8 Reusable Content and AI Workflows

### L2 - MD8 core owner

- Implement versioned project-local shape, appearance, graph/easing, and
  Replicator presets.
- Implement versioned `.msmotion` templates for selected clips, keyframes,
  relationships, appearances, Replicators, modifiers, media references,
  adjustments, and supported expressions.
- Remap ids safely, preserve relative timing/relationships, report missing media
  or composition dependencies, and instantiate in one undoable batch.
- Integrate the expression evaluator into the same preview/nested/export
  evaluation path with identical results.
- Add inspect/save/apply/instantiate/set-expression/clear-expression domain and
  AI operation modules.
- Implement lower-third, title-card, callout, logo-reveal, loop, kinetic-text,
  and video-wall category contracts.

### L1 contribution

- Provide isolated procedural preset/template fixtures for grids, radial fields,
  seeded modifiers, falloffs, and loops.
- Prove stable instance ids/seeds and expression `index`/`count` behavior after
  template round-trip.

### L3 contribution

- Provide isolated media and adjustment template fixtures for video walls,
  source dependency replacement, timed adjustments, and nested compositions.
- Prove missing/relinked dependencies retain native editable settings.

### L0 integration

- Integrate project schema/load/save, store/history, UI barrels, AI registry,
  policy/batch/catalog, prompts/playbooks, and bounded
  create -> inspect -> capture representative frames -> adjust workflow.
- Verify that high-level playbooks compose semantic tools and never patch Motion
  Design JSON directly.
- Capture the natural-language brand-brief lower-third required scenario.

Wave 4 exits when formal MD8 and `MDX5_REUSABLE_CONTENT_INTEGRATED` are green.

## Wave 5 - MD9 Release Hardening

All lanes work from frozen behavior. Feature changes require reopening the
owning phase gate and repeating affected evidence.

### L1 - performance and GPU/resource hardening

- 10k-instance and large-stack stress fixtures;
- buffer churn, dirty uploads, cache invalidation, texture dimensions, bounds,
  culling, device loss, HMR cleanup, and memory observations;
- deterministic CPU/GPU fingerprints for layouts and modifiers;
- supported-hardware performance evidence with requested/effective limits.

### L2 - persistence, structure, and security hardening

- explicit migrations and fixtures for every historical Motion Design version;
- legacy rectangle/ellipse and current full-project round-trips;
- clipboard, duplicate, split, trim, ripple, save-as, autosave, undo/redo,
  parent graph, preset/template, and missing-dependency regressions;
- expression parser security, budgets, fail-closed behavior, stable-id remapping,
  and one-batch undo.

### L3 - render/media/platform hardening

- preview, target preview, nested composition, direct export, and nested export
  golden fingerprints across primitives, appearances, Replicators, modifiers,
  media, nulls/groups, and adjustments;
- decoder/render reuse, relink, cleanup, long-duration, and source-time stress;
- Windows Chromium and required Linux Chromium/Mesa render evidence before GPU
  approval; record any separately required external-platform packages.

### L0 - release integration

- Run full architecture, unit, store, UI, AI policy/registry, bridge, render,
  export, stress, typecheck, lint, build, and diff gates.
- Audit every model-exposed definition for handler, policy, dispatcher, batch,
  caller, prompt/playbook, and model-catalog parity.
- Audit every mutation for validation, one history transaction, entity ids, and
  revision reporting.
- Remove stale flags, dead scaffolding, schema-only documentation claims, and
  disabled controls for unsupported features.
- Update Motion Design, Keyframes, GPU Engine, Timeline, Project Persistence,
  Export, AI Integration, and AI Bridge documentation from observed behavior.
- Assemble the final evidence index and check MD0-MD9 only from recorded proof.

Wave 5 exits when formal MD9 and `MDX6_RELEASE_GREEN` are green.

## Integration Windows

An integration window is a deliberate stop-the-world period for shared seams.

1. Worker announces a green handoff with exact files and tests.
2. Other lanes do not touch the named integration seam.
3. L0 rereads every dirty target and its diff.
4. L0 integrates the smallest adapter into shared types, stores, UI, renderer,
   export, project, or AI registries.
5. L0 runs focused tests for the worker packet plus adjacent shared-seam tests.
6. L0 runs architecture tests and a scoped lint/typecheck.
7. On green, L0 records the integrated revision/baseline in the plan/evidence
   ledger and reopens non-overlapping worker work.
8. On failure, ownership returns to the originating lane only for its leaf
   modules; L0 retains the shared seam.

Workers never resolve shared-file merge conflicts themselves in this worktree.

## Packet Definition of Ready

A worker packet may start only when:

- its prerequisite coordination and parent phase gates are green;
- input/output contracts and stable ids are frozen for the packet;
- exact write and forbidden-write sets are recorded;
- its shared integration seam and L0 adapter owner are named;
- focused tests, required scenario, parity surfaces, and evidence output are
  listed;
- the worker has reread the current files and dirty diff;
- no other active lane owns any target file.

## Worker Handoff Contract

Every handoff reports:

- packet and gate name;
- behavior implemented and intentionally deferred behavior;
- files added/changed and confirmation that the write set was respected;
- public contract/API consumed and produced;
- focused test, lint, and typecheck commands with counts/results;
- fixtures/evidence created;
- shared seams still requiring L0 integration;
- performance/determinism observations where applicable;
- known risks or unrelated baseline failures;
- confirmation of no live-project mutation, no commit, and no push.

## Test and Evidence Matrix

### Per-packet minimum

- focused unit/domain tests for valid, boundary, and invalid cases;
- stable ids, deterministic result, JSON round-trip, and migration defaults;
- history transaction/revision envelope tests for mutations;
- clip-aware property/capability tests;
- UI and AI operation parity tests where authoring is exposed;
- preview/evaluated-state/render test where pixels are affected;
- scoped ESLint and application TypeScript;
- architecture ownership/gate tests;
- `git diff --check` on the owned scope.

### Per-integration-wave minimum

- all packet tests in the wave and adjacent Motion Design regressions;
- AI definition/handler/policy/batch/catalog parity;
- store/history/project round-trip;
- main preview, nested composition, and export fingerprints;
- production build;
- no regression in completed earlier MD gates.

### Final MD9 minimum

- full `npm test` or the repository's complete Vitest matrix;
- full `npm run lint`;
- application TypeScript and `npm run build`;
- architecture registry and timeline architecture suites;
- bridge/browser required scenarios using disposable projects;
- render/export goldens and platform evidence;
- stress, device-loss, HMR, decoder reuse, and resource cleanup evidence;
- full diff check and documentation/evidence audit.

Targeted commands may use `npx vitest run <files>`, `npx eslint <files>`, and
`.\node_modules\.bin\tsc.cmd -b --pretty false`. The handoff must record the exact
expanded file list; `<files>` is not acceptable in evidence.

## Evidence Layout

Evidence lives under `docs/evidence/motion-design/` with one file per phase or
scenario. Each record includes:

- fixture/project schema version and deterministic fixture id;
- exact UI or AI operation sequence;
- stable entity ids and revision envelopes where applicable;
- representative timeline times and screenshots;
- preview, nested-preview, direct-export, and nested-export fingerprints;
- browser, OS, render host, GPU/driver, and relevant feature flags;
- performance counters and requested/effective limits where applicable;
- save/reload/undo result;
- exact test/build commands and results;
- known unrelated worktree failures, clearly separated from Motion Design.

Suggested records:

- `md0-existing-mvp.md`
- `md1-shapes-appearances.md`
- `md2-authoring-animation.md`
- `md3-replicator-core.md`
- `md4-modifiers-falloffs.md`
- `md5-media-motion.md`
- `md6-structure.md`
- `md7-adjustment-render-graph.md`
- `md8-reusable-ai-content.md`
- `md9-release.md`

## Stop and Escalation Conditions

Pause the affected lane and return control to L0 when:

- a frozen schema must change after another lane consumed it;
- two lanes need the same high-conflict file;
- preview and export require separate evaluation logic;
- a worker would need to bypass property validation, history, revision reporting,
  media-runtime leases, or architecture ownership;
- a performance target requires silent truncation or a platform-specific semantic
  difference;
- evidence would require mutating the open user project;
- an unrelated concurrent change invalidates the packet baseline;
- a required external platform or hardware environment is unavailable.

L0 either schedules a new contract/integration window or records a genuine
external evidence blocker. A blocked evidence environment never converts an
incomplete phase into a completed phase.

## Execution Checklist

- [x] `MD0_EXISTING_MVP_COMPLETE`
- [x] `MD1_SHAPES_AND_APPEARANCES_COMPLETE`
- [x] `MD2_AUTHORING_AND_ANIMATION_COMPLETE`
- [x] `MDX0_BASELINE_CLOSED`
- [x] `MDX1_OWNERSHIP_REGISTERED`
- [x] `MDX2_CONTRACTS_FROZEN`
- [ ] `MD3_REPLICATOR_CORE_COMPLETE`
- [ ] `MD6_STRUCTURE_COMPLETE`
- [ ] `MD7_ADJUSTMENT_LAYERS_COMPLETE`
- [ ] `MDX3_FOUNDATIONS_INTEGRATED`
- [ ] `MD4_MODIFIERS_AND_FALLOFFS_COMPLETE`
- [ ] `MD5_MEDIA_MOTION_COMPLETE`
- [ ] `MDX4_PROCEDURAL_MEDIA_INTEGRATED`
- [ ] `MD8_REUSABLE_AI_CONTENT_COMPLETE`
- [ ] `MDX5_REUSABLE_CONTENT_INTEGRATED`
- [ ] `MD9_MOTION_DESIGN_1_0_RELEASE`
- [ ] `MDX6_RELEASE_GREEN`

The next implementation action is Window 3's recursive MD7 frame-stack contract,
followed by the three disjoint Window 4 packets. MD3/MD6 visible evidence resumes
when browser control becomes available. Shared types, stores, renderers, project
codecs, UI, AI, architecture, and documentation remain L0-owned integration
seams.
