# MasterSelects Motion Design System Plan

Status: implementation plan
Date: 2026-05-02
Related research: `docs/research/plate-motion-design-integration.md`

## Goal

Build a MasterSelects-native motion design system inspired by Plate's public product surface, but integrated into our existing timeline, WebGPU renderer, project persistence, export pipeline, AI tools, and media runtime.

This is not a plan to embed Plate or copy its code. The target is a stronger native system:

- shape layers and appearance stacks
- null and adjustment layers
- a registry-driven Properties panel
- global graph editor and viewport motion paths
- GPU-instanced replicators with modifiers and falloffs
- texture fills with independent time remap
- preview/export parity through the existing WebGPU path

The important design constraint: motion graphics must become first-class MasterSelects timeline content, not a separate mini-app bolted onto the editor.

## Product Principles

1. One timeline remains the source of truth.
2. Every authorable property should be discoverable, searchable, pinnable, keyframeable where valid, and addressable by AI tools.
3. Preview, nested composition render, thumbnails, RAM preview, and export must use the same evaluated frame model.
4. Procedural systems must compile to GPU work, not expanded React/UI objects.
5. The UI should feel like a dense editor, not a landing page or toy demo.
6. The first implementation should be small enough to ship, but shaped so replicators and modifiers fit without rewrites.

## Product Differentiators To Include

These are small additions beyond Plate parity that fit naturally into the architecture and should be designed in from the start.

| Idea | What it does | First phase |
|---|---|---|
| Property and stack presets | Save/reapply appearance stacks, shape settings, and replicator setups | Phase 2 for appearance, Phase 5 for replicators |
| Quick actions | Context-menu commands like Add Null Parent, Add Replicator, Convert Solid to Shape, Bake Replicator to Comp | Phase 2 onward |
| Property favorites | User/project-level favorite properties in addition to per-clip pinned lanes | Phase 3 |
| Light expressions | Simple deterministic formulas such as `time * 30`, `sin(time)`, `index / count`; not full AE expressions | After Phase 5 |
| Random seed lock | Explicit seed controls for every random/noise modifier so preview/export stay identical | Phase 6 |
| Solo property lanes | Graph editor can isolate only selected/favorited properties | Phase 3 |
| Motion templates | Reusable `.msmotion` presets for lower thirds, title cards, logo reveals, kinetic text, and loops | After Phase 2 |
| Viewport onion skin | Show previous/next sampled positions on motion paths | Phase 4 |
| Bake preview cache | Freeze a heavy motion clip/replicator to a temporary RAM/GPU cache for smoother editing | After Phase 5 |

These should remain lightweight and deterministic. Anything that introduces nondeterministic render output, hidden state, or a separate cache-only truth source should be rejected or redesigned.

## Non-Goals

- Do not integrate Plate as a runtime dependency.
- Do not copy Plate's minified bundle, assets, icons, or exact UI.
- Do not duplicate thousands of timeline clips for repeated shapes.
- Do not route shape rendering through Canvas2D in the hot path.
- Do not implement adjustment layers before compositor ordering is ready.
- Do not invent a parallel timeline/keyframe store.

## Current MasterSelects Foundation

Already present and useful:

- `TimelineClip`, `TimelineTrack`, `ClipTransform`, `AnimatableProperty`, and per-clip `clipKeyframes`.
- Transform/effect/color/mask/vector keyframes.
- Per-property curve editor and Bezier interpolation.
- `parentClipId` for AE-style clip parenting.
- WebGPU compositor with blend modes and effects.
- `LayerBuilderService` converting timeline clips into render layers.
- Nested composition and export layer builders.
- Project persistence and serialization.
- Text, solid, Lottie, mesh, camera, splat, and math-scene clip types.

Main gaps:

- no generic 2D shape layer
- no central property registry
- no appearance stack for shape fills/strokes/gradients/textures
- no global graph editor mode
- no viewport motion-path editing
- no null layer clip
- no adjustment layer compositor pass
- no 2D procedural replicator system

## Target Architecture

```text
TimelineClip
  -> MotionLayerDefinition
  -> PropertyRegistry descriptors
  -> evaluated MotionFrameState
  -> MotionRenderer draw packets / instance buffers
  -> existing compositor as a layer texture
  -> preview, nested render, thumbnail, RAM preview, export
```

The motion system should be additive:

- Existing media/video/image clips keep their current path.
- Motion clips produce either no texture (`null`), a render texture (`shape`), or a compositor operation (`adjustment`).
- Replicators are a property of a motion layer/group, not separate clips.

## Video and 3D Integration

The motion design system must not be isolated from video, image, text, 3D, gaussian splats, or nested comps. It should behave as another first-class layer family inside the same MasterSelects scene/timeline model.

### Integration Tiers

| Tier | Scope | Behavior |
|---|---|---|
| 1. Compositor coexistence | V1 | Motion shapes, video, images, text, Lottie, nested comps, and the synthetic shared-3D-scene texture stack together in the normal layer order with blend modes, opacity, masks, effects, and export parity. |
| 2. Cross-layer linking | V1/V2 | `motion-null` clips and existing `parentClipId` parenting can drive motion shapes, video/image planes, text clips, and 3D clips where transform-space conversion is well-defined. |
| 3. Video as motion material | Phase 7 | Image/video texture fills can live inside shape appearance stacks, with independent transform and keyframeable texture time. |
| 4. Motion as matte/falloff source | Phase 6+ | Motion shapes can serve as replicator falloff regions and later as masks/mattes for video or effects. |
| 5. Direct media replicators | Later phase | Replicators can target image clips, video clips, texture-fill sources, and nested comps without duplicating timeline clips or decoding the same source per instance. |
| 6. 3D promotion | Later phase | Motion shapes can be promoted to shared-scene 3D planes/curves, and replicators can instance 3D primitives/meshes/splats after the 2D GPU path is stable. |

### Timeline and Parenting

Motion clips are normal `TimelineClip` entries. This means they should support:

- clip movement, trimming, copying, pasting, splitting, nesting, and project serialization
- the same transform/keyframe flow as video/image/text/3D clips
- `parentClipId` linking to and from existing clip types
- null-parent workflows that can control mixed selections, such as a video clip plus a shape overlay plus a 3D title

Parenting must preserve world transforms when creating links. For mixed 2D/3D parent chains, the first implementation should be conservative:

- 2D parent -> 2D child: fully supported.
- 3D parent -> 3D child: use existing shared-scene transform behavior.
- 2D parent -> 3D child: allowed only when the operation can be mapped to screen-space transform without corrupting scene depth.
- 3D parent -> 2D child: initially blocked or treated as screen-projected follow behavior behind a feature flag.

The UI should make mixed-space cases explicit instead of silently producing surprising transforms.

### Video Texture Fills

Texture fills are the main bridge between motion design and video:

- dropping an image/video onto a motion shape creates or replaces a texture-fill appearance card
- no `texture.time` keyframes means the fill follows composition time
- keyframed `texture.time` enables freeze frames, reverse, looping, and time remap inside the shape
- texture transform controls position, scale, rotation, fit/fill/stretch/tile independently from the parent shape transform
- decoding uses the existing media runtime/WebCodecs path, not a separate video subsystem

This makes video usable as a material inside motion graphics while still preserving the normal full-layer video clip workflow.

### Direct Media Replicators

After texture fills and shape replicators are stable, add direct media replicators:

```text
image/video/nested-comp source
  -> one decoded/rendered source texture
  -> GPU instance transforms
  -> compositor output
```

This is different from duplicating clips. A replicated video source should decode once per frame time and draw many GPU instances of the same texture. The same rule applies to images and nested comps: render the source once, then instance it.

Supported targets should arrive in this order:

1. image clips
2. video clips
3. texture-fill sources inside motion shapes
4. nested composition clips
5. 3D mesh/splat targets after shared-scene integration

Direct media replicators need source-time rules:

- default: every instance samples the same source time
- optional per-instance time offset: `sourceTime + index * step`
- optional random/seeded source-time jitter
- optional ping-pong/loop behavior

These options must reuse the existing media runtime, WebCodecs, and nested-comp render cache. They must not create one decoder per instance.

### Shared 3D Scene Relationship

In V1, motion shapes render as 2D compositor layers. They can sit above or below 3D scene output just like video/images can.

Later, add explicit 3D promotion:

- `motion-shape` as textured 3D plane
- vector/shape curves as native shared-scene geometry
- replicator instances targeting mesh clips or primitive 3D shapes
- falloff/modifier fields that can operate in 3D space

Do not start with 3D replicators. First prove the 2D motion renderer, then reuse the shared-scene contract.

## Data Model

Create `src/types/motionDesign.ts`.

