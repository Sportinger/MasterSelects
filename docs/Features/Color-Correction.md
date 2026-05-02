# Color Correction Tab Plan

[Back to Index](./README.md)

Professional color correction for MasterSelects should become a dedicated clip tab that feels close to DaVinci Resolve's node page, while still offering a dense list/inspector mode for fast slider-based work. The important product decision is that node view and list view are not separate systems. They are two views over the same color-grade state.

This document started as the implementation plan and now also records the first production slices. The current implementation ships the canonical clip color state, the Properties Color tab, the dockable Color workspace, two-mode List/Nodes switching where Nodes opens the right-side workspace, left-button node-canvas panning, a collapsible workspace inspector, keyframable/MIDI-ready primary controls, a dedicated Wheels node with RGB chroma wheels plus luma sliders, project persistence, preview/export layer wiring, and a realtime WebGPU fused primary/wheels pass that can apply serial Primary and Wheels nodes in one shader pass.

Remaining professional work includes advanced graph branches/mixers, qualifiers/windows, LUT management, still/reference workflows, selected-node scope routing, and higher precision intermediate textures.

---

## Current Pipeline Facts

The repo already has the foundations needed for a real color tab:

- Clip effects live on `TimelineClip.effects` / `Layer.effects` and are edited by `src/components/panels/properties/EffectsTab.tsx`.
- Effect definitions are registered in `src/effects/index.ts` and currently include simple color effects such as Brightness, Contrast, Saturation, Vibrance, Hue Shift, Temperature, Exposure, Levels, and Invert.
- `LayerBuilderService` and export layer building already call `getInterpolatedEffects(...)`, so effect values are resolved per frame for preview and export.
- `src/engine/render/Compositor.ts` splits effects into inline color ops and complex effect passes.
- Brightness, contrast, saturation, and invert are already inline uniforms in `CompositorPipeline`, avoiding extra render passes.
- Non-inline effects are applied to the source texture before compositing through `src/effects/EffectsPipeline.ts`.
- Scopes already exist as GPU panels: waveform, histogram, and vectorscope. They read from `engine.getLastRenderedTexture()` and render around 15fps.
- Render targets and effect temp textures currently use `rgba8unorm`, so professional grading needs a planned path to higher precision intermediates.

The color tab should extend these pieces rather than replacing them.

---

## Re-review Against Current Code

The first plan is still the right product direction, but the implementation path needs to be more explicit in a few places the current code makes non-optional:

- Project persistence is explicit. `ProjectClip` in `src/services/project/types/composition.types.ts`, plus `projectSave.ts` and `projectLoad.ts`, manually map clip fields. Adding only `TimelineClip.colorCorrection` would render in memory but lose grades on save/load.
- `EffectType` in `src/types/index.ts` is already behind the registry. New professional color nodes should not depend on this generic effect union. Define color node types separately and leave old effects intact.
- Preview and export build layers through separate paths: `LayerBuilderService` and `ExportLayerBuilder`. Both must receive the same `RuntimeColorGrade`, including nested compositions, or preview/export parity will drift.
- Nested export currently duplicates effect interpolation instead of calling the same store helper. Color correction should add a shared interpolation utility instead of copying another interpolation implementation.
- `LayerCache` invalidates by clip array reference, track reference, frame, active composition, playback state, and proxy state. Color state actions must replace affected clip objects and call `invalidateCache()`.
- `RenderTargetManager` currently exposes only two `rgba8unorm` effect temp textures. That is enough for a fused Primary node, but not enough for serious qualifiers, mattes, LUTs, and selected-node debug outputs.
- `EffectsPipeline.applyEffects(...)` creates uniform buffers and bind groups during frame rendering. The color pipeline should start with persistent uniform buffers, cached bind groups, and `queue.writeBuffer(...)` updates for realtime slider use.
- Scope panels currently read `engine.getLastRenderedTexture()`. Before/after, matte, and selected-node scopes require a dedicated debug texture registry, not references to transient render-pass views.

