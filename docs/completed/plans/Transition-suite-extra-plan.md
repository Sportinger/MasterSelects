> Status: Archived from `docs/ongoing/` on 2026-06-25 after docs triage; deferred candidates are not active unless explicitly reopened.

> Status: Transition Suite follow-up log with deferred candidates. The current
> shipped suite is implemented, but deliberately planned items such as Datamosh,
> Smooth Cut/Flow, AI/neural transitions, Liquid Melt, and true panel/mesh
> effects remain unimplemented.

# Transition Suite EXTRA Plan

- **Issue:** Follow-up to #196, Transition Suite
- **Original branch:** `issue-196-transition-suite` (merged and deleted)
- **Base:** first-pass Transition Suite in `docs/completed/plans/Transition-suite-plan.md`
- **Date:** 2026-06-15

---

## Purpose

This EXTRA plan extends the first-pass Transition Suite after Crossfade, Dip to
Black, Dip to White, Wipe Left, and Wipe Right are working end to end.

The goal is not to copy Final Cut Pro or DaVinci Resolve wholesale. The goal is
to add the common editorial transitions users expect, while keeping the
MasterSelects implementation timeline-native, serializable, preview/export
shared, and compatible with the existing virtual handle and hold-frame planner.

## Effect QA Gate

Every newly exposed visible transition/effect packet needs real-preview Dev
Bridge screenshot evidence before it can be marked complete. The default check
is a 5-frame grid around the transition plus a full-resolution midpoint frame,
followed by a log scan for runtime errors, missing effect pipelines, and shader
warnings. Record the screenshot paths in this plan or the packet report, and
restore the pre-QA transition after temporary applies.

## Implementation Progress

Verified on 2026-06-15:

- EX0/EX0A foundation started: transition definitions now have
  stable/experimental/planned capability metadata, runtime-enabled registry
  queries, centralized param normalization, and persistence/load normalization
  for transition params.
- Capability gating is wired through the panel list, properties type changes,
  drag/drop acceptance, planner validation, edit operations, AI transition
  handler, linked-audio transition sync, and transition overlay/runtime callers.
- EX0B directional wipe ABI subset is implemented without changing uniform
  buffer size: `transitionType` now distinguishes Wipe Left/Right/Up/Down and
  normal/external compositor shader paths are updated together.
- EX1 Wipe Up and Wipe Down are implemented as leaf transition modules and
  registered in the transition registry.
- EX4 Dip to Color is implemented with a param-driven solid color primitive.
  `TransitionPlan` now carries normalized params through preview/export layer
  assembly, while Dip to Black/White keep their existing IDs and recipes.
- EX0C transform composition is implemented for transition layer assembly.
  Transform primitives apply immutable additive translation, multiplicative
  scale, additive X/Y/Z rotation, and additive Z-depth translation on top of the
  already sampled virtual-handle or hold-frame clip transform.
- EX2 Push Left/Right/Up/Down and Slide Left/Right/Up/Down are implemented as
  transform-driven transition modules, registered in the stable registry, and
  shown with a generic motion thumbnail in the Transitions panel.
- EX3 Circle Iris, Diamond Iris, Square Iris, Clock Wipe, and Center Wipe are
  implemented as mask-driven stable transition modules. `transitionRender`
  now supports directional wipe, shape/iris, clock, and center mask states, and
  both normal and external-video compositor shader paths use the same compact
  `transitionType` mapping.
- EX3 shape follow-up is implemented with `Oval Iris`, `Triangle Iris`,
  `Cross Iris`, and `Star Iris`. These reuse the same `shape-mask`
  transition render state, add `transitionType` values 16-19 in both normal
  and external-video shader paths, and stay under the grouped `Iris` 2D
  family in the panel and Properties UI.
- Transition UI grouping is implemented for the currently related families:
  the Transitions panel and Properties effect selector collapse variant leaf
  IDs into `Wipe`, `Iris`, `Push`, `Slide`, `Dip`, and `Rotate`, while large
  Properties buttons choose direction, wipe mode, iris shape, dip color, or
  2D rotate style.
- EX8 initial 3D foundation is implemented with `Flip Horizontal`,
  `Flip Vertical`, `Card Spin`, and `Tumble Away`. These now opt into
  `scene-3d-panel` rendering when the participant layer has a renderable
  `videoFrame`, `videoElement`, `imageElement`, or `textCanvas`, so whole-card
  transitions can use the native shared-scene camera/MVP/depth plane path while
  unsupported sources fall back to the compositor transform path.
- EX8 follow-up adds `3D Roll` and `3D Spinback` as additional whole-card
  `scene-3d-panel` recipes. The 3D browser now exposes separate `Flip`,
  `Tumble`, `Roll`, and `Spin` families instead of a duplicate top-level `3D`
  card, with Flip and Spin carrying their own draggable variants. They intentionally
  avoid Cube/Door/Fold/Page-Peel claims because transform origins, per-panel
  source UVs, deterministic panel ordering, and strip/mesh geometry are still
  planned infrastructure.
- Transition browsing now separates family cards into `2D` and `3D` sections;
  the Properties effect selector mirrors this with `2D`/`3D` option groups.
- EX12 initial browser scale-up is implemented with collapsible 2D/3D sections
  plus panel-side search over the grouped family cards. The search index
  includes family labels, transition IDs, variant names, descriptions,
  categories, and 2D/3D dimension labels so hidden variants remain discoverable
  without exposing every leaf ID as a top-level card; search results stay
  expanded even when a section was collapsed beforehand. The search index also
  includes family synonyms such as film, analog, depth, lens, matte, and barn.
  Panel item assembly/search and SVG thumbnail rendering are extracted out of
  `TransitionsPanel.tsx` into focused transition panel helpers so the panel
  shell stays below the product-source ceiling while the transition list grows.
  Properties-side transition choice metadata is also extracted from
  `TransitionTab.tsx`, keeping the grouped selector and large choice-button
  glyph metadata below the source ceiling without changing edit operations.
- Transition family cards now show a variant-count badge, and clicking a family
  card in the Transitions panel expands its draggable leaf variants until the
  pointer leaves the panel. Dragging the collapsed family card still uses the
  family default.
- Dev builds now expose capability badges for Stable/Experimental/Planned
  transition metadata in the Transitions panel. Planned metadata is not
  draggable and remains out of production/runtime lists.
- EX13D-MP0 adds a pure deterministic multi-panel ordering planner with stable
  panel IDs, source rects, z-order, seeded ordering, magnetic/center/edge
  strategies, and staggered per-panel progress. EX13D-MP1 promotes
  `Puzzle Push` as the first visible multi-panel transition by adding the
  general `Layer.sourceRect` sampling contract, compositor shader/uniform
  support, and transition-layer panel cloning. EX13D-MP2 promotes
  `Magnetic Tiles` on the same rectangular panel path with center-magnetic
  ordering and tile pull-in motion. EX13D-MP3 promotes `Shatter Glass` as a
  visible rectangular tile-shatter transition on the same multi-panel planner:
  outgoing source-rect tiles fly and rotate away over the incoming clip with
  deterministic seeded ordering. True Voronoi glass shards, cast shadows, and
  `Origami Fold` remain planned until shard, shadow, per-panel UV, and
  pivot/hinge contracts are explicit.
- EX10 first Light-family step is implemented with `Flash`. It uses the shared
  generated-solid layer path plus deterministic multi-segment solid opacity, so
  preview/export stay on the existing transition layer assembly path.
- EX5/EX9 first Stylize procedural-mask step is implemented with
  `Noise Dissolve`. It adds a serializable procedural mask primitive,
  `transitionRender.kind = 'procedural-mask'`, `transitionType` value 11, and
  matching deterministic hash-noise threshold math in the normal and
  external-video compositor shader paths. The UI exposes it through a grouped
  `Stylize` 2D family rather than another one-off top-level leaf.
- EX9 first Glitch-family procedural-mask step is implemented with
  `Block Glitch`. It reuses the same serializable procedural-mask contract with
  a coarser deterministic block rank mask, `transitionType` value 12, matching
  normal/external shader paths, and a grouped `Glitch` 2D family.
- EX9 Analog/Glitch transform follow-up is implemented with `CRT Collapse`.
  It uses only opacity and transform primitives to compress the outgoing clip
  into a horizontal beam and expand the incoming clip from the same beam, so it
  avoids claiming RGB split, signal tear, UV distortion, or frame-history
  behavior before those contracts exist.
- EX9 effect-driven Glitch follow-up is implemented with `RGB Split Glitch`,
  `Mosaic Glitch`, and `Scanline Glitch`. These reuse the transition-scoped
  registered `effect` primitive with existing single-input GPU effects:
  `rgb-split`, `pixelate`, and static `scanlines` (`speed: 0`). Signal Tear,
  animated scanline jitter, Data Corrupt, and Datamosh remain planned until
  deterministic distortion/two-participant/temporal contracts exist.
- EX10 Blur-family first pass is implemented with `Blur Dissolve`. A
  transition-scoped `effect` primitive now appends serializable registered
  GPU effects to incoming/outgoing transition participant layers without
  replacing existing clip effects. The first user-facing use animates
  `gaussian-blur` radius on both clips while opacity cross-dissolves.
- EX5 Blend-family first pass is implemented with `Additive Dissolve`. A
  transition-scoped `blend` primitive temporarily overrides the participant
  layer blend mode inside a progress window, then restores the clip default at
  the endpoint. Crossfade, Blur Dissolve, and Additive Dissolve are grouped
  under one `Dissolve` 2D family in the panel and Properties UI.
- EX5 Blend-family follow-up is implemented with `Non-Additive Dissolve`. It
  uses the same transition-scoped `blend` primitive with a temporary `multiply`
  blend window on incoming, giving the family a darker midpoint without adding
  a fake subtractive shader.
- EX11 first Pattern-family step is implemented with `Checker Wipe`,
  `Venetian Blinds Horizontal`, and `Venetian Blinds Vertical`. These add a
  serializable `pattern` mask primitive, `transitionRender.kind =
  'pattern-mask'`, `transitionType` values 13-15, and matching normalized UV
  math in normal/external compositor shader paths. The UI exposes them through
  one grouped `Pattern` 2D family.
- EX11 Pattern follow-up adds `Random Blocks`, `Paint Splatter`,
  `Zig-Zag Blocks`, `Polka Dot Curtain`, and `Doom Bars` on the same
  deterministic `pattern-mask` primitive with `transitionType` values 20-24 in
  both normal and external-video shader paths.
- EX3 follow-up Barn Door variants are implemented with `Barn Door Horizontal`
  and `Barn Door Vertical`. They intentionally use the existing center-mask
  alpha reveal path (`axis: x/y`) and stay in the grouped `Wipe` 2D family; the
  true hinged/panel Door effect remains planned for a later multi-panel pass.
- EX6/EX10 initial Zoom family is implemented with `Zoom In`, `Zoom Out`, and
  `Spin Zoom`. These use the existing one-layer transform and opacity recipe
  path and stay grouped under a single `Zoom` 2D family in the panel/Properties
  UI.
- EX10 Zoom blur follow-up is implemented with `Zoom Blur`, using the
  transition-scoped `effect` primitive to animate the existing registered
  `zoom-blur` GPU effect on both transition participant layers, plus the same
  grouped Zoom family controls.
- EX10 Motion Blur family is implemented with `Directional Blur` and
  `Whip Pan`. Both animate the registered `motion-blur` GPU effect through the
  transition-scoped `effect` primitive; `Whip Pan` also adds a restrained
  transform offset/scale. The Motion Blur shader mirrors out-of-range sample
  UVs at image edges so fast horizontal blurs do not introduce transparent edge
  gaps.
