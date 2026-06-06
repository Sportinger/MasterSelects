# Timeline Canvas Refactor Handoff

Read this before starting a new agent/session. The full plan remains
`docs/plans/timeline-canvas-refactor-plan.md`; this file is the current
working snapshot so agents do not rediscover completed work.

Issue/branch: issue #228 on `issue-228-timeline-canvas-rendering`.

## Start Here Before Spawning Agents

- The current committed branch tip is `ace78705` (`Harden timeline menu guards
  and image reloads`), matching `origin/issue-228-timeline-canvas-rendering`.
- The current working tree has the post-`ace78705` runtime-admission slice in
  progress: `19` tracked changed files, `2` new untracked files, tracked
  `+823/-103` net `+720` LOC plus `+86` new-file LOC from
  `npm run swarm:status` at `2026-06-06T11:49:21Z`.
- Fresh checkouts of this branch at `ace78705` already include the committed
  canvas refactor and deleted DOM clip body. New workdirs can be created from the
  branch; continue to avoid reverting unrelated local work if a future tree
  becomes dirty.
- The old DOM clip body retirement is committed at `0f202a6b`;
  `src/components/timeline/TimelineClip.tsx` is absent at `HEAD`.
- Full gates passed for the content committed as `ace78705`: `npm run build`,
  `npm run lint`, and `npm run test` (`363` test files / `3869` tests). Rerun
  the relevant targeted checks after the current uncommitted slice and rerun
  final full gates before merge/release readiness or another normal push.
- `src/components/timeline/Timeline.tsx` intentionally still imports
  `TimelineClip.css`. The CSS file is now shell/overlay styling, not proof that
  `TimelineClip.tsx` should be restored.

## Current Status

- Approximate plan progress has two numbers:
  - implementation breadth: about 98%, because most planned modules, tests,
    shell/canvas work, diagnostics, cache boundaries, restore delegation, and
    worker contract cleanup exist now. Fade transaction execution and
    `useClipFade` migration are done, and selected clip-bar keyframe tick drag
    plus curve-editor keyframe/Bezier drags now route through typed keyframe
    transactions. Mask/Text path-keyframe compatibility APIs now route path
    writes and removals through the keyframe transaction kernel. Vector
    user-action data-only handling is now in place for direct add, paste, and
    relink/reload.
  - effective completion / risk-weighted status: about 95%, because export
    runtime-binding/provider/parallel-decoder admission, RAM-preview video
    provider admission, interactive scrub WebCodecs provider admission, legacy
    WebCodecs helper provider admission, split media-runtime data-only cleanup,
    FFmpeg frame-renderer export-prep run-id forwarding, audio bake/unbake
    data-only source handling, stem source-switch data-only handling,
    Vector runtime canvas admission, video-bake proxy admission, legacy JPEG
    proxy-frame cache admission, decoded AudioBuffer cache admission, proxy
    VideoFrame cache admission, background/slot/composition video/audio
    admission, the real-media worker-positive verification hook, large local-file
    import fallback, NativeHelper placement primary URL ownership,
    composition-audio null-mixdown generating-state cleanup, owner-scoped
    composition mixdown blob URLs, content-hash mixdown invalidation, one real
    3-video worker-positive smoke, historical live-project worker-positive proof
    on `Random 100 Video Clips`, historical nonblank export/preview parity proof,
    and the
    focused runner 720/8 synthetic worker proof are now implemented/proven. AI
    node runtime canvas admission plus clip/global lifecycle cleanup, shared
    deleted-clip runtime cleanup, active audio-proxy/stem-preview element
    admission, stale-target no-legacy-fallback parity for keyframe tick and
    curve-editor drags, smoke-run persistence guards, and the playback playhead
    visual backtrack fix are also now covered. The remaining open work is
    side-effecting context-menu handler cleanup/final parity sweep, default-on
    worker decision work, torture-media coverage, and final broad verification.
- Use about 95% when asked "how far are we in the plan?" Keep the separate
  implementation-breadth number at about 98%. Do not raise the risk-weighted
  number above 95% until live/default-on worker proof, final visual/parity
  evidence, and final broad gates are done.
- Latest post-push slice after `0f202a6b`: clip/empty context menu no-op paths
  no longer close or execute when stale/disabled, and media relink/reload for
  image clips now writes data-only `source.imageUrl` instead of allocating
  `new Image()` or storing `source.imageElement`. Focused checks passed:
  `npm run test -- tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/TimelineContextMenu.test.tsx tests/unit/TimelineEmptyContextMenu.test.tsx tests/unit/clipContextMenu.test.ts tests/unit/timelineEmptyContextMenu.test.ts tests/unit/trackContextMenu.test.ts tests/unit/TrackContextMenu.test.tsx`
  (`164` tests), touched-file ESLint, and
  `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Current uncommitted runtime-admission slice after `ace78705`: composition
  mixdown playback `HTMLAudioElement`s are admitted/reported before allocation,
  completed mixdown `AudioBuffer` cache entries are retained/released through
  the runtime coordinator, nested content-hash refresh/deleted clip/media-delete
  cleanup release composition mixdown runtime, thumbnail generation video/canvas
  admission now happens before DOM allocation, and thumbnail bitmap decode job
  plus bitmap admission now happen before `fetch`/`createImageBitmap`.
  `ScrubbingCache` background preload videos are now background-policy admitted
  before hidden video creation, released on source/session clear, and
  `CacheManager.handleDeviceLost()` destroys the whole cache instead of dropping
  it after only composite-resource release. Composition mixdown runtime release
  now lives in store-cycle-safe resource helpers, while the timeline store
  mutation helper is isolated from the cache/mixer path. Focused checks passed:
  `npm run test -- tests/unit/compositionAudioMixdownCache.test.ts tests/unit/audioScrubSync.test.ts tests/unit/compositionAudioMixer.test.ts tests/stores/mediaStore/fileManageSlice.test.ts`
  (`147` tests), `npm run test -- tests/unit/thumbnailCacheService.test.ts tests/unit/thumbnailBitmapCache.test.ts`
  (`24` tests), `npm run test -- tests/unit/scrubbingCache.test.ts tests/unit/cacheManagerRuntimeReporting.test.ts`
  (`14` tests), `npm run test -- tests/stores/timeline/clipSlice.test.ts`
  (`139` tests), touched-file ESLint, and
  `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Remaining agent-confirmed runtime/menu work after this slice: export/audio-only
  composition mixdown admission before timeline mutation, thumbnail blob URL
  reporting and legacy media thumbnail helpers, pending background/slot
  hidden-video disposer cleanup, and full context-menu pure command descriptors
  plus parity tests.
- The old DOM `TimelineClip.tsx` body has been deleted.
- Timeline clip rendering is canvas-first, with forced-worker synthetic/fallback
  smokes in place. Focused live real-media worker-positive smokes have passed on
  the restored 3-video fixture path and historically on the user's
  `Random 100 Video Clips` comp before it was later observed empty. A focused
  runner proof now passes the 720/8 forced-worker synthetic path, but the
  default-on decision is still pending.
- `timelineCanvasWorker` is still product-default `false`; worker mode is proved
  by forced smokes, not shipped as the normal user path. Default-on should wait
  for `workerPositiveLive` to pass in `scripts/run-timeline-canvas-verification.mjs`.
- The observed 40% project-load pause appears resolved from the user's latest
  experience after restore-boundary work. It is still not fully proven for every
  media type until fresh live reload smokes cover the 40%-to-58% window on the
  fixed comp and image/model/gaussian projects.
- Fresh browser/AI-bridge smokes now include the user's restored project. The
  previous empty-tab proof is superseded for live-media decisions by historical
  `2026-06-06 08:45 UTC` live proof: restricted runner report
  `fixtures/timeline-canvas-reports/run-20260606-084514Z/report.json` passed
  reload/live verification with first stats in `2921ms`, ready in `4181ms`,
  live `384` video clips, scrub/playback/path success, and zero verification
  failures. Direct `Random 100 Video Clips` worker-positive proof passed with
  `781` clips, `3` media sources, `222` thumbnail URLs requested, `31` warmed
  thumbnail bitmaps, `workerTrackCount=1`, `workerEligibleTrackCount=1`, two
  whitelisted `audio-resource-visuals` fallback tracks, no pending/error worker
  tracks, `9728000` worker bytes, and `60fps` with zero slow/dropped frame
  estimates. Direct live export/preview parity passed with a nonblank FAST
  export (`298942` bytes, `6` preview samples, reference/candidate
  `nonBlankRatio=1`, no parity failures). These `Random 100 Video Clips`
  results are historical evidence only because that composition was later
  observed empty after the smoke/open cycle. Current live verification should
  use `Subcomposition 1` (`1780705391680-ecu7panot`), and `Random 100 Video
  Clips` should only be used after explicit rebuild/restore.
- Latest cleanup/parity checkpoint at `2026-06-06 09:05 UTC`: shared deleted
  clip resource cleanup now lives in `src/stores/timeline/deletedClipResources.ts`
  and is used by manual clip removal plus edit-kernel deletes. Focused Phase 3
  stale-target parity now covers selected clip-bar keyframe tick drags and
  expanded curve-editor keyframe drags: stale typed targets clear the active
  transaction session and do not fall back to legacy move callbacks. Focused
  checks passed: `npm run test -- tests/unit/TimelineTrack.test.tsx tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/aiNodeRuntime.test.ts`
  (233 tests), touched-file ESLint for the cleanup/parity slice, and
  `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest smoke persistence/playhead checkpoint at `2026-06-06 09:40 UTC`:
  synthetic timeline smokes now guard both media-store autosave and project
  continuous-save/beforeunload paths, so temporary smoke media/timelines should
  not persist into the user's Media Panel or active composition. The playhead
  visual flicker/backtrack is fixed in `Timeline.tsx` by RAF-updating the live
  playhead position from the internal playback clock and clamping tiny forward
  playback DOM regressions. Focused browser proof passed:
  `runTimelineCanvasPlayheadSmoothnessSmoke` returned `backtrackCount=0`,
  `maxBacktrackPx=0`, `forwardDistancePx=114.88`, and restored the live comp to
  `781` clips / `3` tracks. Post-smoke bridge state showed the live project
  still at `781` clips, `0` active Smoke tracks, `3` real video media files,
  and `0` `Timeline Thumbnail Reload Smoke`/Relink artifacts. Focused checks
  passed: `npm run test -- tests/unit/timelineCanvasSmokeHandlers.test.ts tests/unit/clipContextMenu.test.ts`
  (22 tests), touched-file ESLint for the smoke/playhead/context-menu slice, and
  `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest smoke restore regression checkpoint at `2026-06-06 09:50 UTC`: the
  user-visible "Smoke tests do not work" state was traced to synthetic
  `runTimelineCanvasPlayheadSmoothnessSmoke` calls that did not restore unless
  `restoreTimelineAfterRun:true` was passed. Synthetic playhead smokes now
  restore by default unless `createSynthetic:false` or
  `restoreTimelineAfterRun:false` is explicit. Focused live proof passed:
  playhead smoke restored to `781` clips / `3` tracks with `backtracks=0`,
  followed by a four-smoke bridge group (`large`, `marquee`, `blade`,
  `playhead`) that all returned `success=true` and restored to the same
  `781`-clip live shape. Current safe live test surface is `Subcomposition 1`
  (`1780705391680-ecu7panot`), which has `781` clips, `426.18s`,
  `Video 1:300`, `Audio 1:381`, and `Audio 2:100`.
- Do not spend a new session re-auditing whether video/audio restore creates elements: top-level video/audio, direct nested video, sub-nested video, and composition-audio restore are already data-only.
- Latest duplicate-code audit answer from read-only agents plus local `rg`/diff
  checks: there is no second active full DOM timeline clip renderer, and deleted
  legacy DOM clip files should stay deleted. The old large nested-restore
  duplication is now mostly retired: `loadState()`, AddComp, nested refresh, and
  project-load post-relink reload all route nested tree construction, segment
  scheduling, recursive keyframe collection, keyframe merge/session guards, and
  runtime-ready/relink policy through `nestedCompositionLoader.ts` /
  `nestedRestore.ts`. Top-level restore source
  construction and image/vector/spatial runtime dispatch in
  `serializationUtils.ts` have been narrowed into helpers. Restore-time vector
  preparation now lives in `vectorRuntimeRestore.ts`. NativeHelper-recovered
  image files now use media-scoped primary URL ownership, native video/audio
  restore does not dereference full files during load, and top-level image
  restore no longer trusts stale/unmanaged blob URLs when a browser file is
  available. Cached media thumbnail blobs restored from project load, legacy
  startup, and `ensureFileThumbnail()` now use media-owned thumbnail URL keys.
  Top-level `loadState()` image restore is now data-only instead of eager
  `new Image()` restore, while preserving managed image URL ownership through
  `source.imageUrl`. Export now prepares data-only image clips into
  `ExportClipState.exportImageElement` and cleans up export-owned image blob
  URLs. Interactive preview has a first lazy image runtime fallback:
  data-only image clips can render through `lazyImageElements.ts` and
  `LayerBuilderService` without mutating `clip.source`, and image load/error
  wakes the render loop. RAM preview, composition render, background layer,
  warm slot-deck, and `useLayerSync` overlay paths now handle data-only image
  clips or shared cancellable image hydration without mutating persisted clip
  source state. Nested image restore is also data-only now: direct nested and
  sub-nested image clips restore with managed `source.imageUrl` metadata and
  immediate runtime-ready notifications instead of eager `Image` allocation.
  Direct add-image and image clipboard paste now also write data-only
  `source.imageUrl` state. Remaining runtime-boundary work is policy-level:
  thumbnail DB-load job, generation job, detached video/canvas resource,
  decoded bitmap admission gates, RAM-preview video/provider gates, interactive
  scrub WebCodecs provider gates, legacy WebCodecs helper provider gates, export
  provider/decoder gates, FFmpeg frame-renderer export-prep run-id forwarding,
  split media-runtime data-only cleanup, stem source-switch data-only cleanup,
  Vector runtime canvas admission, video-bake proxy admission, legacy JPEG
  proxy-frame cache admission, decoded AudioBuffer cache admission, proxy
  VideoFrame cache admission, and background/slot/composition video/audio gates
  exist, but broader
  allocator/admission ownership still
  needs remaining stray runtime boundaries plus final live export/playback
  parity verification.
  Composition-audio is lazy through the first playback/export contract now:
  AddComp and split keep placeholders data-only, playback requests and attaches
  an audio element only when active, and export requests a mixdown buffer instead
  of falling through to the empty placeholder file.
  Direct browser video/audio add now also keeps timeline clip sources data-only:
  temporary metadata elements are released after probing, linked audio writes no
  stored `HTMLAudioElement`, and the old import-frame pre-cache helper was
  deleted. Timeline video/audio paste now follows the same rule: pasted clips
  regain their `File`, duration, and `mediaFileId`, but no paste-time
  `HTMLVideoElement`, `HTMLAudioElement`, WebCodecs player, or video/audio blob
  URL is written into clip state. Media relink/reload now follows the same
  video/audio rule in `updateTimelineClips(...)`: reloaded clips get a
  data-only source plus the replacement `File`, loading flags are cleared
  immediately, and thumbnail regeneration uses the media-owned source URL
  instead of a reload-time clip video element. YouTube/download completion is
  also data-only for video/audio now: it reuses import metadata for duration
  when available, does not create clip-owned media elements or WebCodecs
  players, creates linked audio as plain metadata, and warms thumbnails from the
  media-owned source URL. The first 3D user-action ownership cleanup is done:
  model/gaussian direct add fallbacks, model paste, media relink/reload for
  model/gaussian/avatar, and NativeHelper-backed external timeline drop now
  prefer media-owned URLs before any clip-scoped fallback. Vector user-action
  hydration is now data-only: direct Lottie/Rive add, vector paste, and
  media relink/reload keep file and source metadata in clip state without
  storing runtime canvases, while preview/export resolve vector canvases from
  `vectorAnimationRuntimeManager.renderClipAtTime(...)`.
  Audio edit bake/unbake now follows the same source-state rule: baked and
  restored audio clips keep `File`, `mediaFileId`, duration, analysis refs, and
  source metadata, but do not store `HTMLAudioElement` in clip state.

## Live Code Map

- Canvas entry point: `src/components/timeline/TimelineClipCanvas.tsx`.
- Worker path: `src/components/timeline/workers/timelineClipCanvas.worker.ts`,
  `src/components/timeline/utils/timelineClipCanvasWorkerModel.ts`, and the
  shared wire contract in
  `src/components/timeline/utils/timelineClipCanvasWorkerContract.ts`.
- Active shell path: `src/components/timeline/interactionShell/`.
- Render model path: `src/components/timeline/renderModel/`.
- Runtime/reporting path: `src/services/timeline/*RuntimeReporting.ts`,
  `timelineRuntimeCoordinator.ts`, and `runtimeResourceReporting.ts`.
- Restore runtime helpers: `src/stores/timeline/nestedRestore.ts`,
  `src/stores/timeline/vectorRuntimeRestore.ts`, and
  `src/stores/timeline/nestedCompositionLoader.ts`.
- Worker default-on flag: `src/engine/featureFlags.ts`.
- Image data-only/runtime hydration path: `lazyImageElements.ts`,
  `imageRuntimeHydrator.ts`, `addImageClip.ts`, `clipboardSlice.ts`,
  `ClipPreparation.ts`, and `ExportLayerBuilder.ts`.

## 2026-06-05 Agent Audit Blockers

- Phase 3: transition preview/drop-clear is now executable in the store and
  wired from `useTransitionDrop`. Generic Keyframe transaction begin/update/
  commit/cancel operations are executable in `applyTimelineEditOperation()` for
  numeric create/move/update/remove/easing/bezier/rotation/selection paths.
  Fade transaction update/commit/cancel now materializes/removes fade keyframes,
  preserves existing curve handles, opens one undo batch across live updates,
  and `useClipFade` now dispatches typed fade transactions instead of direct
  `addKeyframe`/`moveKeyframe`/`removeKeyframe` calls. Selected clip-bar
  keyframe tick drag now emits begin/update/commit from the interaction shell
  and `TimelineTrack` routes it through `keyframe-transaction-*` with a deferred
  live-update history batch. Expanded curve-editor keyframe drags now route
  move+value changes through typed keyframe transactions, and Bezier handle drags
  route through typed handle transactions. Path-value keyframe create/update is
  executable in the operation kernel. Mask/Text path-keyframe UI routing already
  goes through the transaction kernel; remaining Phase 3 risk is finishing
  explicit shell/canvas parity coverage.