These are plan corrections, not reasons to simplify the product. They make the DaVinci-style UI feasible without building a fragile parallel system.

---

## Product Goal

The tab should support two editing modes:

| Mode | Purpose |
|---|---|
| **Nodes** | Spatial grade construction: serial nodes, parallel mixers, layer mixers, qualifiers, windows, bypass, compare, and versioning |
| **List** | Dense operational editing: ordered node list with sliders, values, toggles, reset buttons, keyframe toggles, and MIDI-ready parameter labels |

Both modes must edit the same canonical graph. Switching mode should never rebuild or reinterpret the grade.

The first version should feel professional and realtime, not like a generic effects stack with prettier labels.

### View Mode Contract

List in the Properties tab and Nodes in the expanded Color Workspace are different views of the same object:

```text
ColorCorrectionState
  -> graph model
    -> node view projection
    -> list view projection
    -> render compiler projection
```

Rules:

- There is only one saved grade graph per version.
- List rows are derived from nodes and edges; they are not a second effects stack.
- Reordering a serial list row updates graph edges.
- Adding a node in List mode creates the same node object used by Node mode.
- Bypassing, renaming, deleting, resetting, keyframing, and MIDI mapping a node works identically in both views.
- Switching views preserves active version, selected node, and current parameter focus when possible.
- Unsupported graph shapes in List mode are shown as branch/mixer groups, not flattened destructively.
- The renderer only receives `RuntimeColorGrade` from the compiler, never UI-specific list or canvas state.

This is the core product rule: same grade, different professional control surfaces.

---

## Core UX

### Properties Panel Integration

Add a `Color` tab beside `Transform`, `Effects`, and `Masks` for visual clips.

Recommended tab order for video/image/text/solid/Lottie/3D clips:

```text
Transform | Color | Effects | Masks | Transcript | Analysis
```

`Effects` remains the general effect stack. `Color` becomes the preferred surface for color operations.

### Two Editing Surfaces

The Color design should not rely on one narrow panel to do everything. It needs two surfaces that edit the same state:

| Surface | Purpose |
|---|---|
| **Color tab in Properties** | Fast clip grading with list sliders, quick node/version management, bypass/compare, and presets |
| **Color Workspace dock panel** | Professional node grading with large graph canvas, collapsible inspector, scopes, versions, and still/reference tools |

The Properties tab is the everyday control surface. The Color Workspace is where serious node work happens. Both must read and write the same `ColorCorrectionState`; there is no import/export or conversion between them.

Implementation implication:

- Add `color-workspace` to `PanelType` and `PANEL_CONFIGS` in `src/types/dock.ts`.
- Add a lazy `ColorWorkspacePanel` branch in `src/components/dock/DockPanelContent.tsx`.
- Expose it from the View menu through existing `PANEL_CONFIGS` handling.
- Use the Color tab's `Nodes` mode button to activate/focus the Color Workspace and keep the selected clip focused.
- Returning from the workspace should put the Properties Color tab back in `List` mode.

### Color Tab Layout

The tab has a compact toolbar at the top:

```text
[List] [Nodes]   Bypass  Add Node  Reset
```

The Properties tab stays a dense List surface: a vertical sequence of editable grade nodes with grouped controls below the selected node. The `Nodes` button does not show a cramped mini-graph in the narrow Properties panel; it opens/focuses the Color Workspace on the right.

Reordering serial nodes can be done by drag handles or explicit move buttons. Branch editing, large pan/zoom, node thumbnails, and complex mixer wiring belong in the expanded Color Workspace.

### Node View

Node view should be practical, not decorative:

- Input and Output anchors are fixed by default.
- Serial node chain is auto-created for new clips: `Input -> Primary -> Output`.
- Nodes are compact, with color-coded type strips and bypass state.
- Node thumbnails should be optional and lazy, because preview decoding is already expensive.
- Dragging nodes updates position only, not render order, unless the user reconnects edges or uses explicit reorder actions.
- Keyboard interactions: delete node, duplicate node, bypass selected, add serial node after selected.
- In the Color Workspace, use the full pan/zoom node canvas with branch wiring, mixers, node search, and larger hit targets.

Use the FlashBoard canvas patterns where they fit: pan/zoom viewport, marquee selection, virtualization, context menu, and stored viewport. Do not couple color nodes to FlashBoard's generation store.

### Color Workspace Layout

The professional workspace should be a dock panel, not a modal:

```text
top toolbar: clip/version selector, Nodes/List, bypass, compare, scopes, presets
left rail: node types, presets, stills/references
center: node graph canvas
right inspector: selected node controls
bottom strip: grade versions, thumbnails, diagnostics, optional mini timeline context
```

When maximized, the workspace should support a real grading posture:

- graph and inspector visible at the same time
- right inspector collapsible so the graph can use the full workspace width
- left-button drag on empty canvas pans the node view; dragging a node still moves that node
- quick open/focus buttons for waveform, histogram, and vectorscope panels
- before/after and selected-node output source for preview/scopes
- copy grade, paste grade, reset node, reset grade, save preset
- keyboard shortcuts for add serial node, bypass node, disable grade, duplicate node, frame graph

The workspace must be useful even when the Properties panel is closed.

### List View

List view is the same graph flattened to the render order when possible:

- Each row represents one node.
- Rows include enable checkbox, node name, type, keyframe indicator, reset, and delete.
- Expanded rows show grouped controls: Primary, HDR/Log, Curves, HSL, Windows, Output.
- Parallel/layer mixer sections show nested groups with clear labels.
- If the graph cannot be perfectly flattened, show branch headers rather than hiding structure.

List view should reuse the current `DraggableNumber`, keyframe toggle, MIDI label, range customization, and batching behavior from `EffectsTab`.

---

## Canonical Data Model

Add typed color-grade state to clips instead of encoding the whole grade as many generic effects.

```ts
interface ColorCorrectionState {
  version: 1;
  enabled: boolean;
  activeVersionId: string;
  versions: ColorGradeVersion[];
  ui: ColorCorrectionUiState;
}

interface ColorGradeVersion {
  id: string;
  name: string;
  nodes: ColorNode[];
  edges: ColorEdge[];
  outputNodeId: string;
}

interface ColorNode {
  id: string;
  type: ColorNodeType;
  name: string;
  enabled: boolean;
  params: ColorNodeParams;
  position: { x: number; y: number };
  preview?: { collapsed?: boolean };
}

interface ColorEdge {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
}
```

Recommended clip location:

```ts
interface TimelineClip {
  colorCorrection?: ColorCorrectionState;
}

interface SerializableClip {
  colorCorrection?: ColorCorrectionState;
}
```

Also add the same field to project-file types:

```ts
interface ProjectClip {
  colorCorrection?: ProjectColorCorrectionState;
}
```

The save/load converters must copy this field explicitly:

- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- nested composition hydration in `src/stores/timeline/clip/addCompClip.ts`
- structural snapshot/undo serialization if the snapshot state uses serialized clip copies

The render-layer shape should carry an interpolated, render-ready grade:

```ts
interface Layer {
  colorCorrection?: RuntimeColorGrade;
}
```

Do not store large LUT payloads directly in a clip. Store a project asset reference, source path or media id, content hash, and LUT metadata. GPU LUT textures belong in a cache keyed by hash.

This keeps color correction strongly typed and independent from the generic effects registry, while still allowing the renderer to place it in the source-processing chain.

### Why Not Just Effects?

The current effect list is linear and parameter-centric. A node graph needs graph edges, positions, versions, parallel mixers, and node-local qualifiers/windows. Storing all of that inside generic `Effect.params` would make persistence, keyframes, migrations, and UI synchronization brittle.

