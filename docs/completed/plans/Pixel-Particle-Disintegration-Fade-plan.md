> Status: Archived from `docs/ongoing/` on 2026-06-25 after docs triage; historical planning context unless explicitly reopened.

> Status: V1 implemented and runtime-verified for the main WebGPU compositor
> path on 2026-06-22, with an explicit worker-gpu-only opacity-envelope fallback
> policy. Keep this as ongoing verification context until the feature is moved
> to completed docs.

# Pixel Particle Disintegration Fade Plan

**Date:** 2026-06-15  
**Reviewed:** 2026-06-16, 2026-06-22
**Base:** current WebGPU/WGSL render stack  
**Scope:** one-sided fade-out/fade-in effect for visual clips, not a normal
two-clip timeline transition

---

## Purpose

Build a visual effect where a clip dissolves into many colored particles. Each
particle starts as a mapped source-image cell, carries the UV patch from that
origin cell, and moves through a 3D-looking force field as the effect
progresses.

The first target is a fade-out/outro effect:

- the source image is already represented as aligned particle cells at progress `0`
- particles begin to separate during the fade window
- there is no normal full-frame source plane contribution in the final look
- particles drift, curl, spread in depth, and fade by progress `1`

This is not a classical `src/transitions/` timeline transition because it does
not require an incoming clip. It is closer to a clip outro/intro render effect
that can be driven by keyframes or by a timeline fade handle.

---

## Current Architecture Facts

MasterSelects already has several WGSL/WebGPU pipelines, but none matches this
effect exactly:

- Registered effects in `src/effects/` are fullscreen fragment passes. They
  transform an input texture into an output texture pixel-by-pixel.
- `src/effects/EffectsPipeline.ts` is the authoritative runtime effect
  pipeline for the compositor path. There is also a legacy
  `src/engine/pipeline/EffectsPipeline.ts`; do not implement this feature in
  the legacy path unless a later audit proves it is still active.
- `EffectDefinition` and registry validation currently assume fullscreen
  fragment effects with `shader`, `entryPoint`, `params`, and `packUniforms`.
  `EffectsPipeline.createPipelines()` eagerly compiles registered non-inline
  effects, so a non-fullscreen effect must be explicitly skipped by pipeline
  kind before it is registered.
- `src/types/effects.ts` has a closed `EffectType` union. Adding the registry
  entry is not enough; the effect ID must be added to the type layer too.
- The compositor in `src/shaders/composite.wgsl` blends layers and carries
  compact `transitionRender` state for masks and UV distortions.
- Timeline transitions in `src/transitions/` are serializable recipes for two
  participants: outgoing, incoming, generated solids, overlays, masks,
  transforms, blend overrides, and registered fullscreen effects.
- Native 3D transition support renders whole clips as textured planes inside
  the shared scene. It does not split a source plane into particles.
- Gaussian splat particle compute exists, but it targets splat data, not normal
  video/image/text layers.
- Gaussian splat rendering is still useful as a template for instanced quads,
  pipeline caching, resource cleanup, and HMR-safe renderer ownership.
- Complex effects are consumed in the main compositor, nested composition
  compositor, and thumbnail rendering path. All three must be kept coherent:
  `src/engine/render/Compositor.ts`,
  `src/engine/render/nestedComp/compositeNestedLayers.ts`, and
  `src/services/thumbnailRender/compositeFrame.ts`.
- Strict worker GPU playback/presentation now has its own effect projection
  path under `src/services/render/workerGpuMediaSourceRegistry.ts` and
  `src/services/render/workerGpuVideoFrameLayerPresenter.ts`. It maps selected
  registered effects into worker-side video-frame shader uniforms instead of
  calling the normal `EffectsPipeline`. A particle render effect must have an
  explicit worker-GPU policy before implementation: unsupported with a visible
  fallback, or a dedicated worker-GPU particle integration. Do not assume the
  main compositor integration automatically covers worker-gpu-only preview.

The missing piece is a particle render pass for ordinary layer source textures.

---

## Architecture Direction

### Use WGSL Directly

The implementation should use WGSL, not GLSL. WebGPU does not run GLSL directly
in this codebase, and a WebGL sidecar would add synchronization and texture
transfer complexity without solving a core product need.

### Treat It As A Render Effect

The effect should be registered as a clip effect for UI and persistence, but
processed by a specialized renderer instead of the normal fullscreen
`EffectsPipeline`.

