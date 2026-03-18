# Domain 2: State & Stores - Reviewer B Findings

## Summary
- Files audited: 42 (11 standalone stores, 17 timeline slices + 2 utils + types + constants + selectors + clip/ helpers/, 9 mediaStore slices + types + constants + init + helpers/)
- Docs reviewed: 5 (Timeline.md, Media-Panel.md, Keyframes.md, Masks.md, CLAUDE.md Section 3-4)
- Critical gaps found: 7
- Inaccuracies found: 9
- Missing features (post-2026-03-08): 5

---

## Gap Analysis

### 1. Undocumented Files

#### 1.1 Standalone Stores Completely Undocumented
The following stores exist in `src/stores/` but have **no dedicated documentation** in `docs/Features/`:

| Store | File | Lines | Purpose |
|-------|------|-------|---------|
| **dockStore** | `dockStore.ts` | 773 | Full panel layout system: split/tab-group tree, floating panels, drag-drop, panel zoom, panel visibility toggling, multi-preview panels, project persistence. Complex store with 25+ actions. |
| **sliceStore** | `sliceStore.ts` | 433 | Output Manager slice configurations: corner-pin warping, input/output corners, mask inversion, per-project localStorage persistence, auto-save subscription, saved target metadata for reconnection. |
| **renderTargetStore** | `renderTargetStore.ts` | 233 | Render target lifecycle: register/unregister, source routing (activeComp/program/composition/layer/layer-index/slot), canvas/window binding, transparency grid, fullscreen. |
| **sam2Store** | `sam2Store.ts` | 199 | SAM2 AI segmentation: model download progress, session management, prompt points, frame masks with RLE compression, mask propagation, display settings. Includes RLE compress/decompress utilities. |
| **multicamStore** | `multicamStore.ts` | 750 | AI Multicam Editor: camera management, audio sync, CV analysis, Whisper transcription, Claude-powered EDL generation, timeline integration. |
| **youtubeStore** | `youtubeStore.ts` | 86 | YouTube panel: video list management, search query persistence, project save/load. |
| **engineStore** | `engineStore.ts` | 72 | Engine status, GPU info, performance stats, Linux Vulkan warning. |
| **settingsStore** | `settingsStore.ts` | 348 | Theme, API keys (encrypted IndexedDB), transcription provider, preview quality, autosave, native helper, GPU preference, media import, tutorials, changelog, output resolution. |

**Impact:** These 8 standalone stores represent significant application state (over 2,900 lines of code) that has zero feature-level documentation. CLAUDE.md Section 3 lists them with one-line descriptions, but provides no state shape, action inventory, or interaction details.

#### 1.2 Undocumented Timeline Files

| File | Purpose | Gap |
|------|---------|-----|
| `selectors.ts` (252 lines) | 30+ optimized Zustand selectors for minimal re-renders: individual selectors, grouped selectors (for `useShallow`), derived selectors, stable action selectors | Not mentioned in any documentation |
| `constants.ts` (136 lines) | All timeline constants including `MAX_NESTING_DEPTH`, `DEFAULT_TRANSFORM`, `calculateNativeScale()`, zoom limits, track height limits, RAM preview FPS, text defaults | Timeline.md references some values but does not document this file as a whole |
| `utils.ts` (47 lines) | `seekVideo()`, `getDefaultEffectParams()`, `quantizeTime()` helpers | Not documented |
| `helpers/audioDetection.ts` (8014 bytes) | Audio detection logic | Listed in Timeline.md table but no detail |
| `helpers/blobUrlManager.ts` (5399 bytes) | Blob URL lifecycle management | Listed but not described |
| `helpers/clipStateHelpers.ts` (2591 bytes) | Clip state utility functions | Listed but not described |
| `helpers/mp4MetadataHelper.ts` (7233 bytes) | MP4 metadata extraction | Listed but not described |
| `helpers/webCodecsHelpers.ts` (6926 bytes) | WebCodecs integration helpers | Listed but not described |

#### 1.3 Undocumented MediaStore Files

| File | Purpose | Gap |
|------|---------|-----|
| `init.ts` (288 lines) | Store initialization: IndexedDB init, timeline restore, auto-save (30s interval), beforeunload handler, transcript/analysis status sync from clips to media files, text/solid item localStorage persistence, audio cleanup | Not documented anywhere |
| `constants.ts` (56 lines) | `PROXY_FPS`, `LARGE_FILE_THRESHOLD`, `HASH_SIZE`, timeout constants, `DEFAULT_COMPOSITION`, container format map | Not documented |
| `types.ts` (163 lines) | Full type definitions including `MediaSliceCreator`, `ImportResult`, `MediaState` interface | Media-Panel.md shows partial `MediaFile` interface but omits `MediaState`, `MediaSliceCreator`, `ImportResult` |
| `helpers/importPipeline.ts` | Unified import processing | Listed in Media-Panel.md but no detail on implementation |

