# Full Codebase Refactoring Plan

## Context

Analysis identified 8 god objects, 6 duplication hotspots, dead code (~50KB unused V2 export), 30+ stray console.logs, and contradictory logic patterns. This plan addresses all findings in a single branch refactor on `staging`, architecture-first.

**Branch:** `staging` (single big refactor, build-verified before commit)

---

## Phase 1: Delete Dead Code & Cleanup (Low Risk Warmup)

### 1a. Delete V2 Export System
- **Delete entire directory:** `src/engine/export/v2/` (6 files + 2 docs, ~50KB)
- Remove any imports referencing it (confirmed: none exist outside the directory)

### 1b. Remove Unused Exports in `src/utils/dockLayout.ts`
- Remove `export` keyword from `findParentOfNode()` (only used internally)
- Delete `getAllPanelIds()` and `getAllTabGroups()` (never imported anywhere)

### 1c. Replace console.log with Logger
- **`src/engine/ParallelDecodeManager.ts`** — Replace 30+ `console.log` calls with `Logger.create('ParallelDecode')` + appropriate log levels
- **`src/components/timeline/Timeline.tsx:1244`** — Replace `console.log('[Timeline] Proxy cached ranges:')` with logger
- **`src/workers/transcriptionWorker.ts:169,227`** — Replace with logger (or keep console in worker context if Logger unavailable)

### 1d. Remove Commented-Out Dead Code
- `src/components/export/FFmpegExportSection.tsx:60-61` — Remove commented HAP format state
- `src/components/panels/DownloadPanel.tsx:539-543` — Remove commented auto-download handler

### 1e. Fix Always-True Condition
- `src/components/panels/MediaPanel.tsx:928` — Remove `const canDrag = true;`, use `draggable` directly

---

## Phase 2: Consolidate Duplicated Logic

### 2a. Unified Thumbnail Service
Create `src/services/thumbnailService.ts` consolidating 5 implementations:
- `src/stores/timeline/utils.ts` → `generateThumbnails` (lines 134-175)
- `src/stores/timeline/helpers/thumbnailHelpers.ts` → `generateVideoThumbnails`, `generateImageThumbnail`, `generateDownloadThumbnails`
- `src/stores/mediaStore/helpers/thumbnailHelpers.ts` → `createThumbnail`
- `src/utils/fileLoader.ts` → `generateVideoThumbnail`

**Approach:** Keep `src/stores/timeline/helpers/thumbnailHelpers.ts` as the canonical location (most complete), re-export from a single entry point. Remove duplicates in `utils.ts`, `fileLoader.ts`, and `mediaStore/helpers/`. Update all callers.

### 2b. Unified Waveform Service
Consolidate into `src/services/waveformService.ts`:
- `src/stores/timeline/utils.ts` → `generateWaveform` + `generateWaveformFromBuffer` (lines 28-129)
- `src/stores/timeline/helpers/waveformHelpers.ts` → `generateWaveformForFile`

**Approach:** Keep `waveformHelpers.ts` as canonical, move the two functions from `utils.ts` into it, update callers.

### 2c. Unified seekVideo
- `src/stores/timeline/utils.ts:10-23` — Remove this copy
- `src/engine/export/VideoSeeker.ts` — Keep as canonical
- Update callers of `utils.seekVideo` to import from `VideoSeeker`

### 2d. Deduplicate Blend Mode Definitions
- Keep definition in `src/components/panels/shared.tsx` (lines 11-19)
- Delete duplicate in `src/components/panels/ClipPropertiesPanel.tsx` (lines 8-37)
- Import from `shared.tsx` in ClipPropertiesPanel

### 2e. Fix Contradictory KeyframeToggle
Two implementations with opposite logic:
- `ClipPropertiesPanel.tsx:54-84` — `if (!recording && !hasKfs)` add keyframe
- `shared.tsx:32-64` — `if (recording || hasKfs)` disable

**Action:** Delete the ClipPropertiesPanel copy, use the `shared.tsx` version everywhere. Verify the shared version has correct logic (it should add keyframe when enabling recording on a property with no keyframes yet).

---

## Phase 3: Split WebGPUEngine God Object

**Current:** `src/engine/WebGPUEngine.ts` — 1,396 lines, 59 public methods, 13 responsibility groups

**Strategy:** Conservative facade pattern. Keep `WebGPUEngine` as the singleton facade (HMR-compatible), extract domain logic into manager classes that it delegates to. No caller changes needed.

