# Plate Motion Design Integration Strategy

Status: research draft
Date: 2026-05-02

This document maps public Plate documentation into a MasterSelects-native motion-design roadmap. It is not a reverse-engineering plan and does not rely on copying Plate code. Plate is useful here because its public surface validates the same technical direction MasterSelects already uses: browser app, WebGPU rendering, timeline/keyframe authoring, WebCodecs export, and local project files.

## Sources Reviewed

- Plate docs home: https://docs.plate.video/
- Interface: https://docs.plate.video/interface/interface-overview/
- Properties panel: https://docs.plate.video/interface/properties-panel/
- Timeline: https://docs.plate.video/interface/timeline/
- Layers: https://docs.plate.video/key-concepts/layers/
- Shape layers: https://docs.plate.video/layers/shape-layers/
- Group layers: https://docs.plate.video/layers/group-layers/
- Null layers: https://docs.plate.video/layers/null-layers/
- Adjustment layers: https://docs.plate.video/layers/adjustment-layers/
- Keyframes and graph editor: https://docs.plate.video/key-concepts/keyframes-and-animation/ and https://docs.plate.video/animation/graph-editor/
- Motion paths: https://docs.plate.video/animation/motion-paths/
- Appearance: https://docs.plate.video/appearance/appearance-general/
- Texture fills: https://docs.plate.video/appearance/texture-fills/
- Replicators: https://docs.plate.video/replicators/replicator-overview/
- Replicator modifiers/falloffs: https://docs.plate.video/replicators/modifiers/ and https://docs.plate.video/replicators/falloffs/
- Export: https://docs.plate.video/export/export-settings/ and https://docs.plate.video/export/format-reference/

## What Plate Gets Right

Plate is not primarily ahead because of exotic technology. The public bundle and docs point to the same class of stack we already use: React, WebGPU/WGSL, WebCodecs, MP4 parsing/muxing, local files, and an Electron bridge. Its advantage is product shape:

- A focused motion-design layer model: shape, group, null, adjustment.
- A single Properties panel where every animatable value behaves consistently.
- Timeline property visibility shortcuts and pinning.
- A graph editor as a first-class alternate view of the same keyframe data.
- Viewport motion paths that edit spatial keyframes directly.
- Appearance stacks with multiple fills/strokes, gradients, and texture fills.
- Replicators as procedural layer behavior, not duplicated timeline items.
- Modifier/target/falloff model for procedural variation.

MasterSelects already has stronger media breadth: NLE timeline, WebGPU compositor, 37 blend modes, 30 effects, WebCodecs/HTMLVideo/FFmpeg export paths, masks, Lottie, nested comps, native 3D, gaussian splats, AI tooling, multicam, audio, and project folders. The missing part is a coherent motion-design domain layer on top of the existing engine.

## Feature Parity Snapshot

| Plate surface | MasterSelects now | Native target |
|---|---|---|
| Shape layers | Solid/text clips, 3D primitives, math-scene WIP; no general 2D shape clip | `motion-shape` clip with rectangle, ellipse, polygon, star, GPU-native fill/stroke |
| Appearance cards | Text has fill/stroke/shadow; effects are separate; no per-shape appearance stack | Stable appearance card ids with color, stroke, gradient, texture, reorder, per-card keyframes |
| Texture fills | Media clips exist as full layers | Image/video as shape fill, independent transform/time, same media runtime as clips |
| Null layers | `parentClipId` exists; no dedicated transform-only clip | `motion-null` clip with viewport handle, no render output, transform/keyframe/parent support |
| Group layers | Nested compositions and multicam/link groups exist, but no lightweight motion group | Start with explicit grouped selection; later add motion group clip when child compositing semantics are clear |
| Adjustment layers | Effects apply per clip; color workspace exists per clip | `motion-adjustment` clip after render graph work, applying effects to accumulated lower layers |
| Graph editor | Per-property curve editor in expanded timeline rows | Global graph mode showing selected/pinned properties across clips |
| Motion paths | 3D object/camera overlays exist; no 2D spatial keyframe path editing | Viewport path overlay for `position.x/y`, then 3D/camera path support |
| Property pinning/search | Expanded lanes and properties tabs exist; no central property registry | Registry-driven search, pinned properties, multi-selection keyframe actions |
| Replicators | Splat effectors and slot-grid concepts exist, but no 2D procedural instance system | GPU-instanced replicator with grid/linear/radial layouts, offsets, modifiers, falloffs |
| Replicator modifiers | No generic modifier/target model | Compute/vertex driven noise, random, oscillator, field, target descriptors |
| Work area | In/out points and export ranges exist | Keep current in/out model; optionally expose work-area bars/shortcuts as motion-design preset |
| Export | Already broader than Plate: WebCodecs, HTMLVideo, FFmpeg, GIF, image, audio, XML | Motion renderer must use the same frame path so preview/export parity stays exact |

