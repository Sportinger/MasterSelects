# Color-Correction.md — audit 2026-08-02

## Verified (spot checks that held)

- The feature is shipped as a separate clip color state with Properties List/Nodes editing, project persistence, color keyframes, MIDI labels, grade versions, and timeline Copy Color/Paste Color. Evidence: `src/types/colorCorrection.ts`, `src/components/panels/properties/index.tsx`, `src/components/panels/color/ColorEditor.tsx`, `src/services/project/projectSave.ts`, `src/services/project/load/loadTimelineHydration.ts`, and `src/stores/timeline/clipboardSlice.ts`.
- Primary and Wheels grades are applied before complex generic effects in the WebGPU compositor. Evidence: `src/engine/render/Compositor.ts` and `src/engine/color/ColorPipeline.ts`.
- The document's inline-effect, scope, and `rgba8unorm` observations held. Evidence: `src/effects/EffectsPipeline.ts`, `src/components/panels/scopes/useScopeAnalysis.ts`, and `src/engine/core/RenderTargetManager.ts`.
- The former dock panel is not registered. Evidence: no `color-workspace` or `ColorWorkspace` match in `src/types/dock.ts` or `src/components/dock/DockPanelContent.tsx`.

## Outdated or wrong (claim → reality, with file evidence)

- “A realtime WebGPU fused primary/wheels pass” → true only for up to eight enabled serial Primary/Wheels nodes; the runtime has no general fused-pass model. `ColorNodeType` is only `input | primary | wheels | output`, and `compileRuntimeColorGrade(...)` logs/reduces branches and stops at `MAX_RUNTIME_PRIMARY_NODES = 8`. Evidence: `src/types/colorCorrection.ts`, `src/engine/color/ColorPipeline.ts`.
- The planned `src/engine/color/` architecture (`ColorGradeCompiler`, `ColorScratchPool`, `ColorUniformPacker`, per-node shader files, `ColorPassPlan`) → absent. The directory contains only `ColorPipeline.ts`, which embeds one shader string and creates a bind group on every `applyGrade(...)`. Evidence: `src/engine/color/ColorPipeline.ts`.
- “Persistent uniform buffers and cached bind groups” → only persistent uniform buffers are shipped; bind groups are per-application. Evidence: `src/engine/color/ColorPipeline.ts`.
- “Nested preview and export use the same interpolated grade helper” → normal layer builders use `getInterpolatedColorCorrection(...)`, but nested layers directly call `compileRuntimeColorGrade(nestedClip.colorCorrection)`, bypassing that interpolation helper. Evidence: `src/services/layerBuilder/layerBuilderVideoLayers.ts`, `src/services/layerBuilder/layerBuilderNestedLayers.ts`, `src/stores/timeline/keyframes/keyframeEffectInterpolationActions.ts`.
- The doc’s list/graph promises (branch headers, mixers, reordering, graph diagnostics UI, HDR/Log/curves/HSL/windows/output controls) → not implemented. The list is a saved-order editable-node list and runtime branches use the first serial branch. Evidence: `src/components/panels/color/ColorNodeList.tsx`, `src/components/panels/color/ColorEditor.tsx`, `src/types/colorCorrection.ts`.
- The document’s “recommended files” and `ColorTab` location were stale. Reality: `ColorTab.tsx` is `src/components/panels/properties/ColorTab.tsx`; UI is centered on `ColorEditor.tsx`, `ColorGraphView.tsx`, `PrimaryColorControls.tsx`, and `WheelColorControls.tsx`. Evidence: those paths under `src/components/panels/`.
- “Color tab quick controls” for Waveform/Histogram/Vectorscope and before/after/matte/selected-node scope sources → absent; scopes read only `getLastRenderedTexture()` at about 15 fps. Evidence: `src/components/panels/color/ColorToolbar.tsx`, `src/components/panels/scopes/useScopeAnalysis.ts`.
- `flags.useFloatColorPipeline`, `rgba16float` color intermediates, and export precision policy → absent; existing ping/pong and effect textures are `rgba8unorm`. Evidence: `src/engine/core/RenderTargetManager.ts`, `src/engine/color/ColorPipeline.ts`.
- Preset library, LUT import/export, still/reference workflows, compare, and color-effects migration → absent. Evidence: no matching implementation under `src/components/panels/color`, `src/stores/timeline`, `src/engine/color`, or `src/services/project`.

## Noteworthy / unusual

- `setColorWorkspaceViewport(...)` persists UI viewport changes without `invalidateCache()`, unlike the grade-changing paths in the same slice. Evidence: `src/stores/timeline/colorCorrectionSlice.ts`.
- The UI and state still call the optional non-dock view a “workspace” (`workspaceViewport`, `workspace` prop), despite the dock workspace having been removed. Evidence: `src/types/colorCorrection.ts`, `src/stores/timeline/colorCorrectionSlice.ts`, `src/components/panels/color/ColorEditor.tsx`.
- Color grade compilation skips neutral nodes, so a default Color state produces no runtime grade until a parameter differs from its default. Evidence: `src/types/colorCorrection.ts`.
- Color output is clamped to `[0, 1]` in the shader, which reinforces that the current workflow is an 8-bit display-grade path rather than a high-dynamic-range intermediate pipeline. Evidence: `src/engine/color/ColorPipeline.ts`.