- Phase 5: `TimelineRuntimeCoordinator` reports policy/resource/budget state,
  and now owns first admission decisions for thumbnails, primary lazy
  video/audio, interactive lazy images, and shared image hydrator callers for
  composition/background/slot paths, but it does not fully own all
  allocation/admission yet. Allocation still happens in RAM preview, export
  prep, and audio sync paths. File-backed lazy
  video/audio element object URLs are now manager-owned and revoked through
  `mediaObjectUrlManager`; AddComp now creates
  linked composition-audio clips as data-only placeholders and split operations
  no longer clone video, audio, WebCodecs, native-decoder, or composition-audio
  runtime elements. Playback/export
  mixdown-on-demand is implemented for active playback and audio export through
  the shared composition mixdown cache. Direct browser video/audio add,
  timeline video/audio paste, media relink/reload video/audio clips, and
  download completion video/audio clips are data-only now. 3D URL ownership for
  user-action paths now prefers media-owned URLs. Vector user-action data-only
  hydration is done for direct add, paste, and relink/reload. Allocator
  admission gates now exist for thumbnail DB-load jobs, thumbnail generation
  jobs, detached generation video/canvas resources, decoded thumbnail bitmaps,
  primary lazy video/audio elements, interactive lazy image elements, shared
  image hydrator resources for composition render, background layers, and warm
  slot decks, interactive scrub WebCodecs providers, legacy WebCodecs helper
  providers, Vector runtime canvases, AI node runtime canvases, active audio
  proxy/stem-preview elements, video-bake proxy videos, legacy JPEG
  proxy-frame cache resources, decoded AudioBuffer cache resources, proxy
  VideoFrame cache resources, background/slot/composition video/audio runtime resources, RAM
  preview run-job/image/video-provider/CPU-cache/GPU-cache resources, and export
  run/output/preview/image/precise-video/audio/runtime-binding/
  WebCodecs-provider/parallel-decoder resources. FFmpeg frame rendering now
  forwards its runtime run id into clip preparation, so the existing export
  admission gates apply to that renderer path too. Remaining high-risk Phase 5
  work is final live export/playback parity, default-on decision proof, and
  final broad gates.
  Fresh read-only runtime audit found the main remaining stray caller groups:
  `AudioTrackSyncManager.ts` active playback/stem preview elements/object URLs
  and `nodeGraph/aiNodeRuntime.ts` module-level runtime canvases; both groups
  now have focused admission/reporting/cleanup coverage.
  The `spectrogramCanvas.ts` raster-canvas cache is now admitted/reported through
  the interactive runtime coordinator and releases resources on replacement,
  eviction, clear, or admission denial. `proxyFrameCache.ts` audio-proxy
  `new Audio()` object URLs are also now admitted/reported as interactive
  `html-media:audio` resources and revoke owned URLs on denial. The
  `AudioTrackSyncManager.ts` stem-layer `AudioBuffer` cache is now
  admitted/reported through the interactive runtime coordinator and releases
  resources on LRU eviction or cache clear. `AudioTrackSyncManager.ts` also now
  gates/reports cloned active audio-proxy elements and stem-preview
  `HTMLAudioElement`s as interactive `html-media:audio` resources, releases
  them when proxy/stem entries are removed, and denies stem buffer preview
  before creating WAV blob URLs or audio elements when the policy is full.
  `nodeGraph/aiNodeRuntime.ts` now
  admits retained source/output runtime canvases before allocation, reports
  them as interactive `image-canvas` resources, rechecks admission on cache
  dimension changes, bounds cache retention by entry count and heap bytes,
  releases entries when AI nodes are removed or sources disappear, and exposes
  `clearAINodeRuntimeCache()` for lifecycle/test cleanup. The
  `timelinePlacementCommands.ts` NativeHelper blob URL write into
  `mediaStore.files[].url` has been fixed to use media-owned primary URL
  ownership. Lower-risk cleanup candidates are
  `audioRoutingManager.ts` reverb impulse buffers and `multicamAnalyzer.ts`
  metadata-load cleanup-on-failure.
  `compositionAudioMixdownCache.ts` completed mixdown retention is now bounded
  by a small LRU cap instead of growing for every nested content hash; broader
  composition-mixdown URL ownership is now clip-scoped through
  `blobUrlManager`, and content-hash refresh clears stale mixdown runtime before
  playback can reuse it.
  Latest low-risk audio follow-up: `AudioTrackSyncManager.ts` now clears
  `mixdownGenerating` when lazy composition-audio mixdown returns `null`, so a
  failed/missing composition mixdown no longer leaves the canvas badge/state
  stuck indefinitely.
- Phase 6: worker protocol/resources/diagnostics exist and forced-worker
  synthetic smokes now pass on the current working tree, but
  `timelineCanvasWorker` remains default `false`. A real-media
  `workerPositiveLive` runner step now opens the configured worker-positive target, warms cached
  thumbnail bitmaps, and requires at least one worker track with no
  fallback/pending/error tracks. A focused browser bridge proof passed on
  `WorkerPositive 3 Restored Videos 53 Segments 20260606`
  (`1780725925034-snfho0roz`) with 3 worker tracks, 3 eligible tracks, zero
  fallback/pending/error tracks, `workerResourceBytes=9584552`, warmed bitmaps
  `31/99`, estimated `60fps`, and zero slow/dropped frame estimates. The focused
  runner proof `fixtures/timeline-canvas-reports/run-20260606-070042Z/report.json`
  also passed the worker prewarm, `720` clip / `8` track forced-worker synthetic
  proof, and worker-thumbnail synthetic proof with no verification failures.
  Default-on still needs full live `workerPositiveLive`, visual parity/torture
  coverage, and final broad gates.
- Handoff/plan status should reflect these blockers. Do not let a new agent
  treat historical full checks or the deleted DOM body as final readiness.

## Fixed Live Test Target

- Current active live test target after the smoke-restore regression check:
  `Subcomposition 1`
- Current active live composition id: `1780705391680-ecu7panot`
- Expected active live shape: 781 clips total, 426.18s, `Video 1:300`,
  `Audio 1:381`, and `Audio 2:100`, sourced from the three real MP4s in the
  Media Panel.
- Note: `Random 100 Video Clips` (`1780703769030-jqptxgu3c`) was observed
  empty after the bad no-arg playhead smoke/open cycle. Do not use it as the
  current live verification target unless it is rebuilt or explicitly restored.
- Current focused worker-positive target: `WorkerPositive 3 Restored Videos 53
  Segments 20260606`
- Current focused composition id: `1780725925034-snfho0roz`
- Expected focused shape: 106 clips total, 53 video plus 53 linked audio, sourced
  from the three restored real MP4s in the Media Panel.
- Latest focused proof: `runTimelineCanvasLargeProjectSmoke` with
  `forceTimelineCanvasWorker:true`, `warmWorkerThumbnails:true`, relaxed
  frame-loop budgets, and no worker fallback/pending/error tracks.
- Historical 2026-06-04 fixed comp: `Random 3 Videos - 50 Cuts Test 164025`
- Historical composition id: `1780584025151-mx0znx977`
- Expected historical shape: 100 clips total, 50 video plus 50 linked audio. Do
  not treat this as the current live verification target.
- Source media: the three real videos currently in the Media Panel.
- Synthetic timeline smokes should restore the active comp after mutation.
- Verification runner: `node scripts/run-timeline-canvas-verification.mjs`.
- Live smokes require `npm run dev`, Chrome with the app open, and the
  `.ai-bridge-token` bridge from `AGENTS.md`.

## Latest Commit / Worktree State

As of `0f202a6b`, the branch matches upstream and the worktree was clean after
the push. Commit accounting: `334 files changed, 56225 insertions(+), 17356
deletions(-)`. A fresh `npm run swarm:status` after the push reported `0`
tracked changes, `0` new untracked files, and `+0/-0` working-tree LOC. Older
`npm run swarm:status` numbers below are pre-commit working-tree checkpoints,
not current dirty work.

- Latest post-push focused slice:
  - `src/components/timeline/TimelineContextMenu.tsx`: disabled/stale thumbnail,
    delete-gap, transcription, and label-color actions now stay inert instead
    of closing the menu or executing against missing targets.
  - `src/components/timeline/TimelineEmptyContextMenu.tsx`: capture-phase
    outside-contextmenu handling now ignores events inside the menu, matching
    the safer track-menu containment pattern.
  - `src/stores/mediaStore/slices/fileManageSlice.ts`: image relink/reload now
    writes a data-only `{ type: 'image', imageUrl, naturalDuration, mediaFileId }`
    source and no longer constructs `Image` or stores `source.imageElement`.
  - Focused checks passed: `npm run test -- tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/TimelineContextMenu.test.tsx tests/unit/TimelineEmptyContextMenu.test.tsx tests/unit/clipContextMenu.test.ts tests/unit/timelineEmptyContextMenu.test.ts tests/unit/trackContextMenu.test.ts tests/unit/TrackContextMenu.test.tsx`
    (`164` tests), touched-file ESLint, and
    `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest smoke persistence/playhead slice:
  - `src/components/timeline/Timeline.tsx`: live playback playhead uses a
    high-frequency RAF position from the internal playback clock and clamps tiny
    forward-playback DOM regressions so the visible playhead no longer flickers
    backward while preview continues forward.
  - `src/services/aiTools/handlers/timelineCanvasSmoke.ts`: synthetic smoke
    handlers run under the timeline-canvas smoke mutation guard and restore in
    `finally` where structural mutation is possible. Synthetic playhead smokes
    now also restore by default, closing the no-arg smoke regression that could
    leave the visible project on Smoke clips.
  - `src/stores/mediaStore/init.ts`: timeline-to-active-composition autosave is
    skipped during smoke mutation.
  - `src/services/project/projectLifecycle.ts`: continuous project save,
    beforeunload flush, and dirty marking are delayed/skipped during smoke
    mutation, preventing temporary smoke media from becoming Relink artifacts.
  - `src/components/timeline/utils/clipContextMenu.ts`: stale selected/opened
    clip ids are filtered/disabled in the pure context-menu model. Media-file
    lookup, label-target resolution, proxy generation, audio-proxy regeneration,
    and thumbnail-regeneration source selection now live here too; the thumbnail
    path uses media-owned/source URLs and no longer requires
    `clip.source.videoElement`, matching the data-only video-source migration.
  - `src/components/timeline/TimelineContextMenu.tsx`: the inline thumbnail
    regeneration side effect now delegates to the shared helper and creates a
    managed primary source URL only when a media file has no existing source
    URL. Label color lookup and proxy/audio-proxy execution also delegate to the
    helper, leaving Explorer and Transcribe as the main remaining inline
    side-effect executors.
  - `scripts/run-timeline-canvas-verification.mjs`: default live composition is
    now `Subcomposition 1` (`1780705391680-ecu7panot`). Worker live state waits
    are asserted, worker live smokes are wrapped in tool-success assertions, and
    default-on proof requires an unforced smoke with `workerFlag.previous === true`.
  - Focused checks passed: `npm run test -- tests/unit/clipContextMenu.test.ts tests/unit/timelineCanvasSmokeHandlers.test.ts`
    (29 tests),
    touched-file ESLint for the smoke/playhead/context-menu slice, direct
    browser playhead smoke, four-smoke bridge group (`large`, `marquee`,
    `blade`, `playhead`), post-smoke bridge state check,
    `node --check scripts/run-timeline-canvas-verification.mjs`,
    `node scripts/run-timeline-canvas-verification.mjs --help`, and
    `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest cleanup/parity slice:
  - `src/stores/timeline/deletedClipResources.ts`: shared deleted-clip runtime
    cleanup for manual clip removal and edit-kernel deletes.
  - `src/components/timeline/TimelineTrack.tsx`: stale keyframe tick and
    curve-editor typed targets clear their active transaction session and do not
    fall back to legacy move callbacks.
  - `tests/unit/TimelineTrack.test.tsx`: stale-target no-fallback coverage for
    selected clip-bar keyframe tick drags and expanded curve-editor keyframe
    drags.
  - Focused checks passed: `npm run test -- tests/unit/TimelineTrack.test.tsx tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/aiNodeRuntime.test.ts`
    (233 tests), touched-file ESLint for the cleanup/parity slice, and
    `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest Phase 5 stray cleanup:
  - `src/services/timelinePlacementCommands.ts`: NativeHelper-resolved
    placement files now create/update their media source URL through
    `createPrimaryMediaObjectUrl(...)` instead of a raw `URL.createObjectURL`.
  - `tests/unit/timelinePlacementCommands.test.ts`: added managed primary URL
    coverage for NativeHelper-resolved placement sources.
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`: lazy
    composition-audio playback mixdown clears `mixdownGenerating` when
    `requestCompositionAudioMixdown(...)` returns `null`.
  - `src/services/timeline/compositionAudioMixdownCache.ts`: completed
    composition-audio mixdown results now use a `12` entry LRU cap, so old
    nested content hashes and cached negative results do not accumulate without
    bound across an editing session.
  - `src/services/compositionAudioMixer.ts`: `createAudioElement(...)` now
    accepts an owner clip id. Owner-scoped composition mixdown WAV blob URLs are
    created through `blobUrlManager`, so replacing or deleting the clip revokes
    the previous URL instead of retaining it in the mixer singleton until app
    shutdown.
  - `src/stores/timeline/clipSlice.ts`: nested composition refresh now clears
    stale `mixdownAudio`, `mixdownBuffer`, `mixdownWaveform`,
    `hasMixdownAudio`, and `mixdownGenerating` when the nested content hash
    changes, and revokes the clip-scoped audio URL. Waveform and processed
    waveform generation now use `requestCompositionAudioMixdown(...)` instead
    of direct eager mixer calls.
  - `src/stores/timeline/editOperations/splitBatchOperations.ts` and
    `applyTimelineEditOperation.ts`: removed the dead split-at-times callback
    that still referenced eager mixdown audio-element creation.
  - `src/services/audio/ClipAudioAnalysisOrchestrator.ts`: composition audio
    analysis now uses the shared mixdown cache/dedupe path.
  - `src/components/timeline/utils/spectrogramCanvas.ts`: retained
    spectrogram raster canvases now ask interactive runtime admission before
    entering the cache, report heap-backed `image-canvas` resources, release
    resources on replacement/eviction/clear, and draw transient uncached rasters
    when admission is denied.
  - `src/services/proxyFrameCache.ts`: audio-proxy `HTMLAudioElement` retention
    now asks interactive runtime admission before `new Audio()`, reports a
    `html-media:audio` resource after load, releases the resource with the
    cached element, and revokes owned blob URLs immediately when admission is
    denied.
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`: retained stem-layer
    mixer `AudioBuffer`s now ask interactive runtime admission before entering
    the cache, report `audio-source-clock` resources with heap/duration/sample
    metadata, release resources on LRU eviction/cache clear, and skip cache
    retention when admission is denied.
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`: cloned active
    audio-proxy elements and stem-preview `HTMLAudioElement`s now ask
    interactive runtime admission before allocation, report `html-media:audio`
    resources, release coordinator resources when proxy/stem entries are
    removed, and deny stem buffer preview before creating WAV blob URLs or audio
    elements when the policy is full.
  - `src/services/nodeGraph/aiNodeRuntime.ts`: retained AI node source/output
    canvases now ask interactive runtime admission before allocation, report
    `image-canvas` resources with heap/dimension/runtime metadata, recheck
    admission when cache dimensions change, bound cache retention by entry count
    and heap bytes, release on no-runnable/no-source/error paths, and expose
    global plus clip-scoped cleanup.
  - `src/services/nodeGraph/index.ts`: exports AI-node runtime cleanup for
    tests and lifecycle boundaries.
  - `src/stores/timeline/serializationUtils.ts`,
    `src/stores/timeline/clipSlice.ts`,
    `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`,
    `src/stores/mediaStore/slices/fileManageSlice.ts`,
    `src/stores/historyStore.ts`, and
    `src/services/aiTools/handlers/timelineCanvasSmoke.ts`: lifecycle
    boundaries now clear AI-node runtime caches on full timeline clear, manual
    remove, edit-kernel delete, media delete, history restore, and smoke-state
    restore. History restore stops active timeline audio before direct state
    replacement.
  - `tests/unit/audioScrubSync.test.ts`: added regression coverage for the
    null-mixdown state reset.
  - `tests/unit/compositionAudioMixdownCache.test.ts`: added LRU eviction
    coverage for completed mixdown retention.
  - `tests/unit/compositionAudioMixer.test.ts`: added clip-owned mixdown URL
    replacement/revoke coverage.
  - `tests/stores/timeline/clipSlice.test.ts`: added nested content-hash
    mixdown invalidation and no-change preservation coverage.
  - `tests/unit/timelineSpectrogramCanvas.test.ts`: added runtime-resource
    reporting, clear-release, and admission-denial coverage for the raster
    cache.
  - `tests/unit/proxyFrameCache.test.ts`: added audio-proxy element reporting,
    release, and admission-denial coverage.
  - `tests/unit/audioScrubSync.test.ts`: added stem-layer buffer runtime
    reporting, clear-release, and admission-denial coverage.
  - `tests/unit/audioScrubSync.test.ts`: added active audio-proxy element
    reporting/release coverage plus stem-preview element reporting,
    blob-URL-revoke, and admission-denial-before-allocation coverage.
  - `tests/unit/aiNodeRuntime.test.ts`: added AI node runtime canvas reporting,
    clear-release, admission-denial, no-runnable release, and clip-scoped
    cleanup coverage.
  - `tests/unit/timelineEditOperations.test.ts`: added edit-kernel delete
    coverage for AI-node runtime cleanup.
  - Focused checks passed: `npm run test -- tests/unit/timelinePlacementCommands.test.ts tests/unit/mediaObjectUrlManager.test.ts`,
    `npm run test -- tests/unit/audioScrubSync.test.ts tests/unit/compositionAudioMixdownCache.test.ts`,
    `npm run test -- tests/unit/compositionAudioMixdownCache.test.ts tests/unit/audioScrubSync.test.ts tests/unit/audioExportPipeline.test.ts`,
    `npm run test -- tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/compositionAudioMixer.test.ts tests/unit/audioScrubSync.test.ts tests/unit/compositionAudioMixdownCache.test.ts tests/unit/audioExportPipeline.test.ts`,
    `npm run test -- tests/unit/timelineSpectrogramCanvas.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`,
    `npm run test -- tests/unit/proxyFrameCache.test.ts tests/unit/timelineSpectrogramCanvas.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`,
    `npm run test -- tests/unit/audioScrubSync.test.ts tests/unit/proxyFrameCache.test.ts tests/unit/timelineSpectrogramCanvas.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`,
    `npm run test -- tests/unit/aiNodeRuntime.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`,
    `npm run test -- tests/unit/audioScrubSync.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`,
    `npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/aiNodeRuntime.test.ts tests/unit/audioScrubSync.test.ts tests/unit/historyRuntimeRehydration.test.ts tests/unit/timelineCanvasSmokeHandlers.test.ts`,
    touched-file ESLint for the placement/audio/spectrogram/proxy-cache/nodeGraph/active-audio/lifecycle files, and
    `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest real-media worker-positive/import fallback checkpoint:
  - `src/services/aiTools/handlers/timelineCanvasSmoke.ts`: new file now
    2952 LOC; `runTimelineCanvasLargeProjectSmoke` can optionally load cached
    source thumbnails, warm decoded thumbnail bitmaps, report
    `workerThumbnailWarmup`, return compact bridge-safe snapshots, and include
    phase timings before/after worker invariant checks.
  - `scripts/run-timeline-canvas-verification.mjs`: new file now 1716 LOC;
    worker smokes include `workerPrewarm`, `workerSynthetic`,
    `workerThumbnailSynthetic`, and `workerPositiveLive`. The runner now defaults
    the configured worker-positive target id to `1780725925034-snfho0roz`, uses a `180000ms` forced-worker
    synthetic timeout, requests compact smoke payloads, and drives the 720/8
    synthetic worker proof at zoom levels that exercise culling.
  - `tests/unit/timelineCanvasSmokeHandlers.test.ts`: new file now 793 LOC;
    covers real-timeline warmup reporting and restore behavior with no cached
    thumbnails.
  - `src/services/aiTools/handlers/media.ts`: tracked diff now includes the
    byte-range local-file import fallback for dev-bridge `response.blob()`
    `Failed to fetch` failures, stage-specific import errors, and imported
    `blobSize` diagnostics. Browser proof imported all three larger user MP4s
    after the full-blob path failed for one of them.
  - `tests/unit/aiToolMediaHandlers.test.ts`: new file now 132 LOC; covers deep
    media deletion plus the local-file range fallback assembling the final
    imported `File`.
  - Focused browser proof passed on `WorkerPositive 3 Restored Videos 53
    Segments 20260606` (`1780725925034-snfho0roz`): 106 clips,
    `workerTrackCount=3`, `workerEligibleTrackCount=3`,
    `workerFallbackTrackCount=0`, `workerPendingTrackCount=0`,
    `workerErrorTrackCount=0`, `workerResourceBytes=9584552`, warmup `31/99`,
    estimated `60fps`, and zero slow/dropped frame estimates.
  - Focused checks passed: `npm run test -- tests/unit/aiToolMediaHandlers.test.ts tests/unit/timelineClipCanvasWorkerModel.test.ts tests/unit/timelineCanvasSmokeHandlers.test.ts`
    (37 tests), touched-file ESLint for the media/worker/test slice, and
    `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
  - Runner hardening: `runTimelineCanvasThumbnailReloadSmoke` now prefers an
    existing media file and otherwise uses bundled `/masterselects_github.mp4`
    instead of MediaRecorder/WebM capture, avoiding the Chrome/GPU hang seen in
    the old synthetic video-source path.
  - Focused runner proof passed in
    `fixtures/timeline-canvas-reports/run-20260606-070042Z/report.json`:
    reload ready `1506ms`, worker prewarm `72` clips / `4` tracks at `56fps`,
    worker synthetic `720` clips / `8` tracks passed with
    `workerTrackCount=8`, `workerEligibleTrackCount=8`,
    `workerFallbackTrackCount=0`, `workerPendingTrackCount=0`,
    `workerErrorTrackCount=0`, `workerResourceBytes=30720000`, `60fps`, zero
    dropped/slow frames, and worker-thumbnail synthetic passed.
  - Not yet done: full live/default-on readiness, torture-media coverage,
    visual worker parity proof, and final broad build/lint/test/browser gates
    remain open.