```ts
export type MotionLayerKind = 'shape' | 'null' | 'adjustment' | 'group';
export type ShapePrimitive = 'rectangle' | 'ellipse' | 'polygon' | 'star';

export interface MotionLayerDefinition {
  version: 1;
  kind: MotionLayerKind;
  shape?: ShapeDefinition;
  appearance?: AppearanceStack;
  replicator?: ReplicatorDefinition;
  ui?: MotionLayerUiState;
}

export interface MotionLayerUiState {
  labelColor?: string;
  locked?: boolean;
  pinnedProperties?: string[];
  propertiesSearch?: string;
}
```

Extend `TimelineSourceType`:

```ts
| 'motion-shape'
| 'motion-null'
| 'motion-adjustment'
```

Extend `TimelineClip`:

```ts
motion?: MotionLayerDefinition;
```

Extend `SerializableClip` with the same optional `motion` field.

### Shape Definition

```ts
export interface ShapeDefinition {
  primitive: ShapePrimitive;
  size: { w: number; h: number };
  cornerRadius?: number;
  polygon?: {
    points: number;
    radius: number;
    cornerRadius: number;
  };
  star?: {
    points: number;
    outerRadius: number;
    innerRadius: number;
    cornerRadius: number;
  };
}
```

V1 supports rectangle and ellipse. Polygon/star should be in the type from day one, but hidden behind UI readiness.

### Appearance Stack

```ts
export type AppearanceKind = 'color-fill' | 'stroke' | 'linear-gradient' | 'radial-gradient' | 'texture-fill';

export interface AppearanceItemBase {
  id: string;
  kind: AppearanceKind;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: BlendMode;
}

export interface ColorFillAppearance extends AppearanceItemBase {
  kind: 'color-fill';
  color: { r: number; g: number; b: number; a: number };
}

export interface StrokeAppearance extends AppearanceItemBase {
  kind: 'stroke';
  color: { r: number; g: number; b: number; a: number };
  width: number;
  alignment: 'center' | 'inside' | 'outside';
}
```

Gradient and texture fill types arrive later, but ids must exist from V1 so keyframes survive reordering.

## Property Registry

Create `src/services/properties/PropertyRegistry.ts`.

Purpose: one source of truth for labels, defaults, UI control type, keyframe behavior, search aliases, and value access.

```ts
export interface PropertyDescriptor<T = unknown> {
  path: string;
  label: string;
  group: string;
  valueType: 'number' | 'boolean' | 'color' | 'enum' | 'vector2' | 'gradient' | 'path';
  animatable: boolean;
  defaultValue: T;
  ui?: {
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    aliases?: string[];
    compact?: boolean;
  };
}
```

Phase 1 should register existing properties first:

- transform: opacity, position, scale, rotation, speed
- effects: numeric effect params via current effect registry
- color correction: color node params
- masks: numeric mask fields and mask path
- lottie/vector state/input fields

Then add motion properties:

```text
shape.size.w
shape.size.h
shape.cornerRadius
appearance.{id}.opacity
appearance.{id}.color.r
appearance.{id}.color.g
appearance.{id}.color.b
appearance.{id}.color.a
appearance.{id}.stroke.width
appearance.{id}.stroke.alignment
replicator.enabled
replicator.layout.mode
replicator.count.x
replicator.count.y
replicator.spacing.x
replicator.spacing.y
replicator.offset.position.x
replicator.offset.position.y
replicator.offset.rotation
replicator.offset.scale.x
replicator.offset.scale.y
replicator.offset.opacity
```

Implementation rule: the registry should not own Zustand state. It describes properties and provides helpers to read/write values from clips.

## UI Design

### Properties Panel

Add a registry-driven Motion tab for motion clips:

- Shape section: primitive picker, size, corner radius, polygon/star params.
- Appearance section: stacked cards for fill/stroke/gradient/texture.
- Replicator section: disabled by default, visible as a compact switch and expandable controls.

Controls:

- Color values use swatches and compact channel controls.
- Numeric values use `DraggableNumber` plus slider only where a useful bounded range exists.
- Binary values use toggles/checkboxes.
- Mode sets use dropdowns or segmented controls.
- Reorderable appearance/modifier cards use a small handle.
- Keyframe diamonds remain the same visual language as current properties.

Do not add explanatory in-app text blocks. Tooltips are enough for unfamiliar icons.

### Quick Actions

Add motion-specific context-menu commands where they reduce repetitive setup:

- Add Null Parent: creates a `motion-null` clip, parents the selected clips to it, and preserves current world transforms.
- Add Replicator: enables a default grid replicator on the selected motion shape or group.
- Convert Solid to Shape: migrates a solid clip into a rectangle `motion-shape` with matching color, duration, transform, and keyframes where possible.
- Bake Replicator to Comp: creates a nested composition snapshot of the current procedural result when the user needs explicit editable layers.
- Save Motion Template: saves selected motion clips and their keyframes as a reusable preset.

These actions must use normal store operations so undo/redo and project persistence stay correct.

### Timeline

Add property pinning and search through the registry:

- `U`: reveal all animated properties for selected clip.
- `UU`: reveal animated only.
- `P`, `S`, `R`, `O`: reveal Position, Scale, Rotation, Opacity.
- `A`: reveal Anchor once anchor exists.
- Shift-click property label in Properties panel pins/unpins the lane.

Pinned lanes are stored in `motion.ui.pinnedProperties` for motion clips and a generic clip UI state for other clips later.

### Global Graph Mode

Add a timeline mode toggle:

```ts
type TimelineCurveMode = 'bars' | 'graph';
```

In graph mode:

- bars stay visible in a compressed top band
- selected/pinned properties render as curves below
- multi-select keyframes across properties works
- existing `CurveEditor` math is reused
- no duplicate keyframe data structure is introduced
- solo property lanes can isolate selected/favorited properties without changing the underlying pin state

Keyboard target: `G` toggles graph mode.

### Viewport Motion Paths

For selected clips with `position.x/y` keyframes:

- draw the path in the preview overlay
- path vertices correspond to keyframes
- dragging a vertex updates `position.x/y`
- Bezier handles map to existing keyframe handles
- easing ticks can come after basic path handles are stable
- onion-skin samples can show previous/next positions without creating extra keyframes

Start 2D-only. Use existing preview overlay math and avoid DOM nodes per point beyond hit targets.

### Layer Rows

Add lock and label color to clips:

- lock prevents selection/move/edit but still renders
- label color affects timeline row/chip accent only
- visibility/solo stay track-level for now; per-clip visibility can be evaluated later

## Rendering Design

### MotionRenderer

Create:

```text
src/engine/motion/MotionRenderer.ts
src/engine/motion/MotionPipeline.ts
src/engine/motion/MotionBuffers.ts
src/engine/motion/MotionTypes.ts
src/engine/motion/shaders/motionShapes.wgsl
```

Responsibilities:

- initialize persistent WebGPU pipelines
- allocate/reuse per-clip render textures
- pack evaluated motion state into typed arrays
- draw appearance stack
- draw replicator instances
- return a `GPUTextureView` consumable by the existing compositor

### Shape Rendering

V1:

- render rectangle and ellipse via analytic SDF in WGSL
- support fill color, stroke color, stroke width, opacity
- anti-alias in shader using derivatives where supported
- render into transparent premultiplied texture

V2:

- polygon/star either as generated triangles or SDF approximation
- gradient fills

V3:

- arbitrary Bezier paths after a path tessellation/SDF strategy is chosen

### Buffer Strategy

Use stable typed arrays and dirty flags:

```ts
interface MotionClipGpuCache {
  clipId: string;
  version: number;
  uniformBuffer: GPUBuffer;
  appearanceBuffer: GPUBuffer;
  instanceBuffer?: GPUBuffer;
  outputTexture: GPUTexture;
  width: number;
  height: number;
  dirtyFlags: MotionDirtyFlags;
}
```

Dirty flags:

- `shape`
- `appearance`
- `transform`
- `replicator`
- `texture`
- `resolution`

Avoid creating fresh JS objects per frame for instance data.

### LayerBuilder Integration

`LayerBuilderService` should recognize motion clips:

- `motion-null`: no render layer, but remains selectable and parentable.
- `motion-shape`: create a layer with `source.type = 'motion'` or a new source discriminator.
- `motion-adjustment`: collect as an ordered compositor operation, not a regular layer texture.

Prefer adding a motion-specific layer source type rather than overloading `textCanvas`.

### Compositor Integration

For shape clips:

```text
MotionRenderer.renderClip(...)
  -> textureView
  -> regular compositor layer
```

For adjustment layers later:

```text
composite lower layers
apply adjustment effect stack to accumulated texture
continue upper layers
```

