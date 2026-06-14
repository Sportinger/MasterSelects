> Status: Extra follow-up plan for the Transition Suite. This is planning context,
> not completed archive.

# Transition Suite EXTRA Plan

**Issue:** Follow-up to #196, Transition Suite  
**Branch:** `issue-196-transition-suite`  
**Base:** first-pass Transition Suite in `docs/ongoing/Transition-suite-plan.md`  
**Date:** 2026-06-15

---

## Purpose

This EXTRA plan extends the first-pass Transition Suite after Crossfade, Dip to
Black, Dip to White, Wipe Left, and Wipe Right are working end to end.

The goal is not to copy Final Cut Pro or DaVinci Resolve wholesale. The goal is
to add the common editorial transitions users expect, while keeping the
MasterSelects implementation timeline-native, serializable, preview/export
shared, and compatible with the existing virtual handle and hold-frame planner.

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

- `src/transitions/types.ts` supports only opacity, black/white solid, and
  simple wipe primitives.
- `src/types/layers.ts` exposes `transitionRender` only for horizontal wipes.
- `src/engine/pipeline/compositor/uniforms.ts`,
  `src/shaders/composite.wgsl`, and
  `src/engine/pipeline/compositor/externalCompositeShader.ts` encode one
  transition shader mode: `transitionType = 1` for wipe.
- `TimelineTransition` already supports serializable `params`, and
  `TransitionTab` can edit them through transition edit operations. The gap is
  validation hardening, capability gating, schema-on-load behavior, and focused
  undo/redo/persistence tests.
- Current param normalization is schema-driven. Unknown params must have an
  explicit preserve/drop policy before experimental transitions can safely
  round-trip.
- `TransitionsPanel` thumbnails are hard-coded by transition ID.
- The current compositor path is not a GL-style direct `from`/`to` transition
  shader. It composites an accumulated base texture with one current layer
  texture, so luma fades, water-drop distortions across both clips, and other
  two-participant effects need a dedicated transition pass before they are
  exposed.

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
| Diamond Iris | Iris | Diamond/signed-distance mask. |
| Square Iris | Iris | Rectangular center reveal. |
| Clock Wipe | Wipe | Angular radial reveal. |
| Radial Wipe | Wipe | Circular sweep variant. |
| Center Wipe | Wipe | Open from center horizontally/vertically. |
| Venetian Blinds | Wipe | Repeated stripe mask with count/angle params. |
| Barn Door Horizontal | Motion/Shape | Two-sided reveal. |
| Barn Door Vertical | Motion/Shape | Vertical two-sided reveal. |

### Tier 3: Stylized Dissolves

These should wait until the transition renderer can compile effect/blend
primitives consistently for preview and export.

| Transition | Family | Notes |
|---|---|---|
| Additive Dissolve | Dissolve | Use additive/lighten blend at midpoint. |
| Non-Additive Dissolve | Dissolve | Darker midpoint; likely multiply/subtract style. |
| Blur Dissolve | Dissolve | Needs transition-scoped blur strength. |
| Noise Dissolve | Stylized | Procedural threshold/noise alpha. |
| Film Dissolve | Dissolve | Curve/gamma-like dissolve style. |
| Rotate | Stylized | Transform plus opacity. |
| Rotate 90 | Stylized | Transform plus opacity. |
| Slice Push | Stylized | Multi-column transform mask. |

### Tier 4: 3D And Depth Transitions

These are highly visible and expected in modern editors, but they should be
implemented after transform primitives are stable. Start with compositor-safe
Flip/Card-style 2.5D transforms. Cube, Door, Fold, and Page Peel need transform
origin and/or multi-panel contracts before they become realistic.

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
| Tumble Away | 3D | Outgoing rotates and scales away while incoming rises. |

Implementation guidance:

- First pass can use ordinary layer `rotation.x`, `rotation.y`, `position.z`,
  scale, perspective, and opacity, because the compositor already has 3D-ish
  layer uniforms.
- Split/panel transitions need either multiple generated sublayers per
  participant or a fragment shader that can gate/slice local UVs.
- Page Peel should be deferred until the renderer can generate a curved mesh or
  approximate it with enough vertical strips to look intentional.
- True 3D shared-scene transitions must not hijack normal 3D asset rendering;
  they are transition-time render constructs.

### Tier 5: Glitch And Digital Damage

These are common in social, music, gaming, tech, trailer, and short-form edits.
They should not be implemented as random per-frame hacks; they need seeded,
deterministic render state so preview, export, undo/redo, and re-opened
projects match.

