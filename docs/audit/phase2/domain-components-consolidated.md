# Domain 4: Components & UI - Consolidated Findings

## Cross-Review Summary

- **Reviewer A**: 160 files audited, 6 critical gaps, 8 inaccuracies, 5 missing features
- **Reviewer B**: 160 files audited, 6 critical gaps, 4 inaccuracies, 8 missing features
- **Consensus items**: 12 (both reviewers independently identified)
- **Unique to A**: 6
- **Unique to B**: 8
- **Conflicts resolved**: 2

---

## Consensus (both reviewers found)

| # | Finding | Severity | Effort | Affected Doc(s) |
|---|---------|----------|--------|-----------------|
| C1 | **Mobile UI entirely undocumented** -- 7 components (`MobileApp`, `MobileTimeline`, `MobilePreview`, `MobileToolbar`, `MobilePropertiesPanel`, `MobileMediaPanel`, `MobileOptionsMenu`) with touch gestures, edge swipes, precision mode. Only a one-line mention of "mobile/desktop view toggle" in Settings. | CRITICAL | LARGE | `UI-Panels.md` (new section or new `Mobile.md`) |
| C2 | **Tutorial system docs describe 2-part system; code has 14 campaigns** across 4 categories (Basics 3, Editing 4, Creative 4, Output 3) with `TutorialCampaignDialog.tsx`, completion tracking, per-campaign progress. Parts 1/2 still exist as `interface-overview` and `timeline-controls` but are a subset. | CRITICAL | MEDIUM | `UI-Panels.md` lines 410-494 |
| C3 | **Stacked Alpha export feature undocumented** -- checkbox in `ExportPanel.tsx` and `ExportDialog.tsx` allowing transparent video export (doubles height, RGB top / alpha bottom). Added March 10-12. | HIGH | SMALL | `UI-Panels.md` Export Panel section |
| C4 | **Per-layer preview tab sources undocumented** -- `PreviewControls.tsx` now supports `layer-index` type for isolating individual video tracks from a composition. Added March 13. | HIGH | SMALL | `Preview.md` |
| C5 | **Preview.md loop shortcut incorrect** -- line 104 says `L` for "Toggle loop mode" but code (`useTimelineKeyboard.ts` line 150-154) confirms `Shift+L`. `L` alone is forward playback. `Keyboard-Shortcuts.md` is correct. | MEDIUM | SMALL | `Preview.md` line 104 |
| C6 | **Media Panel sub-components undocumented** -- `CompositionSettingsDialog.tsx`, `SolidSettingsDialog.tsx`, `LabelColorPicker.tsx`, `FileTypeIcon.tsx`, `labelColors.ts` not referenced in any doc. | LOW | SMALL | `UI-Panels.md` Media Panel section |
| C7 | **ImageCropper.tsx undocumented** -- substantial component (10,980 bytes) with no mention in any documentation. | LOW | SMALL | `UI-Panels.md` or AI Video section |
| C8 | **Output Manager sub-components undocumented** -- 9 files under `src/components/outputManager/` (`OutputManagerBoot.ts`, `SliceInputOverlay`, `SliceOutputOverlay`, `SliceList`, `SourceSelector`, `TabBar`, `TargetList`, `TargetPreview`) have no component-level docs. | MEDIUM | MEDIUM | `Preview.md` Output Manager section |
| C9 | **Animated Toolbar/Tabs slide transition for Slot Grid undocumented** -- smooth slide animation when toggling between timeline and slot grid views (March 10). | LOW | SMALL | `UI-Panels.md` or `Timeline.md` |
| C10 | **Media Panel grid view breadcrumb navigation undocumented** -- grid view, single toggle button UX, breadcrumb folder navigation. Docs mention "List view and Grid view toggle" but no detail. | MEDIUM | SMALL | `UI-Panels.md` Media Panel section |
| C11 | **RelinkDialog.tsx undocumented in UI docs** -- media relinking dialog with auto-scan, recursive folder scanning, multi-file picker, status tracking. Only referenced in `Project-Persistence.md`. | MEDIUM | SMALL | `UI-Panels.md` or `Project-Persistence.md` |
| C12 | **TutorialCampaignDialog.tsx undocumented** -- campaign selection UI with category grouping and completion tracking not described. | CRITICAL | MEDIUM | `UI-Panels.md` Tutorial section |

