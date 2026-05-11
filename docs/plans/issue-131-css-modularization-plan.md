# Issue 131 CSS Modularization Plan

## Goal

Split the monolithic `src/App.css` into owner-focused CSS files that live with the relevant view, panel, or component area.

The target result is not a temporary import-only split. The target result is the long-term structure:

- Global CSS only contains tokens, themes, base document styles, app shell layout, and genuinely shared primitives.
- Feature and view CSS lives next to the owning React code.
- Class names that are part of runtime contracts remain stable.
- CSS cascade order is made explicit with cascade layers.
- The final Vite build still emits merged CSS assets.

Current baseline:

- `src/App.css`: about `17,094` lines.
- Many panels already have dedicated CSS files.
- The large remaining areas are timeline, media panel, properties panel, preview, common dialogs, and app shell styles.

## Non-Goals

- Do not convert the whole app to CSS Modules.
- Do not rename behavioral selectors during this refactor.
- Do not redesign UI, spacing, colors, or interaction states.
- Do not combine unrelated visual cleanup with the split.
- Do not remove existing test, tutorial, AI, or debug selector contracts.

## CSS Modules Decision

CSS Modules are not the best primary solution for this issue.

Reason:

- Many class names are used as structural contracts by timeline hit testing, DOM queries, tutorial selectors, debug tools, tests, and AI tooling.
- A full CSS Modules migration would require broad `:global(...)` usage or parallel data attributes, increasing churn without solving the immediate monolith problem cleanly.
- Plain CSS with clear ownership, namespaces, and cascade layers fits the current editor architecture better.

Allowed use:

- New isolated leaf components may use CSS Modules later.
- Existing large editor surfaces should remain plain CSS for this refactor.

## Target Structure

Expected global files:

```text
src/styles/tokens.css
src/styles/base.css
src/styles/app-shell.css
src/styles/shared-controls.css
```

Expected colocated component and feature files:

```text
src/components/common/Toolbar.css
src/components/common/WelcomeOverlay.css
src/components/common/WhatsNewDialog.css
src/components/common/SplashScreen.css
src/components/common/InfoDialog.css
src/components/common/RelinkDialog.css
src/components/common/TutorialOverlay.css
src/components/common/TutorialCampaignDialog.css
src/components/common/NativeHelperStatus.css
src/components/common/IndexedDBErrorDialog.css
src/components/common/LinuxVulkanWarning.css

src/components/export/ExportPanel.css

src/components/panels/MediaPanel.css
src/components/panels/properties/ClipPropertiesPanel.css
src/components/panels/properties/PropertiesPanel.css
src/components/panels/properties/TextTab.css
src/components/panels/properties/AnalysisTranscriptTabs.css
src/components/panels/properties/VolumeBlendshapeTabs.css
src/components/panels/properties/EffectsTab.css

src/components/preview/Preview.css
src/components/preview/PreviewEditMode.css
src/components/preview/SourceMonitor.css
src/components/preview/MaskOverlay.css

src/components/timeline/Timeline.css
src/components/timeline/TimelineControls.css
src/components/timeline/TimelineTracks.css
src/components/timeline/TimelineClip.css
src/components/timeline/TimelineInteractions.css
src/components/timeline/TimelineNavigator.css
src/components/timeline/TimelineMarkers.css
src/components/timeline/TimelineKeyframes.css
src/components/timeline/SlotGrid.css
src/components/timeline/MulticamDialog.css
```

`src/App.css` should either be removed or reduced to a tiny compatibility file if a temporary import path cannot be removed safely. The preferred final state is no meaningful CSS content in `src/App.css`.

## Cascade Layers

Use cascade layers to make order explicit:

```css
@layer tokens, base, shell, shared, components, features, overlays;
```

Layer ownership:

- `tokens`: CSS variables and theme tokens.
- `base`: reset, `html`, `body`, `#root`, text selection, focus defaults.
- `shell`: `.app`, main layout, workspace columns, high-level containers.
- `shared`: generic reusable editor controls such as sliders, draggable numbers, keyframe toggles, common context menu primitives.
- `components`: component-owned UI that is not a major editor view.
- `features`: large editor surfaces such as timeline, media panel, properties panel, preview, export.
- `overlays`: dialogs, tutorial overlays, welcome flow, changelog, warning banners.

Rules:

- Every moved block should be wrapped in the correct `@layer`.
- Do not rely on incidental import order where layer order is enough.
- When two selectors intentionally override each other in the same layer, preserve their relative order inside the same file or document the dependency.