Candidate effect ID:

```text
pixel-particle-disintegrate
```

Candidate category:

```text
stylize
```

The effect stack needs a third classification in addition to current inline
and complex effects, or an equivalent terminal render-effect classification:

```ts
interface LayerEffectStack {
  inlineEffects: InlineEffectParams;
  complexEffects?: Effect[];
  renderEffects?: Effect[];
}
```

Longer term, replace this with a small per-layer pass plan so fullscreen and
special render effects can preserve stack order:

```text
source -> fullscreen effects -> particle render -> fullscreen effects -> composite
```

For V1, the particle effect can be restricted to one active instance per layer
and must be treated as terminal in the layer stack. The UI or pass classifier
should reject, warn, or disable effects that appear after it. Do not silently
reorder the stack.

V1 contract decisions:

- `pipelineKind: 'particle-render'`.
- exactly one active particle-render effect per layer.
- terminal-only in the stack.
- the normal source plane is not drawn by the particle renderer; fallback to an
  opacity fade still uses the same progress envelope in paths without the
  dedicated particle pass.
- fade-in is the same effect/preset with reversed progress.
- live color sampling only; `freeze` mode is deferred.

### Render Instanced Quads

Do not use one CPU-created particle object per pixel. The renderer should draw
instanced quads:

```text
draw(4 vertices per quad, columns * rows instances)
```

Use a triangle-strip style quad unless there is a concrete reason to use a
6-vertex triangle list. The gaussian splat renderer already proves this shape
works in the codebase.

Each instance ID maps to one image cell:

```text
instance -> column,row -> base UV -> source color
```

The vertex shader computes the particle's screen/depth position procedurally
from:

- base UV
- progress
- source/output aspect
- seed
- force parameters
- explicit deterministic motion time

The fragment shader samples the input texture through UVs assigned from the
particle's origin cell, so each moving quad carries its original image patch
instead of sampling from its displaced screen position. V1 still samples the
current source texture for that origin patch, so video content remains live
while the video plays; freezing a start-frame texture remains a separate V2
mode.

### Stay Deterministic

The first implementation must not rely on accumulated simulation state.
Scrubbing directly to frame N must match playing to frame N, and export must
match preview.

Use analytic, deterministic motion:

```text
position = basePosition + displace(baseUV, progress, seed, mediaTime, params)
```

`progress` is the primary deterministic driver. The current layer effect path
does not pass a generic `clipLocalTime` into `EffectsPipeline.applyEffects()`;
if secondary animated motion is needed, use available source/media time such as
`displayedMediaTime` or explicitly thread a render-time value through the new
particle path. Do not assume `clipLocalTime` already exists at the renderer
call site.

This can still feel force-driven by combining:

- curl-like noise
- radial explosion
- directional bias
- depth drift
- gravity or lift
- per-particle start delay
- luma or noise weighted reveal order

Stateful compute simulation can be a V2 feature only if it has a deterministic
replay model, a reset model, and export parity.

---

## Visual Model

For fade-out, the visible contributor is the particle field itself:

1. Particles start fully visible and aligned with their source cells.
2. Progress moves through a deterministic gust/release field, curls,
   staggers, and finally fades the particles out.

Recommended progress envelope:

```text
0.00 - 0.15: aligned particle cells approximate the source without a flat plane
0.15 - 0.82: particles separate, curl, drift, and spread
0.82 - 1.00: particles fade out
```

Per-particle local progress:

```text
gustField = fbm(baseUv * gustScale + seed)
releaseField = mix(hash(cell, seed), gustField, gustStrength)
delay = ((1 - contrast(releaseField)) * stagger) + windFront(baseUv) * windSweep
local = smoothstep(delay, delay + tail, globalProgress)
```

Optional reveal order modes:

- random
- left-to-right
- center-out
- luma-bright-first
- luma-dark-first

The default is deterministic coherent gust pockets plus a mild directional wind
front, so the image breaks up in scattered regions before the rest follows
instead of looking like a uniform grid wipe.

---

## Initial Parameters

Regular parameters:

- `progress`: 0..1, animatable
- `cellSize`: particle source cell size in pixels
- `particleSize`: rendered quad size multiplier
- `spread`: overall displacement scale
- `depth`: z-axis spread before perspective projection
- `curlStrength`: curl/noise displacement strength
- `turbulence`: high-frequency noise amount
- `directionX`: horizontal bias
- `directionY`: vertical bias
- `gravity`: downward/upward acceleration over progress
- `spin`: per-particle rotation amount
- `stagger`: delay range across particles
- `gustStrength`: blend from per-cell random release toward coherent gust
  pockets and add wind-like force to released particles