### 3a. Create `src/engine/managers/CacheManager.ts` (~150 lines)
Extract from WebGPUEngine:
- `cacheFrameAtTime()`, `getCachedFrame()`, `getScrubbingCacheStats()`, `clearScrubbingCache()` (scrubbing)
- `cacheCompositeFrame()`, `getCachedCompositeFrame()`, `hasCompositeCacheFrame()`, `clearCompositeCache()`, `getCompositeCacheStats()` (RAM preview)
- `clearCaches()`, `clearVideoCache()`
- Private properties: `scrubbingCache`, RAM preview cache state

### 3b. Create `src/engine/managers/ExportCanvasManager.ts` (~120 lines)
Extract from WebGPUEngine:
- `initExportCanvas()`, `createVideoFrameFromExport()`, `cleanupExportCanvas()`, `readPixels()`
- `setExporting()`, `getIsExporting()`, `setGeneratingRamPreview()`
- Private properties: `exportCanvas`, `exportContext`, `isExporting`, `isGeneratingRamPreview`

### 3c. Create `src/engine/managers/CompositeRenderer.ts` (~400 lines)
Extract the core render methods:
- `render(layers)` — the main 153-line method
- `renderToPreviewCanvas(canvasId, layers)`
- `renderCachedFrame(time)` → uses CacheManager
- `renderEmptyFrame()`
- Helper: nested comp pre-rendering logic
- Private properties: ping/pong tracking, last render state

### 3d. Create `src/engine/managers/NestedCompManager.ts` (~100 lines)
Extract from WebGPUEngine:
- `hasNestedCompTexture()`, `cacheActiveCompOutput()`, `copyMainOutputToPreview()`, `copyNestedCompTextureToPreview()`, `cleanupNestedCompTexture()`, `renderSlicedToCanvas()`

### 3e. Slim Down WebGPUEngine (~400-500 lines)
Keep in WebGPUEngine as facade:
- `initialize()` / `destroy()` / `reinitializeWithPreference()` — device lifecycle
- Canvas registration (setPreviewCanvas, register/unregisterTargetCanvas)
- Output window management (delegates to existing OutputWindowManager)
- Video management (delegates to existing VideoFrameManager)
- Mask management (delegates to existing MaskTextureManager)
- Texture management (delegates to existing TextureManager)
- Resolution & display settings
- Stats & accessors
- Render loop start/stop
- **Delegation:** All methods delegate to the 4 new managers. Public API unchanged.

### 3f. Fix Duplicated Ping-Pong Logic
`Compositor.ts` and `WebGPUEngine.renderToPreviewCanvas()` have near-identical ping-pong rendering. After extracting `CompositeRenderer`, unify this into `Compositor.composite()` and have both paths call it.

---

## Phase 4: Split clipSlice God Object

**Current:** `src/stores/timeline/clipSlice.ts` — 1,259 lines, 25 actions across 6+ domains

### 4a. Create `src/stores/timeline/textClipSlice.ts` (~120 lines)
Extract:
- `addTextClip` (line 689)
- `updateTextProperties` (line 735)

### 4b. Create `src/stores/timeline/solidClipSlice.ts` (~100 lines)
Extract:
- `addSolidClip` (line 807)
- `updateSolidColor` (line 861)

### 4c. Create `src/stores/timeline/clipEffectSlice.ts` (~50 lines)
Extract:
- `addClipEffect` (line 920)
- `removeClipEffect` (line 936)
- `updateClipEffect` (line 942)
- `setClipEffectEnabled` (line 954)

### 4d. Create `src/stores/timeline/linkedGroupSlice.ts` (~40 lines)
Extract:
- `createLinkedGroup` (line 968)
- `unlinkGroup` (line 993)

### 4e. Create `src/stores/timeline/downloadClipSlice.ts` (~120 lines)
Extract YouTube/download actions:
- `addPendingDownloadClip` (line 1089)
- `updateDownloadProgress` (line 1125)
- `completeDownload` (line 1129)
- `setDownloadError` (line 1143)

### 4f. Slim Down clipSlice (~500 lines)
Keep core clip operations:
- `addClip`, `removeClip`, `moveClip`, `trimClip`, `splitClip`, `splitClipAtPlayhead`, `updateClip`, `updateClipTransform`
- `addCompClip`, `refreshCompClipNestedData`
- `toggleClipReverse`, `setClipParent`, `getClipChildren`, `setClipPreservesPitch`
- `generateWaveformForClip`

### 4g. Wire New Slices in `src/stores/timeline/index.ts`
Add new slice imports and spread them into the store creation, same pattern as existing slices.

---

## Phase 5: Extract RAM Preview Engine

**Current:** `startRamPreview` in `playbackSlice.ts` is 381 lines doing video seeking, layer building, frame rendering, caching, and cancellation.

