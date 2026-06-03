# Timeline Canvas Refactor Plan

**Status:** Phase 0 contracts implemented; Phase 1 shell-mount/diagnostics implemented behind the legacy overlay; Phase 2 cache-boundary and runtime-fallback slices in progress, with tests deferred to the next checkpoint  
**Scope:** full timeline clip refactor for speed, maintainability, and clean ownership  
**Parallelism target:** up to 6 agents working on independent streams  
**Primary rule:** timeline visuals must not create, own, or warm playback media runtime

**Latest implementation checkpoint:** six Phase 0 contract packets landed through the swarm. `ClipInteractionShell` now mounts inside the existing canvas DOM overlay for hovered/dragged/trimmed canvas clips plus track-local active `clipFade`, open clip context-menu, selected keyframe, audio-region, spectral-region, video-bake, and stem-job states with `pointer-events: none`, while selected-only clips still stay canvas-rendered. Active trim handles now render through `ClipTrimHandles` and dispatch back into the existing trim command path. Trim-only, context-menu-only, and drag/multi-drag-only active canvas shells now skip the legacy `TimelineClip` body entirely. Fade still keeps the legacy overlay until the shell/canvas path draws the fade curve and duration-positioned handles with parity. Other active overlay states also keep the legacy body until shell parity is proven. `getStats` now exposes `timelineCanvas` diagnostics with canvas draw counts, thumbnail/waveform counts, DOM overlay counts, shell counts, and active shell slot counts. Phase 2 has moved visible thumbnail DB warmup into `timelineThumbnailDbWarmup`, missing visible thumbnail generation into `timelineThumbnailGenerationWarmup`, waveform artifact reads into `timelineWaveformArtifactWarmup`, and source waveform generation demand into `timelineSourceWaveformWarmup`, all with in-flight coalescing and component-side visible-demand collection. Thumbnail and waveform generation warmups block while playback or drag preview is active. Warmup schedulers now use bound browser timers so visible thumbnail generation cannot crash with `Illegal invocation` on load. Decoded thumbnail `ImageBitmap`s now live in a service-level `thumbnailBitmapCache` with source/URL close APIs; source thumbnail evictions close decoded bitmaps before revoking blob URLs. `TimelineClip.tsx` decomposition now includes extracted presentation, stem-display, audio-region display, coverage badges, media-label color resolution, waveform render geometry, audio-region context-menu model, active audio/video region overlay geometry, source-extension ghost geometry, and spectral selection/image-layer overlay geometry. Suppressed canvas overlay bodies no longer render passive labels, badges, thumbnails, transcript/analysis markers, reload indicators, or mixdown/static-artwork decorations while active handles stay available. Targeted playback checks are intentionally deferred until the next integration checkpoint.

**Latest retirement checkpoint:** `TimelineClip.tsx` still mounts as the legacy canvas overlay for active states that do not yet have shell parity, but trim-only, context-menu-only, and drag/multi-drag-only active canvas shells no longer call `renderClip()` and therefore no longer create the legacy clip body. Remaining canvas-mode overlay instances receive `passiveVisualsSuppressed`, which prevents thumbnail, waveform, spectrogram, audio-artifact warmup/render work, and passive decoration JSX from running through the invisible overlay. `serializationUtils.restoreSourceThumbnails()` no longer calls `thumbnailCacheService.generateForSource()` during timeline load; it only loads already-cached source thumbnails, leaving missing thumbnail generation to the visible scheduler. Silent project-load auto-relink now passes `{ generateThumbnails: false }` through both `applyRelinkMatch()` and the stored-handle `updateTimelineClips()` fallback, while manual reload/relink keeps direct generation. Unused IndexedDB project actions (`saveProject`, `loadProject`, `getProjectList`, `deleteProject`) were removed from `mediaStore/slices/projectSlice.ts`; current project loading/saving stays on `ProjectFileService`. The remaining IndexedDB startup restore body was extracted to `mediaStore/legacyStartupRestore.ts`, leaving `projectSlice.ts` as a thin compatibility delegator plus project UI/runtime actions.

**Latest decomposition checkpoint:** Post-commit `TimelineClip.tsx` was reduced from 3364 LOC to 1517 LOC while keeping the legacy overlay behavior available. New focused renderers/hooks now own thumbnail filmstrips, media classification, audio-region context menus, video-bake region overlays, audio-edit operation overlays, clip metadata, coverage badges, passive status badges, stem switcher UI/state, clip animation state, keyframe tick drag state, spectral image-layer selection/drop handling, audio waveform/spectrogram media view, audio-media prop planning, passive background/foreground visual layers, audio-region selection overlay, audio-region gain/context-menu controls, audio/video-bake/spectral region interaction drag controllers, spectral-region overlays, audio edit-stack controls, transcript/analysis passive overlays, keyframe tick rendering, fade/trim controls, and selection hitareas. `TimelineClipProps` no longer carries unused `clipFade`, `timelineRef`, `pixelToTime`, `allKeyframeTimes`, or clip pick-whip pass-through props; unused `TimelineTrackProps.timelineRef`, dead audio gain-drag snapshot fields, and the dead timeline thumbnail-bitmap re-export were also removed. Stem job active-phase handling and clip source timing/loop-extension helpers are now shared instead of duplicated in UI, store, trim, and canvas files. Thumbnail render-plan work is now gated behind visibility flags and `ClipThumbnailFilmstrip` uses discriminated props so invalid blank filmstrip combinations fail type checking. Playback/browser tests and type checks are intentionally deferred for the latest no-test checkpoint per instruction.