The current simple color effects can remain for compatibility, but new professional grading should use the color-grade model.

---

## Node Types

Phase 1 should ship a small but complete professional set:

| Node Type | Controls | Render Notes |
|---|---|---|
| `primary` | Exposure, contrast, pivot, saturation, vibrance, temperature, tint, black/white levels | Fuse into one shader |
| `wheels` | Lift, gamma, gain, offset with RGB wheels and luma sliders | Fuse with primary when serial and unqualified |
| `curves` | RGB curve, luma curve, per-channel curves | LUT/curve texture or uniform samples |
| `hsl-qualifier` | Hue/sat/luma key, softness, clean black/white, matte view | Produces matte for downstream node |
| `power-window` | Rect/ellipse/linear gradient window, invert, feather | Produces matte or applies node-local mask |
| `lut` | 1D/3D LUT, intensity, input/output range | 3D texture when available; fallback sampled 2D atlas |
| `mixer` | Parallel mix or layer mix | Requires graph compiler branch handling |
| `output-transform` | Gamma, gamut/display transform, legal range clamp | Usually last node |

Later node types:

- HDR zones or log wheels.
- Match shot / still reference node.
- False color and skin-line helper overlays.
- DCTL/custom WGSL node after a security review.

---

## Render Architecture

Add a dedicated color pipeline under `src/engine/color/`:

```text
src/engine/color/
  types.ts
  ColorGradeCompiler.ts
  ColorPipeline.ts
  ColorScratchPool.ts
  ColorUniformPacker.ts
  shaders/
    colorPrimary.wgsl
    colorCurves.wgsl
    colorQualifier.wgsl
    colorLut.wgsl
```

### Compile Step

`ColorGradeCompiler` converts `ColorCorrectionState` to a runtime plan:

```ts
interface RuntimeColorGrade {
  graphHash: string;
  enabled: boolean;
  passes: ColorPassPlan[];
  diagnostics: ColorGradeDiagnostic[];
}

interface ColorPassPlan {
  id: string;
  kind: 'fused-primary' | 'curves' | 'qualifier' | 'lut' | 'mixer';
  nodeIds: string[];
  uniformData: Float32Array;
  textures?: ColorPassTextureBinding[];
  matteSource?: string;
}
```

The compiler should:

- Validate graph shape and prevent cycles.
- Resolve active version.
- Drop disabled nodes.
- Fuse compatible serial nodes into one pass.
- Split expensive nodes into explicit passes only when needed.
- Emit diagnostics for unsupported graph shapes instead of failing the frame.
- Cache by `graphHash` plus interpolated parameter hash.
- Separate topology compilation from numeric parameter packing so slider drags update uniforms without rebuilding pipelines.

### Render Placement

Apply color correction after source texture acquisition and before general effects and compositing.

Recommended order for a layer:

```text
source texture
  -> color correction graph
  -> generic clip effects
  -> transform, mask, opacity, blend mode compositing
```

This matches the mental model of clip-level grading and keeps blend modes operating on the graded layer.

Important current-code caveat: existing complex effects copy the source into output-sized effect temp textures before compositing. That is acceptable for phase 1 per-pixel primary grading, but qualifiers, windows, and source-space previews need source-normalized UVs and a richer scratch policy. Do not design power windows around output-pixel coordinates only.

### Compositor Integration

Update `Compositor.composite(...)`:

1. Determine `needsSourcePreprocess` from `layer.colorCorrection`, complex effects, or debug/matte output requests.
2. Copy source/external texture to a scratch texture if preprocessing is needed.
2. Run `ColorPipeline.applyGrade(...)` if `layer.colorCorrection?.enabled`.
3. Run existing `EffectsPipeline.applyEffects(...)` for non-color effects.
4. Composite the resulting texture.