- `gustScale`: spatial scale of the deterministic gust map; intentionally not
  animatable by default because changing it reshapes the release map
- `windSweep`: directional front delay layered on top of the gust pockets
- `releaseContrast`: how sharply early-release pockets separate from late ones
- `tail`: local fade/displacement transition width
- `seed`: deterministic random seed

Quality parameters:

- `maxPreviewParticles`
- `maxExportParticles`
- `maxInstances`
- `softness` or `shape`: square, soft circle, shard

Defaults should target performance, not maximum density:

- Preview default: roughly 25k to 80k particles depending on resolution.
- Export default: allow higher density, but clamp by explicit particle budget.
- Very small `cellSize` values must be capped or warned.
- V1 uses live sampling only. `colorMode = freeze` is a V2 parameter because it
  requires snapshot texture lifetime, device-loss cleanup, and export cache
  semantics.

---

## Integration Points

### Effect Registry

Add the effect definition under `src/effects/stylize/` with normal serializable
params and defaults. The definition needs a way to declare that it is not a
normal fullscreen fragment effect.

Possible type extension:

```ts
type EffectPipelineKind = 'fullscreen' | 'particle-render';

interface EffectDefinition {
  pipelineKind?: EffectPipelineKind;
}
```

Default remains `fullscreen` for existing effects.

Contract update from the 2026-06-22 review: `EffectDefinition` currently
requires `shader`, `entryPoint`, `uniformSize`, and `packUniforms`, and
`src/effects/index.ts` validates registered effects by checking those fields.
For `particle-render`, either make those fullscreen-only fields optional behind
a discriminated definition shape, or add helper predicates such as
`isFullscreenEffectDefinition()` and `isParticleRenderEffectDefinition()`. Do
not register the particle effect with dummy WGSL just to satisfy the old shape;
that would invite the fullscreen pipeline to compile the wrong thing.

Implementation must also update:

- `src/types/effects.ts` for the closed effect ID/type union.
- `src/effects/index.ts` registry validation so `particle-render` definitions
  are valid without being treated as fullscreen shaders.
- `src/effects/EffectsPipeline.ts` so `createPipelines()`,
  `ensureEffectPipeline()`, and `applyEffects()` skip non-fullscreen effects.
- focused registry/type tests, especially `tests/unit/effectsRegistry.test.ts`,
  `tests/unit/layerEffectStack.test.ts`, and the hard-coded `EffectType`
  coverage in `tests/unit/typeHelpers.test.ts`.

### Layer Effect Processing

Current code splits layer effects in `src/engine/render/layerEffectStack.ts`.
Extend that split or replace it with a pass planner that preserves order.

Minimum V1 path:

- inline effects remain inline
- normal effects before particle are rendered into a source texture
- particle renderer consumes that texture
- the resulting particle texture becomes the layer texture for compositing
- effects after the particle effect are unsupported in V1 and must be rejected
  or clearly warned, not silently skipped or reordered

The better long-term target is a pass planner, but that is a V2 architecture
step. V1 should stay terminal-only to avoid half-building stack-order
semantics.

The V1 classifier should return enough metadata for validation and fallback,
not just arrays:

```ts
interface LayerEffectStack {
  inlineEffects: InlineEffectParams;
  complexEffects?: Effect[];
  renderEffects?: Effect[];
  unsupportedAfterRenderEffect?: Effect[];
}
```

or an equivalent result type. If a particle render effect appears before other
effects, the first implementation must reject or warn through a deterministic
path and avoid silently dropping later effects. This validation belongs near
`src/engine/render/layerEffectStack.ts` and the effect UI/preset creation code
so invalid stacks are caught before they become black-frame render failures.

### Particle Renderer

Add a dedicated renderer, for example:

```text
src/engine/particles/PixelParticleDisintegrateRenderer.ts
src/engine/particles/shaders/PixelParticleDisintegrate.wgsl
```

Responsibilities:

- create and cache the render pipeline
- create bind group layout
- write uniform data
- render into a provided output-sized `rgba8unorm` target view, preferably one
  of the existing compositor ping-pong temp textures
- own any private GPU resources through the engine resource lifecycle
- clamp particle grid to preview/export budgets
- expose debug counters for particle count and render time

