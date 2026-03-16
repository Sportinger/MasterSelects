# Domain 2: State & Stores - Consolidated Findings

## Methodology
Two blind reviewers independently audited 42+ source files across `src/stores/` (timeline, mediaStore, and 9 standalone stores) against 5 documentation files (Timeline.md, Media-Panel.md, Keyframes.md, Masks.md, CLAUDE.md sections 3-4). Conflicts were resolved by checking actual source code.

---

## Consensus (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | **8 standalone stores completely undocumented** -- historyStore, engineStore, settingsStore, dockStore, sliceStore, renderTargetStore, sam2Store, multicamStore, youtubeStore have zero dedicated feature docs. Only one-line entries in CLAUDE.md Section 3/6. Over 2,900 lines of code with no feature-level documentation. | CRITICAL | LARGE | New docs needed; CLAUDE.md |
| C2 | **`selectors.ts` (252 lines, 50 selectors) entirely undocumented** -- Major performance optimization pattern (individual, grouped for useShallow, derived, stable action selectors) with no mention in any doc. | HIGH | MEDIUM | Timeline.md or new Store-Architecture.md |
| C3 | **Timeline helper files undocumented** -- `constants.ts`, `utils.ts`, `helpers/clipStateHelpers.ts`, `helpers/idGenerator.ts`, `helpers/blobUrlManager.ts`, `helpers/audioDetection.ts`, `helpers/mp4MetadataHelper.ts`, `helpers/webCodecsHelpers.ts` either unlisted or listed without detail. | MEDIUM | MEDIUM | Timeline.md |
| C4 | **MediaStore helper files undocumented** -- `init.ts` (288 lines: IndexedDB init, auto-save, beforeunload handler, audio cleanup), `constants.ts`, `types.ts` (MediaState, ImportResult, MediaSliceCreator) not documented. | MEDIUM | MEDIUM | Media-Panel.md |
| C5 | **Keyframes.md test count wrong: 14 vs actual 96** for `keyframeSlice.test.ts`. Timeline.md says 94, also wrong. Actual `it()` count is **96**. | CRITICAL | SMALL | Keyframes.md, Timeline.md |
| C6 | **`keyframeInterpolation.test.ts` count wrong: 120 vs actual 112** | MEDIUM | SMALL | Keyframes.md |
| C7 | **`compositionSlice.test.ts` count wrong: 99 vs actual 101** | LOW | SMALL | Media-Panel.md |
| C8 | **`addAIOverlaysBatch` action + new overlay types undocumented** (post-2026-03-08). `AIActionOverlayType` extended with `'silent-zone'` and `'low-quality-zone'`. Not in Timeline.md's AI section. | HIGH | SMALL | Timeline.md |
| C9 | **`timelineSessionId` state field undocumented** (post-2026-03-08). Guards async callbacks during composition switches. Critical for understanding async safety. | HIGH | SMALL | Timeline.md |
| C10 | **`showChangelogOnStartup` setting undocumented** (post-2026-03-08). New settingsStore field and action. | LOW | SMALL | Settings doc (if created) |
| C11 | **Per-layer preview tab sources undocumented** (post-2026-03-08). `addPreviewPanel`, `updatePanelData`, `PreviewPanelData` in dockStore. | MEDIUM | SMALL | Dock doc (if created) |
| C12 | **LayerActions and ExportActions undocumented** -- `setLayers`/`updateLayer`/`selectLayer` and `setExportProgress`/`startExport`/`endExport` defined in types.ts, used in index.ts, missing from Timeline.md slice/action table. | HIGH | SMALL | Timeline.md |
| C13 | **`invalidateCache` action undocumented** -- Part of ProxyCacheActions, called from nearly every mutation. The most important side-effect action in the codebase. | HIGH | SMALL | Timeline.md |
| C14 | **CLAUDE.md Section 3 timeline slice listing incomplete** -- Lists only 7 of 17 slices ("track, clip, keyframe, mask, playback, selection, transition, ..."). Omits 10 slices: ramPreviewSlice, proxyCacheSlice, clipEffectSlice, linkedGroupSlice, downloadClipSlice, solidClipSlice, textClipSlice, clipboardSlice, aiActionFeedbackSlice, markerSlice. | MEDIUM | SMALL | CLAUDE.md |
| C15 | **CLAUDE.md Section 4 Zustand patterns incomplete** -- Shows basic slice pattern but omits `subscribeWithSelector` middleware (used by all stores), `persist` middleware (settingsStore, dockStore), `MediaSliceCreator` variant, and inline utility pattern. | MEDIUM | SMALL | CLAUDE.md |
| C16 | **Missing state shape documentation** -- The `TimelineState` interface has 40+ fields, but Timeline.md only lists slices in a table, never showing the state shape. Fields like `clipAnimationPhase`, `slotGridProgress`, `timelineSessionId`, `clipEntranceAnimationKey`, `aiMovingClips`, `expandedTrackPropertyGroups`, `curveEditorHeight`, `maskDragging` are all undocumented. | HIGH | MEDIUM | Timeline.md |