If the graph is a simple primary grade, `ColorPipeline` can use the same temp textures already allocated for effects. Before qualifiers/LUTs/mixers, add `ColorScratchPool` so color passes can request:

- ping/pong color textures
- matte textures
- optional selected-node debug textures
- `rgba16float` textures when the precision flag is enabled

The color pipeline should not allocate GPU buffers during slider drags. Create per-pass uniform buffers and bind groups with the compiled plan, then update numeric data with `queue.writeBuffer(...)`.

### Precision Plan

Current `rgba8unorm` render targets are acceptable for phase 1 preview parity, but not ideal for serious grading. Plan a feature flag:

```ts
flags.useFloatColorPipeline
```

When enabled and supported:

- Source effect/color temp textures use `rgba16float`.
- Fused color passes render into float temps.
- Final composite/output can remain `rgba8unorm` initially.
- Export can use float intermediates first, then quantize at encoder boundary.

Fallback remains `rgba8unorm`.

---

## Keyframes And MIDI

Color parameters should use the existing property path idea, but with a dedicated namespace:

```ts
color.{versionId}.{nodeId}.{paramName}
```

Examples:

```ts
color.version_main.node_primary.exposure
color.version_main.node_wheels.liftR
color.version_main.node_wheels.gainY
color.version_main.node_curves.luma.points.0.y
```

Phase 1 can limit keyframes to scalar numeric parameters. Curve point animation can wait until the curve editor interaction is stable.

The code changes are broader than adding a string prefix:

```ts
export type ColorProperty = `color.${string}.${string}.${string}`;
export type AnimatableProperty = TransformProperty | EffectProperty | ColorProperty;
```

Then update:

- `createKeyframeSlice.getInterpolatedColorCorrection(...)`
- `setPropertyValue(...)` static writes for `color.*`
- `disablePropertyKeyframes(...)`
- timeline keyframe rows and curve display
- `MIDIParameterLabel` targets
- nested layer interpolation helpers used by preview and export

MIDI should treat color controls like effect controls:

- Use `MIDIParameterLabel`.
- Expose min/max/invert/damp in the MIDI Mapping panel.
- Batch drag updates via `startBatch('Adjust color')` / `endBatch()`.

---

## Scopes And Monitoring

The existing scope panels should remain independent dock panels. The Color tab should provide quick controls to open or focus them:

- Waveform
- Histogram
- Vectorscope

Later, the color tab can embed compact scopes in the inspector, but the first version should avoid duplicating GPU scope renderers.

Needed scope upgrades for grading:

- Before/after scope source toggle.
- Matte view for qualifier/window nodes.
- Clipping indicators in histogram and preview overlay.
- Optional "node output" scope source for selected color node.

Implementation path:

- Keep current `engine.getLastRenderedTexture()` for final-output scopes.
- Add an optional debug texture registry for `ColorPipeline` intermediate outputs. It must own/copy textures long enough for scope panels to read them after the main render pass.
- Scope panels can select `final`, `before-color`, or `selected-color-node` when available.
- Implement before/after compare as renderer state, not as a second UI-only graph, so preview and scopes agree.

---

## UI Architecture

Recommended files:

```text
src/components/panels/properties/ColorTab.tsx
src/components/panels/color/
  ColorToolbar.tsx
  ColorNodeCanvas.tsx
  ColorNode.tsx
  ColorNodeInspector.tsx
  ColorNodeList.tsx
  ColorControls.tsx
  ColorCurvesControl.tsx
  ColorWheelControl.tsx
  ColorQualifierControl.tsx
  ColorPowerWindowControl.tsx
  colorTab.css
src/components/panels/color-workspace/
  ColorWorkspacePanel.tsx
  ColorWorkspaceToolbar.tsx
  ColorWorkspaceGraph.tsx
  ColorWorkspaceInspector.tsx
  ColorWorkspaceRail.tsx
  ColorWorkspaceVersions.tsx
  colorWorkspace.css
src/stores/timeline/colorCorrectionSlice.ts
```

