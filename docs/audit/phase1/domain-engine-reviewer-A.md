# Domain 1: Engine & Rendering - Reviewer A Findings

## Summary
- Files audited: 62 source files (all `.ts` in `src/engine/`, all `.wgsl` in `src/shaders/` and `src/effects/`)
- Docs reviewed: 4 (`GPU-Engine.md`, `SharedDecoderArchitecture.md`, `Export.md`, `CLAUDE.md` sections 3/7/8)
- Critical gaps found: 7
- Inaccuracies found: 12
- Missing features: 8

---

## Gap Analysis

### Undocumented Files

The following source files exist in `src/engine/` but have **no mention** in any documentation:

1. **`src/engine/render/htmlVideoPreviewFallback.ts`** - Firefox-specific workaround that copies HTML video frames to persistent textures to avoid intermittent black sampling during playback. Not mentioned in GPU-Engine.md or any doc.

2. **`src/engine/render/layerEffectStack.ts`** - Splits layer effects into inline (brightness/contrast/saturation/invert) vs. complex effects for the compositor. Core to the inline vs. complex effect classification described in GPU-Engine.md but the actual module is not documented.

3. **`src/engine/render/RenderDispatcher.ts`** - The doc mentions it in the architecture tree and render loop section, but its significant `renderToPreviewCanvas()` and `renderCachedFrame()` methods are undocumented. The `renderToPreviewCanvas()` method performs independent ping-pong compositing for multi-composition preview, which is a major feature.

4. **`src/engine/managers/outputWindowPlacement.ts`** - Randomized popup placement logic for output windows. Added post-March-8 (commit `1c00b439`). Not documented.

5. **`src/engine/export/types.ts`** - Contains `FrameContext`, `LayerTransformData`, `BaseLayerProps`, `getFrameTolerance()`, `getKeyframeInterval()`. None documented in Export.md.

6. **`src/engine/webCodecsTypes.ts`** - Listed in GPU-Engine.md directory tree but its contents/purpose are not documented.

7. **`src/engine/video/VideoFrameManager.ts`** - Listed in architecture tree as "RVFC frame readiness tracking" but no documentation of its API or behavior.

### Inaccurate Documentation

1. **`docs/Features/GPU-Engine.md` line 139 (WebGPUContext initialization)**:
   - Doc says: "Device: default limits (no custom maxTextureDimension2D)"
   - Code (`WebGPUContext.ts:76-78`): `requiredLimits: { maxTextureDimension2D: 4096 }` — an explicit limit IS set.

2. **`docs/Features/GPU-Engine.md` line 8 (featureFlags.ts)**:
   - Doc says: `useFullWebCodecsPlayback: true`
   - Code (`featureFlags.ts:8`): `useFullWebCodecsPlayback: false` — the flag is currently **false**. The doc shows it as true.

3. **`docs/Features/GPU-Engine.md` line 371 (Shader line counts)**:
   - Doc says: `output.wgsl` has 71 lines
   - Actual: `output.wgsl` has **83 lines** (stacked alpha mode was added post-doc update)

4. **`docs/Features/GPU-Engine.md` line 381 (effect shader line count)**:
   - Doc says: "30 effect shaders ~954 lines"
   - Actual: 31 shader files (30 effect shaders + `common.wgsl`) totaling **1,108 lines** for effect shaders + **154 lines** for `common.wgsl`. The total is ~1,262 lines, not ~954.

5. **`docs/Features/GPU-Engine.md` line 371 (Total WGSL lines)**:
   - Doc says: "Total WGSL Code: ~2,400 lines"
   - Actual: Core shaders = 1,303 lines + effect shaders = 1,108 lines + common.wgsl = 154 lines = **~2,565 lines**. Additionally, the CompositorPipeline.ts contains ~375 lines of inline WGSL (copy, external copy, external composite shaders) that are not counted.

6. **`docs/Features/GPU-Engine.md` (Render Targets section)**:
   - Doc says: "8 textures total"
   - Actual: 7 textures in RenderTargetManager (ping, pong, independentPing, independentPong, effectTemp1, effectTemp2, black). The doc counts 8 but lists only 7 categories. The count is wrong.

7. **`docs/Features/GPU-Engine.md` (CompositorPipeline section)**:
   - Doc says: "Four GPU Render Pipelines"
   - Actual: The CompositorPipeline has exactly 4 pipelines (standard composite, external composite, standard copy, external copy). This is correct. However, the doc fails to mention that the **external composite shader is inlined in CompositorPipeline.ts** (~375 lines of WGSL), not imported from `composite.wgsl`. The `composite.wgsl` file is the standard composite shader only.