**Latest debug checkpoint:** the preview "horizontal lines" artifact was reproduced through the AI bridge in both GPU readback and DOM canvas capture. The active layer was using `proxy-image-frame` while proxy mode was enabled and the editor was paused; `purgePlaybackPath` cleared the cold cache but the stale/corrupt proxy frame still rendered as stripes. Paused inspection now stays on the live HTML video path, while JPEG proxy frames are reserved for interactive scrub/drag previews, and `VideoSyncManager` follows the same proxy gating. `VideoSyncManager` also now rechecks actual GPU-ready state instead of trusting `video.played.length`, so a video that has played once but is still not GPU-ready can be warmed again. Post-change capture returned real video frames. A follow-up playback probe found `inputLayers=1` but `collectedLayerData=0` when the full WebCodecs provider had no frame and the HTML video was paused; `LayerCollector` now has a playback-only `playback-html-fallback`, and `VideoSyncManager` can start a ready HTML video when the provider is not yet frame-ready. This still needs the next bridge playback checkpoint.

## Goal

Make the timeline clip area fast and maintainable for large projects by making the canvas path the real clip UI architecture, not a partial optimization layered on top of the old DOM clip system.

The target is a strict separation:

- Canvas renders all passive clip bodies: rectangles, labels, thumbnails, status badges, transcript/analysis markers, source-extension ghosts, fade curves, waveform summaries, and spectrogram summaries after renderer parity exists.
- DOM renders only active interaction shells: hovered clips, active drag/trim/fade states, open menus, keyframe/audio/spectral/video/stem active controls, and tool-specific drop or pointer affordances.
- Selected-only visuals stay canvas-rendered. Do not mount selected-only DOM clip bodies.
- Playback, export, RAM preview, thumbnail/render-target generation, nested composition evaluation, and other render services own live media elements, decoder warmup, audio sync, WebGPU texture import, and runtime hydration through explicit policies.
- Cache services own thumbnails, waveform, spectrogram, loudness, beat/onset, and frequency/phase artifacts. View components request visible render data; they do not generate or hydrate media.

## Why This Refactor

The current hybrid state is useful but not clean enough:

- The canvas clip renderer reduces visible DOM work, but the old `TimelineClip` component still leaks into active controls, cache warming, keyframes, audio UI, spectral UI, video bake controls, stem controls, context-menu assumptions, and subscriptions.
- Project load and playback can still touch live media elements for too many clips when runtime ownership is unclear.
- Existing generated thumbnails can now hydrate from IndexedDB before playback, but missing-thumbnail generation still uses direct `HTMLVideoElement` call sites and needs a bounded background scheduler.
- Maintaining two mental models, DOM clip body and canvas clip body, makes bugs likely and makes performance regressions easy.
- The current worker path is too small to be the architecture. It draws basic rects/labels and lacks hover, trim/source-extension geometry, in/out/reverse visuals, thumbnails, waveforms, and spectrogram resources.

## Non-Goals

- No throwaway MVP canvas rewrite.
- No silent removal of editing features.
- No playback/export rewrite unless needed to separate timeline UI from media runtime.
- No big-bang deletion before interaction parity, cache parity, diagnostics, and playback/export smoke tests prove the replacement.

## Target Architecture

### 1. Timeline Render Model

Create a compact, plain, structured-clone-safe render model consumed by the canvas and active shell layer.

It should contain only render data and references:

- clip id, track id, start, duration, in/out, speed/reverse, source type
- label, colors, selected/hovered/linked/locked/muted state
- passive badge state: proxy, audio proxy, download, stem, reload, reversed, linked, transcript, analysis, nested composition
- cache refs for thumbnails, waveform, spectrogram, loudness, beat/onset, frequency/phase, and analysis markers
- computed geometry fields where useful, or stable inputs to the shared geometry resolver

It must not contain `File`, `HTMLVideoElement`, `HTMLAudioElement`, `ImageBitmap` ownership, object URLs, DOM nodes, WebCodecs players, native decoder handles, store actions, cache-warming callbacks, or playback state.

Persistence boundary: `TimelineRenderModel` is plain render/worker-transfer data, not project schema. It is derived from `CompositionTimelineData`, media-store metadata, cache registry state, and transient UI state after load. Do not persist hover/selection, canvas geometry, object URLs, DOM nodes, `ImageBitmap`s, waveform payloads, spectrogram payloads, or cache payloads into `SerializableClip`, `ProjectClip`, or `CompositionTimelineData`.

### 2. Timeline Geometry Snapshot

Use one geometry source for canvas, overlays, hit testing, marquee, drag, trim, fade, keyframes, transitions, markers, and split targets.

The snapshot must include:

- track lane rects and row viewport rects measured from the real scroll container, not `window.innerWidth`
- clip body rects
- source-extension and trim ghost rects
- trim handle rects and linked/follower trim preview rects
- fade handle rects and fade curve geometry
- keyframe rows, ticks, and diamond rects
- transition junctions and drop zones
- marquee exclusion zones
- drag/drop targets for clips, image layers, spectral regions, audio regions, and tools
- timeline ruler/grid conversion helpers

Normalize `canvasContentWidth`/`contentWidth`: either remove it or make it part of `TimelineGeometrySnapshot`. Do not keep a prop that is computed in `TimelineTrack` but ignored by `TimelineClipCanvas`.

### 3. Canvas Renderer

Canvas becomes the single visible renderer for passive clip bodies.

Expected responsibilities:

- viewport culling and level of detail
- source thumbnail drawing from cache
- waveform summary drawing from cache
- real spectrogram summary drawing from cache after `ClipSpectrogram` parity exists
- fade curve drawing via a shared drawing utility
- transcript and analysis markers
- nested composition mixdown waveforms and boundaries
- passive status badges and labels
- selected/hovered visual feedback where cheap
- density rendering at extreme zoom