| Transition | Family | Notes |
|---|---|---|
| RGB Split Glitch | Glitch | Per-channel offsets that ramp up/down around the cut. |
| Block Glitch | Glitch | Tile grid offsets with seeded random block motion. |
| Mosaic Glitch | Glitch | Pixelation/mosaic resolves into incoming clip. |
| Scanline Glitch | Glitch | Horizontal bands, jitter, optional luma flicker. |
| Signal Tear | Glitch | Horizontal displacement tears with chroma edges. |
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
| Light Leak | Light/Film | Procedural warm leak overlay plus dissolve. |
| Chroma Leak | Light/Glitch | Color flare with chromatic offset. |
| Light Sweep | Light | Moving beam/reveal over clips. |
| Lens Flare | Light | Generated flare overlay; keep deterministic. |
| Film Burn | Film | Burn edge/luma mask with color ramp. |
| Film Roll | Film | Vertical roll/offset plus motion blur. |
| Projector Flicker | Film | Exposure flicker plus optional gate weave. |
| Vignette Bloom | Lens | Bloom edge hides the cut. |
| Zoom Blur | Lens/Motion | Radial blur into outgoing/incoming. |
| Directional Blur | Lens/Motion | Directional blur with optional slide/push. |
| Whip Pan | Lens/Motion | Fast directional blur + motion offset. |

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
| Checker Wipe | Pattern | Checkerboard reveal with tile count. |
| Random Blocks | Pattern | Block reveal with seeded ordering. |
| Paint Splatter | Pattern | Noise/splat mask reveal. |
| Star Wipe | Shape | Star-shaped reveal; niche but expected. |
| Zig-Zag Blocks | Pattern | Alternating block bands. |
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
| Water Drop | Exotic/Warp | Radial ripple lens that distorts both clips around an expanding drop. |
| Liquid Melt | Exotic/Warp | Vertical luminance/noise melt where pixels drip into the next clip. |
| Luminance Melt | Exotic/Key | Bright/dark regions dissolve at different rates. |
| Kaleidoscope | Exotic/Pattern | Mirror-fold UVs around center, then mix into incoming. |
| Fly Eye | Exotic/Lens | Honeycomb lens cells sample offset copies of the image. |
| Hex Pixelize | Exotic/Pattern | Hexagonal cells resolve from outgoing to incoming. |
| Puzzle Push | Exotic/Pattern | Puzzle/maze-shaped pieces slide or reveal. |
| Polka Dot Curtain | Exotic/Pattern | Repeating circles open/close like a dotted curtain. |
| Doom Bars | Exotic/Retro | Vertical columns fall at varied speeds. |
| Stereo Viewer | Exotic/3D | Split red/cyan or side-by-side stereoscopic skew during cut. |
| Swirl | Exotic/Warp | Rotational UV displacement around center. |
| Wormhole Zoom | Exotic/Warp | Tunnel/radial zoom with chromatic edge distortion. |
| VHS Head Switch | Analog/Glitch | Bottom-frame horizontal wobble and noise tear. |
| CRT Collapse | Analog/Glitch | Image collapses to horizontal/vertical beam, then expands. |
| Thermal Bloom | Stylized/Color | Heat-map color ramp blooms through the cut. |
| Ink Bleed | Organic/Mask | Expanding soft procedural ink mask. |
| Smoke Reveal | Organic/Overlay | Noise-flow alpha reveal with soft smoke-like edges. |
| Shatter Glass | Exotic/Pattern | Voronoi shards rotate/slide away. |
| Magnetic Tiles | Exotic/Pattern | Tiles attract toward a moving point before revealing incoming. |
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
  multi-panel transitions. They need per-cell transforms, stable seeded cell
  ordering, and deterministic z/order.
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
3. Extend `TimelineTransition` with a `params?: Record<string, unknown>` field
   only after a typed validation layer exists.
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
| Dip/flash/blur-to-color | Fade outgoing to a generated solid/overlay, then fade incoming up. | `solid`, `opacity`, `overlay`, optional `inlineEffect`. |
| Linear/diagonal wipe | Compute a signed distance from a moving line in UV space; use smoothstep for softness. | `linear-mask`. |
| Shape/iris/star wipe | Compute signed distance to shape boundary; reveal where distance is inside progress threshold. | `shape-mask`, `pattern-mask`. |
| Clock/radial wipe | Convert UV to polar angle around center; reveal angular segment based on progress. | `clock-mask`. |
| Venetian/blinds/stripe | Repeat UV into cells/stripes, then reveal each stripe with optional stagger. | `stripe-mask`, `pattern-mask`. |
| Checker/random blocks | Quantize UV into tiles; derive deterministic order from tile index plus seed. | `pattern-mask` with `seed`. |
| Luma fade/matte dissolve | Sample luma from one participant or matte; compare against progress threshold with softness. | dedicated luma/matte shader path. |
| Push/slide/whip | Move participant layer transforms over progress; add blur only as a separate pass. | `transform`, optional `inlineEffect`. |
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
  | InlineEffectPrimitive
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
- `inlineEffect`: transition-scoped blur/brightness/contrast/saturation where
  the compositor path can support it.
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

