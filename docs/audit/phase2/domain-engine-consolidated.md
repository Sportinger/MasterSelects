# Domain 1: Engine & Rendering - Consolidated Findings

Cross-review consolidation of Reviewer A and Reviewer B findings.
Both reviewers audited 62 source files across `src/engine/`, `src/shaders/`, and `src/effects/`,
plus 4 documentation files (`GPU-Engine.md`, `SharedDecoderArchitecture.md`, `Export.md`, `CLAUDE.md` sections 3/7/8).

---

## Consensus (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | `featureFlags.ts` documents `useFullWebCodecsPlayback: true` but actual code has `false`. This is the primary decoder selection flag -- documentation claims full WebCodecs playback but the engine actually uses HTML video for preview. | CRITICAL | SMALL | `GPU-Engine.md` lines 362, 585 |
| C2 | `WebGPUContext.ts` docs say "default limits (no custom maxTextureDimension2D)" but code explicitly sets `requiredLimits: { maxTextureDimension2D: 4096 }`. | MEDIUM | SMALL | `GPU-Engine.md` line 139 |
| C3 | `output.wgsl` documented as 71 lines, actual is 83 lines (stacked alpha mode added). | LOW | SMALL | `GPU-Engine.md` line 378 |
| C4 | Total WGSL line count documented as "~2,400 lines"; actual is ~2,411 for .wgsl files (1,303 core + 1,108 effects) plus ~435 lines of inline WGSL in CompositorPipeline.ts, totaling ~2,846 lines. | LOW | SMALL | `GPU-Engine.md` line 372 |
| C5 | Render target count documented as "8 textures total" but actual count is 7 (Ping, Pong, IndependentPing, IndependentPong, EffectTemp1, EffectTemp2, Black). | LOW | SMALL | `GPU-Engine.md` line 265 |
| C6 | Export.md H.264 codec string `avc1.640028` is wrong; actual code uses `avc1.4d0028` (Main Profile, Level 4.0). GPU-Engine.md has the correct value. | MEDIUM | SMALL | `Export.md` line 110 |
| C7 | Export.md lists only H.264 and VP9 codecs; actual code supports 4: H.264, H.265, VP9, AV1. GPU-Engine.md has the correct list. | MEDIUM | SMALL | `Export.md` lines 108-111 |
| C8 | Export.md V2 section (lines 385-419) lists source files at `src/engine/export/v2/` that do not exist. The directory does not exist at all. `SharedDecoderArchitecture.md` correctly marks V2 as "NOT IMPLEMENTED" but Export.md presents it as implemented. | CRITICAL | SMALL | `Export.md` lines 385-419 |
| C9 | `htmlVideoPreviewFallback.ts` -- Firefox-specific workaround copying video frames to persistent textures to avoid intermittent black frames -- is completely undocumented. | HIGH | MEDIUM | `GPU-Engine.md` |
| C10 | `layerEffectStack.ts` -- splits effects into inline vs. complex categories -- is not in the directory listing or documented despite being core to the inline/complex classification. | MEDIUM | SMALL | `GPU-Engine.md` |
| C11 | `outputWindowPlacement.ts` -- randomized popup placement with center-exclusion zone logic -- added post-March-8, not documented. | LOW | SMALL | `GPU-Engine.md` |
| C12 | Stacked alpha export feature (commits `8326ad14`, `f2a84a50`) is entirely undocumented: `ExportSettings.stackedAlpha`, `OutputPipeline` third uniform buffer mode, `output.wgsl` stacked alpha logic, `ExportCanvasManager` stacked alpha support. | HIGH | MEDIUM | `GPU-Engine.md`, `Export.md` |
| C13 | Black frame flash prevention during playback (commit `ee7e2329`) -- `RenderDispatcher.lastRenderHadContent` hold-frame logic -- not documented. | MEDIUM | SMALL | `GPU-Engine.md` |
| C14 | VRAM leak fix (commit `0242668d`) -- `RenderTargetManager.createPingPongTextures()` no longer calls `.destroy()` on old textures, instead nulls references for GC -- not documented. | MEDIUM | SMALL | `GPU-Engine.md` |
| C15 | Randomized output window placement (commit `1c00b439`) not documented. | LOW | SMALL | `GPU-Engine.md` |