Avoid a private allocator unless the existing compositor temp views cannot be
used. The current main/nested effect paths already keep output-sized ping-pong
textures; reusing those avoids a second resize/destroy path and keeps export
and preview closer.

### Source Texture Handling

The particle pass should sample a normal `texture_2d<f32>` source.

When the current layer uses `GPUExternalTexture` video input, copy it to a
regular texture first using the existing external-copy pattern before invoking
the particle pass.

The source order should be:

```text
external video/image/canvas source
-> regular texture if needed
-> color correction and prior effects
-> particle renderer
-> compositor
```

### Main, Nested, And Thumbnail Composition Paths

The main compositor, nested composition compositor, and thumbnail renderer all
apply layer effects. The particle pass must be integrated into all three paths
or factored into a shared helper used by all relevant paths:

- `src/engine/render/Compositor.ts`
- `src/engine/render/nestedComp/compositeNestedLayers.ts`
- `src/services/thumbnailRender/compositeFrame.ts`

Avoid adding a main-preview-only implementation that export, nested comps, or
thumbnails do not use.

### Worker GPU Playback / Presentation Path

Strict worker-gpu-only playback does not currently call the normal compositor
effect pipeline. It projects known effects into worker-side video-frame layer
uniforms and presents through:

- `src/services/render/workerGpuMediaSourceRegistry.ts`
- `src/services/render/workerGpuVideoFrameLayerPresenter.ts`
- `src/services/render/workerGpuVideoFrameLayerShaderSource.ts`
- `src/services/render/workerPresentingRenderHostPort.ts`

V1 must choose one of these policies before coding:

1. **Unsupported in worker-gpu-only preview:** detect
   `pixel-particle-disintegrate`, log a clear recoverable warning, and fall
   back to an ordinary opacity envelope or non-worker preview for that layer.
2. **Dedicated worker-GPU particle path:** add a worker-side particle renderer
   that consumes a transferred `ImageBitmap`/`VideoFrame` texture or worker
   source texture, uses the same deterministic params, and reports stats.

Do not add the particle effect to the existing worker video-frame uniform blob.
It is a render pass, not a scalar/color adjustment. If V1 chooses unsupported
worker-gpu-only behavior, the acceptance criteria must explicitly test that it
falls back visibly and never renders stale/black frames.

### Export

Export must use the same effect params, source time, and particle math as
preview. Do not use wall-clock time for particle motion.

Use explicit deterministic render time or media time from the render frame
context:

```text
motionTime = explicit particle render time or displayedMediaTime
```

Wall-clock animated behavior can be a separate option later, but it should not
be the default because it breaks deterministic export.

### UX

V1 can ship as a normal clip effect in the Effects tab with `progress`
keyframable.

V1.5 should add an "outro fade effect" convenience action:

- add `pixel-particle-disintegrate`
- create progress keyframes near the clip end
- use the particle-only progress envelope from aligned source cells to fade-out

V2 can connect this to the existing fade handles so dragging the right fade
handle can choose ordinary opacity fade or particle disintegration fade. Do not
add a new persisted fade mode in V1; the first UX should be a preset/action
that creates normal effect keyframes.

---

## Shader Sketch

Uniform concept:

```wgsl
struct PixelParticleParams {
  progress: f32,
  cellSize: f32,
  particleSize: f32,
  spread: f32,
  depth: f32,
  curlStrength: f32,
  turbulence: f32,
  stagger: f32,
  tail: f32,
  seed: f32,
  motionTime: f32,
  width: f32,
  height: f32,
  columns: u32,
  rows: u32,
  maxInstances: u32,
  _pad0: u32,
}
```

Vertex concept:

```text
instanceIndex -> cell x/y
cell center -> base uv
hash(base uv + seed) -> delay/random direction
local progress -> displacement/depth/scale
project 3D point -> clip space
emit quad uv + origin-cell source uv + alpha
```

Fragment concept:

```text
sample source at origin-cell uv carried by the moving quad
apply soft particle mask from quad local uv
return straight alpha for the normal compositor path
```

Use quads instead of point sprites because WebGPU does not provide the old
OpenGL-style programmable `gl_PointSize` path.

---

## Work Packets

### Packet P0: Contract And Feasibility Lock

**Goal:** Decide the durable effect contract before editing the renderer.

**Write set:**