## Stable Selector Contracts

Do not rename or module-scope these selectors without a separate migration:

- `.timeline-*`
- `.media-*`
- `.clip-*`
- `.keyframe-*`
- `.source-monitor-*`
- `.preview-*`
- `.welcome-overlay*`
- `.changelog-*`
- `.tutorial-*`
- `.slot-grid-*`
- `.timeline-context-menu`
- Selectors referenced by `data-ai-id`, tutorial definitions, drag/drop logic, or `closest(...)` calls.

If a selector is used by JS behavior, prefer adding a future `data-*` contract in a later task before renaming the class.

## Estimated File Sizes

The split should keep most files below 1,000 lines. Larger files are acceptable when they represent one dense feature surface.

| File | Target LOC |
|---|---:|
| `src/styles/tokens.css` | 600-700 |
| `src/styles/base.css` | 80-120 |
| `src/styles/app-shell.css` | 500-700 |
| `src/styles/shared-controls.css` | 300-500 |
| `src/components/common/Toolbar.css` | 500-700 |
| `src/components/export/ExportPanel.css` | 1,100-1,200 |
| `src/components/panels/MediaPanel.css` | 1,400-1,500 |
| `src/components/panels/properties/ClipPropertiesPanel.css` | 400-500 |
| `src/components/panels/properties/PropertiesPanel.css` | 600-800 |
| `src/components/panels/properties/TextTab.css` | 300-400 |
| `src/components/panels/properties/AnalysisTranscriptTabs.css` | 300-450 |
| `src/components/panels/properties/VolumeBlendshapeTabs.css` | 250-400 |
| `src/components/panels/properties/EffectsTab.css` | 300-450 |
| `src/components/timeline/Timeline.css` | 500-700 |
| `src/components/timeline/TimelineControls.css` | 250-400 |
| `src/components/timeline/TimelineTracks.css` | 400-600 |
| `src/components/timeline/TimelineClip.css` | 800-1,000 |
| `src/components/timeline/TimelineInteractions.css` | 600-800 |
| `src/components/timeline/TimelineNavigator.css` | 300-450 |
| `src/components/timeline/TimelineMarkers.css` | 250-400 |
| `src/components/timeline/TimelineKeyframes.css` | 600-800 |
| `src/components/timeline/SlotGrid.css` | 250-350 |
| `src/components/preview/Preview.css` | 350-500 |
| `src/components/preview/PreviewEditMode.css` | 700-900 |
| `src/components/preview/SourceMonitor.css` | 150-250 |
| `src/components/common/WelcomeOverlay.css` | 400-500 |
| `src/components/common/NativeHelperStatus.css` | 600-750 |
| `src/components/common/WhatsNewDialog.css` | 1,100-1,300 |
| `src/components/common/SplashScreen.css` | 150-220 |
| `src/components/common/InfoDialog.css` | 150-220 |
| `src/components/common/RelinkDialog.css` | 150-220 |
| `src/components/common/TutorialOverlay.css` | 300-400 |
| `src/components/common/TutorialCampaignDialog.css` | 150-220 |
| `src/components/common/IndexedDBErrorDialog.css` | 120-170 |
| `src/components/common/LinuxVulkanWarning.css` | 50-90 |
| `src/components/timeline/MulticamDialog.css` | 300-350 |
| `src/components/preview/MaskOverlay.css` | 400-500 |

## Branch and Merge Flow

1. Start from `staging`.
2. Create a feature branch:

```bash
git checkout staging
git pull --ff-only
git checkout -b refactor/issue-131-css-modularization
```

3. Do all refactor work on the feature branch.
4. Run verification.
5. Commit only if build, lint, and tests pass.
6. Merge back to `staging` after review.
7. Delete the feature branch after merge.

Do not merge to `master` as part of this issue unless explicitly requested.

## Parallel Agent Strategy

The key to parallel work is avoiding multiple agents editing the same files at the same time.

Use one coordinator and several focused workers.

### Coordinator

Owns:

- `src/App.css`
- `src/App.tsx`
- `src/main.tsx`
- `src/styles/*`
- final integration
- final verification

Responsibilities:

1. Create the extraction manifest.
2. Add cascade layer order in the global entry.
3. Create global CSS files.
4. Remove extracted blocks from `src/App.css` after worker changes are ready.
5. Resolve import order and build issues.
6. Run final verification.

The coordinator should be the only agent that removes large blocks from `src/App.css`.