8. **`docs/Features/GPU-Engine.md` (Output Pipeline section)**:
   - Doc says: "Dual uniform buffers (grid-on / grid-off)"
   - Actual: The OutputPipeline has **three** uniform buffers: `uniformBufferGridOn`, `uniformBufferGridOff`, and `uniformBufferStackedAlpha`. Stacked alpha mode (mode=2) was added for transparent video export and is undocumented.

9. **`docs/Features/Export.md` (Codec Options table)**:
   - Doc says H.264 codec string is `avc1.640028`
   - Code (`codecHelpers.ts:20`): H.264 string is `avc1.4d0028` (Main Profile, Level 4.0). The doc has the wrong string.

10. **`docs/Features/Export.md` (Codec Options table)**:
    - Doc only lists H.264 and VP9 codecs.
    - Code supports 4 codecs: H.264, H.265 (HEVC), VP9, AV1. GPU-Engine.md has the correct list. Export.md is missing H.265 and AV1.

11. **`CLAUDE.md` Section 7 (Texture Types)**:
    - Doc says: "Video (HTMLVideoElement): `texture_external` via `importExternalTexture` (zero-copy)"
    - Reality is more nuanced: On Firefox, HTMLVideoElement textures are NOT imported as external textures. Instead, `htmlVideoPreviewFallback.ts` copies them to persistent `texture_2d<f32>` textures. The doc does not mention this Firefox-specific path.

12. **`docs/Features/Export.md` (Export System V2 section)**:
    - Doc says V2 components exist at `src/engine/export/v2/` (SharedDecoderPool.ts, ExportPlanner.ts, etc.)
    - Actual: **No `v2/` directory exists**. The glob `src/engine/export/v2/**` returns no files. The SharedDecoderArchitecture.md correctly marks this as "NOT IMPLEMENTED" but Export.md section "Export System V2" lists specific source files that do not exist.

### Missing Features (post-2026-03-08)

These features were added in recent commits but are not reflected in documentation:

1. **Stacked alpha video export** (commit `f2a84a50`, `8326ad14`):
   - `ExportCanvasManager` supports `stackedAlpha` mode where canvas height is doubled (RGB top, alpha-as-luma bottom).
   - `OutputPipeline` has a third uniform buffer mode (`stackedAlpha`, mode=2).
   - `output.wgsl` has stacked alpha logic (lines 49-59).
   - **Not documented anywhere.**

2. **Black frame flash prevention during playback** (commit `ee7e2329`):
   - `RenderDispatcher.render()` has `lastRenderHadContent` tracking to hold the last frame during transient decoder stalls on Windows/Linux instead of flashing black.
   - **Not documented.**

3. **VRAM leak fix** (commit `0242668d`):
   - `RenderTargetManager.createPingPongTextures()` no longer calls `.destroy()` on old textures to avoid "Destroyed texture used in a submit" warnings. Instead nulls references for GC.
   - **Not documented in troubleshooting or architecture.**

4. **Randomized output window placement** (commit `1c00b439`):
   - New `outputWindowPlacement.ts` module with center-exclusion zone logic.
   - **Not documented.**

5. **Firefox HTML video preview fallback** (commit `be29f4da`):
   - `htmlVideoPreviewFallback.ts` is a Firefox-only path that copies video frames to persistent textures to avoid intermittent black sampling.
   - **Not documented.**

6. **Enhanced scrub pipeline telemetry** (commits `535786fc`, `a472c428`, `8b057c76`):
   - `vfPipelineMonitor` and `wcPipelineMonitor` recording in LayerCollector and RenderDispatcher.
   - `scrubSettleState` integration for scrub-to-pause transitions.
   - **Not documented.**

7. **Playback stall hold frame logic** (commit `ee7e2329`):
   - `LayerCollector.getPlaybackStallHoldFrame()` provides "last resort" cached frames during playback decoder stalls.
   - **Not documented.**

8. **Scrub grace period** (commit `8b057c76`):
   - `LayerCollector.scrubGraceUntil` keeps HTML preview path active for ~150ms after scrub stops so settle-seek can complete.
   - **Not documented.**

### Stale References

1. **GPU-Engine.md line 371**: Output.wgsl line count (71 vs 83 actual).
2. **GPU-Engine.md line 381**: Effect shader line count (~954 vs ~1,108 actual).
3. **GPU-Engine.md line 371**: Total WGSL line count (~2,400 vs ~2,565+ actual, excluding inline shaders).
4. **GPU-Engine.md line 266**: Render target count "8 textures total" should be 7.
5. **GPU-Engine.md line 363**: `useFullWebCodecsPlayback: true` should be `false`.
6. **Export.md line 110**: H.264 codec string `avc1.640028` should be `avc1.4d0028`.
7. **Export.md lines 415-419**: V2 source file paths do not exist on disk.

