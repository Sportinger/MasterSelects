# Domain 4: Components & UI - Reviewer B Findings

## Summary
- Files audited: 160 (all .tsx/.ts files under `src/components/`)
- Docs reviewed: 5 (`UI-Panels.md`, `Preview.md`, `Text-Clips.md`, `Keyboard-Shortcuts.md`, `Multicam-AI.md`)
- Critical gaps found: 6
- Inaccuracies found: 4
- Missing features: 8

## Gap Analysis

### Undocumented Files

#### 1. Mobile UI (`src/components/mobile/`) -- NOT DOCUMENTED
**Severity: CRITICAL**

Seven component files exist with zero dedicated documentation:
- `MobileApp.tsx` -- root mobile layout with warning overlay, two-finger undo/redo gestures
- `MobilePreview.tsx` -- mobile-optimized preview
- `MobileTimeline.tsx` -- simplified timeline
- `MobileToolbar.tsx` -- cut + precision mode toolbar
- `MobilePropertiesPanel.tsx` -- pull-down properties
- `MobileMediaPanel.tsx` -- swipe-from-left media panel
- `MobileOptionsMenu.tsx` -- swipe-from-right options menu

The only mention of mobile in docs is a single row in `README.md` ("Custom dockable panel system with mobile support") and a "mobile/desktop view toggle" note under Settings > General in `UI-Panels.md`. The actual mobile UI architecture, touch gestures, feature limitations, and component hierarchy are entirely undocumented.

#### 2. `WhatsNewDialog.tsx` -- NOT DOCUMENTED
**Severity: MEDIUM**

The changelog dialog has substantial features that are not documented anywhere:
- Grouped changelog by time periods
- Filter tabs (All / New / Fixes / Improved / Refactor)
- Release calendar heatmap visualization
- Featured YouTube video embed
- Build/WIP notice cards with animated styles
- "Don't show on startup" checkbox
- Commit links to GitHub

Only a brief mention in `FEATURES.md` ("What's New Dialog: Zeitgruppierter Changelog") exists. No entry in `UI-Panels.md`.

#### 3. `RelinkDialog.tsx` -- NOT DOCUMENTED
**Severity: MEDIUM**

Media relinking dialog with:
- Auto-scan of project Raw folder for missing files
- Recursive folder scanning
- Multi-file picker for bulk relinking
- Status tracking (missing/found/searching)
- Apply/cancel workflow

Not documented in `UI-Panels.md` or any feature doc. Only a passing reference to IndexedDBErrorDialog in `Project-Persistence.md`.

#### 4. `IndexedDBErrorDialog.tsx` -- MINIMALLY DOCUMENTED
**Severity: LOW**

Referenced in `Project-Persistence.md` source list only. No description of its UI or user-facing behavior.

#### 5. `LinuxVulkanWarning.tsx` -- NOT DOCUMENTED
**Severity: LOW**

Warning banner for Linux users about enabling Vulkan for 60fps performance. Not mentioned in any docs beyond the "Common Issues" table in `CLAUDE.md`.

#### 6. `SavedToast.tsx` -- NOT DOCUMENTED
**Severity: LOW**

Brief center-screen save notification. Not documented.

#### 7. `InfoDialog.tsx` -- PARTIALLY DOCUMENTED
**Severity: LOW**

The About dialog is mentioned in `UI-Panels.md` Info menu as "Shows version and app info dialog" but the actual UI contents (feature list, GitHub link, Native Helper status launch button) are undocumented.

#### 8. `NativeHelperStatus.tsx` / `NativeHelperDialog` -- NOT DOCUMENTED IN UI-PANELS
**Severity: MEDIUM**

A full dialog component (status page, enable/disable toggle, install guide per platform, capability pills, GitHub release checking, download links) exists as a toolbar button. The Settings > Performance section mentions "Native Helper enable/disable" but the dedicated dialog accessible from the toolbar is not documented.

#### 9. `TutorialCampaignDialog.tsx` + `tutorialCampaigns.ts` -- PARTIALLY DOCUMENTED
**Severity: MEDIUM**

The docs describe Parts 1 and 2 of the tutorial system. However, the tutorial has been expanded to a full campaign system with 14 campaigns across 4 categories:
- **Basics** (3): Interface Overview, Timeline Controls, Preview & Playback
- **Editing** (4): Media & Import, Editing Clips, Audio Mixing, Downloads
- **Creative** (4): Keyframes & Animation, Effects & Color, Text & Titles, Masks & Compositing
- **Output** (3): Export & Delivery, Video Scopes, Slot Grid (Live)

