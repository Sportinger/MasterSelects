# Domain 1: Engine & Rendering - Reviewer B Findings

## Summary
- Files audited: 62 source files (all of `src/engine/` + 5 `src/shaders/` + 31 effect shaders)
- Docs reviewed: 4 (`GPU-Engine.md`, `SharedDecoderArchitecture.md`, `Export.md`, `CLAUDE.md` sections 3/7/8)
- Critical gaps found: 3
- Inaccuracies found: 9
- Missing features: 4 (post-2026-03-08)

---

## Gap Analysis

### Undocumented Files

1. **`src/engine/render/htmlVideoPreviewFallback.ts`** -- Not mentioned in GPU-Engine.md directory listing or anywhere in documentation. This file provides a Firefox-specific workaround where video frames are copied into persistent textures to avoid intermittent black frames from `importExternalTexture` on Firefox. This is a significant browser-compatibility feature that is completely absent from documentation.

2. **`src/engine/render/layerEffectStack.ts`** -- Not mentioned in GPU-Engine.md. Contains `splitLayerEffects()` which classifies effects into inline vs. complex categories. While the inline/complex distinction IS documented, the actual utility file responsible for this classification is omitted from the directory listing.

3. **`src/engine/managers/outputWindowPlacement.ts`** -- Not mentioned in GPU-Engine.md directory listing. Added since 2026-03-08 (`1c00b439 Randomize new output window placement`). Contains `getRandomPopupPlacement()` which randomizes output window placement to avoid center-zone overlap. The OutputWindowManager documentation does not mention this placement strategy.

4. **`src/engine/audio/index.ts`** (barrel file) -- Not mentioned in directory listing. Minor, but all other `index.ts` files are similarly omitted; the audio barrel file specifically exports `AudioEncoderWrapper` (not `AudioEncoder` as documented).

### Inaccurate Documentation

1. **Feature flag `useFullWebCodecsPlayback` is documented as `true`, but is actually `false`**
   - GPU-Engine.md (line 363): `useFullWebCodecsPlayback: true,  // Full WebCodecs via advanceToTime()`
   - CLAUDE.md (section on Feature Flags): `useFullWebCodecsPlayback: true`
   - Actual code in `featureFlags.ts`: `useFullWebCodecsPlayback: false, // Preview runs HTML-only for now; export WebCodecs stays separate`
   - **Impact: CRITICAL** -- This is the primary decoder selection flag. Documentation claims the engine uses full WebCodecs playback by default, but it actually uses HTML video. Any developer relying on the docs will misunderstand the active decode pipeline.

2. **WebGPUContext `maxTextureDimension2D` documentation says "default limits (no custom maxTextureDimension2D)" but code requests 4096**
   - GPU-Engine.md (line 139): `Device: default limits (no custom maxTextureDimension2D)`
   - Actual code in `WebGPUContext.ts` line 77: `requiredLimits: { maxTextureDimension2D: 4096 }`
   - **Impact: Medium** -- Misleads developers about actual GPU requirements.

3. **Vulkan delay timings are documented but do not exist in code**
   - GPU-Engine.md (line 143): `Vulkan delay: 50ms after device creation, 100ms after pipelines, 50ms before textures`
   - Actual code: No delays in initialization path. The only `setTimeout` in WebGPUContext is the 100ms delay before device loss recovery (line 108), not Vulkan-specific delays.
   - **Impact: Medium** -- These delays may have been removed in a previous refactor but the documentation was not updated.

4. **`output.wgsl` line count is 83, not 71**
   - GPU-Engine.md (line 378): `output.wgsl | 71 | Passthrough with optional transparency grid`
   - Actual: 83 lines. The shader has grown since the doc was written -- it now includes a stacked alpha mode (`showTransparencyGrid == 2u`) for transparent video export.
   - **Impact: Low** -- Line counts are cosmetic, but this signals the stacked alpha export feature is undocumented.

5. **Total WGSL line count is stale**
   - GPU-Engine.md (line 372): `Total WGSL Code: ~2,400 lines`
   - Actual: src/shaders/ = 1,303 lines + src/effects/ shaders = 1,108 lines = ~2,411 total (close but the breakdown is wrong)
   - The `common.wgsl` file is listed as being in `src/shaders/` but actually lives at `src/effects/_shared/common.wgsl`
   - **Impact: Low** -- Misleading file location.

6. **Render Target count documented as "8 textures total" but actual count is 7**
   - GPU-Engine.md (line 264): "8 textures total"
   - Actual textures created in `RenderTargetManager.ts`: Ping, Pong, Independent Ping, Independent Pong, Effect Temp 1, Effect Temp 2, Black = 7 textures
   - **Impact: Low** -- Off-by-one in documentation.