### Documentation Quality Issues

1. **GPU-Engine.md lacks documentation of inline WGSL shaders**: The CompositorPipeline.ts contains ~375 lines of inlined WGSL (copy shader, external copy shader, full external composite shader with all 37 blend modes). These are significant pieces of GPU code not documented in the Shader Capabilities section.

2. **GPU-Engine.md render pipeline section is incomplete**: The documented pipeline (Section 8 of CLAUDE.md) shows a clean 7-step flow, but the actual `RenderDispatcher.render()` has significant additional logic:
   - Preview signature tracking for telemetry
   - Scrub settle state integration
   - Export canvas rendering with stacked alpha mode
   - Active render target iteration with slice pipeline integration
   - Playback stall hold-frame logic

3. **LayerCollector documentation oversimplifies**: The doc describes 5 priority sources but the actual code has complex decision trees for scrub/pause/drag/settle states with multiple fallback paths (scrub-cache, seeking-cache, emergency-hold, same-clip-hold, playback-stall-hold, not-ready-scrub-cache, gpu-cached, copied-preview, live-import, final-cache).

4. **Export.md is significantly out of date vs GPU-Engine.md**: Export.md only lists H.264 and VP9, mentions a V2 system with nonexistent source files, and has the wrong H.264 codec string. GPU-Engine.md has more accurate codec information.

5. **No documentation of the `performanceMonitor` service**: `RenderDispatcher` calls `reportRenderTime()` from `services/performanceMonitor`. This service is not documented.

6. **No documentation of `vfPipelineMonitor` and `wcPipelineMonitor`**: These telemetry services are heavily used in LayerCollector and RenderDispatcher for debugging scrub/playback issues but are not mentioned in docs.

7. **NestedCompRenderer complexity is underdocumented**: The doc mentions "pooled ping-pong texture pairs" and "frame caching" but doesn't describe the full video handling logic inside `collectNestedLayerData()`, which mirrors the complexity of `LayerCollector` (WebCodecs, runtime providers, HTML video fallback, scrub cache, etc.).

---

## Recommended Changes

### Priority 1 (Critical - Factual Errors)

1. **Fix featureFlags value in GPU-Engine.md**: Change `useFullWebCodecsPlayback: true` to `false`.
2. **Fix H.264 codec string in Export.md**: Change `avc1.640028` to `avc1.4d0028`.
3. **Fix render target count in GPU-Engine.md**: Change "8 textures total" to 7.
4. **Remove nonexistent V2 source file references from Export.md**: The files at `src/engine/export/v2/` do not exist. Either remove the section or clearly mark all file paths as "planned, not implemented."
5. **Fix WebGPUContext initialization doc**: Change "default limits (no custom maxTextureDimension2D)" to "maxTextureDimension2D: 4096".

### Priority 2 (High - Missing Features)

6. **Document stacked alpha export**: Add to both GPU-Engine.md (OutputPipeline section, output.wgsl section) and Export.md.
7. **Document Firefox video preview fallback**: Add `htmlVideoPreviewFallback.ts` to GPU-Engine.md under Video Decoding or Texture Management.
8. **Document black frame flash prevention**: Add to GPU-Engine.md under Render Loop or Troubleshooting.
9. **Add H.265 and AV1 codecs to Export.md Codec Options table**.
10. **Document OutputPipeline's three uniform buffer modes** (normal, grid, stackedAlpha) instead of two.

### Priority 3 (Medium - Stale Counts)

11. **Update shader line counts**: output.wgsl = 83, effect shaders total = ~1,108, total WGSL = ~2,565+.
12. **Document inline WGSL in CompositorPipeline.ts**: Note that ~375 lines of shader code (copy, external copy, full external composite) are inlined rather than in separate .wgsl files.

### Priority 4 (Low - Structure/Completeness)

13. **Document `outputWindowPlacement.ts`** in OutputWindowManager section.
14. **Document `layerEffectStack.ts`** in the Inline vs Complex Effects section.
15. **Document telemetry services** (`vfPipelineMonitor`, `wcPipelineMonitor`, `performanceMonitor`) in a new Debugging/Telemetry section.
16. **Document `RenderDispatcher.renderToPreviewCanvas()`** and `renderCachedFrame()` in the Render Loop section.
17. **Document scrub grace period and playback stall hold logic** in LayerCollector section.
18. **Document export types** (`FrameContext`, `FrameTolerance`, `KeyframeInterval`) in Export.md.