### Worker A: Timeline Core

Owns:

- `src/components/timeline/Timeline.css`
- `src/components/timeline/TimelineControls.css`
- `src/components/timeline/TimelineTracks.css`
- `src/components/timeline/TimelineNavigator.css`
- imports in timeline files only

Source ranges:

- Timeline container, controls, ruler, track headers, lanes, navigator, scrollbars.
- Approximate source area: `src/App.css` lines `5889-6521`, `8260-9049`.

Do not edit:

- Timeline clip internals.
- Timeline keyframes.
- Slot grid.
- Global shared controls.

### Worker B: Timeline Clips and Interactions

Owns:

- `src/components/timeline/TimelineClip.css`
- `src/components/timeline/TimelineInteractions.css`
- `src/components/timeline/TimelineMarkers.css`
- imports in timeline files only

Source ranges:

- Timeline clips, clip states, drag previews, trim handles, fade handles, markers, playhead overlays, AI flash overlays, drop zones.
- Approximate source area: `src/App.css` lines `6522-8260`, `8475-8813`, `8938-9049`.

Do not edit:

- Timeline keyframe expansion and curve editor.
- Slot grid.

### Worker C: Timeline Keyframes and Slot Grid

Owns:

- `src/components/timeline/TimelineKeyframes.css`
- `src/components/timeline/SlotGrid.css`
- `src/components/timeline/MulticamDialog.css`
- imports in timeline files only

Source ranges:

- Keyframe diamonds, keyframe context menu, expandable clip properties inside timeline, track-level keyframe expansion, curve editor, slot grid, multicam dialog.
- Approximate source area: `src/App.css` lines `10702-11480`, `13075-13384`, `16648-17094`.

Do not edit:

- Properties panel tabs.
- Shared draggable number and precision slider primitives unless instructed by coordinator.

### Worker D: Media Panel

Owns:

- `src/components/panels/MediaPanel.css`
- import in `src/components/panels/MediaPanel.tsx`

Source ranges:

- Media panel list, table, grid, board, badges, label picker, add dropdown, media context menu.
- Approximate source area: `src/App.css` lines `9059-10523`.

Do not edit:

- Shared context menu primitives if used outside media panel.
- Timeline clip badges unless the selector is media-panel specific.

### Worker E: Properties Panel

Owns:

- `src/components/panels/properties/ClipPropertiesPanel.css`
- `src/components/panels/properties/PropertiesPanel.css`
- `src/components/panels/properties/TextTab.css`
- `src/components/panels/properties/AnalysisTranscriptTabs.css`
- `src/components/panels/properties/VolumeBlendshapeTabs.css`
- `src/components/panels/properties/EffectsTab.css`
- imports in `ClipPropertiesPanel.tsx`, `PropertiesPanel.tsx`, and property tab components only

Source ranges:

- Clip properties, unified properties panel, embedded transcript and analysis tabs, text tab, volume tab, blendshapes, effects sections, MIDI rows in properties context.
- Approximate source area: `src/App.css` lines `3562-5738`.

Do not edit:

- Shared precision slider, draggable number, keyframe toggle, or global control primitives unless assigned by coordinator.

### Worker F: Preview and Source Monitor

Owns:

- `src/components/preview/Preview.css`
- `src/components/preview/PreviewEditMode.css`
- `src/components/preview/SourceMonitor.css`
- `src/components/preview/MaskOverlay.css`
- imports in preview files only

Source ranges:

- Preview containers, floating preview, checkerboard canvas, preview edit mode, preview composition selector, bottom controls, source monitor, mask overlay.
- Approximate source area: `src/App.css` lines `1592-1832`, `11480-13075`.

Do not edit:

- App shell column layout outside preview.
- Export panel styles.

### Worker G: Common Dialogs and Overlays

Owns:

- `src/components/common/WelcomeOverlay.css`
- `src/components/common/WhatsNewDialog.css`
- `src/components/common/SplashScreen.css`
- `src/components/common/InfoDialog.css`
- `src/components/common/RelinkDialog.css`
- `src/components/common/TutorialOverlay.css`
- `src/components/common/TutorialCampaignDialog.css`
- `src/components/common/NativeHelperStatus.css`
- `src/components/common/IndexedDBErrorDialog.css`
- `src/components/common/LinuxVulkanWarning.css`
- imports in common dialog files only

Source ranges:

- Welcome overlay, native helper, browser warnings, info dialog, relink dialog, changelog, splash screen, indexeddb error, linux warning, tutorial overlays.
- Approximate source area: `src/App.css` lines `13384-16648`.