- EX10 Light/Film follow-up is implemented with `Projector Flicker`,
  `Film Roll`, and `Vignette Bloom`. Projector Flicker uses deterministic
  generated-solid exposure pulses, Film Roll uses vertical transform plus
  transition-scoped `motion-blur` with extra vertical overscan to avoid
  transparent edge gaps, and Vignette Bloom uses existing `glow` and `vignette`
  GPU effects on both transition participants.
- EX10 overlay follow-up is implemented with `Light Sweep`, `Light Leak`,
  `Chroma Leak`, `Lens Flare`, and `Film Burn`. It adds a serializable
  generated `overlay` primitive and cached transparent overlay canvases on the
  same preview/export layer assembly path. Light Sweep uses a moving
  screen-blended light band, Light Leak uses warm deterministic edge streaks,
  Chroma Leak uses magenta/cyan split streaks, Lens Flare uses generated flare
  ghosts and streaks, and Film Burn uses warm burn-edge/exposure overlays. All
  generated overlay cache keys include output size and rounded overlay params.
- EX5 Stylize transform follow-up is implemented with `Rotate Left`,
  `Rotate Right`, and `Rotate 90`. These reuse the existing transform/opacity
  recipe path, stay grouped under the dedicated `Rotate` 2D family separate
  from `Stylize`, and do not introduce a new shader or transition-pass
  primitive.
- Earlier read-only sidecar passes recommended Barn Door/Center variants,
  Shape/Iris expansion, transform-only Rotate/Zoom variants, and keeping
  heavyweight Luma Fade, Signal Tear, Page Peel/Door/Fold/Cube, Datamosh, and
  Smooth Cut/Flow planned until their two-participant, mesh, or temporal
  pipelines exist. That guidance has since been narrowed: Film Burn, Lens
  Flare, and Chroma Leak now use the generated overlay primitive, while Water
  Drop and Swirl use the stable distortion primitive.
- Focused verification passed after the latest Motion Blur changes:
  `npx tsc -b --pretty false` and the focused transition/layer-builder/edit
  operation suite covering 28 test files and 180 tests, including
  `transitionAdditiveDissolveDefinition`,
  `transitionNonAdditiveDissolveDefinition`,
  `transitionBlurDissolveDefinition`, and
  `transitionLensMotionDefinitions`.
- The focused Glitch follow-up verification passed for the expanded
  transition/layer-builder/edit operation suite covering 29 test files and 184
  tests, including `transitionEffectGlitchDefinitions`, plus
  `npx tsc -b --pretty false`.
- The focused Light/Film follow-up verification passed for the expanded
  transition/layer-builder/edit operation suite covering 30 test files and 188
  tests, including `transitionLightFilmDefinitions`, plus
  `npx tsc -b --pretty false`. `git diff --check` reported only existing
  LF/CRLF normalization warnings and no whitespace errors.
- The focused 3D Roll/Spinback follow-up verification passed for the expanded
  transition/layer-builder/edit operation suite covering 30 test files and 190
  tests, including `transition3dDefinitions`, plus
  `npx tsc -b --pretty false`. `git diff --check` again reported only LF/CRLF
  normalization warnings and no whitespace errors.
- The focused EX0 contract follow-up verification passed for
  `transitionRegistry`, `transitionPlanner`, `transitionGroups`, and
  `timelineEditOperations`, covering 4 test files and 86 tests. This adds
  regression coverage for type-change param normalization, stale-param
  dropping, reciprocal param undo/redo, project serialization of known and
  future transition params, planner rejection of planned IDs, and edit-operation
  rejection before clip metadata is written. `npx tsc -b --pretty false` passed
  afterward, and `git diff --check` again reported only LF/CRLF normalization
  warnings and no whitespace errors.
- The focused Light Sweep overlay follow-up verification passed for the
  expanded transition/layer-builder/edit operation suite covering 30 test files
  and 198 tests, including `transitionLightFilmDefinitions` and
  `transitionLayerAssembly`, plus `npx tsc -b --pretty false`.
- The focused Light Leak overlay follow-up verification passed for the expanded
  transition/layer-builder/edit operation suite covering 30 test files and 200
  tests, including `transitionLightFilmDefinitions` and
  `transitionLayerAssembly`, plus `npx tsc -b --pretty false`.
- The focused EX12 panel extraction verification passed for
  `transitionPanelItems`, `TransitionsPanel`, `transitionChoiceMetadata`, and
  `transitionGroups`, covering 4 test files and 18 tests, plus
  `npx tsc -b --pretty false` and focused ESLint on the extracted panel files.
  UI screenshot QA captured the grouped panel through a headless browser at
  `C:\Users\admin\AppData\Local\Temp\masterselects-transitions-panel-desktop.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transitions-panel-narrow.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-transitions-panel-tall.png`;
  the DOM state reported sections `2D12` and `3D1` with the expected 13 family
  cards.
- The focused export parity follow-up expanded `exportLayerBuilder` coverage
  for representative overlay, registered-effect, blend, procedural-mask,
  pattern-mask, and 2.5D transform transition families. It also covers
  hold-frame export source times across Light Sweep, RGB Split Glitch,
  Additive Dissolve, Noise Dissolve, Checker Wipe, and 3D Roll. The focused
  `tests/unit/exportLayerBuilder.test.ts` run passed with 18 tests, plus
  `npx tsc -b --pretty false`.
- The focused EX0B shader parity follow-up added a source-level guard in
  `tests/unit/compositorUniforms.test.ts` that extracts `getTransitionAlpha`
  from both `src/shaders/composite.wgsl` and
  `src/engine/pipeline/compositor/externalCompositeShader.ts`, verifies the
  expected transition type branch list, and requires the normalized WGSL bodies
  to stay identical. `npm run test -- tests/unit/compositorUniforms.test.ts`,
  `npx tsc -b --pretty false`, and focused ESLint on
  `tests/unit/compositorUniforms.test.ts` and
  `tests/unit/exportLayerBuilder.test.ts` passed.
- The focused EX0E overlay/cache follow-up moved generated Light Sweep/Light
  Leak canvas generation into a bounded helper keyed by overlay pattern, color,
  rounded overlay parameters, and output size. Preview passes the active
  composition size into transition assembly, export passes the export
  dimensions through `FrameContext`, and the cache evicts by pixel budget with
  an 8192 per-axis clamp for Mesa-aware canvas sizing. Focused coverage now
  proves direct assembly cache keying by output size, export overlay canvases
  at 1280x720, and preview overlay canvases from a 1280x720 active
  composition. `npm run test -- tests/unit/layerBuilderService.test.ts
  tests/unit/transitionLayerAssembly.test.ts tests/unit/exportLayerBuilder.test.ts`
  passed as part of the focused transition suite, and `npx tsc -p
  tsconfig.app.json --pretty false` passed.
- The focused seeded procedural glitch follow-up added normalized `seed`
  params to Noise Dissolve and Block Glitch, carries the seed into procedural
  transition render state for preview/export, adds a `transitionSeed` compositor
  uniform slot, and uses that seed in both normal and external-video WGSL hash
  inputs for transition types 11 and 12. Default seed `0` preserves existing
  default visuals; non-zero seeds produce deterministic alternate reveal
  orderings. Focused coverage now spans transition definition tests, registry
  normalization, transition layer assembly, export layer assembly, compositor
  uniform reset/packing, and normal/external shader parity.
- The EX12 scalability gate now has a synthetic registry-level test asserting
  the grouped transition panel remains searchable and grouped when the runtime
  registry has at least 60 definitions. The test uses the real registry and
  existing `transitionPanelItems` helper; no production panel changes were
  needed for this gate.
- Deferred and experimental transition gating remains enforced for heavyweight
  follow-ups: `transitionRegistry` asserts Smooth Cut/Flow, AI/neural,
  shatter/puzzle/tile, Page Peel, Datamosh, Liquid Melt, VHS Head Switch, and
  related IDs are absent from the stable runtime registry and cannot be
  resolved through default `getRuntimeTransition`. `Water Drop` and `Swirl`
  have been promoted to stable runtime transitions because they use the shared
  preview/export distortion primitive and appear in the Properties UI.
- EX13A first Distortion Lab slice is implemented for `Water Drop` and
  `Swirl`. A reusable serializable `distortion` primitive now
  compiles to `transitionRender.kind = 'distortion'`, packs transition type
  codes 25-26 plus seed in the existing compositor uniform slots, and remaps
  per-participant UVs in both normal-texture and external-video shader paths.
  `Liquid Melt` and `VHS Head Switch` remain planned because they need richer
  luma/noise melt or bottom-frame tear/chroma/noise behavior.