- `docs/ongoing/Pixel-Particle-Disintegration-Fade-plan.md`
- optional focused design notes near effect types if implementation starts

**Decisions:**

- effect ID and category
- V1 is terminal-only and one particle-render effect per layer
- renderer output is particle-only; there is no flat source plane contribution
- fade-in is reversed progress, not a separate renderer
- live sampling only; freeze mode deferred
- straight-alpha output for the normal compositor path
- preview/export particle budgets and hard `maxInstances`
- fallback behavior when the renderer cannot run
- whether particles may leave the source rectangle in V1 or must remain clipped
  to the layer output

**Stop condition:** the implementation path is explicitly clip-effect based,
not a two-clip transition recipe, and coding-blocking decisions are no longer
open.

### Packet P0.1: Current Render Path Reconciliation

**Goal:** Reconcile this plan with the current large-codebase render paths
before source edits begin.

**Write set:**

- `docs/ongoing/Pixel-Particle-Disintegration-Fade-plan.md`
- optional short design note if worker-GPU policy needs a separate handoff

**Decisions:**

- Whether V1 supports worker-gpu-only preview directly or falls back with a
  visible warning.
- The exact `EffectDefinition` shape for non-fullscreen effects:
  discriminated union vs helper predicates.
- The terminal-only validation surface: effect classifier only, UI/preset
  guard, or both.
- Whether P1.5 extracts one shared source-preprocess helper for main, nested,
  and thumbnail before any particle renderer code.

**Stop condition:** a future coding packet has no ambiguity about which render
paths must support the particle effect and which paths intentionally fall back.

### Packet P1: Effect Definition And Pass Classification

**Goal:** Add a serializable effect definition and classify it as a special
render effect without letting the fullscreen pipeline compile it.

**Write set:**

- `src/effects/types.ts`
- `src/types/effects.ts`
- `src/effects/index.ts`
- `src/effects/EffectsPipeline.ts`
- `src/effects/stylize/pixel-particle-disintegrate/`
- `src/effects/stylize/index.ts`
- `src/engine/render/layerEffectStack.ts`
- focused effect registry/type/split tests:
  `tests/unit/effectsRegistry.test.ts`,
  `tests/unit/layerEffectStack.test.ts`, and targeted updates to
  `tests/unit/typeHelpers.test.ts`

**Checks:**

```bash
npm run test -- tests/unit/effectsRegistry.test.ts tests/unit/typeHelpers.test.ts tests/unit/layerEffectStack.test.ts
npx tsc -b --pretty false
```

**Stop condition:** the effect appears in the registry with default params but
is not incorrectly compiled as a fullscreen fragment effect, `getEffectConfig`
does not return fullscreen pipeline config for it, and existing effects without
`pipelineKind` still behave as fullscreen effects.

### Packet P1.5: Shared Source Preprocess Helper

**Goal:** Extract the duplicated source-preprocess flow before adding the
particle hook.

**Write set:**

- `src/engine/render/Compositor.ts`
- `src/engine/render/nestedComp/compositeNestedLayers.ts`
- `src/services/thumbnailRender/compositeFrame.ts`
- shared helper under `src/engine/render/` if needed
- focused tests or no-op regression coverage around effect splitting

**Responsibilities:**

- external video copy to a regular texture
- color correction and prior fullscreen effects
- temp texture ping-pong ownership at output size
- terminal render-effect dispatch point

**Checks:**

```bash
npm run test -- tests/unit/layerEffectStack.test.ts
npx tsc -b --pretty false
```

**Stop condition:** main preview, nested composition, and thumbnail rendering
still render existing inline/fullscreen effects exactly as before, through the
shared helper.

### Packet P2: Particle Renderer Skeleton

**Goal:** Render a still image or canvas source into particles in an offscreen
target texture.

**Write set:**

- `src/engine/particles/PixelParticleDisintegrateRenderer.ts`
- `src/engine/particles/shaders/PixelParticleDisintegrate.wgsl`
- render target/resource helper only if existing temp views are insufficient
- focused renderer/unit tests where practical

**Implementation notes:**

- model the renderer shape on the gaussian splat instanced quad renderer where
  useful, but keep this renderer source-texture based
- use 4-vertex instanced quads
- keep motion analytic and deterministic
- output straight alpha
- clamp `columns * rows` by `maxInstances`
- do not implement depth sorting or mutable compute simulation in V1
- own GPU resources through the engine resource lifecycle/device-loss path

**Checks:**

