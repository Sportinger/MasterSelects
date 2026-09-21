# Color Correction

[Back to Index](./README.md)

MasterSelects has a clip-level Color tab and a dedicated Resolve-inspired Color workspace. Both surfaces edit the same saved color-grade state, expose its Color-themed projection from the global node-graph document, and share the realtime render path.

The workflow provides a default `Input -> Primary -> Output` graph, serial Primary and Wheels nodes, structural mixer/splitter nodes, image and key ports, clip grade versions, scalar color keyframes, MIDI parameter labels, timeline copy/paste including color keyframes, project persistence, preview/export layer wiring, and a WebGPU pass. The renderer compiles enabled serial Primary/Wheels nodes, up to eight.

---

## Wheel keyframes

Each wheel heading includes a grouped keyframe toggle for its R, G, B and luminance channels. Individual channel toggles remain available and record the actual parameter value, preserving the normal timeline keyframe workflow.

Numeric Corrector/Wheels parameters also accept [procedural parameter sources](./Node-Workspace.md#procedural-parameter-sources).
Choose a source in the ordinary Properties/Nodes inspector; the dedicated Color
tab keeps its wheel layout and displays effective driven values. A driven channel
locks the wheel's puck/group actions, while unconnected channels remain editable
individually. Base values and existing curves are retained. Color-version copies
duplicate their connected source graphs and curves independently.

## Current Pipeline Facts

- Clip effects remain on `TimelineClip.effects` / render `Layer.effects`; `src/components/panels/properties/EffectsTab.tsx` edits the generic effect stack.
- Generic effect definitions are registered in `src/effects/index.ts`. `src/effects/EffectsPipeline.ts` handles non-inline effects; brightness, contrast, saturation, and invert are inline compositor effects.
- `TimelineClip.colorCorrection` is a separate state model in `src/types/colorCorrection.ts`; `RuntimeColorGrade` is attached to render layers.
- Normal and nested layer builders share `evaluateParameterSourceColorGrade(...)` through their interpolation adapters.
- The worker WebGPU compositor constructs `ColorPipeline` in `src/services/render/workerGpuVideoFrameCompositor.ts`; `src/engine/render/Compositor.ts` applies it before complex generic effects.
- Waveform, histogram, and vectorscope panels read the final rendered texture through `src/components/panels/scopes/useScopeAnalysis.ts`. General scopes refresh at roughly 15 fps; the combined RGB Parade uses a 10 fps refresh budget and skips unchanged paused frames.
- `src/engine/core/RenderTargetManager.ts` uses two `rgba8unorm` effect temporary textures.

---

## Runtime Details

- Persistence is explicit: `ProjectClip` includes `colorCorrection` in `src/services/project/types/composition.types.ts`, and project save/load clone it in `src/services/project/projectSave.ts` and `src/services/project/load/loadTimelineHydration.ts`.
- `ColorCorrectionState` is independent of the generic `EffectType` registry. Primary/Wheels are realtime grade nodes; Input, Output, Source, Alpha Output, Parallel/Layer/Key Mixer, Splitter, and Combiner are structural graph nodes.
- `buildClipNodeGraphDocument(...)` exposes the active color version as the Color view of the same canonical clip `NodeGraphDocument` used by the general Node Workspace. The color state remains authoritative; the document is a typed projection, not duplicate persistence.
- `getInterpolatedColorCorrection(...)`, nested layer construction and export use the shared pure parameter-source/color evaluator. Keyframes are sampled before the effective grade is compiled; driven values are not overwritten by a second keyframe pass.
- Color mutations generally replace the clip through `updateColorCorrection(...)` and invalidate the layer cache. `setColorWorkspaceViewport(...)` updates the stored UI viewport without calling `invalidateCache()`.
- `ColorPipeline` keeps uniform buffers by layer key and uses `queue.writeBuffer(...)`, but creates a bind group for every `applyGrade(...)` call.
- The `workspaceViewport` field and optional workspace mode belong to `ColorEditor`.

---

## Product Goal

The Color editor supports two presentations of one `ColorCorrectionState`:

| Mode | Current purpose |
|---|---|
| **Nodes** | Resolve-inspired, rewireable graph with typed image/key ports, draggable nodes, structural nodes, and removable edges |
| **List** | Ordered editable-node list plus controls for the selected node |

Both views edit the same active grade version. The runtime follows the first serial route from Input to Output; parallel branches are retained in state but logged and reduced to the first branch at compilation.

### View Mode Contract

`ColorCorrectionState` stores versions, nodes, edges, active version, selected node, view mode, and viewport. The renderer receives the compiled `RuntimeColorGrade`, not the editor UI state.

List and Nodes preserve the active version and selected node. There is no branch/mixer list representation, and serial node order is changed by graph connections rather than a list drag/reorder control.

---

## Core UX

### Properties Panel Integration

`src/components/panels/properties/index.tsx` registers the `color` tab and lazy-loads `src/components/panels/properties/ColorTab.tsx`. It is available for supported visual clips, and hidden for audio, camera, light, splat-effector, and motion-adjustment clips.

Supported clips keep the inner Color tab in every theme. The hidden Resolve
theme presents it as **Image** and also provides the dockable **Color Controls**
surface. Both routes edit the same `ColorCorrectionState`.

`Effects` remains the generic effects surface. `Color` is the clip-grade surface.

### Two Editing Surfaces

The Properties Color tab remains available in general editing layouts. The factory **Color** workspace reuses the existing Preview, node editor, grading controls, scopes, and keyframe modules in separate dock panels rather than duplicating them in one monolithic component. Its **Color Nodes** panel (also under **Color → Color Nodes** in the panel menu) is another interface to the same `ColorCorrectionState`, including the existing grade versions and keyframes. The general **Nodes** editor is a separate direct entry at the top of the panel menu.

The Color workspace is available from the bottom workspace bar and contains:

- a DaVinci-inspired icon-only panel bar directly below the main toolbar, using the same chrome color as the bottom workspace bar and showing the project name in the center;
- panel toggles for Media, Clips, Mini Timeline, Color Nodes, and Properties, with Properties opening directly on Effects; LUTs and Export are visible disabled placeholders, while Gallery and Lightbox are intentionally omitted;
- an upper row where Media, Preview, Nodes, and Properties share the available width, with Preview always retained and no more than three panels visible at once; opening a fourth automatically closes another optional panel;
- a compact Clips strip with codec/file-type labels, red selection, a rainbow number badge only when the active grade is non-neutral, and a source-aware right-click menu;
- a Mini Timeline with ruler scrubbing, a draggable Resolve-style playhead, compact clip bars, and no clip names or thumbnails;
- Color Controls beside the docked Scopes/Keyframes group.

The panel-bar buttons use short centered separators. Hover and active state do not add a background or underline; only the icon becomes white. Clips and Mini Timeline remain in their compact rows below the Preview row and do not count toward its three-panel limit. Toggling either compact row adjusts the Color root split by that row's exact fixed extent, so the lower tools stay visually anchored while the workspace grows or contracts upward.

The Preview owns a fixed bottom transport row in this workspace. Playback controls, quality, transparency, overlays, mute, loop, and four-part timecode remain visible when the viewer is resized. Timeline playback is owned by the editor shell instead of the full Timeline panel, so it continues across Video/Color layout switches and keeps the Preview transport and Mini Timeline playheads synchronized even when the full Timeline is not mounted.

Clips uses a fixed content height. Mini Timeline starts at the two-track height and grows by one complete 16-pixel row for every additional video track, so every track remains visible without a vertical scrollbar. Their dock dividers proxy drag movement to the nearest flexible ancestor: the compact panels retain their content height while the surrounding Preview and Color Controls regions absorb the resize. The factory Color layout starts at a 50/50 upper/lower split; Color Controls remains freely resizable.

Right-clicking a tile selects that clip without moving the playhead and opens the Color clip menu. The menu switches or creates local grade versions, keeps only the active version, adds a timeline marker at the current playhead, changes the existing source/media label color, opens Nodes or Clip Properties, reveals imported media in the Media panel, controls video proxy generation, and refreshes poster plus timeline thumbnails for every unique imported source represented in the strip. Clip-strip thumbnails apply the active compiled grade to the source thumbnail, while node-card thumbnails preview the cumulative grade only through that node. Source label colors remain shared by all clip occurrences, and markers remain composition-timeline markers; the menu does not emulate per-occurrence colors or clip-relative markers.

Color Controls supports multiple independent dock instances. Its Primaries
surface responds to its panel container rather than the browser width: wide
panels show the horizontal wheel strip; at 668 pixels or narrower the scalar
fields collect at the top and the wheels form two columns; at 340 pixels or
narrower the wheels form one column. The portrait surface scrolls vertically,
and its minimum dock width is 168 pixels so numeric readouts are never clipped.

### Color Tab Layout

The toolbar provides List/Nodes switching, grade bypass, reset all color keyframes, Add Primary, Add Wheels, Reset, and Disconnect for a selected edge. The list shows editable nodes with enable, reset, and delete controls; the selected node's inspector provides its parameter controls.

### Node View

The Color layout opens the node graph automatically. New color state starts as `Input -> Primary -> Output`; Input and Output are fixed anchors and **Original Size** restores the default view with them at the far left and right. Grade cards use the selected clip thumbnail at its native aspect inside a 16:9 preview region, straight connection lines, green image ports, and blue key/matte ports. Blue is the key/alpha signal, not an extra RGB image channel.

In the workspace, middle-button drag pans the canvas and its grid, left-button drag on empty space performs marquee selection, and the wheel scrolls vertically at a reduced rate. Node dragging and panning update the DOM once per animation frame and commit persistent state only when the gesture ends. Right-clicking the canvas exposes Resolve-style reset, Add Node, Add Source/Alpha Output, zoom, display, and cleanup actions; right-clicking a connection exposes **Delete Edge**. The Properties tab retains its compact, locked presentation.

### List View

The List view renders the active version's editable nodes in saved node order. It does not flatten branches or expose HDR/Log, curves, HSL, windows, mixer, or output-transform controls.

---

## Canonical Data Model

Color state is defined in `src/types/colorCorrection.ts` and is stored on `TimelineClip.colorCorrection` and serialized clip/project types. Its current shape includes `version: 1`, `enabled`, `activeVersionId`, `versions`, and `ui`. `ui` also persists the workspace viewport and thumbnail/label display mode. Remote-grade ownership and each occurrence's preserved local grade serialize with the clip; direct editor updates and resets synchronize every active remote occurrence of the same media source without overwriting per-clip UI viewport state.

Each version has nodes, typed-port edges, and an output node id. `ColorCorrectionState.ui` persists List/Nodes mode, selected node, display mode, and the workspace viewport.

`Layer.colorCorrection` holds an interpolated `RuntimeColorGrade`; `RuntimeColorGrade` contains a combined primary value, the serial `primaryNodes` values, node ids, diagnostics, and a graph hash.

---

## Node Types

| Node Type | Controls |
|---|---|
| `primary` | Exposure, contrast, pivot, shadows/highlights, lift/gamma/gain/offset, black/white, saturation, vibrance, hue, temperature, tint |
| `wheels` | RGB and luma controls for lift, gamma, gain, and offset |
| `input`, `output` | Fixed structural graph anchors |
| `source`, `alpha-output` | Additional image source and key/alpha destination |
| `parallel-mixer`, `layer-mixer` | Multi-input image structure |
| `key-mixer` | Multi-input key/matte structure |
| `splitter`, `combiner` | RGB channel structure |

---

## Render Architecture

`compileRuntimeColorGrade(...)` in `src/types/colorCorrection.ts` walks the active graph from Input to Output, passes through supported structural nodes, ignores disabled and neutral nodes, compiles Primary/Wheels only, and limits compilation to eight realtime grade nodes. Missing anchors, open chains, cycles, and branches produce diagnostics and fall back to saved node order or the first serial branch.

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

Waveform, Histogram, Vectorscope, and RGB Parade analyze the final rendered texture. The Color workspace docks the scope surface beside Color Controls and uses a Resolve-style accessible popup selector to switch the active scope without leaving the grading layout. Parade renders all three channels in one GPU analysis/render pass rather than mounting three independent scopes. Waveform analysis computes only the channels needed by the active mode, adaptively reduces vertical source sampling for large frames while retaining exact horizontal coverage, and avoids repeated analysis of an unchanged paused frame. A settled panel resize triggers one paused-frame refresh. There is no before/after source, matte view, clipping overlay, or selected-node scope source.

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
  ColorGraphContextMenu.tsx
  ColorVersionRow.tsx
  useColorGraphCanvasInteraction.ts
  useColorGraphNodeDrag.ts
  useInitialColorGraphLayout.ts
  colorGraph.css
  colorTab.css
src/components/panels/color-workspace/
  ColorWorkspaceTopBar.tsx
  colorWorkspacePanelLayout.ts
  ColorDockPanels.tsx
  ColorClipStrip.tsx
  ColorClipContextMenu.tsx
  ColorCompactTimeline.tsx
  ColorScopesPanel.tsx
  ColorKeyframesPanel.tsx
  ColorCurvesPanel.tsx
  ColorToolDock.tsx
src/components/preview/PreviewTransport.tsx
src/stores/timeline/colorCorrectionSlice.ts
```

The store supports create/reset/enable/select/add/remove/connect/disconnect/move/rename nodes and duplicate/delete/select versions.

---

## Realtime Rules

Numeric grade changes rebuild the runtime grade in store/layer construction and update a persistent GPU uniform buffer with `queue.writeBuffer(...)`. Each compiled node addresses its own uniform rows, so adding a second Corrector preserves the preceding node's values. The pipeline itself is created once per compositor resource set. Bind groups are not cached per layer.

Packaged-project autosaves stream `.msproj` ZIP input and output in bounded chunks. CRC/compression and File System Access writes therefore yield between chunks instead of assembling and copying one large archive on the UI thread; sustained Color-canvas interaction remains responsive while autosave runs.

The shader clamps output to `[0, 1]`.

---

## Presets And Versions

`duplicateColorVersion(...)`, `deleteColorVersion(...)`, and `setActiveColorVersion(...)` operate on `ColorCorrectionState.versions`; only the active version compiles.

Timeline context-menu Copy Color/Paste Color copies the grade and its `color.*` keyframes through `src/stores/timeline/clipboardSlice.ts`.

---

## Compatibility And Migration

Generic color effects and the Color tab are separate. Existing effect arrays continue to render through the generic effects pipeline.
