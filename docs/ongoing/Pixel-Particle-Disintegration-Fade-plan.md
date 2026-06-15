> Status: Draft architecture plan for a future pixel-particle disintegration
> fade. This is planning context, not completed archive.

# Pixel Particle Disintegration Fade Plan

**Date:** 2026-06-15  
**Base:** current WebGPU/WGSL render stack  
**Scope:** one-sided fade-out/fade-in effect for visual clips, not a normal
two-clip timeline transition

---

## Purpose

Build a visual effect where a clip dissolves into many colored particles. Each
particle starts from a sampled source-image cell, keeps sampling the live video
color at that source location, and moves through a 3D-looking force field as
the effect progresses.

The first target is a fade-out/outro effect:

- the source image is intact at progress `0`
- particles begin to separate during the fade window
- the original flat image contribution disappears
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
- The compositor in `src/shaders/composite.wgsl` blends layers and carries
  compact `transitionRender` state for masks and UV distortions.
- Timeline transitions in `src/transitions/` are serializable recipes for two
  participants: outgoing, incoming, generated solids, overlays, masks,
  transforms, blend overrides, and registered fullscreen effects.
- Native 3D transition support renders whole clips as textured planes inside
  the shared scene. It does not split a source plane into particles.
- Gaussian splat particle compute exists, but it targets splat data, not normal
  video/image/text layers.

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
and complex effects:

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
and should be treated as terminal in the layer stack unless the pass planner is
implemented at the same time.

### Render Instanced Quads

Do not use one CPU-created particle object per pixel. The renderer should draw
instanced quads:

```text
draw(6 vertices per quad, columns * rows instances)
```

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
- timeline/media time

The fragment shader samples the input texture at the particle's base UV so
video colors remain live while the video plays.

### Stay Deterministic

The first implementation must not rely on accumulated simulation state.
Scrubbing directly to frame N must match playing to frame N, and export must
match preview.

Use analytic, deterministic motion:

```text
position = basePosition + displace(baseUV, progress, seed, mediaTime, params)
```

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

For fade-out, use two visual contributors during the fade window:

1. A flat source contribution that fades down.
2. A particle contribution that fades up, moves, and then fades out.

Recommended progress envelope:

```text
0.00 - 0.15: mostly original image, particles align with source
0.15 - 0.55: particles separate, flat image fades down
0.55 - 1.00: only particles remain, spreading and fading
```

Per-particle local progress:

```text
delay = hash(cell, seed) * stagger
local = smoothstep(delay, delay + tail, globalProgress)
```

Optional reveal order modes:

- random
- left-to-right
- center-out
- luma-bright-first
- luma-dark-first

The default should be random plus mild center weighting so the image breaks up
organically without looking like a simple grid wipe.

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
- `tail`: local fade/displacement transition width
- `seed`: deterministic random seed
- `colorMode`: `live` or `freeze`

Quality parameters:

- `maxPreviewParticles`
- `maxExportParticles`
- `softness` or `shape`: square, soft circle, shard

Defaults should target performance, not maximum density:

- Preview default: roughly 25k to 80k particles depending on resolution.
- Export default: allow higher density, but clamp by explicit particle budget.
- Very small `cellSize` values must be capped or warned.

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

### Layer Effect Processing

Current code splits layer effects in `src/engine/render/layerEffectStack.ts`.
Extend that split or replace it with a pass planner that preserves order.

Minimum V1 path:

- inline effects remain inline
- normal effects before particle are rendered into a source texture
- particle renderer consumes that texture
- the resulting particle texture becomes the layer texture for compositing

If the effect is not last in the stack, either:

- process later fullscreen effects after the particle pass, or
- warn/defer that stack ordering until the pass planner exists

The better target is the pass planner.

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
- render to an offscreen `rgba8unorm` texture
- reuse textures across frames when dimensions match
- clamp particle grid to preview/export budgets
- expose debug counters for particle count and render time

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
-> later effects if supported
-> compositor
```

### Main And Nested Composition Paths

The main compositor and nested composition compositor both apply layer effects.
The particle pass must be integrated into both paths or factored into a shared
helper used by both:

- `src/engine/render/Compositor.ts`
- `src/engine/render/nestedComp/compositeNestedLayers.ts`

Avoid adding a main-preview-only implementation that export or nested comps do
not use.

### Export

Export must use the same effect params, source time, and particle math as
preview. Do not use wall-clock time for particle motion.

Use timeline/clip local time or media time from the render frame context:

```text
motionTime = clipLocalTime or mediaTime
```

Wall-clock animated behavior can be a separate option later, but it should not
be the default because it breaks deterministic export.

### UX

V1 can ship as a normal clip effect in the Effects tab with `progress`
keyframable.

V1.5 should add an "outro fade effect" convenience action:

- add `pixel-particle-disintegrate`
- create progress keyframes near the clip end
- optionally create opacity keyframes or route flat-source fade internally

V2 can connect this to the existing fade handles so dragging the right fade
handle can choose ordinary opacity fade or particle disintegration fade.

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
  width: f32,
  height: f32,
  columns: u32,
  rows: u32,
  colorMode: u32,
  _pad0: u32,
}
```