---

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | **Media-Panel.md line 93: Default text properties wrong** -- says "New Text, Arial 48px white" but timeline `constants.ts` shows `'Enter text'`, `'Roboto'`, `72`. | CRITICAL | SMALL | **Partially verified.** Timeline `DEFAULT_TEXT_PROPERTIES` uses `'Enter text'`/`'Roboto'`/`72`. However, mediaStore `createTextItem` uses `'Arial'`/`48`. These are two different defaults for timeline text clips vs Media Panel text items. Media-Panel.md's values (`Arial`/`48px`) actually match the mediaStore code for text *items*, but the label "New Text" is unverified (likely the default `name` parameter, not `text` content). The doc is misleading because it conflates two different text defaults. |
| A2 | **Keyframes.md line 59: EasingType interface missing 'bezier'** -- The interface listing omits `'bezier'` but the Easing Modes table at line 124 lists it. Internal doc inconsistency. | LOW | SMALL | **Verified.** The doc is inconsistent with itself: interface definition omits bezier, table includes it. |
| A3 | **Masks.md ClipMask interface missing fields** -- `name` (string), `expanded` (boolean), `visible` (boolean) all present in maskSlice.ts addMask method but absent from Masks.md interface definition. | HIGH | SMALL | **Verified.** maskSlice.ts lines 57-68 set `name`, `expanded`, and `visible` on new masks. Masks.md line 138-148 omits all three fields. |
| A4 | **Timeline.md line 36: Audio track named "Audio" not "Audio 1"** -- constants.ts confirms `name: 'Audio'` for the default audio track. | LOW | SMALL | **Verified.** DEFAULT_TRACKS shows `name: 'Audio'` for the audio track (id: 'audio-1'). Timeline.md says "1 audio track" but doesn't note the name discrepancy. |
| A5 | **Media-Panel.md line 153: composition default fps stated as 30** -- Reviewer A says this is wrong because settingsStore fps=60. | LOW | SMALL | **Verified INCORRECT finding.** DEFAULT_COMPOSITION in `mediaStore/constants.ts` explicitly sets `frameRate: 30`. The settingsStore `fps: 60` is a global output setting, not the composition default. Media-Panel.md is **correct**. |
| A6 | **Timeline.md line 144: Speed range "-400% to 400%" not enforced in code** -- keyframeSlice has no bounds on clip speed property. JKL caps at 8x but that's playback speed, not clip speed. | MEDIUM | SMALL | **Verified.** `setPropertyValue` in keyframeSlice passes speed value through without clamping. The documented range is misleading. |
| A7 | **Timeline.md line 565: clip/ directory listing missing clip/index.ts** | LOW | SMALL | **Verified.** `clip/index.ts` exists, re-exports addVideoClip, addAudioClip, addImageClip, addCompClip, completeDownload. |
| A8 | **Speed as animatable property undocumented in Keyframes.md** -- speedIntegration.ts utilities (calculateSourceTime, getSpeedAtTime, calculateTimelineDuration) not covered. | MEDIUM | MEDIUM | **Verified.** Speed keyframe integration is a sophisticated feature absent from Keyframes.md. |
| A9 | **Clipboard paste media reloading flow undocumented** -- clipboardSlice.ts has complex async logic for text regeneration, solid canvas creation, video/audio element creation, WebCodecs init after paste. | MEDIUM | MEDIUM | **Verified.** This is a non-trivial flow absent from docs. |
| A10 | **`projectFileService` integration in serializationUtils** (post-2026-03-08) -- Enhanced serialization with project file persistence, thumbnail cache, WebCodecsPlayer cache. | MEDIUM | SMALL | **Verified** via commit history reference. |

