# Agent Context, Performance, and Maintainability Refactor Plan

Status: Draft
Created: 2026-05-28

## Purpose

This plan is for reducing future change cost in MasterSelects. The target is not small files for their own sake. The target is that most future coding tasks can be understood and changed by a human or agent by reading a small, obvious set of files, while runtime hot paths do less unnecessary React, Zustand, export, and render work.

The practical goal:

- Improve runtime performance in timeline, preview, export, render, media load, and project load paths.
- Improve maintainability by moving mixed responsibilities into explicit domain modules.
- Reduce agent token usage by making the right file obvious and keeping normal change context under roughly 1k-1.5k directly relevant LOC.
- Remove dead code, stale exports, and side-effect-heavy module patterns that make both bundles and agent context larger than necessary.

## Baseline

Measured locally on 2026-05-28.

| Scope | Files | Physical LOC | Nonblank LOC |
|---|---:|---:|---:|
| Tracked text-ish repo, including public/vendor | 1577 | 786074 | 653218 |
| Tracked text-ish repo, excluding `public/gaussian-splat` | 1576 | 632877 | 548470 |
| `src/` tracked text-ish | 1067 | 361017 | 321510 |
| `src/` `.ts/.tsx` only | 942 | 308059 | 274995 |
| `tests/` `.ts/.tsx` only | 274 | 75434 | 67167 |
| `docs/` markdown only | 135 | 62731 | 47774 |

Known non-architecture outliers:

- `public/gaussian-splat/gaussian-splat-renderer-for-lam.module.js`: 153197 physical LOC, vendored/public renderer.
- `docs/FOSSA-Attribution.html`: 97120 physical LOC, generated attribution artifact.

Largest app files:

| LOC | File | Notes |
|---:|---|---|
| 4552 | `src/components/panels/MediaPanel.tsx` | Highest UI context cost. |
| 3758 | `src/components/panels/flashboard/FlashBoardComposer.tsx` | Provider config, prompt, chat, refs, multishot, UI mixed. |
| 3262 | `src/components/export/ExportPanel.tsx` | UI plus many export workflows. |
| 3208 | `src/services/layerBuilder/VideoSyncManager.ts` | Large central sync service. Split only along performance-safe seams. |
| 2892 | `src/components/timeline/Timeline.tsx` | High churn and interaction-heavy. |
| 2772 | `src/components/preview/Preview.tsx` | Mixed update cadence: canvas, stats, overlays, camera nav. |
| 2528 | `src/engine/WebCodecsPlayer.ts` | Engine/state-machine code. Split conservatively. |
| 2510 | `src/engine/render/RenderDispatcher.ts` | Hot render orchestration. Split only with clear invariants. |
| 2348 | `src/components/timeline/TimelineClip.tsx` | Clip rendering plus audio/spectral interaction. |
| 2329 | `src/stores/timeline/keyframeSlice.ts` | Store actions plus interpolation/planning logic. |

High-churn files by single-pass `git log --name-only -- src` scan:

| Touches | File |
|---:|---|
| 227 | `src/components/timeline/Timeline.tsx` |
| 154 | `src/engine/WebGPUEngine.ts` |
| 119 | `src/stores/timeline/clipSlice.ts` |
| 111 | `src/components/timeline/TimelineClip.tsx` |
| 99 | `src/hooks/useEngine.ts` |
| 98 | `src/services/layerBuilder/LayerBuilderService.ts` |
| 91 | `src/components/panels/MediaPanel.tsx` |
| 88 | `src/stores/timeline/index.ts` |
| 82 | `src/engine/WebCodecsPlayer.ts` |
| 80 | `src/components/preview/Preview.tsx` |

## Guiding Rules