## Native Direction

Do not embed Plate, Friction, or any external editor. Do not create thousands of duplicated clips for repeated shapes. Build a MasterSelects-native motion subsystem that compiles authoring data into compact GPU work:

```text
TimelineClip
  -> MotionLayerDefinition
  -> property evaluation cache
  -> GPU draw packets / instance buffers
  -> MotionRenderPass texture or scene contribution
  -> existing compositor / export path
```

The timeline remains the source of truth. Preview, nested comps, RAM preview, and export must all consume the same evaluated frame data.

## Proposed Domain Model

Add a dedicated motion-design type module rather than growing `TimelineClip` with ad hoc fields.

```ts
type MotionLayerKind =
  | 'shape'
  | 'group'
  | 'null'
  | 'adjustment';

type ShapePrimitive = 'rectangle' | 'ellipse' | 'polygon' | 'star';

interface MotionLayerDefinition {
  version: 1;
  kind: MotionLayerKind;
  shape?: ShapeDefinition;
  appearance?: AppearanceStack;
  replicator?: ReplicatorDefinition;
  ui?: {
    labelColor?: string;
    locked?: boolean;
    pinnedProperties?: string[];
  };
}
```

Suggested clip/source integration:

- Add timeline source types: `motion-shape`, `motion-null`, `motion-adjustment`.
- Keep group layers as timeline compositions or grouped clip containers at first; do not introduce nested render semantics until group compositing is explicit.
- Store motion data on `TimelineClip.motion?: MotionLayerDefinition`.
- Serialize through the existing project save/load path as versioned JSON.
- Extend `AnimatableProperty` with typed property paths rather than special-case fields.

Example property paths:

```text
shape.size.w
shape.size.h
shape.cornerRadius
appearance.{appearanceId}.color.r
appearance.{appearanceId}.color.g
appearance.{appearanceId}.stroke.width
appearance.{appearanceId}.gradient.angle
appearance.{appearanceId}.texture.time
replicator.count.x
replicator.count.y
replicator.offset.rotation
replicator.modifier.{modifierId}.phase
replicator.modifier.{modifierId}.target.{targetId}.strength
```

## Property Registry

Plate's biggest UX lesson is that every property behaves the same. MasterSelects should introduce a central property registry before adding many new motion properties.

```ts
interface PropertyDescriptor<T = number> {
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
    searchAliases?: string[];
  };
}
```

This registry should drive:

- Properties panel rows.
- Timeline property pinning and search.
- Multi-selection keyframe actions.
- AI tool property targeting.
- Serialization validation.
- GPU uniform/storage-buffer packing metadata.

The existing effect registry is the local pattern to follow. The current keyframe store can remain, but property discovery and UI should move from scattered component logic into registry descriptors.

## Rendering Architecture

### Shape Rendering

MVP shapes should not use Canvas2D in the hot path. Render procedural primitives directly in WGSL:

- Rectangle with corner radius via analytic SDF.
- Ellipse via analytic SDF.
- Polygon/star via generated vertices or SDF approximation.
- Stroke, fill, opacity, and anti-aliasing in a dedicated motion shader.

