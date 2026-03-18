# Domain 4: Components & UI - Reviewer A Findings

## Summary
- Files audited: 160 (all .tsx/.ts files under `src/components/`)
- Docs reviewed: 5 (`UI-Panels.md`, `Preview.md`, `Text-Clips.md`, `Keyboard-Shortcuts.md`, `Multicam-AI.md`)
- Critical gaps found: 6
- Inaccuracies found: 8
- Missing features (post-2026-03-08): 5

---

## Gap Analysis

### Undocumented Files

The following source files have **no mention in any of the 5 reviewed docs**:

#### Mobile Components (entirely undocumented across all 5 docs)
- `src/components/mobile/MobileApp.tsx` -- Root mobile UI component with panel state, precision mode, undo/redo
- `src/components/mobile/MobileTimeline.tsx` -- Simplified touch-friendly timeline
- `src/components/mobile/MobilePreview.tsx` -- Simplified preview for mobile
- `src/components/mobile/MobileMediaPanel.tsx` -- Simplified media browser for mobile
- `src/components/mobile/MobilePropertiesPanel.tsx` -- Simplified properties for mobile with active slider mode
- `src/components/mobile/MobileToolbar.tsx` -- Mobile toolbar with hamburger menu
- `src/components/mobile/MobileOptionsMenu.tsx` -- Mobile options drawer
- `src/components/mobile/index.ts` -- Exports all mobile components
- `src/components/mobile/mobile.css` -- Mobile-specific styles

**Impact**: UI-Panels.md mentions "mobile/desktop view toggle" in Settings > General but provides zero documentation for the entire mobile UI subsystem (7 components, 1 stylesheet). There is no dedicated Mobile.md or section in UI-Panels.md.

#### Common Components (undocumented or minimally documented)
- `src/components/common/IndexedDBErrorDialog.tsx` -- Browser storage corruption dialog (only mentioned in `Project-Persistence.md`, not in any reviewed doc)
- `src/components/common/TutorialCampaignDialog.tsx` -- Campaign selection dialog for the expanded tutorial system (14 campaigns, not documented)
- `src/components/common/tutorialCampaigns.ts` -- 14 tutorial campaign definitions across 4 categories (basics, editing, creative, output) -- the docs describe only a 2-part tutorial
- `src/components/common/RelinkDialog.tsx` -- Media relinking dialog (only referenced in `Project-Persistence.md`)

#### OutputManager Sub-Components (partially documented)
The Output Manager is documented in `Preview.md` at the system level, but these individual components are not described:
- `src/components/outputManager/OutputManagerBoot.ts` -- Popup window injection, reconnection, named windows
- `src/components/outputManager/SliceInputOverlay.tsx` -- Input corner dragging overlay
- `src/components/outputManager/SliceOutputOverlay.tsx` -- Output corner dragging overlay
- `src/components/outputManager/SliceList.tsx` -- Slice/mask list sidebar
- `src/components/outputManager/SourceSelector.tsx` -- Source routing dropdown
- `src/components/outputManager/TabBar.tsx` -- Input/Output tab bar
- `src/components/outputManager/TargetList.tsx` -- Target management sidebar
- `src/components/outputManager/TargetPreview.tsx` -- Live preview canvas within Output Manager

#### Export Sub-Components
- `src/components/export/FFmpegExportSection.tsx` -- FFmpeg-specific export settings section (mentioned in passing in UI-Panels.md but no detail)
- `src/components/export/CodecSelector.tsx` -- Codec dropdown component
- `src/components/export/exportHelpers.ts` -- FFmpegFrameRenderer helper class
- `src/components/export/useExportState.ts` -- Export state management hook (new `stackedAlpha` feature undocumented)

#### Panel Sub-Components
- `src/components/panels/media/CompositionSettingsDialog.tsx` -- Composition resolution/FPS settings dialog
- `src/components/panels/media/SolidSettingsDialog.tsx` -- Solid clip color/resolution settings dialog
- `src/components/panels/media/FileTypeIcon.tsx` -- File type icon component
- `src/components/panels/media/LabelColorPicker.tsx` -- Label color picker for media items
- `src/components/panels/media/labelColors.ts` -- Label color definitions
- `src/components/panels/properties/shared.tsx` -- Shared UI components (DraggableNumber, PrecisionSlider, etc.)
- `src/components/panels/ImageCropper.tsx` -- Image cropping tool (not mentioned in any doc)