```bash
npx tsc -b --pretty false
```

**Manual QA:**

- add the effect to a still image clip
- keyframe progress from 0 to 1
- capture preview screenshots at progress 0, 0.5, and 1
- scan browser logs for shader validation errors

**Stop condition:** still-image clips produce visible particles without blank
frames or layout/compositor regressions.

### Packet P3: Video Source And Effect Stack Integration

**Goal:** Support live video origin-patch sampling and integrate all
non-worker-GPU effect consumers.

**Write set:**

- `src/engine/render/Compositor.ts`
- `src/engine/render/nestedComp/compositeNestedLayers.ts`
- `src/services/thumbnailRender/compositeFrame.ts`
- shared effect pass helper if extracted
- source/external texture copy handling
- focused tests for pass selection and no-op behavior

**Checks:**

```bash
npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** video clips keep updating the source patches carried by
particles frame by frame, and nested compositions and thumbnails use the same
path as the main preview.

### Packet P3.5: Worker GPU Policy Implementation

**Goal:** Implement the V1 worker-gpu-only policy chosen in P0.1.

**Write set if V1 fallback is chosen:**

- `src/services/render/workerGpuMediaSourceRegistry.ts`
- `src/services/render/workerPresentingRenderHostPort.ts`
- focused worker-GPU fallback tests

**Write set if dedicated worker particle support is chosen:**

- worker-side particle renderer files under `src/services/render/` or shared
  worker-safe engine helpers
- `src/services/render/workerGpuVideoFrameLayerPresenter.ts`
- `src/services/render/workerGpuVideoFrameLayerShaderSource.ts`
- worker presentation command/types as needed
- focused worker-GPU renderer/fallback tests

**Checks:**

```bash
npm run test -- tests/unit/workerPresentingRenderHostPort.test.ts tests/unit/effectsRegistry.test.ts
npx tsc -b --pretty false
```

**Stop condition:** strict worker-gpu-only preview either renders the particle
effect deterministically or falls back with an explicit recoverable diagnostic,
without stale frames, black frames, or silent effect loss.

### Packet P4: Fade-Out UX

**Goal:** Make the effect practical as a fade-out/outro.

**Write set:**

- Effects tab integration if custom controls are needed
- timeline action/preset for "Particle Disintegrate Out"
- keyframe creation helper or fade-handle extension
- focused timeline edit/keyframe tests

**Checks:**

```bash
npm run test -- tests/unit/timelineEditOperations.test.ts
npx tsc -b --pretty false
```

**Stop condition:** a user can create a particle fade-out without manually
building every keyframe. Existing fade handles remain ordinary opacity/audio
fade handles unless a separate V2 schema is designed.

### Packet P5: Export Parity And Debugging

**Goal:** Prove preview/export parity and add diagnostics.

**Write set:**

- export effect path integration if not already shared
- AI debug bridge stats/log additions if useful
- focused export tests
- `docs/Features/Effects.md` after the feature is real

**Checks:**

```bash
npm run test -- tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Manual QA:**

- Dev Bridge 5-frame preview grid across the fade window
- full-resolution midpoint screenshot
- short export range containing the fade
- log scan for WebGPU validation errors and device-loss warnings

**Stop condition:** exported frames match preview for the same timeline frame,
within expected video decode tolerance.

---

## Fallback And Platform Rules

- If the particle renderer is unavailable, fall back to ordinary opacity fade
  using the effect progress envelope, or bypass the effect with a visible
  warning in logs.
- Do not allocate particle buffers or canvases based on full timeline size.
- Clamp render targets and source copy dimensions to the active output size.
- Hard-clamp particle counts by preview/export budget. A 4K source with
  `cellSize = 1` would imply millions of instances and must not be allowed.
- Keep Linux/Mesa constraints in mind: avoid oversized backing textures, avoid
  silent "success" assumptions, and add visible-frame checks during QA.
- Do not route WebGPU renderer policy through timeline-canvas platform helpers;
  this is not a timeline canvas path.
- Avoid worker `OffscreenCanvas` assumptions for this feature. The main path is
  WebGPU render passes.

---

## Non-Goals For V1

- Direct GLSL support.
- A WebGL sidecar renderer.
- True mutable physics simulation.
- Interaction with other shared-scene 3D objects through depth.
- Depth sorting or self-depth-tested transparent particles.
- `colorMode = freeze` and snapshot texture caching.
- Per-particle CPU data uploads every frame.
- Making this a two-clip transition before the one-sided render effect works.
- Datamosh, optical-flow, or frame-history behavior.

