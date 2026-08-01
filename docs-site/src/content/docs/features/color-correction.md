---
title: "Color Correction Tab"
---

[Back to Index](/features/readme/)

MasterSelects has a clip-level Color tab with one saved color-grade state shared by List and Nodes views. It is a focused, realtime primary-grade workflow rather than a complete DaVinci-style graph system.

The workflow provides a default `Input -> Primary -> Output` graph, serial Primary and Wheels nodes, clip grade versions, scalar color keyframes, MIDI parameter labels, timeline copy/paste including color keyframes, project persistence, preview/export layer wiring, and a WebGPU pass. The renderer compiles enabled serial Primary/Wheels nodes, up to eight.

---

## Current Pipeline Facts

- Clip effects remain on `TimelineClip.effects` / render `Layer.effects`; `src/components/panels/properties/EffectsTab.tsx` edits the generic effect stack.
- Generic effect definitions are registered in `src/effects/index.ts`. `src/effects/EffectsPipeline.ts` handles non-inline effects; brightness, contrast, saturation, and invert are inline compositor effects.
- `TimelineClip.colorCorrection` is a separate state model in `src/types/colorCorrection.ts`; `RuntimeColorGrade` is attached to render layers.
- `src/services/layerBuilder/*` obtains `getInterpolatedColorCorrection(...)` for normal clip layers. Nested composition layers currently call `compileRuntimeColorGrade(...)` directly.
- The worker WebGPU compositor constructs `ColorPipeline` in `src/services/render/workerGpuVideoFrameCompositor.ts`; `src/engine/render/Compositor.ts` applies it before complex generic effects.
- Waveform, histogram, and vectorscope panels read the final rendered texture through `src/components/panels/scopes/useScopeAnalysis.ts` at roughly 15 fps.
- `src/engine/core/RenderTargetManager.ts` uses two `rgba8unorm` effect temporary textures.

---

## Runtime Details

- Persistence is explicit: `ProjectClip` includes `colorCorrection` in `src/services/project/types/composition.types.ts`, and project save/load clone it in `src/services/project/projectSave.ts` and `src/services/project/load/loadTimelineHydration.ts`.
- `ColorCorrectionState` is independent of the generic `EffectType` registry. Its only current editable node types are `primary` and `wheels`; `input` and `output` are structural nodes.
- Preview interpolation is implemented by `getInterpolatedColorCorrection(...)` in `src/stores/timeline/keyframes/keyframeEffectInterpolationActions.ts`. Nested layer construction uses `compileRuntimeColorGrade(...)` directly, so it does not share that keyframe interpolation route.
- Color mutations generally replace the clip through `updateColorCorrection(...)` and invalidate the layer cache. `setColorWorkspaceViewport(...)` updates the stored UI viewport without calling `invalidateCache()`.
- `ColorPipeline` keeps uniform buffers by layer key and uses `queue.writeBuffer(...)`, but creates a bind group for every `applyGrade(...)` call.
- The `workspaceViewport` field and optional workspace mode belong to `ColorEditor`.

---

## Product Goal

The current tab supports two views of one `ColorCorrectionState`:

| Mode | Current purpose |
|---|---|
| **Nodes** | Compact, rewireable serial node graph with draggable nodes and removable edges |
| **List** | Ordered editable-node list plus controls for the selected node |

Both views edit the same active grade version. The runtime follows the first serial route from Input to Output; parallel branches are retained in state but logged and reduced to the first branch at compilation.

### View Mode Contract

`ColorCorrectionState` stores versions, nodes, edges, active version, selected node, view mode, and viewport. The renderer receives the compiled `RuntimeColorGrade`, not the editor UI state.

List and Nodes preserve the active version and selected node. There is no branch/mixer list representation, and serial node order is changed by graph connections rather than a list drag/reorder control.

---

## Core UX

### Properties Panel Integration

`src/components/panels/properties/index.tsx` registers the `color` tab and lazy-loads `src/components/panels/properties/ColorTab.tsx`. It is available for supported visual clips, and hidden for audio, camera, light, splat-effector, and motion-adjustment clips.

`Effects` remains the generic effects surface. `Color` is the clip-grade surface.

### Two Editing Surfaces

The active product surface is the Properties Color tab. There is no docked Color Workspace panel.

### Color Tab Layout

The toolbar provides List/Nodes switching, grade bypass, reset all color keyframes, Add Primary, Add Wheels, Reset, and Disconnect for a selected edge. The list shows editable nodes with enable, reset, and delete controls; the selected node's inspector provides its parameter controls.