- Dev-Bridge screenshot QA has been run against the real preview path for
  `noise-dissolve` at the transition midpoint, plus `tumble-away` and
  `block-glitch`, and the Pattern family (`checker-wipe`,
  `venetian-blinds-horizontal`, `venetian-blinds-vertical`) after temporarily
  applying each to the same adjacent clips and undoing back to the previous
  transition. The same screenshot loop has also been run for
  `barn-door-horizontal`, `barn-door-vertical`, `zoom-in`, `zoom-out`, and
  `spin-zoom`, plus the Iris shape expansion (`oval-iris`, `triangle-iris`,
  `cross-iris`, `star-iris`). The accepted Iris captures are the `v2`
  midpoint screenshots after shader-size adjustment. The same real-preview
  loop has been run for `rotate-left`, `rotate-right`, and `rotate-90`; the
  `rotate-90` capture intentionally uses a post-midpoint frame because the
  recipe has a hard 50% handoff. The same loop also verified the EX11 Pattern
  follow-up (`random-blocks`, `paint-splatter`, `zig-zag-blocks`,
  `polka-dot-curtain`, `doom-bars`) at the cut midpoint and restored the
  previous `noise-dissolve` transition after each capture. `CRT Collapse` was
  verified with a Dev-Bridge 5-frame grid plus full-resolution midpoint capture
  and the same restore-to-`noise-dissolve` check. `Blur Dissolve` was verified
  through the same real-preview Dev Bridge path with
  `C:\Users\admin\AppData\Local\Temp\masterselects-blur-dissolve-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-blur-dissolve-mid.png`;
  the log check reported no `No pipeline for effect type` warnings and no
  errors, and the timeline was restored to `noise-dissolve`. `Zoom Blur` was
  verified the same way with
  `C:\Users\admin\AppData\Local\Temp\masterselects-zoom-blur-grid.png` and
  `C:\Users\admin\AppData\Local\Temp\masterselects-zoom-blur-mid.png`, again
  with no missing-pipeline warnings or errors and with the timeline restored.
  `Additive Dissolve` was verified with
  `C:\Users\admin\AppData\Local\Temp\masterselects-additive-dissolve-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-additive-dissolve-mid.png`,
  with no error logs and the same restore check. `Non-Additive Dissolve` was
  verified with
  `C:\Users\admin\AppData\Local\Temp\masterselects-non-additive-dissolve-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-non-additive-dissolve-mid.png`.
  `Directional Blur` and `Whip Pan` were verified after the Motion Blur shader
  edge-sampling adjustment with
  `C:\Users\admin\AppData\Local\Temp\masterselects-directional-blur-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-directional-blur-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-whip-pan-grid.png`, and
  `C:\Users\admin\AppData\Local\Temp\masterselects-whip-pan-mid.png`; the log
  checks reported no errors, no missing-pipeline warnings, no shader warnings,
  and the timeline restored to `noise-dissolve` after each temporary apply.
  The same loop verified `RGB Split Glitch`, `Mosaic Glitch`, and
  `Scanline Glitch` with
  `C:\Users\admin\AppData\Local\Temp\masterselects-rgb-split-glitch-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-rgb-split-glitch-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-mosaic-glitch-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-mosaic-glitch-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-scanline-glitch-grid.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-scanline-glitch-mid.png`;
  there were no error logs, missing-pipeline warnings, or shader warnings, and
  the timeline restored to `noise-dissolve` after each capture.
  `Projector Flicker`, `Film Roll`, and `Vignette Bloom` were verified through
  the same Dev-Bridge real-preview loop with 5-frame grids and full-resolution
  midpoint captures:
  `C:\Users\admin\AppData\Local\Temp\masterselects-projector-flicker-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-projector-flicker-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-film-roll-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-film-roll-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-vignette-bloom-grid.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-vignette-bloom-mid.png`.
  The log checks reported no errors, missing-pipeline warnings, or shader
  warnings. Film Roll was recaptured after increasing vertical overscan, and
  the timeline restored to the pre-QA `directional-blur` transition after each
  temporary apply.
  `3D Roll` and `3D Spinback` were verified through the same Dev-Bridge
  real-preview loop with 5-frame grids and full-resolution midpoint captures:
  `C:\Users\admin\AppData\Local\Temp\masterselects-roll-3d-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-roll-3d-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-spinback-3d-grid.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-spinback-3d-mid.png`.
  The log checks reported no errors, missing-pipeline warnings, or shader
  warnings, and the timeline restored to the pre-QA `directional-blur`
  transition after each temporary apply.
  After the `scene-3d-panel` switch, `Flip Horizontal`, `Card Spin`,
  `3D Roll`, and `3D Spinback` were recaptured through the Dev Bridge on the
  real preview path with GPU grids and midpoint frames:
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-3d-captures-20260615-125917\masterselects-flip-horizontal-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-3d-captures-20260615-125917\masterselects-card-spin-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-3d-captures-20260615-125917\masterselects-roll-3d-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-3d-captures-20260615-125917\masterselects-spinback-3d-grid.png`,
  plus matching `*-mid.png` captures in the same directory. Shader, pipeline,
  scene, and warning log searches returned zero matches; only unrelated media
  output device errors were present in the broader error search. The timeline
  restored to the pre-QA `flip-horizontal` transition.
  `Light Sweep` was verified through the same Dev-Bridge real-preview loop with
  a 5-frame grid and full-resolution midpoint capture:
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-sweep-grid.png` and
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-sweep-mid.png`.
  The log checks reported no errors, missing-pipeline warnings, runtime
  diagnostics errors, or shader warnings, and the timeline restored to the
  pre-QA `directional-blur` transition after the temporary apply.
  `Light Leak` was verified through the same Dev-Bridge real-preview loop with
  a 5-frame grid and full-resolution midpoint capture:
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-leak-grid.png` and
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-leak-mid.png`.
  The log checks reported no errors, missing-pipeline warnings, runtime
  diagnostics errors, or shader warnings, and the timeline restored to the
  pre-QA `directional-blur` transition after the temporary apply.
  After the EX0E output-size cache change, a headless Dev-Bridge QA attempt on
  a synthetic two-solid-clip timeline produced capture files for `Light Sweep`
  and `Light Leak`:
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-sweep-outputsize-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-sweep-outputsize-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-leak-outputsize-grid.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-light-leak-outputsize-mid.png`.
  Visual inspection showed black frames and Headless Chrome logged WebGPU
  adapter initialization errors, so this run is not accepted as visual evidence
  and does not close the global no-error Dev-Bridge gate.
  A follow-up visible-browser Dev-Bridge QA pass on 2026-06-15 used DOM-mode
  transition-progress sampling instead of `getCutPreviewQuad`, producing
  7-frame progress grids (stricter than the 5-frame default) plus
  full-resolution midpoint captures for the remaining exposed runtime
  candidates:
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\flash-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\flash-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\chroma-leak-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\chroma-leak-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\lens-flare-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\lens-flare-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\film-burn-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\film-burn-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\water-drop-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\water-drop-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\swirl-grid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\swirl-mid.png`,
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\kaleidoscope-grid.png`,
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-transition-qa-20260615-151756\kaleidoscope-mid.png`.
  Visual inspection confirmed nonblank renders with visible overlay, UV
  distortion, and kaleidoscope effects. Log checks reported zero browser
  errors, zero `No pipeline for effect type` matches, zero runtime diagnostics
  errors, and zero shader warnings for each transition. The timeline restored
  to the pre-QA `lens-flare` transition after each temporary apply.
  The first visible multi-panel runtime transition, `Puzzle Push`, was verified
  in the same DOM-mode real-preview loop after the `Layer.sourceRect` sampling
  contract landed, with:
  `C:\Users\admin\AppData\Local\Temp\masterselects-puzzle-push-qa-20260615-153934\puzzle-push-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-puzzle-push-qa-20260615-153934\puzzle-push-mid.png`.
  Visual inspection showed distributed panel slices instead of a collapsed
  center block. Log checks reported zero browser errors, zero missing-pipeline
  matches, zero runtime diagnostics errors, and zero shader warnings, and the
  timeline restored to the pre-QA `lens-flare` transition.
  `Magnetic Tiles` was verified through the same visible-browser DOM-mode
  Dev-Bridge path after switching the recipe to an ease-in magnetic pull so
  the center-cut midpoint remains visibly tiled:
  `C:\Users\admin\AppData\Local\Temp\masterselects-magnetic-tiles-qa-20260615-160244\magnetic-tiles-cut-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-magnetic-tiles-qa-20260615-160244\magnetic-tiles-mid.png`.
  The broader progress-grid QA is also stored at
  `C:\Users\admin\AppData\Local\Temp\masterselects-magnetic-tiles-qa-20260615-155932\magnetic-tiles-grid.png`.
  Visual inspection confirmed the incoming tiles pull from the center over the
  outgoing frame before settling into the incoming clip. Log checks reported
  zero browser errors, zero missing-pipeline matches, zero runtime diagnostics
  errors, and zero shader warnings, and the timeline restored to the pre-QA
  `lens-flare` transition.
  `Shatter Glass` was verified through the same visible-browser DOM-mode
  Dev-Bridge path after promotion to the runtime multi-panel planner:
  `C:\Users\admin\AppData\Local\Temp\masterselects-shatter-glass-qa-20260615-165150\shatter-glass-grid.png`
  and
  `C:\Users\admin\AppData\Local\Temp\masterselects-shatter-glass-qa-20260615-165150\shatter-glass-mid.png`.
  Visual inspection confirmed rectangular outgoing panel slices rotating and
  flying away over the incoming clip. The midpoint capture came from
  `renderTarget:preview` at 1920x1080. Runtime diagnostics and
  transition-filtered WARN logs both reported zero entries, and the timeline
  restored to the pre-QA `lens-flare` transition with the same duration and
  default color.
- A read-only Light/Blur sidecar recommends the next EX10 step as a small
  transition-scoped `effect` primitive contract that appends existing
  `Layer.effects` to transition participants. That enables an honest
  `Blur Dissolve` using the existing effects pipeline; that recommendation is
  now implemented for single-input registered effects. The first generated
  overlay primitive is implemented for `Light Sweep`, `Light Leak`,
  `Chroma Leak`, `Lens Flare`, and `Film Burn`; the generated overlay cache
  model is now output-size-aware and bounded.

---

## Research Anchors

Use these as product references when prioritizing transition families:

- Apple Final Cut Pro documentation:
  - Add transitions and fades:
    `https://support.apple.com/guide/final-cut-pro/add-transitions-and-fades-ver761c7432/mac`
  - Adjust transitions in the inspector and viewer:
    `https://support.apple.com/guide/final-cut-pro/adjust-transitions-inspector-viewer-vercf3c6b27/mac`
  - Flow transition for jump cuts:
    `https://support.apple.com/guide/final-cut-pro/merge-jump-cuts-with-the-flow-transition-ver46d0179ac/mac`
- Blackmagic Design DaVinci Resolve 20 Reference Manual:
  `https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_20_Reference_Manual.pdf`
- Adobe Premiere Pro transition references:
  - Classic transition list:
    `https://helpx.adobe.com/premiere/desktop/add-video-effects/effects-and-transitions-library/list-of-video-transitions.html`
  - Modern transitions:
    `https://helpx.adobe.com/premiere/desktop/add-video-effects/types-of-effects/transitions.html`
- FFmpeg `xfade` filter reference:
  `https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/xfade.html`
- GL transition shader references:
  - Open GL Transitions specification and collection:
    `https://github.com/gl-transitions/gl-transitions`
  - Legacy GLSL transition runtime/spec notes:
    `https://github.com/gre/glsl-transition`
  - Collection examples: `cube`, `GridFlip`, `GlitchDisplace`,
    `DoomScreenTransition`, `WaterDrop`, `kaleidoscope`, `BookFlip`,
    `hexagonalize`, `luminance_melt`, `TVStatic`, `windowblinds`.

Commonly recurring families from these references:

- Dissolve: Cross Dissolve, Additive Dissolve, Blur Dissolve, Dip to Color,
  Non-Additive Dissolve, Smooth Cut / Flow-like jump-cut repair.
- Wipe: Edge Wipe, Center Wipe, Clock Wipe, Radial Wipe, Venetian Blind Wipe,
  Band Wipe, X Wipe.
- Iris / Shape: Circle/Oval Iris, Diamond Iris, Square Iris, Triangle Iris,
  Cross Iris.
- Motion: Push, Slide, Pan, Barn Door.
- Fusion / stylized: Noise Dissolve, Slice Push, Rotate, Foreground Wipe.
- 3D / depth: Cube Spin, Flip, Fold, Page Peel, 3D Spin, 3D Roll,
  3D Spinback.
- Glitch / digital: Mosaic, Random Blocks, Chaos, chroma distortion, block
  motion, signal breakup, RGB split.
- Light / film / analog: Flash, Light Leak, Chroma Leak, Light Sweep, Glow,
  Flare, Film Roll, burn edges.
- Warp / speed: Zoom Blur, Radial Blur, Directional Blur, Stretch, Wave,
  Whip, Mobius-style zoom.
- Exotic shader transitions: Water Drop, Kaleidoscope, Fly Eye, Doom Bars,
  Book Flip, Hex Pixelize, Puzzle Push, Polka Dot Curtain, Butterfly Wave,
  Luminance Melt, Stereo Viewer, Swirl, TV Static.

---

## Current Constraints

The current implementation is intentionally small and solid:

- `src/transitions/types.ts` supports opacity, generated solid colors, simple
  wipe/shape/clock/center mask primitives, procedural noise/block mask
  primitives, pattern mask primitives, blend primitives, transform primitives
  for layer translateX/Y/Z, scaleX/Y, rotateX/Y/Z, generated overlay
  primitives for deterministic light/film/lens overlays, UV distortion
  primitives, and transition-scoped registered effect primitives for
  incoming/outgoing participants. It does not yet support luma, matte,
  two-participant color comparison, temporal frame-history, or multi-panel
  primitives.
- `src/types/layers.ts` exposes `transitionRender` for directional wipes,
  shape/iris masks, clock wipes, center wipes, procedural noise/block masks,
  pattern masks, and per-participant UV distortion, but not for
  luma, matte, temporal, or multi-panel masks.
- `src/engine/pipeline/compositor/uniforms.ts`,
  `src/shaders/composite.wgsl`, and
  `src/engine/pipeline/compositor/externalCompositeShader.ts` encode
  directional wipe, iris, clock, center, procedural noise/block, pattern mask,
  and distortion modes with `transitionType` values 1-26.
- `TimelineTransition` already supports serializable `params`, and
  `TransitionTab` can edit them through transition edit operations. The current
  normalization path is schema-driven; newly param-heavy transition families
  still need focused persistence, undo/redo, and forward-compatibility tests.