---

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | **Masks.md missing 9 actions from MaskActions interface** -- `setMaskEditMode`, `setMaskDragging`, `setMaskDrawStart`, `setActiveMask`, `selectVertex`, `deselectAllVertices`, `getClipMasks`, `addRectangleMask`, `addEllipseMask` all present in types.ts MaskActions but not in Masks.md. | HIGH | SMALL | **Verified.** types.ts lines 429-447 define all 9 additional actions. Masks.md only documents 8 of 17 mask actions. |
| B2 | **`upgradeToNativeDecoder.ts` exists as file but NOT re-exported from clip/index.ts** -- Timeline.md lists it in the directory contents (file exists, correct) but clip/index.ts does not export it. Potential confusion for developers. | LOW | SMALL | **Verified.** `clip/index.ts` exports only 5 modules; `upgradeToNativeDecoder` is not among them despite the file existing on disk. |
| B3 | **MediaFile interface partially documented** -- `proxyVideoUrl` and `transcribedRanges` fields exist in types.ts but not in Media-Panel.md's interface listing. | MEDIUM | SMALL | **Verified.** types.ts line 47 has `proxyVideoUrl?: string` and line 52 has `transcribedRanges?: [number, number][]`. |
| B4 | **Two different text defaults without doc clarification** -- mediaStore `createTextItem` uses `Arial`/`48px`, timeline `DEFAULT_TEXT_PROPERTIES` uses `Roboto`/`72px`. No doc explains this distinction. | HIGH | SMALL | **Verified.** mediaStore/index.ts line 122-123 vs constants.ts line 116-117. These serve different purposes (Media Panel items vs timeline clips) but docs don't clarify. |
| B5 | **History store snapshot captures dock layout** -- `dock: { layout: DockNode | null }` in StateSnapshot. Also captures `selectedClipIds` as `string[]` (converted from `Set<string>`). Neither conversion documented. | MEDIUM | SMALL | **Verified.** historyStore.ts lines 20-46 show full StateSnapshot shape including dock layout and serialization conversions. |
| B6 | **Cross-store interactions entirely undocumented** -- At least 5 major cross-store dependencies: (1) Timeline<->Media (composition save/load cycle), (2) History<->Timeline+Media+Dock (snapshot capture), (3) SliceStore<->RenderTargetStore, (4) RenderTargetStore<->MediaStore (source resolution), (5) SettingsStore<->constants.ts (calculateNativeScale reads from 2 stores). | HIGH | LARGE | **Verified.** constants.ts lines 27-42 confirm cross-store reads. These dependencies are architecturally significant and invisible from docs alone. |
| B7 | **Playback slice behavioral changes** (post-2026-03-08, commit 98b04a1a) -- Fixes for stuttering, frame rate limiting, scrub freeze-frame. Not reflected in Timeline.md playback docs. | MEDIUM | SMALL | **Verified** via commit reference. |
| B8 | **`mixerStore` historical references in source code** -- historyStore.ts line 19 and engineStore.ts header reference a removed "mixerStore". No doc explains this migration. | LOW | SMALL | **Verified.** historyStore.ts line 19 comment: "Timeline state (including layers since they moved here from mixerStore)". |
| B9 | **MediaStore init.ts references undocumented services** -- imports `compositionAudioMixer`, `audioRoutingManager`, `audioAnalyzer`, `proxyFrameCache`, `audioExtractor`. Service dependencies and `disposeAllAudio()` cleanup not documented in store docs. | MEDIUM | SMALL | **Verified** by reviewer description; these are service-layer dependencies referenced from the store init layer. |
| B10 | **No store interaction diagram exists** -- 11 stores with 8+ cross-store dependencies have no visual or textual description of their relationships. | HIGH | MEDIUM | **Verified.** No docs contain any dependency mapping between stores. |

---

## Conflicts Resolved

### 1. Default text properties in Media-Panel.md (A1 vs B4)

**Reviewer A** said Media-Panel.md is wrong because it says "Arial 48px" while constants.ts shows "Roboto 72px".
**Reviewer B** noted there are TWO different defaults: mediaStore uses Arial/48, timeline uses Roboto/72.

**Resolution:** Both are partially right. Media-Panel.md line 93 says "Arial 48px" which matches `mediaStore/index.ts` `createTextItem` (Arial, 48). However, the doc also says "New Text" as default text content, which may not match. The real gap is that **neither doc explains there are two separate text defaults** for different contexts (Media Panel text items vs timeline text clips). **Reviewer B's framing is more accurate** -- the core issue is the undocumented distinction, not a simple "wrong value."

**Action:** Update Media-Panel.md to clarify these are Media Panel text item defaults. Add note about timeline text clip defaults being different (Roboto/72 from `DEFAULT_TEXT_PROPERTIES`).

### 2. Composition default frame rate (A5)

**Reviewer A** said Media-Panel.md's "frame rate: 30 fps" for compositions is wrong because settingsStore fps=60.

