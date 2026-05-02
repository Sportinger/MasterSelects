# Professional Color Correction Plan

[Back to Index](./README.md)

This plan turns the current Color Correction foundation into a professional grading workflow. It is intentionally more tactical than `Color-Correction.md`: it defines what is missing, the order to build it, and the acceptance criteria for each slice.

Current status, May 2026:

- MasterSelects already has clip-local `ColorCorrectionState` with versions, nodes, edges, keyframe paths, and persistence.
- The Color tab and Color Workspace edit the same state and currently expose scalar Primary controls plus a dedicated Wheels node.
- Preview, nested composition rendering, and export already receive runtime color grades.
- The runtime compiler currently supports serial `primary` and `wheels` nodes in the fused primary/wheels shader path.
- The GPU path currently uses `rgba8unorm` temp targets and clamps output after the primary pass.
- Current color keyframe paths are exactly `color.{versionId}.{nodeId}.{paramName}`. Nested parameter paths such as `color.version.node.lift.r` do not parse today.
- `RuntimeColorGrade` currently exposes `nodeIds`, `primary`, `primaryNodes`, and `diagnostics`; it is not yet a pass-plan object.
- Project save/load already persists `colorCorrection`, but there are no project-level LUT, still, or color-preset asset manifests.

Implemented slice:

- `ColorNodeType` now includes `wheels`.
- Node creation/reset uses a node-type factory with node-specific default params.
- Wheels use flat numeric keys such as `liftR`, `gammaG`, `gainY`, and `offsetB`, so existing keyframe, MIDI, and static-write paths continue to work.
- The Color UI can add Wheels nodes and edit Lift, Gamma, Gain, and Offset via chroma wheels, luma sliders, and numeric RGB channels.
- `ColorPipeline` packs wheel channels into the fused realtime shader path.
- Focused store/render tests plus lint and build pass against this slice.

## Codebase Alignment Notes

These constraints are specific to the current implementation and should guide the first engineering slices:

- `src/types/colorCorrection.ts` is both the state/type module and the current compiler location. Moving compilation to `src/engine/color/ColorGradeCompiler.ts` should keep `compileRuntimeColorGrade(...)` exported as a compatibility wrapper until all callers are migrated.
- `ColorNodeType` currently supports `input | primary | wheels | output`. Future node types still need entries in the node factory, node-specific defaults, node-specific reset behavior, and UI rendering by node type.
- `ColorParamValue` is currently `number | boolean | string`. Keep animated scalar values as flat params in phase 1. Store larger data such as curves and LUT references as small metadata objects only after widening this type and auditing serialization.
- `ColorProperty` and `parseColorProperty(...)` currently require exactly four dot-separated segments. Use flat param keys such as `liftR`, `liftG`, `liftB`, and `liftY` first. If nested property paths are introduced later, update `createColorProperty`, `parseColorProperty`, keyframe cleanup matchers, timeline keyframe labels, interpolation, MIDI mapping, and tests together.
- `PRIMARY_COLOR_PARAM_DEFS` and `WHEEL_COLOR_PARAM_DEFS` are now split, while the runtime params are still packed through the existing `RuntimePrimaryColorParams` shape. Curves, LUTs, and qualifiers need their own parameter definitions and eventually a less Primary-named runtime contract.
- `MAX_RUNTIME_PRIMARY_NODES` currently limits editable nodes in the UI. Once multiple node types exist, replace this with compiler/pass-specific limits so a LUT or qualifier does not count as a primary node.
- `compileRuntimeColorGrade(...)` returns `undefined` for neutral grades, which also drops diagnostics if unsupported nodes are neutral or no supported nodes compile. Professional diagnostics need either a separate diagnostics selector or a runtime grade object that can carry diagnostics without applying a pass.
- `ColorPipeline` keeps per-layer uniform buffers but creates a bind group during `applyGrade(...)`. A realtime grading slice should cache bind groups or move bind-group ownership into a compiled pass plan.
- `RenderTargetManager` currently owns only two `rgba8unorm` effect temp textures. Float grading, mattes, selected-node outputs, and LUT/curve passes need a separate scratch allocator used by both `Compositor` and `NestedCompRenderer`.
- Scopes currently read `engine.getLastRenderedTexture()`. Selected-node, before-color, and matte scopes require new engine APIs rather than overloading the final-output texture.
- The project folder constants currently include `Cache/thumbnails`, `Cache/splats`, and `Cache/waveforms`, but no LUT or still folders. Add folder constants and project JSON manifests before implementing persistent LUT/still workflows.

## Product Goal

MasterSelects should feel closer to a real grading page than a generic effects stack:

- fast Primary correction in the Properties Color tab
- a dockable Color Workspace for nodes, scopes, versions, stills, and detailed controls
- realtime playback for common grades
- preview/export parity
- non-destructive clip grades that can be copied, versioned, bypassed, compared, keyframed, and saved as presets