This is a shader ABI change. It must be implemented serially across
`src/types/layers.ts`, uniform packing, `src/shaders/composite.wgsl`,
`externalCompositeShader.ts`, and the focused compositor tests before any
parallel effect-family packet depends on it.

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

## Multi-Agent Execution Model

This EXTRA plan is large enough to benefit from parallel agents, but only after
the shared transition contracts are stable. Parallel work should be organized by
contract boundary first, then by transition family, and only then by individual
effect.

### Serial First: Contract Lock

Run these packets serially with one owner:

- EX0 Contract, Capability, And Param Hardening
- EX0A Registry Extensibility And Capability Filtering
- EX0B Transition Shader ABI
- EX0C Transform Composition Contract
- EX0D Two-Participant Transition Pass Feasibility
- EX0E Transition Pass Planner And Overlay Cache Feasibility
- Any schema migration or project-load behavior for `TimelineTransition.params`
- Any first expansion of `TransitionPrimitive`
- Any first expansion of `TransitionRenderState`
- Any compositor uniform layout change
- Any first production/experimental/planned capability filter

These files are shared hot spots and should not be edited by multiple agents at
the same time:

- `src/transitions/types.ts`
- `src/transitions/index.ts`
- `src/types/layers.ts`
- `src/types/timelineCore.ts`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `src/stores/timeline/editOperations/transitionOperations.ts`
- `src/stores/timeline/editOperations/transactionTypes.ts`
- `src/stores/timeline/editOperations/transitionPlanner.ts`
- `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`
- `src/components/panels/properties/TransitionTab.tsx`
- `src/components/timeline/hooks/useTransitionDrop.ts`
- `src/components/timeline/transitionDragData.ts`
- `src/engine/pipeline/compositor/uniforms.ts`
- `src/shaders/composite.wgsl`
- `src/engine/pipeline/compositor/externalCompositeShader.ts`
- `src/components/panels/TransitionsPanel.tsx`
- `tests/unit/transitionRegistry.test.ts`
- `tests/unit/compositorUniforms.test.ts`
- `tests/unit/layerBuilderService.test.ts`
- `tests/unit/exportLayerBuilder.test.ts`

### Wave 1: Parallel By Primitive Family

After EX0 through the required serial gates are green, dispatch bounded agents
by primitive family rather than by individual transition. Each agent gets a
disjoint write set and reports any needed shared-contract change instead of
making it directly.

| Agent | Scope | Primary write set | Forbidden/shared files unless explicitly assigned |
|---|---|---|---|
| Linear/Shape Masks | Wipe Up/Down, diagonal wipes, circle/diamond/square/clock masks | `src/transitions/wipe*/`, `src/transitions/*Iris*/`, focused tests | shared hot spots above |
| Transform/2.5D | Push, Slide, Flip, Card prototypes | `src/transitions/push*/`, `src/transitions/slide*/`, `src/transitions/flip*/`, focused tests | shared hot spots above |
| Glitch/Distortion | RGB split, block glitch, mosaic glitch, scanline, signal tear | `src/transitions/*Glitch*/`, `src/transitions/*Mosaic*/`, focused tests | shared hot spots above |
| Light/Film/Overlay | Flash, light leak, film burn, flare, zoom/directional blur planning | `src/transitions/*Light*/`, `src/transitions/*Film*/`, focused tests | shared hot spots above |
| Pattern/MultiPanel | Checker, random blocks, star, polka dots, tiles, shatter planning | `src/transitions/*Pattern*/`, `src/transitions/*Blocks*/`, focused tests | shared hot spots above |
| Browser/UI | Category search, capability badges, thumbnail family renderer | panel CSS/component helpers and focused UI tests | transition render contracts and acceptance gating |

Use two to four agents by default. Go wider only when the primitive contracts
are already locked and write sets are genuinely disjoint.

### Wave 2: Parallel By Effect Or Mini-Pack

Once a primitive family is implemented and tested, individual effects can be
parallelized safely. Prefer one agent per mini-pack, not one agent per trivial
variant.

Good mini-packs:

- Directional wipes: `wipe-up`, `wipe-down`, diagonal variants.
- Push/Slide cardinal directions.
- Iris/shape masks: circle, diamond, square, clock.
- Glitch set: RGB Split, Block Glitch, Scanline, Signal Tear.
- Light/film set: Flash, Light Leak, Film Burn.
- Exotic shader set: Water Drop, Swirl, Kaleidoscope, Doom Bars.

Rules:

- Agents may add new leaf transition folders after the primitive contract
  exists.
- Agents may add focused tests for their own effects.
- Agents must not change core contracts, shared shaders, or panel architecture
  unless their packet explicitly owns those files.
- If an effect needs a new primitive, stop and report the primitive gap; do not
  implement a one-off special path.

### Wave 3: Serial Integration

Finish each multi-agent wave with a serial integration pass:

- Review all diffs for duplicated primitives or divergent naming.
- Update manual registry imports/type unions only in this integration pass,
  unless a prior serial packet has replaced them with generated/array-backed
  registry metadata.
- Register only transitions whose preview/export path is actually implemented
  or explicitly hidden as planned/experimental metadata.
- Run focused tests for touched primitive families.
- Run `npx tsc -b --pretty false`.
- Update docs only after behavior is verified.
- Keep planned/experimental transitions hidden from production UI.

### Agent Report Template

Every agent should end with:

- Files changed.
- Transition IDs added or modified.
- Primitive families used.
- Any shared-contract changes requested but not made.
- Tests run and exact result.
- Known gaps or follow-up packets.

Agents must not commit, push, merge, or broaden scope. Extra transition ideas
found mid-packet go back into this plan instead of being implemented ad hoc.

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
- focused registry/UI acceptance tests

**Requirements:**

- Production UI exposes only stable transitions.
- Experimental transitions are hidden unless a dev/feature flag enables them.
- Planned transitions can exist as metadata/docs but cannot be dropped,
  selected in the type dropdown, planned, or rendered.
- Until the manual `TransitionType` union and registry imports are replaced,
  only the serial integrator edits `src/transitions/types.ts` and
  `src/transitions/index.ts`.

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
render-state contract before parallel shader families start.

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

**Prerequisite:** EX0C.

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

**Prerequisite:** EX0B.

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

**Prerequisite:** EX0B for blend/mask states. Blur Dissolve also requires EX0E
if it needs a real blur pass rather than simple opacity/blend changes.

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

**Goal:** Add a conservative 2.5D transition transform layer that supports
Flip and Card Spin first, without creating a separate renderer.

**Prerequisite:** EX0C.

**Write set:**

- `src/transitions/types.ts`
- `src/transitions/**`
- `src/services/layerBuilder/transitionLayerAssembly.ts`
- `src/types/layers.ts`
- focused preview/export layer tests

**Requirements:**

- Reuse existing layer `rotation.x`, `rotation.y`, `position.z`, perspective,
  scale, opacity, and normal blend path where possible.
- Provide deterministic ordering for 3D transition sublayers.
- Keep Cube, Door, Fold, and Page Peel out of this packet unless transform
  origin and multi-panel contracts are already solved.
- Do not route transition-time 2.5D cards through the real shared-scene 3D
  renderer. These are compositor transition constructs, not timeline 3D assets.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** Flip Horizontal/Vertical and Card Spin render with
preview/export parity and no changes to non-transition layers. Cube/Door/Fold
remain planned unless origin/panel slicing exists.

### Packet EX9: Glitch Primitive Foundation

**Goal:** Add deterministic glitch primitives for RGB split, block glitch,
mosaic glitch, scanline tear, and digital noise dissolve.

**Prerequisite:** EX0B. Any glitch that needs raw outgoing and incoming samples
in the same shader also requires EX0D.

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

**Stop condition:** RGB Split Glitch, Block Glitch, Mosaic Glitch, Scanline
Glitch, and Digital Noise Dissolve are visibly distinct, seeded, and
serializable.

### Packet EX10: Light, Film, And Blur Transition Foundation

**Goal:** Add generated overlay/effect primitives for Flash, Light Leak,
Chroma Leak, Film Burn, Zoom Blur, Directional Blur, and Whip Pan.

**Prerequisite:** EX0E.

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
  represented by existing inline effects.
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

**Goal:** Add checker, random block, paint splatter, star wipe, zig-zag, and
luma fade planning.

**Prerequisite:** EX0B for procedural patterns. Luma Fade requires EX0D and
must remain planned if no two-participant transition pass exists.

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
npm run test -- tests/unit/transitionRegistry.test.ts tests/unit/compositorUniforms.test.ts
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
- transition metadata/thumbnail helpers
- docs in `docs/Features/`