**Resolution: Reviewer A is incorrect.** `DEFAULT_COMPOSITION` in `mediaStore/constants.ts` explicitly sets `frameRate: 30`. The `settingsStore` `fps: 60` is the global output frame rate setting, which is a different concept. Media-Panel.md is **correct** about composition defaults. No doc change needed for this specific item.

### 3. keyframeSlice.test.ts count (A finding 14->96 vs B finding 14 vs 94)

**Reviewer A** says actual count is 96. **Reviewer B** notes Keyframes.md says 14, Timeline.md says 94, and one must be wrong.

**Resolution:** Actual `it()` count verified at **96**. Keyframes.md (14) is severely outdated. Timeline.md (94) is close but also slightly off -- likely 2 tests added after that doc was written. Both docs need updating to 96.

### 4. Selector count (A says "50+" vs B says "30+")

**Reviewer A** says "50+ selectors". **Reviewer B** says "30+ optimized Zustand selectors".

**Resolution:** Actual exported selector count is **50** (`grep -c "^export const select" selectors.ts` = 50). The file is 251 lines (B said 252, close enough). **Reviewer A's count is accurate.**

### 5. CLAUDE.md Section 3 omitted slices

**Reviewer A** says mediaStore listing omits `multiLayerSlice`, `selectionSlice`, `projectSlice`.
**Reviewer B** says timeline listing omits 10 of 17 slices.

**Resolution:** Both are correct about different parts of the same problem. CLAUDE.md Section 3 uses "..." after partial listings for both timeline and mediaStore, hiding significant store surface area. Both should be addressed.

---

## Prioritized Action Items

### CRITICAL (fix immediately -- misleading information)

1. **Keyframes.md line 264**: Update `keyframeSlice.test.ts` count from "14" to "96"
   - File: `docs/Features/Keyframes.md`
   - Effort: SMALL

2. **Timeline.md line 661**: Update `keyframeSlice.test.ts` count from "94" to "96"
   - File: `docs/Features/Timeline.md`
   - Effort: SMALL

3. **Masks.md line 138-148**: Add missing `ClipMask` fields: `name: string`, `expanded: boolean`, `visible: boolean`
   - File: `docs/Features/Masks.md`
   - Effort: SMALL

4. **Masks.md**: Add 9 missing mask actions to the documented action inventory: `setMaskEditMode`, `setMaskDragging`, `setMaskDrawStart`, `setActiveMask`, `selectVertex`, `deselectAllVertices`, `getClipMasks`, `addRectangleMask`, `addEllipseMask`
   - File: `docs/Features/Masks.md`
   - Effort: SMALL

### HIGH (significant gaps affecting developer understanding)

5. **Timeline.md**: Document `timelineSessionId` field and its purpose as async callback guard
   - File: `docs/Features/Timeline.md`, State Shape section
   - Effort: SMALL

6. **Timeline.md**: Add `addAIOverlaysBatch` action and new overlay types (`silent-zone`, `low-quality-zone`) to AI Action Feedback section
   - File: `docs/Features/Timeline.md`
   - Effort: SMALL

7. **Timeline.md**: Document `ExportActions` (setExportProgress, startExport, endExport) and `LayerActions` (setLayers, updateLayer, selectLayer) in the store architecture table
   - File: `docs/Features/Timeline.md`
   - Effort: SMALL

8. **Timeline.md**: Document `invalidateCache` action from ProxyCacheActions -- most frequently called side-effect action
   - File: `docs/Features/Timeline.md`
   - Effort: SMALL

9. **Timeline.md or new doc**: Document `selectors.ts` optimization strategy -- 50 selectors in 5 categories (individual, grouped/useShallow, derived, stable action, preview/export)
   - File: `docs/Features/Timeline.md` (new section)
   - Effort: MEDIUM

10. **Timeline.md**: Add state shape documentation for `TimelineState` (40+ fields currently undocumented)
    - File: `docs/Features/Timeline.md`
    - Effort: MEDIUM

11. **Clarify dual text defaults**: Media-Panel.md text items (Arial/48) vs timeline text clips (Roboto/72) -- add note in both docs
    - Files: `docs/Features/Media-Panel.md`, `docs/Features/Timeline.md`
    - Effort: SMALL

12. **Document cross-store interactions**: At minimum add a section listing the 5+ major store-to-store dependencies (Timeline<->Media, History<->all, SliceStore<->RenderTargetStore, RenderTarget<->MediaStore, constants.ts<->Settings+Media)
    - File: New `docs/Features/Store-Architecture.md` or section in CLAUDE.md
    - Effort: MEDIUM