---

### 2. Inaccurate Documentation

#### 2.1 Timeline Store Slice Count
- **Timeline.md says:** "The timeline store combines 17 slices + 2 utility modules"
- **Actual:** 17 slices + 2 utility modules is correct by count, BUT the store also includes inline `layerActions` (setLayers, updateLayer, selectLayer) and `exportActions` (setExportProgress, startExport, endExport) that are NOT slices but are part of the store. These 6 actions are undocumented in the slice table.

#### 2.2 Missing `upgradeToNativeDecoder.ts` from clip/ exports
- **Timeline.md documents:** `clip/` contains `addVideoClip.ts`, `addAudioClip.ts`, `addImageClip.ts`, `addCompClip.ts`, `completeDownload.ts`, `upgradeToNativeDecoder.ts`
- **Actual `clip/index.ts` exports:** Only `addVideoClip`, `addAudioClip`, `addImageClip`, `addCompClip`, `completeDownload` -- `upgradeToNativeDecoder` exists as a file but is NOT re-exported from the clip index barrel.
- The documentation lists it as part of the directory contents (correct) but the index.ts does not export it. This is a docs-vs-code discrepancy that could confuse developers.

#### 2.3 Keyframes.md Test Count Discrepancy
- **Keyframes.md says:** `keyframeSlice.test.ts` has "14" tests
- **Timeline.md says:** `keyframeSlice.test.ts` has "94" tests
- These refer to the same file. One of them is wrong. Given the file is listed at `tests/stores/timeline/keyframeSlice.test.ts` in both docs, the "14" in Keyframes.md appears outdated.

#### 2.4 MediaFile Interface Partial Documentation
- **Media-Panel.md** shows a `MediaFile` interface with 30+ fields
- **Actual `types.ts`** has additional fields not in docs: `proxyVideoUrl`, `transcribedRanges` (typed as `[number, number][]`)
- `proxyVideoUrl` is in the type but not documented in the Media-Panel.md interface listing

#### 2.5 MediaState Missing `proxyEnabled` Field
- **`MediaState` interface** in `types.ts` declares `proxyEnabled: boolean` at line 146
- **`mediaStore/index.ts`** initial state does NOT set `proxyEnabled` inline; it comments "proxyEnabled is defined in proxySlice"
- **Media-Panel.md** documents `proxyEnabled` / `toggleProxyEnabled()` but does not mention that the initial value comes from the proxy slice, not from the top-level initial state

#### 2.6 CLAUDE.md Section 3 Architecture Tree Missing Files
- Lists `timeline/` as "Slices: track, clip, keyframe, mask, playback, selection, transition, ..."
- Does not mention: `ramPreviewSlice`, `proxyCacheSlice`, `clipEffectSlice`, `linkedGroupSlice`, `downloadClipSlice`, `solidClipSlice`, `textClipSlice`, `clipboardSlice`, `aiActionFeedbackSlice`, `markerSlice`
- The "..." is doing a lot of heavy lifting; 10 of 17 slices are omitted

#### 2.7 History Store StateSnapshot vs Actual State
- **MEMORY.md** says: "`clipKeyframes` is `Map<string, Keyframe[]>` in store but serialized to `Record<string, Keyframe[]>` in snapshots"
- This is accurate, but the `historyStore.ts` StateSnapshot also captures `dock: { layout: DockNode | null }` which is not mentioned in any documentation about the history system
- The snapshot captures `selectedClipIds` as `string[]` (converted from `Set<string>`) but this conversion is not documented

#### 2.8 Default Text Properties Mismatch
- **Timeline.md** says text clips have "Default duration: 5 seconds" and default font "font family" is configurable
- **`constants.ts`** shows `DEFAULT_TEXT_PROPERTIES` with `fontFamily: 'Roboto'`, `fontSize: 72`
- **`mediaStore/index.ts`** `createTextItem` uses `fontFamily: 'Arial'`, `fontSize: 48`
- These are TWO DIFFERENT defaults for the same concept (text in Media Panel vs text clip on timeline), and neither doc clarifies this distinction