1. Split by responsibility and update cadence, not by LOC alone.
2. Do not split render/decoder/sync files unless the seam preserves lifecycle, cache, and timing invariants.
3. Prefer pure planners and indexes over ad hoc repeated filtering in components.
4. Zustand stores should hold editor intent and durable state. Avoid per-frame render output churn in stores.
5. React components should subscribe narrowly. Hot playback/export ticks should not re-render full panels.
6. Every extracted pure module gets focused unit tests before inline logic is removed.
7. Every high-churn domain gets a short README map under 100 lines.
8. Old long plans should be marked active, stale, or completed so agents do not waste context reading obsolete docs.
9. Prefer explicit, tree-shakable ES modules over broad barrels and modules that execute work at import time.

## Target Metrics

| Metric | Current | Target |
|---|---:|---:|
| TS/TSX files over 1000 LOC | about 48 | under 20 |
| Max app TS/TSX LOC | 4552 | under 1500 for UI/store files |
| Top-20 average app LOC | about 2300 | under 1200 |
| Typical agent task context | often 3k-6k LOC | under 1k-1.5k LOC |
| Domain README maps | sparse | present for high-churn domains |

Soft caps:

- Shell React components: 300 LOC.
- View components: 600 LOC.
- Hooks/controllers: 600 LOC.
- Store slices: actions and store updates only; math/planning/interpolation belongs in pure modules.
- New files over 800 LOC require a short reason in the relevant domain README.
- New files over 1000 LOC require an explicit refactor follow-up item.

These caps are guidance, not a reason to damage engine locality.

## Workstreams

## 1. Agent Navigation and Plan Hygiene

Create small maps before broad refactors. This has immediate token savings and low risk.

Add or update:

- `docs/README.md`: one-page docs entrypoint.
- `docs/refactor/README.md`: current refactor status, active/stale/completed plan index, current hotspot table.
- `docs/plans/README.md`: short index for long plan docs.
- `docs/agent-map.md`: source-area map referenced by `AGENTS.md` and `CLAUDE.md`.
- `src/components/export/README.md`: export UI, command, engine, and test map.
- `src/components/panels/media/README.md`: media panel, board, AI tray, search, drag/drop boundaries.
- `src/components/panels/flashboard/README.md`: composer, canvas, node, model/provider, service boundaries.
- `src/components/preview/README.md`: preview shell, overlays, camera navigation, source monitor map.
- `src/services/layerBuilder/README.md`: layer builder, video sync, audio sync, frame context boundaries.
- `src/stores/timeline/README.md`: slice ownership and matching tests.

Definition of done:

- Each README is under 100 lines.
- Each README says "edit these files for X" and "tests for this area live at Y".
- Existing stale docs are not deleted; they are clearly labeled.

## 2. Dead Code and Module Hygiene

The repo is already configured as modern ESM:

- `package.json` uses `"type": "module"`.
- `tsconfig.app.json` uses `module: "ESNext"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `moduleDetection: "force"`, `noUnusedLocals: true`, `noUnusedParameters: true`, and `noUncheckedSideEffectImports: true`.
- Vite already builds from ESM-style imports.

So the useful refactor is not a broad "convert to ES modules" pass. The useful work is to make module boundaries explicit, remove stale exports/files, avoid import-time side effects, and reduce barrel usage where it hides large dependency graphs.

### Dead-code audit

Use multiple signals. No single static tool is enough in a dynamic editor app.

Recommended checks:

- TypeScript build for unused locals/parameters: `npm run build`.
- ESLint for unused vars and hook issues: `npm run lint`.
- Import/export graph tool, for example `knip`, if added intentionally to devDependencies.
- `rg` scans for suppression patterns such as `void _`, `kept for future`, commented-out handlers, and unused feature branches.
- Bundle inspection for modules included unexpectedly through barrels or side effects.
- Runtime bridge smoke tests before deleting anything near editor, playback, export, or project restore paths.

Known local signals from quick scan:

- `src/components/dock/DockTabPane.tsx` has `void _handle...` unused-handler suppressions.
- `src/components/panels/DownloadPanel.tsx` has `void _removeVideo; void _clearVideos` unused suppressions.
- `src/components/timeline/hooks/useLayerSync.ts` comments that native decoder throttling is unused because sync is handled by `LayerBuilderService`.
- Older docs mention unused export/dead-code candidates in `docs/godO.md`; these need revalidation because the current tree has changed.

Audit categories:

| Category | Action |
|---|---|
| Unused local variables/functions | Remove or wire intentionally. Do not keep with `void _name` unless the README explains the parked feature. |
| Unused exported symbols | Remove export first, then delete implementation if no internal caller exists. |
| Unused files | Move to deletion list, verify no dynamic import/worker/import-meta usage, then delete in a small PR. |
| Stale feature branches | Replace with feature flag, issue link, or delete. |
| Commented-out code | Delete unless it documents a currently tested workaround. |
| Generated/vendor artifacts | Exclude from architecture metrics; do not refactor by hand. |

### Module-boundary cleanup

Prefer:

```ts
import { buildExportPlan } from './model/exportPlan';
```

over:

```ts
import { buildExportPlan } from '@/components/export';
```

when the barrel re-exports many unrelated runtime modules.

Barrels are still useful for stable public domain APIs, but they should not become default imports for hot internal code. The quick scan found large or broad index files that deserve review before more usage spreads:

- `src/types/index.ts`
- `src/services/aiTools/index.ts`
- `src/stores/mediaStore/index.ts`
- `src/components/panels/properties/index.tsx`
- `src/stores/timeline/index.ts`
- `src/engine/audio/index.ts`
- `src/effects/index.ts`
- `src/transitions/index.ts`
- `src/services/guidedActions/index.ts`
- `src/engine/index.ts`

Rules:

- Domain `index.ts` files should export stable API surface, not every internal helper.
- Avoid `export *` in large domains unless the domain is intentionally plugin-like.
- Keep import-time work out of shared modules. Constructors, subscriptions, workers, decoders, GPU resources, and stores should initialize through explicit functions or HMR-safe singletons.
- Pure logic modules should have no React, no Zustand, no DOM, and no import-time side effects.
- Runtime services should own lifecycle explicitly: `create`, `start`, `stop`, `dispose`.

### Tooling proposal

Add dead-code tooling only after deciding the config, because false positives are likely in this app.

Candidate:

```bash
npm install -D knip
```

Initial script:

```json
"deadcode": "knip"
```

Expected config needs:

- Ignore generated/vendor files.
- Treat Vite, Vitest, workers, dynamic imports, public assets, Cloudflare files, and native-helper integration carefully.
- Start in report-only mode; do not auto-delete.

Definition of done:

- `npm run build` and `npm run lint` stay clean.
- Dead-code report is checked in as config, not as a one-off terminal guess.
- Every deletion is either pure dead code or backed by tests/bridge smoke checks.
- Broad barrels have README-documented public surfaces or are narrowed.

## 3. Baseline Performance Measurement

Before changing hot paths, collect repeatable numbers.

Use app bridge where possible:

- `getStatsHistory` for FPS, drops, render loop, decoder state.
- `simulateScrub` and `simulatePlayback` for timeline responsiveness.
- `getPlaybackTrace` for WebCodecs/VF health and first preview update timing.
- `debugExport` for export progress, blob size, GPU/export logs.

Add manual or scripted React measurements for:

- Timeline render counts during playback, scrub, zoom, drag, and selection.
- Preview render counts during playback/export/stat updates.
- ExportPanel render count and progress update frequency.
- Large project load time and store commit count.

Definition of done:

- A short baseline table exists in `docs/refactor/README.md` or this document.
- Each later performance phase compares before/after with the same scenario.

## 4. Low-Risk Hot-Path Wins

These should happen before large structural moves.

### Export progress throttling

Problem:

- `src/components/export/ExportPanel.tsx` updates React/export store progress at frame cadence.
- `src/engine/export/FrameExporter.ts` can publish preview frames every rendered frame.

Plan:

- Keep per-frame diagnostics internal.
- Publish UI progress at a fixed interval, for example 100-250ms, plus force-publish phase boundaries and completion.
- Publish preview frames at a lower preview cadence unless explicit debug mode requests every frame.
- Precompute export frame maps once per export.

Tests:

- Unit test progress adapter.
- Bridge `debugExport` smoke test with and without audio.
- Verify UI still reaches 100% and does not regress cancellation.

### Render debug gating

Problem:

- `src/engine/render/RenderDispatcher.ts` builds debug payloads and expensive signatures in render paths.
- Some texture paths can do repeated work without cheap dirty/version checks.

Plan:

- Gate render debug payload building behind logger/debug state.
- Replace JSON/string signatures with version counters where possible.
- Add dirty version tracking for dynamic canvas/text/mask uploads.

Tests:

- Existing render dispatcher unit tests.
- Playback trace before/after.
- Export first/middle/last frame comparisons.

### Preview update-cadence split

Problem:

- `src/components/preview/Preview.tsx` mixes canvas shell, stats, export preview, overlays, source monitor, selection, camera navigation, and scene gizmos.

Plan:

- Move stats overlay into its own subscriber.
- Move export preview drawing/state into an isolated component or hook.
- Move edit/scene overlay subscriptions out of the canvas shell.
- Keep camera navigation state in ref/RAF paths where possible; commit durable state only on gesture end.

Tests:

- Preview render-count scenario.
- Source monitor, edit mode, camera nav, splat nav, export preview smoke checks.

## 5. Shared Runtime Indexes and Pure Planners

This is the main architecture/performance layer.

### TimelineRuntimeIndex

Problem:

- Active-clip and track queries are repeated by filtering arrays in timeline helpers, layer builder frame context, and export paths.

Plan:

Create a shared runtime index, likely under `src/services/timelineRuntime/` or `src/stores/timeline/runtime/`:

```text
TimelineRuntimeIndex
  clipById
  trackById
  clipsByTrack
  sortedClipIntervals
  mediaById
  activeClipsAt(time)
  visibleClipsForWindow(start, end)