- Unknown params have to preserve forward compatibility for unrecognized future
  transition types, while known transition definitions drop params not present
  in their schema.
- `TransitionsPanel` is grouped and searchable for the current variant
  families, but its thumbnail preview logic still needs a generic
  primitive/family renderer before dozens of definitions are exposed.
- The current compositor path is not a GL-style direct `from`/`to` transition
  shader. It composites an accumulated base texture with one current layer
  texture. Per-participant UV distortion is now supported for Water Drop and
  Swirl, but luma fades, two-clip color comparison, and temporal
  effects still need a dedicated transition pass before they are exposed.
- The current 2.5D transition path has whole-layer X/Y/Z transform support, but
  no transform origin, per-panel source UV rectangles, or strip/mesh subdivision
  model. Cube, Door, Fold, and Page Peel should stay planned until those
  contracts exist instead of being faked as single-card rotations.

The next wave should extend those contracts first, before adding many names to
the registry.

---

## Product Priority

### Tier 1: Common Editorial Basics

These should ship first because they are familiar, useful, and technically
close to the current renderer.

| Transition | Family | Notes |
|---|---|---|
| Wipe Up | Wipe | Extend wipe axis to vertical. |
| Wipe Down | Wipe | Same primitive as Wipe Up with inverted direction. |
| Push Left | Motion | Incoming pushes outgoing; requires transform primitive. |
| Push Right | Motion | Same as Push Left with reversed vector. |
| Push Up | Motion | Vertical push. |
| Push Down | Motion | Vertical push. |
| Slide Left | Motion | Incoming slides over outgoing. |
| Slide Right | Motion | Same primitive with reversed vector. |
| Slide Up | Motion | Vertical slide. |
| Slide Down | Motion | Vertical slide. |
| Dip to Color | Dissolve | Uses existing transition params, after validation/persistence hardening. |

### Tier 2: Shape And Mask Transitions

These need generalized mask primitives but no optical flow.

| Transition | Family | Notes |
|---|---|---|
| Circle Iris | Iris | Radial reveal from center, optional feather. |
| Oval Iris | Iris | Implemented as an analytic horizontal oval shape mask. |
| Diamond Iris | Iris | Diamond/signed-distance mask. |
| Square Iris | Iris | Rectangular center reveal. |
| Triangle Iris | Iris | Implemented as an analytic triangle shape mask. |
| Cross Iris | Iris | Implemented as an analytic cross shape mask. |
| Star Iris | Iris | Implemented as an analytic five-point star shape mask. |
| Clock Wipe | Wipe | Angular radial reveal. |
| Radial Wipe | Wipe | Circular sweep variant. |
| Center Wipe | Wipe | Open from center horizontally/vertically. |
| Venetian Blinds | Wipe/Pattern | Implemented as horizontal and vertical normalized UV pattern masks; count params remain planned. |
| Barn Door Horizontal | Wipe/Shape | Implemented as center-out alpha reveal on the existing center-mask path; hinged panels remain planned. |
| Barn Door Vertical | Wipe/Shape | Implemented as center-out alpha reveal on the existing center-mask path; hinged panels remain planned. |

### Tier 3: Stylized Dissolves

These should wait until the transition renderer can compile effect/blend
primitives consistently for preview and export.

| Transition | Family | Notes |
|---|---|---|
| Additive Dissolve | Dissolve | Implemented with a transition-scoped `add` blend window on incoming. |
| Non-Additive Dissolve | Dissolve | Implemented with a transition-scoped `multiply` blend window on incoming for a darker midpoint. |
| Blur Dissolve | Dissolve | Implemented with transition-scoped `gaussian-blur` effects on both participants. |
| Noise Dissolve | Stylized | Procedural threshold/noise alpha. |
| Film Dissolve | Dissolve | Curve/gamma-like dissolve style. |
| Rotate Left | Rotate | Implemented as 2D transform plus opacity. |
| Rotate Right | Rotate | Implemented as 2D transform plus opacity. |
| Rotate 90 | Rotate | Implemented as 2D transform plus opacity with a hard midpoint handoff. |
| Slice Push | Stylized | Multi-column transform mask. |

### Tier 4: 3D And Depth Transitions

These are highly visible and expected in modern editors, but they should be
implemented after transform primitives are stable. The current whole-card
Flip/Card/Roll/Spinback pass uses `scene-3d-panel` rendering on the native
shared-scene camera/depth plane path when the source can be uploaded as a
scene plane. Cube, Door, Fold, and Page Peel still need transform origin and/or
multi-panel contracts before they become realistic.

| Transition | Family | Notes |
|---|---|---|
| Cube Spin Left | 3D | Two textured planes rotate like cube faces. |
| Cube Spin Right | 3D | Same model with reversed yaw. |
| Flip Horizontal | 3D | Outgoing/incoming flip around the Y axis. |
| Flip Vertical | 3D | Flip around the X axis. |
| Door Open | 3D | Split outgoing into hinged left/right panels. |
| Door Close | 3D | Incoming panels close over outgoing or reverse. |
| Fold Up | 3D | Paper-fold style transform; start as 2-panel. |
| Page Peel | 3D/Shape | Requires curved page or approximated mesh/strip peel. |
| Card Spin | 3D | Single-card spin with opacity swap near edge-on. |
| Tumble Away | 3D | Implemented as a whole-card `scene-3d-panel` transition with compositor fallback. |
| 3D Roll | 3D | Implemented as a whole-card `scene-3d-panel` X-axis roll with opacity handoff. |
| 3D Spinback | 3D | Implemented as a whole-card `scene-3d-panel` depth spinback; no panel slicing. |

Implementation guidance:

- Whole-card 3D transitions should prefer `renderMode: 'scene-3d-panel'` so
  eligible participants enter the native scene camera/MVP/depth renderer.
  The normal compositor transform path remains the fallback for unsupported
  source states.
- Split/panel transitions need either multiple generated sublayers per
  participant or a fragment shader that can gate/slice local UVs.
- Page Peel should be deferred until the renderer can generate a curved mesh or
  approximate it with enough vertical strips to look intentional.
- True 3D shared-scene transitions must not hijack normal 3D asset rendering;
  they are transition-time render constructs and should stay opt-in by
  transition metadata.

### Tier 5: Glitch And Digital Damage

These are common in social, music, gaming, tech, trailer, and short-form edits.
They should not be implemented as random per-frame hacks; they need seeded,
deterministic render state so preview, export, undo/redo, and re-opened
projects match.

| Transition | Family | Notes |
|---|---|---|
| RGB Split Glitch | Glitch | Implemented with transition-scoped registered `rgb-split` effects on both participants. |
| Block Glitch | Glitch | Implemented first as deterministic random block reveal; tile offsets remain planned. |
| Mosaic Glitch | Glitch | Implemented with transition-scoped registered `pixelate` effects on both participants. |
| Scanline Glitch | Glitch | Implemented with static transition-scoped registered `scanlines` effects; jitter/flicker remain planned. |
| Signal Tear | Glitch | Horizontal displacement tears with chroma edges. |
| CRT Collapse | Analog/Glitch | Implemented as transform/opacity collapse to a horizontal beam; scanlines and beam glow remain planned. |
| Digital Noise Dissolve | Glitch | Thresholded noise reveal; deterministic seed. |
| Data Corrupt | Glitch | Blocks, RGB split, brief posterize/invert. |
| Stutter Cut | Glitch/Time | Repeated held frames around cut; export must match. |
| Datamosh | Glitch/Temporal | Deferred; needs motion-vector/frame-history model. |

Implementation guidance:

- Add `seed` as a validated param for every procedural glitch transition.
- Use timeline time plus seed for deterministic noise, not `Math.random()`.
- Keep glitch render state compact: block size, displacement amount, chroma
  offset, scanline density, threshold, seed.
- Avoid relying on prior frames for first-pass glitch transitions. Anything
  that needs frame history, motion vectors, or inter-frame compression artifacts
  belongs in a later temporal-transition pipeline.
- Provide intensity defaults that are energetic but not destructive. Glitch
  should be editable by duration and intensity.

### Tier 6: Light, Film, Analog, And Lens Transitions

These add polish without requiring optical flow, but they need generated
textures, blend modes, or procedural overlays.

| Transition | Family | Notes |
|---|---|---|
| Flash | Light | Overexpose to white or color, then reveal incoming. |
| Light Leak | Light/Film | Implemented as cached deterministic warm edge/streak overlays plus dissolve. |
| Chroma Leak | Light/Glitch | Implemented as cached deterministic magenta/cyan generated overlays plus dissolve. |
| Light Sweep | Light | Implemented as a cached generated overlay canvas with a moving screen-blended light band. |
| Lens Flare | Light | Implemented as cached deterministic flare streak/ghost overlays. |
| Film Burn | Film | Implemented as cached deterministic burn-edge/exposure overlays. |
| Film Roll | Film | Implemented as vertical transform plus transition-scoped `motion-blur`, with vertical overscan to avoid transparent edge gaps. |
| Projector Flicker | Film | Implemented as deterministic generated-solid exposure pulses over a dissolve. Gate weave remains planned. |
| Vignette Bloom | Lens | Implemented with transition-scoped `glow` and `vignette` effects on both participants. |
| Zoom In | Zoom/Motion | Implemented as transform-only zoom/dissolve; no blur pass. |
| Zoom Out | Zoom/Motion | Implemented as transform-only zoom/dissolve; no blur pass. |
| Spin Zoom | Zoom/Motion | Implemented as transform-only zoom plus restrained Z rotation. |
| Zoom Blur | Lens/Motion | Implemented with transition-scoped registered `zoom-blur` effects on both participants. |
| Directional Blur | Lens/Motion | Implemented with transition-scoped registered `motion-blur` effects on both participants. |
| Whip Pan | Lens/Motion | Implemented with registered `motion-blur` plus restrained horizontal transform/scale. |

Implementation guidance:

- Prefer procedural overlays over bundled video assets unless reusable asset
  import/caching is needed for a higher-quality pack.
- Generated overlays must be resolution-independent and export deterministic.
- Blur-heavy transitions may need a pass planner, not only one-layer shader
  uniforms.
- Film/analog transitions should expose intensity, color, seed, and softness
  once params are available.

### Tier 7: Pattern, Graphic, And Editorial Utility

These are useful for title-heavy, presentation, recap, sports, and social edits.

| Transition | Family | Notes |
|---|---|---|
| Checker Wipe | Pattern | Implemented as deterministic checkerboard pattern mask; tile count params remain planned. |
| Random Blocks | Pattern | Implemented as large deterministic seeded block ordering. |
| Paint Splatter | Pattern | Implemented as deterministic hard-edged splat cells. |
| Star Wipe | Shape | Star-shaped reveal; niche but expected. |
| Zig-Zag Blocks | Pattern | Implemented as a deterministic jagged edge pattern mask. |
| Frame Push | Graphic | Border/frame animates over cut. |
| Mirror Slide | Motion | Mirrored edge fill during slide. |
| Elastic Stretch | Warp | Stretch outgoing/incoming around cut. |
| Wave Warp | Warp | Ripple transition. |
| Luma Fade | Key/Mask | Reveal based on source luma. |

Implementation guidance:

- Pattern transitions should use normalized UV math, not bitmap masks, unless
  user-imported matte transitions are intentionally added later.
- Luma Fade is a good bridge toward custom matte transitions, but it requires
  sampling one participant to drive the other's alpha. Plan it separately from
  simple procedural masks.

### Tier 8: Exotic Shader Lab

These are not first-wave editing basics. They are good for a "Transitions Lab"
or experimental pack once the renderer can support procedural masks,
distortion, generated overlays, and deterministic randomness.