#### 2.9 Masks.md Missing Actions from MaskActions Interface
- **Masks.md** documents `addMask`, `removeMask`, `updateMask`, `reorderMasks`, `addVertex`, `removeVertex`, `updateVertex`, `closeMask`
- **Actual `MaskActions` interface** also includes: `setMaskEditMode`, `setMaskDragging`, `setMaskDrawStart`, `setActiveMask`, `selectVertex`, `deselectAllVertices`, `getClipMasks`, `addRectangleMask`, `addEllipseMask`
- 9 additional actions are undocumented in Masks.md

---

### 3. Missing Features (post-2026-03-08)

#### 3.1 `addAIOverlaysBatch` Action (commit d02cce9c, ~Mar 11)
- New batch overlay creation for efficient bulk split animations with CSS-staggered delays
- **Not documented** in Timeline.md's AI Action Feedback section
- The `AIActionOverlayType` union was also extended with `'silent-zone' | 'low-quality-zone'` -- undocumented

#### 3.2 `timelineSessionId` State Field (commit 47a8f059, ~Mar 12)
- New guard for async callbacks during composition switches/reloads
- Added to `TimelineState` but not mentioned in any documentation
- Purpose: async callbacks verify session ID to avoid writing stale nested clip UI

#### 3.3 Composition Slice Major Expansion (~246 lines added, commit d0d9afed)
- Per-layer preview tab sources added to composition management
- `compositionSlice.ts` grew significantly since March 8 (26,622 bytes current)
- New functionality for multi-preview panel support not documented in Media-Panel.md

#### 3.4 `showChangelogOnStartup` Settings (commit e84784d9)
- New `showChangelogOnStartup` boolean in settingsStore
- New `setShowChangelogOnStartup` action
- Persisted to localStorage via partialize
- Not documented in any features doc

#### 3.5 Playback Slice Changes (commit 98b04a1a)
- Fixes for playback stuttering, frame rate limiting, and scrub freeze-frame issues
- 20+ lines changed in `playbackSlice.ts`
- Behavioral changes not reflected in Timeline.md playback documentation

---

### 4. Stale References

#### 4.1 CLAUDE.md References "mixerStore" Indirectly
- `historyStore.ts` line 19 comments: "Timeline state (including layers since they moved here from mixerStore)"
- The mixerStore no longer exists; layers are in the timeline store
- CLAUDE.md does not mention mixerStore, but `engineStore.ts` header says "Extracted from mixerStore during VJ mode removal"
- This migration is undocumented -- no doc explains the historical context

#### 4.2 SliceStore References to "Output Manager"
- `sliceStore.ts` uses localStorage keys prefixed with `Outputmanager_`
- References `useRenderTargetStore` for target metadata
- Neither store has documentation explaining this relationship

#### 4.3 MediaStore Init References Undocumented Services
- `init.ts` imports `compositionAudioMixer`, `audioRoutingManager`, `audioAnalyzer`, `proxyFrameCache`, `audioExtractor`
- These service dependencies and the cleanup flow in `disposeAllAudio()` are not documented in any store docs

---

### 5. Cross-Store Interactions (Undocumented)

#### 5.1 Timeline <-> Media Store
- `compositionSlice.ts` imports `useTimelineStore` to save/load timeline data per composition
- `init.ts` coordinates between `useMediaStore` and `useTimelineStore` for initialization
- Timeline's `addCompClip` receives a `Composition` type from mediaStore
- **Not documented:** The bidirectional save/load cycle where switching compositions triggers `saveTimelineToActiveComposition()` then `loadState()`

#### 5.2 History Store <-> Timeline + Media + Dock
- `historyStore.ts` captures snapshots from timeline, media, and dock stores
- Uses dynamic store references via `initHistoryStoreRefs()` to avoid circular imports
- Converts `Set<string>` to `string[]` and `Map<string, Keyframe[]>` to `Record<string, Keyframe[]>` during snapshot/restore
- **Not documented:** The serialization boundaries between live store types and snapshot types

#### 5.3 SliceStore <-> RenderTargetStore
- `sliceStore.ts` subscribes to `renderTargetStore` targets to clean up orphaned configs
- `sliceStore.ts` reads render target window geometry for localStorage persistence
- **Not documented anywhere**

#### 5.4 RenderTargetStore <-> MediaStore
- `renderTargetStore.ts` reads `activeCompositionId` and `activeLayerSlots` from mediaStore to resolve render sources
- **Not documented:** The source resolution logic mapping `RenderSource` types to composition IDs

#### 5.5 SettingsStore <-> Multiple Stores
- `constants.ts` in timeline reads from `useSettingsStore` for output resolution in `calculateNativeScale()`
- `constants.ts` also reads from `useMediaStore` for active composition dimensions
- **Not documented:** This cross-store dependency in a "constants" file is an unusual pattern

---

### 6. Documentation Quality Issues