Do not promote the current `CanvasClip` type to the final model. The target renderer input must remove `File`, DOM element, store-action, and cache-warming dependencies.

### 4. Clip Interaction Shell

Replace the generic `renderClip` callback and full `TimelineClip` overlay with a typed `ClipInteractionShell` contract.

Shell inputs:

- resolved geometry
- interaction state
- command callbacks
- active module state
- cache/render refs needed for hit areas, not payload ownership

Mount rules:

- hovered clip
- active drag or multi-drag clip
- active trim clip and linked/follower trim preview clips
- active fade clip via explicit `clipFade` state
- open clip, audio, spectral, stem, or video menu
- selected clips with visible keyframes or active keyframe focus
- active audio region context menu, selection, or gain drag
- active spectral selection, drop target, or toolbar
- active video bake region
- active stem menu/job
- tool preview state

Selected-only clip body visuals remain canvas-rendered.

### 5. Specialized Active Modules

`TimelineClip.tsx` should be split, not moved wholesale.

Canvas owns:

- static clip body
- fill/color/selection/hover visuals
- labels and passive badges
- source thumbnails
- passive waveform and spectrogram summaries
- fade curves
- transcript/analysis markers
- nested mixdown waveform and boundaries
- source-extension trim ghosts

Active shell modules own:

- root pointer/context dispatch
- trim and fade handles
- keyframe ticks/edit controls
- audio region selection, gain, context menu, and edit stack
- spectral selection, image-layer drop, toolbar, and context menu
- video bake controls
- stem switcher and stem job controls
- drag/drop/drop-target affordances

Subcomponent disposition:

- `ClipWaveform`: convert renderer logic into canvas/shared drawing utilities, with active-only controls in shell.
- `ClipSpectrogram`: keep DOM fallback until true canvas spectrogram tile rendering and cache scheduling exist.
- `ClipAnalysisOverlay`: move passive markers/summary to canvas; keep active playhead-coupled editing in shell only if needed.
- `FadeCurve`: move path math into shared geometry/drawing utility; shell owns pointer handles.
- `TimelineContextMenu`: split command model from DOM/browser/media dependencies.

### 6. Runtime Boundary

Interactive playback hydrates active and near-active timeline resources under capped budgets.

Export, RAM preview, thumbnail/render-target generation, and nested composition evaluation use explicit non-interactive runtime policies and must not be collapsed into playback hydration without parity tests.

Runtime must account for:

- same-track transition overlap where two clips on one track can render at once
- background layers
- active slot decks/program output
- nested composition recursion
- masks/effects inside nested compositions
- render-target and thumbnail generation paths
- export clip preparation, seeking, layer building, audio, and cleanup
- RAM preview policy

### 7. Cache Boundary

Source and analysis caches are warmed independently from playback:

- existing generated thumbnails load from IndexedDB for visible source ids
- missing thumbnails generate through a controlled background queue, never during playback start
- decoded thumbnail bitmaps are cached and closed through an explicit LRU/invalidation path
- source waveform generation remains job-coalesced
- artifact reads for waveform, spectrogram, loudness, beat/onset, and frequency/phase gain in-flight coalescing per artifact/ref id
- cache changes notify canvas redraw without React clip remounts

## Parallel Streams

Use up to 6 agents for independent implementation streams. Agents must not edit the same files unless explicitly coordinated.

1. **Canvas renderer and timeline track shell**
   - Files: `TimelineClipCanvas.tsx`, `TimelineTrack.tsx`, canvas worker, canvas utilities, related CSS.
   - Output: render model, geometry snapshot, passive visual parity, worker-readiness contract.

2. **Old `TimelineClip` decomposition**
   - Files: `TimelineClip.tsx`, clip subcomponents, context menu, clip CSS.
   - Output: ownership split, module extraction, active shell parity matrix.

3. **Interaction and edit operations**
   - Files: timeline hooks, edit operations, selection/drag/trim/fade/keyframe/transition flows.
   - Output: typed operation parity, transaction model, shared geometry hit testing.

4. **Runtime and playback/export boundary**
   - Files: layer builder, media runtime, playback loop, export preparation/seeking/building, RAM preview, composition renderer.
   - Output: runtime policy registry, diagnostics, parity test matrix.

5. **Thumbnail/audio/cache pipeline**
   - Files: thumbnail cache, thumbnail bitmap cache, waveform/spectrogram/loudness/beat/frequency caches, audio analysis jobs.
   - Output: scheduler lanes, in-flight coalescing, invalidation and deletion contract.

6. **Project load, serialization, and history**
   - Files: serialization, project load/save, history snapshots, media-store project paths.
   - Output: persisted data contract, undo state contract, runtime rehydration adapter, legacy path decision.

## Swarm Execution Protocol

Use agent swarms only with explicit phase and file ownership. The default first swarm is Phase 0 only. Later phases require Phase 0 contracts to be merged first.

### Swarm Modes

- **Read-only review:** agents inspect code and return findings. They do not edit files.
- **Contract worker:** agents create or update TypeScript contracts, tests, docs, and diagnostics in assigned files only.
- **Implementation worker:** agents change runtime behavior in assigned modules only after contracts are merged.
- **Verifier:** agents run focused checks, bridge smoke tests, or regression scripts while implementation workers continue non-overlapping work.

### Phase 0 Agent Packets

Run these packets in parallel for the first swarm. Each packet must produce a short final report with changed files, tests run, risks, and follow-up dependencies.