| Transition | Family | Notes |
|---|---|---|
| Water Drop | Exotic/Warp | Implemented as stable per-participant seeded UV ripple distortion. |
| Liquid Melt | Exotic/Warp | Vertical luminance/noise melt where pixels drip into the next clip. |
| Luminance Melt | Exotic/Key | Bright/dark regions dissolve at different rates. |
| Kaleidoscope | Exotic/Pattern | Mirror-fold UVs around center, then mix into incoming. |
| Fly Eye | Exotic/Lens | Honeycomb lens cells sample offset copies of the image. |
| Hex Pixelize | Exotic/Pattern | Hexagonal cells resolve from outgoing to incoming. |
| Puzzle Push | Exotic/Pattern | Implemented as the first visible multi-panel source-rect reveal. |
| Polka Dot Curtain | Exotic/Pattern | Implemented through the deterministic pattern mask path: expanding dot cells. |
| Doom Bars | Exotic/Retro | Implemented through the deterministic pattern mask path: staggered vertical bars. |
| Stereo Viewer | Exotic/3D | Split red/cyan or side-by-side stereoscopic skew during cut. |
| Swirl | Exotic/Warp | Implemented as stable seeded center-weighted UV swirl distortion. |
| Wormhole Zoom | Exotic/Warp | Tunnel/radial zoom with chromatic edge distortion. |
| VHS Head Switch | Analog/Glitch | Bottom-frame horizontal wobble and noise tear. |
| CRT Collapse | Analog/Glitch | Image collapses to horizontal/vertical beam, then expands. |
| Thermal Bloom | Stylized/Color | Heat-map color ramp blooms through the cut. |
| Ink Bleed | Organic/Mask | Expanding soft procedural ink mask. |
| Smoke Reveal | Organic/Overlay | Noise-flow alpha reveal with soft smoke-like edges. |
| Shatter Glass | Exotic/Pattern | Implemented as deterministic rectangular source-rect tiles that rotate/slide away; true Voronoi shards and cast shadows remain planned. |
| Magnetic Tiles | Exotic/Pattern | Implemented as center-magnetic source-rect tiles pulling into place. |
| Origami Fold | Exotic/3D | Multiple panels fold like paper. |
| Portal Ring | Exotic/3D/Light | Ring mask with glow opens to incoming clip. |
| Neural Dream | Stylized/AI | Deferred; requires generated intermediate frames or style pass. |

Implementation guidance:

- Treat these as recipes, not one-off shader dumps. Every transition must map
  to reusable primitives: pattern mask, UV distortion, overlay, transform, or
  multi-panel.
- Start with procedural full-screen shader versions for Water Drop, Swirl,
  Kaleidoscope, Hex Pixelize, Doom Bars, Ink Bleed, and CRT Collapse.
- Treat Shatter Glass, Magnetic Tiles, Puzzle Push, and Origami Fold as
  multi-panel transitions. Puzzle Push, Magnetic Tiles, and Shatter Glass now
  prove the rectangular source-rect/panel-clone path; Origami Fold and true
  glass-shard variants still need shard, shadow, per-panel UV, or hinge
  semantics before promotion.
- Treat Smoke Reveal, Portal Ring, Thermal Bloom, and VHS Head Switch as
  overlay/distortion composites with explicit pass plans.
- Keep "Neural Dream" and any AI/morph-driven transition planned only until
  the derived-frame cache, model choice, and export pipeline are defined.
- Expose the lab pack behind an experimental capability flag until visual
  quality and performance are proven.

### Deferred: Optical-Flow Repair

Flow / Smooth Cut should be treated as a separate feature, not a normal shader
transition. It needs frame analysis, optical flow or morphing, quality modes,
and probably cached derived frames. Do not add a placeholder registry ID until
the implementation can produce a meaningful preview/export result.

---

## Architecture Targets

1. Keep transitions timeline-native two-clip objects. Do not model them as
   ordinary one-clip effects.
2. Keep durable project state serializable. No DOM/media handles, GPU objects,
   frames, canvases, or decoder instances in transition metadata.
3. Harden the existing `TimelineTransition.params` path with typed validation,
   load-time normalization, explicit unknown-param policy, and focused
   persistence/undo tests before broad param-heavy transitions ship.
4. Compile transition definitions into a small runtime render model before hot
   preview/export loops.
5. Keep preview and export on the same transition layer assembly path.
6. Make shader support generic enough that adding a transition does not require
   touching the planner.
7. Keep no-transition compositor uniforms byte-compatible unless an actual
   `transitionRender` state is present.
8. Use the existing virtual handle and hold-frame semantics for every new
   transition type.
9. Add any richer transition shader ABI serially and update both normal texture
   and external-video compositor shader paths together.
10. Treat true two-participant shaders as a separate transition pass, not as an
    incremental extension of the current accumulated-base plus current-layer
    compositor path.

---

## Effect Construction Patterns

Good transitions should compile to a small set of reusable render approaches.
The GL transition model is the cleanest target mental model: two textures,
`from` and `to`, are sampled with normalized `uv` coordinates while a
normalized `progress` value moves from `0` to `1`. FFmpeg `xfade` exposes the
same idea through progress `P`, coordinates `X/Y`, frame size `W/H`, and
accessors for the first and second inputs. Resolve/Fusion transitions use the
same structure at a node level: two MediaIn inputs feeding masks, transforms,
dissolves, and node groups.

MasterSelects does not currently have that direct two-texture transition pass.
Today transition assembly produces ordinary layers that the compositor blends
one at a time over an accumulated base. Effects that need simultaneous raw
outgoing and incoming samples must wait for a dedicated two-participant
transition compositor/pass.

| Effect family | Good construction approach | MasterSelects primitive target |
|---|---|---|
| Cross/film/additive dissolve | Blend `from` and `to` with a curve; optional blend-mode override or gamma-style curve. | `opacity`, `blend`, `curve`. |
| Dip/flash/blur-to-color | Fade outgoing to a generated solid/overlay, then fade incoming up. | `solid`, `opacity`, `overlay`, optional `effect`. |
| Linear/diagonal wipe | Compute a signed distance from a moving line in UV space; use smoothstep for softness. | `linear-mask`. |
| Shape/iris/star wipe | Compute signed distance to shape boundary; reveal where distance is inside progress threshold. | `shape-mask`, `pattern-mask`. |
| Clock/radial wipe | Convert UV to polar angle around center; reveal angular segment based on progress. | `clock-mask`. |
| Venetian/blinds/stripe | Repeat UV into cells/stripes, then reveal each stripe with optional stagger. | `stripe-mask`, `pattern-mask`. |
| Checker/random blocks | Quantize UV into tiles; derive deterministic order from tile index plus seed. | `pattern-mask` with `seed`. |
| Luma fade/matte dissolve | Sample luma from one participant or matte; compare against progress threshold with softness. | dedicated luma/matte shader path. |
| Push/slide/whip | Move participant layer transforms over progress; add blur only as a separate pass. | `transform`, optional `effect`. |
| Cube/flip/card/door | Project UV or layer planes through perspective-like X/Y rotation; sample only in-bounds faces. | `transform3d` first, mesh/panel later. |
| Page peel/book flip | Approximate curled page with strip mesh or segmented UV warp; add shadow/highlight. | deferred `multiPanel` or mesh transition. |
| Grid flip/puzzle/shatter | Split into cells; each cell has deterministic transform timing and optional divider/shadow. | `multiPanel`, `pattern-mask`. |
| Glitch/RGB split | Offset R/G/B samples independently, add seeded block/scanline displacement, then mix. | `distortion` with `seed`. |
| TV static/VHS | Add scanlines, noise, horizontal tearing, chroma offsets, and short exposure jitter. | `distortion`, `overlay`, deterministic noise. |
| Water drop/swirl/wave | Displace UV around center or along procedural wave; mix distorted samples over progress. | `distortion`. |
| Kaleidoscope/fly eye/hex | Fold or quantize UV into repeated geometric cells before sampling. | `pattern`, `distortion`. |
| Light leak/film burn/flare | Generate procedural color/alpha overlay, often plus screen/add blend and dissolve. | `overlay`, `blend`, generated texture cache. |
| Datamosh | Requires prior/future frame history or motion vectors; cannot be a pure two-texture shader. | deferred temporal pipeline. |
| Smooth Cut/Flow | Requires optical-flow/morphing, feature matching, or AI-derived intermediate frames. | deferred derived-frame pipeline. |

Construction rules:

- Enforce exact endpoints: progress `0` must render only outgoing, and progress
  `1` must render only incoming.
- Use normalized UV math and aspect-ratio-aware distance functions; avoid
  fixed-pixel constants except for final output-size-scaled softness.
- Keep randomness seeded and deterministic.
- Prefer `smoothstep`/curves over hard thresholds unless the intended look is
  hard digital damage.
- Build multi-pass effects explicitly. Blur, glow, bloom, light rays, and
  shatter shadows should not be hidden inside a single overloaded compositor
  uniform.
- Keep temporal effects out of the regular shader pack until frame history is
  a first-class input.

---

## Proposed Contract Extensions

### Transition Type System

Extend `TransitionPrimitive` in small steps:

```ts
type TransitionPrimitive =
  | OpacityPrimitive
  | SolidPrimitive
  | MaskPrimitive
  | TransformPrimitive
  | BlendPrimitive
  | EffectPrimitive
  | DistortionPrimitive
  | PatternPrimitive
  | OverlayPrimitive
  | MultiPanelPrimitive;
```

Suggested primitives:

- `mask`: `linear`, `radial`, `diamond`, `rect`, `clock`, `stripes`, with
  axis/direction/reverse/softness.
- `transform`: target `incoming` or `outgoing`, translate/scale/rotate over
  progress with curve.
- `transform3d`: perspective-aware rotate/translate/scale around X/Y/Z axes,
  using the existing compositor 3D layer uniforms where possible.
- `blend`: temporary blend mode override for a participant layer.
- `effect`: transition-scoped registered clip effect for incoming/outgoing
  participant layers where the effect is honest as a single-input pass.
- `distortion`: UV displacement, wave, RGB channel offset, scanline tear, or
  lens-like warp.
- `pattern`: procedural alpha reveal such as checker, random blocks, mosaic,
  star, splatter, zig-zag, or stripes.
- `overlay`: generated light leak, flash, burn edge, flare, glow, film grain,
  or projector flicker layer.
- `multiPanel`: split one participant into repeated sublayers/panels/slices
  with staggered transforms.

### Durable Params

`TimelineTransition.params` already exists. The EXTRA work should harden the
contract rather than introduce it:

```ts
interface TimelineTransition {
  id: string;
  type: string;
  duration: number;
  offset?: number;
  linkedClipId: string;
  params?: Record<string, string | number | boolean>;
}
```

Rules:

- Unknown params need an explicit project-load policy: preserve for forward
  compatibility, drop during normalization, or keep only behind a validated
  experimental capability flag.
- Definition defaults fill missing values.
- UI writes through transition edit operations, not direct clip mutation.
- Undo/redo, project save/load, transition type changes, and reciprocal
  `transitionIn`/`transitionOut` metadata must restore params exactly where the
  schema says they are valid.

### Layer Render State

Replace wipe-only `TransitionRenderState` with a compact tagged union:

```ts
type TransitionRenderState =
  | { kind: 'linear-mask'; axis: 'x' | 'y'; direction: 1 | -1; progress: number; softness: number }
  | { kind: 'shape-mask'; shape: 'circle' | 'diamond' | 'rect'; progress: number; softness: number }
  | { kind: 'clock-mask'; progress: number; clockwise: boolean; angleOffset: number; softness: number }
  | { kind: 'stripe-mask'; progress: number; angle: number; count: number; softness: number }
  | { kind: 'pattern-mask'; pattern: 'checker' | 'blocks' | 'noise' | 'star' | 'splatter'; progress: number; seed: number; amount: number; softness: number }
  | { kind: 'distortion'; mode: 'rgb-split' | 'block' | 'scanline' | 'wave' | 'zoom-blur' | 'directional-blur'; progress: number; seed: number; amount: number };
```

Transform-only transitions should prefer ordinary layer `position`, `scale`,
and `rotation` changes where possible, to avoid expanding shader uniforms when
the existing transform path already works.

This is a shader ABI change. It must be implemented as one coordinated change across
`src/types/layers.ts`, uniform packing, `src/shaders/composite.wgsl`,
`externalCompositeShader.ts`, and the focused compositor tests before any
effect-family packet depends on it.

### Render Capability Levels

Every transition definition should declare a capability level so the UI can
avoid advertising half-supported effects:

| Level | Meaning | Examples |
|---|---|---|
| `stable` | Preview/export parity covered by tests. | Crossfade, Wipe Left. |
| `experimental` | Behind a feature flag or hidden dev option. | Early 3D/page peel. |
| `planned` | In registry docs only, not selectable. | Datamosh, Smooth Cut. |

Do not expose `planned` transitions in the panel. Do not expose
`experimental` transitions in production builds until preview/export parity is
proved.

### Determinism Rules For Procedural Transitions

- Every procedural transition must derive randomness from `transition.id`,
  `params.seed`, and normalized progress.
- Export must not depend on playback history, current wall-clock time, or
  previous preview frames.
- Temporal effects such as stutter or datamosh need an explicit frame-history
  or derived-media contract before becoming selectable.
- Generated overlays must be resolution-independent or generated per output
  size through a cached deterministic path.

---

## Work Packets

### Packet EX0: Contract, Capability, And Param Hardening

**Goal:** Harden the existing transition param and definition contract without
changing visual behavior.

**Write set:**

- `src/types/timelineCore.ts`
- `src/transitions/types.ts`
- `src/stores/timeline/editOperations/transactionTypes.ts`
- `src/stores/timeline/editOperations/transitionOperations.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/load/loadTimelineHydration.ts`
- `src/stores/timeline/serialization/serializableTimelineState.ts`
- `src/stores/timeline/serialization/loadStateMediaClipRestore.ts`
- `src/components/panels/properties/TransitionTab.tsx`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- focused params/capability unit tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Existing five transitions render and edit identically;
`transition-update-type` and `transition-update-params` have structured-clone
contract tests; param normalization, unknown-param policy, undo/redo, and
project-load behavior are explicit and covered.

### Packet EX0A: Registry Extensibility And Capability Filtering

**Goal:** Make transition capability (`stable`, `experimental`, `planned`) a
first-class registry concern before adding large numbers of definitions.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/index.ts`
- `src/components/panels/TransitionsPanel.tsx`
- `src/components/panels/properties/TransitionTab.tsx`
- `src/components/timeline/hooks/useTransitionDrop.ts`
- `src/components/timeline/transitionDragData.ts`
- `src/stores/timeline/editOperations/transitionOperations.ts`
- `src/stores/timeline/editOperations/transitionPlanner.ts`
- `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`
- focused registry/UI acceptance tests

**Requirements:**

- Production UI exposes only stable transitions.
- Experimental transitions are hidden unless a dev/feature flag enables them.
- Planned transitions can exist as metadata/docs but cannot be dropped,
  selected in the type dropdown, planned, or rendered.
- Until the manual `TransitionType` union and registry imports are replaced,
  keep edits to `src/transitions/types.ts` and `src/transitions/index.ts`
  small and coordinated.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/timelineEditOperations.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Capability filtering applies consistently to panel items,
properties type changes, drag/drop payloads, planner validation, and apply
operations.

### Packet EX0B: Transition Shader ABI

**Goal:** Replace the wipe-only transition shader ABI with a compact, tested
render-state contract before shader families depend on it.

**Write set:**

- `src/types/layers.ts`
- `src/engine/pipeline/compositor/uniforms.ts`
- `src/shaders/composite.wgsl`
- `src/engine/pipeline/compositor/externalCompositeShader.ts`
- `tests/unit/compositorUniforms.test.ts`
- focused normal/external shader parity tests where available

**Requirements:**

- No-transition uniform defaults remain byte-compatible or explicitly migrated.
- Both normal texture and external-video shader paths are updated together.
- The ABI is documented with enum values and param slot ownership.
- Any future packed params leave enough room for deterministic seed/intensity
  without abusing unrelated uniform slots.

**Checks:**

```bash
npm run test -- tests/unit/compositorUniforms.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Existing wipe transitions still render; absent
`transitionRender` resets all transition slots; normal/external paths stay in
sync.

### Packet EX0C: Transform Composition Contract

**Goal:** Let transition assembly modify participant transforms in a shared
preview/export-safe way before Push, Slide, Flip, or Card transitions are added.

**Write set:**

- `src/transitions/types.ts`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `src/engine/export/ExportLayerBuilder.ts`
- focused layer-builder/export tests

**Requirements:**

- Existing `buildClipLayer` opacity override remains compatible.
- Transform primitives compose with clip keyframed transform rather than
  replacing it unexpectedly.
- Transform composition must be immutable: clone nested `position`, `scale`,
  and `rotation` objects before applying transition offsets so cached layer
  transforms cannot leak between participants or frames.
- Compose against the transform already sampled for the transition source clip's
  virtual-handle or hold-frame local time, not against a second original
  body-local-time lookup.
- Transform origin support is explicitly in or out of scope. If out of scope,
  Cube/Door/Fold/Page Peel stay deferred.

**Checks:**

```bash
npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Push/Slide-style transforms can be expressed without
one-off code in `LayerBuilderService` or `ExportLayerBuilder`.

### Packet EX0D: Two-Participant Transition Pass Feasibility

**Goal:** Decide and prototype the render contract for effects that need raw
outgoing and incoming samples in the same shader.

**Write set:**

- planning doc update, or a disabled experimental pass behind a feature flag
- optional tests proving current transition behavior is unchanged

**Required before:**

- Luma Fade
- Water Drop
- Swirl/Wormhole effects that distort both participants
- advanced exotic shader lab effects
- any transition that cannot be represented as ordinary sublayers over an
  accumulated base texture

**Stop condition:** The plan states whether MasterSelects will use a dedicated
two-input transition pass, precomposed participant textures, or keep those
effects deferred. No user-visible transition depends on this until the answer
is implemented.

### Packet EX0E: Transition Pass Planner And Overlay Cache Feasibility

**Goal:** Define how multi-pass transition effects, generated overlays, blur,
glow, bloom, and film/light textures are planned and cached.

**Write set:**

- planning doc update, or disabled helper prototypes
- `docs/Features/Linux-Mesa-GPU.md` cross-reference if new canvas/GPU paths
  are proposed

**Requirements:**

- No full-timeline or full-content canvases.
- No worker `OffscreenCanvas` dependency without a main-thread/software
  fallback.
- Generated overlays are keyed by transition type, params, output size, and a
  deterministic progress bucket.
- Existing single-input clip effect shaders may be reused as references, but
  they are not assumed to be drop-in two-input transition effects.

**Stop condition:** EX10/EX13 have a concrete, Mesa-aware pass/cache model
before implementation begins.

### Packet EX1: Directional Wipe Expansion

**Goal:** Add Wipe Up and Wipe Down, and generalize existing left/right wipes to
the new mask render state.

**Prerequisite:** EX0A and EX0B.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/index.ts`
- `src/transitions/wipeUp/**`
- `src/transitions/wipeDown/**`
- `src/types/layers.ts`
- `src/engine/pipeline/compositor/uniforms.ts`
- `src/shaders/composite.wgsl`
- `src/engine/pipeline/compositor/externalCompositeShader.ts`
- `src/components/panels/TransitionsPanel.tsx`
- focused compositor/registry/layer-builder tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/compositorUniforms.test.ts tests/unit/layerBuilderService.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Four directional wipes render in preview and export with no
behavior change for absent transition metadata.

### Packet EX2: Push And Slide

**Goal:** Add Push Left/Right/Up/Down and Slide Left/Right/Up/Down through
transform primitives.

**Prerequisite:** EX0A, EX0C, and the `transform` primitive branch has been
serially added to `TransitionPrimitive`.

**Write set:**

- `src/transitions/push*/**`
- `src/transitions/slide*/**`
- `src/transitions/types.ts`
- `src/transitions/index.ts`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `src/components/panels/TransitionsPanel.tsx`
- focused preview/export layer tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Push moves both participants like a physical handoff; Slide
moves incoming over outgoing; both share preview/export assembly.

### Packet EX3: Iris And Shape Masks

**Goal:** Add Circle Iris, Diamond Iris, Square Iris, Clock Wipe, and Center
Wipe.

**Prerequisite:** EX0A, EX0B, and the relevant `shape-mask`/`clock-mask`
primitive branch has been serially added to `TransitionPrimitive`.

**Write set:**

- `src/transitions/**`
- `src/types/layers.ts`
- compositor uniform/shader files
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `tests/unit/compositorUniforms.test.ts`
- focused shader-related layer tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/compositorUniforms.test.ts tests/unit/layerBuilderService.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Shape masks are driven entirely by transition render state
and do not require planner changes.

### Packet EX4: Parametric Dip To Color And Softness

**Goal:** Convert fixed Dip to Black/White into the same family as Dip to Color
while preserving existing IDs.

**Prerequisite:** EX0 and EX0A.

**Write set:**

- `src/transitions/dipToBlack/**`
- `src/transitions/dipToWhite/**`
- `src/transitions/dipToColor/**`
- `src/components/panels/properties/TransitionTab.tsx`
- transition edit operations/types
- focused params tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/timelineEditOperations.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Existing projects with Dip to Black/White remain valid, and
new Dip to Color stores only serializable color/curve params.

### Packet EX5: Stylized Dissolves

**Goal:** Add Additive Dissolve, Non-Additive Dissolve, Blur Dissolve, and
Noise Dissolve after blend/effect primitives are proven.

**Prerequisite:** EX0A and EX0B for blend/mask states, plus the relevant
`blend` or `effect` primitive branch has been serially added to
`TransitionPrimitive`. Blur Dissolve also requires EX0E if it needs a real
blur pass rather than simple opacity/blend changes.

**Progress:** `Noise Dissolve` is implemented as the first procedural mask
member of this family. `Blur Dissolve` is implemented through transition-scoped
registered `gaussian-blur` effect passes. `Additive Dissolve` is implemented
through the transition-scoped `blend` primitive. `Non-Additive Dissolve` is
implemented through the same `blend` primitive with `multiply`, not a new
subtractive shader.

**Write set:**

- `src/transitions/**`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- compositor/effect pipeline files as needed
- export parity tests

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Each stylized dissolve has a visually distinct render model,
not just a differently named crossfade.

### Packet EX6: Transitions Panel UX Upgrade

**Goal:** Make the panel scale beyond a five-item list.

**Write set:**

- `src/components/panels/TransitionsPanel.tsx`
- `src/components/panels/TransitionsPanel.css`
- optional transition thumbnail helper under `src/transitions/`
- UI tests if existing patterns allow

**Requirements:**

- Group by category.
- Search/filter by transition name.
- Stable thumbnail dimensions.
- No text overflow at narrow panel widths.
- Generic thumbnail renderer from primitive family where possible.
- Favorites or recent transitions only if the existing settings store pattern
  makes it cheap and serializable.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Adding a new transition definition does not require