---

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | `RenderDispatcher.ts` methods `renderToPreviewCanvas()` and `renderCachedFrame()` undocumented. `renderToPreviewCanvas()` performs independent ping-pong compositing for multi-composition preview. | MEDIUM | MEDIUM | YES -- confirmed these methods exist and perform significant rendering logic not covered in docs. |
| A2 | `webCodecsTypes.ts` listed in GPU-Engine.md directory tree but its contents/purpose are not documented. | LOW | SMALL | YES -- file exists, listed in tree, no description of its API. |
| A3 | `VideoFrameManager.ts` listed as "RVFC frame readiness tracking" but no API/behavior documentation. | LOW | SMALL | YES -- confirmed file exists with only a one-line mention. |
| A4 | `export/types.ts` contains `FrameContext`, `LayerTransformData`, `BaseLayerProps`, `getFrameTolerance()`, `getKeyframeInterval()` -- none documented in Export.md. | MEDIUM | SMALL | YES -- verified all types and functions exist in the file. |
| A5 | CompositorPipeline.ts contains ~435 lines of inline WGSL (copyShader ~30, externalCopyShader ~30, externalCompositeShader ~375) not documented in the Shader Capabilities section. The `composite.wgsl` file is only the standard composite shader. | MEDIUM | MEDIUM | YES -- verified: 3 inline shader constants at lines 8, 40, 72 of CompositorPipeline.ts. |
| A6 | GPU-Engine.md says "Four GPU Render Pipelines" in CompositorPipeline section -- count is correct (standard composite, external composite, standard copy, external copy), but doc fails to note external composite shader is inlined (~375 lines), not from `composite.wgsl`. | LOW | SMALL | YES -- verified: `composite.wgsl` is imported for standard composite only; the external composite shader is fully inlined. |
| A7 | GPU-Engine.md documents OutputPipeline as having "Dual uniform buffers (grid-on / grid-off)" but actual code has THREE: `uniformBufferGridOn`, `uniformBufferGridOff`, `uniformBufferStackedAlpha` (mode=2 for transparent video export). | HIGH | SMALL | YES -- verified three buffers at OutputPipeline.ts lines 17-19. |
| A8 | Enhanced scrub pipeline telemetry (`vfPipelineMonitor`, `wcPipelineMonitor`) heavily used in LayerCollector and RenderDispatcher but completely undocumented. | LOW | MEDIUM | YES -- verified imports and usage in LayerCollector.ts (lines 12-13) and RenderDispatcher.ts. |
| A9 | `performanceMonitor` service called by RenderDispatcher (`reportRenderTime()`) but not documented. | LOW | SMALL | YES -- verified at RenderDispatcher.ts line 21 (import) and line 333 (usage). |
| A10 | Playback stall hold frame logic (`LayerCollector.getPlaybackStallHoldFrame()`) provides "last resort" cached frames during decoder stalls, not documented. | MEDIUM | SMALL | YES -- verified method exists at LayerCollector and is called at lines 873 and 992. |
| A11 | Scrub grace period (`LayerCollector.scrubGraceUntil`, ~150ms) keeps HTML preview path active after scrub stops so settle-seek can complete, not documented. | LOW | SMALL | YES -- verified at LayerCollector.ts line 47 (field) and line 289 (usage with `SCRUB_GRACE_MS`). |
| A12 | LayerCollector documentation oversimplifies the 5-priority-source model; actual code has complex decision trees for scrub/pause/drag/settle states with many fallback paths. | MEDIUM | LARGE | YES -- code review confirms far more complex logic than documented. |
| A13 | `CLAUDE.md` Section 7 (Texture Types) says HTMLVideoElement always uses `texture_external` via `importExternalTexture` (zero-copy), but on Firefox the `htmlVideoPreviewFallback.ts` copies them to persistent `texture_2d<f32>` textures. | MEDIUM | SMALL | YES -- verified: Firefox path uses copied textures, not external textures. |
| A14 | NestedCompRenderer complexity is underdocumented: doc mentions "pooled ping-pong texture pairs" and "frame caching" but not the full video handling logic inside `collectNestedLayerData()` which mirrors LayerCollector complexity. | LOW | LARGE | YES -- NestedCompRenderer imports and uses `wcPipelineMonitor` (line 17) confirming complex video handling. |
| A15 | Effect shader count documented as "30 effect shaders ~954 lines" but actual is 30 effect shader files totaling 1,108 lines (not counting `common.wgsl`'s 154 lines). | LOW | SMALL | YES -- verified: 30 effect shader.wgsl files = 1,108 lines; common.wgsl = 154 lines at `src/effects/_shared/common.wgsl`. |

---

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | Vulkan delay timings documented in GPU-Engine.md ("50ms after device creation, 100ms after pipelines, 50ms before textures") do not exist in code. The only `setTimeout` in WebGPUContext is 100ms delay before device loss recovery (line 108), not Vulkan-specific delays. | MEDIUM | SMALL | YES -- verified: `grep` of WebGPUContext.ts shows only one `setTimeout` at line 108 for recovery, no Vulkan-specific delays. These were likely removed in a past refactor. |
| B2 | `EngineStats` interface docs are incomplete: missing `gpuMemory: number` field and the entire `playback?` diagnostic object (30+ fields for pipeline debugging). Also missing `isIdle: boolean`. | MEDIUM | MEDIUM | YES -- verified in `src/types/index.ts`: `gpuMemory` at line 191, `playback?` at lines 226-268 (large object), `isIdle` at line 307. GPU-Engine.md shows none of these. |
| B3 | Audio barrel file exports `AudioEncoderWrapper` (not `AudioEncoder` as documented). | LOW | SMALL | Not independently verified (minor naming issue). |
| B4 | LayerCollector priority order is partially outdated: when `useFullWebCodecsPlayback` is false (which is the current state), HTML video is checked BEFORE WebCodecs. Doc shows: NativeHelper > VideoFrame > WebCodecs > HTMLVideoElement. Actual: NativeHelper > VideoFrame > HTML Video (when not in full WC mode) > WebCodecs. | HIGH | MEDIUM | YES -- verified in LayerCollector.ts lines 239-309: after NativeHelper and direct VideoFrame checks, `allowHtmlVideoPreview` is evaluated (line 304) BEFORE WebCodecs (line 308+). Since `useFullWebCodecsPlayback` is false, HTML video takes priority over WebCodecs in practice. |
| B5 | `common.wgsl` location documented as `src/shaders/` but actually at `src/effects/_shared/common.wgsl`. | LOW | SMALL | YES -- verified via glob: file is at `src/effects/_shared/common.wgsl`, not in `src/shaders/`. |
| B6 | GPU-Engine.md EngineStats example shows `audio: AudioStatus` type name, but actual interface defines it as an inline object `{ playing: number; drift: number; status: 'sync' \| 'drift' \| 'silent' \| 'error' }`. No `AudioStatus` type exists. | LOW | SMALL | YES -- verified in `src/types/index.ts` lines 220-224: audio is an inline type, not a named `AudioStatus` type. |
| B7 | Export.md pipeline description (line 169) says "Read pixels (staging buffer)" as step 5, but actual code uses zero-copy OffscreenCanvas path (`ExportCanvasManager.createVideoFrameFromExport`) as primary, with staging buffer as fallback only. | MEDIUM | SMALL | YES -- verified: `ExportCanvasManager` uses `OffscreenCanvas` (line 9) and `createVideoFrameFromExport` (line 86) as the primary path. |
| B8 | Keyframe interval documented as "Every 30 frames (configurable)" but actual code uses `getKeyframeInterval(fps) = Math.round(fps)`, meaning 1 keyframe per second (24 for 24fps, 30 for 30fps, 60 for 60fps). "30 frames" is only correct for 30fps. | LOW | SMALL | YES -- verified in `export/types.ts` line 143: `Math.round(fps)`. |
| B9 | Playback Debug Stats + AI Tools improvements (commit `95304a59`) added the `playback` field to EngineStats, entirely absent from documentation. | MEDIUM | MEDIUM | YES -- this is related to B2; the `playback` field is the primary diagnostic tool for preview pipeline debugging. |
| B10 | Reviewer B also noted `featureFlags` claim in "CLAUDE.md" -- however, verification shows CLAUDE.md does NOT mention `useFullWebCodecsPlayback`. The inaccuracy is only in GPU-Engine.md (lines 362, 585). | N/A | N/A | CORRECTED -- CLAUDE.md has no featureFlags reference. Only GPU-Engine.md is affected (two locations). |

---

## Conflicts Resolved

### 1. Total WGSL line count discrepancy

**Reviewer A** says: ~2,565 lines (core 1,303 + effects 1,108 + common.wgsl 154), noting CompositorPipeline inline shaders are uncounted.
**Reviewer B** says: ~2,411 lines (core 1,303 + effects 1,108), noting the total is "close" to documented ~2,400.

**Resolution**: Both partially correct. The .wgsl file totals are:
- `src/shaders/`: 1,303 lines
- `src/effects/` (30 effect shaders): 1,108 lines (this includes only `shader.wgsl` files)
- `src/effects/_shared/common.wgsl`: 154 lines

Total .wgsl files: 2,565 lines. Reviewer A's count is correct for .wgsl files.

Additionally, CompositorPipeline.ts contains ~435 lines of inline WGSL (copyShader ~30, externalCopyShader ~30, externalCompositeShader ~375). Grand total including inline: ~3,000 lines.

The documented "~2,400 lines" is stale. The doc should note both the .wgsl file total (~2,565) and the existence of ~435 lines of inline WGSL.

### 2. CLAUDE.md featureFlags reference

**Reviewer B** claims CLAUDE.md also documents `useFullWebCodecsPlayback: true`.
**Reviewer A** does not mention CLAUDE.md for this issue.

**Resolution**: Verified via grep -- CLAUDE.md does NOT contain `useFullWebCodecsPlayback`. Only GPU-Engine.md has this error (at lines 362 and 585). Reviewer B's claim about CLAUDE.md is incorrect.

### 3. Effect shader count: "30 effect shaders ~954 lines"

**Reviewer A** says 31 shader files (30 effects + common.wgsl) totaling ~1,262 lines.
**Reviewer B** does not specifically contest this line count.

**Resolution**: There are exactly 30 `shader.wgsl` files in `src/effects/` totaling 1,108 lines. `common.wgsl` (154 lines) is a shared utility, not an effect shader. The documented "30 effect shaders" count is correct, but "~954 lines" is significantly stale (actual: 1,108 lines). Reviewer A's total of ~1,262 includes common.wgsl which is not an effect shader but should still be documented.

### 4. Severity of render target count error

**Reviewer A** rates this as a Critical factual error (Priority 1).
**Reviewer B** rates this as Low impact.

**Resolution**: This is LOW severity. The off-by-one (8 vs 7) is a minor documentation inaccuracy that is unlikely to cause developer confusion. The listed categories are correct; only the summary count is wrong.

### 5. Missing post-March-8 features count

**Reviewer A** lists 8 missing features.
**Reviewer B** lists 7 missing features (overlapping but differently grouped).

**Resolution**: Both cover the same core changes. The key undocumented features are:
1. Stacked alpha export (both)
2. Black frame flash prevention (both)
3. VRAM leak fix (both)
4. Randomized output window placement (both)
5. Firefox HTML video preview fallback (both)
6. Enhanced scrub pipeline telemetry (A only -- B mentions scrubbing stability but less specifically)
7. Playback stall hold frame logic (A only as separate item)
8. Scrub grace period (A only as separate item)
9. Playback debug stats / EngineStats `playback` field (B only)

Total unique undocumented features: 9.

---

## Prioritized Action Items

Ordered by severity and impact. Each item includes the specific doc and section to update.

### CRITICAL (must fix immediately)

1. **Fix `useFullWebCodecsPlayback` flag value in GPU-Engine.md**
   - File: `docs/Features/GPU-Engine.md`
   - Lines 362 and 585: Change `useFullWebCodecsPlayback: true` to `false`
   - Update comment to match actual: "Preview runs HTML-only for now; export WebCodecs stays separate"
   - Effort: SMALL

2. **Remove or mark Export V2 section as NOT IMPLEMENTED in Export.md**
   - File: `docs/Features/Export.md`
   - Lines 385-419: Add "NOT IMPLEMENTED" banner (matching SharedDecoderArchitecture.md style) or remove section. The 5 source files listed do not exist.
   - Effort: SMALL

### HIGH (should fix soon)

3. **Document stacked alpha export feature**
   - Files: `docs/Features/GPU-Engine.md` (OutputPipeline section, output.wgsl section) and `docs/Features/Export.md` (new section or add to Export Settings)
   - Include: `ExportSettings.stackedAlpha` option, OutputPipeline third uniform buffer mode (mode=2), output.wgsl stacked alpha logic, ExportCanvasManager double-height canvas
   - Effort: MEDIUM

4. **Fix OutputPipeline uniform buffer documentation**
   - File: `docs/Features/GPU-Engine.md` (OutputPipeline section)
   - Change "Dual uniform buffers (grid-on / grid-off)" to three: gridOn, gridOff, stackedAlpha (mode 0/1/2)
   - Effort: SMALL

5. **Document Firefox HTML video preview fallback**
   - File: `docs/Features/GPU-Engine.md` (add to Video Decoding or Texture Import section)
   - Document `htmlVideoPreviewFallback.ts`: Firefox-specific path that copies video frames to persistent `texture_2d<f32>` textures to avoid intermittent black sampling from `importExternalTexture`
   - Also update `CLAUDE.md` Section 7 (Texture Types) to note Firefox exception to zero-copy HTMLVideoElement import
   - Effort: MEDIUM

6. **Fix Export.md codec table**
   - File: `docs/Features/Export.md` lines 108-111
   - Fix H.264 codec string from `avc1.640028` to `avc1.4d0028`
   - Add H.265 row: `H.265 | MP4 | hvc1.1.6.L93.B0`
   - Add AV1 row: `AV1 | MP4/WebM | av01.0.04M.08`
   - Effort: SMALL

7. **Correct LayerCollector priority order documentation**
   - File: `docs/Features/GPU-Engine.md` (lines 307-312 and line 353)
   - Update to reflect actual priority when `useFullWebCodecsPlayback` is false: NativeHelper > VideoFrame (parallel) > HTML Video (when not in full WC mode, during scrub/pause) > WebCodecs (full mode only) > cache fallbacks
   - Effort: MEDIUM

8. **Update EngineStats documentation**
   - File: `docs/Features/GPU-Engine.md` (EngineStats section, lines 611-634)
   - Add missing fields: `gpuMemory: number`, `isIdle: boolean`, `playback?: { ... }` (30+ field diagnostic object)
   - Fix `audio: AudioStatus` to show actual inline type definition
   - Effort: MEDIUM

### MEDIUM (fix in next pass)

9. **Remove Vulkan delay claim from GPU-Engine.md**
   - File: `docs/Features/GPU-Engine.md` line 143
   - Remove "Vulkan delay: 50ms after device creation, 100ms after pipelines, 50ms before textures" -- no such delays exist in code. Only delay is 100ms before device loss recovery.
   - Effort: SMALL

10. **Fix WebGPUContext initialization documentation**
    - File: `docs/Features/GPU-Engine.md` line 139
    - Change "default limits (no custom maxTextureDimension2D)" to "requiredLimits: { maxTextureDimension2D: 4096 }"
    - Effort: SMALL

11. **Document black frame flash prevention**
    - File: `docs/Features/GPU-Engine.md` (RenderDispatcher or Troubleshooting section)
    - Document `lastRenderHadContent` flag that holds last frame during transient playback stalls instead of flashing black (Windows/Linux)
    - Effort: SMALL

12. **Document VRAM leak fix pattern**
    - File: `docs/Features/GPU-Engine.md` (RenderTargetManager section or Troubleshooting)
    - Note that `createPingPongTextures()` nulls references for GC instead of calling `.destroy()` to avoid "Destroyed texture used in a submit" warnings
    - Effort: SMALL

13. **Fix Export.md pipeline description**
    - File: `docs/Features/Export.md` line 169
    - Change "Read pixels (staging buffer)" to note that zero-copy OffscreenCanvas (`ExportCanvasManager.createVideoFrameFromExport`) is the primary path; staging buffer is fallback only
    - Effort: SMALL

14. **Fix keyframe interval documentation**
    - File: `docs/Features/Export.md` line 217
    - Change "Every 30 frames (configurable)" to "1 keyframe per second, fps-dependent: `Math.round(fps)` (e.g., 24 for 24fps, 30 for 30fps, 60 for 60fps)"
    - Effort: SMALL

15. **Document `layerEffectStack.ts` in directory listing**
    - File: `docs/Features/GPU-Engine.md` (render/ directory section)
    - Add `layerEffectStack.ts` -- splits effects into inline vs. complex categories via `splitLayerEffects()`
    - Effort: SMALL

16. **Document playback stall hold frame logic**
    - File: `docs/Features/GPU-Engine.md` (LayerCollector section)
    - Document `getPlaybackStallHoldFrame()` as a last-resort frame source during decoder stalls
    - Effort: SMALL

17. **Document inline WGSL in CompositorPipeline.ts**
    - File: `docs/Features/GPU-Engine.md` (Shader Capabilities section)
    - Note that ~435 lines of WGSL are inlined in CompositorPipeline.ts (copyShader, externalCopyShader, externalCompositeShader with all 37 blend modes) rather than in separate .wgsl files
    - Effort: SMALL

18. **Document export types in Export.md**
    - File: `docs/Features/Export.md`
    - Add documentation for `FrameContext`, `LayerTransformData`, `BaseLayerProps`, `getFrameTolerance()`, `getKeyframeInterval()` from `src/engine/export/types.ts`
    - Effort: MEDIUM

19. **Document `RenderDispatcher.renderToPreviewCanvas()` and `renderCachedFrame()`**
    - File: `docs/Features/GPU-Engine.md` (Render Loop / RenderDispatcher section)
    - Effort: MEDIUM

### LOW (nice to have)

20. **Fix render target count**
    - File: `docs/Features/GPU-Engine.md` line 265
    - Change "8 textures total" to "7 textures total"
    - Effort: SMALL

21. **Update shader line counts**
    - File: `docs/Features/GPU-Engine.md` lines 372, 378, 381
    - `output.wgsl`: 71 -> 83
    - Effect shaders: ~954 -> 1,108 (30 shaders)
    - Total WGSL: ~2,400 -> ~2,565 (.wgsl files) + ~435 inline = ~3,000 total
    - Effort: SMALL

22. **Fix `common.wgsl` location reference**
    - File: `docs/Features/GPU-Engine.md` line 380
    - Change implied `src/shaders/` location to actual `src/effects/_shared/common.wgsl`
    - Effort: SMALL

23. **Document `outputWindowPlacement.ts`**
    - File: `docs/Features/GPU-Engine.md` (OutputWindowManager section)
    - Add `outputWindowPlacement.ts` with center-exclusion zone randomized placement logic
    - Effort: SMALL

24. **Document telemetry services**
    - File: `docs/Features/GPU-Engine.md` (new Debugging/Telemetry subsection)
    - Document `vfPipelineMonitor`, `wcPipelineMonitor`, `performanceMonitor` (`reportRenderTime()`)
    - Effort: MEDIUM

25. **Document `webCodecsTypes.ts` and `VideoFrameManager.ts` APIs**
    - File: `docs/Features/GPU-Engine.md` (directory listing / respective sections)
    - Effort: SMALL

26. **Document scrub grace period**
    - File: `docs/Features/GPU-Engine.md` (LayerCollector section)
    - Document `scrubGraceUntil` (~150ms post-scrub grace for settle-seek completion)
    - Effort: SMALL

27. **Fix EngineStats `audio` type name**
    - File: `docs/Features/GPU-Engine.md` (EngineStats section)
    - Change `audio: AudioStatus` to inline type `audio: { playing: number; drift: number; status: 'sync' | 'drift' | 'silent' | 'error' }`
    - Effort: SMALL

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Consensus findings | 15 |
| Reviewer A unique (verified) | 15 |
| Reviewer B unique (verified) | 9 (1 corrected) |
| Conflicts resolved | 5 |
| **Total confirmed action items** | **27** |
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 11 |
| LOW | 8 |
