# Motion Design Wave 1 Contract Freeze Report

Date: 2026-07-31  
Gate: `MDX2_CONTRACTS_FROZEN`  
Status: satisfied; final read-only release audit green

## Scope

Wave 1 freezes pure, runtime-handle-free contracts before any MD3-MD8 product
integration enters shared stores, renderers, project codecs, UI, or AI seams.
The work stayed inside the registered L0-L3 write sets and did not mutate the
open user project.

The packet contains 48 source files across the L0 aggregate and three leaf
lanes plus 12 uniquely named freeze/cross-contract test files.

## Frozen decisions

### L0 shared aggregate

- Capability, limit, stable diagnostic, entity/revision, and atomic mutation
  envelopes are versioned and descriptor-safe.
- Mutation batches require exact expected revisions, one operation per entity,
  one history entry, aggregate node/depth budgets, and runtime-free payloads.
- MD6 parent and MD8 template batches are adapted losslessly only after their
  original planner inputs reproduce the exact supplied leaf plan.
- One deeply frozen, serializable `MotionFrameState` is admitted once and bound
  unchanged to preview, nested preview, target preview, and export.
- Replicator, modifier, adjustment, media, structure, and expression outputs
  are recomputed or canonically verified at the aggregate boundary. Revisions,
  clip-local times, stable indexes, effective counts, source identities, and
  pool plans must agree across lanes.
- Maps, decoders, textures, file paths, handles, accessors, symbols, cycles,
  non-finite values, ambiguous NUL-delimited ids, and unbounded payloads fail
  closed.

### L1 MD3 and MD4

- Grid, Linear, and Radial layouts define stable requested/effective ordering,
  inclusive/exclusive radial sampling, bounds, four independent limit sources,
  and a 100,000-instance CPU safety ceiling.
- Every instance preserves separate layout, offset, and final transforms.
  Cumulative and absolute offsets remain distinguishable through MD4.
- Random, Noise, Oscillator, and Field modifiers use explicit deterministic
  seeds, ordered per-instance applications, shape-id falloffs, clip-local time,
  hard work budgets, and opacity clamps after every operation.
- The production legacy bundle adapter splits the existing unversioned
  Replicator definition into MD3 and MD4 without silently dropping modifiers,
  falloff, or distribution data. Unsupported random ordering fails closed.
- Public MD3/MD4 boundaries perform exact descriptor preflights before reads;
  legacy traversal and transformation budgets apply before mapping/allocation.

### L2 MD6 and MD8

- Parenting is an acyclic, canonical, same-composition 2D graph. Groups remain
  explicitly out of Motion Design 1.0 and preservation is operation-time-only.
- Graph/evaluation ids and ordering are exact; node and depth budgets are hard;
  world traversal is iterative. Apply and undo use detached canonical snapshots
  and exact inverse planner provenance.
- Project-local presets and `.msmotion` templates are versioned, dependency-
  inventoried, stable-id remapped, collision-checked, and instantiated as one
  atomic leaf batch. The advertised 10,000 occupied-target-id limit is tested at
  its exact boundary.
- Expressions use a tokenized tiny grammar with no `eval`, property access,
  loops, imports, or arbitrary calls. Time is clip-local, index is zero-based,
  count is effective, precedence is explicit, and source/token/AST/step/JSON
  budgets are hard.
- JSON safety stops globally at budget failure, caps failures, and rejects
  getters without execution.

### L3 MD7 and MD5

- Adjustment stacks produce one revisioned, canonical bottom-to-top operation
  state machine. Source and adjustment transitions, accumulator references,
  effect chains, layer/effect uniqueness, and final output are validated.
- Supported effects and their parameter ranges are frozen for preview, nested
  preview, target preview, and export; executor parity remains a Wave 2 gate.
- Source kinds distinguish opaque timeline media from canonical Motion media,
  titles, and nested compositions. Stable asset ids cannot contain local paths,
  URLs, separators, dot segments, NULs, or runtime fields.
- Image/video/nested timing, fit/fill/stretch/tile parameters, quantization,
  missing/relink state, and the exact source/time/render tuple reuse key are
  frozen.
- Stable media instance indices allow 100,000 while one pool-planning batch is
  bounded at 10,000. Frame/decoder identities include binding revision so a
  relink cannot reuse stale runtime resources.

## Review findings closed

Independent cross-lane and adversarial reviews found and closed:

1. MD3/MD4 loss of layout-versus-offset provenance and unbounded opacity.
2. Missing production migration from existing Replicator modifiers/falloff.
3. MD6 undo plans retaining caller graphs/runtime fields and recursive depth
   overflow.
4. MD7/MD5 source-id mismatch and unbounded adjustment packets.
5. Media stable-index/pool-limit coupling and stale relink reuse.
6. Shallow L0 leaf validation, missing expression/media time/count/revision
   provenance, non-canonical ordering, and fourfold consumer reevaluation.
7. Shared batch revision-key collisions, per-payload-only budgets, incomplete
   leaf mappings, and forged leaf plans.
8. Standalone getter execution, local-path canonicalization, unreachable MD8
   limits, wide-JSON failure amplification, and non-enumerable JSON fields.

Every agent handoff was reviewed by L0 and then rechecked through cross-lane or
adversarial read-only audits. No commit or push was performed.

## Verification

Commands run from the repository root:

- 12 Wave 1 freeze suites: **274/274 tests passed**.
- Complete architecture registry, Motion registry, and Timeline registry:
  **71/71 tests passed**.
- Scoped ESLint over all 48 source files and 12 tests: **passed**.
- Full application `tsc -b --pretty false`: **passed**.
- Final independent release audit: **green; no current MDX2 blocker**.

## Deferred by contract

The following are not Wave 1 claims and remain gated in later waves:

- GPU buffers, shaders, dirty uploads, culling, and named-hardware 10k evidence;
- shared store, persistence, clipboard, history, UI, AI, renderer, nesting, and
  export integration;
- live adjustment executor/effect parity across the four render consumers;
- MediaRuntime decoder/frame leases and performance evidence;
- reusable-content catalog UI and semantic AI workflows;
- MD9 browser/platform/performance/release evidence.