## Professional Gaps

| Gap | Current State | Needed State |
|---|---|---|
| Color wheels | Dedicated Wheels node with RGB chroma pads, luma sliders, numeric channels, keyframes, MIDI labels, and fused shader support | Per-wheel reset, stronger visual polish, pixel tests, and precision improvements |
| Curves | No color-curve node | Luma/RGB curves, plus hue-vs-hue, hue-vs-sat, hue-vs-luma, sat-vs-sat |
| Secondaries | No qualifiers or windows | HSL qualifier, matte view, power windows, feather, invert, node-local masks |
| LUTs | No LUT node or parser | `.cube` import, LUT asset cache, intensity, input/output range |
| Graph compiler | Serial primary only | Pass graph with fused primary/wheels/curves, explicit LUT/qualifier/mixer passes |
| Precision | `rgba8unorm` temps and early clamp | `rgba16float` color scratch textures behind a feature flag |
| Scopes | Final-output scopes only | final, before-color, selected-node output, matte, clipping indicators |
| Compare/reference | Grade versions exist, no still workflow | stills, reference wipe/split, copy/paste grade, presets |
| Color management | No explicit input/output transform | output transform node, display gamma/gamut policy, legal/full range controls |
| Tests | Store tests plus layer-propagation tests | compiler, shader pixel tests, preview/export parity, UI workflows |

## Architecture Direction

The Color Correction system should remain separate from generic effects.

Recommended render order for each layer:

```text
source texture
  -> input transform
  -> color correction graph
  -> generic clip effects
  -> masks, transforms, blend mode, compositing
```

The color graph can contain a clip-level output transform as its final node. A project/display output transform is different: it belongs after compositing in the output pipeline and should be planned as a separate project-level pass.

The renderer should receive a compiled plan, not UI state:

```ts
interface RuntimeColorGrade {
  enabled: boolean;
  graphHash: string;
  passes: ColorPassPlan[];
  diagnostics: ColorGradeDiagnostic[];
}

interface ColorPassPlan {
  id: string;
  kind:
    | 'fused-primary'
    | 'curves'
    | 'qualifier'
    | 'power-window'
    | 'lut'
    | 'mixer'
    | 'output-transform';
  nodeIds: string[];
  uniformData: Float32Array;
  textureBindings?: ColorTextureBinding[];
  matteSourceId?: string;
  debugOutputId?: string;
}
```

Numeric parameter changes should update uniform buffers only. Topology changes can rebuild the plan.

## Phase 0: Contract Migration

Goal: prepare the current codebase for professional nodes without breaking existing projects.

Build:

- Add a node factory that creates default params for each color node type.
- Expand `ColorNodeType` behind tests, starting with `primary` and `wheels`.
- Split Primary scalar param definitions from node-specific UI param definitions.
- Keep `compileRuntimeColorGrade(...)` as the public helper used by existing layer builders while introducing an internal compiler module.
- Add a compatibility adapter from the current `RuntimeColorGrade` shape to the future `passes` shape, or migrate all consumers in one controlled change.
- Add migration logic inside `ensureColorCorrectionState(...)` for old Primary scalar params.
- Add tests for property parsing, node creation, reset, serialization, interpolation, preview/export propagation, and diagnostics retention.

Acceptance criteria:

- Existing projects with scalar Primary grades render unchanged.
- Existing tests that assert color grade propagation continue to pass or are intentionally updated with the new runtime contract.
- Unsupported-node diagnostics can be surfaced even when no color pass is applied.
- New node types can be added without changing `ColorEditor` and `compileRuntimeColorGrade(...)` in lockstep.

## Phase 1: Real Primary Controls

Goal: make the current Primary node feel like a color tool, not a slider list.

Build:

- Add a separate `wheels` node that can fuse with Primary when serial and unqualified.
- Implement Lift, Gamma, Gain, and Offset wheels.
- Each wheel has:
  - 2D chroma puck
  - luma/value slider
  - numeric RGB fields or fine controls
  - reset for that wheel
  - optional reset for all wheels
- Preserve scalar keyframe support initially by storing wheel channels as separate numeric properties:

```text
color.{versionId}.{nodeId}.liftR
color.{versionId}.{nodeId}.liftG
color.{versionId}.{nodeId}.liftB
color.{versionId}.{nodeId}.liftY
```

Implementation notes:

- Add typed params for wheel channels instead of overloading the existing scalar `lift/gamma/gain/offset`.
- Keep old scalar params readable for migration/backward compatibility.
- The first shader implementation can pack wheels into the existing fused primary uniform block.
- UI should use canvas/SVG for the wheel, not a set of three unrelated sliders.
- Add the wheel renderer beside the existing `DraggableNumber` controls and keep `KeyframeToggle` / `MIDIParameterLabel` attached to the flat scalar channel keys.
- The current uniform pack uses eight `vec4` rows per realtime color node so scalar Primary values and flat RGB/Y wheel channels fit in the fused shader path.