### Node View

New color state starts as `Input -> Primary -> Output`. Nodes can be dragged; edges can be connected or selected and removed. In the Properties tab, the compact graph is not panned or zoomed; the stored viewport is used only by `ColorEditor`'s optional workspace mode.

### List View

The List view renders the active version's editable nodes in saved node order. It does not flatten branches or expose HDR/Log, curves, HSL, windows, mixer, or output-transform controls.

---

## Canonical Data Model

Color state is defined in `src/types/colorCorrection.ts` and is stored on `TimelineClip.colorCorrection` and serialized clip/project types. Its current shape includes `version: 1`, `enabled`, `activeVersionId`, `versions`, and `ui`.

Each version has nodes, edges, and an output node id. Node types are `input`, `primary`, `wheels`, and `output`. `ColorCorrectionState.ui` persists List/Nodes mode, selected node, and a workspace viewport.

`Layer.colorCorrection` holds an interpolated `RuntimeColorGrade`; `RuntimeColorGrade` contains a combined primary value, the serial `primaryNodes` values, node ids, diagnostics, and a graph hash.

---

## Node Types

| Node Type | Controls |
|---|---|
| `primary` | Exposure, contrast, pivot, shadows/highlights, lift/gamma/gain/offset, black/white, saturation, vibrance, hue, temperature, tint |
| `wheels` | RGB and luma controls for lift, gamma, gain, and offset |
| `input`, `output` | Structural graph anchors |

---

## Render Architecture

`compileRuntimeColorGrade(...)` in `src/types/colorCorrection.ts` walks the active graph from Input to Output, ignores disabled and neutral nodes, supports Primary/Wheels only, and limits compilation to eight realtime nodes. Missing anchors, open chains, cycles, and branches produce diagnostics and fall back to saved node order or the first serial branch.

`src/engine/color/ColorPipeline.ts` is a single inline WGSL shader. It applies each compiled node serially in one `rgba8unorm` render pass.

### Render Placement

For non-adjustment layers, `src/engine/render/Compositor.ts` copies a source to an effect temporary texture when color correction or complex effects require preprocessing, runs `ColorPipeline.applyGrade(...)`, then runs complex generic effects before compositing. Inline generic effects remain part of the composite pass.

### Compositor Integration

The current pipeline uses `RenderTargetManager`'s two effect temp textures.

---

## Keyframes And MIDI

Color parameters use `color.{versionId}.{nodeId}.{paramName}` paths. `ColorProperty` is included in `AnimatableProperty` in `src/types/animationProperties.ts`, and `getInterpolatedColorCorrection(...)` interpolates numeric color parameters before compiling the runtime grade.

Primary and Wheels controls use `MIDIParameterLabel`; the toolbar can enable recording and add keyframes for all editable color parameters at the playhead. MIDI mapping settings are supplied by the shared parameter-mapping UI.

---

## Scopes And Monitoring

Waveform, Histogram, and Vectorscope remain independent scope panels. They analyze the final rendered texture only. The Color tab has no controls to open/focus those panels, and there is no before/after source, matte view, clipping overlay, or selected-node scope source.

---

## UI Architecture

Current color UI files are:

```text
src/components/panels/properties/ColorTab.tsx
src/components/panels/color/
  ColorEditor.tsx
  ColorToolbar.tsx
  ColorNodeList.tsx
  PrimaryColorControls.tsx
  WheelColorControls.tsx
  ColorGraphView.tsx
  ColorVersionRow.tsx
  colorTab.css
src/stores/timeline/colorCorrectionSlice.ts
```

The store supports create/reset/enable/select/add/remove/connect/disconnect/move/rename nodes and duplicate/delete/select versions.

---

## Realtime Rules

Numeric grade changes rebuild the runtime grade in store/layer construction and update a persistent GPU uniform buffer with `queue.writeBuffer(...)`. The pipeline itself is created once per compositor resource set. Bind groups are not cached per layer.

The shader clamps output to `[0, 1]`.

---

## Presets And Versions

`duplicateColorVersion(...)`, `deleteColorVersion(...)`, and `setActiveColorVersion(...)` operate on `ColorCorrectionState.versions`; only the active version compiles.

Timeline context-menu Copy Color/Paste Color copies the grade and its `color.*` keyframes through `src/stores/timeline/clipboardSlice.ts`.

---

## Compatibility And Migration

Generic color effects and the Color tab are separate. Existing effect arrays continue to render through the generic effects pipeline.