Integration points:

- Add `color` to `PropertiesTab` in `src/components/panels/properties/index.tsx`.
- Add `color-workspace` to the dock panel system when the expanded workspace is implemented.
- Insert the tab for visual clips, including text, solid, Lottie, image, video, model, gaussian avatar, and gaussian splat clips. Keep it hidden for audio-only clips and camera/controller clips.
- Keep the active tab reset logic aware of `color` so switching selected clips does not bounce the user back to Transform.
- Reuse existing `DraggableNumber`, `KeyframeToggle`, `MIDIParameterLabel`, and history batching patterns from `EffectsTab`.
- Share list/inspector editing primitives between the Properties tab and workspace where practical. The workspace owns the large node graph layout.

The UI state should live in the color correction object only when it must persist with the clip:

- View mode: nodes/list.
- Node positions.
- Last workspace viewport per grade version.
- Active version.
- Selected color node can remain transient UI state in component state or a small store field.

Use icons for graph/list/bypass/reset/delete actions, following existing panel patterns. Avoid explanatory text inside the app surface; tooltips are enough.

---

## Realtime Rules

The tab must preserve playback feel:

- Dragging a slider updates uniforms without rebuilding pipelines.
- Node graph topology changes can rebuild the compiled plan, but not every numeric edit.
- Store updates replace only the edited clip and preserve other references where possible.
- Node canvas pan/zoom uses imperative transforms and viewport state, like Media Board and FlashBoard.
- Scope rendering stays throttled and independent.
- Large LUT uploads are debounced and cached by file hash.
- Disabled nodes are skipped at compile time.
- If GPU compilation fails, bypass the failing node and show a diagnostic in the node/list UI.

Recommended performance tiers:

| Tier | Behavior |
|---|---|
| Realtime | Fused primary/wheels/curves, no qualifiers, no LUT upload in progress |
| Interactive | Multiple serial passes or one qualifier/window |
| Preview Reduced | Many nodes, multiple LUTs, or float pipeline on weaker GPU |
| Export Quality | Full precision, no preview shortcuts |

---

## Presets And Versions

A professional tab needs fast experimentation:

- Clip grade versions: A, B, C, etc.
- Copy grade / paste grade between clips.
- Reset selected node / reset full grade.
- Save preset to local library.
- Apply preset to selected clips.
- Import/export LUTs.

Grade versions are stored inside `ColorCorrectionState.versions`. Only `activeVersionId` renders.

---

## Compatibility And Migration

Existing color effects should keep rendering unchanged.

Migration should be explicit, not automatic:

- The Effects tab can show a "Move color effects to Color" action later.
- The action can convert supported effects into a Primary node.
- Existing projects continue to store old `effects` arrays.

Avoid silently changing the render output of old projects.

---

## Implementation Plan

### Phase 0: Contracts

- Add `ColorCorrectionState` types to `src/types`.
- Add `ProjectColorCorrectionState` to project file types.
- Add serialization support in project save/load and nested composition hydration.
- Add `Layer.colorCorrection?: RuntimeColorGrade`.
- Add `ColorProperty` to `AnimatableProperty`.
- Add `colorCorrectionSlice` actions for create/update/delete/reorder/connect nodes.
- Add `getInterpolatedColorCorrection(clipId, localTime)`.
- Add shared helpers for interpolating color state in preview, export, and nested compositions.
- Ensure all color actions replace the edited clip object and call `invalidateCache()`.
- Add tests for store updates, project serialization, nested clip hydration, cache invalidation, and interpolation.

### Phase 1: UI Skeleton

- Add `ColorTab` to `PropertiesPanel` and tab reset logic.
- Add a two-mode List/Nodes switch where List stays in Properties and Nodes opens the Color Workspace.
- Implement default `Input -> Primary -> Output` graph.
- Implement Primary controls using existing draggable numbers, keyframe toggles, and MIDI labels.
- Add copy/paste/reset/bypass actions.
- Add/focus the Color Workspace from the `Nodes` mode.