For later arbitrary paths, use a path runtime that flattens Beziers into segment buffers and renders either:

- GPU tessellated triangles for fills plus analytic stroke, or
- segment-buffer SDF for editable vector paths.

Canvas2D remains acceptable for text fallback and thumbnails, but motion-shape preview/export should be GPU-native.

### Appearance Stack

Appearance should be a list of draw cards:

- color fill
- stroke
- linear/radial gradient fill
- texture fill

Each card gets a stable id so keyframes survive reordering. Draw cards are evaluated in order and packed into a small buffer. Texture fills reuse the media runtime and WebCodecs frame providers; video texture time should be keyframeable through `appearance.{id}.texture.time`.

### Replicators

Replicators must be GPU-instanced.

Do not expand a 100k-instance replicator into timeline clips, React rows, or CPU-side layer objects. A replicator should compile into:

- source template draw packet
- layout params
- offset params
- modifier params
- optional target descriptors
- optional falloff descriptors
- instance count

Grid, linear, and radial layouts can compute instance transforms in the vertex shader. More complex modifier stacks can use a compute pass to produce an instance property buffer when parameters or time change.

Recommended implementation split:

- MVP: vertex-shader layout and offset only.
- V2: deterministic seeded random, noise, oscillator, and field modifiers.
- V3: target mapping into shape, appearance, and transform properties.
- V4: falloff masks sampled from shape definitions or compact signed-distance fields.

This is the feature where MasterSelects can beat Plate technically: reuse the existing WebGPU engine, avoid CPU expansion, and keep export identical to preview.

### Null Layers

Null layers should be transform-only clips:

- no render output
- visible viewport handle/gizmo
- participates in parent transform evaluation
- can be keyframed like any clip

The existing `parentClipId` model and transform interpolation already provide most of the base.

### Adjustment Layers

Adjustment layers require a render-graph style compositor step. They cannot be implemented as a normal source texture because they operate on accumulated layers below them.

Recommended behavior:

```text
lower layers -> accumulated texture
adjustment layer effect stack -> ping/pong texture
upper layers continue compositing
```

This should be tied to the existing `useRenderGraph` feature flag becoming real. Adjustment layers are valuable, but less urgent than shape layers and replicators because they touch the core compositor ordering.

### Motion Paths

MasterSelects already has Bezier keyframes. Add viewport spatial editing for position keyframes:

- draw path from `position.x/y` keyframes for selected clip
- path points map to keyframe values
- handles map to Bezier handles where applicable
- dragging path points updates keyframe values
- dragging easing ticks updates temporal Bezier handles

The first version can be 2D-only. 3D/camera motion paths can follow after the shared-scene camera/object overlay math is reused.

### Graph Editor

The current per-property curve editor is useful but too local. Plate's model suggests a global timeline mode:

- `timeline` mode: bars and diamonds
- `graph` mode: selected/pinned property curves

Reuse existing `CurveEditor` math. Expand it to multi-property, multi-clip display. Keep the keyframe store unchanged; only the view and selection model need to broaden.

## Performance Rules

These rules should be treated as architectural constraints:

- React owns controls, lists, menus, and metadata only. It must never own per-instance replicator output.
- Per-frame animation evaluation writes into typed arrays or stable structural data, not fresh object graphs.
- Shape, appearance, and replicator GPU buffers should be cached by stable ids and invalidated by dirty flags.
- GPU pipelines should be persistent and keyed by shader variant, not rebuilt during editing.
- Texture fills should reuse the media runtime and import `VideoFrame`/video textures where possible.
- Export must call the same motion renderer as preview, at export resolution and frame time.
- Hit testing for dense motion scenes should move toward GPU id-buffer picking or compact CPU bounding proxies, not DOM overlays per object.
- Large procedural counts need hard UI limits plus adaptive quality, but the renderer should be designed around 100k+ instances.

## Implementation Roadmap

### Phase 0: Spec and Benchmark Capture