#### Scope Sub-Components
- `src/components/panels/scopes/ScopeModeToolbar.tsx` -- View mode toolbar (RGB/R/G/B/Luma)
- `src/components/panels/scopes/HistogramScope.tsx` -- Histogram rendering component
- `src/components/panels/scopes/VectorscopeScope.tsx` -- Vectorscope rendering component
- `src/components/panels/scopes/WaveformScope.tsx` -- Waveform rendering component
- `src/components/panels/scopes/useScopeAnalysis.ts` -- Scope data analysis hook

#### Timeline Utility Files
- `src/components/timeline/constants.ts` -- ALL_BLEND_MODES and other constants
- `src/components/timeline/types.ts` -- TypeScript interfaces for timeline interactions (ClipDragState, ExternalDragState, PickWhipDragState, AIActionOverlay, etc.)
- `src/components/timeline/utils/externalDragPlacement.ts` -- Drag placement calculation
- `src/components/timeline/utils/externalDragSession.ts` -- Drag session state management
- `src/components/timeline/utils/fileTypeHelpers.ts` -- File type detection helpers
- `src/components/timeline/slotGridAnimation.ts` -- Slot grid open/close animation logic

#### Timeline Hooks (partially documented in Timeline.md but not in reviewed docs)
- `src/components/timeline/hooks/useAutoFeatures.ts` -- Auto-features (waveform, thumbnail generation)
- `src/components/timeline/hooks/useClipFade.ts` -- Clip opacity fade drag interaction
- `src/components/timeline/hooks/useLayerSync.ts` -- Layer synchronization between store and engine
- `src/components/timeline/hooks/usePlaybackLoop.ts` -- Playback RAF loop
- `src/components/timeline/hooks/usePlayheadSnap.ts` -- Playhead snap-to-keyframe logic
- `src/components/timeline/hooks/useTimelineHelpers.ts` -- Shared timeline utility functions

---

### Inaccurate Documentation

#### 1. Tutorial System Description is Outdated (UI-Panels.md:410-494)
**File**: `docs/Features/UI-Panels.md`, lines 410-494
**Issue**: The documentation describes a 2-part tutorial system (Part 1: Panel Introduction, Part 2: Timeline Deep-Dive) with a Welcome Screen asking about editing background. The actual implementation (`tutorialCampaigns.ts`) has been expanded to a **14-campaign system** organized in 4 categories:
- **Basics** (3): Interface Overview, Timeline Controls, Preview & Playback
- **Editing** (4): Media & Import, Editing Clips, Audio Mixing, Downloads
- **Creative** (4): Keyframes & Animation, Effects & Color, Text & Titles, Masks & Compositing
- **Output** (3): Export & Delivery, Video Scopes, Slot Grid (Live)

The old Part 1/Part 2 campaigns still exist as "Interface Overview" and "Timeline Controls" but are now part of a larger campaign-based system with a `TutorialCampaignDialog.tsx` campaign selection UI, completion tracking via `completedTutorials` in settings store, and per-campaign progress display.

The Welcome Screen with background-selection (Premiere Pro, DaVinci Resolve, etc.) is still present (`WelcomeOverlay.tsx`) but the documentation doesn't reflect that the tutorial system is now campaign-based with 14 tutorials.

#### 2. AI Action Overlays Missing Two Types (docs/Features/Timeline.md:516-526)
**Issue**: Timeline.md lists only 4 overlay types: split glow, delete ghost, trim highlight, and moving clip animations. The actual `AIActionOverlays.tsx` component (line 274-306) implements **6 types**:
- `split-glow` (documented)
- `delete-ghost` (documented)
- `trim-highlight` (documented)
- `silent-zone` (undocumented) -- highlights silent audio regions
- `low-quality-zone` (undocumented) -- highlights low-quality video regions
- Moving clip animations are mentioned in docs but not actually a separate overlay type in the component

#### 3. Keyboard Shortcuts: Loop Toggle Shortcut Inconsistency
**File**: `docs/Features/Keyboard-Shortcuts.md`, line 17: `Shift + L` maps to "Toggle loop playback"
**File**: `docs/Features/Preview.md`, line 104: `L` maps to "Toggle loop mode"
**Issue**: Preview.md incorrectly states `L` toggles loop. The actual code (`useTimelineKeyboard.ts` line 151-158) shows `L` is forward playback and `Shift+L` is toggle loop -- matching Keyboard-Shortcuts.md but contradicting Preview.md.