This needs a real render graph. Do not force it into the current normal layer path.

## Replicator Design

Replicator is a field on `MotionLayerDefinition`, not a clip list.

```ts
export interface ReplicatorDefinition {
  enabled: boolean;
  layout: ReplicatorLayout;
  offset: ReplicatorOffset;
  distribution?: ReplicatorDistribution;
  modifiers: ReplicatorModifier[];
  falloff?: ReplicatorFalloff;
  maxInstances?: number;
}
```

### Layouts

V1:

- grid: count x/y, spacing x/y, pattern offset
- linear: count, spacing, direction
- radial: count, radius, start angle, end angle, auto-orient

V2:

- rings, ring spacing, ring spread, ring rotation, ring angle offset
- fit/step size modes
- x/y direction flips

### Offsets

V1:

- position x/y
- rotation
- scale x/y
- opacity
- cumulative vs absolute

Offsets are computed in the vertex shader for MVP.

### Modifiers

V2/V3:

- random
- noise
- oscillator
- field

Every random/noise modifier must expose a seed. Animated seed values are allowed, but the default behavior should be locked and deterministic so scrubbing, preview, and export match.

Targets:

- transform position/rotation/scale/opacity
- shape size/radius/corner radius
- appearance color/stroke width/gradient fields

For simple modifiers, compute in shader. For stacked modifiers with target fan-out, use a compute pass that writes an instance property buffer.

### Falloffs

Falloffs reference a shape clip by id:

```ts
shapeClipId: string;
feather: number;
invert: boolean;
clip: boolean;
```

V1 falloff can be deferred. When implemented, evaluate a compact SDF field or direct primitive distance in shader. Do not render a CPU mask per frame.

### Performance Targets

Initial targets:

- 1,000 instances: no visible UI/render hit.
- 10,000 instances: interactive at preview quality on a normal WebGPU desktop.
- 100,000 instances: supported for simple shapes/layouts with adaptive preview quality.
- Media replicators: one source decode/render per unique source time, then GPU instancing. Never one decoder per instance.

If a feature cannot meet these targets, it needs a lower-quality preview mode before it ships.

## Export and Persistence

### Serialization

Update:

- `src/services/project/types/timeline.types.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/stores/timeline/serializationUtils.ts`
- tests for round-trip persistence

Motion definitions are versioned. Unknown future fields should be preserved where practical or safely ignored.

### Export

Update:

- `src/engine/export/ExportLayerBuilder.ts`
- `src/engine/export/FrameExporter.ts` only if frame readiness needs motion hooks
- thumbnail renderer path
- nested composition renderer path

Export must call `MotionRenderer` at export resolution and exact frame time. No screenshot or DOM capture fallback.

### Media Runtime for Texture Fills

Texture fills should reuse existing media source ids and runtime frame providers:

- still images become GPU textures
- videos use the current WebCodecs/runtime path
- keyframeable texture time maps to source time
- no keyframes means texture auto-syncs to comp time

This makes texture fills compatible with project relinking and export.

## AI Tooling

After the property registry lands, expose motion authoring to AI tools through descriptors instead of hard-coded actions:

- create motion shape
- update property path
- add/remove keyframe
- add appearance item
- add replicator
- add modifier
- add target

AI should use the same validation as the UI. No separate hidden schema.

## Presets, Templates, and Expressions

### Presets

Add a small preset system after shape clips are stable:

- appearance stack presets
- shape primitive presets
- replicator layout/modifier presets
- graph/easing presets

Presets should be JSON snippets with versioned schema and no embedded binary media. Project-local presets can arrive first; user-global presets can follow when settings persistence is ready.

### Motion Templates

Motion templates should save selected clips, keyframes, appearance stacks, and replicators into a reusable `.msmotion` package. They should not save source media by default. When texture fills are involved, the template should reference project media ids and warn if the media is missing.

Target template categories:

- lower thirds
- title cards
- logo reveals
- loops
- kinetic typography
- audio-reactive placeholders later

### Light Expressions

Do not start with a full expression language. Start with a tiny deterministic expression model that can be compiled/evaluated safely:

```text
time
index
count
sin(time)
cos(time)
random(seed, index)
```

Use expressions first inside replicator modifiers and motion properties, not everywhere in the editor. Expressions must be pure functions of frame time, index, seed, and property values so export is deterministic.

### Bake Preview Cache

Heavy procedural motion clips should eventually support a temporary bake:

- bake current clip/range into RAM preview or project cache
- keep the procedural source as truth
- invalidate the cache when source data changes
- expose cache state through debug stats

This is an editing acceleration feature, not a replacement for procedural export.

## Testing Strategy

### Unit Tests

- motion type defaults
- property registry registration/search/path parsing
- keyframe interpolation for motion properties
- shape serialization round trip
- appearance reorder preserves keyframes by id
- replicator deterministic random/seed behavior
- preset/template schema round trip once introduced
- light expression deterministic evaluation once introduced

### Renderer Tests

Use existing WebGPU test approach where available:

- MotionRenderer initializes once and reuses pipelines.
- shape render produces non-empty texture.
- output texture resizes cleanly.
- replicator instance count packs correctly.
- export path uses exact frame time.

### UI Tests

- add shape clip
- edit size/color/stroke
- set keyframes from Properties panel
- pin property to timeline
- toggle graph mode
- drag motion path point
- run quick actions and verify undo/redo

### Performance Checks

Add debug stats:

```ts
motion: {
  clipCount: number;
  instanceCount: number;
  bufferUploads: number;
  renderMs: number;
  computeMs?: number;
}
```

Expose through existing AI/debug stats so we can inspect real scenes.

## Rollout Plan

### Phase 0: Planning and Benchmark Fixtures

Deliverables:

- this plan
- benchmark project descriptions
- screenshots/video references from Plate if the user provides them

Exit criteria:

- agreed first slice
- no open architectural blocker for shape clip V1

### Phase 1: Property Registry

Files:

- `src/services/properties/PropertyRegistry.ts`
- `src/services/properties/registerCoreProperties.ts`
- `src/types/propertyRegistry.ts`
- tests under `tests/unit/propertyRegistry.test.ts`

Work:

- register current transform properties
- register effect numeric params from effect definitions
- support search aliases and group filtering
- add read/write helpers for clip properties

Exit criteria:

- existing transform/effect property rows can be described by registry without changing behavior
- tests pass

### Phase 2: Motion Shape Clip MVP

Files:

- `src/types/motionDesign.ts`
- `src/stores/timeline/motionClipSlice.ts`
- `src/components/panels/properties/MotionShapeTab.tsx`
- `src/engine/motion/*`
- serialization/project files

Work:

- add rectangle and ellipse motion clips
- add shape tab with size/radius
- add appearance stack with one color fill and one optional stroke
- add Convert Solid to Shape quick action
- add appearance preset data shape, even if UI ships later
- render through WebGPU MotionRenderer
- include in preview, nested comp, thumbnail, and export

Exit criteria:

- a rectangle can be added, transformed, keyframed, saved, loaded, exported
- no Canvas2D in the shape render hot path
- Convert Solid to Shape preserves color, transform, timing, and basic keyframes

### Phase 3: Timeline Property Pinning and Global Graph Mode

Files:

- `src/components/timeline/*`
- `src/components/timeline/CurveEditor.tsx`
- timeline store types/slices

Work:

- add pinned property state
- add property favorites state
- add property search in Properties panel
- implement `G` graph mode
- render selected/pinned curves together
- add solo property lane filtering

Exit criteria:

- graph mode edits the same keyframes as timeline mode
- no duplicate keyframe store
- property favorites survive project reload or user settings reload, depending on chosen storage

### Phase 4: Viewport Motion Paths

Files:

- `src/components/preview/MotionPathOverlay.tsx`
- preview overlay math helpers
- keyframe update helpers

Work:

- draw 2D position paths for selected clip
- drag points to update keyframes
- add Bezier handle support after point dragging is stable
- add optional onion-skin sample display

Exit criteria:

- path edits update timeline keyframes and export result matches preview
- onion skin does not create or mutate keyframes

### Phase 5: Replicator MVP

Files:

- `src/types/motionDesign.ts`
- `src/components/panels/properties/ReplicatorTab.tsx`
- `src/engine/motion/MotionReplicatorPipeline.ts`

Work:

- grid/linear/radial layouts
- count/spacing/radius/angle controls
- offset position/rotation/scale/opacity
- GPU instancing
- Add Replicator quick action
- Bake Replicator to Comp command as an explicit conversion, not the default render model

Exit criteria:

- 10k simple instances remain interactive
- no per-instance React objects
- export parity confirmed
- bake command creates a normal nested comp without mutating the procedural source unless the user confirms replacement

