# Domain 2: State & Stores - Reviewer A Findings

## Summary
- Files audited: 42 source files (24 timeline store files, 9 mediaStore slices + index, 9 standalone stores)
- Docs reviewed: 5 (Timeline.md, Media-Panel.md, Keyframes.md, Masks.md, CLAUDE.md section 3-4)
- Critical gaps found: 3
- Inaccuracies found: 12
- Missing features: 5

---

## Gap Analysis

### Undocumented Files

The following source files are NOT mentioned in any documentation reviewed:

**Standalone stores with zero dedicated docs:**
- `src/stores/historyStore.ts` -- mentioned in CLAUDE.md section 6 (one line) but no feature doc explains its StateSnapshot shape, batch grouping API, flush/suppress callbacks, or clearHistory
- `src/stores/engineStore.ts` -- mentioned in CLAUDE.md section 6 (one line) but no feature doc covers its EngineStats shape, gpuInfo, linuxVulkanWarning state, or dismissLinuxVulkanWarning action
- `src/stores/settingsStore.ts` -- mentioned in CLAUDE.md section 6 (one line) but no feature doc describes 30+ settings fields (theme, API keys, transcription, autosave, native helper, GPU preference, copy-to-project, tutorials, changelog settings), persist config, or encrypted API key flow
- `src/stores/dockStore.ts` -- mentioned in CLAUDE.md section 6 (one line) but no feature doc documents the full DockLayout tree, floating panels, drag state, panel zoom, panel visibility toggling, addPreviewPanel, updatePanelData, or persist config
- `src/stores/sliceStore.ts` -- mentioned in CLAUDE.md section 3 as "Slice/region management" but no doc describes OutputSlice, TargetSliceConfig, warp modes, corner pin, input/output matching, auto-save to localStorage, or SavedTargetMeta
- `src/stores/renderTargetStore.ts` -- mentioned in CLAUDE.md section 3 as "Output targets" but no doc covers RenderTarget lifecycle, source routing types (activeComp, program, composition, layer, layer-index, slot), canvas/window binding, transparency grid, or getActiveCompTargets/getIndependentTargets helpers
- `src/stores/sam2Store.ts` -- mentioned in CLAUDE.md section 3 as "SAM2 segmentation state" but no doc covers SAM2State shape, RLE compression, propagation, mask display settings, or point management
- `src/stores/multicamStore.ts` -- mentioned in CLAUDE.md section 3 as "Multicam editing state" but no doc describes MultiCamSource, CameraAnalysis, FrameAnalysis, DetectedFace, TranscriptEntry, EditDecision, EditStyle, EDL generation pipeline, analysis/transcript/EDL status tracking, or applyEDLToTimeline flow
- `src/stores/youtubeStore.ts` -- mentioned in CLAUDE.md section 3 as "YouTube download state" but no doc covers YouTubeVideo interface, video CRUD, lastQuery persistence, or getState/loadState project serialization

**Timeline helper files not in any doc:**
- `src/stores/timeline/selectors.ts` -- 50+ selectors for optimized subscriptions (selectCoreData, selectPlaybackState, selectViewState, etc.) with no documentation
- `src/stores/timeline/constants.ts` -- exports MAX_NESTING_DEPTH, calculateNativeScale, DEFAULT_TEXT_PROPERTIES, MIN_ZOOM/MAX_ZOOM, RAM_PREVIEW_FPS, FRAME_TOLERANCE, GROUP_HEADER_HEIGHT and other constants with no dedicated doc
- `src/stores/timeline/utils.ts` -- exports seekVideo, getDefaultEffectParams, quantizeTime with no documentation
- `src/stores/timeline/helpers/clipStateHelpers.ts` -- updateClipById helper undocumented
- `src/stores/timeline/helpers/idGenerator.ts` -- all ID generation functions (generateLinkedClipIds, generateTextClipId, generateSolidClipId, generateYouTubeClipId, generateEffectId, generateLinkedGroupId) undocumented

**MediaStore helper files:**
- `src/stores/mediaStore/types.ts` -- MediaState interface, TextItem, SolidItem types not fully documented
- `src/stores/mediaStore/constants.ts` -- DEFAULT_COMPOSITION not documented
- `src/stores/mediaStore/init.ts` -- Auto-init, autosave, triggerTimelineSave, beforeunload handler not documented

### Inaccurate Documentation

1. **Media-Panel.md line 93**: States "Default text: 'New Text', font: Arial 48px white" but `src/stores/timeline/constants.ts` line 115 shows `text: 'Enter text'`, `fontFamily: 'Roboto'`, `fontSize: 72`. Three values are wrong.

2. **Keyframes.md line 264**: States "14" tests for keyframeSlice.test.ts. Actual count is **96** test cases (`it()` calls). The doc is severely outdated.