7. **`EngineStats` interface in docs is incomplete compared to actual code**
   - GPU-Engine.md (lines 611-634): Documents `fps`, `timing`, `drops`, `layerCount`, `targetFps`, `decoder`, `webCodecsInfo`, `audio`, `isIdle`
   - Actual `EngineStats` in `src/types/index.ts` also includes: `gpuMemory: number`, `playback?: { windowMs, pipeline, status, frameEvents, cadenceFps, avgFrameGapMs, p95FrameGapMs, maxFrameGapMs, previewFrames, previewUpdates, previewRenderFps, previewUpdateFps, ... }`
   - The `playback` field is a large debug snapshot object entirely absent from documentation.
   - **Impact: Medium** -- The undocumented `playback` field is the primary diagnostic tool for preview pipeline debugging.

8. **Export.md lists H.264 codec string as `avc1.640028`, actual code uses `avc1.4d0028`**
   - Export.md (line 110): `avc1.640028`
   - `codecHelpers.ts` line 20: `return 'avc1.4d0028'; // Main Profile, Level 4.0`
   - GPU-Engine.md (line 543) correctly says `avc1.4d0028`
   - **Impact: Medium** -- Two docs disagree; Export.md is wrong. `640028` = High Profile, `4d0028` = Main Profile. Developers checking compatibility will get wrong profile info from Export.md.

9. **Export.md Codec Options table lists only H.264 and VP9, missing H.265 and AV1**
   - Export.md (lines 108-111): Only `H.264 | MP4 | avc1.640028` and `VP9 | WebM | vp09.00.10.08`
   - Actual code in `codecHelpers.ts` supports 4 codecs: H.264, H.265, VP9, AV1
   - GPU-Engine.md (line 543-547) correctly lists all 4 codecs
   - **Impact: Medium** -- Export.md significantly under-documents codec support.

### Missing Features (post-2026-03-08)

Based on `git log --oneline --since="2026-03-08" -- src/engine/`, 17 commits were made to the engine since March 8, 2026:

1. **Stacked Alpha Export** (`8326ad14`, `f2a84a50`) -- Entirely new export mode for transparent video output using double-height RGB+alpha-as-luma technique. Added `stackedAlpha` option to `ExportSettings`, new output shader mode (`showTransparencyGrid == 2u`), and `ExportCanvasManager` stacked alpha support. **Not mentioned in any documentation.**

2. **Black Frame Flash Prevention** (`ee7e2329`) -- `RenderDispatcher.render()` now holds the last frame during playback stalls instead of rendering black. New `lastRenderHadContent` flag. **Not documented.** This is a significant playback quality improvement on Windows/Linux.

3. **VRAM Leak Fix** (`0242668d`) -- Fix for playback degradation on Windows/Linux caused by VRAM leak. **Not documented** in troubleshooting section.

4. **Randomized Output Window Placement** (`1c00b439`) -- New `outputWindowPlacement.ts` module with center-zone exclusion. **Not documented.**

5. **Playback Debug Stats + AI Tools Improvements** (`95304a59`) -- Enhanced the `EngineStats` interface with `playback` field containing detailed pipeline diagnostics. **Not documented in GPU-Engine.md.**

6. **HTML Preview Fallback Improvements** (`8b057c76`, `be29f4da`) -- Firefox-specific copied-frame preview path. The `htmlVideoPreviewFallback.ts` module. **Not documented.**

7. **Scrubbing Stability Improvements** (`535786fc`, `a472c428`, `98b04a1a`) -- Multiple iterations of scrubbing cache improvements, settle-state handling, frame rate limiting fixes. These refined the `LayerCollector` and `RenderLoop` behavior significantly. Documentation of scrubbing behavior (30fps baseline, RVFC bypass) is still accurate but misses the nuanced settle-state and presented-frame-tracking logic now in `LayerCollector`.

### Stale References

1. **Export.md references Export V2 source files that do not exist**
   - Export.md (lines 415-419) lists `src/engine/export/v2/SharedDecoderPool.ts`, `ExportPlanner.ts`, `FrameCacheManager.ts`, `V2ExportBridge.ts`, `SystemSelector.ts`
   - None of these files exist. The `v2/` directory does not exist at all.
   - `SharedDecoderArchitecture.md` correctly marks V2 as "NOT IMPLEMENTED" with a banner, but Export.md (lines 385-419) presents V2 as if it's implemented with source file references.
   - **Impact: CRITICAL** -- Export.md will send developers looking for nonexistent code.

2. **LayerCollector documented priority order partially outdated**
   - GPU-Engine.md (lines 307-312) lists: NativeHelper, VideoFrame (parallel decoder), WebCodecs (runtime/clip), HTMLVideoElement, Image/Text/Nested
   - Actual `LayerCollector.collectLayerData()` (line 203+): First checks source type (`image`, `text/solid`, `video`), then for video: NativeHelper, direct VideoFrame, HTML video preview check (with scrub grace), then WebCodecs (runtime provider / clip provider). The HTML video path is now checked BEFORE WebCodecs when not in full WebCodecs playback mode.
   - Since `useFullWebCodecsPlayback` is `false`, the actual priority for video is effectively: NativeHelper > VideoFrame > HTML Video (scrub/pause) > WebCodecs (when enabled) > cache fallback.
   - **Impact: High** -- Developers debugging preview pipeline will misunderstand the actual texture source priority.