`UI-Panels.md` only describes the original 2-part tutorial (Parts 1 and 2), not the 14-campaign system. The `TutorialCampaignDialog` with category grouping and completion tracking is undocumented.

#### 10. Media Sub-Components -- NOT DOCUMENTED
**Severity: LOW**

These media panel helper components are not mentioned in docs:
- `CompositionSettingsDialog.tsx` -- dialog for editing composition settings
- `SolidSettingsDialog.tsx` -- dialog for configuring solid clips
- `LabelColorPicker.tsx` -- color label assignment for media items
- `FileTypeIcon.tsx` -- file type icon renderer
- `labelColors.ts` -- color definitions

#### 11. `ImageCropper.tsx` -- NOT DOCUMENTED
**Severity: LOW**

Pan/zoom image cropper used in AI Video panel for frame input. Not mentioned in any docs.

#### 12. `AnalysisPanel.tsx` and `ClipPropertiesPanel.tsx` -- STANDALONE FILES NOT MAPPED
**Severity: LOW**

`AnalysisPanel.tsx` exists as a standalone component (separate from the Analysis tab inside Properties), yet is not referenced in docs as a separate file. `ClipPropertiesPanel.tsx` contains the `PrecisionSlider` implementation and legacy clip properties, but the source listing in `UI-Panels.md` only references `PropertiesPanel.tsx`.

### Inaccurate Documentation

#### 1. Info Menu: "Changelog on Startup" toggle is undocumented
**Severity: MEDIUM**

The Toolbar code (`Toolbar.tsx` line 766-771) shows an Info menu item "Changelog on Startup" with a checkmark toggle, but `UI-Panels.md` does not list this menu item. The Info menu table only lists: Tutorials, Quick Tour, Timeline Tour, About.

**Actual Info menu items:**
| Item | Description |
|------|-------------|
| Tutorials | Opens campaign selection dialog |
| Quick Tour | Start Part 1 |
| Timeline Tour | Start Part 2 |
| Changelog on Startup | Toggle + opens changelog |
| About | Shows info dialog |

#### 2. Keyboard Shortcuts doc says `L` toggles loop -- code says `Shift+L`
**Severity: LOW**

`Keyboard-Shortcuts.md` Playback section correctly lists `Shift + L` for loop toggle. However, `Preview.md` line 104 lists the shortcut as just `L` for "Toggle loop mode". The code in `useTimelineKeyboard.ts` line 151-159 confirms `Shift+L` is the correct binding. `L` alone triggers forward playback.

#### 3. Panel count stated as 17 but actual code has 17 PanelType values
**Severity: NONE (accurate)**

`UI-Panels.md` line 104 states "17 dockable panel types." The `PanelType` union in `dock.ts` has: preview, multi-preview, timeline, clip-properties, media, export, multicam, ai-chat, ai-video, ai-segment, scene-description, youtube, download, transitions, scope-waveform, scope-histogram, scope-vectorscope = 17 types. This is accurate, though `youtube` and `download` both map to the same `DownloadPanel` component.

#### 4. Export Panel: "Stacked Alpha" feature added but not documented
**Severity: MEDIUM**

Commit `625144b7` (2026-03-10) added a "stacked alpha" export option to ExportPanel. This allows transparent video output by stacking the alpha channel below the color video. The feature is present in both `ExportPanel.tsx` and `ExportDialog.tsx` but is not documented in `UI-Panels.md` or any export documentation.

### Missing Features (post-2026-03-08)

Based on `git log --oneline --since="2026-03-08" -- src/components/`:

#### 1. Per-Layer Preview Tab Sources (commit `d0d9afed`)
The Preview panel's composition selector now supports per-layer source selection (choosing a specific layer index from a composition). `PreviewControls.tsx` renders layer options using `getCompositionVideoTracks()`. Not documented in `Preview.md`.

#### 2. Stacked Alpha Export Option (commit `625144b7`)
New checkbox in ExportPanel for transparent video export. Not documented.

#### 3. Slot Grid Toggle Button in Timeline (commit `475c0139`)
A dedicated button was added to the timeline toolbar to toggle the slot grid view, alongside the existing `Ctrl+Shift+Scroll` shortcut. Not documented in `UI-Panels.md` or `Keyboard-Shortcuts.md`.

#### 4. Animated Toolbar & Tabs Slide Transition for Slot Grid (commit `912f1892`)
The timeline toolbar and composition tabs now animate with a slide transition when toggling the slot grid. Not documented.

#### 5. Media Panel View Toggle Refinements (commits `93e08a62`, `0accccfd`, `7a411ab0`, `3a566830`)
The media panel's list/grid view toggle was refined multiple times: combined into a single toggle button, icon swap logic changed to show the target view instead of current. `UI-Panels.md` mentions "List view and Grid view toggle" but not the single-toggle-button UX.