**Requirements:**

- Category groups can be collapsed.
- Search includes aliases such as "glitch", "3d", "light", "film", and
  "wipe".
- Stable badges distinguish Stable, Experimental, and Planned in dev builds.
- Production panel hides planned definitions.
- Thumbnail previews derive from family metadata where possible.

**Checks:**

```bash
npm run test -- tests/unit/transitionRegistry.test.ts
npx tsc -b --pretty false
```

**Stop condition:** The panel remains usable with at least 60 definitions and
does not require manual layout work per transition.

### Packet EX13: Exotic Shader Lab Pack

**Goal:** Add an experimental pack of exotic shader transitions after the core
distortion, pattern, overlay, and multi-panel primitives are proven.

**Prerequisite:** EX0B, EX0D, and EX0E for any effect that distorts both clips,
uses generated overlays, or needs a multi-pass pipeline.

**Candidate set:**

- Water Drop
- Liquid Melt
- Luminance Melt
- Kaleidoscope
- Fly Eye
- Hex Pixelize
- Puzzle Push
- Polka Dot Curtain
- Doom Bars
- Swirl
- VHS Head Switch
- CRT Collapse
- Ink Bleed
- Smoke Reveal
- Portal Ring

**Write set:**

- `src/transitions/**`
- `src/transitions/types.ts`
- compositor shader/uniform files as needed
- generated overlay/cache helpers as needed
- `src/components/panels/TransitionsPanel.tsx`
- focused tests per primitive family

**Requirements:**

- Mark the pack `experimental` until performance and export parity are proven.
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

**Stop condition:** The lab pack can be toggled on in dev builds, each
transition is visibly distinct, and disabling experimental transitions removes
them from the production panel without affecting persisted stable transitions.

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
- Run at desktop and narrow panel widths with many transition definitions.
- Verify Linux/Mesa fallback expectations for any new canvas/GPU path; do not
  allocate full-timeline or full-content canvases for transition previews.

---

## Acceptance Checklist

- [ ] Transition params are durable, validated, undoable, and serializable.
- [ ] Existing `TimelineTransition.params` behavior is hardened with explicit
      unknown-param, load, type-change, and undo/redo policies.
- [ ] Capability filtering applies before panel display, type dropdowns,
      drag/drop, planner validation, and edit operations.
- [ ] Shader ABI changes update normal texture and external-video compositor
      paths together.
- [ ] Two-participant shader effects are implemented through a deliberate pass
      or kept planned.
- [ ] Generated overlay/light/blur effects have a Mesa-aware pass/cache model.
- [ ] Wipe render state supports horizontal and vertical directions.
- [ ] Push and Slide render through transform primitives in preview and export.
- [ ] Shape/iris masks render through generic mask render state.
- [ ] Dip to Color exists without breaking Dip to Black/White.
- [ ] Stylized dissolves are visually distinct and not renamed crossfades.
- [ ] 3D transitions use stable 2.5D layer transforms or an explicit mesh plan.
- [ ] Page Peel is not exposed until the curved/strip mesh model is credible.
- [ ] Glitch transitions are seeded and deterministic in preview and export.
- [ ] Datamosh remains deferred until a frame-history/motion-vector model
      exists.
- [ ] Light, film, and blur transitions use deterministic generated overlays or
      explicit pass plans.
- [ ] Pattern transitions use procedural masks or a deliberate matte pipeline.
- [ ] Exotic Shader Lab transitions are experimental by default and map to
      reusable primitives.
- [ ] Water/liquid/swirl transitions use deterministic UV distortion, not
      mutable frame history.
- [ ] Shatter/puzzle/tile transitions use deterministic multi-panel ordering.
- [ ] AI/neural transitions remain planned until derived-frame cache and export
      behavior are specified.
- [ ] Transitions panel scales by category/search without hard-coded layout
      changes for every new definition.
- [ ] Stable/experimental/planned capability levels prevent unfinished effects
      from appearing in production UI.
- [ ] No new transition type changes planner semantics unless explicitly
      documented.
- [ ] Preview and export remain visually aligned for virtual handles and
      hold-frame fallback.
- [ ] Smooth Cut/Flow remains deferred until a real optical-flow/morphing plan
      exists.

---

## Risks

- **Risk:** The registry grows faster than the renderer, producing many
  differently named crossfades.
  **Mitigation:** Require a distinct primitive/render model before registering
  each transition ID.

- **Risk:** Parallel agents conflict on the current manual registry and literal
  `TransitionType` union.
  **Mitigation:** Keep registry/type edits serial, or first replace the manual
  shape with an array-backed/generated registry contract.

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