#### 4. Export Panel Missing Stacked Alpha Feature
**File**: `docs/Features/UI-Panels.md`, lines 169-181
**Issue**: The Export Panel section lists codecs, resolution, audio, FCPXML, etc., but does not mention the **Stacked Alpha** export option. This feature (added March 11-12, commit `625144b7`) allows exporting transparent video by doubling the video height with RGB on top and alpha as grayscale on bottom. Present in both `ExportPanel.tsx` and `ExportDialog.tsx`.

#### 5. Preview Panel Missing Per-Layer Source Selector
**File**: `docs/Features/Preview.md`, lines 37-43 and 255-260
**Issue**: The Preview panel documentation describes the composition selector as choosing "Active" or a specific composition. Since commit `d0d9afed` (March 13), the preview source selector also supports **per-layer sources** via `layer-index` type. The `PreviewControls.tsx` now renders layer options under each composition in the dropdown, allowing individual layer isolation in any preview tab. This is documented for Multi Preview Panel but not for regular Preview panels.

#### 6. Multicam-AI.md Claude Model Reference
**File**: `docs/Features/Multicam-AI.md`, line 131
**Issue**: Documentation states `model: 'claude-sonnet-4-20250514'`. While this may be correct in the source code, it should be verified. The model identifier format suggests a date-based version that could become stale.

#### 7. Preview.md Component Hierarchy Missing PreviewBottomControls Detail
**File**: `docs/Features/Preview.md`, line 60
**Issue**: `PreviewBottomControls` is listed in the component hierarchy but the doc only says "transparency grid toggle, quality selector". The actual `PreviewBottomControls.tsx` component was updated (March 13) alongside the per-layer preview source feature.

#### 8. UI-Panels.md Settings Categories Count
**File**: `docs/Features/UI-Panels.md`, line 612
**Issue**: States "8 categorized settings sections" and lists exactly 8. The count is correct, but the SettingsDialog.tsx is a thin shell that delegates to `settings/` sub-components. The documentation does not mention the `useDraggableDialog.ts` hook or the modular settings architecture.

---

### Missing Features (post-2026-03-08)

These features were added after March 8, 2026 and are not covered in documentation:

#### 1. Stacked Alpha Export (March 11-12)
Commits: `625144b7`, `f2a84a50`
Components: `ExportPanel.tsx`, `ExportDialog.tsx`, `useExportState.ts`
Feature: Checkbox to enable stacked alpha video export -- doubles output height, renders RGB on top half and alpha channel as grayscale on bottom half. Enables transparent video output compatible with tools like TouchDesigner.

#### 2. Per-Layer Preview Tab Sources (March 13)
Commit: `d0d9afed`
Components: `PreviewControls.tsx`, `Preview.tsx`, `PreviewBottomControls.tsx`, `DockPanelContent.tsx`
Feature: Preview panel composition selector now includes per-layer options under "Dynamic" and each composition. Users can set a preview tab to show only a specific video track/layer from a composition.

#### 3. Animated Toolbar/Tabs Slide Transition for Slot Grid (March 10)
Commit: `912f1892`
Components: `DockTabPane.tsx`, `Timeline.tsx`
Feature: Smooth slide animation when transitioning between timeline and slot grid views.

#### 4. Changelog "Don't show on startup" Toggle (March 10)
Commit: `e84784d9`
Components: `WhatsNewDialog.tsx`, `Toolbar.tsx`
Feature: WhatsNewDialog now includes a toggle to suppress automatic display on startup, stored via `showChangelogOnStartup` in settings.

#### 5. Media Panel Grid View with Breadcrumb Navigation (March 9+)
Commits: `51f2a825`, `93e08a62`, `0accccfd`, `7a411ab0`
Component: `MediaPanel.tsx`
Feature: Grid view mode with thumbnail previews, folder breadcrumb navigation, and a single toggle button that swaps between list and grid icons. The docs mention "List view and Grid view toggle" but the breadcrumb navigation and the icon toggle UX are not described.

---

### Stale References

#### 1. Tutorial System Scale
`UI-Panels.md` describes a 2-part tutorial. The actual implementation has **14 tutorial campaigns** across 4 categories. The "Part 1" and "Part 2" terminology is obsolete -- the system now uses campaign IDs like `interface-overview`, `timeline-controls`, `preview-playback`, etc.

#### 2. AI Chat Panel Tool Count
`UI-Panels.md` line 192 states "33 available tools" for the AI Chat Panel. This should be verified against the current `aiTools` service implementation, as AI tool additions (including new silent-zone and low-quality-zone overlay types in AIActionOverlays) may have changed this count.