1. **Agent A: Render Model And Geometry Contracts**
   - Owns: new render-model and geometry contract files, geometry tests, pure helper tests.
   - May read: `TimelineClipCanvas.tsx`, `TimelineTrack.tsx`, `Timeline.tsx`, timeline CSS, existing canvas worker.
   - Must not edit: `TimelineClip.tsx`, playback/runtime/export files.
   - Deliverable: `TimelineRenderModel`, `TimelineGeometrySnapshot`, purity tests, and measured viewport contract.

2. **Agent B: ClipInteractionShell Contract**
   - Owns: shell prop types, shell module folder, shell parity test scaffolding.
   - May read: `TimelineClip.tsx`, `TimelineTrack.tsx`, clip subcomponents, context-menu files.
   - Must not edit: existing `TimelineClip.tsx` behavior in Phase 0.
   - Deliverable: typed shell contract, mount-state model, active module slot names, and parity matrix.

3. **Agent C: Edit Operation Contracts**
   - Owns: edit operation types/tests and transaction interfaces.
   - May read: drag, trim, fade, keyframe, marquee, keyboard, transition hooks and slices.
   - Must not edit: hook behavior in Phase 0 except test-only fixtures.
   - Deliverable: `ResolvedClipMove`, fade/keyframe/transition transaction contracts, and legacy parity checklist.

4. **Agent D: Cache Scheduler Contracts**
   - Owns: scheduler interfaces, cache lane definitions, invalidation contract tests.
   - May read: thumbnail cache, thumbnail bitmap cache, waveform/spectrogram/loudness/beat/frequency caches, audio jobs.
   - Must not edit: `TimelineClip.tsx` or `TimelineClipCanvas.tsx` cache behavior in Phase 0.
   - Deliverable: cache scheduler lane model, in-flight coalescing key contract, media deletion invalidation contract.

5. **Agent E: Runtime Policy Contracts**
   - Owns: runtime policy descriptor types, diagnostics shape, bridge-facing stats contract.
   - May read: `LayerBuilderService`, media runtime, playback loop, composition renderer, RAM preview, export preparation/seeking/building.
   - Must not edit: export/render behavior in Phase 0.
   - Deliverable: `TimelineRuntimeCoordinator` contract as policy registry and budget reporter, `RenderResourceDescriptor`, diagnostics schema.

6. **Agent F: Persistence And History Contracts**
   - Owns: project/render/history boundary docs, undo state contract tests, load-path audit notes.
   - May read: serialization, project load/save, history store, media-store project slices.
   - Must not edit: project load behavior in Phase 0 except isolated contract tests.
   - Deliverable: `HistoryTimelineEditState` contract, runtime rehydration adapter interface, legacy `projectSlice` decision record.

### Shared File Rules

- Shared contract files must be created before implementation files depend on them.
- Only one agent may own a shared contract file at a time. If another agent needs a type, they add a request to their report rather than editing the owner file.
- High-conflict files are single-owner per phase: `TimelineClip.tsx`, `TimelineTrack.tsx`, `TimelineClipCanvas.tsx`, `Timeline.tsx`, timeline hooks, timeline store slices, `LayerBuilderService.ts`, export files, serialization files, and `historyStore.ts`.
- CSS files are also single-owner per phase because visual shell changes can silently break hit testing.
- Agents must not perform broad formatting or unrelated cleanup.
- Agents must not revert changes made by other agents or by the user.

### Merge Order

1. Merge Phase 0 contracts in this order: render model/geometry, shell contract, edit operations, cache scheduler, runtime policy, history/persistence.
2. Run focused type/lint checks after contract merge.
3. Start Phase 1 only after the shell contract can compile without importing `TimelineClip.tsx`.
4. Start Phase 2 only after cache scheduler interfaces compile and cache invalidation tests exist.
5. Start Phase 3 only after edit operation contracts and geometry hit-test data are merged.
6. Start Phase 4 only after shell, cache, interaction, and bridge playback parity pass.
7. Start Phase 5 runtime/export migration only after Phase 4 proves the timeline UI no longer depends on full DOM clip bodies.
8. Start Phase 6 worker work only after main-thread render-model parity is stable.

### Swarm Acceptance Checks

Each agent packet must finish with:

- changed file list
- LOC status from `npm run swarm:status`
- behavior changed or no behavior changed
- tests/checks run
- known risks
- required follow-up owner
- files intentionally not touched

Each phase integration must run:

- targeted TypeScript or lint checks for changed files
- relevant unit tests for changed contracts/modules
- AI bridge reload/playback smoke when timeline behavior changed
- `debugExport` smoke when runtime, nested comp, or export paths changed

### Regular Status Updates

During swarm work, the lead agent posts a status update at least every 30 minutes and after every agent packet lands.

Use:

```bash
npm run swarm:status
```

For long-running local monitoring, use:

```bash
npm run swarm:status:watch -- 60
```

Each status update must include:

- current phase and active packets
- files changed since `HEAD`
- new untracked files and their LOC
- tracked LOC added/deleted/net from `git diff --numstat HEAD`
- tests or bridge checks run since the previous update
- blockers or file-ownership conflicts

The status command reports tracked LOC deltas and untracked file LOC. It is a working-tree report, not a replacement for code review or tests.

### Conflict Rules

- If two agents need the same file, pause one packet and split the work into sequential sub-packets.
- If a contract shape changes after another agent has started implementation, update the contract first and ask dependent agents to rebase their local assumptions before editing.
- If an implementation needs behavior outside its packet, record it as a follow-up instead of widening scope.
- If a verifier finds a regression, stop new dependent implementation work until the owner packet fixes or explicitly defers the regression.

## Code Analysis Findings

### Current Canvas State