3. **CLAUDE.md Section 7 (Texture Types) says "Video (HTMLVideoElement) = `texture_external` via `importExternalTexture` (zero-copy)"**
   - This is technically still correct, but with `useFullWebCodecsPlayback: false` and the Firefox copied-frame fallback, the majority of HTML video frames on Firefox actually go through `captureVideoFrame` (copy path) rather than zero-copy import. The documentation should note this platform-specific behavior.

### Documentation Quality Issues

1. **GPU-Engine.md describes the `common.wgsl` file location as `src/shaders/` but it is actually at `src/effects/_shared/common.wgsl`** (line 380 of GPU-Engine.md lists it alongside other shaders in `src/shaders/`). This is misleading since `common.wgsl` is an effect utility shader, not a core engine shader.

2. **Export.md's "Export Process" pipeline description (lines 163-182) mentions "Read pixels (staging buffer)" as step 5, but the actual code uses a zero-copy OffscreenCanvas path (`ExportCanvasManager.createVideoFrameFromExport`)** with a staging buffer as fallback only. The zero-copy path is the primary path.

3. **GPU-Engine.md RenderDispatcher documentation (lines 295-303) omits several steps that now exist in the actual render flow:**
   - Empty layer handling with frame-hold during playback stalls
   - Export canvas rendering (never show grid)
   - Performance monitoring via `reportRenderTime()`
   - The `recordMainPreviewFrame()` telemetry system
   - The `scrubSettleState` and `vfPipelineMonitor` integrations

4. **The `KeyframeInterval` is documented as "Every 30 frames (configurable)" in Export.md line 217, but actual code in `types.ts` line 143 uses `getKeyframeInterval(fps) = Math.round(fps)` -- meaning 1 keyframe per second, which equals 24 for 24fps, 30 for 30fps, 60 for 60fps.** The "30 frames" is only accurate for 30fps export.

5. **GPU-Engine.md's EngineStats example shows `audio: AudioStatus` but the actual type is an inline object `{ playing: number; drift: number; status: 'sync' | 'drift' | 'silent' | 'error' }`.** The `AudioStatus` type name is not used in the actual interface definition.

---

## Recommended Changes

### Critical (must fix)

1. **Update `featureFlags.ts` documentation in both GPU-Engine.md and CLAUDE.md** to reflect `useFullWebCodecsPlayback: false`. Update the feature flag table to match the actual comment: "Preview runs HTML-only for now; export WebCodecs stays separate".

2. **Remove or clearly mark the Export V2 section in Export.md** as not implemented. Currently lines 385-419 present V2 with source file paths that do not exist. Either add a "NOT IMPLEMENTED" banner (like SharedDecoderArchitecture.md has) or remove the section entirely.

3. **Document the stacked alpha export feature** added in commits `8326ad14` and `f2a84a50`. This is a new export mode with shader changes, ExportCanvasManager changes, and FrameExporter changes.

### High Priority

4. **Add `htmlVideoPreviewFallback.ts` and `layerEffectStack.ts` to the GPU-Engine.md directory listing** under `render/`.

5. **Add `outputWindowPlacement.ts` to the directory listing** under `managers/`.

6. **Correct the LayerCollector priority order** to reflect the actual logic when `useFullWebCodecsPlayback` is false: HTML video is checked BEFORE WebCodecs.

7. **Update EngineStats documentation** to include the `playback` diagnostic object and `gpuMemory` field.

8. **Fix Export.md codec table**: add H.265 and AV1, fix H.264 codec string from `avc1.640028` to `avc1.4d0028`.

### Medium Priority

9. **Remove Vulkan delay claim** from GPU-Engine.md initialization section, or document where delays actually occur (only device loss recovery has a 100ms delay).

10. **Fix `maxTextureDimension2D` documentation** -- it IS explicitly set to 4096, not "default limits".

11. **Update render target count** from 8 to 7.

12. **Fix `common.wgsl` location** reference from `src/shaders/` to `src/effects/_shared/common.wgsl`.

13. **Update `output.wgsl` line count** from 71 to 83 and note the stacked alpha mode.

14. **Document the frame-hold behavior during playback stalls** in the RenderDispatcher section.

### Low Priority

15. **Update Export.md pipeline description** to note zero-copy OffscreenCanvas as the primary export path, not staging buffer readback.

16. **Clarify keyframe interval** documentation from "every 30 frames" to "1 keyframe per second (fps-dependent)".

17. **Document the Firefox copied-frame preview workaround** in the Troubleshooting section.