### 5a. Create `src/services/ramPreviewEngine.ts` (~300 lines)
Extract the core logic of `startRamPreview` into a service class:
```
class RamPreviewEngine {
  async generate(options: RamPreviewOptions): AsyncGenerator<RamPreviewProgress>
  cancel(): void
  // Internal: seekVideos, buildLayersForFrame, renderAndCacheFrame
}
```
- Takes engine instance, layerBuilder, and store getters as constructor params
- Returns progress via callback (same pattern as current)
- Handles cancellation internally

### 5b. Slim Down playbackSlice (~600 lines)
- `startRamPreview` becomes ~30 lines: create RamPreviewEngine, call generate(), update store state from progress callbacks
- Keep: basic playback, speed, zoom, in/out markers, loop, tool modes, performance toggles, proxy cache preload

---

## Phase 6: Split compositionSlice

**Current:** `src/stores/mediaStore/compositionSlice.ts` — 609 lines, 46 actions

### 6a. Create `src/stores/mediaStore/slotSlice.ts` (~100 lines)
Extract slot assignment (Resolume-style):
- `moveSlot`, `unassignSlot`, `assignMediaFileToSlot`, `getSlotMap`

### 6b. Create `src/stores/mediaStore/multiLayerSlice.ts` (~60 lines)
Extract multi-layer playback:
- `activateOnLayer`, `deactivateLayer`, `activateColumn`, `deactivateAllLayers`, `setLayerOpacity`

### 6c. Slim Down compositionSlice (~350 lines)
Keep: CRUD (create, duplicate, remove, update) + tab management (open, close, reorder) + preview/monitor + helper functions

### 6d. Move Inline Helpers from mediaStore/index.ts
Create `src/stores/mediaStore/textItemSlice.ts` (~40 lines):
- `getOrCreateTextFolder`, `createTextItem`, `removeTextItem`

Create `src/stores/mediaStore/solidItemSlice.ts` (~40 lines):
- `getOrCreateSolidFolder`, `createSolidItem`, `removeSolidItem`, `updateSolidItem`

Keep in index.ts: `getItemsByFolder`, `getItemById`, `getFileByName` (query helpers, fine inline)

---

## Phase 7: Minor Logic Fixes

### 7a. Fix Contradictory Cleanup in RenderTargetManager.ts
- `createPingPongTextures()` comment says "NEVER call destroy()" but `destroy()` does call it
- **Fix:** Remove contradictory comment, clarify that `destroy()` is the only place that calls `.destroy()` on textures

### 7b. Fix Double Cleanup in FFmpegBridge.ts
- Lines 256-326: cleanup in both `catch` AND `finally` blocks
- **Fix:** Remove cleanup from `catch`, keep only in `finally`

### 7c. Fix Inconsistent Null Assertions in WebGPUEngine
- Replace `this.textureManager!` non-null assertions with proper null checks or early returns
- Apply consistently throughout the refactored managers

---

## Files Modified (Summary)

| Action | Files | Estimated LOC Change |
|--------|-------|---------------------|
| **Delete** | `src/engine/export/v2/` (8 files) | -3,000 |
| **Create** | 4 engine managers, 8 store slices, 3 services | +1,500 |
| **Modify** | WebGPUEngine, clipSlice, playbackSlice, compositionSlice, mediaStore/index, timeline/index | Net -800 (extracted to new files) |
| **Delete duplicates** | utils.ts functions, ClipPropertiesPanel blend modes, FFmpegExportSection comments | -200 |
| **Cleanup** | ParallelDecodeManager console.logs, dockLayout unused exports | -50 |
| **Net change** | | ~-2,550 LOC removed |

---

## Verification

After each phase:
1. `npm run build` — must pass with 0 errors (warnings OK)
2. `npm run lint` — check for new lint issues
3. Manual smoke test: open app, add clip to timeline, play, check preview renders
4. After Phase 3 (engine split): verify HMR works (`npm run dev`, edit a file, confirm engine survives reload)
5. After Phase 4-6 (store splits): verify undo/redo still works (history snapshots must capture all state)
6. Final: full export test (WebCodecs path)

---

## Execution Order

```
Phase 1 (dead code)     → build check
Phase 2 (deduplication) → build check
Phase 3 (WebGPUEngine)  → build check + HMR test
Phase 4 (clipSlice)     → build check + undo/redo test
Phase 5 (RAM preview)   → build check + RAM preview test
Phase 6 (composition)   → build check + composition switching test
Phase 7 (minor fixes)   → build check
Final commit & push to staging
```