- `timelineCanvasClips` is already default-on in `src/engine/featureFlags.ts`.
- `TimelineTrack` already renders `TimelineClipCanvas` as the visible clip body renderer.
- Current DOM mounting is not selected-only; it mounts hovered, dragged, multi-drag, and trimmed clips. Re-adding selected-only DOM shells would regress select-all culling.
- The main removal target is the full `TimelineClip` component mounted inside `.timeline-canvas-dom-overlay`.
- Current canvas overlay CSS only preserves top-level trim/fade handles. Keyframe ticks, audio region, spectral, video bake, stem, proxy/download/reload, transcript, analysis, and other direct `TimelineClip` children are hidden or pointer-disabled; treat those as missing canvas/shell parity.
- The current `renderClip` contract is too generic. `TimelineTrack` wraps a full `TimelineClip`; the replacement needs typed `ClipInteractionShell` props and command callbacks.
- Actual viewport measurement is needed. `TimelineTrack` currently uses `window.innerWidth` for culling/canvas width, but the track row can differ under docks, panels, and mobile layouts.
- The current worker path is not feature-ready. `WorkerPlainClip` only carries minimal clip fields and lacks hover/selection, trim/source-extension visuals, thumbnails, waveforms, spectrogram resources, in/out/reverse handling, and active preview state.

### TimelineClip Responsibility Map

- `TimelineClip.tsx` remains a large active overlay with too many passive responsibilities.
- Many passive body features still live there: download/proxy/audio-proxy/stem status, reversed/linked badges, transcript/analysis badges, reload badge, nested comp mixdown/boundaries, transcript markers, analysis overlay, and fade curve.
- `useClipContextMenu` only selects and stores `{ x, y, clipId }`; command derivation and DOM/browser/media dependencies remain inside `TimelineContextMenu`.
- Processed waveform/spectrogram warming still lives in `TimelineClip`.
- `TimelineClipCanvas` no longer owns visible thumbnail DB loading or waveform artifact reads; those moved to timeline services with in-flight coalescing. Source waveform generation still lives in the canvas path and must move behind scheduler/budget reporting before deleting full DOM clip overlays.

### Interaction Findings

- Drag has two contracts today: local `ClipDragState` and store-level `clipDragPreview` patches. Keep preview state, but move hit testing and geometry into `TimelineGeometrySnapshot`.
- Body drag still commits through legacy `moveClip`, while slip/slide use typed edit operations. `move-clips` must reach parity with legacy snapping, resistance, fallback track creation, overlap trimming, linked clips, and linked groups.
- Trim canvas geometry currently applies only to the lead trim clip. Linked/follower trim previews still depend on DOM `TimelineClip` props and must move into geometry before overlay removal.
- Fade is the outlier because dragging mutates keyframes on every mousemove and creates audio-volume effects during fade start. Add fade/keyframe operations with begin/update/commit/cancel semantics and one history batch.
- Keyframe drag and curve-editor edits need typed transactions, not direct per-mousemove store mutations.
- Marquee selection is partly data-driven, but keyframe marquee and empty-area exclusions still query DOM. Move keyframe diamonds, track lanes, and exclusion zones into geometry data.
- Keyboard edit paths still call direct mutations for delete and blend-mode cycling. Route keyboard edits through operation contracts.
- Transitions are omitted in the old plan. Add transition junction geometry plus typed transition apply/remove/update operations.
- Preserve linked behavior explicitly: Alt unlinking, selected linked pairs avoiding double movement, linked groups, and operation `includeLinked` must match preview and commit behavior.

### Runtime Findings

- `LayerBuilderService` is currently a mixed boundary: store read, media hydration, layer build, slot-layer merge, transition overlap, nested recursion, and DOM sync delegation.
- `usePlaybackLoop` is still a React hook that owns transport clock behavior, queries DOM, mutates playhead state, and seeks media elements on loop boundaries.
- Live media hydration is duplicated across primary timeline lazy media, background layers, warm slot decks, composition rendering, thumbnail/render-target generation, export, and RAM preview.
- `mediaRuntime` is the correct direction, but it is still clip/source-shaped and writes runtime IDs back onto clip sources.
- Runtime needs a renderer resource descriptor, not only decode sessions. `LayerSource` already spans video frame/provider, HTML media, image/canvas, native decoder, nested composition texture, model, gaussian splat, motion/data payload, and runtime ids.
- Export is a separate runtime policy with dedicated clip preparation, seek, layer-build, audio, and cleanup paths.
- Nested composition, thumbnail, and render-target paths prepare media outside interactive playback.
- Export layer building and clip preparation have different nested-depth behavior, which is a parity risk.
- Multilayer program output and export output are currently different contracts. Define whether export includes active slot/background layers or only the editor timeline.
- Playback diagnostics are strong but HTML-video-biased. They need provider/session health, not only `source.videoElement` health.

### Cache Findings

- Thumbnails are correctly source-level: split, trim, and reverse are render-time transforms over cached source seconds.
- Visible thumbnail cache loading is now independent from playback via `timelineThumbnailDbWarmup` and `thumbnailCacheService.loadCachedForSource`.
- Missing thumbnail generation still requires an `HTMLVideoElement` and must move to a controlled background queue.
- `thumbnailBitmapCache` now has decoded `ImageBitmap` LRU close/clear behavior plus source/URL invalidation. Event granularity and non-waveform audio artifact invalidation remain open.
- Source waveform generation is already job-coalesced. Waveform artifact reads now have in-flight coalescing through `timelineWaveformArtifactWarmup`; spectrogram, loudness, beat/onset, and frequency/phase artifact reads still need the same treatment.
- Current canvas spectral mode is stylized waveform drawing, not real spectrogram tile rendering. Do not remove DOM `ClipSpectrogram` before canvas spectrogram parity exists.
- Audio cache lanes include waveform, spectrogram, loudness, beat/onset, frequency, and phase.
- Media deletion currently removes persistent artifacts and DB thumbnail rows, but memory cache eviction and decoded bitmap cleanup need explicit APIs/coverage.