#### 6.1 No Store Interaction Diagram
None of the documentation files contain a diagram or description of how stores interact. The 11 stores have at least 8 cross-store dependencies that are invisible to developers reading docs alone.

#### 6.2 Inconsistent Depth of Coverage
- Timeline store: Excellent coverage (Timeline.md has full slice table, component table, hook table)
- Media store: Good coverage (Media-Panel.md has slice table and type definitions)
- History store: Mentioned in MEMORY.md but no dedicated doc
- All other 8 stores: Single-line descriptions in CLAUDE.md only

#### 6.3 Missing State Shape Documentation for Standalone Stores
None of the standalone stores (engine, settings, dock, slice, renderTarget, sam2, multicam, youtube) have their state shape documented. For example:
- `settingsStore` has 25+ state fields (theme, API keys, transcription provider, preview quality, autosave, native helper, GPU preference, media import, tutorials, changelog, output resolution, mobile mode) -- none documented in features docs
- `dockStore` has a complex tree-based layout system with split nodes and tab groups -- not described anywhere

#### 6.4 Selectors File Is a Major Optimization Not Documented
`selectors.ts` (252 lines) implements an optimization strategy with:
- Individual selectors for frequent state (playhead, clips, tracks)
- Grouped selectors for `useShallow()` reducing 29 subscriptions to 6
- Stable action selectors that don't cause re-renders
- Derived selectors (video/audio track filters, solo detection)

This is a significant architectural decision that developers should know about but is not mentioned in any documentation.

#### 6.5 CLAUDE.md Section 4 Zustand Patterns Are Incomplete
The "Zustand Slice Pattern" example shows:
```typescript
export const createSlice: SliceCreator<Actions> = (set, get) => ({
  actionName: (params) => {
    const state = get();
    set({ /* updates */ });
  },
});
```
But does not mention:
- The `subscribeWithSelector` middleware used by all stores
- The `persist` middleware used by settingsStore and dockStore
- The `MediaSliceCreator` variant for mediaStore slices
- The inline utility pattern used in timeline's index.ts (layerActions, exportActions)

---

## Recommended Changes

### Priority 1 (Critical)
1. **Create `docs/Features/Store-Architecture.md`** -- a unified document showing all 11 stores, their state shapes, action counts, and cross-store interactions. Include a dependency diagram.
2. **Document `historyStore` properly** -- the snapshot structure, serialization boundaries (Set->Array, Map->Record), batch grouping API, and debounce/suppression mechanism are complex and completely undocumented.
3. **Fix Keyframes.md test count** -- update from "14" to the correct count (should match Timeline.md's "94").

### Priority 2 (High)
4. **Document `settingsStore` state and actions** -- 25+ state fields and 20+ actions with no feature doc. At minimum, document the encrypted API key flow (IndexedDB + project file fallback).
5. **Document `dockStore` layout system** -- the split/tab-group tree, floating panels, drag-drop, and persistence are a complex subsystem that needs its own section.
6. **Update Timeline.md AI Action Feedback section** -- add `addAIOverlaysBatch`, document new overlay types (`silent-zone`, `low-quality-zone`), mention `timelineSessionId`.
7. **Update Masks.md action inventory** -- add the 9 missing actions (setMaskEditMode, setMaskDragging, etc.).

### Priority 3 (Medium)
8. **Document `selectors.ts` optimization strategy** -- this is a key performance pattern that should be in the store architecture doc.
9. **Document `init.ts` initialization flow** -- the boot sequence (IndexedDB -> timeline restore -> status sync -> auto-save -> beforeunload) is critical for understanding app startup.
10. **Fix CLAUDE.md Section 3** -- either list all 17 timeline slices or use a more accurate summary than "..." after listing only 7.
11. **Clarify text defaults discrepancy** -- document that Media Panel text items use Arial/48px while timeline text clips use Roboto/72px, and explain why.
12. **Document cross-store constants dependency** -- `calculateNativeScale()` in constants.ts reading from two different stores at call time is worth calling out as a pattern.

### Priority 4 (Low)
13. **Document `renderTargetStore`** -- source resolution logic and the 6 source types (activeComp, program, composition, layer, layer-index, slot).
14. **Document `sam2Store`** -- including the RLE compression/decompression utilities exported alongside the store.
15. **Document `multicamStore`** -- the full AI multicam pipeline (cameras -> sync -> analysis -> transcript -> EDL -> timeline).
16. **Document `youtubeStore`** -- minimal but should at least be mentioned in the features index.
17. **Clean up mixerStore references** -- remove or annotate historical comments about mixerStore migration in source code.