hard-coding a new thumbnail branch unless it uses a new primitive family.

### Packet EX7: Smooth Cut / Flow Feasibility Spike

**Goal:** Determine whether jump-cut repair should be optical flow, frame
morphing, AI-derived interpolation, or a cached generated-media workflow.

**Write set:**

- planning doc only, or experimental code behind a disabled flag

**Stop condition:** There is a concrete implementation proposal with required
runtime dependencies, cache model, export behavior, and fallback behavior. Do
not ship a user-visible Smooth Cut/Flow transition before this is answered.

### Packet EX8: 3D Transition Foundation

**Goal:** Add a conservative whole-card `scene-3d-panel` transition layer that
supports Flip/Card/Roll-style transitions through the existing native
shared-scene camera/depth renderer, with compositor fallback for unsupported
sources.

**Prerequisite:** EX0A, EX0C, and the `transform3d` primitive branch has been
serially added to `TransitionPrimitive`.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/**`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `src/types/layers.ts`
- focused preview/export layer tests

**Requirements:**

- Reuse existing layer `rotation.x`, `rotation.y`, `position.z`, scale, and
  opacity primitives, but route eligible whole-card 3D participants through the
  native scene plane path via transition metadata.
- Do not expose tunable transition perspective in this packet unless the shader
  ABI/uniform packing work is explicitly part of the packet.
- Provide deterministic ordering for 3D transition sublayers.
- Keep Cube, Door, Fold, and Page Peel out of this packet unless transform
  origin and multi-panel contracts are already solved.
- Do not mark unsupported source states as shared-scene 3D; fall back to the
  compositor transform path when no `videoFrame`, `videoElement`,
  `imageElement`, or `textCanvas` is available.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Progress:** Flip Horizontal/Vertical, Card Spin, Tumble Away, 3D Roll, and
3D Spinback use `renderMode: 'scene-3d-panel'`, share transition layer assembly
with preview/export, and are exposed as `Flip`, `Tumble`, `Roll`, and `Spin`
families in the panel/Properties UI. Cube/Door/Fold and Page Peel remain
planned until origin/panel slicing or mesh-strip contracts exist.

**Stop condition:** Flip Horizontal/Vertical, Card Spin, Tumble Away, 3D Roll,
and 3D Spinback render with preview/export parity and no changes to
non-transition layers. Cube/Door/Fold remain planned unless origin/panel
slicing exists.

### Packet EX9: Glitch Primitive Foundation

**Goal:** Add deterministic glitch primitives for RGB split, block glitch,
mosaic glitch, scanline tear, CRT collapse, and digital noise dissolve.

**Prerequisite:** EX0A and EX0B, plus the relevant `distortion`/glitch
primitive branch has been serially added to `TransitionPrimitive`. Any glitch
that needs raw outgoing and incoming samples in the same shader also requires
EX0D.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/**`
- `src/types/layers.ts`
- compositor uniform/shader files
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- focused compositor/layer-builder/export tests

**Requirements:**

- All procedural noise and block ordering uses seeded deterministic math.
- Intensity is parametric and defaults to a moderate value.
- Export at the same time/progress produces the same pixel intent as preview.
- No dependency on previous frames in this packet.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/compositorUniforms.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Progress:** `Block Glitch` and `Digital Noise Dissolve` use deterministic
procedural masks. `CRT Collapse` uses transform/opacity primitives. `RGB Split
Glitch`, `Mosaic Glitch`, and static `Scanline Glitch` use transition-scoped
registered effects and do not require compositor ABI changes. Signal Tear,
animated scanline jitter, Data Corrupt, and Datamosh remain planned.

**Stop condition:** RGB Split Glitch, Block Glitch, Mosaic Glitch, Scanline
Glitch, CRT Collapse, and Digital Noise Dissolve are visibly distinct,
seeded or otherwise deterministic, and serializable.

### Packet EX10: Light, Film, And Blur Transition Foundation

**Goal:** Add generated overlay/effect primitives for Flash, Blur Dissolve,
Projector Flicker, Film Roll, Vignette Bloom, Light Leak, Chroma Leak,
Film Burn, Zoom Blur, Directional Blur, and Whip Pan.

**Prerequisite:** EX0A and EX0E, plus the relevant `overlay` or `effect`
primitive branch has been serially added to `TransitionPrimitive`. The
single-input registered `effect` branch is implemented for Blur Dissolve,
Zoom Blur, Directional Blur, Whip Pan, Film Roll, and Vignette Bloom;
deterministic generated solids are implemented for Flash and Projector Flicker;
deterministic generated overlays are implemented for Light Sweep, Light Leak,
Chroma Leak, Lens Flare, and Film Burn.

**Progress:** Flash uses deterministic generated-solid opacity. Blur Dissolve,
Zoom Blur, Directional Blur, and Whip Pan use transition-scoped registered GPU
effects on incoming/outgoing participants. Whip Pan also uses a conservative
transform offset/scale, and the shared Motion Blur shader mirrors edge samples
to avoid transparent gaps during fast horizontal blur. Projector Flicker adds
deterministic exposure pulses through the same generated-solid path, Film Roll
uses vertical transform plus transition-scoped `motion-blur` with extra
vertical overscan, and Vignette Bloom combines transition-scoped `glow` and
`vignette` effects. Light Sweep uses the generated overlay primitive and a
cached transparent light-band canvas. Light Leak, Chroma Leak, Lens Flare, and
Film Burn use the same output-size-aware generated overlay/cache path for warm
edge streaks, chroma split leaks, flare ghosts, and burn-edge exposure washes.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/**`
- transition overlay generation helper
- compositor/effect pipeline files as needed
- export parity tests

**Requirements:**

- Procedural overlays are cached by transition type, params, progress bucket,
  and output size when necessary.
- Blur-heavy transitions go through an explicit pass plan if they cannot be
  represented by existing registered effect passes.
- No bundled video overlays in this packet.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Light/film/blur transitions render through deterministic
generated overlays or explicit effect passes, not ad hoc DOM canvases in hot
paths.

### Packet EX11: Pattern And Matte Transition Foundation

**Goal:** Add checker, random block, paint splatter, star wipe, zig-zag,
polka-dot, doom-bar, and luma fade planning.

**Prerequisite:** EX0A and EX0B for procedural patterns, plus the relevant
`pattern` primitive branch has been serially added to `TransitionPrimitive`.
Luma Fade requires EX0D and must remain planned if no two-participant
transition pass exists.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/**`
- compositor mask shader files
- optional matte/luma planning notes
- focused tests

**Requirements:**

- Procedural pattern masks are resolution-independent.
- Randomized reveal order uses seed + tile index, not mutable runtime state.
- Luma Fade is either implemented with a deliberate participant-sampling
  shader path or left planned; do not fake it as a normal dissolve.

**Checks:**

```bash
npm run test -- tests/unit/transitionPatternDefinitions.test.ts tests/unit/transitionRegistry.test.ts tests/unit/transitionGroups.test.ts tests/unit/compositorUniforms.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Pattern masks work without changing planner semantics, and
Luma Fade has either a real implementation path or an explicit deferred note.

### Packet EX12: Transition Browser Scale-Up

**Goal:** Make the UI suitable for dozens of transitions, including planned and
experimental definitions.

**Write set:**

- `src/components/panels/TransitionsPanel.tsx`
- `src/components/panels/TransitionsPanel.css`
- `src/components/panels/transitions/transitionPanelItems.ts`
- `src/components/panels/transitions/TransitionPreview.tsx`
- `src/components/panels/properties/TransitionTab.tsx`
- `src/components/panels/properties/transitionChoiceMetadata.ts`
- tests for transition panel item grouping/search and rendered 2D/3D sections
- docs in `docs/Features/`

**Requirements:**

- Category groups can be collapsed. Initial 2D/3D section collapse is
  implemented; deeper per-family/category collapse remains follow-up.
- Search includes aliases such as "glitch", "3d", "light", "film", and
  "wipe". Initial family-card search is implemented for available family,
  transition, category, description, dimension, and synonym values.
- Stable/Experimental/Planned badges are shown in dev builds.
- Production panel hides planned definitions; planned dev metadata is visible
  but not draggable.
- Thumbnail previews derive from family metadata where possible.

**Checks:**

```bash
npm run test -- tests/unit/transitionPanelItems.test.ts tests/unit/TransitionsPanel.test.tsx tests/unit/transitionChoiceMetadata.test.ts tests/unit/transitionGroups.test.ts
npx tsc -b --pretty false
```

**Stop condition:** The panel remains usable with at least 60 definitions and
does not require manual layout work per transition.

### Packet EX13: Exotic Shader Lab Pack

**Goal:** Add exotic shader transitions as experimental mini-packs after the
core distortion, pattern, overlay, and multi-panel primitives are proven.

**Prerequisite:** EX0A, EX0B, EX0D, and EX0E for any effect that distorts both
clips, uses generated overlays, or needs a multi-pass pipeline. The relevant
`distortion`, `pattern`, `overlay`, or `multiPanel` primitive branch must be
serially added to `TransitionPrimitive` before a leaf effect packet starts.
The first reusable `distortion` primitive is now implemented for
per-participant UV remap effects.

**Candidate mini-packs:**

- EX13A Distortion Lab: Water Drop and Swirl are implemented as stable seeded
  UV remaps; Liquid Melt and VHS Head Switch remain planned.
- EX13B Pattern Lab: Kaleidoscope is implemented through transition-scoped
  registered `kaleidoscope` effects. Polka Dot Curtain and Doom Bars are
  implemented as deterministic pattern masks. Fly Eye, Hex Pixelize, and Ink
  Bleed remain planned metadata only.
- EX13C Overlay/Light Lab: Smoke Reveal, Portal Ring, Thermal Bloom remain
  planned metadata only.
- EX13D Multi-Panel Lab: MP0 deterministic ordering/source-rect planning,
  MP1 visible `Puzzle Push` source-rect rendering, and MP2 visible
  `Magnetic Tiles` center-magnetic tile rendering are implemented. MP3
  promotes `Shatter Glass` as a visible rectangular outgoing tile-shatter on
  the same source-rect planner. Origami Fold and true Voronoi glass shards
  remain planned metadata until shard, shadow, per-panel UV, and pivot/hinge
  support exist.

**Write set:**

- Owned mini-pack folders under `src/transitions/**` and focused tests for that
  primitive family.
- Shared integration files as needed: `src/transitions/types.ts`,
  `src/transitions/index.ts`, compositor shader/uniform files, generated
  overlay/cache helpers, `src/components/panels/TransitionsPanel.tsx`, and
  export/layer-builder integration.

**Requirements:**

- Mark the pack `experimental` until performance and export parity are proven.
- Implement one mini-pack at a time. Do not bundle all EX13 candidates into a
  single renderer/export packet.
- Every effect must map to an existing primitive family or introduce one
  reusable primitive. No isolated one-transition shader path.
- Every procedural effect has an explicit seed and deterministic replay.
- Effects with prior-frame dependency, AI-derived frames, or motion vectors
  remain planned only.
- Provide one thumbnail style per primitive family so the panel does not grow
  one-off preview branches.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/compositorUniforms.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Each completed mini-pack can be toggled on in dev builds,
each included transition is visibly distinct, and disabling experimental
transitions removes them from the production panel without affecting persisted
stable transitions. Unstarted mini-packs remain planned metadata only.

---

## Verification Matrix

Every new transition family must cover:

- Registry serialization test.
- Planner no-op test showing no transition-type-specific timing behavior.
- Preview layer assembly test at progress 0, 0.5, and 1.
- Export layer assembly parity test where the transition has virtual handles.
- Compositor uniform no-transition reset test.
- Shader/external-video parity for every transition render state that affects
  fragment alpha.
- Undo/redo test for duration, offset, and params if params are present.
- Structured-clone/plain-data contract tests for `transition-update-type` and
  `transition-update-params`.
- Project persistence smoke test for transition metadata.
- Locked-track edit rejection where edit operations are touched.
- Determinism test for seeded procedural transitions.
- No-runtime-handle scan for generated overlay/cache metadata.
- Shader parity for normal texture and external video texture paths.
- Capability-level test so planned transitions cannot leak into production UI.
- Acceptance-gating test so planned transitions cannot be dropped, selected in
  Properties, planned by `planTransition`, or applied by edit operations.
- Two-participant transition pass parity tests before any raw `from`/`to`
  shader effect ships.
- Performance smoke for heavy families: 3D, blur, light leaks, glitch blocks,
  and pattern masks.

Manual QA for a representative set:

- Adjacent clips with real handles.
- Adjacent clips with no handles, using hold-frame fallback.
- Long transition longer than one or both clip bodies.
- Playback and scrub over start/middle/end of transition body.
- Export a short range that starts before and ends after the transition.
- Same project reopened after save.
- Scrub repeatedly through procedural glitch/light transitions and verify the
  same frame does not change randomly.
- For every newly implemented transition effect, capture a Dev Bridge
  real-preview 5-frame grid and a full-resolution midpoint frame, then visually
  inspect both before marking the packet complete. Unit tests are not enough
  for visible transitions; each newly exposed effect packet needs screenshot
  evidence plus a log check for errors, missing effect pipelines, and shader
  warnings.
- Run at desktop and narrow panel widths with many transition definitions.
- Verify Linux/Mesa fallback expectations for any new canvas/GPU path; do not
  allocate full-timeline or full-content canvases for transition previews.

---

## Acceptance Checklist

- [x] Transition params are durable, validated, undoable, and serializable.
- [x] Existing `TimelineTransition.params` behavior is hardened with explicit
      unknown-param, load, type-change, and undo/redo policies.
- [x] Capability filtering applies before panel display, type dropdowns,
      drag/drop, planner validation, and edit operations.
- [x] Shader ABI changes update normal texture and external-video compositor
      paths together.
- [x] Two-participant shader effects are implemented through a deliberate pass
      or kept planned.
- [x] Every newly exposed visible transition/effect packet has Dev-Bridge
      screenshot evidence and log checks recorded before it is marked complete.
- [x] Generated overlay/light/blur effects have a Mesa-aware pass/cache model.
- [x] Wipe render state supports horizontal and vertical directions.
- [x] Push and Slide render through transform primitives in preview and export.
- [x] Shape/iris masks render through generic mask render state.
- [x] Oval, Triangle, Cross, and Star Iris extend the same grouped Iris
      shape-mask path.
- [x] Barn Door Horizontal/Vertical use the existing center-mask path and stay
      grouped under Wipe.
- [x] Dip to Color exists without breaking Dip to Black/White.
- [x] Current variant families are grouped in the panel and Properties UI
      instead of showing one top-level item per Wipe/Iris/Push/Slide/Dip/Rotate
      or 3D variant.
- [x] Transition families are visually separated into 2D and 3D groups in the
      panel and Properties selector.
- [x] Stylized dissolves are visually distinct and not renamed crossfades.
- [x] Additive Dissolve uses a transition-scoped blend primitive and stays
      grouped under one Dissolve family.
- [x] Non-Additive Dissolve uses a transition-scoped multiply blend primitive
      and stays grouped under the Dissolve family.
- [x] Blur Dissolve uses transition-scoped registered Gaussian Blur effects and
      preserves existing clip effect stacks.
- [x] Noise Dissolve uses a deterministic procedural mask on the shared
      preview/export transition layer path.
- [x] Rotate Left/Right and Rotate 90 use shared transform primitives and
      remain grouped under one dedicated 2D Rotate family, separate from
      Stylize and the perspective 3D families.
- [x] Current whole-card 3D transitions opt into `scene-3d-panel` rendering
      when the participant has a scene-plane-compatible source, with compositor
      fallback for unsupported source states.
- [x] 3D Roll and 3D Spinback extend the 3D family set as whole-card
      camera/depth panel transitions without claiming Cube/Door/Fold/Page-Peel
      infrastructure.
- [x] Current whole-card 3D transitions are exposed as `Flip`, `Tumble`,
      `Roll`, and `Spin` families instead of one duplicated top-level `3D`
      family card.
- [x] Page Peel is not exposed until the curved/strip mesh model is credible.
- [x] Glitch transitions are seeded and deterministic in preview and export.
- [x] Block Glitch uses a seeded deterministic procedural block mask on the
      shared preview/export transition layer path.
- [x] CRT Collapse uses deterministic transform/opacity primitives on the
      shared preview/export transition layer path.
- [x] RGB Split Glitch, Mosaic Glitch, and static Scanline Glitch use
      transition-scoped registered effects without claiming two-participant
      signal tear or temporal corruption.
- [x] Datamosh remains deferred until a frame-history/motion-vector model
      exists.
- [x] Flash uses a deterministic generated solid overlay on the shared
      preview/export transition layer path.
- [x] Light, film, and remaining blur transitions use deterministic generated
      overlays or explicit pass plans.
- [x] Light Sweep uses a deterministic generated overlay canvas on the shared
      preview/export transition layer path with output-size-aware cache keys.
- [x] Light Leak uses deterministic generated edge/streak overlay canvases on
      the shared preview/export transition layer path with output-size-aware
      cache keys.
- [x] Projector Flicker uses deterministic generated-solid exposure pulses on
      the shared preview/export transition layer path.
- [x] Film Roll uses shared transform primitives plus transition-scoped Motion
      Blur with enough vertical overscan to avoid transparent preview gaps.
- [x] Vignette Bloom uses transition-scoped registered Glow and Vignette
      effects without replacing existing clip effect stacks.
- [x] Zoom In/Out and Spin Zoom use shared transform primitives and remain
      grouped under one Zoom family.
- [x] Zoom Blur uses transition-scoped registered Zoom Blur effects and remains
      grouped under the same Zoom family.
- [x] Directional Blur and Whip Pan use transition-scoped registered Motion Blur
      effects and remain grouped under one Motion Blur family.
- [x] Pattern transitions use procedural masks or a deliberate matte pipeline.
- [x] Checker Wipe and Venetian Blinds use deterministic pattern masks on the
      shared preview/export transition layer path.
- [x] Random Blocks, Paint Splatter, Zig-Zag Blocks, Polka Dot Curtain, and
      Doom Bars use deterministic pattern masks on the shared preview/export
      transition layer path.
- [x] First Exotic Shader Lab distortion transitions map to reusable primitives
      and are promoted only when preview/export parity is credible.
- [x] Water Drop and Swirl use deterministic UV distortion, not mutable frame
      history; Liquid Melt remains planned until its luma/noise melt contract
      is explicit.
- [x] Kaleidoscope uses transition-scoped registered effects and Dev-Bridge
      screenshot QA captured the pattern transition without blank frames.
- [x] EX13D-MP0 deterministic multi-panel ordering exists as a pure planner for
      stable panel IDs, source rects, z-order, seeded ordering, magnetic/edge/
      center strategies, and staggered per-panel progress.
- [x] Puzzle Push uses the multi-panel planner in visible preview/export
      rendering through the general `Layer.sourceRect` sampling path.
- [x] Magnetic Tiles uses the multi-panel planner in visible preview/export
      rendering with center-magnetic ordering and panel pull-in motion.
- [x] Shatter Glass uses the multi-panel planner in visible preview/export
      rendering as deterministic rectangular source-rect tiles with seeded
      ordering, fly-away offset, rotation, and fade.
- [x] Origami Fold remains planned until per-panel 3D source UVs, transform
      origins, pivot/hinge semantics, depth ordering, and shadow contracts are
      implemented; it is not exposed as a 2.5D approximation.
- [x] AI/neural transitions remain planned until derived-frame cache and export
      behavior are specified.
- [x] Transitions panel scales by category/search without hard-coded layout
      changes for every new definition.
- [x] Transition panel family-card assembly, search indexing, and sectioning
      are extracted from `TransitionsPanel.tsx` and covered by focused tests.
- [x] Transition panel SVG thumbnail rendering is extracted from the panel shell
      so the browser layout file stays below the product-source ceiling.
- [x] Properties transition choice metadata is extracted from `TransitionTab.tsx`
      so the transition Properties tab stays below the product-source ceiling.
- [x] Transitions panel search filters grouped family cards by hidden variant
      names, transition IDs, categories, descriptions, aliases, and 2D/3D
      labels.
- [x] Transitions panel 2D/3D sections can be collapsed without hiding active
      search results.
- [x] Transitions panel family cards show variant counts and expand on click to
      reveal draggable leaf variants, then collapse when the pointer leaves the
      panel.
- [x] Dev Transition panel metadata shows Stable/Experimental/Planned badges;
      planned definitions remain visible only in dev metadata and are not
      draggable/runtime-enabled.
- [x] Stable/experimental/planned capability levels prevent unfinished effects
      from appearing in production UI.
- [x] No new transition type changes planner semantics unless explicitly
      documented.
- [x] Preview and export remain visually aligned for virtual handles and
      hold-frame fallback.
- [x] Smooth Cut/Flow remains deferred until a real optical-flow/morphing plan
      exists.

---

## Risks

- **Risk:** The registry grows faster than the renderer, producing many
  differently named crossfades.
  **Mitigation:** Require a distinct primitive/render model before registering
  each transition ID.

- **Risk:** The current manual registry and literal `TransitionType` union make
  broad edits conflict-prone.
  **Mitigation:** Keep registry/type edits small and coordinated, or first
  replace the manual shape with an array-backed/generated registry contract.

- **Risk:** Shader uniforms become a dumping ground.
  **Mitigation:** Prefer layer transforms for transform transitions; reserve
  transition uniforms for fragment alpha/mask states.

- **Risk:** Existing single-input clip effects are treated as drop-in
  transition effects.
  **Mitigation:** Reuse their math as references only; require a transition
  pass contract for any effect that needs both outgoing and incoming samples.

- **Risk:** Transition params corrupt project data with unknown shapes.
  **Mitigation:** Validate against definition schemas on write and on load.

- **Risk:** Preview and export drift.
  **Mitigation:** Keep all transition layer construction in shared assembly and
  add parity tests per primitive family.

- **Risk:** Optical-flow transitions create a dependency and performance trap.
  **Mitigation:** Keep Smooth Cut/Flow as a separate feasibility spike and do
  not expose it until cache/export behavior is defined.

- **Risk:** 3D transitions fight the real 3D asset renderer or create depth
  ordering bugs.
  **Mitigation:** Start with 2.5D layer transforms in the normal compositor.
  Move to mesh/strip geometry only for transitions that prove they need it.

- **Risk:** Glitch effects become nondeterministic and export differs from
  preview.
  **Mitigation:** Seed every procedural decision and test repeated renders of
  the same frame.

- **Risk:** Blur/light/film transitions allocate canvases or textures every
  frame.
  **Mitigation:** Plan generated overlays as cached render resources keyed by
  params/output size/progress bucket, and audit hot paths.

- **Risk:** Modern transition count overwhelms the panel.
  **Mitigation:** Add category collapse, search, aliases, and capability
  filtering before exposing dozens of definitions.

- **Risk:** Fancy transitions regress Linux/Mesa canvas or WebGPU behavior.
  **Mitigation:** Route new GPU/canvas decisions through the existing platform
  constraints, keep main-thread/software fallbacks for generated thumbnails,
  and avoid oversized backing stores.