```

Use it from:

- `src/components/timeline/Timeline.tsx`
- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClip.tsx`
- `src/components/timeline/hooks/useTimelineHelpers.ts`
- `src/services/layerBuilder/FrameContext.ts`
- export frame/context builders

Tests:

- Interval overlap cases.
- Locked/hidden track filtering.
- Nested comp and transition boundary cases.
- Empty timeline and single-frame clips.

### Compiled keyframe curves

Problem:

- Keyframe interpolation filters/sorts repeatedly.
- `keyframeSlice.ts` mixes store mutation, camera/vector/mask planning, and interpolation helpers.

Plan:

- Move interpolation, mask topology, vector animation state, and property parsing helpers into pure modules.
- Compile curves by clip/property when keyframes mutate.
- Invalidate only affected clip/property curves.

Candidate structure:

```text
src/stores/timeline/keyframes/
  keyframeSlice.ts
  keyframeCurveIndex.ts
  keyframePropertyPaths.ts
  maskPathInterpolation.ts
  vectorAnimationKeyframes.ts
  cameraKeyframes.ts
```

Tests:

- Existing keyframe slice tests.
- New pure tests for masks, vector animation, camera settings, stepped/linear interpolation.

## 6. UI Domain Refactors for Agent Context Savings

Do these as behavior-preserving moves with tests around extracted pure logic first.

### ExportPanel

Goal:

- Make `ExportPanel.tsx` a shell/form coordinator.
- Move export path choice into pure `exportPlan`.
- Move command execution into separate modules.

Target layout:

```text
src/components/export/
  ExportPanel.tsx
  README.md
  components/
    ExportSummary.tsx
    ExportCommandBar.tsx
    ExportWorkflowSection.tsx
    ExportBasicsSection.tsx
    ExportVideoSection.tsx
    ExportAudioSection.tsx
    ExportImageSection.tsx
    ExportProgressView.tsx
  actions/
    useExportCommands.ts
    webCodecsExportCommand.ts
    ffmpegExportCommand.ts
    browserGifExportCommand.ts
    audioOnlyExportCommand.ts
    imageExportCommand.ts
    fcpxmlExportCommand.ts
  model/
    exportPlan.ts
    exportProgressAdapter.ts
    imageEncoding.ts
```