---

## Resolved V1 Decisions

- V1 forces `pixel-particle-disintegrate` to be terminal in the effect stack.
- Flat-source fade is internal to the effect.
- Fade-in uses the same effect with reversed progress/preset wiring.
- Particle output uses straight alpha for the normal compositor path.
- V1 uses pure alpha-blended instanced quads, not depth-sorted transparent
  particles.
- V1 uses live source sampling only; `freeze` is deferred.
- V1 uses a discriminated effect-definition contract:
  `pipelineKind: 'particle-render'` with helper predicates, not dummy
  fullscreen shader fields.
- Default particle budgets are 60,000 preview particles, 180,000 export
  particles, and a hard `maxInstances` clamp of 220,000.
- V1 particles may leave their source cell position while remaining clipped by
  the output render target.
- Main compositor, nested compositor, and thumbnail rendering call the same
  dedicated WebGPU particle renderer shape after source-copy/prior-effect
  preprocessing.
- Strict worker-gpu-only preview uses an explicit `opacity-envelope` fallback
  with diagnostics for `particle-render`; it does not project the particle
  effect into scalar video-frame uniforms.
- If the dedicated particle pass fails synchronously, compositor paths keep the
  source texture visible and log a recoverable warning instead of blacking the
  layer.

## Remaining Decisions

- None for V1. V2 remains open for a dedicated worker-GPU particle pass,
  fade-handle schema integration, frozen color snapshots, and non-terminal
  multi-pass stack planning.

---

## Acceptance Checklist

- [x] Effect definition is serializable and project-safe.
- [x] No runtime handles are stored in durable clip/effect data.
- [x] The non-fullscreen effect contract is explicit: no dummy shader,
      entryPoint, or packUniforms is required for `particle-render`.
- [x] Effect is not compiled through the normal fullscreen-only pipeline.
- [x] `EffectType`, registry validation, and pipeline skip logic agree on the
      new effect ID.
- [x] The particle effect is enforced as terminal-only in V1.
- [x] Effects after the terminal particle effect are rejected, warned, or
      disabled through a deterministic validation path, not silently skipped.
- [x] Particle count is derived from output/source size and capped by budget.
- [x] `cellSize = 1` at 4K is clamped or warned before render.
- [x] Particles carry UVs from their origin source cell while moving.
- [x] Scrubbing directly to a frame matches playback to that frame.
- [x] Export uses deterministic timeline/clip time, not wall-clock time.
- [x] Main preview and nested compositions use the same effect path.
- [x] Thumbnail rendering does not route the effect into the fullscreen-only
      pipeline.
- [x] Worker-gpu-only preview has an explicit V1 behavior: deterministic
      particle support or a visible recoverable fallback, with tests.
- [x] Existing effects without `pipelineKind` keep current behavior.
- [x] External video textures are copied to a sampleable texture before the
      particle pass when needed.
- [x] Particle output uses straight alpha and blends without dark fringes.
- [x] Shader validation/device-loss issues are surfaced through labelled
      WebGPU pipelines, runtime diagnostics, and GPU submit warnings; runtime
      QA found no particle shader validation errors.
- [x] Device loss or unsupported paths fall back without blacking unrelated
      layers: worker-gpu-only uses opacity-envelope fallback and compositor
      sync particle failures keep the source texture visible.
- [x] Preview screenshot QA covers progress 0, 0.5, and 1.
- [x] Export QA covers a short range containing the fade.
- [x] `docs/Features/Effects.md` is updated only after implementation ships.

## Verification Notes

2026-06-22 checks run:

- `npx tsc -b --pretty false`
- `npm run test -- tests/unit/aiToolPolicy.test.ts tests/unit/aiToolDefinitions.test.ts`
- `npm run test -- tests/unit/effectsRegistry.test.ts tests/unit/typeHelpers.test.ts tests/unit/layerEffectStack.test.ts tests/unit/workerGpuMediaSourceRegistry.test.ts tests/unit/particleDisintegrateOutroPreset.test.ts`
- `npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/workerPresentingRenderHostPort.test.ts tests/unit/timelineEditOperations.test.ts`
- `npm run test -- tests/unit/workerPresentingRenderHostPort.test.ts`
- `npm run test -- tests/unit/playbackHealthMonitor.test.ts`
- `npm run lint` passed with the existing warnings in
  `MixerMeter.tsx` and `useScopeAnalysis.ts`.