- Capture screenshots/video of Plate's Properties panel, Graph Editor, Replicator tab, motion paths, and export dialog.
- Create a feature parity matrix with `MasterSelects now`, `Plate behavior`, `MasterSelects target`.
- Add a small suite of benchmark scenes: 1 shape, 1k shapes, 10k replicated shapes, texture-fill video, nested comp export.

### Phase 1: Property Registry and UX Foundation

- Add `src/types/motionDesign.ts`.
- Add `src/services/properties/PropertyRegistry.ts`.
- Register existing transform/effect/color/mask properties first.
- Add timeline property pinning/search from registry descriptors.
- Add multi-selection keyframe helpers.
- Add lock and label color fields for clips.

This phase improves existing workflows before new rendering features arrive.

### Phase 2: Shape Clips and Appearance Stack

- Add `motion-shape` clip creation.
- Add rectangle, ellipse, polygon, and star properties.
- Add color fill and stroke cards.
- Render through a new `src/engine/motion/MotionRenderer`.
- Route preview, nested comps, thumbnails, and export through the same renderer.
- Add focused tests for serialization, keyframe interpolation, and layer building.

### Phase 3: Graph Editor and Motion Paths

- Add timeline graph mode.
- Support multi-property curve display for selected/pinned properties.
- Add viewport 2D motion paths for position keyframes.
- Reuse existing Bezier interpolation utilities and selection store.

### Phase 4: Replicator MVP

- Add `ReplicatorDefinition`.
- Implement grid, linear, and radial layout.
- Implement count, spacing/fit, direction, radial rings, and auto-orient.
- Implement offset position, rotation, scale, and opacity.
- Render via WebGPU instancing with no timeline expansion.
- Add performance tests or debug stats for instance count and GPU timings.

### Phase 5: Modifiers, Targets, and Falloffs

- Add deterministic random, noise, oscillator, and field modifiers.
- Add target descriptors that can affect transform, shape, appearance, and opacity.
- Add shape-based falloff references.
- Use compute-generated instance buffers when shader-only evaluation becomes unwieldy.

### Phase 6: Adjustment Layers and Render Graph

- Turn `useRenderGraph` from stub into an ordered compositor graph.
- Add `motion-adjustment` clips.
- Apply effect stacks to accumulated layers below the adjustment clip.
- Keep old compositor path as fallback until parity is stable.

### Phase 7: Texture Fills and Video Time Remap

- Add image/video texture fill cards to shape clips.
- Reuse media runtime source ids.
- Add `texture.time` as a keyframeable property.
- Support fill/fit/stretch/tile modes.
- Ensure export and nested comps use the same remapped frame selection.

## Highest-Leverage First Slice

The first implementation should not start with full replicators. Start with the property registry plus shape clips:

1. Property registry for existing transform/effect fields.
2. `motion-shape` clip with rectangle and ellipse.
3. GPU-native color fill and stroke.
4. Keyframeable shape size/radius/color/stroke width.
5. Export parity.

That slice proves the domain model, exercises the renderer, and creates the foundation for replicators without touching the most dangerous compositor behavior yet.

## Explicit Non-Goals

- Do not copy Plate's minified bundle or UI assets.
- Do not mimic Plate branding or exact visual styling.
- Do not integrate Plate as a runtime dependency.
- Do not implement replicators by duplicating clips.
- Do not route all vector/motion graphics through Canvas2D.
- Do not add adjustment layers before the compositor ordering model is ready.

## Open Questions

- Should motion-shape clips live as normal timeline clips, or should groups introduce an internal layer tree similar to nested compositions?
- Should arbitrary vector paths be part of V1, or should V1 stay primitive-only until the GPU path renderer is designed?
- Should texture fills arrive before replicators because they reuse current media runtime work, or after shape/appearance is stable?
- How much of the existing text clip renderer should migrate into the appearance stack versus remain a separate clip type?
- Can math-scene objects later compile into the same MotionRenderer, or should they stay separate because expression evaluation has different needs?