13. **Keyframes.md line 265**: Update `keyframeInterpolation.test.ts` count from "120" to "112"
    - File: `docs/Features/Keyframes.md`
    - Effort: SMALL

14. **Media-Panel.md**: Update `compositionSlice.test.ts` count from "99" to "101"
    - File: `docs/Features/Media-Panel.md`
    - Effort: SMALL

### MEDIUM (missing coverage for active features)

15. **CLAUDE.md Section 3**: Expand timeline slice listing to include all 17 slices (or at least the significant ones beyond the 7 currently listed)
    - File: `CLAUDE.md`
    - Effort: SMALL

16. **CLAUDE.md Section 3**: Expand mediaStore slice listing to include `multiLayerSlice`, `selectionSlice`, `projectSlice`
    - File: `CLAUDE.md`
    - Effort: SMALL

17. **CLAUDE.md Section 4**: Add mentions of `subscribeWithSelector` middleware (all stores), `persist` middleware (settingsStore, dockStore), `MediaSliceCreator` variant
    - File: `CLAUDE.md`
    - Effort: SMALL

18. **Media-Panel.md**: Add missing `MediaFile` fields (`proxyVideoUrl`, `transcribedRanges`) to interface documentation
    - File: `docs/Features/Media-Panel.md`
    - Effort: SMALL

19. **Timeline.md**: Document speed as animatable property in Keyframes section; reference speedIntegration.ts utilities
    - File: `docs/Features/Keyframes.md`
    - Effort: MEDIUM

20. **Timeline.md line 144**: Clarify speed range -- either remove "-400% to 400%" claim or note it's a UI suggestion, not an enforced limit
    - File: `docs/Features/Timeline.md`
    - Effort: SMALL

21. **Document clipboard paste media reloading flow** -- async media reload logic in clipboardSlice.ts
    - File: `docs/Features/Timeline.md`
    - Effort: MEDIUM

22. **Document mediaStore init.ts boot sequence** -- IndexedDB -> timeline restore -> status sync -> auto-save -> beforeunload
    - File: `docs/Features/Media-Panel.md` or new Store-Architecture doc
    - Effort: MEDIUM

23. **Keyframes.md**: Fix internal inconsistency -- add `'bezier'` to EasingType in interface definition (line 59 area) to match the Easing Modes table
    - File: `docs/Features/Keyframes.md`
    - Effort: SMALL

24. **History store snapshot documentation** -- document StateSnapshot shape, Set->Array/Map->Record serialization, dock layout capture, batch grouping API
    - File: New `docs/Features/History.md` or section in Store-Architecture doc
    - Effort: MEDIUM

### LOW (completeness and polish)

25. **Create standalone store docs** -- settingsStore (30+ fields, encrypted API key flow), dockStore (tree-based layout, floating panels, persistence), renderTargetStore (6 source types), sam2Store (RLE compression), multicamStore (AI EDL pipeline), youtubeStore
    - Files: New docs in `docs/Features/`
    - Effort: LARGE (each store is MEDIUM individually)

26. **Document timeline helper modules**: idGenerator.ts, clipStateHelpers.ts, blobUrlManager.ts, mp4MetadataHelper.ts, webCodecsHelpers.ts, audioDetection.ts
    - File: `docs/Features/Timeline.md`
    - Effort: MEDIUM

27. **Document mediaStore helper modules**: importPipeline.ts, mediaInfoHelpers.ts, thumbnailHelpers.ts, fileHashHelpers.ts
    - File: `docs/Features/Media-Panel.md`
    - Effort: MEDIUM

28. **Timeline.md**: Add `clip/index.ts` to clip/ directory listing
    - File: `docs/Features/Timeline.md`
    - Effort: SMALL

29. **Note `upgradeToNativeDecoder.ts` is not exported from clip/index.ts** -- either document why or add the export
    - File: `docs/Features/Timeline.md` (note) or `src/stores/timeline/clip/index.ts` (code fix)
    - Effort: SMALL

30. **Clean up mixerStore historical references** -- annotate or remove stale comments in historyStore.ts and engineStore.ts
    - Files: `src/stores/historyStore.ts`, `src/stores/engineStore.ts`
    - Effort: SMALL

31. **Timeline.md**: Note audio track default name is "Audio" (not "Audio 1")
    - File: `docs/Features/Timeline.md`
    - Effort: SMALL

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Consensus findings | 16 |
| Reviewer A unique findings | 10 |
| Reviewer B unique findings | 10 |
| Conflicts resolved | 5 |
| Total confirmed action items | 31 |
| CRITICAL items | 4 |
| HIGH items | 10 |
| MEDIUM items | 10 |
| LOW items | 7 |