- `npm run build`
- `npm run test`

Bridge/runtime evidence:

- Initial V1 AI bridge `listEffects` from the running app returned
  `totalEffects: 34` and `pixel-particle-disintegrate` with 19 parameters
  before the deterministic gust controls were added.
- After the deterministic gust/release update, AI bridge `listEffects` returned
  `totalEffects: 34` and `pixel-particle-disintegrate` with 23 parameters:
  `gustStrength`, `gustScale`, `windSweep`, and `releaseContrast` were added
  to the existing particle controls.
- Main WebGPU render-host QA used the default `runPixelParticleDisintegrateQa`
  `captureMode: dom`, so preview fingerprints came from the visible presented
  preview surface rather than the internal straight-alpha GPU readback.
- The deterministic gust/release update was rechecked with
  `runPixelParticleDisintegrateQa` in DOM capture mode and a short export probe:
  `progress-0` hash `2e3d95cd`, meanLuma `108.1459`;
  `progress-0.5` hash `19d39a0e`, nonBlankRatio `0.9883`, meanLuma
  `65.9503`; `progress-1` hash `d36f05c5`, nonBlankRatio `0`, meanLuma `0`.
- The same update reproduced the midpoint exactly after direct re-seek:
  avgRgbDelta `0`, meanLumaDelta `0`, nonBlankRatioDelta `0`, colorRangeDelta
  `0`.
- The short export probe succeeded with blob size `31053`, 4 export samples,
  closest sample at `0.5s`, export hash `d2de3348`, and preview/export
  comparison passed: avgRgbDelta `11.4544`, meanLumaDelta `10.9825`,
  nonBlankRatioDelta `0.3125`, colorRangeDelta `92.731`.
- Initial V1 preview progress captures at 1920x1080 before the gust update:
  `progress-0` hash `90ccf131`, nonBlankRatio `1`, meanLuma `145.0972`;
  `progress-0.5` hash `f8a89e87`, nonBlankRatio `1`, meanLuma `42.5416`;
  `progress-1` hash `bfdaa045`, nonBlankRatio `0`, meanLuma `0`.
- Direct re-seek to the midpoint after seeking away reproduced the midpoint
  fingerprint exactly: avgRgbDelta `0`, meanLumaDelta `0`,
  nonBlankRatioDelta `0`.
- Playback parity reached the midpoint during playback, paused at
  `0.5430399999997026s`, and matched a direct seek to the same time exactly:
  playback hash `a023723f`, direct hash `a023723f`, avgRgbDelta `0`,
  meanLumaDelta `0`, nonBlankRatioDelta `0`.
- Short debug export over the fade succeeded with blob size `2677043`, 4 export
  preview samples, closest sample at `0.5s`, export hash `4271a6f0`, and
  preview/export comparison passed: avgRgbDelta `0.7867`, meanLumaDelta
  `0.3064`, nonBlankRatioDelta `0.3`.
- Runtime log/diagnostic scan after QA reported no `ERROR`, no particle shader
  validation errors, and no device-lost events. Remaining warnings were two
  WebGPU initialization timeout warnings and one `PlaybackHealth`
  `[HIGH_DROP_RATE]` warning from the synthetic playback parity probe.
- Strict worker-gpu-only preview intentionally does not run the V1 particle
  pass. Unit coverage verifies that it reports unsupported `particle-render`
  effects and applies the opacity-envelope fallback instead of silently losing
  the visual layer.
- After QA, the dev browser was restored to `worker-gpu-only` and reloaded with
  the required 5-second post-refresh wait. `getStats.workerFirstRenderer`
  reported `mode: worker-gpu-only`, `selectedStrategy: worker-webgpu-present`,
  and `strictWorkerOnly: true`.

---

## Suggested First Implementation Step

Start with Packet P0.1, not renderer code: lock the worker-gpu-only policy,
the discriminated effect-definition contract, and terminal-only validation.
Then implement registry/type changes and fullscreen-pipeline skip logic. After
that, extract the shared source-preprocess helper before building the renderer
against still images. Do not touch timeline fade handles or transition recipes
until a still image can render as deterministic particles and return a normal
straight-alpha texture to the compositor. After that, add live video source
handling, thumbnail/nested parity, worker-GPU policy implementation,
fade-out convenience UX, and finally export parity.