### Project/History Findings

- Project persistence mostly writes clean data through `SerializableClip`.
- Runtime fields still exist on live `TimelineClip`: `File`, media elements, WebCodecs/native decoders, canvases, and blob URLs.
- Top-level video/audio restore is now mostly metadata-only, but composition audio restore can still create `HTMLAudioElement` and regenerate mixdowns during load.
- Nested clips and post-load nested restore can still create object URLs, video/image elements, and WebCodecs players.
- Cleanup is not centrally owned for all runtime resources, especially image/model/gaussian blob URLs and nested resources.
- History snapshots currently capture runtime-bearing `TimelineClip` objects and `layers`. `deepClone()` preserves DOM elements and class instances by reference.
- Persisted history snapshots are disabled; do not enable them until history stores serializable edit state and rehydrates runtime after restore.
- Legacy `mediaStore/slices/projectSlice.ts` bypasses the unified project-file load/save contract and omits `uiState.history`; `loadState()` itself is guarded, but `projectSlice.loadProject()` still calls `clearTimeline()` outside the unified load guard. Decide whether this IndexedDB path is deleted, delegated to `loadProjectToStores()`, or kept as a compatibility importer with tests.

## Refined Workstreams

### A. Render Model And Geometry

Owner count: 1 to 2 agents.

- Add `TimelineRenderModel` for clip and track visual state.
- Add `TimelineGeometrySnapshot` for hit testing and overlay placement.
- Include track lane rects, clip body rects, trim/fade handle rects, keyframe rows/diamonds, transition junctions, marquee exclusion zones, source-extension ghosts, and drop targets.
- Use one geometry resolver for canvas, overlays, marquee, drag, trim, fade, keyframes, transitions, markers, and split targets.
- Replace `window.innerWidth` culling with measured track-row viewport geometry.
- Normalize or remove `canvasContentWidth`/`contentWidth`.
- Remove duplicated geometry from `TimelineClip`, `TimelineTrack`, and `TimelineClipCanvas`.
- Add render-model tests asserting no `File`, DOM element, store action, or cache-warming callback references.

### B. Clip Interaction Shell

Owner count: 1 agent.

- Replace `renderClip` with a typed `ClipInteractionShell` render contract.
- Build the shell behind the existing full `TimelineClip` overlay first; do not delete the fallback until parity is proven.
- Plumb `clipFade` into `TimelineTrack` shell mount rules before moving fade handles.
- Define mount rules for hover, drag, trim, fade, open menus, selected clips with visible keyframes, active audio/spectral/video/stem regions, and tool preview states.
- Move trim/fade/context/keyframe hit areas into shell modules.
- Keep only active DOM controls; canvas remains the visible body.
- Add shell parity tests for selected/open/fade/keyframe/audio/spectral/video/stem states.

### C. Specialized Active Modules

Owner count: 1 to 2 agents.

- Extract audio region editing.
- Extract spectral region editing.
- Extract video bake region editing.
- Extract stem switcher and stem job controls.
- Extract context-menu command builders from live DOM/runtime dependencies.
- Add a parity matrix for trim/fade handles, keyframe ticks, audio region selection/gain/context menu/edit stack, spectral selection/image-layer drop/toolbar, video bake controls, stem switcher, and tool pointer affordances.
- Add context-menu command-model tests without DOM/media elements.

### D. Edit Operation And Transaction Contracts

Owner count: 1 agent.

- Define `ResolvedClipMove` and convert body drag commit to typed `move-clips`.
- Match legacy `moveClip` behavior: snapping, resistance, fallback track creation, overlap trimming, linked clips, linked groups, and selected linked pairs.
- Add keyframe operation types for add/remove/move/update and curve-editor transactions.
- Add fade transactions with begin/update/commit/cancel and one history batch.
- Add transition operations for apply/remove/update plus transition junction geometry.
- Route keyboard edit paths through operation contracts, including keyframe delete, clip delete, and blend-mode cycling.
- Keep preview and commit contracts aligned so undo/redo sees the final resolved operation, not many transient pointer updates.

### E. Cache Warm Scheduler

Owner count: 1 agent.

- Add timeline-level visible cache scheduler.
- Move all visible-range cache warming out of components.
- Scheduler lanes:
  - thumbnail DB load
  - thumbnail generation
  - thumbnail bitmap decode
  - waveform artifact load
  - source waveform generation
  - processed waveform derivation
  - spectrogram tile artifact load/generation
  - loudness envelope artifact load/generation
  - beat/onset artifact load/generation
  - frequency/phase artifact load/generation
- Add in-flight load maps for artifact reads by source/ref id.
- Keep source waveform generation coalescing and integrate it into scheduler budget reporting.
- Define media deletion/source replacement invalidation:
  - abort queued thumbnail generation for deleted sources
  - clear source thumbnail DB rows and `thumbnailCacheService` memory entries
  - close decoded entries in `thumbnailBitmapCache`
  - evict waveform, spectrogram, loudness, beat/onset, and frequency/phase memory entries by source/processed ref id
  - cancel queued `ClipAudioAnalysisJobService` work for deleted clips
  - preserve shared file-hash/project-path artifacts when another media file still references them

### F. Runtime Coordinator

Owner count: 1 to 2 agents.

