# Motion Design MD0-MD9 Multilane Execution Plan

Status: Active execution plan; planning complete, implementation waves not started
Date: 2026-07-31
Working branch: `master`
Worktree model: one shared worktree, one main integrator, at most three worker lanes
Change policy: no commit and no push unless the user explicitly changes that instruction

Parent plan: [`motion-design-ai-completion-plan.md`](./motion-design-ai-completion-plan.md)
Completed MD2 packet plan: [`motion-design-phase2-authoring-execution-plan.md`](./motion-design-phase2-authoring-execution-plan.md)
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
| MD0 Existing MVP + AI | Implementation and automated gates recorded complete | Disposable lower-third project; representative preview/export pixel comparison; refresh full gates after concurrent tree changes |
| MD1 Shapes/Appearances | Implementation candidate exists across schema, renderer, UI, AI, persistence, and tests | Disposable-browser preview/export pixel goldens for every primitive/appearance family; resolve any discovered parity defect |
| MD2 Authoring/Animation | Waves A-C implemented, including registry browser, pins, global graph, transactions, and motion paths | Wave D disposable required-scenario evidence; preview/nested-preview/export parity; documentation reconciliation after the unified graph work; focused and full regression refresh |
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
`npx tsc --noEmit -p tsconfig.app.json`. The handoff must record the exact
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

- [ ] `MD0_EXISTING_MVP_COMPLETE`
- [ ] `MD1_SHAPES_AND_APPEARANCES_COMPLETE`
- [ ] `MD2_AUTHORING_AND_ANIMATION_COMPLETE`
- [ ] `MDX0_BASELINE_CLOSED`
- [ ] `MDX1_OWNERSHIP_REGISTERED`
- [ ] `MDX2_CONTRACTS_FROZEN`
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

The next implementation action is Wave 0 only: close the existing MD0-MD2
evidence and regression gaps, then register the exact Wave 1 ownership before
starting capability code.