Acceptance criteria:

- A user can warm/cool shadows, mids, and highlights independently.
- Resetting one wheel does not reset the full node.
- Wheel changes are keyframable and MIDI-addressable.
- Preview and export match for a simple wheel grade.

## Phase 2: Float Color Scratch Pipeline

Goal: avoid destructive 8-bit grading while the system is still simple.

Build:

- Add `useFloatColorPipeline` feature flag.
- Add `rgba16float` color scratch textures to a dedicated `ColorScratchPool`.
- Keep final canvas/output in `rgba8unorm` initially.
- Avoid clamping between color passes unless a node explicitly requests legal-range clamp.
- Fall back to `rgba8unorm` if the device path cannot support the float target.

Implementation notes:

- Do not replace every render target at once. Start with source preprocessing temps used by ColorPipeline.
- Keep generic effects on existing temps until their shaders are audited for float behavior.
- Add diagnostics to stats/debug output: color format, pass count, float fallback reason.
- Make `ColorPipeline` render target format configurable; it is currently hardcoded to `rgba8unorm`.
- Wire `ColorScratchPool` through both main `Compositor` and `NestedCompRenderer`, not only the main preview path.

Acceptance criteria:

- Heavy exposure/contrast pushes do not band as quickly in preview.
- The app still renders on browsers/GPUs that only take the fallback.
- Export uses the same precision policy as preview for color passes.

## Phase 3: Curves

Goal: add the correction tool editors expect after wheels.

Build:

- Add `curves` node type.
- Support luma curve and RGB curves first.
- Add curve editor with points, bezier handles, reset, channel selector, and numeric point edits.
- Compile curves as either:
  - sampled 1D LUT texture, preferred
  - fixed uniform sample table, fallback

Later in the same phase:

- hue-vs-hue
- hue-vs-sat
- hue-vs-luma
- sat-vs-sat

Acceptance criteria:

- Curves can be placed before or after wheels.
- Curves can be bypassed per node.
- Neutral curve is pixel-identical or within test tolerance.
- Curve LUT generation is cached and not rebuilt every frame.
- Curve point animation should wait until scalar color-property parsing is widened or a stable flat point-key convention exists.

## Phase 4: LUT Workflow

Goal: support common creative and technical LUT use.

Build:

- Add `lut` node type.
- Add `.cube` parser for 1D and 3D LUTs.
- Store LUTs as project assets by content hash, not as large clip payloads.
- Add LUT intensity, input range, output range, interpolation mode, and missing-asset diagnostics.
- Cache GPU LUT textures by hash.

Implementation notes:

- Add `CACHE_LUTS` or `COLOR_LUTS` to `PROJECT_FOLDERS` and `PROJECT_FOLDER_PATHS`.
- Add a project JSON manifest for LUT assets: hash, name, relative path, dimensions, type, interpolation, and source metadata.
- Store only LUT references in `ColorNode.params`, for example `lutHash` plus scalar `intensity`.
- Reuse the existing project `writeFile` / `readFile` facade instead of adding browser-only file APIs.

Acceptance criteria:

- Importing the same LUT twice reuses the cached asset.
- Missing LUTs do not crash rendering; the node bypasses with a visible diagnostic.
- LUT intensity blends correctly from 0 to 100%.
- Export and preview use the same LUT data.

## Phase 5: Secondaries

Goal: make selective grading possible.

Build:

- Add `hsl-qualifier` node:
  - hue range
  - saturation range
  - luma range
  - softness
  - clean black / clean white
  - invert
  - matte view
- Add `power-window` node:
  - ellipse, rectangle, linear gradient
  - position, size, rotation
  - feather
  - invert
  - node-local mask output
- Add matte scratch textures.
- Add selected-node debug outputs for matte and result preview.

Implementation notes:

- Qualifiers and windows should produce matte outputs that downstream nodes can consume.
- The graph compiler should make matte lifetime explicit so scratch textures can be reused.
- Window coordinates should be source-normalized, not only output-pixel based.

Acceptance criteria:

- A user can isolate a color range, view the matte, soften it, and grade only that range.
- A user can apply a window to a Primary/Wheels node.
- Matte view can feed preview and scopes.
- Disabled qualifier/window nodes are skipped cleanly.

## Phase 6: Node Graph Compiler

Goal: make the graph model real, not just stored UI state.

Build:

- Add `ColorGradeCompiler`.
- Validate cycles, missing nodes, open chains, unsupported ports, and format requirements.
- Compile serial chains into pass plans.
- Fuse compatible serial nodes:
  - primary
  - wheels
  - simple curves when represented as LUT