### Phase 6: Replicator Modifiers and Falloffs

Work:

- random/noise/oscillator/field modifiers
- explicit seed locking for random/noise modifiers
- modifier cards
- target picker powered by PropertyRegistry
- falloff shape references
- compute-buffer path for complex modifier stacks

Exit criteria:

- deterministic seeds
- modifier target results are keyframeable and export stable
- changing a seed is the only way default random layouts reshuffle

### Phase 7: Texture Fills

Work:

- texture fill appearance item
- import image/video into fill
- independent texture transform
- keyframeable texture time
- fit/fill/stretch/tile modes

Exit criteria:

- video texture fill can freeze, reverse, loop, and export correctly

### Phase 8: Direct Media Replicators

Work:

- replicate image clips as GPU-instanced source textures
- replicate video clips by decoding each unique source time once
- support same-time, per-index time offset, loop, and ping-pong source-time modes
- support nested-comp source textures after image/video are stable
- expose source-time controls through PropertyRegistry

Exit criteria:

- replicated video wall uses one decoder path for shared-time instances
- per-instance time offset is deterministic in preview and export
- nested-comp replicator uses cached rendered source frames where possible

### Phase 9: Null Layers

Work:

- create `motion-null` clip
- viewport null handle
- parenting UI uses existing pick-whip path
- lock/label color support
- Add Null Parent quick action preserves child world transforms

Exit criteria:

- null can drive multiple children with keyframed transform
- undoing Add Null Parent restores the previous parent graph

### Phase 10: Motion Templates and Light Expressions

Work:

- save selected motion clips as `.msmotion`
- load/apply templates into the current composition
- implement tiny deterministic expression evaluator for motion/replicator properties
- expose expression state in the PropertyRegistry descriptors

Exit criteria:

- template round trip works without source media
- expressions produce identical values in preview and export
- invalid expressions fail closed with a visible property error state

### Phase 11: Adjustment Layers and Render Graph

Work:

- make `useRenderGraph` real
- represent adjustment clips as compositor operations
- apply effect stack to accumulated lower-layer texture
- support export and nested comps

Exit criteria:

- adjustment blur/color affects lower layers only
- ordering matches timeline stack

### Phase 12: Group Layers

Work:

- decide lightweight group vs nested comp reuse
- group selection, transform, and replicator behavior
- child effect/blend semantics

Exit criteria:

- group behavior is explicit and documented
- no hidden mismatch between preview and export

## Design Risks and Decisions

### Shape Rendering Strategy

Decision: analytic/SDF WGSL for primitives first.

Reason: it is fast, compact, resolution-independent, and avoids Canvas2D upload churn. Arbitrary path tessellation is harder and should not block rectangle/ellipse/polygon/star.

### Adjustment Layer Timing

Decision: delay adjustment layers until render graph work.

Reason: they require operating on accumulated lower layers. Fake implementations will break with nesting, export, and blend modes.

### Replicator Storage

Decision: store procedural definitions, not expanded instances.

Reason: instance expansion would damage project size, undo/redo, React performance, export, and AI operations.

### Property Registry First

Decision: ship registry before big new UI.

Reason: without it, every new feature will hard-code property labels, keyframe buttons, search, AI schemas, and serialization validation in separate places.

### Texture Fill Timing

Decision: after shape/appearance, before advanced modifiers if media-runtime integration is straightforward.

Reason: it is high user value and reuses existing decode/export work, but it should not complicate the first shape renderer.

## Suggested First PR

The first PR should be deliberately boring:

- add `PropertyRegistry`
- register transform properties
- add tests
- no visible product behavior change except optional registry debug coverage

The second PR can add `motionDesign.ts`, serialization plumbing, and one `motion-shape` rectangle clip behind a feature flag.

## Feature Flag

Add a flag:

```ts
useMotionDesignSystem
```

Default off until:

- shape clip renders in preview/export
- save/load round trip passes
- no device-loss or HMR issues

Once shape clips are stable, keep replicators behind a separate flag:

```ts
useMotionReplicators
```

## Documentation Updates When Implemented

Update or create:

- `docs/Features/Motion-Design.md`
- `docs/Features/Keyframes.md`
- `docs/Features/Timeline.md`
- `docs/Features/GPU-Engine.md`
- `docs/Features/Export.md`
- `docs/Features/Project-Persistence.md`

Do not update `src/version.ts` unless this is part of an explicit master release workflow.