Vertex concept:

```text
instanceIndex -> cell x/y
cell center -> base uv
hash(base uv + seed) -> delay/random direction
local progress -> displacement/depth/scale/alpha
project 3D point -> clip space
emit quad uv + source uv + alpha
```

Fragment concept:

```text
sample source at base uv
apply soft particle mask from quad local uv
return premultiplied or straight alpha consistently with scene/compositor path
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
- whether V1 allows the particle effect anywhere in the effect stack or only
  as terminal
- preview/export particle budget
- fallback behavior when the renderer cannot run

**Stop condition:** the implementation path is explicitly clip-effect based,
not a two-clip transition recipe.

### Packet P1: Effect Definition And Pass Classification

**Goal:** Add a serializable effect definition and classify it as a special
render effect.

**Write set:**

- `src/effects/types.ts`
- `src/effects/stylize/pixel-particle-disintegrate/`
- `src/effects/stylize/index.ts`
- `src/engine/render/layerEffectStack.ts`
- focused effect registry tests

**Checks:**

```bash
npm run test -- tests/unit/effectRegistry.test.ts
npx tsc -b --pretty false
```

**Stop condition:** the effect appears in the registry with default params but
is not incorrectly compiled as a fullscreen fragment effect.

### Packet P2: Particle Renderer Skeleton

**Goal:** Render a still image or canvas source into particles in an offscreen
texture.

**Write set:**

- `src/engine/particles/PixelParticleDisintegrateRenderer.ts`
- `src/engine/particles/shaders/PixelParticleDisintegrate.wgsl`
- render target/resource helper if needed
- focused renderer/unit tests where practical

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

**Goal:** Support live video color sampling and integrate source preprocessing.

**Write set:**

- `src/engine/render/Compositor.ts`
- `src/engine/render/nestedComp/compositeNestedLayers.ts`
- shared effect pass helper if extracted
- source/external texture copy handling
- focused tests for pass selection and no-op behavior

**Checks:**

```bash
npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts
npx tsc -b --pretty false
```

**Stop condition:** video clips keep updating particle colors frame by frame,
and nested compositions use the same path as the main preview.

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
building every keyframe.

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
  or bypass the effect with a visible warning in logs.
- Do not allocate particle buffers or canvases based on full timeline size.
- Clamp render targets and source copy dimensions to the active output size.
- Keep Linux/Mesa constraints in mind: avoid oversized backing textures, avoid
  silent "success" assumptions, and add visible-frame checks during QA.
- Avoid worker `OffscreenCanvas` assumptions for this feature. The main path is
  WebGPU render passes.

---

## Non-Goals For V1

- Direct GLSL support.
- A WebGL sidecar renderer.
- True mutable physics simulation.
- Interaction with other shared-scene 3D objects through depth.
- Per-particle CPU data uploads every frame.
- Making this a two-clip transition before the one-sided render effect works.
- Datamosh, optical-flow, or frame-history behavior.

---

## Open Decisions

- Should `pixel-particle-disintegrate` be allowed anywhere in the effect stack,
  or should V1 force it to be last?
- Should flat-source fade be internal to the effect or represented by normal
  opacity keyframes?
- Should fade-in be the same effect with `direction = in`, or a separate preset
  that reverses progress?
- What are the default preview/export particle budgets for 1080p and 4K?
- Should particle depth be self-depth-tested inside the particle pass, or kept
  as pure alpha blending for predictable dissolve visuals?
- Should the UI expose `colorMode = freeze` in V1, or keep only live sampling?

---

## Acceptance Checklist

- [ ] Effect definition is serializable and project-safe.
- [ ] No runtime handles are stored in durable clip/effect data.
- [ ] Effect is not compiled through the normal fullscreen-only pipeline.
- [ ] Particle count is derived from output/source size and capped by budget.
- [ ] Particles sample live video color at their source UV.
- [ ] Scrubbing directly to a frame matches playback to that frame.
- [ ] Export uses deterministic timeline/clip time, not wall-clock time.
- [ ] Main preview and nested compositions use the same effect path.
- [ ] Existing effects without `pipelineKind` keep current behavior.
- [ ] External video textures are copied to a sampleable texture before the
      particle pass when needed.
- [ ] Shader validation errors are logged clearly.
- [ ] Device loss or unsupported paths fall back without blacking unrelated
      layers.
- [ ] Preview screenshot QA covers progress 0, 0.5, and 1.
- [ ] Export QA covers a short range containing the fade.
- [ ] `docs/Features/Effects.md` is updated only after implementation ships.

---

## Suggested First Implementation Step

Start with the effect contract and pass classification, then build the renderer
against still images. Do not touch timeline fade handles or transition recipes
until a still image can render as deterministic particles and return a normal
texture to the compositor. After that, add live video source handling, then the
fade-out convenience UX, and finally export parity.
