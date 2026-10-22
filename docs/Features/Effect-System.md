# Effect system

For developers and agents. User docs: [Using effects](./Effects.md); every effect has a page in the [Effect catalog](./effects/index.md).

## Architecture

An effect is a registered definition (`src/effects/<category>/…`): id, name, parameters and a GPU
program, usually an editable image node graph. The registry (`src/effects/index.ts`) feeds the
**+ Add Effect** picker in the order of the picker groups (`EFFECT_GROUPS` in
`src/effects/effectCatalogGroups.ts`); the internal `category` field only organises the source.
A clip stores its effects as an ordered stack. At render time `LayerBuilder` collects the enabled
effects, and the `EffectsPipeline` runs them in stack order: one fullscreen pass per effect, a
pointwise effect alone on a clip inline in the composite shader, compute and particle effects in
their own runtimes. Preview and export share this path.

Color numeric channels, Hue Shift's Shift and Gaussian Blur's Radius share
[parameter sources](./Node-Workspace.md#procedural-parameter-sources): local
values/keyframes or connected Constant, Time, LFO, Math and Remap nodes. The
normal compact effect inspector retains its design and shows the effective value
and source. Other effects and structural settings are not implicitly enabled.

- 37 blend modes are implemented in `src/shaders/composite.wgsl`.
- The registry in `src/effects/` holds fullscreen
  fragment effects, compute effects, glyph effects, tracking effects and
  specialized render effects; `docs/Features/effects/catalog.json` lists and counts them.
- The populated clip-effect categories are `color`, `blur`, `distort`,
  `stylize`, `generate`, `keying`, `halftone`, `analog`, `pixel`, `glyph`,
  `geometry`, `tracking`, and `time`.
- `generate` holds the generators described in [Generate Effects](./Effects-Generate.md):
  Color Wheel, Perspective Grid, Stick Figure, Flocking, Weave and the
  [Memory Leak](./effects/memory-leak.md) generator, which reinterprets leftover bytes of
  the FFmpeg wasm heap as pixels through the byte-texture binding described below.
- `time` contains Time Stack and Slit Scan. `transition` has no registered clip-stack effects and is hidden from the add-effect UI. Timeline transitions are implemented separately in `src/transitions/` because they own two clips, source handles, hold-frame policy, and export participants.

## Key files

| File | Role |
|---|---|
| `src/effects/index.ts` | Registry, defaults, picker list |
| `src/effects/effectCatalogGroups.ts` | Picker groups and order, engines and styles |
| `src/services/nodeGraph/catalogText.ts` | One-sentence descriptions and search words |
| `src/effects/EffectsPipeline.ts` | Fullscreen passes, caches, feedback and history |
| `src/components/panels/properties/EffectsTab.tsx` | The effect cards in Properties → Effects |
| `src/services/effects/effectPresets.ts` | Effect presets: apply in one undo step, match, card notice |
| `scripts/effect-docs.mjs` | Effect catalog and effect pages for the docs |

## Contracts and invariants

- Effect ids are stable: saved projects, keyframes (`effect.<instance>.<param>`), tool calls and the
  docs URLs (`/docs/effects/<id>/`) use them. A new display name never changes the id.
- Retired parameters stay registered with `deprecated` so saved projects load; `legacyDefault` keeps
  the look of instances saved before a parameter existed.
- A value the renderer clamps or ignores is reported (`paramRangeNotes`, `paramWarnings`), never
  silently changed.
- Every control a card shows changes the picture. The looks built with `createCatalogEffect` and
  `createTrackingEffect` share base parameters (Scale, Angle, Ink, Paper, Overlay, Speed); a look whose
  recipe never reads one retires it with `retired` (`ignoredBaseParams(name, keys)` for the catalog
  looks): the card hides it, tools answer that the value is ignored, saved values still load and a
  style switch keeps them. `tests/unit/effectControlsRead.test.ts` fails when a shown control is not
  bound by the effect's default graph, or, for shader effects of the shared catalog and tracking
  uniforms, not read by its entry point (helper functions included).
- **Styles.** Looks of one engine (`effectCatalogGroups.ts`) are each other's Style menu entries
  when every key they share has the same parameter type (`effectStyles.ts`). A switch carries a
  value the user set, with its keyframes, between controls of the same key and role; a value still at
  the old look's default (no keyframes, no node source) takes the new look's default. A key whose
  control does something else in one look declares `styleRole` there (Crystal Glass Facets and
  Refraction, Glass Dispersion Dispersion, Ribbon Scan Ribbons and Displacement, Wave Lines Line
  Density, CRT Screen Mask Density, Film Prism Fringe, Riso and Riso Glow Registration, Contour Map
  Band Density, Drift Lines Drift): between different roles the value starts at the new default and
  its keyframes are removed (one undo step). Labels never decide this, but two looks that give one key
  different roles must label it differently (else the note reads "has no Scale: Scale"). For the
  session, a switch remembers which look a carried or kept value was set in, with that value
  (`styleOrigins`): later switches judge it against that look's role and default, so a value set by
  the user survives a round trip through a look whose default it equals, and a kept value nobody
  touched opens at the next look's default. Projects do not store this; after a reload a kept value
  carries only when every look with that key agrees on the role, and counts as untouched only when it
  is the default of all of them. The row notes a reset control only when the user had changed or
  keyed it, and names reset node graph edits (a stored graph that is not the look's default).
  `tests/unit/effectStyles.test.ts`.
- Every visible effect has its own docs page; `tests/unit/effectDocsCatalog.test.ts` fails otherwise
  (see [Effect pages](./Documentation-Site.md#effect-pages)).
- **Presets.** An effect declares its named starting points in its definition: `presets: [{ id, name,
  params }]` (`EffectPreset` in `src/effects/types.ts`; `createCatalogEffect` passes `presets` through).
  `params` holds only the values that differ from the defaults, in stored units, and only shown controls.
  Every effect card with presets shows a **Preset** row under **Style** (`EffectPresetRow`). Applying one
  (`applyEffectPreset` in `src/services/effects/effectPresets.ts`) sets each shown control to the
  preset's value or its default (text controls stay unless named) through the card's own path, in
  one undo step. A control with keyframes or a driving node keeps its animation, and the row names it
  ("Heat Haze: Drift kept its keyframes."). The row shows the preset the values match. AI tools do not
  list presets yet. Three to five presets per effect; the docs check names them
  ([Effect pages](./Documentation-Site.md#effect-pages)).
- **Animated looks keep time with the playhead.** A look rendered by its node graph reads `image.timeline-time`,
  so it holds still while paused. Its definition says so with `timelineAnimated` instead of
  `requiresContinuousRender` (catalog looks get the flag from `createCatalogEffect`): no wall-clock
  re-rendering while paused, the docs show it as a loop, and its look tile plays it on hover at a
  running time (`LookTile`, `lookThumbnailRuntime.renderLook`). A look still flagged
  `requiresContinuousRender` re-renders an unchanged frame while paused.

## Registry and catalog

### Registry And UI

The effect registry is built from category exports in `src/effects/index.ts`.
Render-only definitions such as `surface-overlay` and `terrain-overlay` live in
an internal runtime lookup: `getEffect(...)` can resolve them for compositing,
while the public `EFFECT_REGISTRY`, category lists, effect picker, AI catalog,
and property templates contain only effects users can add to clip stacks.
Fullscreen effect definitions provide:

- `id`, `name`, and `category`
- WGSL shader source
- fragment `entryPoint`
- `uniformSize`
- parameter definitions
- `packUniforms(...)`
- optional `passes`, `customControls`, and lazily loaded `extraControls`
  rendered below the generic parameter groups
- optional `byteTexture` provider: a CPU byte block uploaded as a
  `texture_2d<u32>` on binding 5 and re-uploaded only when its `version`
  string changes (`src/effects/_shared/byteTexture.ts`)

Memory Leak stores a canonical editable image graph rather than hiding byte
interpretation inside one shader. Its typed Memory Window source exposes
availability and word dimensions as metadata; a separate byte decoder performs
the 8-bit, 16-bit or IEEE-float mapping before ordinary alpha and mix nodes.
Advance and Shuffle derive frame indices from the explicit owning-composition
clock and frame rate, so nested compositions, preview and export address the
same window at the same composition frame. Frozen artifact blocks are stable
across sessions. Live FFmpeg heap contents remain intentionally dependent on
the current browser session and prior FFmpeg work.

Each byte-window version receives an immutable `r32uint` texture. Cache keys
include render scope and effect identity, while entry-count and byte budgets
bound retained textures. Eviction drops ownership without destroying textures
that may still be referenced by an unsubmitted command encoder; runtime GPU
objects never enter saved project data.

Parameters flagged `hidden: true` stay in project data and undo but are
omitted from the generic controls and property/keyframe lists; effects use
them for internal state such as a frozen artifact reference.

Parameter definitions may also declare a named `group`. The generic controls
render those groups as focused sections and keep quality parameters in their
own collapsible section.

Specialized render and compute effects use an explicit `pipelineKind`
discriminator. They
are registered for UI/project data, but are skipped by the fullscreen
fragment path. Compute definitions are dispatched by `ComputeEffectRuntime`;
specialized render definitions are rendered by their dedicated compositor
pass.
Geometry compute effects use composition timeline time for animation, including
Voronoi seed motion, so paused preview and export do not depend on wall-clock
time. Callers without a timeline use deterministic time zero.

The production editor UI is `src/components/panels/properties/EffectsTab.tsx`.
`src/effects/EffectControls.tsx` is a generic fallback renderer.
The add-effect control opens a searchable, categorized catalog instead of a
plain dropdown. Visible tiles are rendered from the current user frame and use
a deterministic color/initials placeholder until their GPU result is ready.
For motion-adjustment clips, the production tab limits the picker to
Brightness, Contrast, Saturation, Invert, and Gaussian Blur.

The applied-effects view has a **Video / Audio** switch at the top. Visual clips
default to Video; audio-only clips open Audio directly. The Audio view reuses the
existing Volume/EQ and registry effect-stack controls, including Audio Math, and
also exposes additional legacy clip audio effects without migrating their data.
For linked video/audio it targets the linked audio owner, like the node graph;
clips without an audio source show an empty-state explanation. This switch only
filters the inspector and never enables, disables or reroutes audio.

An initialized clip color grade appears as **Color** in the video effect list,
including in its badge count. It uses the normal effect card, collapse and bypass
controls, and compact numeric inspector sections for each correction node, with
sliders, reset and keyframe actions. The special wheels/curves layout stays in
the dedicated Color tab. An Open Nodes action opens the same grade. Disabled
grades remain listed for re-enabling.
This is the existing built-in color stage before the image-effect stack, not a
second grade or a new draggable GPU effect. Its storage and render order remain
unchanged. The current Color panel's wheels edit the selected Corrector/Wheels
node; choosing the wheels tool does not create a separate Wheels node.
Corrector and Wheels node inspectors share the complete runtime parameter set,
including Lift/Gamma/Gain/Offset R/G/B/Y. They display animated values at the
playhead. Parameter and keyframe discovery includes these channels even in older
grades that have not stored their default values yet.

### Current Effect Categories

- `color` (9): Brightness, Contrast, Saturation, Vibrance, Hue Shift, Temperature, Exposure, Levels, Invert
- `blur` (5): Box Blur, Gaussian Blur, Radial Blur, Zoom Blur, Motion Blur
- `distort` (11): Pixelate, Kaleidoscope, Mirror, RGB Split, Twirl, Wave, Bulge & Pinch, Fisheye Lens, Lens Correction, Guided Perspective, AI Edge Fill. The **Lens & Distort** menu shows these (Pixelate sits under Pixel & Mosaic) plus Crystal, Glass Dispersion, Film Prism and Holo; see [Lens & Distort](./Effects-Distort.md) and, for Pixelate, [Pixel & Mosaic](./Effects-Pixel.md)
- `stylize` (13): Vignette, Grain, Sharpen, Posterize, Glow, Sheen, Edge Detect, Scanlines, Threshold, Acuarela, Rom1, Voxel Relief, Pixel Particle Disintegrate; for Acuarela, Rom1, Sheen, Voxel Relief and Pixel Particle Disintegrate see their pages: [Acuarela](./effects/acuarela.md), [Rom1](./effects/rom1.md), [Sheen](./effects/sheen.md), [Voxel Relief](./effects/voxel-relief.md) and [Pixel Particle Disintegrate](./effects/pixel-particle-disintegrate.md)
- `keying` (1): Chroma Key
- `generate` (6, see [Generate Effects](./Effects-Generate.md)): **Color Wheel** (an HSV wheel filling the layer or drawn as an anti-aliased disc), **Perspective Grid** (a scrolling vanishing-point floor grid with filtered lines whose width is set in 1080p pixels at the front edge), **Stick Figure** (a posable stick figure whose joints are keyframeable and node-drivable; best on a Blank Clip, see [Node Workspace](./Node-Workspace.md#stick-figures-and-rig-nodes)), **Flocking** (a node-graph swarm drawn in 3D above any clip; see [Flock Clips](./Flock-Clips.md#flocking-is-an-effect)), **Weave** (curve-node yarn and fabric in 3D; see [Weave](./Weave.md)) and Memory Leak
- `halftone` (13): dithering, halftone, Riso, print, poster, stitch, and animated mosaic treatments
- `analog` (10): CRT Screen, Glitch, Film Prism, Analog Signal Lab, Crystal Glass, Glass Dispersion, Holo, Ribbon Scan, Wave Lines and compute Pixel Sort (user guide: [Analog & Glitch](./Effects-Analog.md))
- `pixel` (2): Blockify and Block Mosaic; see [Pixel & Mosaic](./Effects-Pixel.md)
- `glyph` (18): ASCII, word/number/symbol matrices, code, collage, brand, and stitch treatments
- `geometry` (11): compute Voronoi, Quadtree, and Contour plus engraving, textile, outline, and brick treatments
- `tracking` (8): subject, motion/HUD/CCTV, kinetic trace, rain, stardust, and hand-particle treatments

### Live Catalog Previews And Looks Foundation

A Look is a serializable named stack of effect IDs, enabled flags, and primitive
parameters. The standalone **Looks** panel is currently disabled in both
development and production: it is absent from the dock contract and panel
pickers, and persisted layouts are normalized without it. The internal Look
types and HMR-safe thumbnail runtime remain in use by the live effect catalog;
GPU textures, `ImageBitmap`s, and other runtime handles stay outside durable
state.

Effect and Look tiles use a single captured frame at the current playhead as a
shared source. The runtime renders 256x144 offscreen targets, caches by effect
or stack parameters plus source-frame ID, schedules at most one queued preview
job per animation frame, and only renders tiles within the viewport. This works
for both main-thread and worker-presenting render hosts. Animated entries run at
up to 12 fps for two seconds only while hovered or focused, with at most one
animated tile active globally.

Clicking or touching an effect thumbnail adds that effect to the selected clip;
the thumbnail is a keyboard-focusable button as well. Curated and custom Look
stack application is unavailable while the standalone panel is disabled.

#### Preview source changes

Look thumbnails reacquire cached bitmaps immediately before drawing because a
source change can release the previous cache. Closed frames are skipped and
replacement rendering is retried up to three times. Static jobs and hover frames
completed after a source change no longer overwrite the current thumbnail.

Catalog tile borders follow hover or keyboard-visible focus rather than any
focused descendant. Pointer activation does not leave a focus border or native
outline behind; thumbnail keyboard navigation retains its inset accent outline.
Touch activation suppresses the native tap highlight.

### Parameter Editing

`EffectsTab` renders effect parameters directly from the registry.

- Number parameters use a slider plus `DraggableNumber`.
- Boolean parameters use a checkbox.
- Select parameters use a dropdown.
- Parameters marked `quality: true` are grouped in a collapsible `Quality` section.
- Quality values can be dragged past the visible slider max in the editor.
- Parameters marked `animatable: false` are shown as static controls.
- Numeric parameters supplied by catalog, compute, and glyph effect factories
  default to animatable unless the effect explicitly opts out. This keeps the
  stopwatch/keyframe behavior consistent for registry-provided controls.

The registered quality parameters are (the blurs and the Glow bloom choose their own
taps; the blurs' old `samples` and Glow's `rings`/`samplesPerRing` are retired and only
read by graphs saved with them, see Editable blur kernels and Glow):

- Voxel Relief: `maxSteps`
- Pixel Particle Disintegrate: `maxPreviewParticles`, `maxExportParticles`,
  `maxInstances`

Right-click on a numeric control resets that parameter to its default.
The `performanceMonitor` service can also reset quality parameters to defaults when rendering becomes too slow.

### Keyframing

Numeric effect parameters can be keyframed through the timeline using the property path format:

```ts
effect.{effectId}.{paramName}
```

`EffectsTab` reads interpolated values from the timeline store and writes animated numbers back through `setPropertyValue`.

The clip context menu supports Copy Effects and Paste Effects. This copies the full effect stack plus matching `effect.*` keyframes and pastes them onto the selected clip set.

## Pipelines and runtimes

### Effect Pipeline

Non-inline fullscreen effects are compiled from shared WGSL utilities plus the
effect shader itself. The pipeline creates one GPU render pipeline per
non-inline fullscreen effect and filters out disabled effects and `audio-`
effects during application.

Effects with `uniformSize` 0 use no uniform buffer.
Most effects use a 16-byte-aligned uniform block; a few multi-parameter effects use larger blocks.

Wall-clock animated effects can also set `requiresContinuousRender`. The engine keeps rendering live frames for active continuous effects while the playhead is parked, and it bypasses RAM Preview frame reuse so the animated output does not freeze.

#### When the GPU cannot build an effect

Building a pipeline can fail on a device in three ways: an invalid shader or
descriptor (validation), a driver compiler that gives up (internal, for example
`CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN` for Voxel Relief on an
Android/Vulkan device) or memory exhaustion. Fullscreen effects
(`EffectPipelineCache`), compute effects (`ComputeEffectRuntime`) and image graph
passes (`ImageGraphPassRuntime`) learn the verdict for all three through
`createCheckedPipeline` (`src/engine/core/gpuPipelineGuard.ts`). Previously only validation was
scoped: a driver failure stayed in the cache as a valid-looking pipeline, and
every frame that set it invalidated the whole frame's command buffer, so all
layers stopped rendering, not just that effect.

A failed pipeline is dropped and not rebuilt for the same shader; the effect is
skipped (pass-through) while every other effect keeps rendering. The failure is
logged with its kind and recorded in `src/effects/effectGpuFailures.ts`; the
effect card shows "This device's graphics driver could not build this effect,
so it is skipped." (full driver message as tooltip). A new GPU device clears the
record. The device-wide guard (see [GPU Engine](GPU-Engine.md#pipelines-the-driver-cannot-build))
covers every other GPU subsystem the same way.

Shader compile cost matters on mobile drivers. Voxel Relief used to inline its
576-step raymarch four times (one per anti-aliasing sample), sampled the source
colour on every traversal step and copied the 512-byte field-graph array into
every evaluator call; its driver compile took about 290 ms on a desktop Vulkan
driver and failed on an Android device. It now loops over the four samples,
samples the colour once at the hit and evaluates the field graph directly from
the uniform (`src/shaders/scalarFieldShader.ts`, shared with the 3D voxel
instance and path-tracer emission shaders): about 75 ms, with identical pixels.
The shared lattice noise (`src/engine/procedural/latticeNoiseWgsl.ts`) had the
same problem: `curlNoise3` wrote out six `curlPotential` calls of three
`valueNoise3` each, and the flock simulation called it twice per particle, so
the flock compute shader carried 36 inlined noise evaluations. Loops over axes
and octaves (and a single `spawnParticle` call site) cut its driver compile from
about 500 ms to about 270 ms; results match within float rounding. Keep heavy
shader functions out of unrolled call sites, and never pass large arrays by
value.

Effects can opt into temporal feedback through `usesFeedback`. Feedback effects
sample their own previous output frame on binding 3 and the pipeline maintains
separate committed-history and current-output textures per composition/layer/effect.
Repeated renders at the same timeline time re-evaluate against committed history;
only advancing the frame promotes the latest current output. Rom1 and Acuarela effects
saved with its original smoke recipe use this path to build a watery smoke trail from
animated fractal UV offsets.
Acuarela, Rom1 and glyph animation use the supplied composition timeline time
(zero when omitted), not the wall clock. Explicit seeks, backwards jumps,
owner revisions and export starts clear frame history. The saved, non-animatable
`historyLoop` parameter chooses `reset` (the legacy/missing-value default) or
`continuous` across explicit playback-loop boundaries. Render surfaces receive
the same event revision so repeated renders consume a discontinuity only once.
The worker software renderer mirrors standalone smoke-recipe Acuarela/Rom1 feedback with a
composition/target/effect software feedback cache with the same two-history
transition policy for preview and export readback;
Voxel Relief uses the same binding to smooth a
raymarched block-heightfield between video frames and remains a complex
raymarch/feedback effect.

Voxel Relief raymarches a perspective camera pointed at the source plane. The source image is sampled as a grid of rectangular prisms, with luminance driving each prism height and dark gaps between cells instead of a second flat video layer behind the relief. New instances use the iPad-tuned relief defaults: 107.4 columns, 1.2 height, 3.0 height contrast, and `Limit to Video` enabled, with Distance 0.8 so the relief fills the layer at the default tilt (the Effect Lab's `--metrics --require-filled-border` check finds no transparent pixel in the outer 8 px of the three lab images at 960 and 1920 px; 0.85 left a wedge). Effects saved before Distance existed keep Distance 1 (set on load). Block sides keep at least 55 % of the column colour and tall columns brighten their own colour (2D raymarch and native 3D); effects saved before keep the darker, greying shading (`shading: 'legacy'`, set on load).
With `Limit to Video` enabled, the raymarcher discards voxel cells outside the source rectangle and uses a finite source-sized floor, so orbit views show only the actual video footprint instead of repeating its edge pixels around the subject. Existing project instances retain their stored parameters.

New Glows start from the bloom defaults (`GLOW_DEFAULTS`): Amount 2.5, Threshold 0.95, Softness 0.5, Radius 80 and white Color. Saved ring Glows keep their stored parameters (the earlier iPad-tuned preset was Amount 5, Threshold 0.7935, Radius 1, Softness 0.496, 6.85 rings and 17.95 samples per ring).

### Inline Effects

When a clip has exactly one enabled effect and it is a pointwise image graph
(Brightness, Contrast, Saturation, Vibrance, Exposure, Levels, Hue Shift,
Temperature, Invert, Threshold or Posterize), its compiled program runs inside the
composite shader instead of a separate effect pass. Stacks of several effects run
as ordered passes so their order is kept.

### Split Compare

The main preview has an optional GPU split-compare pass. It binds the untreated
and effected textures, composites them at an adjustable divider, and exposes a
draggable/keyboard-accessible overlay. The setting is runtime UI state and does
not alter project media or the exported result.


No editor control mounts `SplitCompareOverlay` (`src/components/preview/SplitCompareOverlay.tsx`) at the moment, so users compare with an effect's Bypass instead; the pass stays reachable through `splitCompareStore`.

### Glyph, Cell, And Compute Effects

Glyph effects share one exact cell-grid model, curated ASCII ramps, and a
generated glyph atlas cached beside the effect runtime (`_shared/glyphAtlas.ts`: least
recently used atlases go first, 16 per device and 128 MB; when frames use more atlases at
once, the device raises its count up to 64 and logs it instead of rebuilding them every
frame, and says so once if the byte budget still forces rebuilds). The same grid contract
drives rendering and artifact export, so the exported rows match the visible
cell selection instead of approximating it independently.
All 18 glyph variants store that shared pipeline as editable generic graphs.
Their atlas nodes keep ramp, custom text,
font, and weight bound to the existing effect parameters; animated weight
therefore follows the same preview, export, and saved-project timeline. Number
Field adds quantized tone ink, Grid Glyph adds cell-border coverage, Pixel Code
uses deterministic hashed cell selection, and Word Mosaic adds its connector band.
Glyph Matrix advances character selection with timeline time and cell position;
Data Hatching combines its animated character offset with diagonal hatch coverage.
Brand Generator adds radial character selection and a frame mask; Stitch Poster
combines atlas coverage with diagonal thread strokes and its paper background.
Dither Text uses animated threshold noise; Symbol Matrix combines cell-hashed
character selection with a timeline-driven brightness pulse.
Pixel Dither uses a radial neon resolve; Retro Matrix scrolls its cell grid and lights a
fixed text in its Phosphor colour with 1080p scanlines. Both retain the sampled source alpha and
composition timeline clock.
Capsule Cloud adds signed-distance pill coverage; UI Collage adds cell borders
and cursor marks. Their character offsets use deterministic spatial hashes.
Matrix Rain combines hashed column offsets with its animated green head highlight.
ASCII Ghost combines the current result with explicit previous-frame history using
component-wise decay, including alpha. Inscribe retains automatic GPU derivatives
of the sampled cell tone; CPU evaluation requires an explicit fine/coarse policy.

**Glyph engine pass (2026-10-22).** All 19 looks come from `createGlyphEffect`
(`src/effects/glyph/glyphEffectFactory.ts`) and `createDefaultGlyphGraph`
(`src/services/operators/asciiEffectGraph.ts`); cell geometry and clock constants live in
`src/effects/glyph/glyphGrid.ts`, and the graph is the reference: `shader.wgsl` is not compiled for these looks (graph-owned effects skip their shader) and is out of date, so do not copy its maths. A look passes `id`, `name`,
`entryPoint`, and optionally `animated`, `feedback`, `defaultRamp`, `defaultCellSize`,
`defaultBackground`, `defaultRoll`, `ignoresColors`, `presets` and `params` (controls of its own, placed at
the end of their card section and flagged `lookOwn`, so the Style menu still matches the look with the
others: `effectStyles.ts` ignores them and starts them at their defaults when switching to the look).

- **Background** (`background`, 0–1, Style group): the ground behind each character is mixed from
  the look's dark ground (source × 0.08, Dark × 0.15, or its own paper/black) towards the
  character colour of the cell. Looks with their own palette (Matrix Rain, Retro Matrix, Pixel Code,
  Number Field, Dither Glow) colour the whole cell with their ink at Background strength (Matrix Rain
  × the cell tone). New instances start at 0.2 (0.3 before the characters filled their cells; Stitch Poster at 0, it has its paper), so cards and
  stills keep about 40 % of the picture's brightness instead of about 10 %. `legacyDefault: 0` keeps
  instances saved before it on the dark ground; it is `graphOnly`, so a node setup saved before it
  hides the row; outside 0–1 it renders clamped (`background-clamped`, reported by `paramRangeNotes`).
- **Cell Size** counts pixels of a 1080p frame (shorter side, `GLYPH_REFERENCE_HEIGHT`), at least
  2 output pixels: preview qualities, thumbnails and 4K exports show the same grid. A Cell Size below 2
  renders as 2 (`cellSize-clamped`); cells under 2 output pixels on small frames are reported by
  `glyphCellWarnings`. This is a fix: on a 1080p composition nothing changes, on other sizes the
  export now matches the preview. Projects saved with their node setup keep the earlier grid.
- **Saved node setups** store the glyph blocks packed (Cell Grid, Tone to Glyph, Atlas Alpha), and
  loading expands them from the current definitions. Their port ids are fixed: a 3.2.7 setup wires
  Cell Grid's `cell-size-value` (a `legacyInputs` port that feeds `safe-cell` directly, the earlier
  max(Cell Size, 2) output pixels) and Atlas Alpha's `tiny-vec2-value` / `almost-vec2-value` (the
  earlier .001–.999 read; such a legacy edge replaces the body's inset edge into the same clamp,
  `expandOperatorCompositions`). `tests/unit/glyphSavedGraphs.test.ts` loads six looks saved by
  3.2.7 (`tests/fixtures/glyph-graphs-saved-3.2.7.json`), renders them like the 3.2.7 code did and
  pins the block port ids.
- **Clock.** The moving looks read timeline time (`timelineAnimated`, no continuous rendering while
  paused). Speed is `integratedAs: 'speedTravel'`: with keyframes the graph reads the travelled
  distance (`index-speed-travel`), otherwise timeline time × Speed (the sentinel `GLYPH_NO_TRAVEL`,
  −1e20, selects that), so a Speed ramp no longer makes the characters race.
- **Roll** (`roll`, 0–1, Motion group, every moving look): each cell runs through a window of
  `1 + ceil(Roll × (ramp − 1))` characters around its own (`index-window`), kept inside the ramp
  (`index-window-start`), starting from its own character; the look's offset (Glyph Matrix: the
  diagonal sweep) moves it through that window. Roll 1 is exactly the earlier full-ramp wrap
  (`legacyDefault: 1`, and the default of every look but Glyph Matrix, Retro Matrix and Symbol Matrix,
  which start at 0.2, 0.3 and 0.4), 0 holds
  each cell on its tone's character, and any Roll above 0 moves at least two characters. With
  Black Level above 0, a cell at or below it (tone 0) gets a window of 1 (`index-roll-lit`,
  `index-roll-levelled`, `index-roll-dark`, `index-roll-cell`), so the dark stage holds still even at
  Roll 1; at Black Level 0 every cell rolls as before. The
  quotient carries + ½ so GPU division never drops a cycle. `graphOnly`; outside 0–1 it renders
  clamped (`roll-clamped`). The moving looks show these nodes in two folders, **Glyph Offset** and
  **Roll Window**; `effectGraphProjection.ts` names the runtime-only travel card after its rate
  ("Speed Travel"). Glyph Matrix's presets live in `glyphPresets.ts` (`GLYPH_MATRIX_PRESETS`).
- **Symbol Matrix swaps.** Each cell ticks at its own moment, `floor(4 × clock + Random (Cell))`
  (`index-cell-random`, `index-tick`), and draws its offset from Random (Integer Hash) of (its random,
  its tick) (`index-jitter`). It used to hash cell + `floor(4 × clock)`: every cell swapped on the same
  frame, and since the sine hash only reads a dot product, the random field slid one cell diagonally
  per tick. A fix for new instances and setups saved without a graph; stored setups keep the old swap.
  Its brightness pulse (`symbol-*` nodes, (1 − d/2) + d/2 × sin(2 × clock + cell phase)) has its own
  **Pulse** folder. Its depth d is **Twinkle** (`twinkle`, 0–1, Motion group, own control,
  `src/effects/glyph/symbolMatrix.ts`): default 0.35, `legacyDefault` 0.7, the earlier hard-wired
  0.65 + 0.35 × sin, which dimmed half the signs to grey squares once Background lifted the ground;
  `graphOnly`, clamped by `twinkle-clamped`. Presets: `SYMBOL_MATRIX_PRESETS`.
- **Retro Matrix scroll** (`src/effects/glyph/retroMatrix.ts`). Its cell grid moves up by
  `clock × 3` rows (`scroll-rows`, the **Scroll** folder), added to the grid position (`scrolled-uv`) and
  taken off again for the cell centre (`sample-unscrolled`), so characters stay whole and each reads the
  picture where it is now. The rows wrap every `RETRO_SCROLL_PERIOD` (12 288) rows (`scroll-wrapped`) and
  its text is a fixed Random (Cell) per scrolled cell whose line number repeats with the same period
  (`index-text-line`, `index-text-random`), so the text never jumps and the per-pixel grid stays small in
  f32 (unwrapped, a 3 h timeline at Speed 5 sheared the characters); it is folded into the Roll window
  (default 0.3). It glows at Phosphor (`phosphor`, own colour control, amber
  `#ff8514`) × (0.15 + 1.6 × tone); **Scanlines** (`scanlines`, 0–1, default 0.5, `legacyDefault` 0.36)
  dims sin²(π × rows / pitch) between lines 3 px of a 1080p frame apart (`retro-scan-*`, the
  **Scanlines** folder; the phase is fract(screen lines + fract(scroll lines)), so sin only sees 0–π and
  a whole Cell Size keeps the lines continuous across the wrap; test `glyphEngine`), fading to an even 1 − Scanlines / 2 where the pitch drops below 3 output pixels.
  This replaces `floor(3 × clock − uv.y × ramp)` with per-pixel `sin(π × pixel row)` scanlines: band
  borders cut characters in half, nothing scrolled, and the 1-pixel lines differed between preview and
  export sizes. A fix for new instances and setups saved without a graph; stored setups keep the old
  look. Its graph leaves out the shared colour nodes it never reads; presets: `RETRO_MATRIX_PRESETS`.
- **Colour controls.** Matrix Rain, Retro Matrix and Pixel Code retire Color Source, Dark and Light;
  Number Field and Dither Glow retire Color Source (`deprecated`: hidden, tools say why, saved values
  load and the Style menu keeps them).
- **Transparency.** Input and output are straight alpha. Each cell takes the alpha of its centre
  sample, so a cut-out keeps its outline in whole cells and no character is cut in half.
- **Amount** fades from the untouched picture (`original-sample` at the pixel's own UV) to the look,
  alpha included; it used to fade towards the cell colour, so Amount 0 showed a mosaic. The fade mixes
  premultiplied colour (`original-premultiplied`, `look-premultiplied`, `mixed-premultiplied`) and divides
  by the mixed alpha (`mixed`, floor 1e-6), so the hidden colour of a transparent pixel never leaks into
  a fade around a cut-out figure. A fix for new instances; saved node setups keep the earlier fade.
- **Black Level** (`blackLevel`, 0–0.9, default 0, `graphOnly`): the tone becomes
  clamp((luminance − level) / (1 − level), 0, 1) before the ramp (`luminance` → `black-*` → `tone`, in the
  Cell Sampling & Tone folder), so a grey stage drops to the first character and the rest spreads over the
  ramp; Duotone colours and every look's own tone use the levelled tone. Above 0.9 it renders clamped
  (`blackLevel-clamped`, reported). 0 is the tone as before.
- **Atlas.** The glyph graph marks its atlas `fill` (`constants: { fill: true }` on the `atlas` node):
  the rasterizer picks one font size for the whole ramp, so its tallest character spans 88 % of the tile
  (`GLYPH_ATLAS_FILL`) and the characters keep their relative sizes; before, the font was 0.76 × the
  tile and most characters covered only about 40 % of the cell height. The tile is read half a texel
  inside (`atlas-texel-inset`, 0.5 / 64), so linear filtering never mixes in the neighbouring tile and
  Blocks and Bars join without seams at fractional cell sizes (1920×1200, 2.39:1, a keyed Cell Size,
  Retro Matrix's scroll). Saved node setups keep the smaller type and the .001–.999 read (the Atlas
  Alpha block takes its old Tiny / Almost One inputs as `legacyInputs`), so saved Blocks or Bars can still
  show thin seams there. The atlas cache keeps at most `GLYPH_ATLAS_CACHE_LIMIT` (24) atlases per device,
  least recently used first out (typing a Custom Ramp builds one per keystroke); dropped atlases are left
  to the browser, not destroyed, since a bind group may still hold them.
- **Ramps** (`src/effects/_shared/asciiRamps.ts`): the menu shows names (Standard … Symbols) and has
  **Bars** (` ▁▂▃▄▅▆▇`, the tallest seven eighths high so rows stay apart). A Custom Ramp of one character draws it (it used to fall back silently);
  one longer than `ASCII_RAMP_MAX_CHARACTERS` (256) keeps 256 spread from its first to its last
  character, and `asciiRampWarnings` reports it and an unknown Ramp (a 20 000-character ramp used to
  exceed the GPU texture size and leave the layer empty).
- **Block Elements** (U+2580–U+259F) are drawn by the atlas rasterizer as exact shapes that fill the
  tile (`src/effects/_shared/blockElementGlyphs.ts`; ░ ▒ ▓ as a 4 × 4 ordered dither), so Blocks and
  Bars join without gaps in any font. This changes saved projects that use them (a fix: the font drew
  them as narrow striped bars).
- **Weight** is keyframeable in steps: atlases are drawn at the nearest of the nine CSS weights
  (`atlasWeight`), so no value builds and caches an atlas of its own.
- **Roll 0.** In the looks whose clock only steps the characters through the Roll window
  (`motionOnlyByRoll`: Glyph Matrix, Data Hatching, Dither Glow, Tag Pills, Creative UI Collage, ASCII
  Ghost), Roll 0 holds them still; the card and tools then say that Speed has no effect.
- **Card.** The looks use the shared inspector rows (`RESOLVE_ROW_EFFECTS`); Custom Ramp is a text row
  with a reset. Rows that rest are dimmed with a note (`activeWhen`): Dark and Light while Color Source is
  Source (not in Number Field and Dither Glow, which always use them), Ramp while a Custom Ramp is typed. Folder ports are named by `GLYPH_PORTS` in `effectPresentationPlans.ts` (Cell Center,
  Tone, Glyph Index, Glyph Coverage, Ink, Ground, …). ASCII's presets live in
  `src/effects/glyph/glyphPresets.ts`.

Tests: `tests/unit/glyphEngine.test.ts` (every shown control reaches the output, Background,
1080p cells, Speed travel, timeline clock, WGSL literals, Amount 0 gives the original, Ramp menu and
warnings, Weight, Roll window and its legacy full-ramp sweep, Symbol Matrix's staggered swaps, the
premultiplied Amount fade, the half-texel atlas read, Black Level and its dark hold, Symbol Matrix's Twinkle,
the Roll 0 warning, the dimmed rows), `tests/unit/glyphSavedGraphs.test.ts` (3.2.7 node setups),
`tests/unit/cellGrid.test.ts` (ramps), `tests/unit/glyphAtlasRaster.test.ts` (Block
Elements, the fill atlas, the atlas cache limit), `tests/unit/imageAsciiGraph.test.ts`, `tests/unit/imageGlyphVariantGraphs.test.ts`,
`tests/unit/imageInscribeGraph.test.ts` and `tests/unit/imageContourTypeGraph.test.ts` (each look's
recipe at Background 0), `tests/unit/EffectsTabValueControls.test.tsx` (the text row, the dimmed rows).

Acuarela is a four-pass watercolour graph (`acuarelaWatercolorGraph.ts`): a
premultiplied source cache, two edge-aware 7 x 7 washes with per-pixel jittered taps
(each pixel turns and shifts its tap grid at random, so thin lines become fine grain
instead of repeated copies; taps 0.6 sigma apart, weight
`exp(-0.18 |k|^2 - |dc|^2 / (2 s_r^2))` with `dc` the premultiplied colour difference to
the centre tap). The first wash reads at a position that wobbles by
`min(Bleed (0.25 + 0.5 wet), 12)` pixels (so neighbouring pixels never read far-apart rows;
above Bleed 16 only the second wash widens, and the effect card says so), sigma
`Wash (1 + 0.3 wet)`, into `wash-first-cache`; the second smooths the first with sigma
`0.6 Wash + 0.25 Bleed wet` into `wash-cache` (`wet` 0-1 in wet patches; colour tolerance
`s_r` grows from 0.1 dry to 0.3 and 0.5 wet). The last pass groups the wash into tones
(Simplify) and changes each colour like more or less pigment,
`C' = C - (C - C^2) e`. The excess `e` eases instead of clamping (`1 - exp(-x)` for more
pigment, `exp(x) - 1` for less, `x` = edge pooling + granulation + blooms), so the density
`1 + e` stays inside 0-2, where the formula keeps every channel between `C^2` and
`2C - C^2`: pooled edges become a deeper tint of their own colour, never black ink lines.
Edge pooling compares the wash with a Gaussian mean of its 5 x 5 neighbourhood (1.5 px
apart, sigma 2 px) through a smoothstep, a 2-4 px gradient on the darker side of each
border. Granulation follows a paper height field, weighted toward mid-light washes (less on
dense dark paint and near-white). Shadow Pigment then lifts black toward an indigo pigment,
also on pooled edges, and Mix blends
premultiplied. Its noise fields use the shared
**Fractal Noise** node (`noise.fractal2d.vec2`, PCG-hashed gradient noise, 1-8 octaves),
which stays free of the streaks Random (Hash) shows at large positions. Sizes are pixels
of a 1080p frame; the recipe has no frame history and Mix 0 is skipped. Acuarela effects
saved with the original watery-smoke recipe keep it: a stored graph renders as saved,
and a graph-less effect with only the smoke parameters resolves to
`createLegacyAcuarelaGraph()` (generic noise, vector math and blend operators with an
explicit `image.frame-history` source, like Rom1). The smoke parameters are retired for
the watercolour and shown only where a graph reads them; History Loop and Reset show only
for graphs with frame history. The worker software renderer runs the smoke recipe on the
CPU; the watercolour (minutes per frame there) is unsupported in software, so preview and
export fall back to the main-thread GPU renderer.

`ComputeEffectRuntime` adds storage-texture compute passes to the normal
ping-pong effect stack. Pixel Sort uses bounded segments of at most 16 pixels, Voronoi uses a
jump-flood sequence, Quadtree Zoom evaluates hierarchical block variance, and
Contour uses marching-squares cases with interpolated edge crossings. Compute
and fragment effects can be mixed in one clip stack and use the same preview,
worker, and export paths.

Voronoi now exposes an executable `compute-image` graph: seed generation and
Jump Flood retain their specialized backend, while nearest-seed reads, border
comparisons, color mixing, and original alpha use shared image operators.
Connections determine which stages execute; a direct Frame-to-Output connection
requires no compute stages. Seed coordinates and validity stay in typed raw
`rgba16float` fields, not color images. The final image program writes through
the shared compute-storage output adapter, preserving legacy RGBA8 conversion
instead of introducing a fragment-output rounding difference. Parameters retain
their existing property IDs, ranges, defaults, and timeline time.

Pixel Sort uses the same compute-image boundary with no intermediate field
stages. Its graph separates a stable, bounded 16-record segment sort from
Rec.709 luminance eligibility, amount mixing, and source-alpha preservation.
The sort keeps legacy duplicate-last padding, nearest-even segment-size rounding,
and strict greater-than comparisons for ties. Its inputs can be rewired or
bypassed; the default graph still emits a single compute pass. Effect controls
retain their authoritative defaults, including segment size 16, amount 0.5
(0.8 before 2026-10; saved effects keep their value), and threshold 0.45. Pixel
Sort is marked experimental in the effect list, the inspector and tool results.
Because every run is at most 16 pixels long and the threshold
only decides which pixels take the sorted colour, the result is a fine streaky
texture, not the long sorted streaks of classic pixel sorting; that needs a
row-wide interval sort as its own compute stage. Segment sizes outside 4 to 16,
Amount outside 0 to 1 and a Threshold of 1 or more are reported in the inspector
and tool results.

Quadtree Zoom exposes a bounded adaptive partition with jointly computed cell
origin and size. Its six-level search preserves the legacy five-sample variance
and timeline-driven threshold pulse. Center sampling, cell borders, RGB styling,
amount mixing, and original alpha remain separate shared nodes. The default
graph uses one compute output pass with no intermediate textures; wiring Frame
directly to Output bypasses it. Minimum cell size defaults to 8 (2–32), variance
threshold to 0.025 (0.001–0.2), amount to 0.8, and speed to 0.5.

Contour separates integer cell coordinates, corner luminance samples, threshold
crossings, Marching Squares topology, segment distance, and color mixing into
editable nodes. The joint topology operator preserves all sixteen cases,
including ambiguous cells and threshold equality. Original alpha is retained;
the default uses one compute pass, while direct Frame-to-Output wiring bypasses
the effect. Integer cell arithmetic preserves exact cell boundaries. Seven GPU
comparisons verify strict legacy RGBA8 parity without a rounding tolerance.

Contour Map, Crosshatch, and Kilim use granular single-pass image graphs built
from shared sampling, luminance, scalar/vector math, and palette operations.
Scale, amount, and colors stay bound to the existing catalog parameters; their
defaults and ranges are unchanged. Source alpha bypasses styling. Direct source
wiring removes the pattern, and saved graph edits retain their canonical owner.

Vector Engraving exposes rotation, cell-center sampling, and engraving math.
Embroidery exposes its thread waveform; Outline exposes four neighbor samples
and gradient length; Bricks exposes staggered cells, center sampling, bevel
lighting, and seeded pulsing. Embroidery, Outline, and Bricks use explicit
timeline time in preview and export. Bricks preserves its legacy sampled
brick-center alpha; the other three preserve current-source alpha. All retain
one image pass and their existing catalog parameter IDs, defaults, and ranges.
Contour Type uses the shared glyph atlas, with separate current-UV index offset,
cell-center luminance, contour bands, and screen-space derivative coverage.

#### Editable keying and feedback graphs

Chroma Key is an editable screen-difference keyer in three passes: a 64 px Screen
Grid of screen-like colours, a 1 px Screen Color average (the automatic screen
colour) and the key pass with Clip Black/White, optional Shrink/Grow and Edge
Softness passes (pixels at 1080p, none while both are 0), screen subtraction with
the local grid colour, and Neutral or Gentle spill suppression. A picked screen colour
folds both measurement passes away. See
[Keying and Time Effects](./Effects-Keying-Time.md). Untouched saved Rec.601 graphs
upgrade; edited ones keep reading the retired Tolerance and Edge Softness: their
inspector shows those controls, and tools report the new parameters as unused there.
The worker CPU keyer (software preview and export readback) keys only a layer whose
sole effect is one Chroma Key, also when the layer stores the untouched graph (every
loaded project does); with other effects, a second key or a colour grade it declines,
since its fixed order and source-frame screen measurement would differ from the GPU.
An automatic key on a clip without that screen colour keys nothing; the inspector and
`addEffect`/`updateEffect` say so, checked on the clip's thumbnails.

ROM1 exposes four noise octaves, displacement, edge masking, source lift,
feedback decay, and final RGBA mixing as shared nodes. Its source lift passes Gain through a
knee: the lift equals Gain up to 0.25, then eases as `0.25 + 0.25 (1 - exp(-(Gain - 0.25) / 0.25))`
toward 0.5 (`rom1GainLift`), so saved looks with typical Gain stay the same and large values
wash the frame out instead of turning it white; saved graphs get the knee nodes on load. Detail changes frequency,
not octave count; Speed scales displacement, not timeline time. Its history uses
the shared seek/reset/loop contract, and feedback can raise output alpha as in
the legacy shader. Direct source wiring prunes history resources and processing.

#### Editable color effect graphs

Brightness, Contrast, Saturation, Vibrance, Exposure, Levels, Hue Shift,
Temperature and Invert are editable node graphs; the user page is
[Color Effects](./Effects-Color.md). A single color effect on a clip runs inside
the composite pass; in a stack each one runs as its own pass, in stack order. Alpha
bypasses the RGB math. New instances (since the 2026-10 rebuild,
`colorEffectGraphs.ts`, tuning in `COLOR_RECIPE`) compute:

- **Brightness**: per channel `y = x·m / (x·m + 1 − x)` with `m = 2^(2.5 · Amount)`;
  black and white stay fixed, so there is no grey veil.
- **Contrast**: slope `c` = Amount at mid-grey 0.5. From 1 up an S-curve
  `y = x^c / (x^c + (1 − x)^c)`: highlights and shadows roll off instead of clipping;
  per channel, so strong values also raise saturation. Below 1 a straight line toward
  mid-grey, `y = 0.5 + (x − 0.5) · c` (a Mix toward grey; the curve then gets slope 1).
  Both halves sit in the shared Contrast Curve block, whose Flatten share is clamped to
  0..1 (driven below 0 in an Image graph it gives plain grey). Before this fix the S-curve ran
  below 1 too, an inverse S with an infinite slope at black and white that turned one
  8-bit shadow step into about 40 at Amount 0.3; saved graphs of that recipe, plain or packed
  (when a project is loaded and saved, or by a Nodes-tab edit), are recognised by a frozen
  fingerprint and upgraded on load with their card positions and the user's own folders
  (`contrastFlattenUpgrade.ts`; not when a folder is bypassed or the graph is incomplete),
  identical from Amount 1 up, and saved instances of the block get the fade under their
  unchanged ports.
- **Saturation**: mix of Rec.709 luma and RGB by Amount, stopped where the first
  channel reaches 0 or 1, so hue and luma stay (gamut-safe).
- **Vibrance**: the same gamut-safe mix, with Amount weighted by `1 − S` (HSV
  saturation) and up to 70 % less on skin hues (a Gaussian around 0.07 turns, about 25°),
  faded in over HSV value 0.15–0.35 and out over saturation 0.6–0.8 (dark warm
  floors and saturated orange light are not skin).
- **Exposure**: `2^EV` in linear light (exact sRGB transfer both ways), then the
  display-referred Offset and Gamma of the original effect.
- **Temperature / Tint**: channel gains in linear light. Per Temperature unit red
  rises and blue falls by 0.6 stops each (1.2 stops apart); per Tint unit green falls
  0.5 stops and red and blue rise 0.25. The gains are scaled so grey keeps its Rec.709
  luminance; black stays black.
- **Hue Shift**: rotation in OkLCh by Shift turns (the inspector shows degrees);
  lightness and chroma stay, colours that leave sRGB are clamped.
- **Levels**: unchanged remap, but equal input points act as a hard per-channel threshold and
  swapped points as a negative (range `max(|white − black|, 1e-4)` with its sign).
- **Invert**: `1 − rgb`, unchanged.

Inputs are limited to 0–1 (the effect chain carries 8-bit display-referred colour).
Values outside a parameter's render range (`renderMin`/`renderMax`: Brightness ±4,
Contrast and Saturation 0–10, Vibrance −1 to 4, Exposure ±20 EV, Gamma 0.2–10 for
Exposure and 0.1–10 for Levels, Temperature and Tint ±4) are clamped by the graph's
`<param>-clamped` node; the inspector and the add/update effect tools say what
renders instead (a gamma floor adds "very dark" or "almost black").

Effect rows share one display rule (`effectParamDisplay` in
`src/effects/paramDisplay.ts`), in the Resolve rows and in node-source rows alike:
`displayUnit: 'degrees'` shows radians as whole degrees (Twirl, Kaleidoscope,
Mirror, RGB Split), `displayScale` with `unit` shows a scaled unit (Hue Shift's turns
as degrees) and `unit` alone a suffix (" EV") with as many decimals as the stored
value needs; other rows show the decimals their step implies. Stored values,
keyframes, tools and MIDI keep the parameter's own unit. Render-range notes in the
inspector use the same display (`paramRangeNotes(..., { display: true })`: "Horizon
150% is above the rendered range (0% to 98%)"); tool results keep stored units.

A rate parameter (per second) that may be keyframed declares `integratedAs`: while it
has keyframes, the shared keyframe step (`evaluateEffectKeyframes` in
`stores/timeline/keyframes/effectKeyframeEvaluation.ts`, used by
`getInterpolatedEffects` and `evaluateCompositionClipEffects`, so also by nested
compositions, transition-mapped clips and export) writes the distance travelled into
that runtime-only param: the rate at the clip start × the clip's start on the render
clock, plus the area under the keyed curve (`integrateKeyframedRate` in
`src/utils/speedIntegration.ts`, shared with clip speed). The packer uses it instead of
rate × time, so a keyed ramp moves smoothly and the first key does not shift the
pattern (Perspective Grid Speed, Color Wheel Spin; see
[Generate Effects](./Effect-System.md#generate-notes)). Stored travel values are
dropped, `addEffect`/`updateEffect` do not store them, and a node source that drives
such a rate drops the travel (logged), so the source runs at rate × time.
Geometry graphs (Weave) reach the same rule in their compiler: a Multiply of Clip Time
or Time with a Value node bound to a keyframed integrating parameter compiles to the
distance travelled on that clock (`geometryRateTravel.ts`, supplied by the strand layer
source and the node previews), so a keyed Weave Speed or Pulse Rate eases instead of
jumping. The clip clock runs in source time (speed, reversal, trim), so its travel is
scaled by that clock's rate. A geometry graph reads a value that a node source or the
Constant mode drives, not its keyframes (`keyframesBindingsLeave` leaves those keys out
for the parameter reader, the travel and the Weave node previews), so a driven rate runs
at its driven value × time, logged once like the image path.

A parameter added after instances were saved can declare `legacyDefault`: what a saved
instance without it renders. Renderers, keyframe base values and the inspector
(`getRenderedDefaultParams`, also in the Node Workspace editor) all use it, so a saved
instance shows the value it draws and the other choice is one pick away.

Saved work keeps its look. Projects keep the graph they were saved with (the
previous recipes stay in `legacyColorEffectGraphs.ts`). A color effect stored
without any graph (projects from before 2026-09-21) is given the original graph when
the project file is converted (`migrateLoadedEffectOperatorGraph` in
`loadTimelineHydration.ts`); `addClipEffect` gives new color effects the recipe graph,
so a graphless effect in the running editor is never mistaken for an old one.
`editMotionAdjustment` (`create`/`configure`, which replace the whole effect list from
parameters) keeps the graph of every effect whose id and type it keeps and gives new
color effects the recipe (`adjustmentEffectGraphs.ts`). Custom Looks without
`schemaVersion` (saved before the rebuild) apply their color effects with the original
graphs; Look schema 2 stores each color effect's graph per stack entry. A stored Look
graph is validated like a project-file graph when the Look is applied or drawn as a
thumbnail (`checkedLookEntryOperatorGraph`); a graph that no longer validates is logged,
named in the Looks panel and replaced by the recipe. `getClipDetails` lists each effect
graph only as a summary (`nodes`, `edges`, for color effects `state`: `recipe`,
`original` or `edited`); `getOperatorGraph` returns the graph. Saved original graphs keep their original Node Workspace folders (Color
Processing, Clamp & Alpha); the recipe stages are only applied to the unedited recipe.

The worker software render modes evaluate the same graphs instead of their former
shortcuts; programs that read only their own pixel (all color recipes) are evaluated
once per distinct RGBA8 colour of the frame (about 0.2–0.4 s for a 1080p photo,
`workerSoftwareImageGraphs.ts`). The prepared CPU evaluator (`imageOperatorEvaluation.ts`)
resolves each instruction's operation and the plan's context requirements once, not per
pixel, kernel tap or sequence step, which made sampled multi-pass graphs such as the Chroma
Key edge passes about 2.5× faster on this path. A layer that mixes them with the retired `blur`
effect is skipped as `unsupported-effects`. Adjustment layers in the worker GPU
modes still use the motion-adjustment 4×5 colour matrix for Brightness, Contrast and
Saturation (linear offset, linear contrast, Rec.709 matrix saturation), which matches
only the original graphs: each other such effect is reported once per layer in the
`WorkerGpuAdjustment` log and, while a worker render host mode is selected, in the
adjustment inspector (`adjustment-color-recipe-unsupported`,
`workerGpuAdjustmentColorParity.ts`).
GPU-against-CPU parity of the recipes (within one 8-bit step, including the OkLCh and
sRGB helpers) is checked by `tests/browser/image-graph-probe.html?suite=color-recipes`;
`colorRecipeWgsl.test.ts` validates every recipe module with naga where it is installed.

Threshold and Posterize also expose executable pointwise groups (contract in
`src/effects/stylize/pointwiseModel.ts`). Threshold uses Rec.709 luminance and a
strict greater-than comparison (equality is black). Posterize uses
`floor(rgb * levels) / (levels - 1)` with levels bounded below by two, limited to
0–1 (the earlier graph let white overflow to `L / (L - 1)` until the render target
clamped it). Since 2026-10-21 both have a **Softness** (default 0): Threshold ramps
smoothly from Level − Softness/2 to Level + Softness/2 (a brightness width, 0–0.5);
Posterize rounds each step edge into a smooth ramp of that share of a step (0–1).
Posterize also has **Brightness Only**: the staircase runs on the brightest channel
and the colour is scaled with it, so hue and saturation stay and light neutral areas
cannot split into false colours where their channels cross a step apart. New
Posterize effects start with it on (`stylizeNewInstanceParams`); the parameter
default stays off, which is what saved effects and Custom Look entries without the
value mean, so they keep stepping each channel. Softness 0 without Brightness Only
renders exactly the earlier math, so untouched saved graphs simply read as the
current recipe. Both preserve source alpha and the original ranges, defaults and
keyframe IDs; Levels below 2 and negative Softness are reported, not silently clamped.

Vignette (contract `src/effects/stylize/vignette/vignetteModel.ts`) measures the
distance from the centre in pixels, normalized so every corner is at 1 on any
resolution and aspect. **Roundness** blends from the frame's shape (0, an ellipse
touching all four edges at the same distance) to a true circle (1, the default).
The darkening starts at Size and is complete at Size + Softness (smoothstep, never
narrower than 1.5 px), `gain = 1 − Amount × falloff`; a dither of at most half an
8-bit step, only where the gain changes the picture, keeps dark gradients free of
banding. One fullscreen pass; alpha is kept. Vignettes saved before 2026-10-21 keep
their earlier graph, where Roundness (0.5–2) stretched a UV ellipse vertically. UV-dependent node previews show
the spatial field instead of inventing a single numeric value. Adding a UV
dependency to another image graph also routes it through the contextual
fullscreen path; ordinary pixel-only graphs keep their inline optimization.
Animated graph parameters update GPU uniform values while reusing the compiled
pipeline; changing graph wiring or a structural node constant recompiles it.

Scanlines and Film Grain also expose executable UV/time/math graphs. They use
composition timeline time for reproducible preview, seeking and export. Both
preserve source alpha and use one fullscreen pass.

- **Scanlines** (`scanlinesModel.ts`): `0.5 + 0.5 sin((v + time × Speed × 0.1) ×
  Density × 100)` over the frame height, so Density 5 gives about 80 lines on any
  resolution. Lines closer than 4 px fade into their even average (fully below
  2 px) instead of flickering as moiré; Opacity is limited to 0–1. Both limits are
  reported in the inspector and tool results.
- **Film Grain** (`grainModel.ts`, since 2026-10-21): smooth value noise built from
  **Random (Cell)** hashes on a grid of Size pixels of a 1080p frame, so the grain
  looks the same at every render size. Three layers of it, their grids turned by 0°,
  30° and 60°, add up to grain without a grid direction (a single layer shows squares
  at coarse sizes). A new pattern appears at `round(time × 60 × Speed)` (Speed 1
  changes it on every frame up to 60 fps, 0 freezes it; Speed above 1 changes nothing
  more and is reported); the whole-number pattern index and Seed pick the pattern
  offset through Random (Cell), exact up to index 2²⁴, so long timelines never cycle
  through a few patterns. The noise is zero-mean (no pumping),
  strongest in the midtones (30 % of it in black and white, like film) and has a
  standard deviation of about `0.35 × Amount` there. **Color** (0–1) mixes each
  channel from shared grain towards its own. Grains saved earlier keep their
  seeded sine-dot noise (Speed there scrolled the pattern, 0–5).

#### Editable mirror, split and pixel graphs

User guide with pictures: [Lens & Distort](./Effects-Distort.md) (Kaleidoscope, Mirror, RGB Split) and [Pixel & Mosaic](./Effects-Pixel.md).
All six effects read a premultiplied `rgba16float` copy of the frame and
unpremultiply the result, so transparent pixels never darken an edge or a cell.
Kaleidoscope, Mirror and RGB Split follow **Frame Edges** (Mirror, Clamp,
Transparent; Transparent fades over one source pixel by lowering alpha only) for
reads beyond the frame. Angles are on-screen angles, stored in radians and shown
in degrees. RGB Split's alpha is the largest of its three channel reads.
Pixelate, Blockify and Block Mosaic share one centred cell grid (sizes in pixels
of a 1080p frame, rounded to whole rendered pixels) and an exact two-pass cell
average of the premultiplied frame (three passes in all); cells wider than 128
rendered pixels average evenly spread taps. Blockify's dither is a 4 × 4 Bayer
threshold per block that fades out over the darkest level step, so black stays
flat. Block Mosaic draws its large tiles from timeline time, so
seeking and export reproduce the same pattern; bound colour nodes read the
canonical effect colour (including eight-digit hex alpha) without recompiling.
Untouched saved graphs and graph-less saved effects move to the current recipes
with values that keep their look where it can be kept. Neutral settings (RGB
Split Amount 0, Mirror with both axes off, Pixelate cells below two rendered
pixels, Blockify and Block Mosaic at Amount 0) skip the built-in recipe.

**Worker CPU fallback.** Without WebGPU (software preview, worker-first export
readback) the untouched Kaleidoscope, Mirror, RGB Split and Pixelate recipes run
as one hand-written whole-frame pass with the same mappings, frame edges and
premultiplied reads, within 1/255 of the graphs in tests; Pixelate averages every
cell exactly there. The pass runs before the layer's other CPU effects. Pointwise
effects in front of it (Invert, Threshold, Posterize, Vignette, Scanlines) join it
as whole-frame steps in stack order, with 8-bit values between effects like the
GPU, so a vignette or a posterize before Pixelate or Kaleidoscope stays exact and
fast. Only graphless effects (transition effects) take these steps; Threshold,
Posterize, Vignette and Scanlines follow their current recipes there (Softness,
Brightness Only, the pixel-true vignette distance without its half-step dither,
the fade of too dense lines; [Stylize Effects](./Effects-Stylize.md)). The rebuilt
color effects (Brightness, Contrast, Saturation, Exposure, Levels, Hue Shift,
Temperature, Vibrance) and Film Grain have no hand-written twin: a layer with one
runs as ordered graph plans, the color programs once per distinct colour
([Color Effects](./Effects-Color.md)). Chroma Key measures its screen from
the whole layer source, so its CPU keyer runs only as a layer's sole effect
([Keying and Time Effects](./Effects-Keying-Time.md)); a stored key graph among
other effects runs as graph plans. A
distort, blur, glow, sharpen or feedback effect in front of the pass, and edited
graphs, run the layer as ordered graph plans too, which are much slower. The pass keeps one float copy of the frame (two for a
chain of resampling effects) and frees it after two idle seconds.

#### Editable blur kernels

User guide with pictures: [Blur Effects](./Effects-Blur.md). The shared sampling
contract lives in `src/effects/blur/blurSampling.ts`; the operator graphs
(`blurEffectGraphs.ts`, `directionalBlurEffectGraphs.ts`), the WGSL references
(`separableBlur.wgsl`, `directionalBlur.wgsl`) and the unit tests follow it.

**Radius unit.** Box and Gaussian Radius are pixels on a 1080p frame (the shorter
frame side counts as 1080 px) and scale with the rendered size. A half-quality
preview, the export and a 4K composition therefore show the same blur relative to
the picture. Motion, Radial and Zoom were already relative to the frame.

**Premultiplied source.** Every blur first premultiplies the frame into an
`rgba16float` cache (**Premultiplied Source (cached)**). All later reads filter
between texels; filtering premultiplied texels is exact, while premultiplying a
filtered straight-alpha read darkened colour wherever an alpha edge fell between
two texels (a dark fringe on text, logos and cutouts).

**Box and Gaussian (separable).** A horizontal pass over the premultiplied source
is cached as `rgba16float`, then a vertical pass reads it and restores straight
alpha (three GPU passes with the source cache). Each pass is a sequence of
`2 * pairs + 1` taps: the centre texel plus
pairs of texels merged into one linear-filtered tap at their weighted centre
(shared blocks **Pair Tap Offsets** and **Merge Pair Weights**), which is exact for
any kernel. Gaussian uses sigma = radius / 2 truncated at 3 sigma; at the old
default (Radius 10, Samples 5) this matches the previous softness at 1080p, but
without the old 11 × 11 tap grid that showed squares from radius ~10 upwards. The
old grid grew with radius² / (3 × Samples), so saved projects change look: small
radii are stronger (Radius 3 about 2.5×, Radius 5 1.5×), large ones about 20 %
softer, projects that are not 1080p scale with their size (a 4K project blurs 2×
as many pixels as before, 720p 0.67×), and other Samples values no longer change
the strength. Box gives full weight inside the radius plus a
fractional edge tap, so integer radii match the old box exactly and animated radii
no longer jump. Past 127 pairs per side (Gaussian Radius 50 above a ~3600 px short
side) the pairs spread out instead of truncating the kernel, and `addEffect`,
`updateEffect` and the inspector say so for the composition size. Cost at 1080p:
`0.75 × radius` (Gaussian) or `radius / 2` (Box) pairs per side, so about
`1.5 × radius + 1` or `radius + 2` reads per pass, instead of up to
`(2 × samples + 1)²`.

**Motion, Zoom and Radial (two stages).** Every tap is T(u) of a one-parameter
transform group in pixels: a translation (Motion), a log-scale about the centre
(Zoom, Radial Zoom) or a rotation (Radial Spin). Stage A averages a short box of
length h of the premultiplied source with taps at most one pixel apart into an
`rgba16float` cache; stage B
sums coarse taps h apart over the whole range and samples that cache. Because
T(a)·T(b) = T(a + b), the boxes tile the range exactly, so streaks stay continuous
at any length with about `2 × sqrt(2 × streak length in px)` taps per pixel; the old
fixed sample counts showed ghost copies and stair steps on long streaks. A partial
last box (Radial Zoom ranges differ per pixel) is weighted by its covered share.
Since 2026-10-22 the counts never step: the coarse count `sqrt(2 × longest px)` is not
rounded (h follows the amount, the partial last box grows in), and stage A works in
one-pixel cells from the centre out whose outermost pair counts with the share of its
cell the box covers. Every tap position and weight is a continuous function of the
amount, so an animated amount ramps smoothly from 0 (the 3.2.7 recipe rounded both
counts up: a streak under about a pixel rendered the source unchanged, Motion jumped by
up to 35 levels at count steps, Radial Zoom near Amount 1 drew a faint ring near the
centre). Untouched 3.2.7 graphs load with the new recipe as a bug fix; still pictures
differ by under 0.4 levels on average (up to about 30 on a few thin high-contrast lines,
measured on the Effect Lab images at the presets).
Motion Blur's direction is now an exact on-screen angle (diagonal angles were
skewed on non-square frames); its reach to each side keeps the legacy length,
Length × |(cos × width, sin × height)|: a share of the width for horizontal and of
the height for vertical streaks, so saved projects and the Film Roll transition
(Length 0.1, vertical) keep their streaks on every aspect ratio. Below 0, Motion
and Radial Blur leave the picture unchanged, as the old shaders did (they returned
their input below Length 0.001 / Amount 0.01): the graph clamps the amount at 0
(**Maximum**, port "Amount ≥ 0"), the pipeline skips the effect, and tool results
and the inspector say so. Keyframe overshoot or a tool call can produce such values.
Zoom Blur streaks inward below 0, as it did on the GPU. Scales never go below 0.05,
and the tool and inspector report that limit and streaks beyond the 64 × 256 read
budget. Motion mirrors samples at the frame edge; Zoom and
Radial keep the sampler's edge clamp (a mirrored zoom or spin path folds onto other
rays, where the cached boxes no longer tile). Radial Blur gained **Type: Spin**
(Amount 1 = a 20° arc); missing values keep the old Zoom look. A blur at zero
strength (the built-in recipe only, also when an older project stores it in the
`operatorGraph` parameter) is skipped by the effects pipeline, so its
input passes through exactly without running the passes. Its effect preview in the
Node Workspace shows that input; while a preview of one of its inner nodes is open,
the effect renders normally so those previews have pictures.

**Alpha.** All five blurs average premultiplied colour and return straight alpha,
so transparent surroundings no longer darken edges (the old straight-alpha average
drew a dark rim around logos, titles and scaled clips). Ground-truth tests
(`tests/unit/blurGroundTruth.test.ts`) read discrete textures with bilinear
filtering and float16 caches and compare hard alpha edges with dense premultiplied
kernels; the GPU check (`image-graph-probe.html?suite=blur`) renders the same edges.

**Pass caches.** The `rgba16float` caches between passes come from one pool in
`ImageGraphPassRuntime`, keyed by size: a cache is leased for one encode (or one
effect's batch) and returns to the pool, so all effects of a frame share a few
textures per size; textures no encoder used for 120 encoders are destroyed.
Releasing a batch also forgets its views and refuses further use, so nothing can
read a cache the next effect has overwritten. Each lease carries a token: a batch
released after the next encoder already took its textures back returns nothing,
so it cannot free a texture another batch holds now.

**Limits at the rendered size.** Tool results and the inspector state the limits at
the size of the edited composition (the export size). The frame actually rendered
can be smaller or larger (reduced-quality preview, nested compositions, 3D
layer-space effects at their layer's own resolution, where Radius is relative to that
resolution); the pipeline logs once per effect and size (`BlurBudget`) when the
kernel is spread or capped there.

**Worker hosts.** The opt-in worker render modes follow the same units: worker
software draws Gaussian and Box as a canvas blur with the contract's sigma, and
Motion, Radial (Zoom and Spin) and Zoom along the contract's paths in one stage of
covered one-pixel cells (`coveredCellTaps`, as stage A of the graph), up to 64 bilinear
premultiplied reads, so an animated amount changes smoothly there too (streaks longer
than 64 px spread their reads and can look stepped; the `SoftwareBlur` log says so once
per effect, size and streak); worker GPU runs the
blur graphs. Gaussian
Blur on a motion-adjustment layer in the worker GPU host
(`workerGpuAdjustmentBlur.ts`) renders the tap list of `separableBlurTaps` itself:
a premultiplied `rgba16float` source and horizontal pass, straight alpha after the
vertical pass, Radius relative to 1080p, Samples not read.

**Retired Samples.** Gaussian, Motion, Radial and Zoom Blur choose their taps
themselves. Their `samples` parameters stay in saved projects but are hidden, have
no effect and are marked `deprecated`; `addEffect`/`updateEffect` accept them and
return a warning, and `listEffects` and the `updateEffect` list of valid names leave
out retired (`deprecated`) parameters; other hidden parameters stay listed. New instances
do not carry them (`getDefaultParams` leaves deprecated parameters out); graphs that
still read one fall back to its catalog default. Visibility
follows the instance's graph (`effectParamVisibility.ts`): an edited saved graph
that still reads Samples shows it again without a warning, and Radial's Type
(`graphOnly`) is hidden, and reported when set, on a graph that does not read it.

**Saved graphs.** An untouched saved copy of an old blur graph (any layout, folders
or packed compositions) is replaced by the current recipe on load
(`blurGraphUpgrade.ts`); edited graphs stay as the user left them. The previous
recipes remain in `legacyBlurEffectGraphs.ts` and
`legacyDirectionalBlurEffectGraphs.ts` for that recognition and for the shared
compositions extracted from them (Bounded Sample Count, Scale UV).

The organization/reuse pass also covers Glow, Edge Detect, Sharpen, Vignette, Film
Grain, Scanlines, Wave, Twirl, Bulge, Pixelate, Mirror, RGB Split, Blockify, Block
Mosaic, the basic color effects and all ASCII/Glyph variants. The earlier Glow
exposes Soft Bright Pass, the earlier Edge Detect exposes Sobel Magnitude, and
Saturation/Vibrance share Saturation (Gamut-Safe). Stylize graphs saved with their
earlier recipe keep that recipe's folders. Glyph Cell Grid,
Tone to Glyph Index and Glyph Atlas Alpha share compatible glyph computations.
ASCII Ghost's Decay & Max RGBA accepts its current and previous frames explicitly;
the existing history resource, reset policy and clock remain unchanged. These
blocks are insertable from Reusable Nodes and expandable into their primitives.
Saved custom layouts/groups are not automatically replaced by presentation stages.

**Sharpen** (contract `src/effects/stylize/sharpen/sharpenModel.ts`, since
2026-10-21) premultiplies the frame into a cache, blurs it with the separable
Gaussian Blur passes (σ = Radius pixels of a 1080p frame, at least 0.25 px) and adds
`Amount × (luma − blurred luma)` to R, G and B alike, so edges get crisp without
colour fringes. A halo limit removes most of the bright and dark outlines of a
classic unsharp mask. It takes a smooth darkest and brightest brightness of the
neighbourhood within ±2σ (at least ±1 px), densely, one pixel apart (up to 24 taps
per side, wider steps beyond). The outermost tap counts with the share of it the
window covers: its brightness moves towards the pixel's own and its weight shrinks by
that share, so the window grows continuously and an animated Radius does not flicker
when the window gains a tap. The extremes are taken first along each row in the horizontal blur pass,
whose cache then holds blurred brightness, blurred alpha, row brightest and row
darkest; then down a column of those rows in the final pass (means weighted by
`exp(±64 × Δluma)`; transparent taps weigh nothing, rows without an opaque tap are
ignored). The sharpened brightness passes unchanged between Floor and Ceiling (that
range ± a margin of 5 % of it, at least 0.04); beyond, the excess e rolls off as
`s × ln(1 + e / s)` with s = half the margin. It keeps growing, so stronger settings
keep adding contrast and neighbouring pixels never swap their order; a step edge's
halo stays at about 18 % of the step at Amount 1 and about 26 % at Amount 5 (a
plain unsharp mask overshoots by 40 % or more). At Amount 3–5 on strong texture the
peaks are compressed, and two neighbours at a peak can round to the same level.
Nothing depends on the timeline time. Negative Amount softens; alpha is kept. Three
passes. A Sharpen saved with the 3.2.7 recipe (taps spread evenly over a fractional
window, which jumped when an animated Radius added a tap) keeps it; the inspector names
it and offers the current recipe (`isPreviousStylizeGraph`). Both render the same
wherever 2σ is a whole number of pixels (Radius 0.5, 1, 1.5 … at 1080p); in between, a
strong Sharpen differs by up to about 60 levels on fine detail. Sharpens saved
earlier keep the fixed 7×7 kernel graph (no halo limit, Radius in render pixels).

**Edge Detect** (contract `src/effects/stylize/edge-detect/edgeDetectModel.ts`,
since 2026-10-21) is a derivative-of-Gaussian gradient of premultiplied brightness
in one window reduction: σ = **Width** pixels of a 1080p frame (at least 0.7 px),
window ±2σ up to ±8 px. Dividing by the window's own second moment makes it exact for
brightness ramps at any Width and resolution, so a step of contrast c gives a
response of about `x = c × 4 × Strength` (the brightness of the earlier Sobel); the
line strength is `1 − exp(−x)`, linear for faint edges and rolling off softly instead
of clipping, so dense detail keeps its structure. Lines are white on black (Invert:
black on white); **Color** tints them with the picture's own colour at full
brightness, the alpha-weighted mean of the pixel and two taps one and two σ towards
the brighter side. Lines are composited over the background premultiplied: alpha =
`edge + source alpha × (1 − edge)`, colour = `(line × edge + background × source
alpha × (1 − edge)) / alpha`, so transparent surroundings stay transparent and a
layer's outline shows outside it in its full line colour. Cost grows with Width:
(2⌈2σ⌉ + 1)² taps, 25 at the default on 1080p, at most 289, plus two colour taps. Edge Detects saved earlier
keep the eight-tap Sobel at render resolution (alpha always one); its Sobel Magnitude
stays available as a reusable block.

**Glow** (contract `src/effects/stylize/glow/glowBloom.ts`, since 2026-10-21) is a
lens bloom in 21 graph passes, most of them tiny:

1. **Bright pass** (full size, cached): each pixel's light times a smoothstep of its
   brightest channel from `Threshold − Softness × min(Threshold, 1 − Threshold)` up
   to white (1), where all of its light glows; premultiplied by alpha. The brightest
   channel lets saturated neon glow; ending the ramp at white makes lamps and clipped
   lights glow fully, so the default Threshold 0.95 (Amount 2.5, Radius 80) reads on
   night and stage pictures while a daylight sky (brightest channel about 0.8) stays
   out: on the lab's neon street the frame brightens by about 7 levels, on the
   daylight harbour by about 4. A Threshold of 1 or more glows only above white.
2. **Pyramid down**: ten Cache Images at 1/2 … 1/1024 of the frame, each a
   `[1 3 3 1]` reduction of the one above.
3. **Pyramid up**: from the smallest level back up with a 3×3 tent; each level joins
   with a weight that grows smoothly as Radius (pixels of a 1080p frame) reaches its
   reach, so Radius widens the glow continuously. Levels finer than 3 px (1080p) fade
   out, so 4K renders the same levels as 1080p. **Level 0**, the bright pass itself,
   stands for the 1080p levels a smaller render cannot resolve
   (`log2(min(Radius, its reach) / 3) + 1` of them) and fills up to a total weight of
   1 when Radius is finer than the pyramid: a reduced preview matches the export and
   a tiny Radius stays tight.
4. **Resolve**: the glow, divided by the square root of the summed level weights
   (wide glows grow without flooding the frame), × Amount × **Color**, is screened
   onto the premultiplied source with a soft roll-off, `1 − (1 − picture) ×
   exp(−glow)`: faint glows add their light, bright areas have less room left and
   nothing passes white, so it never clips hard; very strong settings still approach
   white and wash the colours out. Output
   alpha is `max(source alpha, brightest result channel)` and RGB is un-premultiplied
   by it, so the halo also appears around glyphs on transparent layers.

Cost does not depend on Radius: about 2.7 full-frame passes of work and about 1.7
frames of `rgba16float` cache memory per Glow (the full-size bright pass plus two
pyramids of a third of a frame each). Radius stops
widening the glow once the largest level is reached (about 1536 at 1080p); the
inspector and tool results say so, as they do for negative values and for a
Threshold at or above white (only HDR values glow).

Glows saved before 2026-10-21 keep the **earlier ring version** (contract
`glowSampling.ts`, graph `createRingGlowGraph`): a bright pass, a separable
prefilter and ring sampling at `k × Radius × 10` pixels with Rings and
Samples/Ring (both retired for new Glows, still read by the ring graph, and its
quality limits are still reported in the inspector). Untouched saved single-pass
originals upgrade to that ring graph as before; edited graphs stay as authored. The
inspector offers **Use the new Glow** (which resets Amount, Threshold, Softness and
Radius to the bloom's defaults) for an untouched ring Glow.

#### Editable UV distortions

Wave, Twirl, Bulge & Pinch and Kaleidoscope use editable UV/math graphs followed
by a single image sample (Kaleidoscope: two, crossfaded between neighbouring whole
segment counts). Wave, Twirl and Bulge & Pinch (see
[Distort Effects](./Effects-Distort.md)) read that sample from a premultiplied
`rgba16float` copy of the frame and unpremultiply the result (two passes), so a
magnified or squeezed transparent edge keeps its colour; at zero strength (Wave
heights 0, Twist 0, Amount 1) the built-in recipe is skipped. Twirl and Bulge
measure Radius in units of the shorter frame side (Shape: Circle) or per axis
(Stretch to Frame); Frame Edges mirrors, clamps or clears samples from beyond the
frame. Twist is stored in radians and shown in degrees. Bulge & Pinch above
Amount 1 magnifies the centre exactly Amount times. Untouched saved Wave, Twirl
and Bulge graphs, and effects saved before effects owned a graph, move to the
current recipes with Stretch to Frame, Clamp and (Wave) Speed 0, which keeps the
saved Wave and Twirl look; Bulge gets the smooth curve. The worker CPU fallback
renders the untouched recipes with a hand-written pass that matches the graph.
Kaleidoscope is covered with the mirror effects: see
[Editable mirror, split and pixel graphs](#editable-mirror-split-and-pixel-graphs).

The image operator catalog also offers two-dimensional rotation and radial
projection/inverse-projection primitives for equidistant, equisolid,
stereographic and orthographic lenses. Angles are in radians. The projection
functions share their WGSL implementation with the existing Fisheye shader,
including its original domain clamps and epsilon handling. The software
Fisheye renderer and image-graph reference evaluator likewise share the pure
CPU implementations. Strength, curve
bias, zoom, sampling and edge policy are not part of these primitives; the
editable default graph composes them explicitly with generic math and sampling
nodes.

Scalar tangent, arctangent and absolute-value nodes complement these optics
primitives. Absolute value shares its pure reference operation with Voxel and
Flock while retaining each backend's existing output limits. An explicit
Degrees to Radians node keeps angle units visible: directly bound or literal
degree values are converted before GPU uniform/constant rounding, preserving
the existing Fisheye packing order. Computed inputs convert at runtime; bypass
passes the original degree value through. Changing a bound angle updates its
uniform without rebuilding the shader. Fisheye's parameter schema supplies its
defaults and numeric limits to a shared normalizer; stored/UI angles remain in
degrees, including their existing keyframe IDs.

Fisheye compatibility checks retain byte-exact RGB and alpha comparisons except
for one explicitly approved GPU-rounding fixture: at 47×29, the orthographic
negative-edge-max case (strength −0.59, 8 samples, 20° FOV, feather 0.5,
edge feather 0.1, squeeze 0.25) permits alpha 78 → 79 at pixel (9, 9).
The measured cause is GPU multiply/add contraction in the sampling coordinate,
not a different alpha convention. This is not a general one-byte tolerance:
other pixels, channels, cases, and larger differences still fail. No production
shader rounding or quantization is changed to accommodate the fixture.

`math.mix.vec4` is the four-component variant of the existing `math.mix`
family. It reuses the same compiler/interpreter interpolation semantics and
bypass contract rather than introducing a Fisheye-only blend operation.

Bound `values.choice` nodes reference a select parameter in `effect.params`.
Its options, label and default come from the owning effect definition, including
the node's inline dropdown and parameter inspector. The compiler lowers the
selected option's index into a dynamic uniform, so changing the selection does
not rebuild the shader. Saved graphs contain only the parameter binding, not
copies of the options. Unknown or missing selections use the declared default;
missing or malformed select definitions fail validation. Choice nodes currently
require an existing effect binding and are not offered as unbound Add Node items.

Lazy image branches inside sequence and kernel reductions retain the current
sample index, including through nested branches and resampling scopes. Only the
selected branch runs for each sample. The CPU reference and GPU compiler use
the same scope contract; scopes sampled outside a reduction cannot accidentally
reuse its loop context. Index nodes remain invalid outside their corresponding
reduction, and nested reductions still require the existing pass-planning rules.
Pure image selection does not acquire a coordinate dependency or another pass.
Scoped sampling uses the base mip level of the existing single-level image and
intermediate textures, with the existing sampler's filtering and addressing.
This also permits image-dependent branches and loop bounds without implicit
texture derivatives. External video textures retain their base-level sampling.

#### Graph-internal texture stages

`image.materialize` creates an explicit texture boundary inside an image graph.
The compiler also inserts a necessary boundary when a kernel samples another
kernel's image result. Shared consumers reuse one producer stage; branching by
itself does not create a pass. Pointwise graphs and the default blur graphs keep
their existing single-pass paths.

Internal textures use straight-alpha `rgba16float`, preserving values outside the
normalized color range without introducing another 8-bit clamp. Half-float storage
is still a precision boundary. The existing `rgba8unorm` boundaries between
separate effects remain unchanged. Resource IDs and pass plans are runtime
compiler data; GPU handles never enter the saved graph.

Effect rendering and demanded node previews use the same staged execution path.
Intermediate allocations can be reused across frames, but their pixel contents
are recomputed for each frame. A CPU reference needs an explicit resource sampler
to evaluate a materialized input; it cannot silently substitute inline evaluation.
An `image.sample` whose sampled expression never reads its own pixel (for example
a cached resource sampled at an offset) no longer fetches the source texture for
that tap, in both the generated WGSL and the CPU evaluator.

Compile contexts may also declare named image sources. They lower to the same
resource-input contract without inserting another IR stage or pass, with at most
eight resources per plan. Each declaration selects hardware linear clamp or an
explicit four-load manual bilinear clamp; both preserve straight RGBA without a
color conversion. IDs beginning with `image-resource:` remain reserved for
compiler materialization, and undeclared names, duplicate declarations, unknown
sampling modes or misaligned runtime descriptors fail closed. Analog Signal Lab
uses this contract for its original frame and decoded PAL image, with manual
bilinear sampling fused into the existing final compute pass.

`Load Pixel` evaluates its connected image expression at an exact pixel on the
output-resolution lattice: coordinates truncate toward zero and clamp to the
frame bounds, while UV expressions see that pixel's center. GPU textures and
VideoFrames use integer loads; software evaluation reads an immutable source
snapshot. Resource loads additionally respect the resource's own extent and
stride. Typed nearest-seed fields remain raw RGBA16F records (XY pixel position,
Z validity, W reserved), not color images, and require declared stage provenance.

### Particle Render Effects

`Pixel Particle Disintegrate` is a `particle-render` clip effect. It samples
the live source texture into deterministic instanced quads and resolves a
straight-alpha texture back into the normal layer compositor. Cells that have not
been released are drawn by a flat pass as exact source pixels, so progress `0` is the
untouched picture; a released cell becomes its particle, which starts as the exact
cell, grows to Particle Size and takes its shape over the first quarter of its flight.
Fade (0-1) thins and shrinks each particle over its own flight (effects saved before
Fade read 0). Particles read the source premultiplied (manual bilinear), so cut-out
edges keep their colour. Particle release is driven by a deterministic
gust field: coherent noise pockets (4 octaves of the shared gradient Fractal Noise, turned
per octave, so no pocket has straight lattice edges), a wind-front delay, and the clip seed decide
which regions separate first, so the breakup starts in scattered islands and
then grows without relying on accumulated simulation state. Those raw delays bunch up (the
gust field's values cluster), so the renderer measures their spread for the current settings
(33 quantiles over a sample of the cells, `releaseTiming.ts`) and the shader lays each cell's
rank among them out evenly over a release window of 1.8 times the raw spread (at most 0.9):
at the defaults the releases run from Progress 0 to about 0.84 and the visible picture thins
out at an even rate (mean alpha about 0.82, 0.51 and 0.18 at Progress 0.25, 0.5 and 0.75).
A flight ends at `delay + Tail (1 - delay)`, so every particle has landed by Progress 1. The
flat pass finds a pixel's cell with integer arithmetic on its framebuffer position and the
per-cell detail value is an integer hash, so the flat and particle passes agree exactly, also
for fractional cells whose borders fall on pixel centres. Each particle
carries UVs from its original source cell, so moving particles keep their
assigned image patch instead of sampling from their new screen position. Preview
and export use explicit render/media time instead of wall-clock time.
The grid has one particle per Cell Size cell, with Cell Size in pixels of a 1080p frame
(shorter side), so previews at any Preview Quality, thumbnails and exports cut the same
grid; effects saved before keep counting output pixels (`cellReference: 'output'`, set on
load, reported in the effect card). Above the preview or export particle budget the cells
grow until the grid fits (rows are never dropped), the renderer logs it once, and the
effect card names the cell sizes preview and export draw.

This effect is terminal in the clip effect stack. Effects before it are pre-rendered
into the particle source texture; effects after it are ignored with a renderer
warning instead of being silently reordered. The Effects tab includes a `Particle Out`
preset button that adds the effect and creates progress keyframes near the end
of the selected clip.

The worker-GPU compositor also runs the dedicated particle pass for preview and
export, using the frame stack's preview/export particle-quality setting.

### Landmark Tracking Effects

#### Precise face control net

Select a video clip and use **Properties → Tracking → Track face precisely**.
This single-face pass decodes every source frame in the clip's trimmed source
range with an independent decoder, retaining original timestamps and durations
(including variable frame rates). **Detection: Independent frames** (default)
uses MediaPipe Face Landmarker in IMAGE mode, avoiding the VIDEO graph's temporal
landmark filtering for fast expressions. **Smooth video** retains the previous
VIDEO mode when temporal steadiness is preferred; independent detection can jitter
more. The current track's mode is shown separately from the next-pass selection.
Switching modes requires **Retrack face precisely**, then **Bake cables** to update
existing cable motion; existing stabilization keyframes are not overwritten.
Both modes store all 478 points, 52 expression
coefficients, and the facial transformation matrix when a face is detected.
Inference runs locally on the CPU and yields between frames; analysis images
are bounded to 1280 pixels on the longest side. The limit is 18,000 source
frames per pass; larger ranges fail visibly instead of being downsampled.

The **Show face control net** checkbox enables a preview-only inspection layer
on the selected clip: pink lips, cyan eyes, white irises, amber brows, green
outline, and all points. It follows the clip's ordinary 2D transform and source
timing. Source-frame lookup never borrows a future detection or holds a missing
face. Optional **Extra smoothing** reduces small jitter using adjacent detected
frames, preserves larger motions, and never bridges a missing detection.
This is a model estimate: occlusion and extreme expressions may still produce
incorrect points even when a face is detected; no per-point confidence is implied.

Full results are stored separately from the older hand/pose tracking pass in a
compressed, browser-local cache and can be restored when the Effects panel is
opened after reload. They are not yet portable project assets. Cancellation or
failure retains the previous valid result. The control net does not render into
exports and does not yet drive the existing 64-point effects buffer; it is the
inspection foundation for subsequent face-driven effects. A second clip using
the same source and a covered source range can reuse an already loaded face
analysis; its own cache entry is saved without running inference again.

**Transform > Stabilization** provides a reversible bypass for baked face/lip stabilization. It ignores only generated stabilization keyframes, preserving zoom, manual transforms and all stored keys. The switch is saved with the project and applies to preview, native 3D, nested compositions and export. Existing cable/depth bakes move with the clip; toggling this switch does not rerun depth inference.

**Stabilize face** and **Stabilize lips** bake ordinary position X/Y and rotation
Z keyframes at the composition frame rate. Face mode levels the outer eye
corners and anchors the nose; lip mode levels the mouth corners and anchors
their midpoint. **Lock tracked center to image center** holds that anchor in
the center; disabling it preserves the anchor's original translation while
leveling rotation. Scale is retained, so mouth opening and facial expressions
are not normalized away. The current Extra smoothing setting is baked in.

Baking replaces those three keyframe channels in one undo batch, preserves
other animation, and persists/renders through the normal project and export
paths. Changing the trim, retiming, scale or anchor afterward may require
rebaking. Missing detections hold the last valid transform; sudden orientation
flips are rejected briefly before reacquiring. Only unparented 2D clips without
source crop or X/Y rotation are supported in this first pass. This corrects
in-plane tilt, not perspective, head yaw/pitch, or non-rigid lip deformation.
Translation and rotation can reveal image edges; no automatic zoom is applied.

#### General hand, face and pose pass

The Effects tab can lazily track hand, face, or pose landmarks for a selected
video clip with the official `@mediapipe/tasks-vision` package and Apache-2.0
Google model files. Models/WASM load only on demand, Cache Storage retains the
downloaded runtime data, VIDEO-mode inference is CPU-backed and bounded to 8
fps / 300 frames, and cancellation restores the previous valid result.

Durable project/timeline data stores only serializable summaries. Full samples
are kept in the runtime and in a gzip sidecar cache that can be restored after a
page reload. Tracking effects receive a bounded 64-point storage buffer;
Kinetic Trace can additionally consume the existing optical-flow analysis
metadata without introducing a second motion-analysis pipeline.

### Timeline Transitions

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
registered-effect path with `motion-blur`; Motion Blur mirrors edge samples for
out-of-range UVs so fast horizontal transition blurs do not expose transparent
borders. `Projector Flicker` uses deterministic generated-solid
exposure pulses, `Film Roll` combines vertical transform overscan with
transition-scoped Motion Blur, and `Vignette Bloom` uses registered `glow` and
`vignette` effects on both transition participants (since 2026-10-21 tuned for the
bloom Glow, Amount 0.1–1.4 and Radius 60–240, and for the pixel-distance Vignette,
Roundness 0 with Size and Softness divided by √2, the same falloff as before). These
effects carry no graph; the worker software preview renders them with the current
recipes too (`workerSoftwareBloom.ts`, a CPU pyramid of the bloom, and the current
Vignette distance). `Light Sweep` uses a
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
`Crossfade` is a true dissolve, outgoing·(1−t) + incoming·t: the incoming clip
is added with the internal `plus` blend mode (premultiplied), so transparent
clips (titles, keyed or scaled clips) dissolve too. Clip blend modes carry
through every transition (`transitionCompositionBlend`): the transition
composition is drawn in parts, each composited in its own mode over the lower
tracks. Clips sharing a mode form one part, solids and overlays (Dip, Light
Leak, …) are separate parts, and clips with different modes are two parts
(exact at both edges; mid-dissolve shows a little of the lower tracks). Clips
added inside the composition below the transition's own clips are a separate
Normal part, so `plus` does not add them; if the transition's clips cannot be
found among the layers, their mode stays inside the composition and a warning is
logged; an incoming clip moved below the outgoing one inside the composition
takes the Normal mode and the upper clip gets `plus`. Audio (Include audio, or
two audio clips) uses one plan for preview, Properties and export
(`audioCrossfadePlanning`, `audioCrossfadeGains`): the fade runs only where both
clips have sound, with 5 ms de-clicks when they overlap less than 10 ms, and the
gains apply before the clip and track effects, so effect tails ring out alike.
Preview schedules them on each route's pre-effect gain on the audio clock
(`audioCrossfadePreviewVoices`): the incoming sound starts 0.25 s early at gain
0, crossfaded clips stay on their own audio element (no buffer mixer, no cut
handoff), and the halves of one recording (same file and source offset) play
once with both gains added, as the export's sample sum does. That one-voice
choice is made once per crossfade from both routes at the edit (ids ignored),
so keyframed volume or EQ cannot switch voices mid-fade. The outgoing sound
stays on the element it already plays on (its own, a cut handoff's or a split
recording's), and an upcoming incoming element or audio proxy is positioned,
paused and routed ahead; dropped proxy clones dispose their route, and a route
removed while it is still being built is cancelled. A track plays one window at
a time: around a short clip the later crossfade's pre-roll waits until the
earlier window ends, and crossfades that overlap on one clip start the later
one where the earlier ends (logged; export renders both). A clip with fades on
both edges keeps both, multiplied as in export, and crossfaded edges never
apply their automatic cut de-click. The faded-out sound's effect tail (clip and
track effects) keeps the route of the element it played on connected, also when
that is another clip's proxy from a cut handoff. Clips playing audible separated stems
cut at the edit in preview (logged); export renders their crossfade. Retimed, reversed
or composition clips cannot play their extra footage in step, so they meet at
the edit everywhere (Properties: "Cut (retimed clip)"). Audio curve: Auto
(default; also for crossfades saved without one) is Equal gain for the halves of
one recording and Equal power otherwise. Audio crossfades inside a nested
composition are not rendered; its mixdown cuts at the edit in preview and
export, and the export log says so. Default length 1 s, snapped to project
frames in Properties; the Transitions panel's length field is Auto unless a
length is typed. Checked in the editor on a real GPU against (1−t)·A + t·B and
a recording of the preview output.
User guide with pictures: [Dissolve Transitions](./Transitions-Dissolve.md).

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
source states fall back to the compositor transform path. Kaleidoscope is an exotic
pattern-lab transition by reusing transition-scoped registered effect
primitives rather than adding a one-off compositor path. `Puzzle Push`,
`Magnetic Tiles`, and `Shatter Glass` are visible multi-panel
transitions: the layer contract supports normalized `sourceRect` sampling,
and transition assembly clones transition participants into deterministic
staggered panels, center-magnetic tiles, or rectangular outgoing tile-shatter.

The default placement is virtual `center`: the edit point remains stable,
neither clip is moved, and missing source handles render as first/last-frame
hold fallback when the policy allows it. Compositor-driven transitions pass
typed transition metadata through existing compositor uniform padding slots, so
normal layers pay no extra bind-group cost when `transitionRender` is absent.

## Per-effect notes

Implementation notes of single effects. When an effect gets its own page, its user-facing facts belong there; these notes stay the developer reference its Technical details link to.

### Glow on transparent and 3D layers

Glow builds its bloom from premultiplied light and expands alpha into its halo, so a
title on a transparent layer glows outside its letters too. Hidden RGB in fully
transparent pixels contributes no light, and the halo is round on any aspect. Glows
saved with the earlier ring version keep it (see Glow below); custom rewired graphs
retain their own behavior.
Raster Weave strands process their own projected effect stack before joining the
shared 3D scene, so Glow works with other strands or particles without affecting
those layers. See [Weave](./Weave.md) for rendering limitations.

### Slit Scan

**Time field source → Shape target (tracked 2D motion)** reuses a source tracking
asset from the Tracking workspace. It treats the tracked quadrilateral as a
planar region with predominantly straight translation. Set **Anchor X/Y**,
**Target stretch** and **Time coherence**. The solver searches up to 96 recorded
source times inside Delay, using the clip's existing trim/speed/reverse/Time-factor
mapping. For each output pixel it finds the time when its target material point
was closest to that location. The resulting 64×64, 8-bit delay map feeds the
existing temporal sampler without changing UVs or inventing geometry. Outside
the stretched selection the map requests the current frame. The anchor cell is
pinned to current time; stretch 1 is identity. Missing tracking is not extrapolated.

The inspector reports RMS and maximum positional error in normalized image
coordinates: targets outside recorded motion remain imperfect. Time coherence
trades positional fit for similar neighboring delays. This is a bounded local
optimization, not an exact global solve or dense deformable-object reconstruction.
Enable the Time field source section and use Map mix 1 for the full target;
field shaping, protection, quantization and temporal interpolation can alter the
final result. Object stabilization must be disabled because this first version
uses source coordinates. Shape settings and the tracking asset persist normally.

The separate [Space-time slice](./effects/slit-scan.md#space-time-slice)
representation uses baked per-time depth and color rather than a time relief.

DIS motion analysis drains both GPU allocation error scopes and preserves the
original allocation error. Invalid forward or reverse flow textures are released
and never retained as usable cache entries.

**Motion compensation** (section switch, `DIS optical flow · resident history`) removes
temporal seams at their source instead of blurring them. Each decoded frame the
sampler picks is shifted along cached DIS optical flow to the exact requested time,
so Nearest and Blend both produce continuous motion between the few real frames a
short window contains (for example 30 frames for 1 s at 30 fps). Low-confidence or
invalid flow (occlusions, fast motion beyond the estimator) falls back to the
unshifted frame, so errors stay local. It reuses the same cached, project-persisted
DIS source pairs as Scan smoothing and does not touch planar tracking. It needs
**GPU history · resident video volume**; GPU cache, Hybrid storage and a Hybrid
capacity fallback render without compensation, and the status row says so. While
it is on, export renders individual frames instead of shared-source blocks. With
Time factor at full sample resolution every sample already has its own frame, so
compensation matters most for short windows. **Flow strength** scales the displacement
from 0 to 2 (default 1), preserving confidence and validity. Default Off, with no extra work.

**Sampling → Seam smoothing (px)** adds an optional 0–8 px directional filter
after the complete Slit Scan color output. Start around 1–2 px. Its mask follows
curvature in the selected base sampler's resolved source ages, including actual
source timestamps and blend weights. Linear time ramps and ordinary color edges
alone do not trigger it. **Seam edge protection** appears when enabled and reduces
cross-edge mixing; transparent boundaries receive additional protection. This is
a color-based safeguard, not object segmentation. It does not synthesize motion
or intermediate source frames and remains separate from DIS-based Scan smoothing.
The default is zero, with no additional query/filter passes. Supported output is
**Result** with **linked RGB time** and resolved source-frame metadata; other modes
display an explanatory status. The explicit geometry base sampler is used when
selected, otherwise `history`. Preview and export apply the same final filter,
including shared-source Hybrid output. Active filtering owns a full-size numeric
query and color target, reserved from the temporal memory budget.

Native 3D Slit Scan surfaces automatically create a premultiplied color mip chain
and use trilinear/8× anisotropic filtering. This reduces minification and oblique-view
aliasing; it does not remove geometric gaps or create missing temporal samples.

Delay, Map mix and Noise amount can be driven through the shared parameter-source
graph (constants, LFOs, keyframe sources, Remap and Clamp). Disabling the source
binding restores the authored parameter; source values must remain within the
parameter's runtime range. **Nodes > + Control > Audio envelope** reads an existing
RMS or loudness analysis for a selected audio/video clip. Timeline seconds follow
that source's placement, trim and speed; Source seconds require an explicit time
input. Linear/nearest sampling and floor/ceiling normalization are deterministic.
Missing analysis is reported as unavailable. Export snapshots copy the analysis
and source placement; full live audio/export verification remains pending.

Time fields support input/external Luma, Alpha, RGB and HSV channels, deterministic
smooth/cell noise and independent clip masks. Shaping and an optional noise
combination feed the existing bands and protection stages. External sources also
offer **Bake and use as time map** through the shared [Depth controls](Depth-Estimation.md#slit-scan-time-maps).
Depth source alignment validates provenance and coverage; freely aligned external
videos retain the timeline offset. End-to-end validation of these additions is pending.

**Source motion** is also available as a time-field source. It samples a fixed
1/30-source-second pair at analysis delay zero, independently of Scan smoothing.
Choose magnitude or velocity projected on an axis, then set its UV-per-graph-second
range and confidence threshold. Unreliable pixels blend back to the scan profile.
This source waits for required analysis frames and retains full analysis resolution
while playing. Selecting another field or setting Map mix to zero prunes unused
analysis resources. Motion accuracy and seek/export parity still need verification.


Add **Time > Slit Scan** to a video clip, or add its effect group in Nodes.
The editable group reuses UV, vector, math, choice, timeline-time and RGBA mix
operators. Named groups organize source controls, scan direction, wave
shape, center and subject protection, time sampling and diagnostic previews. Only `image.sample-history` is a
new atomic operator; Slit Scan supplies timestamped source frames to it, not its previous output.
Saved graph edits, effect bypass and numeric keyframes use the existing editor paths.

Inspector section switches and matching Node group bypasses share one saved state.
This includes nested image groups with an unambiguous typed pass-through boundary,
geometry groups (curves pass through, per-point fields fall back to their input
defaults) and scene groups with an existing renderer mute. Parent image-group bypasses keep
child bypass states, values, keyframes and wiring intact. Sections without a valid
bypass omit the automatic blue indicator; explicit read-only status remains supported.
Slit Scan explicitly links Time map source / Time
map, Protection mask / Subject protection, and Protected center to their groups;
their switches work in either view. Bypassing the Protected Center graph also skips
its radial/rings profile branch, returning to the upstream linear/center/wave profile.

- **Delay (s)**: maximum past-time offset, 0-60 seconds. Zero removes time displacement; object stabilization, when enabled, still applies.
- **Scan direction / Angle**: left-to-right (0 degrees), top-to-bottom (90 degrees),
  bottom-to-top (-90 degrees), right-to-left (180 degrees), or any diagonal angle.
- **Profile**: Linear scan, Out from center, Wave / folds, Radial scan or Time rings.
- **Protected center**: normalized X/Y position, circular radius measured in
  image-height units, and feather. Radius zero disables protection.
- **Wave**: number of waves, phase and animation speed in cycles per second.
- **Time bands**: 0 or 1 keeps smooth time; 2-64 quantizes the map into stepped ages.
- **Mix**: blend with the current input, including alpha. With object stabilization enabled, both inputs share the stabilized reference coordinates.
- **Object stabilization**: choose an existing tracking asset for the same source,
  or select a clip mask around a textured object at a clear reference frame and
  click **Track mask & stabilize**. **Create selection mask** provides an editable
  starting rectangle; fit it in Masks before tracking. Tracking runs locally in
  both directions over the trimmed source range. On completion, one undoable
  operation saves the tracking asset, enables stabilization and creates a separate
  **Slit Scan protection** mask with **New mask feather** (30 px by default).
  The mask is automatically **Effect input only**, so it does not cut out the clip.
  Cancellation or changing the source/selection during tracking keeps prior settings.
  Position, rotation and size are aligned to **Reference (source s)** before
  temporal sampling, for both the current frame and every historical source PTS.
  **Strength**, **Rotation** and **Scale** adjust the correction. This is a planar
  image alignment, not perspective correction or an object-shaped cutout; uncovered
  image borders are transparent. Other mask shapes use their bounding quadrilateral
  as the tracking area. The generated mask stays in reference coordinates; use
  **Create protection mask** after changing the reference, or edit it in Masks.
  Its **Mask feather** is also editable directly under Protection mask.
  Missing/foreign tracking and uncovered delay windows report an explicit error.
  A reference or sample gap pauses only stabilization in preview and export: Slit Scan keeps
  processing the whole window in unstabilized coordinates and resumes correction
  when coverage returns. The inspector reports the gap; export still waits for
  the requested source frames. Missing assets and decode failures remain errors.
  Reset **Reference (source s)** to use the track's current reference after retracking.
  Choose **Off** to disable stabilization or author a new source selection.
- **Source sampling** decodes the source video independently, applying clip trim
  and speed. Render preceding effects to an intermediate video to include them;
  arbitrary preceding effect stacks are not reevaluated.
- **Preset** (Slit Scan's own row at the top of the card, `looks.ts`) applies one of five starting
  points: Sweep (left → right, 3 s), Wave Folds, Radial Bloom, Time Rings or Time Steps (12 bands).
  A preset sets only Profile, Angle, Delay, Time bands, Mix, Waves, Phase and Speed, so storage,
  sampling, 3D geometry, time fields and protection keep their settings (the shared preset row would
  return them to their defaults). The row reads **Apply preset…** once any of these values changes,
  and while any of them has keyframes or a node source (the card names those values, which keep
  animating). The card dims Angle in Radial scan and Time rings and the Wave section outside Wave /
  folds and Time rings, which do not read them; Time bands between 0 and 2 render as off and the
  card and tool results say so.
- **Radial scan** and **Time rings** live in the Wave & Profile folder of the graph.
  Earlier graphs kept them in the Protected Center folder, whose mute (the default for
  new effects) routed the profile back to Wave, so Radial scan and Time rings rendered as
  Wave. Saved graphs are upgraded on load (the nodes move to the profile folder) and
  now render the chosen profile; muting Protected Center removes only the protection.
- **Time** and **Wave** come first in the Slit Scan inspector, followed by the collapsed
  **Sampling**, **Motion compensation** (with its header switch) and **Preview quality**
  sections; 3D geometry and the other switchable sections follow. Newly added effects start with 3D geometry enabled and the other switchable sections bypassed and collapsed; enabling a section opens it. Existing effects keep their saved switch states. Time opens by default. **Preview quality**
  switches between Small preview
  (160 px maximum edge) and Full size. Both use the same source timestamps and sample
  count. New Slit Scan effects default to resident GPU history, 4 GiB history memory,
  Blend adjacent frames temporal sampling (**Sampling → Temporal sampling**; Nearest
  leaves hard stair steps on moving subjects, Blend softens them into overlapping
  ghosts but does not remove them on fast limbs: **Motion compensation** shifts each
  frame along the optical flow for a continuous smear; older saved effects without
  this setting already rendered with Blend),
  shared-source Hybrid export processing, 1920 samples,
  zero scan smoothing, a 0.25 deformation threshold, Full size and Adaptive preview quality.
  The sample count is limited by the source's longer dimension in the inspector.
  Full size follows timeline Proxy mode for GPU cache: it uses the actual full JPEG proxy
  dimensions when enabled, otherwise original resolution. The composition/output
  dimensions remain unchanged, including 4K. Full-size
  export uses originals regardless of the preview Proxy switch. There is no
  rolling-history mode or playback-only temporal sampling fallback.
- **GPU history ? resident video volume** (Sampling ? Frame storage): the default
  TouchDesigner-style history for both preview and export. All distinct source
  frames required by the current temporal window stay resident in tiled GPU
  texture-array pages. The effect graph samples them directly with binary time
  lookup, preserving grid interpolation and adjacent-source-frame blending.
  Duplicate source PTS share storage. Source-resolution sample counts are available;
  Samples is not the number of allocated complete images. Full size uses originals;
  Small preview explicitly scales them to 160 px. Original quality defaults do not
  change when selecting this mode.
- **Scan smoothing (px)** (Sampling): optional nine-tap directional filtering,
  off at zero, with a radius up to four output pixels. The generated mask combines
  cached DIS motion with the actual delay gradient. **Stretch threshold (×)**
  measures maximum local expansion (default 2×, transition width 0.25×);
  pure compression does not activate the mask. The eye previews that mask in red,
  including at zero smoothing, and is disabled for export.
  DIS analyses original adjacent source frames using an independent WebGPU
  implementation of Gaussian pyramids, inverse-compositional patch search,
  spatial propagation and residual-weighted dense aggregation. A backward-flow
  check reduces confidence at inconsistent correspondences. This is the fast DIS
  path without variational refinement, not an OpenCV binary or a learned model.
  Source-frame pairs are cached in a bounded GPU atlas; changing the threshold
  reuses them. First use and uncached windows need preparation, with pair progress
  reported in the effect status. During preparation the optional mask is invalid
  and the base scan continues; export waits for analysis. The analysis size is
  bounded independently of output resolution, while each output pixel samples
  its own source time. The generated detector migrates without replacing authored
  delay wiring; old time-gradient bindings remain available to custom consumers.
  Motion estimates remain approximate, particularly at occlusions or weak texture.
  This filter blends existing pixels; it does not synthesize intermediate frames.
  Build, targeted regression execution and live DIS quality/performance checks
  are currently paused at the user's request. No measured speedup is claimed.
- **History memory** appears for resident GPU history: 640 MiB, 1 GiB, 2 GiB or
  4 GiB. This is the history allocation budget, not a measurement of free device
  memory; the rest of the editor and decoder need additional memory. Allocation
  follows the distinct source frames currently needed, with 25% refill headroom
  (at least four slots when available), rather than reserving the full budget.
  GPU allocation/upload validation errors are reported instead of marking the
  window ready. The initial
  window loads before direct sampling becomes available. Moving windows retain
  overlapping frames and refill missing PTS. During playback/scrubbing, an owned
  snapshot holds the last complete effect image while missing frames load. Missing
  temporal positions are never removed to produce a partial preview: that caused
  hard seams after fast seeks, especially with Nearest sampling. First load shows
  the input until a complete result exists. Export waits for exact samples.
  Up to twelve spare slots prime upcoming windows, including while paused, and
  useful prefetch requests continue when playback catches up to them. If the GPU
  rejects allocation, one retry drops optional headroom without changing quality.
  Windows that do not fit, or whose GPU allocation still fails, automatically use
  Hybrid streaming and report the fallback. Resolution, time window and requested
  samples stay unchanged. Capacity overflow uses the remaining selected history
  budget, after geometry and interactive-history reservations, up to the GPU's
  texture-array layer limit. Actual GPU allocation failures retain a conservative
  ceiling of 640 MiB for streaming. Streaming may be slower; changing memory/quality/window
  settings retries resident storage. Temporary source-load failures retry after a
  short delay while retaining available cached samples, without recreating the effect.
  It uses the same authored time-map/mask graph and stabilization contract.
  Implementation is experimental: a resident Full HD preview with 1920 samples
  and 74 distinct source frames was observed after the black-preview correction
  (752 MiB allocated instead of 4074 MiB). Native linear export measurements are
  recorded below; other playback and geometry configurations are not covered by them.
- **Preview quality: Adaptive** is optional for resident history at Full size.
  Playback, playhead dragging and paused parameter edits use adaptive history
  resolution, with a 960-pixel maximum edge even when full-size frames fit in
  memory; longer windows may reduce this further. This bounds interactive upload
  and sampling bandwidth rather than adapting only to VRAM capacity.
  A paused full-quality cache survives playback when its allocation plus the
  interactive memory ceiling fits the selected budget.
  While paused, a fresh adaptive result is shown until the requested
  full-quality result is ready; an older Hybrid result cannot replace that preview.
  Exports never use the adaptive preview.
  Cache misses also request upcoming source frames, so playback can catch up
  without waiting for a ready frame to start lookahead. Complete, GPU-validated
  windows display while the speculative tail continues loading. Lookahead visits
  only newly entering grid positions rather than rebuilding the entire history.
  Initial adaptive preparation takes priority over paused full-quality decoding;
  starting playback suspends outstanding full-quality source requests while
  retaining reusable GPU slots. Initial history decoding can still take time.
  Temporal sample count, time window and composition dimensions stay unchanged.
  A complete-window estimate reserves interactive slots up front to avoid repeated
  cache replacement as the clip advances. The warm interactive cache can supply a
  temporary image while paused full-quality rendering prepares, sharing the selected
  memory ceiling with that render. Presentation snapshots own complete effect images,
  independent of cache slots being recycled, and use a separate bounded GPU cache
  (up to four images / 64 MiB, with one oversized image allowed).
  Initial decoding is still required. Performance
  has not yet been benchmarked.
- **Export processing** (Sampling): `Shared source frames (Hybrid)` is the default
  block renderer for full-size Hybrid exports (including resident-mode fallback) of the standard linear scan,
  including arbitrary scan angles. Block size follows the remaining GPU memory
  after reserving source/current/demand buffers, up to 100 output frames. The
  final block stops at the export range or clip boundary. GPU allocation failure
  halves the block size automatically. It prepares these output frames from
  one source-ordered request and writes contributing strips directly from borrowed
  VideoFrames. Output tiles share the available history budget; the current effect
  input is added separately when each output is consumed. It leaves normal preview
  unchanged. Custom graphs, masks, stabilization, non-linear profiles, time maps,
  and small-preview quality retain the individual-frame path. Saved graph layout,
  edge order and the standard optional groups' neutral bypass states do not disable
  batching; changed nodes, wiring or bypass routes still use individual frames.
  Changing parameters invalidates prepared output tiles. Both export-processing
  choices use original full-size source frames at Full size; this is independent
  of the timeline's yellow scrubbing-cache indicator.
  Larger blocks delay the first output while amortizing source decoding across more
  outputs. They cache completed historical contributions, not the entire export.
  At 1920×1080, 100 RGBA16F output tiles plus temporal metadata reserve about
  1.56 GiB, in addition to current/source/demand buffers. Strip bounds are built in
  one pass over each tile's sample metadata. Current effect input remains live;
  changed parameters invalidate the block. Source-clock acceleration is included
  in the spacing of prepared outputs.

  **Verification (2026-09-23, local Windows/Chrome/WebGPU):** a six-frame
  1920×1080 / 30 fps H.264 comparison at the same source range, 1920 samples,
  Nearest sampling and a 38.97762-second delay completed in 21.03 s with
  Individual frames and 7.27 s with Shared source frames. Render/preparation time
  within the frame loop was 19.67 s versus 5.61 s. The shared run used one block
  and 911 requested source frames; it stopped after the six requested outputs.
  The encoded outputs had SSIM 0.997296: close agreement, not bit-exact parity.
  A separate 688-frame Full HD export completed successfully with 100-frame
  blocks in 80.20 s. These are observations from this project and machine, not
  guaranteed speedups for every codec, graph or memory budget. Targeted tests cover
  graph/bypass recognition, memory bounds, output spacing, strip coverage,
  remaining-range propagation and allocation-failure shrink/cleanup.
- **Time factor (×)** (Time): scales the source lookback from 1× to 100× without
  changing clip speed, duration, audio timing or composition FPS. Effective window
  = Delay × Time factor (up to 6000 seconds). Existing effects default to 1×.
  Both storage modes use the expanded source window; graph delay coordinates stay
  unchanged, so custom time maps and protection masks keep their authored behavior.
  Clip boundaries hold the first/last available frame. High factors only add
  distinct frames where source history exists; use Hybrid for large windows.
- **Match sample resolution** (bar button beside Time factor): sets Time factor to
  `(Samples − 2) / (source fps × Delay)`, rounded up to 0.1×, so every sample step
  addresses its own source frame (30 fps, 1 s Delay, 1920 samples → 64×). It is
  capped at 100×; the tooltip then suggests a longer Delay. It never changes Bypass
  slowdown, clip speed or duration, and is disabled while Time factor has keyframes
  or the source frame rate is unknown. The button is highlighted while the factor matches.
- **Bypass slowdown** (fast-forward toggle beside Time factor): keeps the source
  acceleration instead of compensating it at the output. At 4x, two seconds into
  the clip samples the eight-second source position, with the same expanded
  history window. Default off. Applies to GPU cache, Hybrid, resident history and
  export. The clip duration is divided by the factor; changing the factor updates
  that duration, and disabling/removing the bypass restores the source span.
  Audio remains unchanged. Acceleration uses the normal video playback/export
  clock, so no separate current-frame decoder blocks the history. Earlier effects
  still apply to the current input. Wave and external-map animation retain their
  composition clock. Animated factors remap from clip start and can jump in time.
- **Frame storage** (Sampling): **GPU cache** preserves the existing direct-atlas
  mode and its 256-sample maximum. **Hybrid · bounded GPU memory** adds a persistent
  GPU cache plus streaming for windows larger than its budget. Its Samples maximum
  follows the source's longer dimension (1920 for 1920 × 1080, capped at 8192).
  Equal source timestamps share one cached texture layer. All requested temporal
  positions remain available: the GPU evaluates UV/delay per output pixel and
  combines adjacent temporal weights. **Blend adjacent frames** interpolates
  between real source timestamps within each grid position as well: increasing
  Samples does not squeeze crossfades into narrow bands between repeated frames.
  This is crossfading, not optical-flow synthesis. Fully resident windows use one composite
  pass; larger windows read back only a compact frame-usage bitset, decode/upload
  needed frames in source order, and accumulate successive batches into an RGBA16F
  result. This has small half-float rounding differences from direct sampling.
  Hybrid uses originals in both preview and export, including Small preview.
  Its 640 MiB budget includes current/result buffers and upload allowances;
  browser decoder storage and custom graph intermediate images are additional.
  Preview holds the last finished result during preparation (the source input on
  first load); export waits for the complete requested result. Streaming can be
  slower than real-time. Status distinguishes temporal samples, distinct source
  frames and resident frames. Higher sample counts do not invent missing video
  frames: at 24 fps, a 2.5-second window has only about 60 distinct source frames.
- **Source-frame cache**: historical samples use an absolute clip-time grid,
  with **Samples** selectable from 2 to 256 (default 32). Higher counts retain
  the same source-PTS reuse, including duplicate grid samples of one decoded frame.
  The 640 MiB budget and GPU array-layer limit still apply; 256 is available at
  small preview sizes, while full-size sources may require fewer samples.
  The current frame is supplied by normal playback. Stabilization transforms
  that available input synchronously on the GPU, so playback never waits for a
  duplicate current-frame decode. Zero delay needs no historical decoding.
  Adjacent output frames reuse
  source PTS in a GPU texture array. A shared source-frame service coalesces requests
  from temporal consumers and borrows exact native VideoFrames already resident in
  the media runtime, without seeking the playback decoder. Missing frames use one
  independent sequential decoder cursor per source, reused across nearby forward
  refills and released after inactivity. Required frames take priority over up to four
  future grid samples prefetched during playback. Lookahead is replenished as the
  source-time grid advances, even while the current window is fully cached, and
  starts when playback resumes from a prepared paused frame. It does not wait for
  periodic cache misses before refilling. Superseded seeks cancel obsolete
  requests. Full/Small changes reuse the source index during a short grace period.
  A WebGPU pass writes each newly needed frame into the persistent array, applying
  resize, container rotation and external-texture color conversion without Canvas,
  ImageData or CPU pixel readback. Borrowed decoder handles are closed immediately
  after submission rather than pinned in another raw-frame cache, which can exhaust
  hardware decoder surfaces. Tracking's CPU frame reader is unchanged. The graph
  samples this array directly instead of baking a complete image each output frame.
  Small/full resolution use the same grid. The cache allocates the requested
  history plus up to four optional prefetch layers, with a two-frame allowance
  within 640 MiB across active owners (browser-managed decoder storage is separate).
  For a single original 3840 × 2160 source this allows up to 19 total samples
  (18 with object stabilization, including its corrected input texture);
  1080p originals and 1280 × 720 proxies support 64. Oversized requests show an actionable inspector status and
  bypass only the affected effect in preview; the image and subsequent effects
  remain visible. Export fails explicitly rather than omitting the effect.
  Neither resolution nor sample count is silently reduced.
  Transient source-cache failures retry after one second without removing and
  re-adding the effect; persistent failures remain visible in the status.
- **Proxy reuse**: Small preview and Full size with timeline Proxy mode enabled
  reuse exact JPEG frames from the existing proxy cache with bounded load concurrency. Their
  background reads share cached/in-flight loads without moving the timeline's
  interactive preload position or scheduling neighboring playback frames. Their
  indices must map unambiguously back to the requested source PTS. Missing,
  corrupt or ambiguous frames fall back to original decoding. Legacy all-intra
  video proxies and TurboRes/HAP proxy contracts are not used by this path.
  Full size reads actual proxy dimensions before allocating the atlas, rather
  than expanding every proxy to the original 4K dimensions. Full size with Proxy
  disabled, and full-size export, use original frames. No proxy generation is
  started by the effect itself; use the existing media workflow.
- **Temporal sampling**: Blend adjacent frames is linear interpolation and can
  produce double contours when objects move. Nearest frame disables this blending;
  it does not change spatial resolution. Time bands only quantize the time map.
- **Protection mask**: select an existing clip mask. Its animated shape, inversion
  and feather are evaluated at the output time. White coverage removes the time
  offset, so the protected area keeps moving at the current time. **Protection
  strength** scales the coverage; existing center protection remains active too.
  Choose **Effect input only** in the Masks inspector to avoid cutting the clip alpha.
- **Preview**: Result, Time map or Protection mask. The time map shows black for
  current time and white for the maximum delay; white in the protection preview
  means full protection. Both previews expose the actual graph signals.

The requested output time determines up to 64 source samples across the delay
window. Seeking reconstructs that window rather than starting the effect again.
At clip boundaries the first or last available source frame holds. During
preparation, resident GPU preview holds the last complete image and shows loading progress; export
waits for the complete requested window. A large seek can require an initial load.
Playback reuses cached source frames; decoder speed still limits cache refill. Caches and decoder handles are runtime-only and
never saved in project JSON. Node previews borrow the effect's source resources.
Legacy saved `temporalMode` values no longer select a separate rolling mode;
existing spatial graph wiring is preserved.

See [Temporal frame access](../architecture/Temporal-Frame-Access.md) for shared
service ownership, other consumers and migration candidates.

### Fisheye Lens

**Fisheye Lens** provides positive fisheye distortion and negative defisheye
correction with equidistant, equisolid-angle, stereographic, and orthographic
projection models. Lens strength, field of view, curve bias, radius, center,
zoom, anamorphic squeeze, rotation, edge behavior, feathering, chromatic
aberration, vignette, and 1/4/8-sample quality are configurable and keyframeable
where applicable. The WebGPU shader and worker-software export path implement
the same parameter contract.

Fisheye's default image graph is editable rather than an opaque distortion
node. It exposes AA jitter, lens projection, edge policy, chromatic sampling,
vignette, outside coverage and final resolve while retaining one effect pass.
Persisted edits therefore change preview and export execution, not merely the
workspace diagram. Each sample is premultiplied as it is read and the averaged
result is unpremultiplied, so lens and frame feathering, the outside mix and edge
sampling lower coverage instead of darkening colour; the worker CPU path does the
same. Untouched saved graphs of the earlier straight-alpha recipe (recognized by a
frozen recipe fingerprint) load as the current recipe; edited graphs stay as saved.

Image effects reuse a bounded cache of validated graphs and compiled CPU render
plans across playback, inline rendering, previews and worker-software export.
Numeric, Boolean, color and choice changes refill immutable uniform values;
graph revisions, effect-definition changes and resource-dependent parameters
rebuild the plan. Preview targets also cache their compiled plans and unsupported
scopes. This removes repeated graph compilation per frame without changing
Fisheye sampling quality or its rendered result.

The bindings retain the catalog schema exactly. Projection defaults to
`equidistant` (`equisolid`, `stereographic` and `orthographic` are available);
Strength is `1` in `-1..1`, Field of View is `140` in `20..175` degrees, Curve
Bias is `0` in `-1..1`, Radius is `2.1` in `0.1..3`, Zoom and Squeeze are `1`
in `0.25..4`, Center X/Y are `0.5` in `0..1`, and Rotation is `0` in
`-180..180` degrees. Preserve Aspect defaults true. Outside defaults to
`original` (or `transparent`), Feather is `0.05` in `0..0.5`, Edge Mode
defaults to `transparent` (also `clamp`, `mirror`, `repeat`), and Edge Feather
is `0.005` in `0..0.1`. Chromatic Aberration is `0` in `0..0.05`, Vignette is
`0` in `0..1`, Vignette Softness is `0.25` in `0.01..1`, and Samples defaults
to `4` in `1..8`, normalized to the supported 1/4/8 quality levels. Numeric
bindings keep their existing keyframe IDs.

Image graphs have an image-specific structural ceiling of 512 nodes and 2048
edges, plus 2048 expanded compiler instructions. The existing 64-node/256-edge
limits remain unchanged for non-image graph domains. These are validation and
lowering bounds, not permission for hidden black-box operators.

The worker-software route transports persisted canonical plans and evaluates
them in stack order with bilinear sampling and straight alpha. Materialized pass
chains run like `ImageGraphPassRuntime`: each producer pass writes an unclamped
float raster at its resource size (the GPU uses `rgba16float`), later passes
sample it with the linear clamp sampler, and the final pass writes RGBA8. It
supports a stack only when every enabled visual effect is image-graph owned;
mixed graph/legacy stacks, history inside a pass chain, and external resources
other than glyph atlases fail closed to the existing host fallback. Primary
color operations remain after the graph stack.

### CRT Screen

User guide: [CRT Screen](./effects/crt-screen.md). CRT Screen is a
frame-relative recipe (`src/services/operators/crtScreenRecipe.ts`): a barrel-warped
tube (`k = 0.18 × Curvature × Mix`, rounded corners of 5 % of the frame height,
transparent outside, rim darkened by up to 40 %), Line Count Gaussian scanline beams
over the frame height (16 to 1080; the control and the recipe clamp share one range)
whose width grows from 0.16 to 0.42 line heights with the line's brightness and
never drops below half an output pixel, and an Aperture Grille or Slot Mask whose
stripe width is Mask Size pixels at 1080 lines. Each pixel adds the two nearest
lines. A line's light is the picture averaged over every row of the line: a second
cache box-filters the frame down over an eighth of a line height (16 reads), and
each line reads that eight times an eighth of a line apart, so thin detail between
line centres is never skipped at any line height (tested at 4.5, 9 and 18 px lines:
a single bright row keeps 0.94 to 1.08 of its light at every offset), and each beam profile is
divided by its area (√(2π) × width), so a beam spreads its line's light without
adding or losing any: dark, mid and bright tones keep their average exposure
(within 5 %, tested from grey 0.1 to 0.75). Both masks keep the average light; the
Slot Mask divides its slot term by its mean (1 − 0.7 × 0.14). Bright areas can clip
where a beam or a mask stripe peaks. Lines closer than 2.25 output pixels and
stripes below 1 pixel fade out instead of aliasing, and the inspector and tool
results say so. Sizes count against the frame being rendered, so a reduced Preview
Quality shows fewer pixels per line: at 0.25 a 1080p composition renders 270 rows,
and the default 240 lines and 2 px stripes fade in the preview while the export shows
them. Flicker is a slow rolling hum bar plus a brightness flutter on composition
timeline time. All reads come from caches of the frame as premultiplied linear
light (`rgba16float`: the frame, and its line box), so filtered reads average light and
cut-out edges keep their colour. Values outside the rendered ranges are clamped and
reported.

Effects saved before the 2026-10 rebuild keep the original graph
(`legacyCrtScreenGraph.ts`: 2 px scanlines, per-pixel mask stripes, clamped edges):
a saved graph stays as saved, and a graph-less effect or custom Look entry without
the recipe's Line Count parameter is given the frozen original on load
(`analogLegacyGraphs.ts`). The new controls are `graphOnly`, the retired Mask
Density (`scale`) and the unused Angle and colours are `deprecated`, so each
instance shows exactly the controls its graph reads.

The four reusable compositions Radial UV Curvature, RGB Stripe Mask, Sine Gain and
Clamped Image Sample are still extracted from the original CRT graph and keep their
definitions.

The separate Scanlines effect retains its scrolling/density phase and operand
order. Film Grain uses its own Random (Cell) value noise rather than Glitch's
Hash 2D or CRT's sine gain. Shared primitive operators already cover
those differences; similarity alone is not treated as an identical recipe.

Glitch, Film Prism, Holo and Ribbon Scan were rebuilt the same way (`glitchRecipe.ts`,
`filmPrismRecipe.ts`, `holoRecipe.ts`, `ribbonScanRecipe.ts`; originals in
`legacyGlitchGraph.ts`, `legacyFilmPrismGraph.ts`, `legacyHoloGraph.ts` and
`legacyRibbonScanGraph.ts`, pinned for old data by the Density, Grain, Stripes and
Edges markers).
Glitch changes state 12 × Speed times per timeline second (Speed 0 freezes it):
Density decides how many states glitch (a 20 % floor, all at 1) and how many rows
tear and blocks move; torn rows split at a random height and shift by up to 15 %
of the width, thin slices by up to 2 %, square blocks copy whole blocks (the offset
rounds to the nearest block, so a faint Intensity moves nothing), one in ten of them
reads from four times as far and blends its rotated channels into its own, up to
half on a textured block and 0.15 on a flat one (the luma range of four points in
the copied block, smoothstep 0.03 to 0.15; scaled with the burst level), so a swap
never paints sky as a solid tile, and RGB Split widens inside the damage. Every read
lands on a texel centre and wraps around the frame, so the picture stays sharp; each
channel keeps its own coverage. The state counter cycles every 1024 states; seed and
cycle fold into 509 seed keys by an integer modulo, and every roll adds its own
integer salt, so all hash keys are exact integers below 2^24.
Film Prism reads seven spectrum-weighted taps (stratified per-pixel jitter, reach
±1.5 % at Fringe 1) either scaled about the centre (Lens) or shifted along Prism
Angle in frame heights (Prism); only colour spreads: the Rec. 709 luma of the
spread is replaced by the pixel's own where it has coverage, so the picture stays
sharp (a hard edge stays within 2 px in brightness at the default Fringe). It adds
two octaves of mid-tone-weighted value-noise
grain sized in pixels at 1080 lines, renewed 24 × Grain Speed times a second. Grain
corner keys are the integer cell indices plus 16384 key rows per grain frame (997
frames per cycle), so two cells that share a corner hash bit-identical keys at any
resolution: no seams. Because every key of both recipes is an exact integer, the GPU
(f32) and the worker software path (f64) hash the same bits.

Both recipes use `noise.hash2d-pcg.vec2` (Random (Integer Hash)): a lowbias32 bit mix followed by PCG2D on the exact float bits. Unlike the
shared sine hash `noise.hash2d.vec2`, it shows no diagonal stripes on cell grids and
stays uniform for large or fractional keys; the sine hash itself is unchanged, so
other effects keep their look.

Opened in the Node Workspace, the untouched recipes show stage folders
(`effectPresentationPlans.ts`, presentation only): CRT Screen Tube Shape & Rim,
Scanline Beams, Phosphor Mask, Hum Bar & Flutter and Light Out & Alpha; Glitch Burst
Clock, Torn Rows, Block Copies, Read Position & RGB Split, Channel Reads & Swap and
Colour & Alpha; Film Prism Fringe Spread & Direction, Tap Positions, Spectrum Reads &
Sum, Sharp Brightness, Grain Noise, Grain Strength and Add Grain & Alpha. Folder ports carry the
parameter or signal they pass (Line Count, Burst Level, Tap 1 Position).

Crystal and Glass Dispersion expose their facet direction, refraction offsets
and image sampling as editable generic graphs. Their vector normalization uses
the native operation shared by the compiler and evaluator; sampled alpha is
preserved, and shimmer/pulse animation reads composition timeline time. Both are
marked experimental (an `experimental` note on the effect definition: the effect
list shows "(Experimental)", the inspector and tool results give the reason):
Crystal's facets are squares of the frame with hard seams and strong Refraction
ghosts edges; Glass Dispersion's cells are sized in output pixels and split red and
blue per cell into RGB blocks. Their Amount defaults are 0.3 (0.75 before 2026-10).

Holo (`holoRecipe.ts`) mixes linearly from the source (Amount 0) to a bounded foil
(Amount 1): screen(colour × 0.85, vivid spectrum × (0.25 × tone + 0.75 × edge)),
where tone = smoothstep(0.02, 0.35, brightness) keeps true blacks black away from
outlines and the vivid spectrum is pushed 1.6 × away from its own grey. The spectrum blends
Spectrum A and B by diagonal interference bands (phase 12u + 19v + 2 × Speed × time
+ 4 × brightness; Stripes blends from an even tint to the full bands), and the edge
term compares brightness × coverage ±0.2 % of the frame height apart (four reads),
so outlines have the same width at every resolution. Amount defaults to 0.35. The
original Holo graph (per-pixel derivatives, saturating at every Amount) stays in
`legacyHoloGraph.ts` for saved effects; its GPU shader keeps native automatic
derivatives, which the software backend evaluates as coarse fragment quads.

Halftone and Pattern Halftone share an editable generic graph construction for
rotated cell coordinates, luminance-derived mark size, ink mixing and preserved
source alpha. Pattern Halftone keeps its Circle, Diamond and Line choice bound
to the catalog-owned select schema instead of persisting duplicate options.

Riso and Riso Glow expose their offset registration samples, Rec.709 ink loads,
subtractive paper blend and source-alpha path as editable graph operations. Riso
Glow adds its pulse from composition timeline time; colors and controls remain
owned by the catalog schema.

Dithering and Dither Studio expose their Bayer/checker thresholds, four-level
quantization, ink selection and source-alpha path as editable graph operations.
Dither Studio's Bayer 2, Bayer 4 and Checker choices remain bound to the
catalog-owned Kernel schema rather than copied into saved graph data.

Pixel Press (`paper-print`) and Pixel Poster expose their source sampling,
noise/posterization arithmetic and final amount blend as editable graph
operations with catalog-owned controls and preserved source alpha. Pixel
Poster's pixelated source remains part of its result even when Amount is zero.

Tone Geometry and Cross Stitch expose their rotated cells, catalog-owned shape
choice and pattern masks as editable graph operations. Glitch Grid, Scatter
Mosaic and Drift Lines expose timeline-driven hash/wave displacement and
sampled-alpha paths; displaced samples determine alpha rather than the original
undisplaced pixel.

### Drift Lines

`createDriftLinesGraph` (`src/services/operators/motionHalftoneEffectGraphs.ts`) and its shader twin
`driftLinesFragment` turn the pixel around the frame centre by **Angle** (degrees, counter-clockwise on
screen) and count bands across it from the top edge, so Angle 0 is the original horizontal recipe. The
band height is **Band Size** (`scale`) × shorter side / 1080 (`DRIFT_LINES_REFERENCE_HEIGHT`), at least one
pixel; preview qualities, thumbnails and 4K exports show the same bands. Each band shifts along its own
direction by sin(band × 0.71 + timeline time × Speed × 2) × **Drift** × 6 % of the frame width, and
every second band is shaded to 0.64–0.82 of its brightness. Band Size below 2 is clamped by the
`scale-clamped` node (`renderMin`, reported by `paramRangeNotes`); bands under one output pixel are
reported by `driftLinesWarnings`. The parameter ids stay the engine's (`scale`, `amount`, `angle`,
`speed`); Band Size, Angle and Speed keep the engine's shared roles (no `styleRole`), so the Style
menu carries the values the user set. Drift (`amount`) is a distance, not a mix (`styleRole: 'drift'`):
it starts at the new look's default in every other look, and the row says so. Angle is `graphOnly`: a node setup
edited before it acted does not read it and the card hides it. The stage folders come from its
presentation plan (Bands, Drift Wave, Shifted Sample, Line Shading & Alpha). Its four presets live in
`src/effects/halftone/driftLines.ts`. Tests: `tests/unit/imageMotionHalftoneGraphs.test.ts`, `tests/unit/effectPresets.test.ts`.

### Riso and Riso Glow inks

Each ink filters the paper towards its own colour where it prints: the print colour is
`paper × mix(1, inkA, a) × mix(1, inkB, b)`, with `a` and `b` the coverage of the dark and the warm
ink (1 − luminance, read 0.35 × Registration pixels to the left and to the right). The default inks (#2046b3 blue,
#ef476f pink) therefore print blue, pink and, where both overlap, a deep violet. The recipe
(`risoEffectGraphs.ts`) and its WGSL reference (`src/effects/halftone/shader.wgsl`) share this
formula; `tests/unit/imageRisoGraphs.test.ts` checks that each default ink prints in its own colour.
Riso Glow adds `glow × (a·inkA + b·inkB) × 0.3` on top, pulsing with Speed.

### CCTV noise speed

CCTV's picture noise changes 24 × Speed times per second (Speed 0 holds it), like the sweep of HUD
Tracker; the other tracking overlays without a time-based part (Subject Highlight's colour, Tracked
Scene's and Motion Trails' speed) retire those controls.

### Ribbon Scan

Ribbon Scan (`ribbonScanRecipe.ts`) scrolls Ribbons bands (`scale`, at least 3)
over the frame height by Speed bands per second; inside a band the picture shifts
sideways by sin(2π phase) × Displacement² × 6 % of the frame width (`amount`,
default 0.3: at most 0.54 %), so the low half of the control stays subtle. Edges
(`edges`) mirrors or wraps reads past the frame edge instead of repeating the border
pixel. Both reads come from a premultiplied cache and blend premultiplied. The
original graph (up to 8 % shift, clamped edges) stays in `legacyRibbonScanGraph.ts`
for saved effects.

### Wave Lines

Wave Lines uses shared luminance, coordinate, scalar and color operators for its
animated line mask and nested color blend. Line Density (`scale`, at least 3) and
the Lines and Background colours remain bound to the catalog parameters and use the
common color normalization. Source alpha is preserved; preview and export use the
same composition timeline clock. Wave Lines is a graphic line-art look that covers
most of the picture from about Amount 0.5; new Wave Lines start at Amount 0.3 (the
catalog default 0.75 before 2026-10), saved ones keep their value.

Crystal Glass (Facets, at least 4 across each axis, so facets stretch with the frame
shape), Glass Dispersion (Cell Size in output pixels, so the pattern changes with
the resolution) and Wave Lines keep their graphs; their unused catalog controls are
retired and values below a shader floor are reported instead of being silently
raised. The controls of CRT Screen, Glitch, Film Prism, Holo, Ribbon Scan, Crystal
Glass, Glass Dispersion, Wave Lines and Pixel Sort use the shared Resolve inspector
rows (slider, value field, keyframe and reset; `RESOLVE_ROW_EFFECTS`); their colour
parameters (Holo's Spectrum A and B, Wave Lines' Lines and Background) use the
shared colour row `ResolveInspectorColorRow` (swatch, hex field and reset; pointer
activation leaves no focus ring, keyboard focus shows the product ring). Colour
parameters had no inspector control in the generic rows before.

### Analog Signal Lab

`Analog Signal Lab` is a dedicated compute effect (a source footprint pass plus the six stage passes) rather than a
screen-space RGB glitch. It encodes the source as a 13.5 MHz PAL composite
field, applies a complex-equivalent terrestrial channel, passes the recovered
signal through an optional VHS transport, measures horizontal sync and color
burst per line, decodes PAL, and resolves an optional CRT display stage.

PAL Encode averages the source over each sample's footprint (21 half-sample taps,
two sub-rows), low-passes luma by Luma Bandwidth (Gaussian σ 1.0 to 0.55 samples)
and chroma to about 1.3 MHz, and traps luma in the subcarrier band with a
[1 2 3 2 1] / 9 kernel over whole samples, except for the Y/C Crosstalk share. PAL
Decode separates chroma as the composite minus its 3-sample mean (exactly zero for
flat areas), demodulates it with the burst-locked phase and low-passes U/V with a
Gaussian window (σ 2.6 to 1.1 samples, about 0.7 to 1.6 MHz, by Chroma Bandwidth). Flat colours therefore
decode without colour from luma, Chroma Level 0 stays monochrome, and only fine
stripes near 4.43 MHz show cross-colour, in proportion to Y/C Crosstalk. PAL Encode
reads Luma Bandwidth and Y/C Crosstalk from the PAL Decode it feeds.

VHS Transport models colour-under recording: it separates luma and chroma around
the jittered tape position with taps on whole samples (a fractional read would
weaken the subcarrier), low-passes luma to about 3 MHz (SP) to 2.2 MHz (EP) after
adding the tape noise, so noise stays out of the chroma band, records chroma at
roughly 0.6 MHz (SP) and less at slower speeds and with Chroma Bleed (which also
delays it by up to 2.5 samples), adds chroma noise that is smooth along the line (sideways streaks), and
re-modulates chroma on the stable reference: hue survives the time-base error, and
saturation drops to 0.93 / 0.87 / 0.81 at SP / LP / EP. The burst passes unchanged.

Select the clip in the timeline to edit its executable node group: Frame,
PAL Encode, RF Channel, VHS Transport, Receiver Analysis, PAL Decode,
Display Resolve, and Image Output. Connections determine the compute plan;
bypassing RF or VHS removes that stage's dispatch. Direct Frame-to-Output
wiring performs no analog compute passes. Unfinished wiring remains saved
and pauses the effect rather than silently restoring the default graph.
Controls retain their existing parameter/keyframe IDs, ranges, and defaults.
Decoded and resolved node previews tap the actual GPU output on demand.

New graphs expand Display Resolve into a group of shared math, coordinate,
sampling, and color nodes: curvature, bloom, scanlines, phosphor mask, flicker,
and blending are editable connections rather than an opaque display shader.
The default runs seven compute passes (the source footprint pass and the six stages); the display group adds no pass.
Its decoder signal-strength input follows the actual connected transport
stages, including bypass. Original straight alpha is preserved. Complete saved
Display Resolve graphs expand on load while preserving bindings, constants,
groups, and parameter IDs. Incomplete legacy wiring stays editable until it can
be migrated; it is never replaced by a default graph.

The exposed modules cover signal strength, band-limited RF/impulse noise,
co-channel interference, two-path delayed ghosts with carrier phase and drift,
receiver tuning and sync/color lock, PAL simple/delay-line/comb decoder modes,
VHS tracking/dropouts/time-base error/tape wear/chroma bleed/head switching and
SP/LP/EP speed, plus CRT scanlines, phosphor mask, bloom, curvature, and field
flicker. Noise is seeded and driven by timeline time, so preview and export are
repeatable. The built-in Looks PAL Broadcast, Weak Antenna and Worn VHS are starting
points. Values outside a control's range are reported: the Mix, stage (VHS Stage
included), bandwidth, Chroma Level, Y/C, Signal Strength and Color Lock values are
clamped, the others are used as given; a unit test checks the list against the
shader. Saved projects: the 2026-10 PAL chain fix changes how every saved Analog
Signal Lab effect looks, on purpose and without a switch back (no colour confetti on
detail or at the frame edges, a sharper broadcast, VHS keeps its colours and is
softer than broadcast); their settings are unchanged.
`tests/browser/analog-signal-gpu-check.ts` checks grey, Chroma Level 0, colour bars
through PAL and VHS LP, the VHS noise direction, colour at the frame edges of a flat
grey frame (0.5/255), a 2.6 MHz luma sine (broadcast 0.80, VHS LP 0.40 of its
contrast) and the VHS Stage fade-in (0 against 0.002: one 8-bit step at most)
against plain maths on the GPU.

The realtime path models one 313-line PAL field at BT.601 sampling (864 samples per
line at 13.5 MHz, 702 of them picture) and decodes it to a 702 × 288 raster, one
pixel per picture sample and field line. A footprint pass first box-averages the
source over each sample and line (alpha-weighted, every source row and column, so a
4K or 8K frame is not skipped). PAL Encode low-passes luma to the Luma Bandwidth
cutoff (2.5 to 5.5 MHz) and removes the luma the decoder would read as chroma
(subcarrier ± the U/V cutoff + 0.35 MHz) except for the Y/C Crosstalk share; chroma
is low-passed to 1.3 MHz. PAL Decode notches luma over about 3.6 to 5.2 MHz and
low-passes the demodulated U/V to 0.6 to 1.3 MHz (Chroma Bandwidth). The filters are
41-tap frequency-sampled FIRs (Hann window) computed once per workgroup. The picture
continues 16 samples into the blanking on both sides with its edge colour, so the
filters and small sync shifts near the frame edges read picture, not blanking. VHS
Transport low-passes luma itself to 3, 2.6 and 2.2 MHz (SP, LP, EP; Tape Wear lowers
it by up to 0.5 MHz), smooths its tape noise along the line and fades the whole
stage in over VHS Stage 0 to 0.1, so a keyframed fade-in has no step. When the effect is attached
to a video/image plane switched to 3D, the analog stack is evaluated into a
per-layer texture before native scene projection. The disturbance therefore
foreshortens, rotates, and scales with the plane instead of being applied to
the flattened synthetic scene texture afterward. The same routing is used for
nested 3D compositions.

### Editable Voxel Relief nodes

**Open Nodes** exposes the relief as a nested, editable operator group. The
default height path is texture → luminance → clamp → power → multiply → add;
grid points and a primitive feed **Instance on points**, then material/mesh,
camera, lighting and render. Texture/UV, material and mesh reuse the shared scene
operators. Fixed math inputs can be edited directly under their ports, and the
Math dropdown switches operations on the canvas or in the inspector.

The primitive's Shape dropdown selects Box, Sphere or Cylinder without replacing
the node or its connections. Box remains the default and retains its original
edge appearance and instancing cost. Sphere and Cylinder use real topology in
native 3D and matching analytic intersections in the 2D raymarch path. Voxel
material color still comes from the existing sampled source/tint/opacity path;
this does not introduce a general mesh-material or arbitrary texture-slot system.

The same connected field program drives 2D raymarching and native 3D instancing.
The 2D graph camera controls relief framing; native 3D uses the timeline scene
camera. Geometry, UVs, tint and opacity affect the real render; disconnected or
muted geometry produces transparency. Existing flat effect values and keyframe
property IDs stay compatible, including older coarse voxel graphs. One height
field supports up to 32 register operations and one texture mapping; color may
use a separate mapping. This is scalar field math, not arbitrary RGB-vector or
general-purpose geometry processing.

### Voxel Relief camera & orbit mode

The effect's virtual camera is fully parameterized: `tilt`, `yaw` (±180°, full
orbit), `perspective` (FOV), `distance` (dolly multiplier, 1 = classic framing),
`centerX`/`centerY` (focus point), `roll`, and `lightFollow` (light azimuth
rotates with yaw so the far side never falls fully into shadow). The raymarch
budget scales with camera distance and skips empty space above the relief, so
far zoom-outs stay intact. Params are grouped in the Effects tab (Relief /
Camera / Light / Look; Camera is collapsed by default).

Effects that declare `cameraInteraction` (currently voxel-relief) get an
**Orbit** button on their effect header. While active, dragging in the Preview
orbits tilt/yaw freely in both directions (0.25°/px, same drag direction as
the 3D scene orbit),
Shift+drag pans the focus point, and the wheel dollies `distance` with a
smoothed target. Yaw and tilt wrap continuously instead of stopping at a
pole, and drag/dolly directions match the native 3D viewport. The eye orbits
at constant radius (`distance` 0.2–6), and the horizon stays level at every
yaw. Writes go through `setPropertyValue`, so
history batching (one undo step per drag) and keyframing behave exactly like
slider edits. The mode is ephemeral (`engineStore.effectOrbitTarget`), clears
on deselect, and hides for 3D clips.

Voxel traversal uses exact cell-boundary stepping with 2×2 supersampling, so
tall columns remain solid in profile views instead of breaking into dashed
segments or strong moiré patterns. Its Y-up orbit space is converted back to
the source texture's Y-down coordinates when sampling, keeping text and video
upright at every camera angle. Rays that miss the relief remain transparent
instead of revealing a dim flat copy of the source behind the voxels; the
finite source floor remains available through `Limit to Video`.

For WebCodecs Fast export, display rotation from decoded `VideoFrame` sources
is materialized before multi-pass effects. The compositor then suppresses the
already-applied downstream rotation, keeping portrait Voxel Relief framing,
orientation, and camera animation identical between Preview and export. The
effect is still rendered at the active Preview/export target resolution;
`columns` controls voxel density, not output raster size.

### Voxel Relief as a true 3D scene object

A clip with an enabled voxel-relief effect that is switched to 3D renders as a
scene object of kind `voxel` (instanced Box, Sphere or Cylinder cells with real depth) instead of a
flat plane — the scene camera replaces the effect's virtual camera, and the
effect's camera params plus `temporalBlend`/`maxSteps`/`reset` are ignored in
3D. The 2D post-effect is excluded for consumed voxel layers so it is not
applied twice. Voxel objects render in every scene view — the composite
preview (scene camera from an active Camera clip), the Edit view, and the
3D-edit viewports — and video-backed voxel fields sample the source through
the 2D-canvas copy, so real video frames drive the height field. Synthetic
scene layers use the viewport dimensions plus source-pixel scale compensation,
preventing portrait media from becoming a stretched, window-like slab in the
3D editor.

### Face Cables

The [Node Workspace](./Node-Workspace.md) exposes nested Tracking, Surface & depth,
Cable physics and Cable rendering groups. MediaPipe landmarks, face meshing, depth
calibration, depth meshing and surface merging are separate typed stages. Merge
seam width and subdivision settings are saved with the successful bake and shared
by rendering and collision geometry. The node catalog lists reusable operators;
existing projects migrate their graph without discarding tracking or baked data.


Add **Effects > Add Effect > Tracking > Face Cables** to a video clip. Its
tracking source is the same clip's precise face result, restored independently
of the open inspector. Create/retrack that result in **Properties > Tracking**;
face stabilization and the preview control net live there too.

Each effect manages 1-32 cables. Choose both anchors, length factor, gravity,
damping, thickness, and color, then **Bake cables**. The default connects the
subject's right mouth corner to the right iris/pupil center. Iris anchors use
landmarks 468/473 and follow eye movement; eye-contour centers remain separate
choices. Left/right always refers to the subject, not the screen.

Ropes with 4-96 segments (24 by default) use gravity, inertia, damping, fixed endpoints, and iterative
length constraints, simulated at at least 120 Hz in composition coordinates.
The shader adds rounded shading, shadow, and connector rings. Multiple cables
share one effect pass, with per-cable bounds. There are no face or cable
collisions yet. Missing detections hide the cable; reacquisition or large jumps
reset it to avoid explosive motion.

Baked geometry is compressed into ordinary effect parameters, so saved projects,
random scrubbing, playback, and export use the same frames without rerunning
physics. Cancel leaves the previous bake intact; baking is one undo step and
preserves other effect instances. Re-bake after tracking, trimming, retiming,
transform, or composition changes. Currently supports unparented 2D video without
crop or 3D tilt, with an 8-million-float budget and a 18,001-frame limit per bake.
Tracking caches remain local; an already baked effect plays without the cache,
but new bakes require the precise tracking data.

Face Cables also exposes **Lock start/end to landmark**, **Show attachment rings**,
**Segments**, **Stiffness**, **Viscosity**, and **Appearance** per cable. Free ends
start at the chosen landmark and then simulate independently; releasing both
ends lets the entire rope fall. Free ropes skip the pre-roll used to settle pinned
ropes, so they do not begin already fallen. Stiffness adds bending resistance;
viscosity adds fluid-like velocity drag independently of gravity and damping.
**Flat line** removes body shading, outline, decorative drop shadows, and connector rings. Optional face-received shadows remain available. Shaded mode
can hide rings separately without releasing attachments. All changes apply on
**Bake cables**. Higher segment counts increase bake cost and stored data; the
existing bake budget still applies. The source video remains a 2D layer, without face collision or depth occlusion. Version-1 bakes remain readable; new variable-resolution
bakes use version 2 with per-cable offsets.

**Wind toward camera** adds a uniform force along the simulated Z axis: positive
values push free segments toward the viewer; negative values push them back;
zero disables the force. **Wind gusts** varies that force deterministically over
time. Anchors remain on the tracked image plane, while distance and bending
constraints operate in XYZ. Viscosity damps all three axes. A fixed virtual
camera projects displaced points and their thickness back onto the video, in
both flat and shaded modes. Beyond Z=1, perspective smoothly approaches a 4x
magnification limit, so strong wind cannot hide a whole rope or its branches at
the camera plane. Segment constraints apply tension only: slack segments do not
push each other apart into artificial zigzags during length animation.
This is a cable depth effect, not a reconstructed face
mesh or an independently editable scene camera; cables do not occlude each other
by depth or pass behind the face. Re-bake to apply changes. Version-3 bakes retain
per-point perspective thickness, while versions 1 and 2 remain supported.

**Shared wind & face collision** controls the entire network. Enable Shared wind
to replace individual cable wind with one keyframeable strength, direction,
elevation, and gust envelope. Direction 0° blows toward the camera, 90° to the
right, and 180° back into the face. Elevation tilts the force up/down. Existing
per-cable wind settings and animation are retained for when shared wind is off.
The numeric rows and diamonds use the same Transform inspector controls.

**Collide with tracked face** derives relative depth from the existing MediaPipe
landmarks, scales it with the clip, and builds a 96×96 front-surface contact map
from its triangle mesh each simulated frame. Attachments stay on their original
landmark pixels through inverse perspective. Free nodes are kept in front of
the surface, with inward velocity removed and tangential friction applied.
This is an approximate 2.5D face-front collider, not metric head geometry: it
does not collide with the back of the head or other cables, and sparse segments
can still cross small surface details. It does not use the AI Depth Map video
and does not add shadows. Both options default off for older projects. Bake
persists their motion for playback/export; paused draft preview uses them too.
Additional anchors include forehead, nose bridge, both cheeks and brows. Baked cables receive clip-local frame time through the shared effect evaluator, including export and nested compositions; exporting does not require live tracking or an open Effects panel.

**Light & face shadows** adds a directional light with horizontal/vertical angles,
shadow strength and distance-dependent softness. Enable **Cast shadows on face**
to project simulated cable points onto a 128×128 light-space depth map of the
tracked face mesh. Rays missing the mesh or starting behind its front surface
produce no shadow. Shadows darken the source image before all cables are drawn,
including Flat line cables. This first receiver uses relative landmark depth,
not the separate AI Depth Map video: it covers the front face, not hair, neck,
background or other cables. The bounded 25-point shadow path per cable and mesh
silhouette are approximate; small features and penumbrae near the edge can differ
from a full 3D renderer. Light settings currently have no animation diamonds.
Paused parameter changes refresh the draft; **Bake cables** stores source-UV
shadow hits in portable version-4 cable data for playback, export and nested
compositions. Older version-1/2/3 bakes remain readable and unchanged until rebaked.

**Native 3D scene** replaces the screen-space cable renderer after **Bake cables**.
It stores raw XYZ motion plus a textured 468-vertex face receiver in a separate,
compressed project artifact and promotes the video clip into the shared native
scene. Camera clips and scene navigation change the perspective of the face,
video background and eight-sided cable tubes together. Point and panel light
clips illuminate shaded cables and update 2048-pixel shadow maps every rendered
frame; enable **Cast shadows** on the light itself. Up to four direct lights are
supported by the cable pass. Flat line style uses unlit tubes that still cast
shadows. Clip transforms and light/camera keyframes are evaluated by the shared
scene path in preview and export; changing lighting does not rebake physics.
Bake from a frontal, unparented video without crop or 3D tilt. The captured face
is a front-surface estimate, not a reconstructed head. By default the rest of the
video stays a flat sheet with the face region cut out. Enable **Scene depth >
Depth for the rest of the image** to estimate hair, neck, body and background
depth with Depth Anything V2 Small during **Bake cables**. The first bake downloads
the verified 99 MB model; source pixels stay on the device. **Depth strength**
controls the relative relief outside the face. MediaPipe still supplies the face
and cable anchors. The surrounding mesh is welded to the exact face boundary,
with a soft transition into the estimated depth. Faces may cross the image edges:
the surrounding surface and face texture are clipped at the source boundary.
Missing detections use a full-image depth surface.

Depth inference follows source timestamps, including speed and reverse, and runs
sequentially at Fast quality. This is an offline bake, not full-framerate live ML.
Version-2 scene artifacts store a bounded depth grid (48 cells on the long edge)
with every baked frame; preview, scrubbing and export use the same saved geometry
without inference. Existing version-1 scenes remain readable. Cancel, inference
errors or changes to the clip during baking preserve the previous result.
Camera and light movement remains live after baking. The depth surface receives
cable shadows and can occlude cables. **Collide with scene depth** is enabled by
default when scene depth is active. It builds a 192×192 front-surface contact map
from the same welded, clipped mesh used for rendering, transformed back into
the cable simulation's coordinates. Free cable nodes collide with hair, body and
background with radius clearance, inward-velocity removal and friction.
**Collide with tracked face** remains independent and uses MediaPipe inside the
face. Locked anchors remain pinned. This is a sampled front-surface collider,
not volumetric collision; thin details and long segments can still be crossed.

**Rebake physics** reuses the depth already saved in the scene artifact while
simulating new cable settings and collisions. No model inference or download is
required. It validates frame timing, source/transform/depth settings and every
tracked face pose before committing. Older depth artifacts are checked against
their saved geometry. Use **Bake cables** for fresh estimation after changing
the source, timing, tracking or depth strength. Both the compressed depth and
the resulting cable motion are stored in normal project effect data; saving and
reopening the project preserves them without the model cache.
Relative monocular depth is a 2.5D estimate: large view changes can reveal stretched
textures and missing unseen surfaces. It does not reconstruct the back of the head.
Cable/face geometry shares scene depth with other objects;
shadow maps currently contain cable casters only, not unrelated meshes or splats.
Playback builds cable rings into preallocated typed buffers and samples each
spline center once. Depth stitching evaluates the winning boundary correction
once per vertex. These changes preserve baked positions, topology and shading;
they do not reduce subdivisions or simulation quality. Expanded timeline rows
share effect interpolation for the same clip/time, and cable property readers
reuse decoded settings until those settings change.
The approximate face receives shadows without casting scan-triangle self-shadows;
eye and mouth openings are capped with the captured video. The inspector can add
normal scene light and camera clips directly, with a camera matched to the bake.
Panel diameter controls bounded shadow filtering rather than a physical area-light
integral. Environment-map illumination is not sampled by this receiver pass.
Image effects before Face Cables process the source texture. Effects after it
process the rendered image when this is the only visible 3D object; adding lights
does not suppress those effects. Use a nested composition for post effects on a
scene with several visible 3D objects. Physics edits still need Bake; camera/light movement is live.

The Face Cables inspector uses the same collapsible sections and aligned rows as Transform, grouped into Connections, Physics, Wind and Appearance. Numeric rows combine a handle-only slider, bordered editable field and reset button through reusable `ResolveInspectorNumberRow`. Section disclosure and sliders support keyboard navigation; pointer activation clears transient focus.

Cable numeric parameters reuse the same **LabeledValue / EditableDraggableNumber**
controls as Transform: horizontal drag, double-click to type, right-click reset,
and middle-click range preferences. Segment counts snap to whole numbers.
The initial Z-wind slider range is -30 to +30 and can be customized; positive strength pushes toward the camera.


### Face Cables nodes

**Open clip nodes** shows the effect as a colored group on the common clip canvas.
Collapse it to one effect node or expand tracking, depth, collision, force,
simulation and rendering operators. Node parameters and the effect form share
canonical settings and keyframes. Added Wind/Gravity/Drag nodes feed the solver;
Value/Oscillator nodes can drive wind strength. Layout, group state and graph
connections are saved in project data; existing bakes remain intact until a new
bake succeeds. See [Node Workspace](./Node-Workspace.md).

### Face Cables live frame preview

With **Live frame preview** enabled (default), editing cable settings while paused
updates the current frame after an 80 ms input debounce. This is a bounded
one-second simulation at the current tracked pose, using the current anchor
distance for rope length. It approximates the shape; it does not reproduce prior
motion, the full-clip maximum rope length, or the eventual bake exactly.
Free endpoints show one second of motion from their initial anchors.

Draft geometry exists only in a temporary runtime map for this clip, effect and
frame. Playback and export use saved baked geometry. Disabling preview, leaving
the controls, starting a bake or changing frames clears the temporary override.
Scrubbing while paused calculates a new approximation. Missing tracking yields
no cable at that frame. **Bake cables** still commits the complete motion and
settings to the project; preview edits alone are not saved.

The inspector does not subscribe to playhead ticks when preview is inactive or
playback/export is running. Draft updates invalidate only layer/composite render
caches; media, RAM-preview and video-bake caches remain intact. Clearing a draft
requests a render only when an override actually existed.

Face Cables range settings are shared by the numeric field, slider and reset
action. Middle-click a number to change its minimum, maximum and default.
Length factor, wind strength, gravity, damping and thickness have editable upper
ranges, including values above their initial slider maximum; these values are
accepted by preview, saved bakes and project reload. Positive physical minima,
4-96 segments and normalized 0-1 stiffness/viscosity/gusts remain constrained.
Very long cables can extend outside the frame or cross the virtual camera near
plane (in which case the rope is hidden); lowering camera-directed wind can help.

### Cable midpoint branches

**Branch to right ear** creates another cable starting at the selected cable's
simulated material midpoint and ending at **Right ear area (approx.)**. The From
dropdown can also select another cable's midpoint. Branches can themselves have
branches; cycles, missing parents and duplicate IDs are rejected. A cable with
children cannot be removed until those children are removed or reconnected.

Simulation runs parent-first, retaining XYZ movement at the attachment in both
draft preview and baked frames. The branch follows the parent without applying
reaction forces back to it. Its rest length is initialized from its first valid
attachment distance times Length factor; the usual constraints allow stretching
when both anchors become farther apart. Unlock start releases the branch from
the parent. Missing or hidden parent geometry hides its branches as well.

Ear-area anchors use face-edge landmarks 234 (right) and 454 (left), not an
independent ear detector. Right/left refers to the subject's own side.


### Independent cable animation

The visible **Cable 1**, **Cable 2 (branch)** buttons select independent cable
settings. Selection remains on that cable after baking. Each cable supports
native timeline keyframes for length factor, stiffness, gravity, damping,
viscosity, wind toward camera, gusts and thickness. Click the diamond beside a
parameter to add a key at the playhead; subsequent edits to an animated parameter
add or update its key there. Right-click its diamond to remove that parameter's
animation and retain its current value. Timeline labels identify the cable.

The paused frame preview samples these keys at the playhead. **Bake cables**
evaluates them throughout the simulation for playback and export. Segment count,
connections, attachment locks, color and rendering style remain static settings.

Bypassing an effect automatically collapses its inspector entry and node group. Re-enabling keeps it collapsed; it can still be expanded manually. Adding effects from the Effects panel also updates the connected node layout.

### Lens Correction

**Lens Correction** appears under **Lens & Distort** and works on photos and
video, including imported Canon CR2 images. Its collapsible inspector uses the
shared slider, numeric entry, reset, and keyframe controls.

The **Lens profile** dropdown starts in **Manual**. The first measured profile is
**Canon EF 24–105mm f/4L IS USM** (the original EF lens, not the II or RF variants).
Selecting it copies focal length and aperture from imported CR2 metadata when
available. The inspector also displays the detected lens. Set these values
manually for other media. Sensor Crop defaults to 1 for full-frame EOS cameras;
use 1.6 for Canon APS-C. Focus Distance defaults to 1000 m (approximately infinity)
because dependable focus-distance metadata is not available.

Profile corrections use the bundled Lensfun full-frame PTLens distortion,
poly3 lateral chromatic-aberration, and PA vignetting calibrations. Coefficients
are linearly interpolated across focal length and aperture, and inverse focus
distance; endpoints are clamped. Vignette compensation operates in linear sRGB.
This is an independent implementation using measured Lensfun data, not Adobe
Camera Raw/LCP compatibility or a claim of matching Photoshop's output. Profile
selection and numeric settings persist in project data and participate in undo;
numeric controls support keyframes. Manual adjustments below are added on top.

- **Geometry:** Remove Distortion controls radial barrel/pincushion correction;
  negative values sample inward to correct barrel distortion, positive values
  correct pincushion distortion. Fine Distortion adds a fourth-order adjustment.
  Scale zooms to crop uncovered borders; Optical Center X/Y moves the lens center.
- **Chromatic aberration:** Red/Cyan Fringe and Blue/Yellow Fringe independently
  scale the red and blue channels around the optical center.
- **Vignette:** Positive Amount lifts dark corners, negative Amount darkens them;
  Midpoint controls where the falloff starts.

The default is an identity transform. Uncovered borders are transparent, and
corrections are nondestructive, saved with the effect, and applied during export.
Barrel correction strong enough to fold the outer picture back on itself (Remove
Distortion below about −33, Fine Distortion below about −20, or less together with
a profile) stops at the fold: pixels beyond it stay transparent, and the inspector
and tool results say so. The fringe channels repeat the border pixel instead of
turning black, so no coloured line runs along the frame.
Selecting a profile is explicit; automatic matching and other lens variants are
not included yet. Calibration provenance and its CC BY-SA 3.0 license are listed
in [Third-party notices](../../THIRD_PARTY_NOTICES.md#lensfun-lens-calibration-data).

The **Vignette** section of Lens Correction has its own enable switch. Bypassing
it disables both calibrated profile vignetting and manual Vignette Amount while
retaining their settings. Distortion and chromatic-aberration correction continue
unchanged. This applies equally to Preview, guide photos, AI Edge Fill captures and export.

Under **Geometry → Framing**, **Fit entire photo** automatically fits the corrected
source perimeter into the image texture instead of cropping it. Free areas remain
transparent (black against an opaque viewer/export background), and the composition
dimensions stay unchanged. The existing manual Scale setting is retained for
**Original size**; automatic fitting caps it so increasing Scale cannot crop the photo.
The fit follows distortion, focal length, sensor crop and optical center adjustments.

### Guided Perspective

**Guided Perspective**, under **Lens & Distort**, corrects converging lines caused
by camera perspective. Add it after **Lens Correction**, then choose **Edit guides**.
The guide editor opens directly in Preview. It includes preceding enabled Lens
Correction effects and preserves the clip's 2D position, scale, anchor and rotation,
so guides stay aligned with the optically corrected photo. The guide photo is shown
before perspective correction; later effects are hidden while drawing.

Only **Vertical**, **Horizontal**, **Apply**, **Cancel** and **Clear guides** are
added to the existing playback bar. The Preview keeps its normal layout and view
controls. Use the existing wheel, trackpad or two-finger pinch to zoom around the
pointer. Hold Alt or Space and drag, or use the middle mouse button to pan. The
Preview's existing Fit view action resets zoom and pan without changing clip transforms.

Select **Vertical** and draw at least two guides along different parallel edges
that should be vertical, or choose **Horizontal** for horizontal scene edges.
Both direction buttons are directly visible and show their guide counts. Use up
to eight guides per direction; a homogeneous least-squares vanishing-point fit
combines all lines in each group. Use parallel edges from one scene direction,
not unrelated edges from different walls. Drag a whole guide or its endpoint handles to refine
the lines; focused endpoints also move with arrow keys, with Shift for larger
steps. Right-click a line or endpoint to remove that guide directly. Delete or
Backspace removes the selected guide; Clear guides removes all draft lines. Apply
commits one undoable change; Cancel or Escape leaves the effect unchanged. Switching
the selected clip or composition cancels the draft session.

The effect derives a projective transform from the guide vanishing points and fits
the entire photo with uniform scale. **Scale** can crop transparent borders;
**Strength** blends the transform back toward the original geometry, so lines stay
straight at any Strength (saved projects with Strength below 100 render this
corrected blend). Both support keyframes. Slanted borders get a one-pixel soft edge;
out-of-range Scale, Strength or matrix values are clamped and reported.
Guides and correction persist in the project and render during export. Duplicate,
short, incomplete, and unstable guide pairs are rejected with an explanation.
Drawing guides currently supports still images, including CR2. The guide photo
does not include other preceding geometry effects, so place this effect directly
after Lens Correction. Perspective correction does not remove curved lens
distortion or independently straighten several surfaces with different planes.

### AI Edge Fill

**AI Edge Fill**, under **Lens & Distort**, fills transparent borders left by
Lens Correction and Guided Perspective on still images, including CR2. Place it
after those corrections and before other effects. Choose a generation size,
adjust the editable prompt for the scene, and click **Generate fill**.

Generation uploads a bounded, positioned full-composition photo reference and a
white=missing binary mask to **Kie.ai / Nano Banana
Pro**, using the existing hosted AI service and cloud credits. It is not a local
model. The reference marks missing areas magenta; opaque black content in
the actual photograph remains protected. The editable prompt explains both references.

Only transparent pixels use the generated image. Existing opaque pixels retain
their original resolution and color, even if the model changes them in its output.
**Fill Opacity** controls the added areas and supports keyframes.
**Seam Blend** (default 12 composition pixels) softly matches the neighboring
original color on the added side only, supports keyframes, and can be set to zero.
It reduces color seams, not arbitrary structural mistakes made by the model.
Generations are
1K, 2K or 4K; the saved fill is sampled at the composition/export resolution,
so a larger original photo is supported without promising native generated detail
at an unlimited resolution. Outputs that change the aspect ratio are rejected.

The PNG is stored as a required project artifact. Rendering, playback and export
reuse it without provider calls. Clear fill is undoable. A changed correction
shows a regeneration warning; animated upstream geometry/placement and other preceding
effects/operator graphs are rejected when generating. Captured 2D position,
scale, rotation, source-pixel scale and aspect fit match the compositor. The
effect expands its render footprint to the whole composition without changing
authored transforms, so outer margins are filled too. Bypass restores the normal
photo footprint. Generate before masks/color grading; tilted 3D planes and an
enabled composition camera are not supported. Scene reconstruction remains
probabilistic: the mask reference guides the model, rather than a native inpaint API.

A submitted request retains its idempotency key; a started task retains its task
ID. **Resume task** retries polling/download without submitting a new generation.
Pending jobs are checkpointed in the original repository and results cannot be
applied after a source, correction or project switch. **Discard pending task**
allows a fresh request; it does not cancel/refund an already started provider job.

## Effect group notes

What applies to a whole effect group, for developers; each group overview links here. Each effect page adds its own notes.

### Color & Tone notes

Recipes: `src/services/operators/colorEffectGraphs.ts` (tuning in `COLOR_RECIPE`; Posterize and
Threshold in `pointwiseEffectGraphs.ts`). Formulas:
[Effect system: editable color effect graphs](./Effect-System.md#editable-color-effect-graphs);
blocks: [Node Catalog](./Node-Catalog.md); graph contract:
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Range.** The effect chain carries 8-bit, display-referred colour; the recipes limit their input
  to 0–1, so there is no HDR headroom between effects.
- **Beyond the slider.** In the number field you can type past the end of a slider, up to what the
  effect can show (each page names its range). If a keyframe, a node or the AI agent goes further,
  the effect uses the limit, and the inspector, `addEffect`/`updateEffect` warnings and
  `listEffects` (`renderRange`) report it.
- **Performance.** All recipes are per-pixel math without extra texture reads. A single colour
  effect runs inside the composite pass; in a stack each one is its own pass. The worker software
  render modes evaluate the same graphs on the CPU, once per distinct colour of the frame (about
  0.2–0.4 s for a 1080p photo); a layer that mixes them with the retired `blur` effect is skipped and
  reported (`unsupported-effects`).
- **Saved projects.** Brightness, Contrast, Exposure, Levels, Saturation, Vibrance, Temperature and
  Hue Shift keep the graph they were saved with, so projects from before the 2026-10 rebuild look as
  before (`legacyColorEffectGraphs.ts`); add the effect again for the current look. One bug fix
  changes saved looks: a Contrast saved with the 2026-10 recipe flattens below Amount 1 instead of
  blowing up shadow noise; from 1 up it is unchanged. A colour effect
  saved before effect graphs existed loads with the original graph; new effects get the recipe graph
  when they are added, also on adjustment layers, where an agent's `configure` keeps the graph of
  every effect it keeps.
- **Looks.** Custom Looks saved before the 2026-10 rebuild apply their colour effects with the
  original graphs; new Looks store each colour effect's graph (Look schema 2). A stored Look graph is
  validated when the Look is applied; one that no longer validates renders the current recipe, with a
  notice. To move an old Look to the new math, rebuild it from freshly added effects and save it
  again.
- **Known gaps.** Adjustment layers in the optional worker GPU render modes still use the older 4×5
  colour matrix for Brightness, Contrast and Saturation; the `WorkerGpuAdjustment` log, and the
  adjustment inspector while such a mode is selected, name each effect that looks different there
  (`adjustment-color-recipe-unsupported`).

### Blur & Sharpen notes

The contract lives in `src/effects/blur/blurSampling.ts`; formulas and history in
[Effect system: editable blur kernels](./Effect-System.md#editable-blur-kernels), nodes in
[Node Catalog](./Node-Catalog.md), compilation in [Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** Radius is in pixels of a 1080p frame (its shorter side) and scales with the rendered
  size, so preview, export and 4K match; 3D layer-space effects count their layer's own resolution.
  Motion, Radial and Zoom are relative to the frame.
- **Premultiplied source.** The frame is premultiplied into an `rgba16float` cache first; every
  filtered read after that is exact at alpha edges. The GPU preview and the export show the same
  blur.
- **Read budgets.** Gaussian and Box read up to 127 merged pairs per side and pass; Motion, Radial
  and Zoom up to 256 (Stage A) and 64 (Stage B) reads per pixel. Beyond that the reads spread out,
  and the inspector and the tool result say so.
- **Zero strength.** An unedited blur at 0 is skipped, so the picture passes through exactly; an
  edited graph always runs.
- **Saved projects.** Untouched old blur graphs upgrade automatically; edited graphs stay as saved.
  Saved projects render with the current kernels. Radius follows the frame size, so a 4K project
  blurs twice as many pixels as a 1080p one.
- **Software preview.** The worker software preview approximates: Gaussian and Box as a canvas
  blur, Motion, Radial and Zoom with up to 64 evenly spaced reads (longer streaks step; the
  `SoftwareBlur` log says so).

### Light & Stylize notes

Formulas and history: [Effect system: editable color effect graphs](./Effect-System.md#editable-color-effect-graphs)
(Vignette, and Film Grain, Scanlines, Posterize, Threshold),
[Effect system: editable blur kernels](./Effect-System.md#editable-blur-kernels) (Glow, Edge Detect,
Sharpen) and [Effect system: glyph, cell and compute effects](./Effect-System.md#glyph-cell-and-compute-effects)
(Acuarela); nodes in [Node Catalog](./Node-Catalog.md#composed-coordinate-nodes), compilation in
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** Glow Radius, Edge Detect Width and Acuarela's Wash and Bleed are in pixels of a 1080p
  frame (its shorter side) and scale with the rendered size, so preview, export and 4K match.
- **Out-of-range values.** Tool results and the inspector list every value that is clamped or
  ignored (`paramWarnings`), instead of failing silently. The notes describe the current recipes; an
  effect that still runs an earlier one gets a single note naming that version instead, and an
  edited graph gets them as one hedged note (its own nodes decide). A note function that fails is
  logged and reported.
- **Saved projects.** Glow, Vignette, Edge Detect (and Film Grain, Scanlines and Sharpen) saved
  before 2026-10-21 keep their earlier graph and folders (`stylizeRecipes.ts`); the card offers
  **Use the new …**, which for Glow and Vignette also resets the values and removes their keyframes,
  in one undo step. Custom Looks record `recipe: 'earlier'` for such effects (Looks saved before are
  migrated), so applying them recreates the earlier graph.
- **Transitions** build their effects without a graph at render time, so they use the current
  recipes: Vignette Bloom is retuned (Glow Radius 60–240; Vignette Roundness 0 with Size and
  Softness ÷ √2 for the same falloff; Glow Amount 0.1–1.4 for the bloom's ramp to white).
- **Software preview.** The worker software renderer (the Linux fallback) evaluates effects that
  carry a graph on the CPU, which is slow at large sizes (the Glow pyramid most of all). Graphless
  ones, as transitions create them, use dedicated pixel paths (`workerSoftwareBloom.ts` for Glow).
  Rom1 runs on the CPU; the watercolour Acuarela falls back to the main-thread GPU renderer.

### Generate notes

Notes for developers. Registry, uniforms and the byte-texture binding are in
[Effect system](./Effect-System.md#registry-and-ui), nodes in [Node Catalog](./Node-Catalog.md), graph
compilation in [Operator Graph Compiler](./Operator-Graph-Compiler.md). Shared helpers for finite
reads and choice warnings live in `src/effects/generate/generatorParams.ts`.

- **Robust values.** Numbers are read as finite values (NaN and infinities use the default). Values
  outside a parameter's rendered range (`renderMin`/`renderMax`) are named in the inspector, in the
  units of its row, and in `addEffect`/`updateEffect` results, in stored units; `paramWarnings` name
  unknown choices and settings that draw nothing. The coverage and compositing maths of the grid,
  wheel and ring head run on the CPU in unit tests, translated from the WGSL source.
- **Keyframed rates.** Perspective Grid Speed and Color Wheel Spin declare `integratedAs`. The
  timeline and the composition evaluator (nested compositions, transitions, export) share one
  keyframe step (`evaluateEffectKeyframes`) that adds the distance a keyed rate has travelled: the
  area under the curve from the start of the render clock (−clip start in clip time) to now, with the
  first key's value held before it. It equals rate × time while the rate is constant, adding the
  first key does not move the pattern, and a head trim (keys stay on the timeline, at negative clip
  times) keeps the phase of a keyed ramp. Unkeyed, the rate runs from the timeline (or composition)
  time. The step evaluates the clip's own keyframe array, so the property index and a table of
  cumulative segment integrals are built once per edit: a frame binary-searches its segment and
  integrates only that part (O(log K), about 1 µs for 1000 keys). Two keys at one time are a jump.
  Effects without keys keep their identity. The travel values are runtime-only: project,
  composition, preset and undo-history loads drop stored ones, tools and Looks do not store them, and
  an instance that still carries one renders without it (one log line). A node source or the
  Constant mode on a rate runs it at rate × time and logs which of the two overrides the keys. Scroll
  and hue are wrapped on the CPU in double precision.
- **Saved projects.** Choices and numbers an old instance lacks render, and show in the inspector, at
  their `legacyDefault` (each effect page names them). A Look saved from such an instance stores these
  values, and custom Looks saved earlier without them apply and preview with them too; built-in Looks
  use the current defaults. New defaults apply only to new instances.

### Lens & Distort notes

Notes for developers; each effect page adds its own formula and limits.

- **Units.** Shape Circle measures offsets and Radius in units of the shorter frame side (0.5 = half
  of it), so circles stay round and match at every resolution; Stretch to Frame measures each axis
  in its own 0–1 range. Angles are stored in radians and shown in degrees; keyframe lanes, MIDI and
  tools use radians.
- **Sampling.** The frame is premultiplied into an `rgba16float` cache, read with one bilinear sample
  at the read position (Kaleidoscope: two, crossfaded) and unpremultiplied, so transparent edges keep
  their colour without a dark rim. Transparent frame edges fade over one source pixel by lowering
  alpha only. One sample per pixel means very strong settings shimmer on fine detail.
- **Neutral settings** (Bulge & Pinch Amount 1, Twist 0, both Wave heights 0, RGB Split Amount 0,
  Mirror with both axes off) skip the built-in recipe, so the picture passes through exactly.
- **Software preview and export.** Without WebGPU (software preview, worker-first export readback)
  the untouched recipes run as a hand-written pass with the same mapping, frame edges and
  premultiplied read, within 1/255 of the graph; edited graphs run through the graph interpreter.
- **Warnings.** Clamped or degenerate values (Radius ≤ 0, negative Amount, unknown Shape or Frame
  Edges choices, out-of-range Fisheye values, Lens Correction folding at the active composition size,
  Guided Perspective limits) appear below the effect in the inspector, judged on the values at the
  playhead, and in the `addEffect` / `updateEffect` tool results.
- **Code.** The recipes live in `src/services/operators/uvDistortRecipes.ts` and
  `mirrorRecipes.ts`. More: [Effect system: editable UV distortions](./Effect-System.md#editable-uv-distortions),
  [editable mirror, split and pixel graphs](./Effect-System.md#editable-mirror-split-and-pixel-graphs),
  [Node Catalog](./Node-Catalog.md) and [Operator Graph Compiler](./Operator-Graph-Compiler.md).

### Pixel & Mosaic notes

Notes for developers on Pixelate, Blockify and Block Mosaic; each effect page adds its own limits.

- **Cell grid.** Pixel Size, Block Size, Tile Size and Grout Width are pixels of a 1080p frame,
  rounded to whole rendered pixels, so preview, export and 4K show the same blocks relative to the
  picture. The grid is anchored at the frame centre: cells grow and shrink about the middle when the
  size is animated, and cells at the frame edges are cut by the frame.
- **Average.** A cached row average and a column average are exact up to 128 rendered pixels per
  cell; larger cells average 64 evenly spread pairs of pixels per row and column.
- **Transparency.** The average reads a premultiplied `rgba16float` copy of the frame and is
  unpremultiplied, so transparent pixels never darken a cell.
- **Software preview and export.** Without WebGPU, Pixelate runs as a hand-written pass that averages
  every cell exactly, within 1/255 of the graph; Blockify, Block Mosaic and edited graphs run
  through the graph interpreter, which is slower.
- **Code.** The recipes live in `src/services/operators/cellGridRecipes.ts`. More:
  [Effect system: editable mirror, split and pixel graphs](./Effect-System.md#editable-mirror-split-and-pixel-graphs),
  [Node Catalog](./Node-Catalog.md) and [Operator Graph Compiler](./Operator-Graph-Compiler.md).

### Analog & Glitch notes

- **Time.** The effects follow timeline time: the preview, scrubbing and the export match, and Speed 0 freezes them.
- **Hash keys.** Every key the recipes hash is an exact integer below 2^24 (the seed and the cycle fold into 509 keys by integer modulo, each kind of roll adds its own integer salt, grain frames move the keys by 16384 rows), so neighbouring cells share bit-identical keys and the GPU and the worker software path hash the same bits (`tests/unit/analogHashKeys.test.ts`). The older sine hash stays unchanged for other effects.
- **Values.** Values outside a control's range are clamped and reported in the inspector and in agent tool results.
- **Stage folders** are presentation only (`effectPresentationPlans.ts`) and appear on the untouched recipe; a graph with your own folders keeps them. A folded plain folder offers only the outputs that are used; a composition keeps every output it declares.
- **Saved projects.** Effects and custom Looks saved before the 2026-10 rebuild of CRT Screen, Glitch, Film Prism, Holo and Ribbon Scan keep their original graphs (`legacyCrtScreenGraph.ts`, `legacyGlitchGraph.ts`, `legacyFilmPrismGraph.ts`, `legacyHoloGraph.ts`, `legacyRibbonScanGraph.ts`, pinned by `analogLegacyGraphs.ts`), in Look thumbnails too, without the new recipes' own controls; add the effect again for the new version.
- **Experimental.** Crystal Glass, Glass Dispersion and Pixel Sort carry an `experimental` note on their definition: the effect list adds "(Experimental)", and the inspector and the `listEffects`/`addEffect` tool results give the reason.
- **Source.** The recipes live in `src/services/operators/crtScreenRecipe.ts`, `glitchRecipe.ts`, `filmPrismRecipe.ts`, `holoRecipe.ts` and `ribbonScanRecipe.ts` (shared helpers in `analogRecipeBuilder.ts`); compilation: [Operator Graph Compiler](./Operator-Graph-Compiler.md), random nodes: [Node Catalog](./Node-Catalog.md#random-nodes).

### Keying & Time notes

- **Source.** Time Stack and Slit Scan need a video clip, not a still image or a nested composition. The past comes from the original video's own timestamps (trims, speed changes and reverse clips included), not from earlier playback, through one shared source-frame service.
- **Loading.** The first load of the frame window takes a moment; the preview shows the plain clip or the last complete picture meanwhile, and the export waits for the exact frames.
- **Memory.** Each of them keeps its frames in a GPU budget of its own (Time Stack: Frame cache; Slit Scan: History memory).
- **Motion Trails.** A feedback shader of its own (`src/effects/time/kinetic-trace/`), registered with the tracking family for landmark data. Each frame keeps Length ÷ Amount (at most 1) of its last output, so the visible trail keeps Length per frame; Tint recolours the trail by brightness, not per channel, so a tinted trail cannot feed on itself. Saved instances without Length render with the old fixed 0.9 per frame; the subject glow needs tracking data (it no longer sits at the frame centre without it).
- **More.** Keyer internals: [Effect system: editable keying and feedback graphs](./Effect-System.md#editable-keying-and-feedback-graphs); Slit Scan notes: [Effect system: Slit Scan](./Effect-System.md#slit-scan); compilation: [Operator Graph Compiler](./Operator-Graph-Compiler.md).

## Notes

- The empty `time` and `transition` categories are present in the type system without changing the registry shape.

## Related Docs

- [Using effects](./Effects.md)
- [Effect catalog](./effects/index.md)
- [Node Catalog](./Node-Catalog.md)
- [Masks](./Masks.md)
- [Text Clips](./Text-Clips.md)
- [Keyframes](./Keyframes.md)