#### 3. App Version Reference
The current app version is `1.3.5` (from `src/version.ts`). None of the reviewed docs reference a specific version number, which is appropriate.

---

### Documentation Quality Issues

#### 1. Mobile UI Completely Absent
The mobile subsystem (7 components, `MobileApp.tsx` as root) has no dedicated documentation. It provides a touch-friendly interface with swipe panels, precision playhead mode, simplified properties, and an options menu. Given the Settings dialog has a "mobile/desktop view toggle", users can access this mode -- but have no documentation for it.

#### 2. Output Manager Documentation Spread Across Files
The Output Manager is documented in `Preview.md` (under "Output Manager" section), but its 9 component files under `src/components/outputManager/` have no component-level documentation. The `OutputManagerBoot.ts` reconnection logic, popup window management, and style injection are implementation details that could benefit from a dedicated section.

#### 3. ImageCropper Completely Undocumented
`src/components/panels/ImageCropper.tsx` (10,980 bytes) is a substantial component with no mention in any documentation file.

#### 4. Shared UI Component Library Undocumented
`src/components/panels/properties/shared.tsx` (18,014 bytes) contains reusable UI components (DraggableNumber, PrecisionSlider, ColorPickerRow, etc.) used across all property tabs. These are not documented anywhere, making it hard for developers to discover and reuse them.

#### 5. CSS Files Not Tracked
Multiple substantial CSS files exist with no documentation coverage:
- `src/components/panels/AIChatPanel.css` (9,197 bytes)
- `src/components/panels/AIVideoPanel.css` (20,704 bytes)
- `src/components/panels/AnalysisPanel.css` (8,387 bytes)
- `src/components/panels/DownloadPanel.css` (15,322 bytes)
- `src/components/panels/MultiCamPanel.css` (12,197 bytes)
- `src/components/panels/TransitionsPanel.css` (2,408 bytes)
- `src/components/panels/TranscriptPanel.css` (8,852 bytes)
- `src/components/panels/scopes/ScopesPanel.css` (3,537 bytes)
- `src/components/preview/MultiPreview.css` (3,572 bytes)
- `src/components/dock/dock.css` (10,320 bytes)
- `src/components/common/settings/SettingsDialog.css` (10,924 bytes)
- `src/components/mobile/mobile.css` (12,028 bytes)

---

## Recommended Changes

### Priority 1 (Critical)
1. **Update Tutorial System documentation** in `UI-Panels.md` -- Replace the 2-part description with the 14-campaign system, including `TutorialCampaignDialog`, categories, completion tracking, and the campaign selection UI.
2. **Document Stacked Alpha export** in `UI-Panels.md` (Export Panel section) and create/update `docs/Features/Export.md` if it exists.
3. **Document per-layer preview sources** in `Preview.md` -- Expand the Preview Panel section to note that individual video tracks can be isolated via the composition selector dropdown.

### Priority 2 (High)
4. **Create Mobile UI documentation** -- Either a new `docs/Features/Mobile.md` or a substantial section in `UI-Panels.md`. Cover MobileApp, MobileTimeline, MobilePreview, MobilePropertiesPanel, MobileMediaPanel, MobileToolbar, MobileOptionsMenu, precision mode, and touch interactions.
5. **Document AIActionOverlays `silent-zone` and `low-quality-zone` types** in Timeline.md AI Action Feedback section.
6. **Fix Preview.md loop shortcut** -- Change line 104 from `L` to `Shift + L` for loop toggle.
7. **Document `showChangelogOnStartup` toggle** in UI-Panels.md or relevant settings documentation.

### Priority 3 (Medium)
8. **Document ImageCropper** -- Add to UI-Panels.md or Media Panel documentation.
9. **Document shared UI components** (`properties/shared.tsx`) -- DraggableNumber, PrecisionSlider, etc., as they are the foundation of all property editing.
10. **Expand Output Manager component documentation** -- Add descriptions for the 9 sub-components in `Preview.md` or a new dedicated doc.
11. **Document Media Panel grid view breadcrumb navigation** -- The existing grid/list mention in UI-Panels.md should be expanded.
12. **Verify AI Chat Panel tool count** -- Confirm whether "33 available tools" is still accurate.

### Priority 4 (Low)
13. **Document CSS architecture** -- At minimum note the existence and purpose of major CSS files per panel.
14. **Document timeline utility types and constants** -- `types.ts`, `constants.ts`, and `utils/` directory.
15. **Add IndexedDBErrorDialog to UI-Panels.md** -- As it is a user-facing error dialog.