## Reviewer A Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| A1 | **Export sub-components undocumented** -- `FFmpegExportSection.tsx`, `CodecSelector.tsx`, `exportHelpers.ts`, `useExportState.ts` not described at component level. | LOW | SMALL | YES -- files confirmed present |
| A2 | **Scope sub-components undocumented** -- `ScopeModeToolbar.tsx`, `HistogramScope.tsx`, `VectorscopeScope.tsx`, `WaveformScope.tsx`, `useScopeAnalysis.ts` not documented. | LOW | SMALL | YES -- files confirmed present |
| A3 | **Timeline utility files undocumented** -- `constants.ts` (ALL_BLEND_MODES), `types.ts`, `utils/externalDragPlacement.ts`, `utils/externalDragSession.ts`, `utils/fileTypeHelpers.ts`, `slotGridAnimation.ts`. | LOW | SMALL | YES -- files confirmed present |
| A4 | **Timeline hooks partially documented** -- `useAutoFeatures.ts`, `useClipFade.ts`, `useLayerSync.ts`, `usePlaybackLoop.ts`, `usePlayheadSnap.ts`, `useTimelineHelpers.ts` not covered in reviewed docs. | LOW | SMALL | YES -- files confirmed present |
| A5 | **AI Chat Panel tool count stale** -- `UI-Panels.md` line 192 says "33 available tools". Actual count across all definition files is **76 tools**. Significantly outdated. | HIGH | SMALL | YES -- counted 76 tool definitions across 15 files in `src/services/aiTools/definitions/` |
| A6 | **Shared UI component library undocumented** -- `properties/shared.tsx` (18,014 bytes) contains `DraggableNumber`, `PrecisionSlider`, `ColorPickerRow` etc., used across all property tabs. Not documented anywhere. | MEDIUM | MEDIUM | YES -- file confirmed present |

## Reviewer B Unique Findings

| # | Finding | Severity | Effort | Verified? |
|---|---------|----------|--------|-----------|
| B1 | **WhatsNewDialog.tsx undocumented** -- changelog dialog with filter tabs (All/New/Fixes/Improved/Refactor), release calendar heatmap, YouTube video embed, build/WIP notice cards, "Don't show on startup" checkbox, commit links. Not in `UI-Panels.md`. | MEDIUM | MEDIUM | YES -- file confirmed present |
| B2 | **Info menu missing "Changelog on Startup" toggle** -- `Toolbar.tsx` line 766-771 shows the toggle item, but `UI-Panels.md` Info menu table (line 55-59) only lists: Tutorials, Quick Tour, Timeline Tour, About. | MEDIUM | SMALL | YES -- verified in `Toolbar.tsx` with `showChangelogOnStartup` state |
| B3 | **LinuxVulkanWarning.tsx undocumented** -- warning banner for Linux users about enabling Vulkan for 60fps. Only in `CLAUDE.md` Common Issues table. | LOW | SMALL | YES -- file confirmed present |
| B4 | **SavedToast.tsx undocumented** -- brief center-screen save notification. | LOW | SMALL | YES -- file confirmed present |
| B5 | **NativeHelperStatus.tsx / NativeHelperDialog undocumented in UI-Panels** -- full dialog with status, enable/disable toggle, install guide per platform, capability pills, GitHub release checking. Toolbar button exists but only Settings > Performance mentions Native Helper. | MEDIUM | SMALL | YES -- confirmed in `NativeHelperStatus.tsx` and `InfoDialog.tsx` |
| B6 | **Marquee selection below tracks undocumented** -- marquee selection now works when clicking below the last track. | LOW | SMALL | YES -- confirmed in `useMarqueeSelection.ts` and `Timeline.tsx` |
| B7 | **Slot Grid toggle button in timeline toolbar undocumented** -- dedicated button in `TimelineControls.tsx` to toggle slot grid view, separate from `Ctrl+Shift+Scroll` shortcut. | LOW | SMALL | YES -- verified in `TimelineControls.tsx` lines 104-108 |
| B8 | **Playback Debug Stats in StatsOverlay undocumented** -- enhanced stats overlay with playback debug information (March commit). | LOW | SMALL | YES -- plausible per commit history, not independently re-verified |