First moves:

1. `canvasToBlob` and `encodeBmp` to `model/imageEncoding.ts`.
2. Export target/mode derivation to `model/exportPlan.ts`.
3. Progress state adaptation to `model/exportProgressAdapter.ts`.
4. FFmpeg/audio/image/GIF commands one at a time.

### MediaPanel

Goal:

- Make `MediaPanel.tsx` a thin shell around a panel model, views, context menu, and dialogs.
- Keep board behavior in `src/components/panels/media/board/`.

Target layout:

```text
src/components/panels/media/
  README.md
  MediaPanelHeader.tsx
  MediaPanelContextMenu.tsx
  MediaPanelDialogs.tsx
  ClassicMediaList.tsx
  IconMediaGrid.tsx
  AddMediaMenu.tsx
  columnPrefs.ts
  mediaSearch.ts
  mediaMetadataLabels.ts
  useMediaPanelModel.ts
  useMediaPanelActions.ts
  board/
    MediaBoardView.tsx
    layout.ts
    storage.ts
    overviewCanvas.ts
    useMediaBoardController.ts
    useMediaBoardGestures.ts
    useMediaBoardViewport.ts
    useMediaBoardThumbnails.ts
    mediaBoardOrderPlanning.ts
```

First moves:

1. Search tokenization and matching to `mediaSearch.ts`.
2. Metadata and display labels to `mediaMetadataLabels.ts`.
3. Column order/view mode local storage to `columnPrefs.ts`.
4. Delete/relink dialog state to `MediaPanelDialogs.tsx`.
5. Board gesture/controller logic after board tests exist.

### FlashBoardComposer

Goal:

- Separate provider/model logic from composer UI.
- Keep pure prompt, model, Suno, ElevenLabs, multishot, and request-building logic testable.

Target layout:

```text
src/components/panels/flashboard/composer/
  FlashBoardComposerShell.tsx
  ComposerPrompt.tsx
  ComposerActionBar.tsx
  ComposerModelPopover.tsx
  ComposerReferenceStrip.tsx
  ComposerChatPanel.tsx
  MultiShotPanel.tsx
  VoiceSettingsPanel.tsx
  SunoSettingsPanel.tsx
  useComposerModel.ts
  useComposerReferences.ts
  useFlashBoardChat.ts
  usePromptRefinement.ts
  useMultiShotEditor.ts
  requestBuilder.ts
  modelOptions.ts
  sunoLogic.ts
  voiceLogic.ts
```

First moves:

1. Multishot balancing and fallback prompt logic.
2. Suno limits/title/model normalization.
3. ElevenLabs normalization and output format labels.
4. Model categorization/provider display labels.
5. Reference ID clamping/move helpers.

## 7. Timeline and Store Boundaries

### Timeline view models

Problem:

- Timeline and clip components pass broad arrays and repeatedly derive local state.

Plan:

- Build track-local view models from `TimelineRuntimeIndex`.
- Pass local clip models to `TimelineTrack` and `TimelineClip`.
- Keep pointer-drag preview state in refs/RAF during gestures, then commit store changes at stable boundaries.
- Memoize handlers by command/action groups rather than per clip where possible.

### Remove live render output churn from timeline store

Problem:

- `useLayerSync.ts` and engine paths overlap in layer generation.
- Store writes for render-layer output cause broad subscriptions to fire.

Plan:

- Make `LayerBuilderService` the authoritative render-layer builder.
- Keep timeline store as durable editor state.
- Replace live `layers` subscriptions with narrow render services or explicit snapshots.

Tests:

- Playback, scrub, RAM preview, nested comp, export, and source monitor bridge tests.
- Store tests proving durable editor state is unchanged.

## 8. Project and Media Hydration Batching

Problem:

- Project load and deferred cache restore perform repeated full-array updates and progress changes.

Plan:

- Build media/timeline state off-store in a hydration transaction.
- Commit state in one or a few chunks.
- Throttle progress updates.
- Use indexes for media lookup rather than repeated `files.map`/`files.find` patterns.

Candidate files:

- `src/services/project/projectLoad.ts`
- `src/stores/mediaStore/index.ts`
- `src/stores/timeline/index.ts`

Tests:

- Existing project persistence tests.
- Large project fixture load timing.
- Thumbnail/cache restore behavior.

## 9. Engine and Sync Refactors: Conservative Seams

These files are large but not automatically bad:

- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/WebCodecsPlayer.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`

Refactor only when the seam improves performance, testability, or lifecycle clarity.

Good seams:

- Pure capability detection.
- Codec/demux metadata parsing.
- Debug snapshot construction outside hot paths.
- Warmup/preload policy objects.
- Frame/context planning that can be tested without GPU/device state.

Bad seams:

- Splitting state-machine internals across files without tests.
- Moving GPU resource ownership without explicit destroy/lifecycle rules.
- Splitting timing-sensitive video sync by method name instead of state ownership.

## Phase Plan

### Phase 0: Plan Hygiene and Metrics

- Add domain README maps.
- Mark stale long docs.
- Add dead-code/module-hygiene checklist and decide whether to add `knip` in report-only mode.
- Record baseline bridge stats and render counts.
- Add a lightweight LOC/churn script if one does not already exist.

### Phase 1: Dead Code and Module Hygiene

- Revalidate old dead-code candidates from `docs/godO.md`.
- Remove commented-out code and unused suppressions where clearly stale.
- Add or configure dead-code tooling in report-only mode.
- Review broad barrels and mark intended public APIs.

### Phase 2: Low-Risk Performance

- Export progress throttling.
- Render debug gating.
- Preview stats/export-preview isolation.
- Dirty/version checks for dynamic texture uploads.

### Phase 3: Runtime Indexes

- Add `TimelineRuntimeIndex`.
- Add compiled keyframe curve modules.
- Move active-at-time and interpolation consumers gradually.

### Phase 4: Export Refactor

- Add `exportPlan`, `imageEncoding`, and `exportProgressAdapter`.
- Extract one export command at a time.
- Keep UI behavior unchanged.

### Phase 5: Media and FlashBoard Refactors

- Extract pure helpers first.
- Add `useMediaPanelModel` and `useComposerModel`.
- Split views/popovers/dialogs after helper tests exist.

### Phase 6: Timeline/Preview React Locality

- Track-local timeline view models.
- Preview shell split by update cadence.
- Remove render-layer store churn after tests and bridge traces are stable.

### Phase 7: Project Load and Engine Cleanup

- Hydration transaction.
- Media indexes.
- Conservative engine/sync seams based on measurements.

## Required Verification

For small pure extractions:

- Focused unit tests for the moved module.
- `npm run test:unit` for related tests.

For UI refactors:

- Relevant unit/component tests.
- Manual or browser smoke check if the dev server is already running.
- Verify no visible layout regression in the touched panel.

For playback/render/export changes:

- `simulateScrub`
- `simulatePlayback`
- `getPlaybackTrace`
- `debugExport` smoke test
- First/middle/last frame checks for export-sensitive changes

Before commit:

```bash
npm run build
npm run lint
npm run test
```

## Agent Usage Notes

When assigning future agent work:

- Prefer one domain and one write scope per agent.
- Ask agents to read the domain README first.
- For performance work, require before/after measurements.
- For decomposition work, require tests for extracted pure logic.
- Do not assign two agents to overlapping files unless one is read-only.
- Keep agent outputs grounded in file paths and exact modules.

## Multi-Agent Execution Model

Use one coordinator agent and several bounded worker agents. The coordinator owns sequencing, integration, shared docs, shared indexes, shared type changes, and final verification. Worker agents own one domain at a time and should not edit shared files unless the work package explicitly says so.

The goal is not maximum parallelism. The goal is parallelism without merge conflicts, duplicated analysis, or hidden architecture drift.

### Coordinator responsibilities

- Maintain the phase board and decide which packages can run in parallel.
- Assign each worker an exclusive write scope.
- Own shared files such as `AGENTS.md`, `CLAUDE.md`, `src/version.ts`, global barrels, cross-domain type files, and root docs.
- Review worker outputs before merging.
- Run or request integration checks after each batch.
- Stop parallel work when a dependency becomes unclear.

### Worker package format

Every agent task should be assigned with this shape:

```md
Objective:
  One concrete outcome.