- Introduce `TimelineRuntimeCoordinator` first as a policy registry and budget reporter, not an immediate allocator replacement.
- Policies: `interactive`, `background`, `slot-deck`, `composition-render`, `thumbnail`, `render-target`, `ram-preview`, and `export`.
- Add `RenderResourceDescriptor` parity with `LayerSource`: video frame/provider, HTML media, image/canvas, native decoder, nested composition texture, model, gaussian splat, motion/data payload, audio source/clock, runtime id, diagnostics, and memory cost.
- Migrate primary lazy media first, then background/slot decks, then composition-render/thumbnail/render-target paths. Export adapter comes last.
- Keep AI bridge playback diagnostics as a first-class contract.
- Add provider/session health diagnostics, not only HTML media element diagnostics.

### G. Serializable State And History

Owner count: 1 agent.

- Define separate contracts for project persistence (`CompositionTimelineData`), canvas render state (`TimelineRenderModel`), and undo state (`HistoryTimelineEditState`).
- Make persisted/edit state explicitly serializable.
- Move runtime state behind registry keys.
- Migrate history apply/restore so undo/redo rehydrates runtime through the runtime coordinator instead of directly restoring runtime-bearing `TimelineClip.source` objects.
- Make all project load/reload paths data-only for video/audio where possible.
- Audit all load paths: `projectLoad.ts`, `serializationUtils.loadState()`, project-load background nested restore, `mediaStore/init.ts`, and legacy `projectSlice.ts`.
- Centralize runtime cleanup for blob URLs, media elements, vector canvases, model/gaussian URLs, WebCodecs/native decoders, composition renderers, and nested resources.

### H. Dead Code And Legacy Route Retirement

Owner count: 1 agent for audits, then single-owner implementation slices.

- Track dead code and legacy route removal as an explicit workstream, not a cleanup afterthought.
- Delete or delegate obsolete code only after the replacement path has parity tests or a bridge smoke for the affected behavior.
- Current retirement candidates:
  - Full `TimelineClip` mounting inside `.timeline-canvas-dom-overlay` once shell modules cover active controls.
    - Done for trim-only, context-menu-only, and drag/multi-drag-only shells; fade/keyframe/audio/spectral/video-bake/stem/hover still need shell parity before deletion.
  - CSS hiding hacks under `.timeline-canvas-dom-overlay` after the full overlay is removed.
  - Cache-warmup `useEffect` blocks in `TimelineClip.tsx` after timeline services own thumbnail, waveform, spectrogram, and analysis artifact warmup.
  - Generic `renderClip` callback in `TimelineTrack` after `ClipInteractionShell` owns active controls.
  - Direct timeline-load thumbnail generation through `restoreSourceThumbnails()`/`thumbnailCacheService.generateForSource()` once cache scheduler ownership is proven for visible demand and import/manual regenerate paths are explicitly separated.
    - Done for `serializationUtils.restoreSourceThumbnails()`: it now uses `thumbnailCacheService.loadCachedForSource()` only.
    - Done for silent project-load auto-relink: `fileManageSlice.updateTimelineClips()` and `relinkMedia.applyRelinkMatch()` now accept `generateThumbnails`, and `projectLoad.ts` passes `false` for both project-folder matches and the stored-handle fallback. Manual reload/relink paths keep the default `true`.
  - Legacy `mediaStore/slices/projectSlice.ts` load path: read-only audit found `projectSlice.loadProject(projectId)` has no app call sites and should be retired instead of extended.
    - Done: removed unused `saveProject`, `loadProject`, `getProjectList`, and `deleteProject` actions from `projectSlice.ts`; current save/load flows remain in `ProjectFileService`.
    - Done: extracted the remaining `initFromDB()` body to `mediaStore/legacyStartupRestore.ts`; `projectSlice.ts` keeps only the compatibility action that delegates to the helper.
  - History snapshots that keep runtime-bearing `TimelineClip.source` objects after `HistoryTimelineEditState` restore is implemented.
- Keep compatibility shims only when a concrete persisted project or manual workflow still needs them; otherwise remove the old path in the same phase that proves the replacement.

## Implementation Phases

### Phase 0: Contracts And Diagnostics First

- Land `TimelineRenderModel` and `TimelineGeometrySnapshot` interfaces.
- Define persistence boundary: project data vs render data vs undo data.
- Define `ClipInteractionShell` props, mount rules, command callbacks, and active module slots.
- Define edit operation contracts for move, trim preview followers, fade, keyframes, transitions, keyboard edits, and history batching.
- Define cache scheduler lanes and invalidation.
- Define runtime coordinator policies and resource descriptor shape.
- Add or expose timeline-canvas diagnostics: visible clip count, drawn clip count, thumbnail draw count, waveform draw count, DOM overlay count, DOM clip body count, cache scheduler counts, and live runtime resource counts.
- Add focused tests for model generation, geometry generation, and render-model purity.

### Phase 1: Build ClipInteractionShell Behind Existing Overlay

- Implement `ClipInteractionShell` while keeping full `TimelineClip` fallback available.
- Replace generic `renderClip` usage with typed shell props for new paths.
- Plumb `clipFade` into `TimelineTrack`.
- Mount shell for hover, drag, trim, fade, open menus, focused keyframes, audio/spectral/video/stem states, and tool previews.
- Move only proven active controls out of `TimelineClip`.
- Keep old `TimelineClip` overlay until shell parity tests pass.

### Phase 2: Cache And Specialized Module Extraction

- Move processed waveform and spectrogram warming out of `TimelineClip`.
  - Done for processed-waveform derivation and spectrogram tile generation via `timelineAudioArtifactGenerationWarmup`; both block during playback/drag preview and coalesce request keys.
