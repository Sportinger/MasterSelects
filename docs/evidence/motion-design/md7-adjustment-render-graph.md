# MD7 Adjustment Layer / Render Graph Integration Evidence

Status: implementation integrated; formal gate remains open

Date: 2026-08-01  
Contract: frozen ordered adjustment operation stream, version 1

## Implemented vertical slice

- A single bottom-to-top adjustment planner operates on the accumulated lower
  result. Multiple adjustments, time ranges, opacity, masks, supported blend
  modes, nesting, and deterministic effect order share the same contract.
- Main preview, target preview, nested preview, and export route through the
  shared adjustment compositor path. Nested GPU resources use an occurrence
  namespace so repeated composition instances do not alias resources.
- The layer builder retains textureless adjustment operations instead of
  discarding them. Preview fails closed by omitting invalid operations; export
  throws before rendering an unsupported operation.
- The supported 1.0 effect matrix is Brightness, Contrast, Saturation, Invert,
  and Gaussian Blur. Unsupported effects, adjustment transforms, invalid
  opacity, and unsupported blend modes are rejected before mutation.
- Adjustment Layer is available from the Add menu. The Properties panel exposes
  Adjustment, Effects, and Masks while hiding incompatible Transform and Color
  tabs; inline diagnostics report render compatibility.
- The stale `useRenderGraph` engine flag was removed because the compositor path
  is now the runtime path rather than a dormant rollout branch.
- The CPU worker preview path evaluates adjustment operations and is covered by
  software-painter, preview-frame, and presenting-port regressions.
- Strict one-shot Worker WebGPU video stacks now execute the frozen pass list
  directly: source composite, color-matrix primitives, separable horizontal and
  vertical Gaussian blur, immutable snapshots, and adjustment mix. The old
  generic-effect reconstruction was removed from this path.
- Worker vector masks use namespaced resources and Canvas-parity union,
  subtract, and intersection semantics. Buffers, textures, external mask views,
  and partially allocated resources have explicit success and failure cleanup.
- A fail-closed Worker boundary envelope validates request, target, composition,
  frame index, composition timeline, exactness, expiry, layer ids, source ids,
  and source counts before decoder/GPU work. Autonomous streams reject frozen
  adjustment plans. Producer and Worker use the same epoch clock.
- The semantic `editMotionAdjustment` AI tool implements create, configure,
  move, trim, and remove through the same frozen stack planner. It returns state
  and contract revisions, before/after snapshots, affected clips, created and
  removed effects, planner kinds, diagnostics, and one-entry history receipts.
- Generic `addEffect` and `updateEffect` fail before mutation when an Adjustment
  effect or its parameters are outside the 1.0 matrix. The direct Add-menu store
  action is locked-track/timing safe and has real single-step undo/redo.

## Automated evidence

- Worker CPU preview regression: 3 files / 133 tests passed.
- Adjustment Properties and builder validation: 2 files / 7 tests passed;
  the final Properties component check is 5/5 passed; scoped ESLint passed.
- Add-menu plus timeline interaction regression: 3 files / 29 tests passed.
- AI authoring lane: 7 files / 100 tests passed. Main independently reran the
  five-operation authoring suite (5/5) and then the combined Adjustment UI,
  builder, planner, nested, target-preview, AI, and CPU-worker matrix: 14 files /
  221 tests passed.
- Architecture `getState` classification was tightened during integration:
  reactive UI reads replaced imperative reads, the timeline mutation adapter is
  an explicit adapter boundary, and only three new render/export boundary reads
  remain as hard targets. The final architecture gate passed 2/2.
- Full application `tsc -b`, scoped ESLint, and `git diff --check` passed; the
  diff check emitted existing line-ending warnings only.
- Frozen GPU execution and mask integration: 1 file / 6 tests passed, including
  exact pass order, source-binding rejection, namespaced masks, and allocation
  cleanup. Runtime-envelope/host integration: 4 files / 80 tests passed.
- Final post-review MD7 matrix: 14 files / 157 tests passed. The production
  build (`tsc -b` plus Vite) and scoped MD7 ESLint passed after the final
  composition-identity hardening.

## Visible evidence — recorded 2026-08-01, gate closed

The two former blockers were resolved the same day:

1. Mixed-source strict Worker-GPU execution landed:
   `resolveGpuFrameStackVideoSource` became `resolveGpuFrameStackSource` and now
   resolves `image`, `text`, and `solid`/`color` sources (mapped through the
   existing `sourceKindForRuntimeKind` onto the four frozen
   `MotionAdjustmentSourceKind` values). Covered by
   `motionAdjustmentMixedSourceFrameStackMd7.test.ts` (title-above ordering,
   below-adjustment processing, nested occurrence namespace with own frozen
   plan, fail-closed unrepresentable source, boundary rejection of stale/wrong
   packets) — 4/4, and the combined MD4+MD7 matrix 208/208.
2. The browser-control binding and bridge token were repaired (stale dev-server
   token root cause; single dev server now).

Required scenario, captured in the disposable evidence session
`http://motion-md0-md6md7close2.localhost:5173/?motionDesignEvidenceSession=md6md7close2`
(bridge session `8ac6affc`; the open user project was never touched):

- `editMotionAdjustment` create on video-2 above the 15-star replicator grid:
  brightness 0.3, saturation 0.25, gaussian-blur radius 7 (samples defaulted
  to 5 from the frozen matrix), single-entry atomic history
  (`"Create Adjustment Layer"`), contract revision 18→19, stable effect ids.
- `createTrack` + `createTextClip` "TITLE STAYS SHARP" (Arial 110px, weight
  800) on the new topmost track.
- Screenshot
  [`md7/title-above-adjustment-unaffected.jpg`](./md7/title-above-adjustment-unaffected.jpg)
  at t=2: the stars below the adjustment are visibly brightened, desaturated,
  and blurred; the title above the adjustment is crisp, pure white, and
  unaffected. Timeline shows the ordered stack (title / MD7 Adjustment /
  MD6 Parent Grid).

`MD7_ADJUSTMENT_LAYERS_COMPLETE` is closed. Full repository
release/stress/platform gates remain part of MD9. No live user project was
mutated. No commit or push was made.