### Phase 2: GPU Primary Grade

- Add `ColorPipeline` and a fused primary/wheels shader. Shipped for Primary and Wheels nodes.
- Add `Layer.colorCorrection`. Shipped.
- Wire `LayerBuilderService` and export `ExportLayerBuilder` to pass interpolated grades. Shipped.
- Integrate `ColorPipeline` before `EffectsPipeline`. Shipped.
- Use persistent uniform buffers and cached bind groups for primary controls. Persistent uniform buffers are shipped; bind-group caching remains open.
- Keep phase 1 primary grading on current `rgba8unorm` temps unless `rgba16float` scratch textures are ready.
- Add render tests for neutral grade, exposure, contrast/pivot, saturation, and bypass.

### Phase 3: Real Node Graph

- Add `color-workspace` dock panel.
- Add node canvas with pan, zoom, selection, serial node add/delete/duplicate.
- Add graph compiler validation and diagnostics.
- Add list view flattening for serial graphs.
- Add branch/mixer representation for simple parallel graphs.
- Keep branch/mixer editing in the workspace; the Properties tab remains the dense list control surface.

### Phase 4: Pro Controls

- Add `ColorScratchPool`.
- Add color wheels, curves, HSL qualifier, power windows, LUT node, and output transform. Color wheels are shipped for Lift, Gamma, Gain, and Offset; the other node types remain open.
- Add matte view and before/after compare.
- Add selected-node debug texture source for scopes.

### Phase 5: Precision And Export

- Add `rgba16float` color temp textures behind feature flag.
- Make export use the same color compiler and precision policy.
- Add project migration/version tests.
- Add performance stats for color passes and graph compile time.

---

## Test Plan

Unit tests:

- Color graph validation: cycle detection, missing nodes, disabled nodes.
- Compiler fusion: primary plus wheels becomes one pass.
- Store actions: add, remove, connect, bypass, rename, version switch.
- Project save/load serialization round trip.
- Nested composition hydration preserves color state.
- Color actions invalidate layer cache.
- Keyframe interpolation for scalar color parameters.

Render tests:

- Neutral grade is pixel-identical or within tolerance.
- Exposure and saturation produce expected output on synthetic textures.
- Disabled node has no effect.
- Color grade before blend mode produces expected compositing behavior.
- Preview and export use matching color output.
- Nested composition preview and export use matching color output.

UI tests:

- Switching Nodes/List preserves state.
- Slider drag batches history.
- Reset restores defaults.
- Bypass toggles are reflected in render state.
- Existing Effects tab still works for old color effects.

---

## Open Decisions

1. Whether phase 1 should expose color correction only for selected clips, or also support timeline/group/global grades immediately.
2. Whether the first output transform should be Rec.709-only or include an explicit color-management selector.
3. Whether adjustment layers should be implemented before group/timeline grades.
4. Whether to add embedded mini scopes in the Color tab or only focus existing scope panels.
5. How much of curve point editing should be keyframeable in the first implementation.

---

## Recommended First Build

Build this in the smallest useful professional slice:

1. Add the Color tab, state model, project persistence, and keyframe property type.
2. Ship one default Primary node in List view and compact Node Strip view.
3. Wire preview, export, and nested compositions to the same interpolated grade helper.
4. Render that node through a fused GPU color pass with cached uniforms.
5. Add a minimal Color Workspace dock panel that opens from the Color tab and shows the same graph/inspector at a larger size.
6. Keep existing Effects tab unchanged.
7. Add Waveform/Histogram/Vectorscope focus buttons.
8. Add grade versions and copy/paste once the base pass is stable.

This gives users a real color workflow quickly while leaving enough architecture for DaVinci-style nodes, qualifiers, LUTs, and high-precision rendering.