Do not edit:

- Auth and billing dialogs already covered by `authBillingDialogs.css`, except where shared overlay classes require coordination.

### Worker H: Export, Toolbar, Shell, Shared Controls

Owns:

- `src/components/export/ExportPanel.css`
- `src/components/common/Toolbar.css`
- `src/styles/app-shell.css`
- `src/styles/shared-controls.css`
- imports in export and toolbar files only

Source ranges:

- Toolbar, menu bar, project section, app shell, slots panel, old effects panel styles, export panel, precision slider, draggable number, keyframe toggle, common context menu primitives.
- Approximate source area: `src/App.css` lines `763-3562`, `10523-10791`, `12485-12618`.

Do not edit:

- Timeline-specific keyframe rules after `10791`.
- Preview-specific context menus if already assigned to Worker F.

## Worker Instructions

Each worker should:

1. Read the owning component files before moving CSS.
2. Move full selector blocks only.
3. Preserve selector text exactly unless the coordinator approved a rename.
4. Wrap moved CSS in the assigned `@layer`.
5. Add the CSS import to the owning component or folder entrypoint.
6. Avoid editing `src/App.css` directly unless assigned as coordinator.
7. Record any ambiguous selectors in a short handoff note.

Preferred import pattern:

```ts
import './Timeline.css';
```

Avoid importing a large feature stylesheet from unrelated parents.

## Extraction Manifest

Before parallel work starts, the coordinator should create a manifest like this:

```text
source: src/App.css
block: lines 5919-6100
target: src/components/timeline/Timeline.css
layer: features
owner: Worker A
notes: timeline root, empty state, high-level body
```

The manifest can live in the PR description or in a temporary local note. If committed, place it at:

```text
docs/plans/issue-131-css-extraction-manifest.md
```

The manifest is the contract that prevents two workers from moving the same selectors.

## Integration Order

1. Coordinator creates `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/app-shell.css`, and cascade layer order.
2. Workers add target CSS files and component imports without deleting from `src/App.css`.
3. Coordinator removes migrated blocks from `src/App.css` in one pass.
4. Coordinator checks for duplicate selectors left in both places.
5. Coordinator runs build and lint.
6. Coordinator fixes import or cascade issues.
7. Coordinator removes `src/App.css` import from `src/App.tsx` if no meaningful CSS remains.

This is still the direct final architecture. The temporary duplicate step is only a merge-conflict control mechanism during parallel work.

## Duplicate Selector Checks

Use these checks after integration:

```bash
rg "^[.#][A-Za-z0-9_-]+" src/**/*.css
rg "App.css" src
```

For a deeper duplicate scan, use a small script or Stylelint later. Manual review is acceptable for this refactor if the moved blocks remain exact and the final `App.css` is empty or nearly empty.

## Verification

Run targeted checks while developing:

```bash
npm run build
npm run lint
npm run test
```

Before commit, all required repo checks must pass:

```bash
npm run build
npm run lint
npm run test
```

Manual UI smoke areas:

- App startup and welcome flow.
- Toolbar menus and nested flyouts.
- Timeline controls, clips, trimming, markers, keyframes, navigator.
- Media panel list, grid, board, dropdowns, and context menus.
- Properties panel tabs and controls.
- Preview edit mode and source monitor.
- Export panel.
- Changelog, splash, tutorial, relink, native helper, and warning dialogs.

If the dev server and browser are already running, use the AI bridge for basic app health:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
$body = @{ tool = 'getStats'; args = @{} } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

## Commit Plan

Recommended commits:

1. `docs: add issue 131 css modularization plan`
2. `refactor(css): add global style layers`
3. `refactor(css): move timeline styles to owned files`
4. `refactor(css): move panel and preview styles`
5. `refactor(css): move dialog and overlay styles`
6. `refactor(css): remove app css monolith`

If the work is done by multiple agents on one branch, squash or reorganize commits before merge so each commit is buildable.

## Review Checklist

- `src/App.css` no longer contains feature-scale CSS.
- Global styles are limited to tokens, base, shell, and shared primitives.
- Feature CSS is imported by owning components or folder entrypoints.
- Cascade layer order is explicit.
- No class names used by JS behavior were renamed.
- No tutorial, debug, AI, or test selectors were broken.
- Build, lint, and tests pass.
- Visual smoke check covers timeline, media, properties, preview, export, and overlays.