- Move source waveform generation and thumbnail visible loads out of `TimelineClipCanvas`.
  - Done for visible thumbnail DB loads.
  - Done for source waveform generation demand via `timelineSourceWaveformWarmup`; it blocks generation during playback or drag preview and coalesces canvas/legacy-overlay requests.
  - Done for visible missing-thumbnail generation via `timelineThumbnailGenerationWarmup`; it uses existing source video elements, skips ready/generating sources, blocks during playback/drag preview, and coalesces by media id/file hash.
- Add cache scheduler and in-flight artifact load coalescing.
  - Done for visible thumbnail DB loads and waveform artifact reads.
  - Done for decoded thumbnail bitmap invalidation.
  - Pending for event-granular thumbnail notifications and non-waveform audio artifact reads.
- Add canvas renderer contract for real spectrogram tile summaries before removing DOM `ClipSpectrogram`.
- Extract audio, spectral, video-bake, and stem modules.
- Make source replacement and media deletion evict persistent, memory, and decoded bitmap caches.

### Phase 3: Interaction Operations And Geometry Parity

- Convert body drag commit to typed `move-clips`.
- Add `ResolvedClipMove` parity tests against legacy behavior.
- Add linked/follower trim preview geometry.
- Add fade and keyframe preview/transaction contracts.
- Move keyframe marquee and empty-area exclusions to geometry data.
- Route keyboard edit paths through operation contracts.
- Add transition junction geometry and typed transition operations.
- Confirm linked clip and linked group parity.

### Phase 4: Remove The Full TimelineClip Overlay

- Gate deletion on shell parity, cache parity, interaction parity, and bridge playback smoke.
- Delete full `TimelineClip` mounting from `.timeline-canvas-dom-overlay`.
- Delete CSS hiding hacks only after replacement controls are active.
- Keep `TimelineClip` subcomponents only where they have been reassigned as shared renderer utilities or active shell modules.
- Verify select-all and large-project culling do not mount selected-only DOM clip bodies.

### Phase 5: Runtime And Persistence Boundary

- Introduce runtime coordinator policy registry and budget reporting.
- Migrate primary lazy media into the coordinator.
- Migrate background/slot deck hydration.
- Migrate composition-render, thumbnail, render-target, and RAM preview policies.
- Add export adapter last, with nested composition and active slot/background decisions settled.
- Make nested comp restore/reload data-only where possible.
- Move history snapshots toward `HistoryTimelineEditState`.
- Retire legacy `projectSlice.ts` or delegate it to the unified project-load contract with tests.

### Phase 6: Worker And Large-Project Hardening

- Redesign OffscreenCanvas worker API only after main-thread render-model parity.
- Worker message must carry resolved geometry plus transferable/prepared thumbnail, waveform, and spectrogram resources.
- Support hover/selection/trim/source-extension visuals before enabling `timelineCanvasWorker` by default.
- Add large-project diagnostics and perf budgets.
- Add regression tests or debug scripts for reload, scroll, zoom, select-all, marquee, and playback.

## Verification Requirements

Every implementation batch must be checked with targeted tests plus real browser behavior:

- idle reload stats through the AI bridge
- real playback simulation through the AI bridge after timeline changes
- timeline thumbnail visibility after reload before playback
- scroll/zoom/select-all smoke on a large project
- targeted TypeScript/lint checks for touched files

Required new or expanded checks:

- Unit tests: `serialization.test.ts`, `projectMediaPersistence.test.ts`, `projectTimelineSaveGuard.test.ts`, `historyStore.test.ts`, `TimelineTrack.test.tsx`, plus new tests for nested comp `loadState()` runtime deferral and legacy `projectSlice` compatibility/delegation.
- Shell parity tests for selected/open/fade/keyframe/audio/spectral/video/stem states.
- Context-menu command-model tests without DOM/media elements.
- Render-model tests asserting no `File`, DOM element, store action, media element, object URL, or cache-warming callback references.
- Reload-before-playback hydrates visible thumbnail DB entries without creating video elements.
- Multiple visible clips sharing the same audio artifact ref perform one in-flight artifact read.
- Deleting media evicts thumbnail source memory, decoded bitmap memory, and all audio analysis memory caches.
- Spectral display parity is tested before removing the DOM `ClipSpectrogram` overlay.
- Fast and precise `debugExport` with two-level nested comps, same-track transitions, masks inside nested comps, and active slot/background layers.
- Preview/export frame comparison for multilayer program output.
- RAM preview smoke for video and nested comp clips.
- AI bridge smoke tools: `reloadApp`, `getStatsHistory`, `getStats`, `getPlaybackTrace`, `simulateScrub`, `simulatePlayback`, `simulatePlaybackPath`, and `debugExport`.

Before normal commit or merge, use the repo-required full chain:

```bash
npm run build
npm run lint
npm run test
```

## Remaining Decisions

- Exact `TimelineRenderModel`, `TimelineGeometrySnapshot`, `ClipInteractionShell`, `ResolvedClipMove`, `HistoryTimelineEditState`, and `RenderResourceDescriptor` TypeScript shapes.
- Whether track grid/background state remains DOM/CSS or moves to a separate background canvas.
- Whether active overlays are one shell with feature modules or separate shells per tool mode.
- Whether export renders the editor timeline only, or the current program output including active slot/background layers.
- How much of `TimelineRuntimeCoordinator` can be introduced before export and nested composition migration.
- Whether legacy `projectSlice.ts` is deleted outright, delegated to `projectLoad.ts`, or kept as a compatibility importer.
- Whether DOM `ClipSpectrogram` is replaced by true canvas spectrogram tiles or remains an active specialized module longer.

## Initial Decision

A full refactor is worthwhile. The current hybrid architecture is a useful stepping stone, but the maintainable target is a source-cache-backed canvas timeline with active DOM shells, typed edit operations, explicit cache scheduling, and strict runtime policies.