- Latest split media-runtime data-only cleanup:
  - `src/stores/timeline/editOperations/splitBatchOperations.ts`: cumulative
    tracked diff now `+35/-65`, net `-30`
  - `src/stores/timeline/clipSlice.ts`: cumulative tracked diff now `+48/-123`,
    net `-75`
  - `tests/unit/timelineEditOperations.test.ts`: cumulative tracked diff now
    `+1383/-2`, net `+1381`
  - `tests/stores/timeline/clipSlice.test.ts`: cumulative tracked diff now
    `+142/-0`, net `+142`
  - Legacy `splitClip`, bulk `split-at-times`, range split/placement clone
    helpers now strip `videoElement`, `audioElement`, `webCodecsPlayer`, and
    `nativeDecoder` from new clip-part sources while preserving data metadata
    such as `naturalDuration`, `mediaFileId`, `runtimeSourceId`,
    `runtimeSessionKey`, and `filePath`.
  - Focused checks passed: `npm run test -- tests/unit/timelineEditOperations.test.ts tests/stores/timeline/clipSlice.test.ts`
    (190 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest FFmpeg frame-renderer export-prep run-id follow-up:
  - `src/components/export/exportHelpers.ts`: cumulative tracked diff now
    `+127/-26`, net `+101`
  - `tests/unit/ffmpegFrameRendererRuntimeReporting.test.ts`: new file now
    184 LOC
  - `FFmpegFrameRenderer.initialize()` now passes its `runtimeRunId` into
    `prepareClipsForExport(...)`, so the existing export admission gates apply
    to FFmpeg video/GIF/browser GIF/image-sequence frame preparation. If
    initialization fails after reporting the job, export-mode and coordinator
    resources are released.
  - Focused checks passed: `npm run test -- tests/unit/ffmpegFrameRendererRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/exportLayerBuilder.test.ts`
    (27 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest audio edit bake/unbake data-only follow-up:
  - `src/stores/timeline/audioEditSlice.ts`: cumulative tracked diff now
    `+0/-14`, net `-14`
  - `tests/stores/timeline/audioEditBakeSlice.test.ts`: cumulative tracked
    diff now `+6/-1`, net `+5`
  - `bakeClipAudioEditStack(...)` and `unbakeClipAudioEditStack(...)` no
    longer create or store `HTMLAudioElement`s. Baked/restored clips retain
    source `File`, `mediaFileId`, duration, waveform refs, and source metadata,
    then rely on lazy/runtime hydration for active playback.
  - Focused checks passed: `npm run test -- tests/stores/timeline/audioEditBakeSlice.test.ts`
    (2 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest stem source-switch data-only follow-up:
  - `src/stores/timeline/stemSeparationSlice.ts`: cumulative tracked diff now
    `+9/-67`, net `-58`
  - `tests/stores/timeline/stemSeparationSlice.test.ts`: cumulative tracked
    diff now `+9/-2`, net `+7`
  - Stem source switching no longer creates or caches `HTMLAudioElement`s.
    `setClipSourceToStem(...)` disposes any stale audio element from the old
    clip source, writes file/media/duration/source metadata only, and lets
    normal lazy/audio sync hydration recover active playback. Live switches set
    `playheadState.playbackJustStarted` so the sync path retries promptly.
  - Focused checks passed: `npm run test -- tests/stores/timeline/stemSeparationSlice.test.ts`
    (10 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest Vector runtime canvas admission follow-up:
  - `src/services/vectorAnimation/vectorRuntimeReporting.ts`: new file now 152 LOC.
  - `src/services/vectorAnimation/LottieRuntimeManager.ts`: cumulative tracked
    diff now `+97/-20`, net `+77`.
  - `src/services/vectorAnimation/RiveRuntimeManager.ts`: cumulative tracked
    diff now `+104/-32`, net `+72`.
  - `src/services/vectorAnimation/VectorAnimationRuntimeManager.ts`: cumulative
    tracked diff now `+4/-2`, net `+2`.
  - `src/engine/export/ClipPreparation.ts`: cumulative tracked diff now
    `+602/-61`, net `+541`.
  - `src/services/layerPlaybackManager.ts`: cumulative tracked diff now
    `+222/-29`, net `+193`.
  - `src/services/slotDeckManager.ts`: cumulative tracked diff now `+217/-42`,
    net `+175`.
  - `src/services/compositionRenderer.ts`: cumulative tracked diff now
    `+555/-97`, net `+458`.
  - `tests/unit/vectorRuntimeReporting.test.ts`: new file now 142 LOC.
  - Lottie/Rive runtime preparation now reserves an `image-canvas` runtime
    canvas resource before `document.createElement('canvas')` or player
    construction. The manager releases that resource on runtime destroy or
    failed construction. Background-layer, slot-deck, composition-render, and
    export call sites pass their real policy/owner IDs so admission and cleanup
    happen under the caller that owns the retained runtime canvas.
  - Focused checks passed: `npm run test -- tests/unit/vectorRuntimeReporting.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts`
    (40 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest video-bake proxy admission follow-up:
  - `src/services/videoBakeProxyCache.ts`: cumulative tracked diff now
    `+111/-34`, net `+77`.
  - `tests/unit/videoBakeProxyCache.test.ts`: new file now 126 LOC.
  - Composition video-bake proxy registration now builds a
    `composition-render` `html-media/video` descriptor and asks runtime
    admission before `URL.createObjectURL(...)` or `document.createElement('video')`.
    Denied proxy registration creates no blob URL and no hidden video element.
    Admitted proxies release their resource on `remove(...)`, `clear()`, and
    failed ready-load cleanup.
  - Focused checks passed: `npm run test -- tests/unit/videoBakeProxyCache.test.ts tests/unit/layerBuilderService.test.ts`
    (28 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest legacy JPEG proxy-frame cache admission follow-up:
  - `src/services/proxyFrameCache.ts`: cumulative tracked diff now `+158/-13`,
    net `+145` at this JPEG-only checkpoint.
  - `tests/unit/proxyFrameCache.test.ts`: cumulative tracked diff now
    `+117/-1`, net `+116` at this JPEG-only checkpoint.
  - Retained legacy JPEG/`HTMLImageElement` proxy frames are now represented as
    one aggregate `thumbnail` policy `image-canvas/html-image` resource per
    media file. The cache asks admission before inserting a decoded image,
    uses projected retained heap bytes, skips cache insertion when the
    thumbnail heap budget is full, refreshes the aggregate resource after LRU
    eviction, and releases it on `clearForMedia(...)` / `clearAll()`.
  - Focused checks passed: `npm run test -- tests/unit/proxyFrameCache.test.ts`
    (9 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest decoded AudioBuffer cache admission follow-up:
  - `src/services/proxyFrameCache.ts`: cumulative tracked diff now
    `+233/-17`, net `+216` at this AudioBuffer-only checkpoint.
  - `tests/unit/proxyFrameCache.test.ts`: cumulative tracked diff now
    `+211/-1`, net `+210` at this AudioBuffer-only checkpoint.
  - Retained decoded scrub/playback `AudioBuffer`s now report as `interactive`
    policy `audio-source-clock` resources with heap-byte, duration, sample-rate,
    and channel-count diagnostics. The cache asks admission before inserting a
    decoded buffer into `audioBufferCache`; denied buffers are returned to the
    immediate caller but are not retained. Entry/byte LRU eviction,
    `clearForMedia(...)`, `clearAll()`, `clearAudioBufferCache()`, and
    `disposeAudioContext()` release the retained resource.
  - Focused checks passed: `npm run test -- tests/unit/proxyFrameCache.test.ts`
    (12 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest proxy WebCodecs VideoFrame cache admission follow-up:
  - `src/services/proxyFrameCache.ts`: cumulative tracked diff now
    `+390/-29`, net `+361`.
  - `tests/unit/proxyFrameCache.test.ts`: cumulative tracked diff now
    `+344/-1`, net `+343`.
  - Retained WebCodecs proxy `VideoFrame`s now report as one aggregate
    `interactive` policy `video-frame-provider` resource per media file.
    Projected decoded-frame bytes are checked before cache insertion after LRU
    eviction has made space. Denied decoded frames are closed and
    `getVideoFrame(...)` returns `null`, so rejected frames do not become
    ownerless retained browser resources. Per-frame LRU eviction refreshes the
    aggregate resource, and `clearForMedia(...)` / `clearAll()` release it.
  - Focused checks passed: `npm run test -- tests/unit/proxyFrameCache.test.ts`
    (15 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest export runtime/provider/decoder admission follow-up:
  - `src/services/mediaRuntime/clipBindings.ts`: `+53/-0`, net `+53`
  - `src/services/timeline/exportRuntimeReporting.ts`: new file now 971 LOC
  - `src/engine/export/ClipPreparation.ts`: `+586/-60`, net `+526`
  - `tests/unit/exportRuntimeReporting.test.ts`: new file now 451 LOC
  - `tests/unit/clipPreparation.test.ts`: new file now 260 LOC
  - Export now plans runtime source ids without retaining media runtime state,
    reserves runtime bindings before `bindSourceRuntimeForOwner()`, reserves FAST
    sequential frame providers before `File.arrayBuffer()` / `new WebCodecsPlayer()`,
    and reserves parallel `native-decoder` plus decoded-frame-buffer resources
    before `new ParallelDecodeManager()` / `ParallelDecodeManager.initialize()`.
  - Focused checks passed: `npm run test -- tests/unit/audioExportPipeline.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts`
    (26 tests), touched-file ESLint, and `npx tsc -p tsconfig.app.json --noEmit --pretty false`.
- Latest export allocator admission slice status:
  - `src/services/timeline/exportRuntimeReporting.ts`: new file now 971 LOC
  - `src/engine/export/FrameExporter.ts`: `+176/-4`, net `+172`
  - `src/engine/export/ClipPreparation.ts`: `+586/-60`, net `+526`
  - `src/engine/audio/AudioExportPipeline.ts`: `+162/-19`, net `+143`
  - `tests/unit/exportRuntimeReporting.test.ts`: new file now 451 LOC
  - `tests/unit/clipPreparation.test.ts`: new file now 260 LOC
  - `tests/unit/audioExportPipeline.test.ts`: `+216/-1`, net `+215`
  - Export now asks admission before run-job start, output surface setup,
    optional preview bitmap allocation, export image object URL / `new Image()`,
    dedicated precise-video object URL / detached `video`, and audio
    source/processed/mix/master buffer stages. Runtime binding, FAST sequential
    WebCodecs provider, and parallel decoder/frame-buffer preflights are also
    implemented in `ClipPreparation`.
- Latest RAM preview allocator admission slice status:
  - `src/services/mediaRuntime/runtimePlayback.ts`: `+18/-0`, net `+18`
  - `src/services/timeline/ramPreviewRuntimeReporting.ts`: new file now 563 LOC
  - `src/services/ramPreviewEngine.ts`: `+534/-128`, net `+406`
  - `src/stores/timeline/ramPreviewSlice.ts`: `+68/-4`, net `+64`
  - `src/engine/managers/CacheManager.ts`: `+13/-0`, net `+13`
  - `src/engine/texture/ScrubbingCache.ts`: `+196/-9`, net `+187`
  - `src/engine/render/RenderDispatcher.ts`: `+31/-1`, net `+30`
  - `tests/unit/ramPreviewRuntimeReporting.test.ts`: new file now 241 LOC
  - `tests/unit/ramPreviewEngineRuntimeReporting.test.ts`: new file now 469 LOC
  - `tests/unit/cacheManagerRuntimeReporting.test.ts`: new file now 63 LOC
  - `tests/unit/scrubbingCache.test.ts`: `+153/-1`, net `+152`
  - RAM preview now asks admission before run-job engine setup, data-only image
    object URL / `new Image()` hydration, video runtime-binding/provider/
    html-media resources before `getRuntimeFrameProvider(...)`, CPU composite
    cache `ImageData` allocation/storage, and GPU frame-cache texture
    creation/retention. `verifyVideoPositions()` now uses a non-allocating
    runtime-provider peek so hidden/skipped clips do not create RAM-preview
    sessions during drift checks.
- Latest background/slot/composition non-image admission slice status:
  - `src/services/timeline/runtimeResourceReporting.ts`: new file now 322 LOC
  - `src/services/layerPlaybackManager.ts`: `+214/-28`, net `+186`
  - `src/services/slotDeckManager.ts`: `+209/-41`, net `+168`
  - `src/services/compositionRenderer.ts`: `+544/-96`, net `+448`
  - `tests/unit/slotDeckManager.test.ts`: `+149/-0`, net `+149`
  - Background-layer and slot-deck video/audio paths now plan runtime ids and
    reserve runtime-binding plus HTML media resources before DOM element
    creation. Composition-render video sources now reserve before object URL
    creation and detached `video` allocation.
- Latest interactive runtime-provider admission slice status:
  - `src/services/mediaRuntime/runtimePlayback.ts`: `+170/-0`, net `+170`
  - `tests/unit/mediaRuntime.test.ts`: `+65/-0`, net `+65`
  - `ensureRuntimeFrameProvider()` now reserves interactive runtime-binding and
    `video-frame-provider` resources before `new WebCodecsPlayer(...)`, returns
    `null` without constructing a scrub provider when admission is denied,
    releases a freshly opened scrub session on denial, and releases retained
    runtime-provider coordinator resources through `releaseRuntimePlaybackSession(...)`.
- Latest legacy WebCodecs helper provider admission slice status:
  - `src/stores/timeline/helpers/webCodecsHelpers.ts`: `+125/-1`, net `+124`
  - `tests/unit/webCodecsHelpers.test.ts`: `+53/-0`, net `+53`
  - `initWebCodecsPlayer()` now reserves an interactive `video-frame-provider`
    resource before constructing the helper `WebCodecsPlayer`, returns `null`
    when admission is denied, releases on init failure, and patches `destroy()`
    so successful helper providers release their coordinator resource.
- Latest shared image hydrator allocator admission slice status:
  - `src/services/timeline/imageRuntimeHydrator.ts`: new file now 150 LOC
  - `src/services/compositionRenderer.ts`: `+482/-94`, net `+388`
  - `src/services/layerPlaybackManager.ts`: `+105/-23`, net `+82`
  - `src/services/slotDeckManager.ts`: `+104/-30`, net `+74`
  - `tests/unit/compositionRendererRuntimeReporting.test.ts`: new file now 622 LOC
  - `tests/unit/layerPlaybackManagerWarmDeck.test.ts`: `+229/-3`, net `+226`
  - `tests/unit/slotDeckManager.test.ts`: `+139/-0`, net `+139`
  - Shared image hydration now asks admission before `new Image()` for
    composition-render, background-layer, and warm slot-deck image loads.
- Latest primary lazy media/image allocator admission slice status:
  - `src/services/timeline/lazyMediaElements.ts`: `+321/-33`, net `+288`
  - `src/services/timeline/lazyImageElements.ts`: new file now 339 LOC
  - `src/services/layerBuilder/LayerBuilderService.ts`: `+49/-19`, net `+30`
  - `tests/unit/lazyMediaElements.test.ts`: new file now 637 LOC
  - `tests/unit/layerBuilderService.test.ts`: `+343/-1`, net `+342`
  - Denial now happens before file-backed object URL creation, DOM element
    creation, and clip-source mutation for primary lazy video/audio and
    interactive lazy images.
- Latest thumbnail allocator admission slice status:
  - `src/services/thumbnailCacheService.ts`: `+291/-102`, net `+189`
  - `src/services/timeline/runtimeCoordinatorTypes.ts`: `+54/-2`, net `+52`
  - `src/services/timeline/runtimeCoordinatorContracts.ts`: `+224/-3`, net `+221`
  - `src/services/timeline/thumbnailBitmapCache.ts`: `+29/-0`, net `+29`
  - `src/services/timeline/thumbnailRuntimeReporting.ts`: new file now 260 LOC
  - `tests/unit/thumbnailBitmapCache.test.ts`: `+63/-0`, net `+63`
  - `tests/unit/thumbnailCacheService.test.ts`: `+227/-2`, net `+225`
  - `tests/unit/timelineRuntimeCoordinatorContracts.test.ts`: `+229/-3`, net `+226`
- Latest Vector user-action data-only slice status:
  - `src/services/layerBuilder/LayerBuilderService.ts`: `+49/-19`, net `+30`
  - `src/engine/export/ExportLayerBuilder.ts`: `+65/-29`, net `+36`
  - `src/stores/timeline/clip/addLottieClip.ts`: `+3/-7`, net `-4`
  - `src/stores/timeline/clip/addRiveClip.ts`: `+3/-7`, net `-4`
  - `src/stores/timeline/clipboardSlice.ts`: tracked file now `+75/-152`, net `-77`
  - `src/stores/mediaStore/slices/fileManageSlice.ts`: tracked file now `+269/-126`, net `+143`
  - `tests/unit/vectorUserActionDataOnly.test.ts`: new, 92 LOC
  - `tests/unit/clipboardPasteDataOnly.test.ts`: new file now 210 LOC
  - `tests/stores/mediaStore/fileManageSlice.test.ts`: tracked file now `+598/-2`, net `+596`
- Latest 3D media-owned URL user-action slice diff:
  - `src/stores/timeline/clip/addModelClip.ts`: `+7/-1`, net `+6`
  - `src/stores/timeline/clip/addGaussianSplatClip.ts`: `+7/-1`, net `+6`
  - `src/components/timeline/hooks/useExternalDrop.ts`: `+2/-1`, net `+1`
  - `src/stores/timeline/clipboardSlice.ts`: tracked file now `+57/-104`, net `-47`
  - `tests/unit/spatialClipUrlOwnership.test.ts`: new, 76 LOC
  - `tests/unit/clipboardPasteDataOnly.test.ts`: new file now 162 LOC
  - `tests/stores/mediaStore/fileManageSlice.test.ts`: tracked file now `+534/-2`, net `+532`
- Latest download completion video/audio data-only slice diff:
  - `src/stores/timeline/clip/completeDownload.ts`: `+34/-50`, net `-16`
  - `tests/unit/completeDownloadDataOnly.test.ts`: new, 116 LOC
- Latest media relink/reload video/audio data-only slice diff:
  - `src/stores/mediaStore/slices/fileManageSlice.ts`: `+269/-117`, net `+152`
  - `tests/stores/mediaStore/fileManageSlice.test.ts`: `+483/-2`, net `+481`
- Latest timeline video/audio paste data-only slice diff:
  - `src/stores/timeline/clipboardSlice.ts`: `+55/-104`, net `-49`
  - `tests/unit/clipboardPasteDataOnly.test.ts`: new, 114 LOC
- Latest direct browser video/audio add data-only slice diff:
  - `src/stores/timeline/clip/addVideoClip.ts`: `+26/-87`, net `-61`
  - `src/stores/timeline/clip/addAudioClip.ts`: `+3/-5`, net `-2`
  - `src/stores/timeline/helpers/webCodecsHelpers.ts`: `+13/-0`, net `+13`
  - `tests/unit/addVideoClip.test.ts`: `+141/-34`, net `+107`
- Latest playback/export composition-audio mixdown-on-demand slice diff:
  - `src/services/timeline/compositionAudioMixdownCache.ts`: new, 143 LOC
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`: `+79/-3`, net `+76`
  - `src/engine/audio/AudioExportPipeline.ts`: `+78/-19`, net `+59`
  - `tests/unit/compositionAudioMixdownCache.test.ts`: new, 135 LOC
  - `tests/unit/audioExportPipeline.test.ts`: `+182/-1`, net `+181`
  - `tests/unit/audioScrubSync.test.ts`: `+81/-0`, net `+81`
- Latest AddComp/Split composition-audio lazy placeholder slice tracked diff:
  - `src/stores/timeline/clip/addCompClip.ts`: `+10/-1038`, net `-1028`
  - `src/stores/timeline/helpers/audioTrackHelpers.ts`: `+4/-1`, net `+3`
  - `src/stores/timeline/clipSlice.ts`: `+50/-74`, net `-24`
  - `src/stores/timeline/editOperations/splitBatchOperations.ts`: `+26/-2`, net `+24`
  - `tests/stores/timeline/clipSlice.test.ts`: `+56/-0`
  - `tests/unit/timelineEditOperations.test.ts`: `+1289/-2`
  - `tests/unit/addCompClipNestedRestore.test.ts`: new, 1964 LOC
- Latest lazy video/audio object URL ownership slice tracked/new-file diff:
  - `src/services/timeline/lazyMediaElements.ts`: `+258/-33`, net `+225`
  - `src/services/project/mediaObjectUrlManager.ts`: new, 194 LOC
  - `tests/unit/lazyMediaElements.test.ts`: new, 423 LOC
  - `tests/unit/mediaObjectUrlManager.test.ts`: new, 183 LOC
- Latest Mask/Text path-keyframe routing slice tracked-file diff:
  - `src/stores/timeline/keyframeSlice.ts`: `+215/-103`, net `+112`
  - `src/stores/timeline/types.ts`: `+35/-6`, net `+29`
  - `src/components/preview/useMaskVertexDrag.ts`: `+12/-1`, net `+11`
  - `src/components/preview/useMaskEdgeDrag.ts`: `+12/-1`, net `+11`
  - `tests/stores/timeline/keyframeSlice.test.ts`: `+131/-0`
- Latest path-value keyframe kernel slice tracked-file diff:
  - `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`: `+1024/-1`
  - `tests/unit/timelineEditOperations.test.ts`: `+1224/-1`
- Latest curve-editor transaction slice tracked-file diff:
  - `src/components/timeline/CurveEditor.tsx`: `+57/-9`
  - `src/components/timeline/TimelineTrack.tsx`: `+606/-33`
  - `tests/unit/CurveEditor.test.tsx`: `+3/-3`
  - `tests/unit/TimelineTrack.test.tsx`: `+447/-5`
- Latest keyframe tick-drag transaction slice tracked-file diff:
  - `src/components/timeline/TimelineTrack.tsx`: `+311/-26`
  - `src/components/timeline/hooks/useClipKeyframeTickDrag.ts`: `+23/-10`
  - `src/components/timeline/interactionShell/ClipKeyframeTicks.tsx`: `+11/-1`
  - `src/components/timeline/interactionShell/types.ts`: `+1/-0`
  - `tests/unit/TimelineTrack.test.tsx`: `+234/-5`
  - `tests/unit/ClipInteractionShell.contract.test.tsx`: `+11/-2`
- Latest Fade transaction/hook slice tracked-file diff:
  - `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`: `+972/-1`
  - `src/components/timeline/hooks/useClipFade.ts`: `+207/-103`
  - `src/components/timeline/Timeline.tsx`: `+100/-236`
  - `tests/unit/timelineEditOperations.test.ts`: `+1125/-1`
- `src/stores/timeline/serializationUtils.ts`: `+411/-1248`, net `-837`
- `src/services/project/projectLoad.ts`: `+86/-242`, net `-156`
- `src/stores/timeline/clip/addCompClip.ts`: `+3/-1005`, net `-1002`
- `src/stores/timeline/nestedCompositionLoader.ts`: new, 1103 LOC
- `src/stores/timeline/nestedRestore.ts`: new, 528 LOC
- `src/stores/timeline/clipSlice.ts`: `+37/-70`, net `-33`
- `tests/setup.ts`: `+5/-4`, net `+1`
- `docs/plans/timeline-canvas-refactor-plan.md`: `+245/-65`, net `+180`
- `docs/plans/timeline-canvas-refactor-handoff.md`: new; exact LOC changes as
  this handoff is updated
- `tests/unit/projectMediaPersistence.test.ts`: `+1230/-1`, net `+1229`
- `tests/stores/mediaStore/fileManageSlice.test.ts`: `+446/-2`, net `+444`
- `tests/unit/addCompClipNestedRestore.test.ts`: new, 1883 LOC
- `tests/unit/addImageClip.test.ts`: new, 98 LOC
- `tests/unit/serializationNestedRestore.test.ts`: new, 1996 LOC
- `tests/unit/nestedRestoreRuntimeHelpers.test.ts`: new, 230 LOC
- `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx`: new, 942 LOC
- `tests/unit/timelineClipCanvasWorkerModel.test.ts`: new, 647 LOC
- `tests/unit/mediaObjectUrlManager.test.ts`: new, 161 LOC
- `src/stores/timeline/vectorRuntimeRestore.ts`: new, 157 LOC
- `src/stores/timeline/restoredMediaSource.ts`: new, 225 LOC
- `src/services/project/mediaObjectUrlManager.ts`: new, 190 LOC
- `src/services/timeline/lazyImageElements.ts`: new, 236 LOC
- `src/services/timeline/imageRuntimeHydrator.ts`: new, 75 LOC
- `tests/unit/clipPreparation.test.ts`: new, 147 LOC
- `tests/unit/compositionRendererRuntimeReporting.test.ts`: new, 473 LOC
- `tests/unit/layerPlaybackManagerWarmDeck.test.ts`: `+158/-3`, net `+155`
- `tests/unit/slotDeckManager.test.ts`: `+73/-0`, net `+73`
- `src/components/timeline/utils/timelineClipCanvasWorkerContract.ts`: new, 146 LOC

These numbers are a checkpoint, not a final accounting. The apparent LOC
paradox is expected: the tracked tree has removed more old code than it added,
while the large new-file count is mostly handoff, smoke runner, worker/runtime
modules, restore helpers, and tests.

## Retired DOM Inventory Committed In `0f202a6b`

These files are deleted at `HEAD`. Do not restore them or rebuild features
inside them:

- `src/components/timeline/TimelineClip.tsx`
- Old passive clip components under `src/components/timeline/components/`:
  `ClipAnalysisOverlay`, `ClipAudioMediaView`, `ClipContentMeta`,
  `ClipCoverageBadges`, `ClipFadeTrimControls`, `ClipPassiveStatusBadges`,
  `ClipPassiveVisualLayers`, `ClipPostThumbnailDecorations`,
  `ClipPreThumbnailDecorations`, `ClipPresentationPrimitives`,
  `ClipSelectionHitareas`, `ClipSpectrogram`, `ClipThumbnailFilmstrip`,
  `ClipTranscriptAnalysisOverlays`, `ClipWaveform`, `NewTrackDropZone`,
  `PickWhipOverlay`.
- Old clip hooks under `src/components/timeline/hooks/`:
  `useClipAnimationState`, `useClipAudioAnalysisDisplayState`,
  `useClipAudioArtifactWarmups`, `useClipAudioDisplayDerivedState`,
  `useClipAudioMediaViewProps`, `useClipAudioRegionControls`,
  `useClipAudioRenderState`, `useClipOverlayActions`,
  `useClipRegionInteractions`, `useClipRegionOverlayState`,
  `useClipSpectralImageLayers`, `useClipStemSwitcher`,
  `useClipStoreBindings`, `useClipThumbnailFilmstripPlan`,
  `useClipTimelineRenderGeometry`, `useClipTimelineToolPointer`,
  `useClipVisualChrome`, `useTimelineSpectrogramTileSet`,
  `useTimelineWaveformPyramid`.
- Old passive helpers under `src/components/timeline/utils/`:
  `audioAnalysisDisplayStatus`, `audioWaveformDiagnostics`,
  `clipCoverageBadges`, `clipMediaClassification`, `resolveClipLabelHex`,
  `sourceExtensionGhosts`, `thumbnailFilmstrip`, `waveformRenderGeometry`.
- Retired DOM-component tests:
  `ClipSpectrogram.test.tsx`, `ClipWaveform.test.tsx`,
  `audioAnalysisDisplayStatus.test.ts`, `audioWaveformDiagnostics.test.ts`,
  `clipCoverageBadges.test.ts`, `clipMediaClassification.test.ts`,
  `resolveClipLabelHex.test.ts`, `sourceExtensionGhosts.test.ts`,
  `thumbnailFilmstrip.test.ts`, `waveformRenderGeometry.test.ts`.

Replacement rule: passive visuals belong in `TimelineClipCanvas`, the worker
model/worker, shared canvas drawing utilities, and cache services. Active
controls belong in `src/components/timeline/interactionShell/` and focused
timeline hooks. Do not recreate a full DOM clip body.

## Phase Status Map

| Phase | Status | Notes |
| --- | --- | --- |
| 0 - Contracts and diagnostics | Done | Core render contracts and diagnostics are in place. |
| 1 - Shell as only DOM clip layer | Done | `TimelineClip.tsx` is deleted; canvas/shell is the live clip path. |
| 2 - Cache boundary and module extraction | Mostly done | Warmups, cache invalidation, relink/source identity, and artifact reads are extracted. Source-fingerprint equivalence and hash-collision hardening remain. |
| 3 - Interaction operations and geometry parity | Partial | Typed move, overlap trim, keyboard delete/blend, transition apply/remove/update, transition preview/drop-clear, generic keyframe transaction operations, fade transaction execution through `useClipFade`, selected clip-bar keyframe tick-drag transactions, expanded curve-editor keyframe/Bezier drags, stale typed-target no-fallback behavior, and Mask/Text path-keyframe compatibility routing are executable and covered. Remaining work: side-effecting context-menu handler cleanup and final shell/canvas parity sweep. |
| 4 - Retire full TimelineClip overlay | Done | Full DOM body and old passive overlay components/tests are retired. |
| 5 - Runtime and persistence boundary | Partial | Runtime coordinator reporting/adapters are implemented; full allocator ownership is not. Admission gates now exist for thumbnail DB-load jobs, thumbnail generation jobs, detached thumbnail generation video/canvas resources, decoded thumbnail bitmaps, primary lazy video/audio elements, interactive lazy image elements, interactive scrub WebCodecs providers, legacy WebCodecs helper providers, Vector runtime canvases, video-bake proxy videos, legacy JPEG proxy-frame cache resources, decoded AudioBuffer cache resources, proxy VideoFrame cache resources, shared image hydrator resources for composition/background/slot paths, background/slot/composition video/audio runtime resources, RAM preview run-job/image/video-provider/CPU-cache/GPU-cache resources, export run/output/preview/image/precise-video/audio resources, export runtime bindings, FAST sequential WebCodecs providers, and parallel decoder/frame-buffer resources. Video/audio/nested-video/composition-audio/top-level-image/nested-image restore is data-only. AddComp linked composition-audio clips are now data-only placeholders, split paths no longer clone media runtime objects (`videoElement`, `audioElement`, WebCodecs providers, native decoders), FFmpeg frame rendering forwards its run id into export preparation, audio edit bake/unbake keeps restored/baked sources data-only, and stem source switching keeps clip sources data-only. Playback/export composition-audio mixdown-on-demand is implemented through the shared cache. Direct browser video/audio add, timeline video/audio paste, media relink/reload video/audio, download completion video/audio, and direct/paste/reload Vector user actions are data-only. 3D user-action URL ownership now prefers media-owned URLs. Image/model/vector/gaussian/avatar restore source construction is consolidated. Project-load/relink sequence frame URLs, durable primary `MediaFile.url` paths, and file-backed lazy video/audio element URLs are now media-scoped/manager-owned. Interactive lazy image preview, export image hydration, RAM/composition image hydration, background/slot image hydration, and `useLayerSync` data-only image support are implemented; broader allocator ownership remains for remaining stray runtime callers and final live/torture verification. |
| 6 - Worker and large-project hardening | Mostly done | Worker protocol, resources, diagnostics, forced smokes, and the real-media worker-positive runner hook are in place. Default-on waits for a fresh live `workerPositiveLive` pass and torture-media coverage. |

## Completed Major Work

- Phase 0/1/2 core contracts, shell mount, diagnostics, cache-boundary work.
- Phase 4 DOM body retirement: full `TimelineClip.tsx` body removed.
- Timeline canvas worker protocol, runtime ack/fallback, forced-worker smokes, worker resource payloads.
- Live fixed-comp verification runner and restore-after-smoke safeguards.
- Smoke persistence guard across active-composition autosave and project continuous save.
- Export/preview parity smoke and frame fingerprinting.
- Playhead flicker fix: forward playback no longer backtracks visually.
- Context-menu command-model first pass:
  - `clipContextMenu.ts`
  - `trackContextMenu.ts`
  - `timelineEmptyContextMenu.ts`
- Restore-boundary slice:
  - top-level video/audio restore is data-only
  - direct nested video restore is data-only
  - sub-nested video restore is data-only
  - composition-audio restore does not create `HTMLAudioElement`, object URLs, or eager mixdowns
  - AddComp composition-audio linking creates a data-only placeholder instead
    of eager mixdown/audio elements
  - split operations strip video/audio/WebCodecs/native-decoder runtime fields
    from new clip parts instead of cloning media elements or scheduling
    `compositionAudioMixer.createAudioElement(...)`
  - playback/export composition-audio mixdown is now lazy and shared through
    `compositionAudioMixdownCache.ts`, with export skipping empty placeholder
    files when a composition has no audio
  - direct browser video/audio add keeps clip sources data-only after metadata
    probing; linked audio and standalone audio clips no longer store imported
    `HTMLAudioElement`s, and imported video clips no longer store
    `HTMLVideoElement` or `WebCodecsPlayer`
  - timeline video/audio paste rehydrates only `file`, `mediaFileId`, duration,
    loading flags, and data-only sources; it no longer allocates pasted
    video/audio DOM elements, video/audio object URLs, or WebCodecs players
  - media relink/reload updates video/audio clips as data-only sources and
    regenerates thumbnails through the media-owned source URL instead of a
    reload-time clip video element
  - download completion updates the downloaded video and linked audio clips as
    data-only sources; it does not store clip video/audio elements, WebCodecs
    players, or clip-owned video/audio blob URLs
  - 3D user-action URL ownership now prefers media-owned URLs for model/gaussian
    direct add fallback, model paste, media relink/reload, and NativeHelper
    external timeline drop recovery
  - Vector user-action hydration is now data-only for direct Lottie/Rive add,
    vector clipboard paste, and media relink/reload. Preview/export no longer
    require `clip.source.textCanvas` for vector clips; they consume the runtime
    canvas returned by `vectorAnimationRuntimeManager.renderClipAtTime(...)`.
- Runtime coordinator reporting/adapters across lazy media, background/slot deck,
  thumbnails, render targets, composition render, RAM preview, export, and
  related tests. This is not allocator ownership yet.
- First primary lazy media/image allocator admission gates:
  - `lazyMediaElements.ts` asks `TimelineRuntimeCoordinator.canRetainResource(...)`
    before `getLazySource(...)`, file-backed object URL creation, video/audio DOM
    element creation, and clip-source mutation.
  - `lazyImageElements.ts` plans source identity before allocation, asks the
    coordinator before `new Image()` or file-backed `URL.createObjectURL(...)`,
    leaves denied clips data-only/retryable, and replaces stale same-clip image
    records when the image source URL changes.
  - Focused tests cover over-budget no-allocation behavior for video, audio,
    and image, post-release retry/admission, image source-key replacement, and
    `LayerBuilderService` returning zero layers instead of mutating clip source
    while the interactive image budget is full.
- Shared image hydrator allocator admission gates:
  - `imageRuntimeHydrator.ts` now accepts resource metadata, asks
    `TimelineRuntimeCoordinator.canRetainResource(...)` before `new Image()`,
    reserves admitted image resources under the caller policy, releases on
    cancel/stale/error, and returns an explicit denied handle without creating
    an image element.
  - `compositionRenderer`, `layerPlaybackManager`, and `slotDeckManager` pass
    policy/owner/source metadata matching their existing final reporting ids.
    Denial resolves/cleans pending composition loads, clears background image
    loading state, and keeps slot decks from inflating `preparedClipCount`.
  - Focused tests cover over-budget composition-render, background-layer, and
    slot-deck image hydration with no `Image` construction and no stuck ready
    counters.
- RAM preview allocator admission gates:
  - `ramPreviewSlice` asks `TimelineRuntimeCoordinator.canRetainResource(...)`
    for the run job before engine import/setup and preview state mutation.
  - `RamPreviewEngine` reserves data-only image resources before file-backed
    object URL creation or `new Image()` and aborts the generation cleanly on
    hard image-denial instead of rendering partial cached frames.
  - `RamPreviewEngine` also reserves video runtime-binding/provider/html-media
    resources before `getRuntimeFrameProvider(...)`, and `verifyVideoPositions()`
    uses a non-allocating provider peek so hidden/skipped clips do not create
    RAM-preview sessions during drift checks.
  - `CacheManager` checks CPU composite-cache admission before constructing
    `ImageData`; `ScrubbingCache` also guards direct CPU cache writes.
  - `RenderDispatcher` asks GPU cache admission before creating a WebGPU
    texture for cached RAM playback, and `ScrubbingCache` guards GPU cache
    replacement/LRU/denial paths.
  - Focused tests cover non-mutating run/image/cache admission checks, no
    `Image` construction on image-budget denial, no `ImageData` allocation on
    CPU-cache denial, no retained GPU cache texture on GPU denial, no
    RAM-preview session creation when video admission is denied, and no hidden
    clip session creation during verification.
- Background/slot/composition non-image allocator admission gates:
  - `runtimeResourceReporting.reservePlannedClipRuntimeResources(...)` plans and
    reserves runtime-binding plus HTML video/audio resources under the same IDs
    used by final reporting.
  - `layerPlaybackManager` and `slotDeckManager` use the reservation before
    background/slot video/audio DOM element creation; denied paths clear loading
    or prepared state without creating media elements.
  - `compositionRenderer` reserves composition-render video resources before
    object URL creation and detached `video` allocation.
- Interactive runtime-provider admission gates:
  - `ensureRuntimeFrameProvider()` reserves an interactive runtime binding plus
    `video-frame-provider` resource before constructing a dedicated scrub
    `WebCodecsPlayer`.
  - Admission denial returns `null` without constructing a player and releases
    the scrub session if this ensure call opened it.
  - `releaseRuntimePlaybackSession()` releases the retained runtime-provider
    coordinator resources.
- Legacy WebCodecs helper provider admission gates:
  - `initWebCodecsPlayer()` reserves an interactive `video-frame-provider`
    resource before constructing its helper `WebCodecsPlayer`.
  - Admission denial returns `null` without construction, init failure releases
    the reservation, and successful helper providers release through the patched
    `destroy()`.
- Export allocator admission gates:
  - `FrameExporter` asks admission for the export run job before encoder/audio
    setup, and for zero-copy/readback output surfaces before export canvas
    setup or readback fallback. Setup-denial releases run resources and cancels
    partially initialized encoder/audio state.
  - Export preview frames are soft-gated before `VideoFrame.clone()`,
    `ImageData`, and `createImageBitmap`; denial skips preview only.
  - `ClipPreparation` reserves export image and dedicated PRECISE video element
    resources before file-backed object URLs, `new Image()`, or detached
    `video` creation.
  - `ClipPreparation` now plans runtime source ids before retaining media
    runtime state, reserves export runtime bindings before
    `bindSourceRuntimeForOwner()`, reserves FAST sequential WebCodecs providers
    before `File.arrayBuffer()` / `new WebCodecsPlayer()`, and reserves parallel
    decoder/frame-buffer resources before `new ParallelDecodeManager()` /
    `ParallelDecodeManager.initialize()`.
  - `AudioExportPipeline` asks admission for source, processed, mix, and master
    audio buffer stages and treats admission denial as a hard export error, not
    as a decode failure that can silently fall back to silence.
- First thumbnail allocator/admission gates:
  - `TimelineRuntimeCoordinator.canRetainResource(...)` predicts resource
    admission against policy hard budgets without mutating retained resources.
  - `thumbnailCacheService` now asks the coordinator before starting cached
    thumbnail DB-load jobs or thumbnail generation jobs; over-budget jobs do
    not touch IndexedDB, create detached videos, or mark the source generating.
  - Detached thumbnail generation video/canvas resources now ask for admission
    before being retained; denied resources are cleaned/reset instead of
    leaving a source stuck as generating.
  - `thumbnailBitmapCache` now asks the coordinator before retaining decoded
    thumbnail `ImageBitmap`s; over-budget decodes are closed and not cached.
  - This is allocator admission for thumbnail jobs/resources/bitmaps only, not full
    allocator ownership for every runtime resource.
- Runtime cleanup hardening:
  - `releaseAllLazyTimelineMediaElements()` no longer releases against an empty
    fake context; lazy records retain the owning clip as a cleanup fallback, so
    top-level and nested `source.videoElement` / `source.audioElement` refs are
    cleared during global release.
  - `compositionRenderer` now registers pending video/image load disposers as
    soon as owned elements/blob URLs are created. Dispose/invalidate clears
    pending loads immediately, revokes owned blob URLs, removes late event
    handlers, and resolves in-flight prepare promises as stale instead of
    waiting for `canplaythrough` / `onload`.
- Preview/export model fallback parity:
  - `LayerBuilderService` and `ExportLayerBuilder` now prove that a restored
    model clip with no `clip.source.modelUrl` can use either
    `mediaFile.modelSequence` frame URLs or `mediaFile.url`.
- Nested image/math first shared-helper slice:
  - `nestedRestore.ts` now owns shared math-scene nested clip creation,
    managed data-only nested image URL ownership, and pending vector animation
    source descriptors. The older restore-time image runtime loading helper was
    removed after nested image restore moved to `source.imageUrl`.
  - It also owns managed nested model fallback URL creation and shared model
    field application for nested restore paths.
  - It now owns nested vector runtime preparation: pending source setup,
    `prepareClipSource(...)`, runtime `textCanvas`, metadata-duration
    resolution, `isLoading` clearing, and first `renderClipAtTime(...)`.
  - `serializationUtils.ts`, `projectLoad.ts`, and `addCompClip.ts` use these
    helpers for nested math/image/model/vector paths instead of building those pieces
    locally.
- Top-level model restore fallback is now managed:
  - `nestedRestore.ts` exposes generic managed restore helpers alongside the
    nested aliases.
  - `serializationUtils.loadState()` uses the managed model helper for
    top-level model fallback URLs instead of a raw `URL.createObjectURL(...)`.
  - `clearTimeline()` now calls `blobUrlManager.clear()`, and focused coverage
    proves the managed top-level model URL is revoked on clear.
- Top-level image restore fallback is now managed and data-only:
  - `serializationUtils.loadState()` writes `source.imageUrl` for top-level
    image clips instead of constructing `HTMLImageElement`s during project load.
  - `lazyImageElements.ts` supplies interactive preview images on demand without
    mutating `clip.source`.
  - `ClipPreparation` prepares data-only images for export into
    `ExportClipState.exportImageElement`, and `ExportLayerBuilder` uses that
    state before falling back to legacy `source.imageElement`.
  - Focused coverage proves managed image URL ownership, no restore-time
    `Image` construction, preview lazy hydration, export image preparation, and
    cleanup of export-owned image blob URLs.
- Top-level vector restore now uses the shared vector runtime helper:
  - `serializationUtils.loadState()` no longer creates file-backed object URLs
    before lottie/rive restore, including NativeHelper referenced-file recovery.
  - The separate `readLottieMetadata(...)` / `readRiveMetadata(...)` pass is
    removed; duration comes from `prepareClipSource(...)` metadata through the
    shared helper.
  - Focused coverage proves lottie and rive restore through the shared helper
    while the clip is still in the restore buffer, with no object URLs.
- Top-level gaussian-splat sequence restore no longer creates duplicate blob
  URLs when a renderable sequence frame URL already exists, and patches the
  restored clip through the restore buffer. File-backed fallback remains URL
  based for render compatibility, but is managed by `blobUrlManager`.
- Nested/add-comp/project-load gaussian-splat restore now uses the shared
  Gaussian restore source helper:
  - `restoredMediaSource.ts` owns reusable sequence URL selection, runtime key,
    file name, render settings, and fallback URL construction.
  - `nestedRestore.ts` owns managed blob fallback creation for gaussian-splat
    file restores.
  - `addCompClip.ts`, `serializationUtils.ts`, and `projectLoad.ts` all use the
    shared helper for nested gaussian-splat clips while preserving
    renderer-required `gaussianSplatUrl`.
  - Focused coverage proves direct nested, sub-nested, top-level loadState, and
    project-load post-relink gaussian restore; sequence URLs avoid duplicate
    object URLs, and file fallback is tracked by `blobUrlManager`.
- Media-scoped project-load/relink sequence URL ownership is implemented:
  - `src/services/project/mediaObjectUrlManager.ts` owns media-level object URL
    keys, collection, replacement, per-media revoke, and global cleanup.
  - `projectLoad.ts` creates model/gaussian sequence frame object URLs through
    that manager and revokes previous media-state URLs before loading new
    project media.
  - `relinkMedia.ts` keeps replacement sequence frame URLs while revoking stale
    old frame/main/proxy URLs through the same manager.
  - `fileManageSlice.ts` removes/reloads media with sequence frame cleanup and
    `updateTimelineClips(...)` reuses media-owned model/gaussian sequence URLs
    instead of minting clip-scoped duplicates when a sequence URL already exists.
- Legacy gaussian-avatar restore compatibility is audited and normalized:
  - New gaussian-avatar import/add is still blocked; this remains migration
    support only, not a revived product path.
  - `restoredMediaSource.ts` and `nestedRestore.ts` now provide managed
    gaussian-avatar source helpers.
  - Top-level `loadState`, direct/sub-nested restore, AddComp nested restore,
    post-relink nested project-load restore, and `updateTimelineClips(...)`
    all use the same `blobUrlManager` ownership key (`model`) for avatar blob
    fallbacks.
  - Focused coverage proves top-level and direct nested legacy avatar restore
    no longer leave clips loading and revoke managed blob URLs on clear.
- Durable primary `MediaFile.url` ownership is implemented:
  - `mediaObjectUrlManager.ts` now exposes a stable primary media URL key and
    `createPrimaryMediaObjectUrl(...)`.
  - `importPipeline.ts`, `projectLoad.ts`, `relinkMedia.ts`,
    `fileManageSlice.ts`, `legacyStartupRestore.ts`, `duplicateSlice.ts`,
    sequence import helpers, and `projectSlice.ts:newProject()` now route
    durable media-store object URLs through that manager.
  - `processImport(...)` creates the primary URL only after the canonical RAW
    source is known, so the transient original-file blob URL is no longer
    minted during copy-to-project imports.
  - `updateTimelineClips(...)` reuses the media-owned primary URL for
    video/audio/image reloads instead of minting an unmanaged shared clip URL
    when the media store already has a URL.
- First nested restore shell/primitive dedupe slice is implemented:
  - `nestedRestore.ts` now owns shared nested composition shell creation,
    primitive mesh restore detection/construction, and nested media shell
    `waveform` / `waveformChannels` preservation.
  - `serializationUtils.ts` no longer carries its own primitive mesh clip
    factory, and its sub-nested composition shell now uses the shared helper.
  - `addCompClip.ts` now uses the shared nested composition/media shell helpers
    and restores direct/sub-nested primitive mesh clips without requiring a
    `MediaFile`.
  - `projectLoad.ts` post-relink nested restore now keeps primitive mesh nested
    clips instead of dropping them when no media file exists.
  - Focused coverage proves direct/sub-nested primitive mesh restore in both
    `loadNestedClips(...)` and `loadState(...)`, while guarding model-sequence
    clips with `meshType` from being treated as primitives.
- Nested spatial source dedupe slice is implemented:
  - `nestedRestore.ts` now owns a shared sync spatial source helper for
    `model`, `gaussian-splat`, and legacy `gaussian-avatar` restore.
  - `serializationUtils.ts`, `addCompClip.ts`, and `projectLoad.ts` no longer
    carry separate direct `model` / `gaussian-splat` / `gaussian-avatar`
    source-branching blocks for nested restore.
  - The helper reports whether a source was actually restored so each caller can
    preserve its old missing-source policy. `addCompClip.ts` still applies 3D
    fields when source creation is missing; `projectLoad.ts` only applies fields
    when a source is restored.
  - Focused coverage now includes direct and sub-nested AddComp legacy
    gaussian-avatar blob fallback ownership.
- Async vector restore starter dedupe and image data-only convergence are
  implemented:
  - `nestedRestore.ts` still owns shared vector runtime restore starters for
    Vector runtime prep, optional current-session guards, caller-supplied patch
    callbacks, and token-protected stale Vector runtime cleanup.
  - Image restore paths have moved past the earlier async `Image` starter shape:
    top-level, direct nested, and sub-nested image clips now restore as
    data-only `source.imageUrl` descriptors, with runtime hydration handled by
    `lazyImageElements.ts` / `imageRuntimeHydrator.ts` and export hydration
    handled by `ClipPreparation`.
  - `serializationUtils.ts`, `addCompClip.ts`, and `projectLoad.ts` use shared
    helpers for image descriptors and vector runtime restore instead of each
    carrying local load/prepare/catch logic.
  - `clipSlice.ts` now passes the existing timeline-session guard into
    `loadNestedClips(...)`, so AddComp async completions can ignore stale
    sessions.
  - Historical focused coverage proved the older direct/sub-nested AddComp
    Image load callbacks and `loadState` Image tree patching; newer coverage
    supersedes that with data-only nested image restore and runtime hydration.
- Recursive nested runtime patching and stale Vector hardening are implemented:
  - `nestedRestore.ts` now exports shared recursive nested tree patch helpers
    used by `serializationUtils.ts`, `addCompClip.ts`, and `projectLoad.ts`
    for async runtime asset patches.
  - AddComp sub-nested Image/Vector completions no longer rely only on object
    mutation after the tree is installed in Zustand; they can patch the root
    comp clip immutably when the store tree exists.
  - `startRestoredVectorRuntimeRestore(...)` prepares Vector runtimes against an
    isolated runtime clip and only mutates/renders the real clip after
    current-session and generation checks pass.
  - Lottie/Rive pending prepare promises now include the file object identity in
    their key, avoiding same-clip-id reuse across overlapping restores with
    different files.
  - `projectLoad.ts` nested reload guards now include `timelineSessionId`, not
    only root comp clip existence.
- Project-load post-relink nested reload now delegates to the shared nested
  loader:
  - `projectLoad.ts:reloadNestedCompositionClips(...)` is exported as an
    internal test seam and now calls `loadNestedClips(...)` instead of carrying a
    local first-level builder.
  - The post-relink guard checks both `timelineSessionId` and same composition
    identity, then writes nested clips, nested tracks, and calculated
    `nestedClipBoundaries`.
  - Direct and sub-nested motion clips are restored before media lookup inside
    `loadNestedClips(...)`, so project-load and add-comp share that behavior.
  - Direct nested Vector completions mutate the returned nested clip object, so
    a fast Vector prepare that finishes before root comp installation is still
    installed ready instead of stuck loading.
  - Nested keyframe merges are now skipped if the caller's current-session guard
    has gone stale before `clipKeyframes` is written.
  - Focused coverage proves delegated recursive project-load reload, stale
    project-load image blocking, direct/sub-nested motion support, direct Vector
    early completion, and stale keyframe merge blocking.
- Shared nested loader convergence now covers recursive keyframe collection,
  keyframe merge/no-op/stale guard policy, async segment build/apply scheduling,
  nested boundary calculation, and composition-thumbnail generation forwarding.
- Large dead-code removal around the retired DOM clip body and orphaned tests.

## Latest Targeted Checks That Passed

- Latest export provider/decoder/audio admission check: `npm run test -- tests/unit/audioExportPipeline.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts` passed with 26 tests.
- `npx eslint src/services/mediaRuntime/clipBindings.ts src/services/timeline/exportRuntimeReporting.ts src/engine/export/ClipPreparation.ts src/engine/audio/AudioExportPipeline.ts tests/unit/audioExportPipeline.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest RAM preview video/provider admission check: `npm run test -- tests/unit/ramPreviewRuntimeReporting.test.ts tests/unit/ramPreviewEngineRuntimeReporting.test.ts` passed with 10 tests.
- Latest interactive runtime-provider admission check: `npm run test -- tests/unit/mediaRuntime.test.ts` passed with 19 tests.
- Latest legacy WebCodecs helper admission check: `npm run test -- tests/unit/webCodecsHelpers.test.ts` passed with 5 tests.
- Combined runtime/export/RAM/WebCodecs-helper admission check: `npm run test -- tests/unit/mediaRuntime.test.ts tests/unit/webCodecsHelpers.test.ts tests/unit/ramPreviewRuntimeReporting.test.ts tests/unit/ramPreviewEngineRuntimeReporting.test.ts tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/clipPreparation.test.ts` passed with 63 tests.
- `npx eslint src/services/mediaRuntime/runtimePlayback.ts src/services/timeline/ramPreviewRuntimeReporting.ts src/services/ramPreviewEngine.ts tests/unit/ramPreviewRuntimeReporting.test.ts tests/unit/ramPreviewEngineRuntimeReporting.test.ts`
- `npx eslint src/services/mediaRuntime/runtimePlayback.ts tests/unit/mediaRuntime.test.ts`
- `npx eslint src/stores/timeline/helpers/webCodecsHelpers.ts tests/unit/webCodecsHelpers.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest shared image hydrator admission check: `npm run test -- tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts` passed with 18 tests.
- `npx eslint src/services/timeline/imageRuntimeHydrator.ts src/services/layerPlaybackManager.ts src/services/slotDeckManager.ts src/services/compositionRenderer.ts tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest primary lazy media/image allocator admission check: `npm run test -- tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts` passed with 47 tests.
- `npx eslint src/services/timeline/lazyImageElements.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest thumbnail allocator admission check: `npm run test -- tests/unit/thumbnailCacheService.test.ts tests/unit/thumbnailBitmapCache.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts` passed with 31 tests.
- `npx eslint src/services/thumbnailCacheService.ts src/services/timeline/thumbnailRuntimeReporting.ts src/services/timeline/thumbnailBitmapCache.ts src/services/timeline/runtimeCoordinatorTypes.ts src/services/timeline/runtimeCoordinatorContracts.ts tests/unit/thumbnailCacheService.test.ts tests/unit/thumbnailBitmapCache.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest Vector user-action data-only check: `npm run test -- tests/unit/vectorUserActionDataOnly.test.ts tests/unit/clipboardPasteDataOnly.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts` passed with 163 tests.
- `npx eslint src/services/layerBuilder/LayerBuilderService.ts src/engine/export/ExportLayerBuilder.ts src/stores/timeline/clip/addLottieClip.ts src/stores/timeline/clip/addRiveClip.ts src/stores/timeline/clipboardSlice.ts src/stores/mediaStore/slices/fileManageSlice.ts tests/unit/vectorUserActionDataOnly.test.ts tests/unit/clipboardPasteDataOnly.test.ts tests/stores/mediaStore/fileManageSlice.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest 3D media-owned URL user-action check: `npm run test -- tests/unit/spatialClipUrlOwnership.test.ts tests/unit/clipboardPasteDataOnly.test.ts tests/stores/mediaStore/fileManageSlice.test.ts` passed with 123 tests.
- `npx eslint src/stores/timeline/clip/addModelClip.ts src/stores/timeline/clip/addGaussianSplatClip.ts src/stores/mediaStore/slices/fileManageSlice.ts src/stores/timeline/clipboardSlice.ts src/components/timeline/hooks/useExternalDrop.ts tests/unit/spatialClipUrlOwnership.test.ts tests/unit/clipboardPasteDataOnly.test.ts tests/stores/mediaStore/fileManageSlice.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest combined user-action video/audio data-only check: `npm run test -- tests/unit/addVideoClip.test.ts tests/unit/clipboardPasteDataOnly.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/completeDownloadDataOnly.test.ts tests/unit/lazyMediaElements.test.ts` passed with 129 tests.
- Latest download completion video/audio data-only check: `npm run test -- tests/unit/completeDownloadDataOnly.test.ts` passed with 1 test.
- `npx eslint src/stores/timeline/clip/completeDownload.ts tests/unit/completeDownloadDataOnly.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest media relink/reload video/audio data-only check: `npm run test -- tests/stores/mediaStore/fileManageSlice.test.ts` passed with 118 tests.
- `npx eslint src/stores/mediaStore/slices/fileManageSlice.ts tests/stores/mediaStore/fileManageSlice.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest timeline video/audio paste data-only check: `npm run test -- tests/unit/clipboardPasteDataOnly.test.ts tests/unit/addVideoClip.test.ts tests/unit/lazyMediaElements.test.ts` passed with 10 tests.
- `npx eslint src/stores/timeline/clipboardSlice.ts tests/unit/clipboardPasteDataOnly.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest direct browser video/audio add data-only check: `npm run test -- tests/unit/addVideoClip.test.ts tests/unit/lazyMediaElements.test.ts` passed with 9 tests.
- `npx eslint src/stores/timeline/clip/addVideoClip.ts src/stores/timeline/clip/addAudioClip.ts src/stores/timeline/helpers/webCodecsHelpers.ts tests/unit/addVideoClip.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest playback/export composition-audio mixdown-on-demand check: `npm run test -- tests/unit/compositionAudioMixdownCache.test.ts tests/unit/audioExportPipeline.test.ts tests/unit/audioScrubSync.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts` passed with 244 tests.
- `npx eslint src/services/timeline/compositionAudioMixdownCache.ts src/engine/audio/AudioExportPipeline.ts src/services/layerBuilder/AudioTrackSyncManager.ts tests/unit/compositionAudioMixdownCache.test.ts tests/unit/audioExportPipeline.test.ts tests/unit/audioScrubSync.test.ts src/stores/timeline/clip/addCompClip.ts src/stores/timeline/helpers/audioTrackHelpers.ts src/stores/timeline/editOperations/splitBatchOperations.ts src/stores/timeline/clipSlice.ts tests/unit/addCompClipNestedRestore.test.ts tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest AddComp/Split composition-audio lazy placeholder check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts` passed with 218 tests.
- `npx eslint src/stores/timeline/clip/addCompClip.ts src/stores/timeline/helpers/audioTrackHelpers.ts src/stores/timeline/editOperations/splitBatchOperations.ts src/stores/timeline/clipSlice.ts tests/unit/addCompClipNestedRestore.test.ts tests/stores/timeline/clipSlice.test.ts tests/unit/timelineEditOperations.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest lazy video/audio object URL ownership check: `npm run test -- tests/unit/lazyMediaElements.test.ts tests/unit/mediaObjectUrlManager.test.ts` passed with 13 tests.
- `npx eslint src/services/timeline/lazyMediaElements.ts src/services/project/mediaObjectUrlManager.ts tests/unit/lazyMediaElements.test.ts tests/unit/mediaObjectUrlManager.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest Mask/Text path-keyframe routing check: `npm run test -- tests/stores/timeline/keyframeSlice.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts` passed with 181 tests.
- `npx eslint src/stores/timeline/keyframeSlice.ts src/stores/timeline/types.ts src/components/preview/useMaskVertexDrag.ts src/components/preview/useMaskEdgeDrag.ts tests/stores/timeline/keyframeSlice.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest path-value keyframe kernel check: `npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts` passed with 56 tests.
- `npx eslint src/stores/timeline/editOperations/applyTimelineEditOperation.ts tests/unit/timelineEditOperations.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest curve-editor transaction routing check: `npm run test -- tests/unit/CurveEditor.test.tsx tests/unit/TimelineTrack.test.tsx tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts` passed with 87 tests.
- `npx eslint src/components/timeline/CurveEditor.tsx src/components/timeline/TimelineTrack.tsx tests/unit/CurveEditor.test.tsx tests/unit/TimelineTrack.test.tsx`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest keyframe tick-drag transaction routing check: `npm run test -- tests/unit/ClipInteractionShell.contract.test.tsx tests/unit/TimelineTrack.test.tsx tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts` passed with 100 tests.
- `npx eslint src/components/timeline/hooks/useClipKeyframeTickDrag.ts src/components/timeline/interactionShell/ClipKeyframeTicks.tsx src/components/timeline/interactionShell/types.ts src/components/timeline/TimelineTrack.tsx src/components/timeline/Timeline.tsx src/components/timeline/types.ts src/stores/timeline/editOperations/types.ts src/stores/timeline/editOperations/applyTimelineEditOperation.ts tests/unit/ClipInteractionShell.contract.test.tsx tests/unit/TimelineTrack.test.tsx`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest Fade transaction/hook migration check: `npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts tests/unit/timelineEditReplayDescriptors.test.ts` passed with 61 tests.
- `npx eslint src/components/timeline/hooks/useClipFade.ts src/components/timeline/Timeline.tsx src/stores/timeline/editOperations/applyTimelineEditOperation.ts tests/unit/timelineEditOperations.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- `npm run test -- tests/unit/clipContextMenu.test.ts tests/unit/trackContextMenu.test.ts tests/unit/timelineEmptyContextMenu.test.ts tests/unit/TimelineContextMenu.test.tsx tests/unit/TrackContextMenu.test.tsx tests/unit/audioRegionContextMenu.test.ts`
- `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/historyRuntimeRehydration.test.ts tests/stores/historyStore.test.ts`
- Latest nested-restore consolidation check: `npm run test -- tests/unit/serializationNestedRestore.test.ts` now covers direct nested audio as data-only and passed with 7 tests.
- `npm run test -- tests/unit/projectMediaPersistence.test.ts` passed with 26 tests, including the post-relink nested video/audio data-only restore regression through `loadProjectToStores`.
- `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 33 tests.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/services/project/projectLoad.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 38 tests.
- `npx eslint src/stores/timeline/clip/addCompClip.ts tests/unit/addCompClipNestedRestore.test.ts src/services/timeline/lazyMediaElements.ts tests/unit/lazyMediaElements.test.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/services/project/projectLoad.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest model-restore consolidation check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 42 tests. It covers AddCompClip direct/sub-nested model sequence URLs without new blob URLs, managed blob fallback ownership, stale model blob URL rejection, serialization nested model restore, and project-load nested model relink.
- `npx eslint src/stores/timeline/restoredMediaSource.ts src/stores/timeline/clip/addCompClip.ts src/services/layerBuilder/LayerBuilderService.ts src/engine/export/ExportLayerBuilder.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest preview/export model fallback check: `npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts` passed with 37 tests.
- Latest restore/model focused regression set: `npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 78 tests.
- `npx eslint tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts src/services/layerBuilder/LayerBuilderService.ts src/engine/export/ExportLayerBuilder.ts src/stores/timeline/restoredMediaSource.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested image/math/model helper check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 44 tests. It covers managed nested image blob ownership for AddCompClip and `loadState`, managed nested model fallback ownership for AddCompClip and `loadState`, plus existing nested video/audio/model restore regressions.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/services/project/projectLoad.ts src/stores/timeline/clip/addCompClip.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Combined focused restore/model checkpoint: `npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 80 tests.
- Latest nested vector helper check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 46 tests. It covers nested vector runtime prep through `loadState` and the AddComp direct nested async store-patch path.
- Combined focused restore/model/vector checkpoint: `npm run test -- tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 82 tests.
- Latest runtime cleanup check: `npm run test -- tests/unit/lazyMediaElements.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts` passed with 10 tests. It covers top-level and nested lazy-media global release without a frame context, plus `compositionRenderer` pending video/image dispose/invalidate before load events.
- `npx eslint src/services/timeline/lazyMediaElements.ts tests/unit/lazyMediaElements.test.ts src/services/compositionRenderer.ts tests/unit/compositionRendererRuntimeReporting.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Historical top-level image/model/vector/gaussian restore check before the later data-only image cut: `npm run test -- tests/unit/serializationNestedRestore.test.ts` passed with 17 tests. It covered managed top-level image and model fallback ownership, image load patching at that time, lottie/rive shared runtime restore without object URLs, gaussian-splat sequence URL reuse without duplicate object URLs, and revocation through `clearTimeline()`.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested/add-comp/project-load gaussian restore check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 56 tests. It covers AddComp direct/sub-nested gaussian sequence URL reuse without duplicate object URLs, managed gaussian file fallback ownership, `loadState` direct nested gaussian sequence restore, top-level gaussian restore, and project-load post-relink nested gaussian restore.
- `npx eslint src/stores/timeline/restoredMediaSource.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/clip/addCompClip.ts src/stores/timeline/serializationUtils.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest media-scoped URL ownership check: `npm run test -- tests/unit/mediaObjectUrlManager.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 147 tests. It covers manager revoke/replace behavior, media removal/reload cleanup for model and gaussian sequence frame blob URLs, project-load cleanup of previous media-state sequence URLs, and `updateTimelineClips(...)` reuse of media-owned sequence URLs without clip-scoped duplicates.
- `npx eslint src/services/project/mediaObjectUrlManager.ts src/services/project/projectLoad.ts src/services/project/relinkMedia.ts src/stores/mediaStore/slices/fileManageSlice.ts tests/unit/mediaObjectUrlManager.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest legacy gaussian-avatar ownership check: `npm run test -- tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 137 tests. It covers top-level and direct nested legacy avatar restore with managed blob ownership, `clearTimeline()` revocation, and `updateTimelineClips(...)` using the same avatar blob key.
- Latest combined restore regression check after the avatar slice: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 59 tests.
- `npx eslint src/stores/timeline/restoredMediaSource.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/stores/timeline/clip/addCompClip.ts src/services/project/projectLoad.ts src/stores/mediaStore/slices/fileManageSlice.ts tests/unit/serializationNestedRestore.test.ts tests/stores/mediaStore/fileManageSlice.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- `npx tsc -p tsconfig.node.json --noEmit --pretty false`
- Latest durable primary media URL ownership check: `npm run test -- tests/unit/mediaObjectUrlManager.test.ts tests/unit/importPipeline.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectSliceCompatibility.test.ts` passed with 129 tests. It covers stable primary media keys, delayed import primary URL creation, refresh/reload reuse of media-owned URLs, and `newProject()` cleanup.
- `npx eslint src/services/project/mediaObjectUrlManager.ts src/stores/mediaStore/helpers/importPipeline.ts src/services/project/projectLoad.ts src/services/project/relinkMedia.ts src/stores/mediaStore/slices/fileManageSlice.ts src/stores/mediaStore/slices/projectSlice.ts src/stores/mediaStore/legacyStartupRestore.ts src/stores/mediaStore/slices/duplicateSlice.ts src/stores/mediaStore/helpers/modelSequenceImport.ts src/stores/mediaStore/helpers/gaussianSplatSequenceImport.ts tests/unit/mediaObjectUrlManager.test.ts tests/unit/importPipeline.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectSliceCompatibility.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested shell/primitive restore dedupe check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 34 tests. It covers shared nested composition/media shell migration, direct/sub-nested primitive mesh restore without media files, and model-sequence clips with `meshType` staying on the model-sequence path.
- `npm run test -- tests/unit/projectMediaPersistence.test.ts` passed with 29 tests after the `projectLoad.ts` primitive fallback import/path change.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/stores/timeline/clip/addCompClip.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested spatial source dedupe check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 65 tests. It covers the shared `model` / `gaussian-splat` / legacy `gaussian-avatar` sync source helper through AddComp, loadState, and project-load nested restore paths, including new direct/sub-nested AddComp avatar blob fallback coverage.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/stores/timeline/clip/addCompClip.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Historical async Image/Vector restore starter check before the later data-only image cut: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 67 tests. It covered shared Image/Vector async starters at that time, AddComp direct/sub-nested Image load callback patching, `loadState` direct/sub-nested Image tree patching, existing nested Vector runtime restore, and project-load nested restore regressions.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/stores/timeline/clip/addCompClip.ts src/stores/timeline/clipSlice.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest recursive nested patch / stale Vector check: `npm run test -- tests/unit/nestedRestoreRuntimeHelpers.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 44 tests. It covers recursive nested tree patching, stale Image suppression, stale Vector cleanup without render/mutation, overlapping same-clip Vector generations, AddComp direct stale Vector guard wiring, AddComp sub-nested Image immutable tree patching, and existing serialization restore coverage.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/serializationUtils.ts src/stores/timeline/clip/addCompClip.ts src/services/project/projectLoad.ts src/services/vectorAnimation/LottieRuntimeManager.ts src/services/vectorAnimation/RiveRuntimeManager.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest project-load nested delegation check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 50 tests. It covers project-load post-relink delegation to `loadNestedClips(...)`, recursive grandchild composition rebuild, stale project-load image patch blocking after a timeline session change, direct/sub-nested motion restore, stale nested keyframe merge blocking, and direct Vector early completion before store installation.
- `npx eslint src/stores/timeline/clip/addCompClip.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest neutral nested loader extraction check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 74 tests. It covers the new `nestedCompositionLoader.ts` ownership, AddComp/project-load restore parity, recursive reload, stale session/image patch guards, stale nested keyframe merge blocking, and same-id composition-identity relink blocking.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/clip/addCompClip.ts src/stores/timeline/clipSlice.ts src/stores/timeline/serializationUtils.ts src/services/project/projectLoad.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest recursive nested keyframe collector convergence check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 76 tests. It covers shared recursive keyframe ID remapping for nested composition clips and sub-nested media clips through both `loadNestedClips(...)` and `serializationUtils.loadState()`.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/serializationUtils.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested segment scheduling convergence check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 78 tests. It covers the shared async segment build/apply core, stale-session segment guard, and existing AddComp/project-load/loadState nested restore regressions.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/clipSlice.ts src/stores/timeline/serializationUtils.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested helper coverage hardening check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 80 tests. It adds direct proof that composition thumbnail generation forwards normalized boundaries to `thumbnailRenderer.generateCompositionThumbnails(...)`, writes returned thumbnails to the comp clip, and calculates nested clip boundaries from visible video tracks only.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/clipSlice.ts src/stores/timeline/serializationUtils.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/setup.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested keyframe merge convergence check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 51 tests. It covers `mergeNestedClipKeyframes(...)` preserving unrelated keyframes, skipping stale-session writes, treating empty nested keyframe maps as non-blocking no-ops, and the shared merge helper being used by both `loadNestedClips(...)` and `serializationUtils.loadState()`.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/serializationUtils.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest combined nested restore checkpoint after the merge helper docs update: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 83 tests.
- Latest neutral restore-hooks policy check: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts` passed with 29 tests. It covers direct/sub-nested runtime-ready events, stale runtime completions not firing hooks, default missing image/vector files staying non-loading null-source placeholders, and opt-in `mediaRelink` hooks marking `needsReload` plus fallback source metadata.
- Latest combined nested restore checkpoint after restore-hooks policy: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 85 tests.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts tests/unit/addCompClipNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest loadState neutral-loader migration check: `npm run test -- tests/unit/serializationNestedRestore.test.ts` passed with 28 tests. It covers direct/sub-nested image preview wakeups, direct nested Vector preview wakeup, stale nested Vector completions not patching or waking preview, missing nested image/vector/model relink fallback semantics, and the `serializationUtils.loadState()` delegation to `loadNestedClips(..., { restoreHooks })`.
- Latest combined nested restore checkpoint after loadState delegation: `npm run test -- tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 89 tests.
- `npx eslint src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/serializationUtils.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest top-level spatial/project-load policy cleanup check: `npm run test -- tests/unit/projectMediaPersistence.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts` passed with 99 tests. It covers project-load unavailable nested non-video placeholders, shared top-level spatial restore through `applyManagedRestoredSpatialSource(...)`, canonical nested restore helper imports, removal of unused nested helper alias exports, post-relink rebuild of already-populated nested `needsReload` fallback trees, and top-level image/vector relink plus stale Vector runtime completion guards.
- `npx eslint src/stores/timeline/serializationUtils.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/nestedCompositionLoader.ts tests/unit/projectMediaPersistence.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest top-level restore dispatcher extraction check: `npm run test -- tests/unit/serializationNestedRestore.test.ts` passed with 31 tests after `serializationUtils.loadState()` moved initial restored media source selection and top-level image/vector/spatial runtime dispatch into narrow helpers.
- `npx eslint src/stores/timeline/serializationUtils.ts tests/unit/serializationNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest worker wire contract extraction check: `npm run test -- tests/unit/timelineClipCanvasWorkerModel.test.ts tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx` passed with 31 tests after adding `timelineClipCanvasWorkerContract.ts` and wiring the model, worker, and React owner to the same init/draw/outgoing/resource types.
- `npx eslint src/components/timeline/utils/timelineClipCanvasWorkerContract.ts src/components/timeline/utils/timelineClipCanvasWorkerModel.ts src/components/timeline/workers/timelineClipCanvas.worker.ts src/components/timeline/TimelineClipCanvas.tsx tests/unit/timelineClipCanvasWorkerModel.test.ts tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest worker-positive live-smoke hook check: `npm run test -- tests/unit/timelineCanvasSmokeHandlers.test.ts` passed with 14 tests after `runTimelineCanvasLargeProjectSmoke` gained optional real-timeline cached-thumbnail bitmap warmup reporting, fallback-reason whitelisting, and the runner gained `workerPositiveLive`.
- `node scripts/run-timeline-canvas-verification.mjs --help`
- `npx eslint src/services/aiTools/handlers/timelineCanvasSmoke.ts tests/unit/timelineCanvasSmokeHandlers.test.ts scripts/run-timeline-canvas-verification.mjs`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest NativeHelper restore URL ownership check: `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/mediaObjectUrlManager.test.ts` passed with 38 tests. It covers NativeHelper-recovered top-level image files using media-scoped primary object URL ownership, no clip-scoped image blob URL for that path, and native video/audio restore staying data-only without `getReferencedFile()` or `URL.createObjectURL()`.
- `npx eslint src/stores/timeline/serializationUtils.ts tests/unit/serializationNestedRestore.test.ts tests/unit/mediaObjectUrlManager.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest restore-scoped vector helper extraction check: `npm run test -- tests/unit/nestedRestoreRuntimeHelpers.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts` passed with 69 tests. It covers the new `vectorRuntimeRestore.ts` module, the remaining `nestedRestore.ts` image/tree helper surface, AddComp wiring, and existing loadState vector/image regressions.
- `npx eslint src/stores/timeline/vectorRuntimeRestore.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/nestedCompositionLoader.ts src/stores/timeline/serializationUtils.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest top-level stale image URL hardening check: `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/mediaObjectUrlManager.test.ts` passed with 39 tests. It covers stale/unmanaged top-level image blob URLs being replaced by a managed clip-owned image URL when a browser file is available, while primary media-owned image URLs remain reusable.
- `npx eslint src/stores/timeline/serializationUtils.ts src/stores/timeline/vectorRuntimeRestore.ts src/stores/timeline/nestedRestore.ts src/stores/timeline/nestedCompositionLoader.ts tests/unit/serializationNestedRestore.test.ts tests/unit/mediaObjectUrlManager.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest cached thumbnail media URL ownership check: `npm run test -- tests/unit/mediaObjectUrlManager.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectMediaPersistence.test.ts` passed with 156 tests. It covers the new media-owned thumbnail URL key, `ensureFileThumbnail()` stored project/DB thumbnail blobs, and existing project-load media persistence regressions after cached thumbnail restore moved to blob-to-managed-url apply.
- `npx eslint src/services/project/mediaObjectUrlManager.ts src/services/project/projectLoad.ts src/stores/mediaStore/legacyStartupRestore.ts src/stores/mediaStore/slices/fileManageSlice.ts tests/unit/mediaObjectUrlManager.test.ts tests/stores/mediaStore/fileManageSlice.test.ts tests/unit/projectMediaPersistence.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest interactive lazy image preview check: `npm run test -- tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts` passed with 32 tests. It covers data-only image preview hydration without mutating `clip.source`, file-backed image object URL release, LayerBuilder image fallback, and preview wakeup through `engine.requestRender()`.
- `npx eslint src/services/timeline/lazyImageElements.ts src/services/layerBuilder/LayerBuilderService.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Top-level image restore/export check before the later nested-image data-only cut: `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/clipPreparation.test.ts` passed with 82 tests. It covers top-level image restore as data-only `source.imageUrl`, preview lazy hydration, ExportLayerBuilder image state fallback, ClipPreparation image load, and export-owned image URL cleanup.

- Latest shared image runtime hydrator check: `npm run test -- tests/unit/compositionRendererRuntimeReporting.test.ts tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts` passed with 46 tests. It covers composition render data-only image hydration, active restored image clips from `source.imageUrl`, cancellable pending image hydration for background layers and warm slot decks, lazy-image overlay callbacks for `useLayerSync`, and no mutation of persisted clip sources.
- `npx eslint src/types/index.ts src/services/timeline/lazyImageElements.ts src/stores/timeline/serializationUtils.ts src/engine/export/types.ts src/engine/export/ClipPreparation.ts src/engine/export/ExportLayerBuilder.ts src/services/layerBuilder/LayerBuilderService.ts tests/unit/serializationNestedRestore.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts tests/unit/exportLayerBuilder.test.ts tests/unit/clipPreparation.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest nested image data-only restore check: `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts` passed with 102 tests. It covers direct and sub-nested restored image clips as managed `source.imageUrl` descriptors, immediate runtime-ready notifications without `Image` construction, project-load stale-session behavior, AddComp nested restore parity, and removal of the old restore-time image runtime helper.
- `npx eslint src/stores/timeline/nestedRestore.ts src/stores/timeline/nestedCompositionLoader.ts tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest add-image/image-paste data-only check: `npm run test -- tests/unit/addImageClip.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts tests/unit/clipPreparation.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts tests/unit/serializationNestedRestore.test.ts` passed with 77 tests. It covers newly added image clips writing managed `source.imageUrl` after thumbnail/native-scale preparation, image clipboard paste writing `source.imageUrl` through `blobUrlManager`, and the existing lazy/preview/export/composition render image paths.
- `npx eslint src/stores/timeline/clip/addImageClip.ts src/stores/timeline/clipboardSlice.ts src/services/timeline/imageRuntimeHydrator.ts tests/unit/addImageClip.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest transition preview/drop-clear check: `npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts tests/unit/timelineToolOverlayLayer.test.ts tests/unit/timelineEditReplayDescriptors.test.ts` passed with 61 tests. It covers executable `transition-preview-drop` / `transition-clear-preview` store state, hook-dispatched blocked preview, overlay ghost-range propagation, structured-clone contracts, and guided-action replay descriptors.
- `npx eslint src/components/timeline/hooks/useTransitionDrop.ts src/stores/timeline/editOperations/applyTimelineEditOperation.ts src/stores/timeline/editOperations/types.ts src/stores/timeline/types.ts src/services/guidedActions/choreography/timelineEditReplayDescriptors.ts tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditReplayDescriptors.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- Latest keyframe transaction kernel check: `npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts tests/unit/timelineEditReplayDescriptors.test.ts` passed with 59 tests. It covers executable keyframe transaction begin/update/commit/cancel paths for numeric create/move/update/remove/easing/bezier/rotation/selection, mixed missing/locked warnings, guided replay descriptors, and explicit Fade begin validation with non-begin Fade execution still `unsupported`.
- `npx eslint src/stores/timeline/editOperations/applyTimelineEditOperation.ts src/stores/timeline/editOperations/types.ts src/services/guidedActions/choreography/timelineEditReplayDescriptors.ts tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditReplayDescriptors.test.ts`
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- touched-file ESLint for the latest menu/restore slices
- `npx tsc -p tsconfig.app.json --noEmit --pretty false`
- `git diff --check` had only existing CRLF warnings

Earlier in the refactor batch, full `npm run build`, `npm run lint`, and
`npm run test` passed after the full runner. They have not been rerun after the
latest restore/menu slices.

## Focused Test Map

- Restore/data-only boundary: `tests/unit/serializationNestedRestore.test.ts`,
  `tests/unit/historyRuntimeRehydration.test.ts`, and
  `tests/stores/historyStore.test.ts`.
- Context-menu command models: `tests/unit/clipContextMenu.test.ts`,
  `tests/unit/trackContextMenu.test.ts`, and
  `tests/unit/timelineEmptyContextMenu.test.ts`.
- Canvas/worker/smoke: `tests/unit/timelineClipCanvasWorkerModel.test.ts`,
  `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx`, and
  `tests/unit/timelineCanvasSmokeHandlers.test.ts`.
- Missing or mostly transitive focused tests: `historyTimelineRestoreState.ts`,
  `timelineActiveTargets.ts`, `audioSpectrogramPresence.ts`, and the shared
  provider-status/reporting helpers.

## 2026-06-04 Multi-Agent Audits

Earlier read-only agents audited the 40% project-load window plus restore/runtime
side effects and duplicate hydration paths. A later multi-agent read-only audit
checked this handoff against the plan, code, tests, runtime restore paths,
worker/canvas code, and handoff-usability. No build/tests were run during the
audits. Consensus findings:

- Video/audio restore is already data-only for top-level clips, direct nested
  video, sub-nested video, and composition-audio clips. Do not rebuild this.
- This older audit's 75-80% breadth / 72-78% effort estimate has been
  superseded by the current top-of-file about-96% effective / about-97% breadth
  split after the
  nested/add-comp/project-load gaussian restore, media-scoped sequence URL
  ownership, legacy gaussian-avatar ownership, durable primary media URL
  ownership, image-hydration slices, first nested shell/primitive restore
  dedupe, nested spatial source dedupe, recursive runtime patching,
  project-load nested delegation, top-level dispatcher extraction, worker
  contract slices, AddComp/Split composition-audio placeholder cleanup, and
  playback/export composition-audio mixdown-on-demand helper.
- Phase 5 is the main over-credit risk: coordinator work is reporting/adapters,
  while allocator/runtime-hydrator ownership remains open. The first
  playback/export composition-audio mixdown-on-demand helper is already built.
- Worker proof is real, but `timelineCanvasWorker` remains default-off.
- `LayerBuilderService.buildLayersFromStore(...)` is the active timeline runtime
  driver and delegates element creation to `hydrateTimelineMediaWindow(...)`.
  It should remain the main video/audio runtime path.
- `compositionRenderer` still eagerly creates video/image elements and blob URLs
  for non-active/background compositions. This is intentional runtime work, not
  a restore duplicate. Its in-flight load cleanup gap has been fixed: pending
  video/image loads now have immediate disposers for dispose/invalidate.
- `relinkMedia.ts` object URLs are intentional relink runtime paths. Existing
  replacement code revokes old blob URLs.
- `mixdownBuffer` has no accidental load-time creation in the audited paths.
  Mixdowns are edit/playback/export runtime work, while load keeps composition
  audio data-only.
- The important duplicate risk used to be nested-composition restoration. The
  internal `serializationUtils.ts` level-1/recursive split has been removed,
  and `serializationUtils.loadState()` now delegates nested tree construction
  to `nestedCompositionLoader.ts:loadNestedClips(..., { restoreHooks })`.
  Remaining drift risk is mostly caller policy: loadState uses relink/preview
  hooks, while `projectLoad.ts:reloadNestedCompositionClips(...)` is a guarded
  post-relink caller with a neutral missing-source policy.
- Forced worker smokes run by default in `scripts/run-timeline-canvas-verification.mjs`;
  use `--skip-worker-smokes` to omit them.

Resolved dead/accidental path:

- In `projectLoad.ts`, `reloadNestedCompositionClips(...)` already short-circuits
  video/audio to data-only sources. The later unreachable
  `document.createElement('video')` and `document.createElement('audio')`
  branches have been removed.
- The same function previously created `fileUrl = URL.createObjectURL(...)`
  before checking the remaining type. That URL is now created only in the live
  image branch, so model/gaussian nested reload paths no longer mint unused
  blob URLs in this function.
- In `serializationUtils.loadState()`, the direct level-1 nested restore path no
  longer has its own clip-building loop separate from recursive nested restore.
  Direct and deeper nested composition clips now run through
  `nestedCompositionLoader.ts:loadNestedClips(..., { restoreHooks })`.
- Nested video and nested audio in `serializationUtils.loadState()` now restore
  as data-only sources. Nested audio no longer falls through to unused
  `URL.createObjectURL(...)` allocation, and focused tests assert no video/audio
  element creation, object URLs, or eager mixdowns for that path.
- `src/stores/timeline/restoredMediaSource.ts` now owns the shared data-only
  video/audio source descriptor contract. Both `serializationUtils.loadState()`
  and `projectLoad.ts:reloadNestedCompositionClips()` use
  `createDataOnlyRestoredMediaSource(...)` for nested video/audio, so the
  `mediaFileId`, `naturalDuration`, and `filePath` behavior cannot drift there.
- `src/hooks/useThumbnailCache.ts` has been deleted after the canvas migration.
  Active thumbnail consumers use `thumbnailCacheService`,
  `thumbnailBitmapCache`, and `TimelineClipCanvas`; current feature docs no
  longer point agents at the retired hook.

Runtime cleanup gaps resolved in the latest slice:

- `compositionRenderer` now registers pending video/image disposers before
  waiting for `canplaythrough`/`onload`, so dispose/invalidate releases pending
  elements/object URLs and unblocks the prepare promise immediately.
- `releaseAllLazyTimelineMediaElements()` now clears top-level and nested
  `clip.source.videoElement` / `clip.source.audioElement` refs without needing
  a live frame context.
- 2026-06-05 follow-up agent audit confirmed the former largest true duplicate
  was nested restore; that area is now mostly converged through
  `nestedCompositionLoader.ts` / `nestedRestore.ts`. Remaining drift is mostly
  policy-level restore/relink behavior and allocator/runtime ownership. Smaller
  future dedupe candidates are runtime reporting media-status helpers, repeated
  runtime resource-kind arrays, active-target ignore selector logic,
  worker/main-canvas drawing constants, spectrogram color mapping, and
  `TimelineTrack.tsx` source-timing helpers. None of these indicate a second
  active full DOM clip renderer.

Project-load nested reload consolidation guardrails:

- Do not reintroduce a `serializationUtils.loadState()` local nested builder or
  move that logic back into `projectLoad.ts:reloadNestedCompositionClips()`.
  The correct current consolidation is the opposite: both callers delegate
  nested tree construction to `nestedCompositionLoader.ts:loadNestedClips(...)`,
  while keeping their caller-specific guards, missing-source policy, boundaries,
  and thumbnail calls.
- `loadNestedClips(...)` is now the neutral shared loader for AddComp and
  project-load post-relink restore. It no longer eagerly creates video/audio
  elements for restored nested video/audio; those paths are data-only.
- The next architecture step is to converge remaining `serializationUtils.ts`
  top-level media restore policy and any remaining non-nested runtime hydration
  branches, not the old nested builder. `serializationUtils.ts` no longer has a
  local recursive `loadNestedCompositionClips(...)` function.
- Project-load focused coverage now includes both the old
  `loadProjectToStores(...)` post-relink video/audio regression and the
  exported internal `reloadNestedCompositionClips(...)` seam for delegated
  recursive reload and stale image-session blocking.

## 2026-06-04 Duplicate And Dead-Code Audit

Read-only agents plus local `rg`/diff checks audited the current working tree
for accidental parallel implementations. No files were edited by the agents.

Local duplicate-function scan:

- A repo-wide function-name scan finds many duplicate local UI names such as
  `handleMouseMove`, `handleMouseUp`, `handleKeyDown`, `cleanup`, and `clamp`.
  These are ordinary local handlers/helpers, not duplicate feature modules.
- A focused exported-name scan over changed/untracked timeline files found no
  duplicated new feature exports. The only relevant-looking matches were
  existing type/component names (`TimelineState`, `TimelineTrack`), not parallel
  implementations.
- No active source import back to deleted `TimelineClip.tsx` was found.
- No import or export resolves to any deleted DOM clip module.
- No duplicate exported name was found between untracked new `.ts`/`.tsx` files
  and the rest of `src`/`tests`.
- No second full passive DOM clip renderer was found. The active split is:
  product-default main-thread canvas renderer plus default-off worker renderer.
- Therefore, do not use a raw duplicate-name count as a completion metric. The
  98% estimate is not supported by the current code audit; use the current
  top-of-file progress numbers instead of this older audit's lower range.

## 2026-06-05 Follow-Up Duplicate Audit

Three read-only agents plus local `rg`, `git diff --stat`, and
`npm run swarm:status` rechecked whether the remaining work had already been
done under duplicate names.

Consensus:

- Historical note: this audit originally estimated about 75% overall /
  72-78% effort-weighted. That was superseded by the current top-of-file
  about-96% effective / about-97% breadth split after later restore, URL
  ownership, image-hydration, shell/primitive/spatial, async starter,
  recursive patch hardening, project-load nested delegation, top-level
  dispatcher extraction, worker contract slices, AddComp/Split composition-audio
  placeholder cleanup, and playback/export composition-audio mixdown-on-demand.
- No active source import points back to the deleted full `TimelineClip.tsx`
  renderer. The old DOM passive clip components, hooks, helper files, and their
  stale tests are deleted or unreferenced in the current working tree.
- There is no second active full DOM clip body. `TimelineClipCanvas.tsx` is the
  product-default renderer. `timelineClipCanvas.worker.ts` is the default-off
  worker proof path and must not be deleted while `timelineCanvasWorker` remains
  false.
- At the time of that older audit, the real active duplication was nested restore:
  the removed `serializationUtils.ts:loadNestedCompositionClips(...)` builder,
  `projectLoad.ts:reloadNestedCompositionClips(...)`, and the old
  `addCompClip.ts:loadNestedClips(...)` ownership. Video/audio data-only restore
  is now consolidated for restore, and model/gaussian/avatar sync source
  branching, async image/vector starters, recursive runtime patching,
  project-load post-relink delegation, and the neutral loader move have since
  been shared. Remaining spread-out parts are mostly top-level
  `serializationUtils.ts` restore policy versus caller-specific policy and
  mixdown behavior.
- `createNestedClipId(...)` duplication has already been removed. New work
  should keep using `generateNestedClipId(...)`.
- The first nested model restore consolidation slice is now done:
  `restoredMediaSource.ts` owns `createDataOnlyRestoredModelSource(...)` and
  the shared `getReusableModelUrl(...)` guard; `serializationUtils.ts`,
  `projectLoad.ts`, `addCompClip.ts`, `LayerBuilderService.ts`, and
  `ExportLayerBuilder.ts` use that shared path for model sequence / reusable URL
  fallback. Direct and sub-nested AddCompClip model restore no longer creates a
  new blob URL when a sequence frame URL or reusable media URL exists.
- The preview/export model fallback proof is now done. New focused tests cover
  missing `clip.source.modelUrl` with fallback from `mediaFile.modelSequence`
  and from `mediaFile.url` in both `LayerBuilderService` and
  `ExportLayerBuilder`.
- Main-thread canvas drawing and worker drawing intentionally duplicate some
  visual work for now. Known drift example: `LOD_LABEL_PX` is `14` in
  `TimelineClipCanvas.tsx` and `24` in `timelineClipCanvas.worker.ts`.
- `renderModel/` is a useful contract/test/history scaffold, but the live
  renderer still uses `TimelineClipCanvas.tsx` and
  `timelineClipCanvasWorkerModel.ts`. Do not call the refactor complete until
  this is either intentionally documented as a contract layer or more directly
  wired into the live render path.
- Context-menu command models are real and not duplicate renderers. The pure
  models exist, but `TimelineContextMenu.tsx` still owns side-effecting handlers
  for proxy, thumbnail, explorer, and transcription work.

Actionable conclusion:

- Do not rebuild the deleted DOM clip body.
- Do not reimplement video/audio data-only restore.
- Next consolidation should move the remaining nested restore differences into
  `nestedCompositionLoader.ts` / `nestedRestore.ts` instead of adding another
  helper. The broad remaining non-video/audio work is image/vector/math parity
  and runtime allocator ownership, not the just-finished loader or model URL
  helper work.

High-confidence findings:

- `src/hooks/useThumbnailCache.ts` was confirmed dead after the canvas
  migration and has been deleted.
- The most important real restore overlap is now caller policy around the
  neutral nested loader:
  - `src/stores/timeline/serializationUtils.ts:loadState(...)` delegates nested
    tree construction to `loadNestedClips(..., { restoreHooks })` and owns
    load-state preview wake/relink fallback policy.
  - `src/stores/timeline/nestedCompositionLoader.ts:loadNestedClips(...)` owns
    AddComp/project-load/loadState nested tree construction, shared recursive
    keyframe remapping, shared boundaries, clip segment build/apply scheduling,
    composition thumbnail generation, recursive runtime patching, and direct
    project-load post-relink delegation.
  - `src/services/project/projectLoad.ts:reloadNestedCompositionClips(...)`
    remains a guarded post-relink caller around the neutral loader.
  Continue converging top-level `serializationUtils.ts` restore policy toward
  low-level `nestedRestore.ts` helpers. The post-relink video/audio data-only
  behavior is already regression-tested through `loadProjectToStores`; do not
  rebuild it.
- `src/stores/timeline/nestedRestore.ts:createNestedClipId(...)` duplicates
  `src/stores/timeline/helpers/idGenerator.ts:generateNestedClipId(...)`.
  This has been fixed: `createNestedClipId(...)` is gone, and
  `serializationUtils.ts` plus `projectLoad.ts` now call
  `generateNestedClipId(...)` directly.
- `restoredMediaSource.ts:createDataOnlyRestoredMediaSource(...)` is the only
  shared data-only video/audio descriptor helper. No second copy of that helper
  was found. Top-level video/audio restore in `serializationUtils.ts` still has
  some inline data-only/native branches that should later move through the same
  helper.
- `restoredMediaSource.ts:createDataOnlyRestoredVideoSource(...)` appears
  production-unused at this checkpoint and is only re-exported/tested. Either
  make it part of the canonical source helper API or remove it in a focused
  cleanup.
- Nested image restore is now pure data-only for restore-time state:
  `createDataOnlyRestoredImageSource(...)` creates managed `source.imageUrl`
  descriptors for direct and sub-nested image clips, while interactive preview,
  composition render, RAM preview, background layers, slot decks, and overlay
  sync hydrate images through bounded/cancellable runtime paths without mutating
  persisted clip state.
- Nested file-backed model restore now has a shared first-pass source contract:
  `restoredMediaSource.ts:createDataOnlyRestoredModelSource(...)` builds model
  sources with `mediaFileId`, `modelSequence`, `meshType`,
  `text3DProperties`, `modelFileName`, `threeDEffectorsEnabled`, and guarded
  reusable URL fallback. `serializationUtils.ts`, `projectLoad.ts`, and
  `addCompClip.ts` use it for nested model restore; `LayerBuilderService.ts`
  and `ExportLayerBuilder.ts` can fall back to media-file URLs/model sequences
  when `clip.source.modelUrl` is missing. Remaining work is broader nested
  restore module consolidation and preview/export-specific fallback tests, not
  another model helper.
- `src/services/timeline/lazyMediaElements.ts` is now nested-aware for active
  composition clips. It can hydrate data-only nested video/audio sources inside
  visible active composition windows and can prune those nested media elements by
  recursively finding nested clips during detach.
- `src/stores/timeline/clip/addCompClip.ts` no longer eagerly creates
  `HTMLVideoElement`, `HTMLAudioElement`, WebCodecs players, or blob URLs for
  direct nested and sub-nested video/audio clips. It now uses
  `createDataOnlyRestoredMediaSource(...)` for those branches. Its direct and
  sub-nested model branches now use `createDataOnlyRestoredModelSource(...)`
  first and only fall back to a `blobUrlManager` URL when no reusable model URL
  exists. Image, vector, math, and composition mixdown paths intentionally remain
  separate.
- `nestedRestore.ts` now also owns shared nested math-scene clip creation,
  managed data-only nested image source creation, and pending vector source
  descriptors. It also owns managed nested model fallback source creation and
  model field patching. Nested vector runtime preparation is centralized in
  `vectorRuntimeRestore.ts`, including metadata-duration resolution and
  first-frame rendering. `serializationUtils.ts`, `projectLoad.ts`, and
  `addCompClip.ts` have moved their nested math/image/model/vector branches
  onto these helpers. Nested image restore no longer does eager runtime
  hydration; nested model fallback blob ownership remains managed for these
  paths.
- Worker wire types are now centralized in
  `utils/timelineClipCanvasWorkerContract.ts`; remaining worker/main-thread
  drift risk is drawing logic/constants, not duplicate message/resource unions.
- Main-thread canvas drawing and worker drawing intentionally coexist, but their
  visual constants and drawing logic can still drift. Known drift: main canvas
  `LOD_LABEL_PX` is `14`, worker label threshold is `24`.
- Spectrogram color mapping is duplicated between `utils/spectrogramCanvas.ts`
  and `workers/timelineClipCanvas.worker.ts`; worker output uses a simpler LUT.
- Audio-clip detection is repeated across shell controls, main canvas, and
  worker model. Use one shared helper when touching audio-region, spectral,
  video-bake, canvas, or worker eligibility code.
- Source-timing and infinite-source logic is repeated between
  `utils/clipSourceTiming.ts` and local helpers in `TimelineTrack.tsx`.
- Timeline active-target / ignored-target logic is split between
  `utils/timelineActiveTargets.ts`, `Timeline.tsx`, and
  `hooks/useMarqueeSelection.ts`.
- Clip-to-media lookup callbacks are duplicated in `Timeline.tsx` and
  `TimelineContextMenu.tsx`; consolidate only when touching that area.
- The `html-media` provider-status diagnostics block is repeated across runtime
  reporters. Keep per-domain ledgers; only dedupe the inner provider-status
  builder if this area is touched.
- Runtime reporting is diagnostics/adapters, not allocator ownership. The
  `timelineRuntimeCoordinator` ledger is exposed through AI stats and smoke
  handlers, but current budgets are counted, not enforced.
- Runtime reporting has real helper duplication:
  `getSrcKind`, media status classification, retain wrappers, and identical
  render-resource-kind arrays are repeated across `runtimeResourceReporting.ts`,
  `exportRuntimeReporting.ts`, `ramPreviewRuntimeReporting.ts`,
  `compositionRenderRuntimeReporting.ts`, and
  `runtimeCoordinatorContracts.ts`. This is safe to consolidate, but not safe
  to delete at call sites.
- `timelineCanvasDiagnostics` and `timelineRuntimeCoordinator` are both emitted
  in `getStats`. They overlap as diagnostics but track different things:
  canvas draw health versus retained runtime resources. Decide whether to merge
  them before deleting either.
- Operation contracts and legacy store methods still intentionally coexist.
  Desktop drag, keyboard, transitions, and many AI paths use
  `applyTimelineEditOperation`, but legacy `removeClip`, `moveClip`, `trimClip`,
  and `splitClip` are still live for context menus, mobile, multicam, SAM2, and
  in some cases the operation kernel itself.
- The most dangerous operation duplication is clip-delete cleanup:
  `clipSlice.removeClip(...)` and the operation-kernel delete path each contain
  resource teardown logic. Do not delete either path blindly; extract shared
  cleanup or route `removeClip` through `delete-clips` first.
- Main-thread canvas drawing and worker drawing are intentionally duplicated
  while `flags.timelineCanvasWorker` is default `false`. Do not delete the
  main-thread `TimelineClipCanvas` draw path because it is the product-default
  renderer. Do not delete the worker path because it is the Phase 6 proof path.
- `thumbnailCacheService` and `thumbnailBitmapCache` are not duplicates:
  service/DB/generation state versus decoded `ImageBitmap` GPU-upload lifecycle.
- The `timeline*Warmup` modules share a shape but target different artifacts.
  Similar structure is not enough reason to merge them.

Dead or low-value candidates that still need cautious cleanup:

- `getCachedTimelineAudioAnalysisArtifact(...)` appears source-unused while the
  waveform and spectrogram cache getters are used by `TimelineClipCanvas`.
- `warmVisibleTimelineSourceWaveforms(...)` appears test-only; production uses
  the scheduled path.
- `resetTimeline*ForTest(...)` helpers are test-only by design and should stay
  unless the related tests are retired.

Dangerous-to-delete list:

- `lazyMediaElements.ts`: contains real media hydration, object URL cleanup, and
  source mutation. Only its reporting helpers are diagnostic.
- Any `*RuntimeReporting.ts` adapter without removing or migrating call sites in
  exporter, cache, render-target, RAM preview, composition renderer, slot deck,
  history, layer playback, and tests.
- Legacy `removeClip`, `moveClip`, `trimClip`, `splitClip` until all live
  callers are migrated and parity-tested.
- Main-thread canvas draw functions while `timelineCanvasWorker` remains
  default-off.
- `TimelineClip.css` import in `Timeline.tsx`; it is now shell/overlay CSS.

## Reuse, Do Not Recreate

Use these existing modules instead of building parallel helpers:

- Canvas/worker: `src/components/timeline/TimelineClipCanvas.tsx`,
  `src/components/timeline/workers/timelineClipCanvas.worker.ts`,
  `src/components/timeline/utils/timelineClipCanvasWorkerModel.ts`,
  `src/services/timeline/timelineCanvasDiagnostics.ts`.
- Timeline active shells: `TimelineTrack.tsx`, `Timeline.tsx`, and the existing
  shell modules for fade/keyframe/audio-region/video-bake/spectral/stem/control
  overlays. Do not revive the deleted `TimelineClip.tsx` body.
- Context menus: `src/components/timeline/utils/clipContextMenu.ts`,
  `trackContextMenu.ts`, and `timelineEmptyContextMenu.ts`; next work should
  extract side-effecting handlers, not rebuild command derivation.
- Typed operations: `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`,
  `moveResolution.ts`, `moveOverlapTrim.ts`, `transitionOperations.ts`, and
  `types.ts`.
- Runtime reporting/coordinator: `src/services/timeline/runtimeResourceReporting.ts`,
  `runtimeCoordinatorContracts.ts`, `runtimeCoordinatorTypes.ts`,
  `timelineRuntimeCoordinator.ts`, plus the existing `*RuntimeReporting.ts`
  adapters. Do not rip out legacy allocators until allocator ownership is an
  explicit slice.
- Restore/history: `src/stores/timeline/serializationUtils.ts`,
  `src/stores/timeline/nestedRestore.ts`,
  `src/stores/timeline/restoredMediaSource.ts`,
  `historyTimelineEditState.ts`, `historyTimelineRestoreState.ts`, and
  `historyRuntimeRehydration.ts`.
- Audio/spectral warmups: `timelineAudioAnalysisArtifactWarmup.ts`,
  `timelineSpectrogramArtifactWarmup.ts`, and the audio cache services under
  `src/services/audio/`.
- Verification: `scripts/run-timeline-canvas-verification.mjs`,
  `src/services/aiTools/handlers/timelineCanvasSmoke.ts`, and existing focused
  unit tests. Extend existing tests where possible, especially
  `tests/unit/serializationNestedRestore.test.ts`.

## Open Work

- Restore/runtime side-effect status:
  - top-level and nested image restore in `serializationUtils.ts` /
    `nestedCompositionLoader.ts` is data-only now: restored clips carry managed
    `source.imageUrl`, interactive preview lazily hydrates images through
    `lazyImageElements.ts`, and export prepares image elements through
    `ClipPreparation` / `ExportClipState`. Direct add-image and image
    clipboard paste also write data-only `source.imageUrl` state. NativeHelper
    recovered image files use media-scoped primary URL ownership. Native
    video/audio restore keeps data-only sources and does not dereference full
    files during load.
  - composition render, RAM preview, background layer playback, warm slot decks,
    and `useLayerSync` overlays now consume data-only image sources through
    bounded caches or the shared cancellable `imageRuntimeHydrator.ts` helper.
    Stale/pending image loads for those paths are cancelled or ignored before
    they can report runtime resources.
  - top-level and nested vector restore start through the shared async helper;
    stale completions no longer mutate/render real clips before session checks,
    and same-clip overlapping prepares are file-keyed for Lottie/Rive. The
    restore-specific vector helper is now isolated in `vectorRuntimeRestore.ts`.
    Remaining vector work is mainly broader runtime-hydrator/allocator
    ownership, not the old duplicate metadata-read/object-URL path
  - nested and top-level model URL fallback ownership is consolidated and
    managed; fully URL-free model restore should still wait for renderer/runtime
    support that can consume files or handles directly
  - top-level, nested, add-comp, and project-load gaussian-splat restore now use
    shared URL-based source construction with managed file fallback ownership;
    renderer/runtime data-only support remains separate
  - gaussian-avatar is legacy-only: import/add is blocked for new authoring, but
    restore/relink compatibility now uses managed URL ownership and should not
    leak or leave restored legacy clips stuck loading
  - project-load and relink model/gaussian sequence frame file URLs are now
    media-scoped through `mediaObjectUrlManager`; durable primary
    `MediaFile.url` creation paths for import, project load, relink,
    refresh/reload, reloadAll, legacy startup restore, duplication, sequence
    imports, and `newProject()` cleanup are also media-scoped now. Cached media
    thumbnail blobs restored by project load, legacy startup restore, and
    `ensureFileThumbnail()` use a separate media-owned `thumbnail` key.
  - remaining direct object URLs are narrower categories: thumbnail generation
    and probing/cache-service internals, clip-scoped `blobUrlManager`
    fallbacks, lazy/runtime media elements, clipboard/serialization
    compatibility, and raw project-domain probes. Do not collapse those into
    primary media ownership without a runtime-hydrator/allocator design.
  - nested composition/media shell duplication is reduced: shared composition
    shell, media shell waveform preservation, primitive mesh restore, sync
    spatial source branching for model/gaussian/avatar, async image/vector
    runtime starters, recursive runtime patch helpers, project-load post-relink
    nested reload delegation, nested segment scheduling, and keyframe merge
    guards now live in or route through the shared `nestedCompositionLoader.ts`
    / `nestedRestore.ts` path. Remaining duplication is mostly policy-level:
    direct add-image, image clipboard paste, direct browser video/audio add, and
    timeline video/audio paste now stay data-only, while relink/reload, download
    completion, 3D/vector user-action hydration, and allocator ownership outside
    restore still need final runtime-hydrator/allocator boundaries.
- AddComp no longer eagerly creates composition-audio mixdowns or audio
  elements, and split paths no longer clone retained media runtime objects for
  new parts. The first playback/export mixdown-on-demand contract is implemented:
  active linked composition audio requests/attaches an element lazily, visual
  composition fallback avoids double playback when a linked audio clip is
  active, and export requests a buffer for data-only composition audio instead
  of decoding the empty placeholder file. Remaining work is live smoke proof and
  folding any additional composition-audio consumers into the same helper if
  they appear.
- Direct browser video/audio add no longer writes imported `HTMLVideoElement`,
  `HTMLAudioElement`, or `WebCodecsPlayer` runtime fields into clip sources.
  Timeline video/audio paste, media relink/reload, download completion,
  3D add/paste/reload, and vector add/paste/reload no longer write those
  runtime fields either.
- Runtime coordinator allocator ownership remains partly open. Admission gates
  now exist for thumbnail jobs/resources/bitmaps, primary lazy video/audio,
  interactive lazy images, shared image hydrator callers for composition render,
  background layers, and warm slot decks, background/slot/composition
  video/audio resources, RAM preview run-job/image/video-provider/CPU-cache/
  GPU-cache resources, and export runtime/provider/decoder resources. Continue
  allocator admission only for stray remaining runtime callers and final
  live/playback/export parity gates.
- Fade transaction execution, `useClipFade` routing, generic keyframe
  transactions, selected clip-bar keyframe tick-drag transaction routing, and
  expanded curve-editor keyframe/Bezier drag routing are complete. Path-value
  keyframe create/update is executable in the kernel, and Mask/Text path-keyframe
  compatibility APIs now route path writes/removals through the kernel.
  Stale-target keyframe tick and curve-editor drag parity is covered; remaining
  keyframe work is final shell/canvas parity sweep, not another write path.
- Side-effecting context-menu handlers still need extraction after the pure command-model pass.
- Worker default-on is still blocked on executing and passing the new
  real-media `workerPositiveLive` runner step plus final broad gates.
- Final broad build/lint/test plus live reload/playback/export verification still needed.
- Optional: add detailed sub-progress instrumentation for the 40%-to-58% project-load window if the pause returns.

## Known 40% Load Window

The 40% progress label is set in `src/services/project/projectLoad.ts` before
timeline restore. Everything until the later 58% workspace checkpoint can look
like "stuck at 40%".

Known suspects from read-only audit:

- `convertProjectCompositionToStore(...)`
- big `useMediaStore.setState(...)`
- `timelineStore.loadState(activeComp.timelineData)`
- nested composition restore inside `serializationUtils.ts`
- `syncStatusFromClipsToMedia()`

Current recommendation: do not implement extra instrumentation unless the user
sees the pause again. If it returns, add sub-progress/timings for
`convertProjectCompositionToStore`, media store set, active `loadState`, nested
restore depth/chunks, and `syncStatusFromClipsToMedia`. The data-only restore
changes already improved the reported experience, and nested/top-level image
restore no longer performs eager `Image` allocation in this window. Image/model
projects can still hit URL and runtime work through preview/export/runtime
hydration or model/gaussian renderer paths. Sequence URLs are now media-scoped
and cleaned up on project load/relink instead of leaking through unmanaged frame
URLs.

## Recommended Next Slice

Continue in this order:

1. Use `Subcomposition 1` (`1780705391680-ecu7panot`) as the valid live-test
   browser target, then run the browser verification runner with worker smokes
   enabled and inspect `workerPositiveLive`. If the project tab is hidden or
   unresponsive, load/activate this composition in the visible tab. Do not use
   `Random 100 Video Clips` (`1780703769030-jqptxgu3c`) unless it is rebuilt or
   explicitly restored. Passing criteria: warmed thumbnail bitmap count meets
   the runner minimum, `workerTrackCount >= 1`, no fallback reasons outside
   `audio-resource-visuals`, `workerPendingTrackCount = 0`, and
   `workerErrorTrackCount = 0`.
2. Finish the remaining Phase 3 side-effecting context-menu handler extraction
   and any final shell/canvas parity sweep. Do not rebuild the keyframe
   write-path migration; stale-target no-fallback coverage is already in
   `tests/unit/TimelineTrack.test.tsx`.
3. Continue Phase 5 runtime-boundary work with allocator/admission ownership
   beyond the thumbnail, primary lazy media/image, shared image hydrator,
   RAM-preview run/image/video/cache, background/slot/composition video/audio,
   interactive runtime providers, legacy WebCodecs helper providers, and export
   run/output/preview/image/video/audio/runtime-binding/provider/decoder
   policies. Next candidates are stray remaining runtime callers outside those
   paths plus final live export/playback parity gates.
   Do not redo shared image hydrator admission for composition/background/slot,
   primary lazy video/audio admission, interactive lazy image admission,
   thumbnail DB/generation job admission, detached thumbnail generation resource admission,
    `thumbnailBitmapCache` admission gate, RAM preview run-job/image/video-provider/CPU-cache/GPU-cache
    admission, background/slot/composition video/audio runtime admission,
    interactive runtime-provider admission,
    legacy WebCodecs helper provider admission,
    export run/output/preview/image/video/audio/runtime-binding/provider/decoder admission,
   Vector user-action data-only slice,
   3D media-owned URL slice, download completion, media relink/reload, direct
   add-image, image clipboard paste, direct browser video/audio add, timeline
   video/audio paste, AddComp placeholder, split media-runtime data-only
   cleanup, playback/export composition mixdown-on-demand helper, or file-backed
   lazy video/audio element URL slices; they are covered by focused tests above.
4. Add or extend focused tests that assert no restore-time
   `URL.createObjectURL`, `document.createElement('video')`,
   `document.createElement('audio')`, stale/unmanaged image blob reuse, or eager
   mixdown for migrated restore paths. The current image data-only proof is
   `npm run test -- tests/unit/serializationNestedRestore.test.ts tests/unit/addCompClipNestedRestore.test.ts tests/unit/projectMediaPersistence.test.ts tests/unit/nestedRestoreRuntimeHelpers.test.ts`.
   Add-image/paste image state is covered by `npm run test -- tests/unit/addImageClip.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerBuilderService.test.ts tests/unit/clipPreparation.test.ts tests/unit/compositionRendererRuntimeReporting.test.ts tests/unit/serializationNestedRestore.test.ts`.
5. Keep allocator ownership incremental: add admission/reporting behavior first,
   then migrate allocation callers. Do not delete ordinary media/runtime object
   URL paths before the runtime hydrator can own them explicitly.

Parallel cleanup lane after the restore test is in place:

1. Consolidate audio-clip detection, source-timing, and active-target helpers.
2. Decide whether worker and main-thread canvas should share spectrogram/color
   utilities before turning `timelineCanvasWorker` on by default.
3. Keep `timelineClipCanvasWorkerContract.ts` as the single worker wire type
   surface; do not recreate local worker/message/resource unions in the model,
   worker, or React owner.

## Do Not Redo

- Fresh checkouts of this branch already include the committed timeline-canvas
  refactor. Do not restore `TimelineClip.tsx` or recreate the full DOM clip
  body.
- Do not restore `TimelineClip.tsx`.
- Do not revive deleted DOM waveform/thumbnail/passive overlay components.
- Do not create another nested-composition restore helper. Extend
  `nestedCompositionLoader.ts` / `nestedRestore.ts` and migrate
  `serializationUtils.ts`, `projectLoad.ts`, and AddComp callers toward them.
- Do not delete `TimelineClip.css` or its import just because
  `TimelineClip.tsx` is deleted; it now carries interaction-shell styling.
- Do not rerun full build/lint/test after every small edit; the user asked to save broad checks for the end.
- Do not treat synthetic smoke clips as the live test target; use `Subcomposition 1` (`1780705391680-ecu7panot`) unless a specific rebuilt/restored target is explicitly selected.
- Do not revert unrelated dirty work.
