# Effects

[Back to Index](./README.md)

MasterSelects has a modular GPU effect system built around registered effect modules, shared WGSL utilities, and a compositor pipeline that can run inline color ops without extra passes.

## At A Glance

- 37 blend modes are implemented in `src/shaders/composite.wgsl`.
- 34 GPU effects are registered in `src/effects/`, including fullscreen
  fragment effects and specialized render effects.
- Registered effect categories are `color`, `blur`, `distort`, `stylize`, `keying`, `generate`, `time`, and `transition`.
- `generate`, `time`, and `transition` currently have no registered clip-stack effects and are hidden from the add-effect UI. Timeline transitions are implemented separately in `src/transitions/` because they own two clips, source handles, hold-frame policy, and export participants.

## Registry And UI

The effect registry is built from category exports in `src/effects/index.ts`.
Fullscreen effect definitions provide:

- `id`, `name`, and `category`
- WGSL shader source
- fragment `entryPoint`
- `uniformSize`
- parameter definitions
- `packUniforms(...)`
- optional `passes` and `customControls`

Specialized render effects use an explicit `pipelineKind` discriminator. They
are registered for UI/project data, but are skipped by the fullscreen
`EffectsPipeline` and rendered by a dedicated compositor pass.

The production editor UI is `src/components/panels/properties/EffectsTab.tsx`.
`src/effects/EffectControls.tsx` is a generic fallback renderer.

## Current Effect Categories

- `color` (9): Brightness, Contrast, Saturation, Vibrance, Hue Shift, Temperature, Exposure, Levels, Invert
- `blur` (5): Box Blur, Gaussian Blur, Radial Blur, Zoom Blur, Motion Blur
- `distort` (7): Pixelate, Kaleidoscope, Mirror, RGB Split, Twirl, Wave, Bulge
- `stylize` (12): Vignette, Grain, Sharpen, Posterize, Glow, Edge Detect, Scanlines, Threshold, Acuarela, Rom1, Voxel Relief, Pixel Particle Disintegrate
- `keying` (1): Chroma Key

## Parameter Editing

`EffectsTab` renders effect parameters directly from the registry.

- Number parameters use a slider plus `DraggableNumber`.
- Boolean parameters use a checkbox.
- Select parameters use a dropdown.
- Parameters marked `quality: true` are grouped in a collapsible `Quality` section.
- Quality values can be dragged past the visible slider max in the editor.
- Parameters marked `animatable: false` are shown as static controls.

The registered quality parameters are currently:

- Gaussian Blur: `samples`
- Motion Blur: `samples`
- Radial Blur: `samples`
- Zoom Blur: `samples`
- Glow: `rings`, `samplesPerRing`
- Voxel Relief: `maxSteps`
- Pixel Particle Disintegrate: `maxPreviewParticles`, `maxExportParticles`,
  `maxInstances`, `softness`

Right-click on a numeric control resets that parameter to its default.
The `performanceMonitor` service can also reset quality parameters to defaults when rendering becomes too slow.

## Inline Effects

These effects are applied directly in the composite shader instead of running as separate effect passes:

- Brightness
- Contrast
- Saturation
- Invert

That keeps them zero-overhead relative to the full ping-pong effect chain.

## Particle Render Effects

`Pixel Particle Disintegrate` is a `particle-render` clip effect. It samples
the live source texture into deterministic instanced quads and resolves a
straight-alpha texture back into the normal layer compositor. At progress `0`
the source is already represented by particle cells at their origin positions;
progress moves, curls, and fades those cells rather than crossfading from a
normal full-frame video plane. Particle release is driven by a deterministic
gust field: coherent noise pockets, a wind-front delay, and the clip seed decide
which regions separate first, so the breakup starts in scattered islands and
then grows without relying on accumulated simulation state. Each particle
carries UVs from its original source cell, so moving particles keep their
assigned image patch instead of sampling from their new screen position. Preview
and export use explicit render/media time instead of wall-clock time.

V1 is terminal in the clip effect stack. Effects before it are pre-rendered
into the particle source texture; effects after it are reported as unsupported
instead of being silently reordered. The Effects tab includes a `Particle Out`
preset button that adds the effect and creates progress keyframes near the end
of the selected clip.

Strict worker-gpu-only video presentation does not run the dedicated particle
pass yet. That path detects the effect, reports an explicit recoverable
diagnostic, and applies the same opacity envelope as a visible fallback rather
than rendering stale or black frames.

## Timeline Transitions

The Transition Suite is timeline-native rather than a normal one-clip effect
stack. Transition definitions live in `src/transitions/` as serializable
primitive recipes (`opacity`, generated `solid`, `mask`, procedural/pattern
mask, blend, transform, generated `overlay`, UV `distortion`
primitives, and transition-scoped registered `effect` primitives) and are
interpreted by shared preview/export transition layer assembly. Analog/glitch
transitions that can be represented honestly as existing primitives, such as
seeded deterministic block masks, transform-based CRT collapse, or
transition-scoped registered effects for RGB split, pixelation, and static
scanlines, stay on that same preview/export path. Procedural noise/block masks
carry their normalized seed through preview, export, and the compositor shader
ABI so repeated renders are stable while non-default seeds can produce
alternate reveal orders. `Water Drop` and `Swirl` use the same seed path with
per-participant compositor UV remapping and are grouped under the Stylize
transition family. `Blur Dissolve`
and `Zoom Blur` use the same assembly path to append temporary registered GPU
effects to the incoming and outgoing participant layers while preserving each
clip's existing effect stack. `Directional Blur` and `Whip Pan` use the same
registered-effect path with `motion-blur`; the Motion Blur shader mirrors edge
samples for out-of-range UVs so fast horizontal transition blurs do not expose
transparent borders. `Projector Flicker` uses deterministic generated-solid
exposure pulses, `Film Roll` combines vertical transform overscan with
transition-scoped Motion Blur, and `Vignette Bloom` uses registered `glow` and
`vignette` effects on both transition participants. `Light Sweep` uses a
cached transparent generated overlay canvas with a screen-blended diagonal
highlight band, while `Light Leak` uses the same deterministic overlay
primitive for warm edge streaks and analog wash. Those overlay canvases are
generated per output size and cached by dimensions plus rounded overlay
parameters, so preview and export do not upscale a fixed thumbnail texture.
`Chroma Leak`, `Lens Flare`, and `Film Burn` use that same overlay/cache model
with deterministic generated color-split, flare-ghost, and burn-edge overlays.
They stay deterministic without bundled overlay video. `Additive Dissolve` and
`Non-Additive Dissolve`
use temporary transition blend windows on the incoming participant, so they
stay in the same layer assembly path instead of adding one-off shaders.