3. **Keyframes.md line 265**: States "120" tests for keyframeInterpolation.test.ts. Actual count is **112**. Off by 8.

4. **Media-Panel.md line 501**: States "99" tests for compositionSlice.test.ts. Actual count is **101**. Off by 2.

5. **Timeline.md line 532**: States "17 slices + 2 utility modules". Count is correct (17 slices: trackSlice, clipSlice, textClipSlice, solidClipSlice, clipEffectSlice, linkedGroupSlice, downloadClipSlice, playbackSlice, ramPreviewSlice, proxyCacheSlice, selectionSlice, keyframeSlice, maskSlice, markerSlice, transitionSlice, clipboardSlice, aiActionFeedbackSlice + positioningUtils + serializationUtils). However, the index.ts also defines **inline utils** (getClipsAtTime, updateDuration, findAvailableAudioTrack), **layerActions** (setLayers, updateLayer, selectLayer), and **exportActions** (setExportProgress, startExport, endExport) that are not mentioned as separate concerns in the store architecture table.

6. **Timeline.md line 565**: The `clip/` directory listing includes `addVideoClip.ts, addAudioClip.ts, addImageClip.ts, addCompClip.ts, completeDownload.ts, upgradeToNativeDecoder.ts` but is missing `clip/index.ts` which exists on disk and re-exports all clip functions.

7. **Keyframes.md line 59**: Keyframe interface shows `easing: EasingType` but does not list `'bezier'` as an EasingType value. The code in types.ts imports EasingType from `../../types` and the keyframeSlice explicitly uses `'bezier' as const` (line 533). The Easing Modes section (line 124) does list bezier, so this is an inconsistency within the doc itself between the interface definition and the table.

8. **CLAUDE.md section 4**: The Zustand Slice Pattern example shows `SliceCreator<Actions>` but the actual type definition in types.ts (line 498) is `SliceCreator<T>` with a generic parameter. The example is technically correct but could be misleading since it implies `Actions` is a concrete type.

9. **Masks.md line 138-148**: The `ClipMask` interface shown is missing fields that exist in the actual code: `name` (string), `expanded` (boolean), and `visible` (boolean). These are set in maskSlice.ts line 57-68 (addMask method).

10. **Timeline.md line 36**: States "Default: 2 video tracks (Video 2 at top, Video 1 below)". The constants.ts confirms this but also shows Audio track is named "Audio" (not "Audio 1"). The doc at line 42 says "Default: 1 audio track" but doesn't note it's named "Audio" not "Audio 1".

11. **Media-Panel.md line 153**: States "Default duration: 60 seconds, frame rate: 30 fps" for compositions. Need to verify against mediaStore constants -- the DEFAULT_COMPOSITION in constants.ts would need checking, but the settingsStore shows fps default is 60, not 30.

12. **Timeline.md line 144**: States "Speed (-400% to 400%)" but the code in keyframeSlice.ts does not enforce any speed range limits. The setPropertyValue action just passes the value through. The playback speed for JKL control is capped at 8x (line 217-218 of playbackSlice.ts), but clip speed property has no enforced bounds.

### Missing Features (post-2026-03-08)

Based on git log analysis of changes after March 8, 2026:

1. **`timelineSessionId` state field** (added in commit 47a8f059): New async session guard for composition switches/reloads. Present in `types.ts` and `index.ts`. Not documented in Timeline.md. The field prevents stale async callbacks from writing to wrong composition state.

2. **`addAIOverlaysBatch` action** (added/enhanced in commit d02cce9c): Batch overlay creation with staggered animations. The `AIActionOverlayType` was extended with `'silent-zone'` and `'low-quality-zone'` types. Timeline.md mentions split/delete/trim/move overlays but NOT silent-zone or low-quality-zone.

3. **`showChangelogOnStartup` setting** (added in commit e84784d9): New settingsStore field for controlling changelog dialog behavior. Not in any doc.

4. **Per-layer preview tab sources** (commit d0d9afed): `addPreviewPanel` and `updatePanelData` actions on dockStore, plus new `PreviewPanelData` type. No documentation.

5. **`projectFileService` import in serializationUtils** (commits 95304a59, ea828a6d, 4abf7603): Enhanced serialization with project file persistence, thumbnail cache service integration, and WebCodecsPlayer cache management. Not reflected in docs.

### Stale References

1. **Keyframes.md test count**: 14 stated vs 96 actual for keyframeSlice.test.ts -- off by ~7x. This suggests the doc was written when there were only 14 tests and never updated.

2. **Keyframes.md test count**: 120 stated vs 112 actual for keyframeInterpolation.test.ts -- either tests were removed/consolidated, or the count was originally wrong.

3. **Media-Panel.md test count**: 99 stated vs 101 actual for compositionSlice.test.ts -- likely 2 tests were added after the doc was written.