#### 6. Changelog Dialog YouTube Video Embed (commit `2bb3f1e1`)
The WhatsNewDialog now supports embedded YouTube video thumbnails with click-to-open. Not documented.

#### 7. Playback Debug Stats in StatsOverlay (commit `95304a59`)
Enhanced stats overlay with playback debug information, video sync improvements, and AI tools stats. Some of this is documented in `Preview.md` Statistics Overlay section, but the specific new playback debug stats may not be fully reflected.

#### 8. Marquee Selection Below Tracks (commit `dae61e64`)
Marquee selection now works when clicking below the last track. Not documented in `Keyboard-Shortcuts.md`.

### Stale References

#### 1. `Preview.md` Playback Controls lists `L` for "Toggle loop mode"
Should be `Shift + L` based on code and `Keyboard-Shortcuts.md`. The bare `L` key triggers forward playback.

#### 2. Tutorial system docs describe 2-part tutorial only
The codebase has evolved to a 14-campaign system with categories. The 2-part description is not wrong (those campaigns still exist as `interface-overview` and `timeline-controls`) but the overall tutorial system is significantly more extensive now.

### Documentation Quality Issues

#### 1. No dedicated Mobile documentation
Given that 7 component files implement a mobile UI with distinct interaction patterns (edge swipes, two-finger undo/redo, precision mode, pull-down panels), a dedicated mobile section or document is warranted.

#### 2. Output Manager documented in `Preview.md` but has its own component directory
The Output Manager (`src/components/outputManager/`) has 9 component files and is a substantial feature. It is documented within `Preview.md` which is reasonable but could benefit from its own feature doc for discoverability.

#### 3. Settings categories table missing "Changelog on Startup" toggle
The `UI-Panels.md` Settings Dialog section lists 8 settings categories. The Info menu's "Changelog on Startup" toggle is a setting that persists via `settingsStore` but is not listed in the Settings Dialog section (it lives in the Info menu instead).

#### 4. Common components not consolidated
`src/components/common/` contains 14 files (12 components + 1 index + 8 settings sub-components). The docs reference some individually (`Toolbar.tsx`, `SettingsDialog.tsx`, `TutorialOverlay.tsx`) but there is no consolidated list of all common components and their purposes.

#### 5. Export component directory has 6 files, docs cover only surface
`src/components/export/` contains: `ExportPanel.tsx`, `ExportDialog.tsx`, `CodecSelector.tsx`, `FFmpegExportSection.tsx`, `exportHelpers.ts`, `useExportState.ts`, `index.ts`. The docs describe export features at a high level but do not map to individual component files or document the state management hook (`useExportState`).

## Recommended Changes

### Priority 1 (Critical)
1. **Create mobile UI documentation** -- either a new `docs/Features/Mobile.md` or a dedicated section in `UI-Panels.md` covering: component hierarchy, feature limitations, touch gestures, edge swipe navigation, two-finger undo/redo, precision mode.
2. **Update tutorial system documentation** -- replace the 2-part tutorial description with documentation of the 14-campaign system, including categories, completion tracking, and the campaign selection dialog.
3. **Document the WhatsNewDialog/Changelog** -- add a section to `UI-Panels.md` covering the changelog dialog features (filter tabs, calendar, video embed, don't-show toggle).

### Priority 2 (High)
4. **Update Info menu documentation** -- add "Changelog on Startup" toggle to the Info menu table in `UI-Panels.md`.
5. **Fix `Preview.md` loop shortcut** -- change line 104 from `L` / "Toggle loop mode" to `Shift + L` / "Toggle loop playback".
6. **Document stacked alpha export** -- add to Export panel documentation.
7. **Document per-layer preview sources** -- add to Preview panel/controls documentation.
8. **Document RelinkDialog** -- add section to `UI-Panels.md` or `Project-Persistence.md`.
9. **Document NativeHelperDialog** -- describe the toolbar button and full status dialog in `UI-Panels.md`.

### Priority 3 (Medium)
10. **Document Slot Grid toggle button** in timeline toolbar section.
11. **Add source file mappings** for `common/` components as a consolidated list.
12. **Document media sub-components** (CompositionSettingsDialog, SolidSettingsDialog, LabelColorPicker).
13. **Document ImageCropper** in AI Video panel section.

### Priority 4 (Low)
14. **Document IndexedDBErrorDialog, LinuxVulkanWarning, SavedToast** -- minor utility components but should at least be listed.
15. **Expand export component docs** to reference individual files and the useExportState hook.