The current user-facing suite is grouped by family in the Transitions panel and
the transition-scoped Properties tab. It includes dissolve/dip, directional
wipe, iris/shape, push/slide, dedicated 2D rotate, whole-card 3D
flip/tumble/roll/spin, stylize, glitch, light, zoom, and pattern-mask
families. Family cards show their variant count in the Transitions panel; a
click expands the draggable leaf variants until the pointer leaves the panel,
while dragging a collapsed family card uses that family's default variant. The
current 3D families opt eligible participants into `scene-3d-panel` rendering
so video frames, video elements, images, and text canvases can render as native
shared-scene textured planes with camera projection and depth; unsupported
source states fall back to the compositor transform path. Cube, Door, Fold,
and Page Peel remain planned until origin, panel-slicing, or mesh-strip
renderer contracts exist. Kaleidoscope is available as the first exotic
pattern-lab transition by reusing transition-scoped registered effect
primitives rather than adding a one-off compositor path. `Puzzle Push`,
`Magnetic Tiles`, and `Shatter Glass` are the first visible multi-panel
transitions: the layer contract now supports normalized `sourceRect` sampling,
and transition assembly clones transition participants into deterministic
staggered panels, center-magnetic tiles, or rectangular outgoing tile-shatter.
True Voronoi glass shards and cast shadows remain planned, and Origami Fold
remains planned until per-panel 3D source UVs plus pivot/hinge contracts
exist. Planned transitions that
need true two-participant sampling, luma/matte comparison, mesh strips, richer
visible multi-panel rendering, or temporal frame history remain out of the
production palette until those renderer contracts exist.

The 2026-06-15 visible-browser Dev-Bridge QA pass for `Flash`,
`Chroma Leak`, `Lens Flare`, `Film Burn`, `Water Drop`, `Swirl`, and
`Kaleidoscope` used DOM-mode progress grids plus midpoint captures to avoid
the known GPU readback timeout path while still sampling the real preview
canvas. The same visible-browser path verified `Puzzle Push` and
`Magnetic Tiles` after the `sourceRect` compositor path landed, with
distributed panel slices or center-pulled tiles and no browser errors, missing
transition pipelines, runtime diagnostics errors, or shader warnings.

The default placement is virtual `center`: the edit point remains stable,
neither clip is moved, and missing source handles render as first/last-frame
hold fallback when the policy allows it. Compositor-driven transitions pass
typed transition metadata through existing compositor uniform padding slots, so
normal layers pay no extra bind-group cost when `transitionRender` is absent.

## Effect Pipeline

Non-inline effects are compiled from shared WGSL utilities plus the effect shader itself.
The pipeline creates one GPU render pipeline per registered effect and filters out disabled effects and `audio-` effects during application.

Effects with `uniformSize` 0 use no uniform buffer.
Most effects use a 16-byte-aligned uniform block; a few multi-parameter effects use larger blocks.

Effects can opt into temporal feedback through `usesFeedback`. Feedback effects
sample their own previous output frame on binding 3 and the pipeline maintains
a per-effect-instance feedback texture. Acuarela and the frozen Rom1 snapshot
use this path to build a watery smoke trail from animated fractal UV offsets.
The worker software renderer mirrors standalone Acuarela/Rom1 feedback with a
per-target/effect software feedback cache for preview and export readback;
stacked feedback with other visual effects still waits for the worker
multi-pass effect pipeline. Voxel Relief uses the same binding to smooth a
raymarched block-heightfield between video frames and remains a complex
raymarch/feedback effect.

Voxel Relief raymarches a perspective camera pointed at the source plane. The source image is sampled as a grid of rectangular prisms, with luminance driving each prism height and dark gaps between cells instead of a second flat video layer behind the relief.

Wall-clock animated effects can also set `requiresContinuousRender`. The engine keeps rendering live frames for active continuous effects while the playhead is parked, and it bypasses RAM Preview frame reuse so the animated output does not freeze.

## Keyframing

Numeric effect parameters can be keyframed through the timeline using the property path format:

```ts
effect.{effectId}.{paramName}
```

`EffectsTab` reads interpolated values from the timeline store and writes animated numbers back through `setPropertyValue`.

The clip context menu supports Copy Effects and Paste Effects. This copies the full effect stack plus matching `effect.*` keyframes and pastes them onto the selected clip set.

## Current Notes

- `color` and `point` parameter types exist in the effect type system, but the current registered effects do not use them.
- The empty `generate`, `time`, and `transition` categories are present in the type system so they can be populated later without changing the registry shape.

## Related Docs

- [Masks](./Masks.md)
- [Text Clips](./Text-Clips.md)
- [Keyframes](./Keyframes.md)