Owned write scope:
  Exact files/folders the agent may edit.

Read-only context:
  Files/folders the agent may inspect but must not edit.

Forbidden files:
  Shared files or active work owned by another agent.

Steps:
  1. Inspect current code and tests.
  2. Make the smallest behavior-preserving move.
  3. Add or update focused tests.
  4. Run scoped verification.
  5. Report changed files, commands run, risks, and next package.

Definition of done:
  Concrete behavior/test/doc criteria.
```

### Parallel work lanes

These lanes are designed to avoid overlapping write scopes.

| Lane | Primary owner | Write scope | Can run with | Blocks |
|---|---|---|---|---|
| Docs/navigation | Coordinator or worker | `docs/`, domain `README.md` files | Most lanes | None, but should happen early |
| Dead-code/module hygiene | Worker | One domain at a time, plus optional tooling config | Docs, UI pure extraction | Any deletion near active refactor files |
| Export | Worker | `src/components/export/**`, related export tests | Media, FlashBoard, docs | Shared engine/export changes |
| Media panel | Worker | `src/components/panels/MediaPanel.tsx`, `src/components/panels/media/**`, related tests | Export, FlashBoard, docs | Shared media store changes |
| FlashBoard | Worker | `src/components/panels/flashboard/**`, flashboard store/service tests | Export, Media, docs | Shared AI/provider service changes |
| Preview | Worker | `src/components/preview/**`, related tests | Export UI extraction, docs | Engine/render lifecycle changes |
| Timeline UI | Worker | `src/components/timeline/**`, related tests | Docs, Media helper extraction | `TimelineRuntimeIndex` design |
| Runtime indexes | Coordinator or senior worker | New runtime index modules, timeline/keyframe tests | Docs only at first | Timeline UI, layer builder, export consumers |
| Project hydration | Worker | `src/services/project/**`, media/timeline store hydration tests | Docs, UI-only lanes | Shared store shape changes |
| Engine/render/sync | Coordinator or senior worker | `src/engine/**`, `src/services/layerBuilder/**` | Docs only or read-only reviewers | Many runtime consumers |

### Recommended parallel waves

Wave 0: maps and measurement.

- Agent A: `docs/refactor/README.md`, `docs/plans/README.md`, domain README template.
- Agent B: baseline measurement plan and bridge command checklist.
- Agent C: dead-code tooling/config proposal in report-only mode.

Wave 1: low-conflict pure extraction.

- Agent A: export pure modules: `imageEncoding`, `exportPlan`, `exportProgressAdapter`.
- Agent B: MediaPanel pure modules: `mediaSearch`, metadata labels, column prefs.
- Agent C: FlashBoard pure modules: multishot, Suno, ElevenLabs, model options.
- Agent D: Preview stats/export-preview isolation investigation or small extraction.

Wave 2: hot-path performance.

- Agent A: export progress throttling with tests.
- Agent B: RenderDispatcher debug gating, if no other engine work is active.
- Agent C: project hydration batching design, read-only until store ownership is clear.

Wave 3: shared runtime foundations.

- One owner only: `TimelineRuntimeIndex`.
- One owner only: compiled keyframe curves.
- Other agents may review read-only, but should not edit timeline/store/runtime foundations in parallel.

Wave 4: consumers migrate to shared foundations.

- Agent A: Timeline UI consumes track-local view models.
- Agent B: LayerBuilder/FrameContext consumes `TimelineRuntimeIndex`.
- Agent C: export frame/context builder consumes `TimelineRuntimeIndex`.

These three can run in parallel only after the index API is stable and tests exist.

Wave 5: larger shell splits.

- Agent A: `ExportPanel.tsx` shell split.
- Agent B: `MediaPanel.tsx` shell split.
- Agent C: `FlashBoardComposer.tsx` shell split.
- Agent D: `Preview.tsx` shell split by cadence.

### Conflict rules

- Two agents must not edit the same file in the same wave.
- Shared type changes are coordinator-owned unless explicitly delegated.
- Barrel/index exports are coordinator-owned during integration.
- If a worker needs a shared type or API change, it should stop and report the requested interface.
- Generated/vendor files are out of scope unless the package explicitly says otherwise.
- Do not mix behavior changes with file moves unless the work package calls for it.

### Integration cadence

Use small integration batches:

1. Workers finish independent packages and report changed files.
2. Coordinator reviews diffs for ownership violations.
3. Coordinator runs scoped tests for each package.
4. Coordinator runs broader checks when a batch touches shared runtime, stores, engine, or export.
5. Coordinator updates the domain README and this plan if boundaries changed.

Before commit, still run:

```bash
npm run build
npm run lint
npm run test
```

### Work-package examples

Export worker:

```md
Objective:
  Extract image encoding helpers from ExportPanel without changing behavior.

Owned write scope:
  src/components/export/model/imageEncoding.ts
  src/components/export/ExportPanel.tsx
  tests/unit/export/imageEncoding.test.ts

Read-only context:
  src/components/export/**
  src/engine/export/**

Forbidden files:
  src/engine/**
  src/stores/**

Definition of done:
  ExportPanel imports helpers from imageEncoding; helper tests cover PNG/JPEG/WebP/BMP branches; scoped tests pass.
```

Media worker:

```md
Objective:
  Extract MediaPanel search tokenization and matching into a pure module.

Owned write scope:
  src/components/panels/media/mediaSearch.ts
  src/components/panels/MediaPanel.tsx
  tests/unit/media/mediaSearch.test.ts

Read-only context:
  src/components/panels/media/**
  src/stores/mediaStore/**

Forbidden files:
  src/stores/mediaStore/**

Definition of done:
  Search behavior is unchanged; wildcard/token tests exist; MediaPanel no longer contains search parser logic.
```

Runtime index worker:

```md
Objective:
  Add TimelineRuntimeIndex as a tested pure query module without migrating UI consumers yet.

Owned write scope:
  src/stores/timeline/runtime/TimelineRuntimeIndex.ts
  src/stores/timeline/runtime/types.ts
  tests/unit/timeline/TimelineRuntimeIndex.test.ts

Read-only context:
  src/stores/timeline/**
  src/components/timeline/**
  src/services/layerBuilder/**

Forbidden files:
  Existing timeline components and layer builder consumers.

Definition of done:
  Index builds clipById, trackById, clipsByTrack, active-at-time, and visible-window queries with edge-case tests.
```

## Current Multi-Agent Findings

Two read-only explorer agents reviewed the codebase for this plan.

Performance reviewer highlights:

- Build timeline view models instead of passing global arrays.
- Introduce `TimelineRuntimeIndex`.
- Compile keyframe curves once per mutation.
- Split `Preview.tsx` by update cadence.
- Throttle export progress and preview publication.
- Gate render debug work and add dirty versions.
- Batch project/media hydration.
- Avoid splitting large engine/sync files unless the seam reduces hot-path work or ownership ambiguity.

Maintainability/token reviewer highlights:

- Highest token-cost decomposition candidates are `MediaPanel.tsx`, `FlashBoardComposer.tsx`, and `ExportPanel.tsx`.
- Add short domain README maps before broad refactors.
- Move pure logic out first, especially search/metadata/export plan/multishot/provider helpers.
- Track TS/TSX files over 1000 LOC, max app LOC, top-20 average LOC, and typical agent context size.

One attempted `react-doctor` run from the performance reviewer failed with `ECOMPROMISED Lock compromised`; findings above are from manual inspection plus local LOC/churn scans.