4. **CLAUDE.md section 3**: The `mediaStore/` entry says "Slices: fileImport, fileManage, folder, proxy, composition, slot, ..." which omits `multiLayerSlice`, `selectionSlice`, and `projectSlice` from the explicit list (they're covered by the "...").

### Documentation Quality Issues

1. **No standalone store documentation pages**: None of the 9 standalone stores (historyStore, engineStore, settingsStore, dockStore, sliceStore, renderTargetStore, sam2Store, multicamStore, youtubeStore) have dedicated feature doc pages in `docs/Features/`. The only mentions are one-line entries in CLAUDE.md section 3 and section 6.

2. **Missing state shape documentation for timeline store**: The `TimelineState` interface in types.ts has 40+ fields, but Timeline.md's Store Architecture section only lists slices as a table -- it never shows the state shape (what data the store holds). Fields like `clipAnimationPhase`, `slotGridProgress`, `timelineSessionId`, `clipEntranceAnimationKey`, `aiMovingClips`, `expandedTrackPropertyGroups`, `curveEditorHeight`, `maskDragging`, etc. are undocumented.

3. **Missing actions documentation**: Several action interfaces exist in types.ts but aren't documented anywhere:
   - `ExportActions` (setExportProgress, startExport, endExport) -- not in Timeline.md
   - `LayerActions` (setLayers, updateLayer, selectLayer) -- not in Timeline.md
   - `ProxyCacheActions.invalidateCache` -- the most frequently called action in the codebase, used by almost every mutation, not documented

4. **Keyframes.md speed property**: The `speed` property is animatable and has sophisticated integration logic (calculateSourceTime, getSpeedAtTime, calculateTimelineDuration from speedIntegration.ts) but Keyframes.md does not mention speed as an animatable property. Timeline.md covers speed at a high level but doesn't explain the keyframe integration.

5. **selectors.ts pattern undocumented**: The timeline store exports 50+ selectors for optimized re-render performance (selectCoreData, selectPlaybackState, selectViewState, etc.) and grouped action selectors. This pattern is important for contributors but has zero documentation.

6. **Clipboard flow incomplete**: Timeline.md mentions copy/paste in Clip Operations, but clipboardSlice.ts has complex logic for reloading media after paste (text regeneration, solid canvas creation, video/audio element creation, WebCodecs initialization) that is entirely undocumented.

---

## Recommended Changes

### Priority 1 (Critical -- misleading information)

1. **Fix test counts in Keyframes.md**: Update keyframeSlice.test.ts from "14" to "96", keyframeInterpolation.test.ts from "120" to "112"
2. **Fix test count in Media-Panel.md**: Update compositionSlice.test.ts from "99" to "101"
3. **Fix default text properties in Media-Panel.md**: Change "New Text" to "Enter text", "Arial" to "Roboto", "48px" to "72px"
4. **Fix ClipMask interface in Masks.md**: Add missing fields `name`, `expanded`, `visible`

### Priority 2 (High -- missing coverage for used features)

5. **Document `timelineSessionId`**: Add to Timeline.md's state shape section -- critical for understanding async safety
6. **Document AI overlay types**: Add `silent-zone` and `low-quality-zone` to Timeline.md's AI Action Feedback section
7. **Document `invalidateCache` action**: This is the most important side-effect action in the codebase, called from nearly every mutation
8. **Document selectors.ts pattern**: Add a section to Timeline.md or CLAUDE.md explaining the grouped selector pattern and why it matters for performance
9. **Document ExportActions and LayerActions**: These are defined in types.ts and used in index.ts but missing from the store architecture table

### Priority 3 (Medium -- missing standalone store docs)

10. **Create `docs/Features/History.md`**: Document StateSnapshot shape, batch grouping, flush/suppress callbacks, maxHistorySize, deep clone strategy
11. **Create `docs/Features/Settings.md`**: Document all 30+ settings, theme modes, API key encryption, persist config
12. **Create `docs/Features/Dock-System.md`**: Document DockLayout tree, floating panels, drag state, panel visibility, persist config
13. **Document render target and slice stores**: Either in existing Output Manager docs or new dedicated pages

### Priority 4 (Low -- completeness)

14. **Document speed as animatable property in Keyframes.md**: Explain integration with speedIntegration.ts utilities
15. **Document clipboard paste media reloading flow**: The complex async media reload in clipboardSlice.ts
16. **Document mediaStore helper modules**: importPipeline.ts, mediaInfoHelpers.ts, thumbnailHelpers.ts, fileHashHelpers.ts
17. **Document timeline helper modules**: idGenerator.ts, clipStateHelpers.ts, blobUrlManager.ts
18. **Expand CLAUDE.md section 3 mediaStore listing**: Replace "..." with explicit mention of multiLayerSlice, selectionSlice, projectSlice