- Add parallel mixer and layer mixer nodes after serial graph support is stable.
- Emit structured diagnostics for the UI.

Acceptance criteria:

- Branching no longer silently renders only the first branch.
- Unsupported graph sections show diagnostics but do not break the frame.
- Numeric edits do not rebuild pipelines.
- Topology edits rebuild the plan predictably.

## Phase 7: Scopes, Compare, And Stills

Goal: give graders the feedback tools they need.

Build:

- Add ColorPipeline debug texture registry.
- Add scope source modes:
  - final output
  - before color
  - selected node output
  - selected matte
- Add clipping indicators.
- Add preview compare modes:
  - bypass
  - wipe
  - split
  - side-by-side
- Add still/reference gallery:
  - grab still
  - compare to still
  - copy grade from still
  - paste grade to selected clips

Implementation notes:

- Add `COLOR_STILLS` or `CACHE_COLOR_STILLS` to project folder constants before promising persistent stills.
- Store still metadata in project JSON and image data in project files.
- Add an engine API such as `getColorDebugTexture(sourceId)` instead of making scopes reach into transient render-pass views.

Acceptance criteria:

- Scope source matches preview compare mode.
- Selected-node scope output is stable long enough for throttled scope rendering.
- Stills survive project save/load.
- Copy/paste grade preserves nodes, versions, and linked LUT references.

## Phase 8: Color Management And Output

Goal: make grades predictable across source types and export targets.

Build:

- Add `input-transform` and `output-transform` node support.
- Define project/timeline display transform policy.
- Add common transforms:
  - sRGB / Rec.709 display gamma
  - full/legal range clamp
  - basic log-to-Rec.709 transforms where source metadata is known
- Add source metadata hooks for media runtime.

Implementation notes:

- Separate clip-level input/output transform nodes from project/display output transform.
- A display transform after full compositing belongs in `OutputPipeline` or an adjacent post-composite pass, not in the per-layer color preprocessing path.

Acceptance criteria:

- Output transform is explicit and visible in the graph.
- Legal/full range behavior is testable.
- Export does not silently differ from preview.

## Phase 9: Presets And Workflow Polish

Goal: reduce repetitive grading work.

Build:

- Copy grade / paste grade.
- Apply grade to selected clips.
- Save preset to local library.
- Apply preset with missing-LUT handling.
- Rename versions and reorder versions.
- Duplicate selected node.
- Keyboard shortcuts:
  - add serial node
  - bypass selected node
  - reset selected node
  - frame graph
  - toggle compare

Acceptance criteria:

- Presets are portable without embedding huge LUT payloads.
- Applying a preset to multiple clips creates independent grade state.
- Keyboard operations work from the Color Workspace without stealing timeline shortcuts unexpectedly.

## Suggested Build Order

1. Contract migration for node factories, flat wheel params, and diagnostics retention.
2. Wheel data model and UI.
3. Fused primary/wheels shader.
4. Float color scratch textures.
5. Curves node.
6. LUT project assets and GPU cache.
7. Graph compiler pass plan.
8. Qualifier and matte scratch textures.
9. Power windows.
10. Selected-node scope routing.
11. Stills, compare, presets.
12. Input/output transforms.

This order gives users visible grading value early while reducing the risk of building complex graph features on top of an 8-bit-only pipeline.

## Test Plan

Unit tests:

- node type validation
- wheel parameter migration
- color property parsing for flat wheel properties
- optional future parser tests for nested color properties, if that migration happens
- graph cycle detection
- serial pass ordering
- branch diagnostics
- LUT parser fixtures
- preset serialization

Render tests:

- neutral primary/wheels pass
- lift/gamma/gain/offset known-color outputs
- curve neutral and simple S-curve output
- LUT identity and known transform
- qualifier matte threshold output
- window feather output
- preview/export parity

UI tests:

- wheel drag updates value and batches history
- reset wheel only
- add/delete/duplicate node
- bypass selected node
- switch List/Nodes without losing selected node
- compare mode toggles preview state
- selected-node scope source changes scope renderer input

Performance tests:

- slider drag does not create GPU pipelines per frame
- LUT upload is debounced and cached
- float fallback does not prevent rendering
- scopes stay throttled independently from playback

## Done Definition

The color system can be called professional when:

- wheels, curves, LUTs, qualifiers, windows, versions, compare, scopes, and presets are all first-class features
- grades are saved in project files and survive nested composition workflows
- preview and export match within a documented tolerance
- color passes can run in float precision when supported
- unsupported graph constructs produce diagnostics instead of broken frames
- the Properties Color tab remains fast for simple work and the Color Workspace handles serious grading without modal detours