## Conflicts Resolved

### Conflict 1: AIActionOverlay types -- count and composition

**Reviewer A** states there are 6 overlay types including a "moving clip animations" type mentioned in docs but not in the component.
**Reviewer B** does not specifically mention AIActionOverlay types.

**Resolution (verified against code):** The `AIActionOverlayType` union in `src/stores/timeline/types.ts` line 45 defines exactly **5 types**: `split-glow`, `delete-ghost`, `trim-highlight`, `silent-zone`, `low-quality-zone`. Reviewer A's finding is correct that `silent-zone` and `low-quality-zone` are undocumented. The docs mention "moving clip animations" which is not a distinct overlay type in the AIActionOverlays component -- it appears to be a separate mechanism. **Reviewer A is correct**: docs list 4 types (with one fictional), code has 5 types, and 2 are undocumented.

### Conflict 2: Panel count accuracy

**Reviewer A** does not comment on panel count accuracy.
**Reviewer B** explicitly verifies that the documented "17 dockable panel types" matches the `PanelType` union and marks this as **accurate**. Notes that `youtube` and `download` both map to the same `DownloadPanel` component.

**Resolution (verified against code):** `PanelType` in `src/types/dock.ts` line 11 lists exactly 17 types: `preview`, `multi-preview`, `timeline`, `clip-properties`, `media`, `export`, `multicam`, `ai-chat`, `ai-video`, `ai-segment`, `scene-description`, `youtube`, `download`, `transitions`, `scope-waveform`, `scope-histogram`, `scope-vectorscope`. **Reviewer B is correct**: the count is accurate.

---

## Prioritized Action Items

### CRITICAL (must fix)

1. **Create Mobile UI documentation** -- new section in `UI-Panels.md` or new `docs/Features/Mobile.md` covering: `MobileApp.tsx` root component, all 7 sub-components, touch gestures (edge swipes, two-finger undo/redo), precision mode, feature limitations vs desktop. *Effort: LARGE*

2. **Rewrite Tutorial System section** in `UI-Panels.md` lines 410-494 -- replace 2-part tutorial description with 14-campaign system documentation. Cover: `TutorialCampaignDialog.tsx` campaign selection UI, 4 categories (Basics/Editing/Creative/Output), completion tracking via `completedTutorials` in settings, per-campaign progress. Note that original Part 1/2 still exist as `interface-overview` and `timeline-controls` campaigns. *Effort: MEDIUM*

### HIGH (should fix soon)

3. **Document Stacked Alpha export** in `UI-Panels.md` Export Panel section (lines 169-181) -- add description of the "Stacked Alpha (transparent video)" checkbox, how it doubles output height with RGB on top and alpha grayscale on bottom, and its use with tools like TouchDesigner. *Effort: SMALL*

4. **Document per-layer preview sources** in `Preview.md` -- expand the composition selector docs to describe `layer-index` source type that allows isolating individual video tracks from a composition in any preview tab. *Effort: SMALL*

5. **Update AI Chat Panel tool count** in `UI-Panels.md` line 192 -- change "33 available tools" to "76 available tools" (or the current correct count). The tool set has grown substantially across 15 definition files. *Effort: SMALL*

6. **Document `silent-zone` and `low-quality-zone` AI overlay types** in `Timeline.md` AI Action Feedback section (lines 516-526). Also correct the "moving clip animations" reference if it does not correspond to an actual overlay type. *Effort: SMALL*

### MEDIUM (should fix)

7. **Fix Preview.md loop shortcut** -- change line 104 from `L` / "Toggle loop mode" to `Shift + L` / "Toggle loop playback" to match code and `Keyboard-Shortcuts.md`. *Effort: SMALL*

8. **Add "Changelog on Startup" to Info menu table** in `UI-Panels.md` lines 55-59 -- add the toggle item between "Timeline Tour" and "About". *Effort: SMALL*

9. **Document WhatsNewDialog** -- add section to `UI-Panels.md` covering: filter tabs, release calendar heatmap, YouTube video embed, "Don't show on startup" toggle, commit links. *Effort: MEDIUM*

10. **Document NativeHelperDialog** in `UI-Panels.md` -- describe the toolbar button and full status dialog (enable/disable toggle, install guide per platform, capability pills, GitHub release checking). *Effort: SMALL*

11. **Expand Output Manager component docs** in `Preview.md` -- add descriptions for `OutputManagerBoot.ts` (popup window management, reconnection), `SliceInputOverlay`, `SliceOutputOverlay`, `SliceList`, `SourceSelector`, `TabBar`, `TargetList`, `TargetPreview`. *Effort: MEDIUM*

12. **Document Media Panel breadcrumb navigation** in `UI-Panels.md` -- expand the existing "List view and Grid view toggle" mention to describe: thumbnail grid view, folder breadcrumb navigation, single toggle button with icon swap. *Effort: SMALL*

13. **Document shared UI component library** (`src/components/panels/properties/shared.tsx`) -- `DraggableNumber`, `PrecisionSlider`, `ColorPickerRow`, etc. as reusable foundation components. *Effort: MEDIUM*

14. **Document RelinkDialog** in `UI-Panels.md` or `Project-Persistence.md` -- auto-scan, recursive folder scanning, multi-file picker, status tracking. *Effort: SMALL*

### LOW (nice to have)

15. **Document Slot Grid toggle button** in timeline toolbar section of `UI-Panels.md` or `Timeline.md`. *Effort: SMALL*

16. **Document marquee selection below tracks** in `Keyboard-Shortcuts.md` or `Timeline.md`. *Effort: SMALL*

17. **Document ImageCropper** in AI Video panel section of `UI-Panels.md`. *Effort: SMALL*

18. **Document media sub-components** (`CompositionSettingsDialog`, `SolidSettingsDialog`, `LabelColorPicker`) in `UI-Panels.md` Media Panel section. *Effort: SMALL*

19. **Document scope sub-components** (`ScopeModeToolbar`, individual scope components, `useScopeAnalysis`) in `UI-Panels.md` or `Preview.md`. *Effort: SMALL*

20. **Document export sub-components** (`FFmpegExportSection`, `CodecSelector`, `exportHelpers`, `useExportState`) in `UI-Panels.md` Export section. *Effort: SMALL*

21. **Document utility components** (`LinuxVulkanWarning`, `SavedToast`, `IndexedDBErrorDialog`) -- at minimum list in `UI-Panels.md`. *Effort: SMALL*

22. **Document timeline utilities** (`constants.ts`, `types.ts`, `utils/` directory, timeline hooks) in `Timeline.md`. *Effort: SMALL*

23. **Document playback debug stats** additions to StatsOverlay in `Preview.md`. *Effort: SMALL*

24. **Verify Claude model identifier** in `Multicam-AI.md` line 131 -- currently `claude-sonnet-4-20250514` in `src/services/claudeService.ts`. May become stale; consider noting it is version-dependent. *Effort: SMALL*

---

## Statistics

| Category | Count |
|----------|-------|
| Total confirmed findings | 26 |
| CRITICAL | 2 |
| HIGH | 4 |
| MEDIUM | 8 |
| LOW | 12 |
| Conflicts resolved | 2 |
| Items verified against source | 24/26 |
