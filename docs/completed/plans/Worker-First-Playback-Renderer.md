> Status: Archived from `docs/ongoing/` on 2026-06-25 after docs triage; historical planning context unless explicitly reopened.

# Worker-First Playback Renderer Plan

Original status before archive: active architecture plan. Foundations, render-host routing, shadow
parity, runtime smokes with worker-readback-only export evidence including local
WebCodecs video fixture export/readback and aggressive DOM playhead scrub proof,
platform evidence tooling, local worker-presenting
preview/playback, bridge-controlled render-host mode switching, worker software
paint-order parity for top tracks, worker-aware AI preview capture, scrub
empty-frame suppression plus settled video snapshots,
cached HTML snapshot holding, empty `VideoFrame` placeholder fallthrough,
transient scrub retries with drawable transient video snapshots, stale
worker-packet dropping, worker-presenting scrub backpressure/coalescing,
scrub-time live video snapshot downscaling plus multi-entry worker-resident
cached-bitmap reuse, scrub-cadence FPS/drop accounting, hidden-tab scrub throttling diagnostics,
worker-presenting playback trace/run counters, and normal
FAST video export through worker software readback without requiring the preview
worker-presenting dev mode or eager main-fallback
initialization are in place. A real multi-video worker-only runtime smoke now
exists and verifies normal playback, 2x/3x playback, reverse playback, scrub,
and export readback in one bridge tool; the latest local Windows/Chromium run
passes all smoke checks with worker-software export readback and zero retained
main fallback frames. Scrub now holds worker presentation during transient
video-layer drops while timeline visual demand is active, so one missing video
layer no longer replaces a complete frame with an incomplete one during or just
after scrub. Worker-only scrub also preserves clip-owned HTML-video snapshot
cache keys during seek/RVFC flushes, keeps a larger per-video snapshot LRU, and
allows wider drift only for cached scrub snapshots, avoids ownerless duplicate
snapshots, and skips redundant proactive warm HTML-video pre-cache work during
active drag so the worker presentation path is not competing with duplicate
`createImageBitmap` snapshots. Reverse Worker WebCodecs runtime loading is now
prewarmed from playback state, reverse start primes nearby look-behind targets,
reverse `play()` awaits a short first-frame prime before starting the internal
playback clock, reverse playback keeps the primed clip runtime session instead
of switching to a cold shared preview session, and reverse Worker seeks are
rate-limited to real source-frame changes. Playback diagnostics now report
visible but slow worker preview as `warn` instead of falsely `bad`, and
responsive worker-only preview no longer fails solely because HTML video
readiness dipped; real long freezes, under-budget update cadence, drops, and
uncovered health issues still fail. The full after-reverse heavy-scrub
worker-only smoke is now green locally with scrub `27.5` update FPS, p95 update
gap `109.5ms`, and worker-software export readback fallback delta `0`;
remaining local tuning before cutover is reducing duplicate/stale-frame
telemetry and short freezes, not restoring fallback correctness. Export sessions
revalidate the active export host once before frame rendering and report
worker/main host mode on unrecoverable failures. Worker software presentation
applies supported
blend modes, supported Canvas-filter effects including canvas-compatible
blur, additive brightness, shader-equivalent worker pixel effects,
neighborhood effects through glow, deterministic scanlines/grain, standalone
acuarela/rom1 worker feedback effects, single source-resampling effects through
radial/zoom blur, runtime primary
color-correction nodes, simple wipe transitions,
compositor shape/center/clock transition masks, and pattern/procedural
transition masks in the worker, while unsupported feature classes are blocked
for export/parity paths and live preview is allowed to present a partial frame
when that avoids an otherwise black hold. Real Mac
Safari/Firefox platform packages, full render graph/dispatcher parity,
unsupported/complex export fallback removal, and final legacy removal remain
open.

Created: 2026-06-14
Updated: 2026-06-18 - added strict reverse playback presentation truth: Worker
WebCodecs is labeled only when a fresh Worker WebCodecs frame is actually used
by the worker software preview, stale/pending Worker WebCodecs frames fall back
to truthful `worker-only:HTMLVideo`, and faster reverse playback reports
degraded/bad when drift exceeds the diagnostics budget. Smooth full reverse
Worker WebCodecs remains open; the current real multi-video fixture still has
one MP4 Worker WebCodecs-eligible layer and two WebM HTML-video snapshot input
layers.

Previous 2026-06-17 update added local worker-presenting preview/export
readback smoke status, bridge-controlled render-host mode switching, export
worker-first decoupling from preview dev mode, worker-readback-only runtime
smoke evidence with per-run counter deltas, WebCodecs video fixture
export/readback proof, aggressive DOM playhead scrub proof,
worker-presenting trace/run preview counters, export-host revalidation, scrub
snapshot/cache/retry/stale-packet handling including transient drawable video
snapshots, coalesced worker software presentation backpressure, scrub-time live
video snapshot downscaling with scaled-canvas fallback, nearby cached-snapshot
reuse, multi-entry worker-resident cached-bitmap scrub reuse, owner-specific
HTML-video snapshot cache-key preservation during scrub, active-drag
HTML-video pre-cache suppression for heavy scrub, reverse Worker WebCodecs
module prewarm plus look-behind priming, worker-presenting partial live-preview
presentation, worker software paint-order parity for top tracks,
worker-aware AI preview capture, scrub-cadence FPS/drop accounting, hidden-tab
throttling diagnostics, real multi-video worker-only runtime smoke tooling,
green worker-only real-video smoke evidence, scrub incomplete-frame hold
protection, truthful actual-versus-attempted software-frame diagnostics,
additive worker brightness plus exposure/temperature/vibrance/levels/
threshold/posterize/vignette/chroma-key/mirror/pixelate/rgb-split, Sobel
edge-detect plus unsharp-mask sharpen and glow, deterministic timeline-time
scanlines/grain, worker wave/kaleidoscope/twirl/bulge/motion-blur/radial-blur/
zoom-blur source-resampling with stacked-resampler blocking, canvas-compatible
blur, primary color-correction worker pixel support, simple wipe plus
shape/center/clock and pattern/procedural transition worker masks, and
remaining cutover gates.

## Goal

Move MasterSelects toward a worker-first playback and preview renderer where
the main thread owns UI and editing, while render workers own frame evaluation,
WebGPU compositing, preview presentation, RAM preview, bake, thumbnails, and
export frame rendering.

The retained target keeps the current main-thread renderer as an isolated
legacy fallback layer for now. Product playback, preview, RAM preview, bake,
thumbnail, and export calls still move to the worker renderer after W5 gates,
but the fallback must stay distant: no product code may import or call
`WebGPUEngine` directly, and the old renderer is reachable only through
`renderHostPort` / `exportRenderHostPort` for explicit fallback, diagnostics,
or staged rollback.

Current local validation is stricter than the eventual staged rollout:
normal developer and bridge repros should use `worker-only` whenever the
question is "does the new worker path work?" In that mode the retained
main-host fallback must not rescue preview/playback/export frames. Unsupported
worker frame types should block with structured telemetry
(`unsupported-*`, `fallbackFrameCount=0`, strict blocked counters) so missing
worker coverage is visible. DOM-owned HTML video snapshots are still allowed as
source/input bitmaps for worker software rendering; they are not considered a
renderer fallback because compositing, presentation/readback, and export frame
assembly remain worker-owned. `main`/`main-host-fallback` stays available only
as an explicit legacy rollback or comparison mode until W5 evidence allows the
product default to move.

Frame-rate correctness is part of the worker-first goal, not a cosmetic HUD
detail. The active composition frame rate is the visual cadence source of truth
for playback health, preview effective FPS, frame stepping, and local smoke
expectations. Export may use an explicit export FPS, but diagnostics must label
the distinction clearly (`render target FPS` versus `active composition FPS`
versus `export FPS`) and must not report healthy 30 FPS composition playback as
a 60 FPS failure or hide a real under-target worker preview. Changing a
composition's settings must update the active composition frame rate used by
the timeline, HUD, `getStats`, `getPlaybackTrace`, smoke assertions, and export
defaults where applicable.

The Solid/Text/Image runtime smoke is only a low-level worker render/readback
fixture. It is useful for proving that static layers, text/image packets, and
worker export readback can run without the retained main fallback, but it is
not sufficient proof for playback cutover. Worker-first validation must also
include real media projects, especially the multi-video fixture with actual
video files and overlapping layers. Those real-video smokes must cover normal
playback, scrubbing, reverse playback, 2x/3x forward playback, visible preview
cadence, frame updates, and export readback in `worker-only`.

## Multi-Agent Review Consensus

Five independent reviewers agreed on the same correction: the worker shell and
worker WebGPU move were too early in the first draft.

The durable sequence is:

1. Fix known target/cached-frame correctness issues first.
2. Centralize render ownership behind a host/port.
3. Make the render protocol structured-clone safe.
4. Quarantine legacy `Layer[]` and introduce data-only render graph
   descriptors.
5. Define playback clock and frame deadline authority.
6. Extract frame providers from HTML video, WebCodecs, native decoder, proxy,
   image, document, and 3D runtime paths.
7. Build the retained render graph, pass scheduler, and texture lifetime model.
8. Move target surfaces and then WebGPU into the worker.

The core warning is that current playback is not several independent renderers.
It is one main `WebGPUEngine`/`RenderDispatcher` path with source substitutions,
target routing, RAM-cache shortcuts, export modes, and independent preview jobs
attached. The migration must first create a single frame packet boundary.

## Opus 4.8 Follow-Up Consensus

The Opus 4.8 reviewers agreed with the revised sequence, but sharpened several
load-bearing details:

- The current `RenderFrameSnapshot` cannot simply be "hardened." It is a
  closure-based main-thread convenience shape with interpolation functions,
  `Map`, and `Set` state. The worker DTO must be an evaluated, data-only graph,
  or the worker must own keyframe interpolation.
- Interpolation authority is a Phase 0 decision, not a Phase 2 implementation
  detail. Eager main-thread evaluation is simpler but limits worker ownership;
  worker-side keyframe evaluation is more work but fits the architecture.
- Frame providers need two stages: first extract the policy/state machine while
  still on the main thread, then move WebCodecs/decode production to workers.
- Playback clock should have a proposed design before implementation. The
  likely target is audio-clock authority with the render worker receiving frame
  deadlines and drift state.
- Cache ownership must be decided early. Composite/scrub/RAM preview cache
  should become worker-owned once the worker owns rendering.
- Backpressure, seek coalescing, and inter-worker `VideoFrame` transfer topology
  are high-risk protocol decisions and belong in Phase 0.
- Golden-frame baselines and outstanding-frame counters are prerequisites for
  later parity gates, so they move forward into Phase 0.

## Focused Codex Review Addendum

Five additional Codex agents reviewed specific code areas and converged on the
same upgrade: this should be treated as a render-runtime refactor, not as a
mechanical relocation of current playback code into a worker.

Specific guidance:

- Graph/contracts/interpolation:
  - Introduce `ProjectRenderGraph`, `CompositionRenderGraph`, graph deltas, and
    graph-owned interpolation/source-time evaluation.
  - Quarantine legacy `Layer[]`, store closures, runtime handles, `Map`, and
    `Set` state behind graph builders before worker boundaries.
  - Use a command protocol such as `InitGraph`, `GraphDelta`, `SetClock`,
    `RenderDeadline`, `Seek`, `Scrub`, and `RenderJobFrame`.
- Frame providers/video sync:
  - Make frame providers canonical before moving render core. Provider policy is
    currently spread across video sync, layer builder video sources, WebCodecs
    collection, nested comps, and target preview collectors.
  - Use explicit provider states, request ids, generations, deadlines,
    priorities, exact/nearest/hold modes, and frame ownership tokens.
  - DOM video becomes a temporary `HtmlVideoFrameProvider`, not a render
    primitive.
- Compositor/effects/3D:
  - A worker will be slower if it keeps today's serial pass structure. The
    retained graph must dedupe subcomps, cache masks/effect plans, schedule
    passes, and manage transient texture lifetime.
  - Move 3D/Gaussian/CAD backends after video/image/text/effects graph parity,
    with explicit sort/cull/readback budgets.
- Scheduler/cache/jobs:
  - Add `RenderJobScheduler` and `RenderCacheRegistry` before worker WebGPU.
  - RAM preview, clip bake, comp bake, thumbnails, export, independent previews,
    and live preview should become job types over the same graph.
  - Clip bake should become a real artifact/job, not a side effect of RAM
    preview cache.
- Proof/observability:
  - Extend `getStats` and `getPlaybackTrace` instead of creating a new debug
    path.
  - Add golden project manifests, worker-shadow parity, visible DOM-pixel
    checks, command backpressure counters, provider lifetime counters, and
    complex-session p95 budgets before cutover.

## Performance Risk

Worker-first does not automatically mean faster playback. It mainly buys main
thread responsiveness, cleaner ownership, and better scheduling. Complex
sessions can become slower if the worker boundary is naive.

High-risk slowdown paths:

- Sending full timeline/render snapshots every frame.
- Relaying frames decode-worker -> main-thread -> render-worker instead of using
  direct transfer or a clearly bounded provider topology.
- Re-rendering nested comps repeatedly instead of caching intermediate outputs.
- Rebuilding effect, mask, transition, blend, and 3D pass state every frame.
- Keeping today's serial pass structure and per-target rerenders instead of
  deduping a graph.
- Duplicating CPU/GPU caches across main thread, render worker, decode workers,
  RAM preview, export, and thumbnails.
- Letting scrub/playback queues fill with stale frame requests.
- Moving orchestration to a worker while the GPU remains the bottleneck.
- Adding worker presentation latency without reducing main-thread evaluation
  cost.

The target is therefore not "send everything to a worker every frame." The
target is:

```text
retained worker render graph
+ small delta updates
+ worker-side or explicitly bounded interpolation
+ transferable frame providers
+ worker-owned composite/intermediate caches
+ retained graph node hashes and dirty/dependency tracking
+ pass scheduling with dirty/dependency tracking
+ transient texture lifetime/aliasing
+ latest-wins backpressure for interactive scrub
+ measurable parity and performance gates
```

This is a render-graph/runtime rewrite, not a thread move. If a large refactor
is the correct architecture, it is preferred over preserving a main-thread shape
inside a worker.

## Why This Is Worth Doing

MasterSelects is evolving into a universal visual signal editor: video, audio,
images, 3D, documents, CAD, data, nested comps, media board visuals, effects,
bake, thumbnails, and export. Keeping the main thread as render coordinator will
keep fighting React, pointer input, timeline editing, docking, panels, and
state updates.

The long-term win is not only performance. A worker-first renderer forces the
right architecture:

- UI sends plain render commands and timeline snapshots.
- Render workers own render scheduling and cancellation.
- Decode workers own frame availability.
- Heavy cache and bake jobs stop blocking interaction.
- Preview, RAM preview, thumbnails, video bake, media board, and export can
  share one render graph instead of diverging into special paths.

## Target Architecture

```text
Main thread
  - React UI
  - timeline editing commands
  - panel/dock state
  - pointer and keyboard input
  - project/store ownership
  - worker command bus

Render worker
  - WebGPU device and pipelines
  - OffscreenCanvas preview targets
  - render graph evaluation
  - layer collection
  - compositor/effects/transitions/masks
  - nested composition rendering
  - render target routing
  - frame cache and RAM preview cache policy
  - video bake, thumbnails, export frame rendering

Decode and asset workers
  - demux/decode
  - WebCodecs VideoFrame providers
  - proxy frame decode
  - image/document/vector/CAD/3D preparation
  - transferable bitmap/geometry/data payloads

Audio timing path
  - playback clock contract
  - AudioContext/AudioWorklet coordination
  - render worker receives clock ticks and target frame times
```

## Core Design Rules

- Workers receive serializable render snapshots, commands, and transferables.
  They must not receive Zustand stores, React state, DOM nodes, `File` objects,
  `HTMLVideoElement`, `HTMLImageElement`, or project data objects with runtime
  handles.
- Runtime media handles stay inside the subsystem that owns them. If the render
  worker needs a frame, it receives a `VideoFrame`, `ImageBitmap`, GPU-ready
  payload descriptor, or an asset id it can resolve through a worker-owned cache.
- The main thread never calls WebGPU render methods directly after cutover. It
  requests renders and receives status, metrics, and presented-frame events.
  Legacy main-thread rendering is allowed only as an explicit fallback behind
  the render host adapter boundary.
- Render jobs are cancellable and priority-aware: live preview beats RAM preview,
  RAM preview beats thumbnails, export/bake has explicit exclusive or background
  scheduling policy.
- Timeline, media board, preview, bake, thumbnails, and export use the same
  render graph model where possible.
- Performance changes must be measured against complex-session baselines, not
  only simple playback clips.
- Big refactors are acceptable when they remove fundamental coupling: examples
  include replacing legacy `Layer[]`, splitting `LayerBuilderService`,
  extracting frame-provider policy from `VideoSyncManager`, and moving
  subcomposition/effect pass scheduling into a retained graph.

## Platform And Browser Strategy

Worker-first must be designed around a capability matrix, not a single
`supportsWorkerRenderer` boolean. Linux, macOS Safari, and Firefox are first
class targets, not late fallback cases.

Primary proof targets:

- Windows Chromium: development baseline and highest-feature browser path.
- Linux Chromium on Mesa: silent canvas/WebGPU presentation failure risk.
- Linux Firefox on Mesa: independent engine plus Mesa presentation risk.
- macOS Safari: WebKit/Metal path, stricter media/GPU behavior, and different
  worker/WebGPU maturity profile.
- macOS Firefox: Gecko path on Metal/ANGLE stack and different WebCodecs/
  `VideoFrame` behavior from Chromium.

Capability probes must be granular:

- `WorkerNavigator.gpu` availability and adapter/device creation.
- `OffscreenCanvas` transfer and worker context support.
- `OffscreenCanvas.getContext('webgpu')` support, separately from main-thread
  canvas WebGPU.
- Onscreen canvas presentation from a worker-owned render path.
- `VideoFrame` construction, transfer, clone, close, and import into WebGPU.
- `ImageBitmap` transfer and import.
- `copyExternalImageToTexture` support for the frame payloads we use.
- WebCodecs decoder availability, codec support, and worker availability.
- Audio clock behavior and `AudioContext` startup policy.
- Device lost, context lost, visibility change, background-tab throttling, and
  fullscreen/output-window behavior.

The renderer chooses a strategy from probed facts:

- `worker-webgpu-present`: worker owns WebGPU and presents directly to target
  surfaces.
- `worker-webgpu-main-present`: worker owns graph/rendering, then transfers a
  presentable frame to a main-thread canvas presenter.
- `worker-cpu-present`: worker owns graph/caches and produces
  `ImageBitmap`/pixel payloads for a software or 2D presenter.
- `worker-presenting`: selected render-host mode where the worker owns a
  transferred preview `OffscreenCanvas` and reports `frame-presented` events.
  Current implementation presents an initial software preview packet for simple
  Solid/Image/Text/VideoFrame/HTML-video snapshots through the runtime command
  channel, including opacity, source-rect cropping, normalized position,
  local scale, and Z rotation. It is still not full RenderDispatcher/WebGPU
  graph parity.
- `worker-shadow`: product calls still present through the main fallback, while
  render wake/target commands are mirrored through the runtime worker command
  channel. This is a cutover scaffold, not proof of worker presentation.
- `worker-only`: strict validation mode for current local work. It selects the
  worker host and disables retained main fallback rescue for normal
  preview/playback/export validation. Valid HTML-video snapshots may still
  enter as worker input bitmaps, but unsupported renderer features must block
  and report diagnostics instead of calling the main renderer.
- `main-host-fallback`: retained legacy fallback path, reachable only through
  render host adapters for diagnostics, explicit rollback, or platforms whose
  worker strategy is not allowed by W5 gates. The direct `WebGPUEngine`
  coupling lives in `mainFallbackRenderHostPort.ts`, not in product callers.
- `renderHostSelection`: explicit selection boundary for a future worker
  primary host versus the retained main fallback. Product callers still use
  `renderHostPort`; the selector owns flag, registration, availability, and
  blocker telemetry for the cutover.
- `renderHostPort`: stable product-facing proxy over the selected render host.
  `configureRenderHostSelection()` can mount a worker-primary candidate behind
  the proxy while main fallback remains the default until W5/host readiness
  allows cutover. The public port owns selection/proxy only; it does not import
  `WebGPUEngine` directly.

Long-term "worker-first" means product paths depend on the worker graph rather
than the current main-thread `WebGPUEngine` preview renderer. It does not mean
the legacy renderer must be deleted immediately, and it does not mean every
browser must use the same low-level presentation mechanism. Safari and Firefox
may need a different presenter while still using the same render graph, frame
providers, scheduler, cache registry, and job model.

## Phase -1 - Fix Known Correctness Issues

Purpose: remove existing bugs that would make migration signals ambiguous.

Tasks:

- Fix `CachedFrameRenderer.renderCachedFrame()` so target-canvas desktop preview
  can consume cached RAM preview frames without requiring legacy
  `previewContext`.
- Stop preview transparency toggles from re-registering targets. Cosmetic
  target updates must not clear playback, scrubbing, and composite caches.
- Add observability to `renderScheduler` independent preview cache behavior
  before moving or deleting it.
- Document that user-facing RAM preview is currently disabled. Clip video bake
  no longer calls the user-facing `startRamPreviewForRange()` action, but it
  still shares the RAM-preview render/cache infrastructure until that bake
  range path is migrated to the worker graph.

Acceptance:

- Cached composite frames can render to registered preview targets.
- Transparency changes update target state without unregister/register churn.
- Independent preview scheduling has basic hit/miss and frame timing counters.

## Phase 0 - Inventory And Decisions

Purpose: define the worker boundary before moving code.

Tasks:

- Inventory all current render entry points:
  - `useEngine()`
  - `WebGPUEngine`
  - `RenderDispatcher`
  - `renderScheduler`
  - `FrameExporter`
  - `RamPreviewEngine`
  - `compositionRenderer`
  - thumbnail/render-target generation
  - video bake proxy paths
- Classify every input as one of:
  - data-only project state
  - worker-transferable runtime payload
  - main-thread DOM runtime handle
  - GPU/runtime handle
  - durable store-only state
- Decide the snapshot strategy before building contracts:
  - full snapshots for seek/scrub correctness
  - delta or clock-only updates for steady playback
  - retained worker graph only after descriptor parity exists
- Decide retained graph strategy:
  - which entities live in the worker scene graph
  - which updates are deltas
  - which changes invalidate subgraphs
  - how dirty flags flow through nested comps, effects, masks, transitions,
    output slices, and render targets
- Decide interpolation authority:
  - eager main-thread evaluation of transforms/effects/source times
  - worker-side keyframe and source-time evaluation from data-only keyframe
    models
  - hybrid, with explicit limits for sub-frame sampling and motion blur
- Decide clock authority:
  - main playback store
  - AudioContext/AudioWorklet bridge
  - render worker scheduler input
- Adopt a proposed clock direction before implementation. Current preferred
  direction: audio clock is authoritative, while the render worker receives
  deadlines, playback speed, loop/in-out state, and drift correction state.
- Decide the HTML-video exit strategy:
  - remove it from primary playback before worker cutover
  - or make it a main-thread provider that returns transferable frames
- Decide inter-worker frame transfer topology:
  - decode worker -> render worker direct transfer
  - decode worker -> main host -> render worker relay
  - shared worker/provider pool
- Define the platform/browser capability matrix before implementing worker
  presentation:
  - Windows Chromium
  - Linux Chromium on Mesa
  - Linux Firefox on Mesa
  - macOS Safari
  - macOS Firefox
- Decide which probed capability combinations map to each presentation strategy:
  - worker WebGPU direct presentation
  - worker WebGPU with main-thread presentation bridge
  - worker CPU/ImageBitmap/software presentation
  - temporary main-host development path
- Decide backpressure and coalescing policy for scrub/playback commands:
  - latest-wins seeks
  - bounded queues
  - dropped deadlines
  - exact-frame requests that cannot be skipped
- Decide composite, scrub, RAM preview, and active-comp-output cache ownership.
  Preferred direction: worker-owned once worker rendering starts; main thread
  receives cache metadata only.
- Decide intermediate texture/cache strategy for complex graphs:
  - nested comp output cache
  - effect-chain intermediate cache
  - mask texture cache
  - active-comp output cache
  - 3D/scene render cache
  - cache invalidation rules and memory budgets
- Decide the dormant proxy MP4 `VideoFrame` path:
  - delete it
  - or explicitly fold it into the new frame-provider API
- Decide whether RAM preview remains a user feature or becomes internal
  bake/cache infrastructure.
- Choose the forbidden-import enforcement mechanism for worker-bound packages:
  ESLint boundaries, dependency-cruiser, or a custom import graph test.
- Capture current-renderer golden-frame/fingerprint baselines before descriptor
  migration starts.
- Add outstanding frame/provider counters before moving frame ownership so later
  leak gates are measurable.
- Define proof harness inputs before descriptor migration:
  - persisted golden project manifests
  - golden sample times
  - frame fingerprints
  - DOM-visible captures
  - per-browser capability probe results
  - complex-session performance budgets
- Capture current complex-session performance baselines:
  - many simultaneous video clips
  - many nested compositions
  - effects, masks, transitions, and blend modes
  - mixed image/text/video/3D/document sources
  - scrub stress and long playback
  - export and bake under load
- Define performance budgets for:
  - snapshot/delta build time
  - postMessage/transfer time
  - decode wait
  - provider wait
  - render graph evaluation
  - GPU pass time
  - presentation latency
  - queue depth and stale request count
- Define `RenderCommand` messages:
  - initialize
  - register target
  - unregister target
  - resize target
  - render frame
  - start playback
  - pause playback
  - seek/scrub
  - start RAM preview
  - start bake
  - export frame/range
  - collect stats
  - dispose
- Define retained graph and delta messages:
  - `InitGraph`
  - `GraphDelta`
  - `SetClock`
  - `RenderDeadline`
  - `Seek`
  - `Scrub`
  - `RenderNow`
  - `StartRenderJob`
  - `CancelRenderJob`
- Define graph delta operations:
  - `upsertComposition`
  - `upsertTrack`
  - `upsertClip`
  - `removeClip`
  - `upsertKeyframes`
  - `upsertEffectStack`
  - `upsertMask`
  - `upsertTransition`
  - `upsertAsset`
  - `targetRegistered`
  - `targetResized`
  - `targetUpdated`
  - `targetRemoved`
- Define worker status events:
  - initialized
  - frame presented
  - frame dropped
  - cache updated
  - job progress
  - device lost
  - error
  - stats

Acceptance:

- Contract types live outside React and stores.
- No contract type contains DOM or durable runtime handles.
- Existing renderer still works unchanged.
- Open decisions above are resolved before Phase 1 begins.
- Worker/presentation strategy is selected from capability probes, not user
  agent strings.
- Safari, Firefox, and Linux/Mesa proof targets are present in the baseline
  matrix before worker presentation work starts.

## Phase 1 - Render Host Port

Purpose: stop UI components and services from owning renderer lifecycle or
calling engine methods directly.

Tasks:

- Add a `RenderHostPort` anti-corruption layer around the current singleton
  renderer.
- Replace scattered `useEngine()` lifecycle ownership with one app-level render
  host.
- Preview panels register render targets through the host, not directly through
  `engine.registerTargetCanvas`.
- Toolbar, preview, mobile preview, multi-preview slots, scopes, and output
  windows subscribe to renderer state instead of starting render-loop side
  effects.
- Move engine stats polling behind the host.
- Decide `renderScheduler` ownership:
  - merge into the host
  - subordinate it as an independent-preview client
  - or retire it after worker target routing exists
- Add renderer mode telemetry for `main`. The full mode switch lands when the
  worker shell exists.
- Move the current self-healing render-loop watchdog and stats interval out of
  `useEngine()` and into the host.

Acceptance:

- Only one component owns renderer lifecycle.
- Preview components can mount/unmount without replacing the render callback.
- Existing playback and preview behavior remains unchanged.
- Direct calls to `engine.start`, `engine.render`, `engine.renderCachedFrame`,
  `engine.setPreviewCanvas`, and `engine.registerTargetCanvas` are isolated
  behind the host/adapter.

## Phase 2 - Worker-Safe Contracts And DTO Split

Purpose: replace closure-based main-thread snapshots with worker-message-safe
DTOs.

Tasks:

- Use existing snapshot contracts as source material, but do not send current
  `RenderFrameSnapshot` to the worker. It contains interpolation closures,
  `Map`, and `Set` state.
- Introduce an evaluated worker DTO:
  - `RenderCommand`
  - `RenderTargetSnapshot`
  - `ProjectRenderGraph`
  - `CompositionRenderGraph`
  - `RenderGraphDelta`
  - `EvaluatedRenderGraph`
  - `RenderLayerDescriptor`
  - `RenderJob`
  - `FrameProviderRequest`
  - `FrameProviderResponse`
- Keep these existing contracts in view during migration:
  - `src/engine/render/contracts/renderFrameSnapshot.ts`
  - `src/engine/render/contracts/renderTargetSnapshot.ts`
  - `src/services/render/renderFrameSnapshotFactory.ts`
- Remove functions, class instances, `Map`, `Set`, DOM handles, GPU handles,
  and store methods from worker-bound DTOs.
- Use arrays/records and explicit ids only.
- Add deterministic hashing for representative snapshots.
- Add forbidden-import checks so worker contract packages cannot import legacy
  `Layer`, `LayerSource`, DOM render targets, stores, or engine singletons.
- Add JSON and `structuredClone()` round-trip tests.
- Add graph-version compatibility rules:
  - deltas include `baseVersion` and `nextVersion`
  - stale deltas are rejected
  - worker can request a fresh graph if versions diverge

Acceptance:

- `RenderCommand`, `RenderTargetSnapshot`, `ProjectRenderGraph`,
  `CompositionRenderGraph`, `RenderGraphDelta`, `EvaluatedRenderGraph`, and
  `RenderJob` pass `structuredClone()` and JSON round-trip tests.
- Worker-bound DTOs are data-only and deterministic.
- Current main-thread renderer still receives data through an adapter.

## Phase 3 - Data-Only Render Graph

Purpose: stop treating legacy `Layer[]` as the long-term render payload.

Tasks:

- Quarantine legacy `Layer[]` as a main-thread adapter type.
- Add worker-safe `RenderLayerDescriptor` / `EvaluatedRenderGraph` descriptors.
- Add persistent graph descriptors:
  - `ProjectRenderGraph`
  - `CompositionRenderGraph`
  - composition, track, clip, keyframe, effect, mask, transition, target, and
    asset/provider records by stable id
- Move 3D/Gaussian/scene-specific descriptor fields into a separate optional
  descriptor module so video/image/text parity is not blocked by the 3D
  migration.
- Define graph nodes for:
  - `SourceFrame`
  - `MaskRaster`
  - `EffectStack`
  - `LayerComposite`
  - `SubcompComposite`
  - `Scene3D`
  - `OutputFanout`
  - `SliceOutput`
  - `ReadbackCapture`
- Every graph node must declare stable hash, dependencies, sample time,
  resolution, quality, estimated cost, cacheability, and output texture format.
- Split `LayerBuilderService` into:
  - pure timeline/composition evaluator
  - runtime hydrator/provider bridge
  - legacy `Layer[]` adapter
- Split `FrameContext` into serializable frame inputs and local runtime helpers.
- Convert transforms, keyframes, effects, transitions, masks, nested comp
  references, output slices, and target routing inputs to descriptor data.
- Compile animation/keyframe tracks when graph deltas arrive, not every frame.
- Compile source-time/speed curves on keyframe edits so source-time lookup does
  not repeatedly integrate and sample during playback.
- Cache transition plans and coverage ranges on graph mutation.
- Replace DOM-created transition helper canvases with data-only transition
  primitives and legacy adapters.
- Keep a temporary adapter from the new descriptors back to current main-thread
  `Layer[]` rendering.

Acceptance:

- Render evaluation can run without DOM media elements.
- Worker contract code cannot import legacy `Layer` or runtime handle types.
- Main-thread preview still renders through the descriptor-to-legacy adapter.
- Reused subgraphs can be identified by stable hashes before WebGPU moves.

## Phase 4 - Render Job Scheduler, Cache Registry, And Texture Lifetime

Purpose: reduce work before moving work. Worker-first must dedupe passes,
schedule jobs, and manage cache/texture lifetime rather than relocate today's
serial renderer.

Tasks:

- Add `RenderJobScheduler` for:
  - live preview
  - scrub
  - independent previews
  - source monitor/output preview
  - RAM preview
  - clip bake
  - composition bake
  - export
  - thumbnails
  - media-board prep
- Add job admission, priority, exclusivity, cancellation, queue draining, and
  latest-wins coalescing.
- Use latest-wins for live preview/scrub and exact ordered frames for export,
  bake, and deterministic captures.
- Make export/bake jobs that still mutate global engine state exclusive until
  that state is isolated.
- Add `RenderCacheRegistry` for:
  - source-frame cache
  - last-frame/hold cache
  - composite cache
  - active-comp output cache
  - render target surfaces
  - bake artifacts
  - thumbnail artifacts
  - export outputs
- Every cache entry declares owner, key, memory estimate, invalidation source,
  resource kind, hit/miss counters, and release path.
- Add a graph scheduler that can topologically sort graph nodes.
- Merge output fanout so multiple targets can consume one rendered source.
- Replace shallow nested-comp caching with graph/content/provider-state keys:
  - composition id
  - evaluated graph hash
  - sample time
  - resolution and quality
  - provider frame ids
- Plan effect passes explicitly:
  - inline color/easy effects in the composite shader where possible
  - complex effects declare pass count, temp texture needs, feedback state,
    resolution scale, and cacheability
  - reuse uniform buffers and bind groups instead of per-effect churn
- Move masks into graph-owned raster/cache passes keyed by shape, time, and
  resolution.
- Add texture lifetime manager:
  - transient texture aliasing
  - peak VRAM budgets
  - format/resolution compatibility
  - job-priority eviction
  - external `VideoFrame`/`ImageBitmap` ownership tracking
- Treat 3D/Gaussian as graph backends with explicit passes and budgets:
  - scene render
  - compute/cull/sort
  - color/depth-mask passes
  - readback budgets
  - approximate playback quality versus precise export quality

Acceptance:

- Scheduler can report jobs admitted, enqueued, started, completed, canceled,
  coalesced, dropped, expired, late, and stale-response counts.
- Scheduler exposes oldest-command age and priority-inversion counters.
- Cache registry can report memory by owner/kind and release all resources for
  a job, composition, source, or project close.
- Scheduler can report graph nodes emitted, executed, deduped, and skipped.
- Nested comp cache hit/miss is keyed by content/provider state, not only time
  and layer count.
- Pass count, texture allocation/reuse, peak VRAM, effect pass count, mask cache
  hit rate, and 3D pass time are measurable.
- Independent previews and output fanout can consume shared graph outputs where
  their source graph is identical.

## Phase 5 - Playback Clock And Frame Deadlines

Purpose: define timing before a worker owns render scheduling.

Tasks:

- Define `PlaybackClockSnapshot`.
- Define frame deadline messages:
  - target timeline time
  - media time
  - playback speed
  - loop/in-out state
  - audio clock sample
  - drift correction state
- Resolve authority between `usePlaybackLoop`, `PlayheadState`,
  `AudioTrackSyncManager`, `AudioContext`/AudioWorklet, and worker scheduling.
- Define presented-frame events and drift telemetry.
- Add deterministic clock tests for play, pause, seek, scrub, loop, speed
  changes, and playback stop handoff.

Acceptance:

- Worker can receive frame deadlines without owning the UI or audio system.
- Audio/video drift and render/present delay are observable.
- Clock protocol exists before worker compositing starts.

## Phase 6 - Frame Provider Controller

Purpose: extract runtime media readiness from render graph evaluation.

Tasks:

- Define `FrameProviderRequest` and `FrameProviderResponse`.
- Define provider states:
  - `cold`
  - `warming`
  - `pending`
  - `ready`
  - `stale`
  - `hold`
  - `dropped`
  - `recovering`
  - `failed`
  - `disposed`
- Track provider substatus separately:
  - `pendingSeek`
  - `pendingDecode`
  - `pendingTransfer`
  - `decodeAhead`
  - `late`
  - `canceled`
- Provider status includes:
  - source id
  - session key
  - generation
  - request id
  - media time
  - frame timestamp
  - freshness
  - deadline
  - priority
  - outstanding frame count
  - last drop reason
  - fallback used
- Stage the migration:
  - Phase 6a: extract provider policy/state machine while still main-thread.
  - Phase 6b: move WebCodecs/decode production to decode/asset workers.
- Extract frame-provider policy from:
  - `VideoSyncManager`
  - HTML video coordinators
  - WebCodecs/native coordinators
  - layer collectors
  - proxy frame cache
  - image/document/vector/model/3D signal loaders
- Move WebCodecs frame production behind decode/asset worker providers.
- Make JPEG proxy image, proxy MP4 `VideoFrame`, original video, native decoder,
  still image, document, vector, CAD, and 3D payloads provider variants.
- Define frame lifetime rules: clone, transfer, close, cache, evict.
- Define frame ownership states:
  - `borrowed`
  - `owned`
  - `transferred`
- Provider responses include a frame token. Render owners release with
  `releaseFrame(token, outcome)`.
- Define exact-frame, nearest-frame, hold-frame, cancellation, and late-response
  behavior.
- Define provider backpressure behavior for rapid scrub and playback stalls.
- Preferred transfer topology: main-thread control DTOs to decode/asset worker,
  direct transferable frames from decode/asset worker to render worker when
  browser support allows it. Main-thread relays are only for explicit DOM-only
  provider bridges.
- HTML video becomes `HtmlVideoFrameProvider`: main-thread only, DOM-owned, and
  temporary. It returns transferable `VideoFrame`/`ImageBitmap` payloads and is
  not a render primitive.
- JPEG proxies remain a low-cost image provider.
- Dormant MP4 proxy `VideoFrame` path is either deleted or rebuilt as a
  persistent all-intra provider with admission, cancellation, and cache
  ownership.
- Native decoder providers become source/session keyed rather than clip keyed.

Acceptance:

- Video playback can render from worker-owned `VideoFrame` inputs.
- Scrubbing can request exact or nearest frames without touching DOM video.
- Proxy and original video frames share the same provider contract.
- Every delivered or canceled `VideoFrame` / `ImageBitmap` is closed, released,
  or transferred exactly once.
- Outstanding frame count returns to zero after stop, seek cancellation, and
  project close.
- Provider counters include created, cloned, transferred, imported, cached,
  released, closed, late-closed, leaked, and fallback-used counts.

## Phase 7 - Target Surface Manager And Worker Shell

Purpose: move target lifecycle and worker process lifecycle before real render
core migration.

Tasks:

- Add `TargetSurfaceManager` for:
  - legacy main preview
  - active composition preview targets
  - independent composition preview targets
  - output manager sliced previews
  - output windows
  - export targets
  - fullscreen/mobile targets
- Transfer preview canvases to `OffscreenCanvas` where supported by the target
  mode.
- Add worker shell entrypoint, command queue, priority queue, cancellation,
  resize coalescing, crash handling, and worker stats.
- Add the real renderer mode switch:
  - `main`
  - `worker-shadow`
  - `worker-presenting`
  - `worker-only`
- Add platform strategy for Linux/Mesa-style silent presentation failure and
  Safari/Firefox worker/API differences:
  - granular capability probe
  - visible-pixel presentation check
  - browser engine/OS/driver recorded in stats
  - strategy selection independent of user agent strings
  - explicit policy for worker direct presentation, main-thread presentation
    bridge, and software/ImageBitmap presentation while migration is active
- Run nonblank worker test patterns on:
  - Windows Chromium
  - Linux Chromium on Mesa
  - Linux Firefox on Mesa
  - macOS Safari
  - macOS Firefox
- Render nonblank worker test patterns to every target class.

Acceptance:

- Worker can initialize, receive commands, report stats, and present nonblank
  test frames.
- Target registration, unregister, resize, output slices, output windows, and
  disposal are stable.
- Presentation success is verified by browser pixels, not just worker readback.
- Worker heartbeat replaces the old main-thread render-loop watchdog.
- Safari/Firefox pass the selected presentation strategy for their probe
  results before worker-presenting mode is allowed on those browsers.

## Phase 8 - Worker Render Core

Purpose: move real WebGPU rendering only after descriptors, clock, providers,
and surfaces exist.

Tasks:

- Move or mirror these modules behind worker-safe dependencies:
  - `WebGPUEngine`
  - `RenderDispatcher`
  - `Compositor`
  - `OutputPipeline`
  - effect pipelines
  - transition pipelines
  - mask texture handling
  - render target manager
  - nested comp renderer
- Replace store reads inside render modules with snapshot/graph inputs.
- Replace browser global assumptions with worker-safe platform services.
- Migrate in render subsets through the scheduler:
  - empty/static test frames
  - image/text/canvas
  - masks/effects/transitions
  - nested comps
  - video `VideoFrame` provider sources
  - output slices and transparency grid
- Implement 3D/Gaussian/scene graph backend only after video/image/text/effects
  graph parity is stable.
- Establish pixel/fingerprint baselines before and after each subset.

Acceptance:

- Worker-rendered frames match current main-thread frames for representative
  static, image, text, video, mask, transition, effect, nested comp, and 3D
  cases.
- No render module reads Zustand or DOM globals directly.
- Main thread no longer calls `engine.render(layers)` for preview.
- Complex-session pass count and VRAM peak are no worse than the main-thread
  baseline unless explicitly accepted for a temporary phase.

## Phase 9 - Shared Render Jobs

Purpose: retire special render paths by putting batch work on the same graph.

Tasks:

- Define shared `RenderJob` / `FrameCapture` contracts early enough that export,
  RAM preview, bake, thumbnails, and composition rendering stop calling the
  singleton engine directly.
- Rebuild RAM preview as a worker render job that writes worker-owned composite
  cache entries.
- Replace clip-scoped video bake's transient RAM-preview dependency with an
  explicit bake artifact/job path.
- Route composition video bake through the same render graph, replacing DOM
  video artifacts where appropriate.
- Move export frame rendering from `FrameExporter` / `ExportLayerBuilder` to
  render jobs.
- Move thumbnail/render-target generation to render jobs.
- Bring independent previews from `renderScheduler` onto the same scheduler.
- Unify job priority:
  - live preview
  - scrub
  - source monitor/output preview
  - bake/export
  - RAM preview
  - thumbnails
  - idle media-board prep

Acceptance:

- RAM preview, clip bake, composition bake, thumbnails, independent previews,
  and export use the same render graph as preview.
- Batch jobs do not block timeline editing.
- Render job cancellation drains queues and releases frame/provider resources.

## Phase 10 - Media Board And Universal Signals

Purpose: extend the same worker render architecture beyond the timeline.

Tasks:

- Move media board visual generation/render prep onto worker-compatible signal
  descriptors.
- Let non-video files become worker-resolved visual payloads:
  - PDF/SVG
  - image sequences
  - 3D models
  - gaussian splats
  - CAD/vector/data/point clouds
- Use the same asset id and provider contracts for board, timeline, preview,
  thumbnails, and export.

Acceptance:

- Media board and timeline share asset providers.
- No file type needs a main-thread-only visual preparation path unless it is a
  pure UI editor surface.

## Phase 11 - Retire Main-Thread Renderer

Purpose: make worker-first the only playback/preview render path.

Tasks:

- Remove direct preview `WebGPUEngine` ownership from UI hooks.
- Remove main-thread `RenderDispatcher` preview calls.
- Retire legacy target canvas registration paths.
- Remove or rewrite stale RAM preview shortcuts.
- Delete adapters that existed only for migration.
- Update docs in `docs/Features/`.

Acceptance:

- Main thread cannot render preview frames directly.
- All preview/render/bake/export job entry points go through the render host and
  worker command bus.
- Worker-only mode passes the full smoke matrix on Windows and real Linux/Mesa
  hardware.
- Full build, lint, and test chain passes before normal commit readiness.

## Proof Harness

Purpose: prove the worker path is correct, visible, and not slower on complex
sessions before any cutover.

Golden projects:

- Solid/text/image baseline.
- Multi-video baseline with many simultaneous videos.
- WebCodecs-provider baseline.
- HTML fallback/provider baseline.
- JPEG proxy baseline.
- Nested comps reused by multiple parents/targets.
- Effects, masks, transitions, and blend modes.
- Multi-target preview and output-slice baseline.
- RAM preview/cache baseline.
- Clip bake and composition bake baseline.
- Export parity baseline.
- 3D/Gaussian/CAD signal baseline when those graph backends enter scope.

Platform matrix:

- Windows Chromium.
- Linux Chromium on Mesa.
- Linux Firefox on Mesa.
- macOS Safari.
- macOS Firefox.

Each golden project records the active presentation strategy and capability
probe result for that platform. A passing Chromium run does not imply Safari or
Firefox readiness.

Required metrics:

- Renderer mode.
- Browser engine, OS, GPU adapter info, and selected presentation strategy.
- Capability probe result for worker WebGPU, OffscreenCanvas transfer,
  OffscreenCanvas WebGPU context, `VideoFrame` transfer, `ImageBitmap` transfer,
  WebCodecs, and frame import into WebGPU.
- Worker heartbeat and uptime.
- Active job id and job type.
- Target ids and target sizes.
- Queue depth by priority and job type.
- Enqueued, started, completed, canceled, coalesced, dropped, expired, late,
  stale-response, resize-coalesced, and priority-inversion counts.
- Oldest command age.
- Snapshot/delta build time.
- Structured clone and postMessage transfer time.
- Provider wait and decode wait.
- Graph evaluation time.
- Command encode time.
- GPU submit and `queue.onSubmittedWorkDone` time.
- Presentation latency.
- Readback/fingerprint time.
- Graph nodes emitted/executed/deduped/skipped.
- Pass count and effect pass count.
- Texture allocations/reuse/peak VRAM.
- Subcomp cache hit/miss.
- Mask cache hit/miss.
- 3D sort/cull/readback time.
- Requested/delivered/transferred/released/closed/leaked frame counts.
- Nonblank ratio, freeze count, stale visible frame count, and black-frame
  count.

Proof surfaces:

- Extend `getStats` and `getPlaybackTrace`; do not create a separate debug path.
- Generalize frame-fingerprint parity from export-preview smokes to preview,
  worker-shadow, worker-presenting, and export.
- Capture DOM-visible pixels or browser screenshots for every target class.
  GPU readback alone is not accepted as visible-presentation proof.
- Mirror timeline canvas worker diagnostics style for worker mode, pending
  work, draw/render time, resource bytes, errors, and fallback counts.

Cutover gates:

- Worker-shadow matches golden fingerprints within agreed tolerance.
- Worker-shadow queue depth stays bounded under scrub and playback stress.
- Worker-presenting has no blank DOM captures and no stale visible frames.
- Outstanding frame/provider count returns to zero after stop, seek cancel, and
  project close.
- p95 frame and presentation latency is no worse than the agreed budget for
  complex sessions.
- Pass count, duplicate subcomp renders, and peak VRAM are no worse than the
  agreed budget.
- Windows Chromium, Linux Chromium/Mesa, Linux Firefox/Mesa, macOS Safari, and
  macOS Firefox pass the same visible-pixel and fingerprint gates using their
  selected presentation strategies.

## Verification Plan

Focused checks during phases:

- Type contract tests for worker messages.
- `structuredClone()` and JSON round-trip tests for render commands, render
  snapshots, target snapshots, and render jobs.
- Forbidden-import checks for worker contract packages:
  - no stores
  - no React
  - no DOM media elements
  - no GPU handles
  - no legacy `Layer[]`
- Unit tests for render snapshot builder and deterministic snapshot hashing.
- Unit tests for frame provider ownership and `VideoFrame.close()`.
- Unit tests for render job cancellation, priority, and queue draining.
- Unit tests for target lifecycle, resize coalescing, worker crash, and device
  lost/restored events.
- Unit tests proving direct engine calls are isolated behind the render host.
- Pixel/fingerprint tests for representative layers before moving each render
  subset.
- `debugExport` or frame-fingerprint baselines before moving WebGPU core.
- Golden project generation and persisted manifests.
- Worker-shadow parity smokes on all golden projects before presenting mode.
- AI bridge smokes:
  - `simulateScrub`
  - `simulatePlayback`
  - `simulatePlaybackPath`
  - `getPlaybackTrace`
  - `getStats`
  - `debugExport`
- Timeline canvas verification after UI-host changes.
- Browser screenshot/pixel checks for desktop, mobile, output-window, and
  independent preview targets.
- Real presentation checks for Linux/Mesa-style blank canvas failure modes.
- Browser/platform matrix checks for Windows Chromium, Linux Chromium/Mesa,
  Linux Firefox/Mesa, macOS Safari, and macOS Firefox.
- Capability probe tests for worker WebGPU, OffscreenCanvas transfer,
  OffscreenCanvas WebGPU context, `VideoFrame` transfer, `ImageBitmap` transfer,
  WebCodecs, and WebGPU frame import.
- Strategy-selection tests proving unsupported or partial API combinations pick
  the correct presenter without falling back to the legacy main-thread renderer
  after worker-only cutover.
- Worker observability checks:
  - renderer mode
  - browser engine, OS, GPU adapter, and selected presentation strategy
  - queue depth
  - transfer latency
  - requested/delivered/dropped/late/canceled frames
  - outstanding frame count
  - presented frame time
  - black/freeze/nonblank counters
  - worker crash/device-lost events
- Render-command backpressure checks:
  - enqueued
  - coalesced
  - dropped
  - expired
  - late
  - stale-response
  - oldest-command age
- Complex-session budget checks:
  - graph eval p95
  - provider wait p95
  - GPU submit/fence p95
  - presentation p95
  - peak VRAM
  - subcomp cache hit rate
  - duplicate pass count

Final readiness:

- `npm run build`
- `npm run lint`
- `npm run test`
- Real project playback smoke with video, image, text, nested comp, proxy,
  transition, effects, mask, 3D, RAM preview/bake, and export.

## Open Decisions

- Should the render worker own exactly one WebGPU device, or should export/bake
  get a separate worker/device when running in parallel?
- Should worker caches be per composition, per project, or global runtime
  resources?
- The main-thread renderer stays as a hidden emergency/fallback implementation
  for now. It must remain isolated behind render host adapters and must not
  regain direct product call sites. During normal local worker validation,
  use `worker-only`; use `main`/`main-host-fallback` only for explicit
  rollback/comparison.
- Which presentation strategies are supported per browser after worker-only
  cutover: direct worker WebGPU, worker render plus main-thread presenter, or
  worker CPU/ImageBitmap presenter?
- Which artifacts should be durable project files versus runtime-only caches:
  RAM preview, clip bake, composition bake, thumbnails, proxy frames, and media
  board previews?
- How aggressively should the first worker graph support 3D/Gaussian/CAD
  signals versus landing video/image/text parity first?

## Complete Refactor Method Reuse

The completed Complete Refactor plan is the method template for this initiative.
Reuse its execution discipline, not its old source-specific phase content.

What to copy:

- Success definition first: this plan should optimize for a render runtime that
  is easy to reason about, measurable under load, and explicit about ownership.
- Bounded packets: every Codex task has a lane, packet id, mode, write set,
  forbidden files, gates, checks, stop conditions, and short report.
- Wave cadence: baseline/discovery, contract, skeptical review, implementation,
  verification, synthesis.
- Gate/checklist contract: a gate is not executable until subchecks, allowed
  writes, forbidden files, do-not rules, focused checks, and exit criteria are
  explicit.
- High-conflict ownership: shared hubs are serialized even when many agents are
  available.
- Ledger discipline: adapter debt, retired paths, test migration, platform
  gaps, cache ownership, and provider ownership are tracked instead of hidden
  in prose.
- Minimal artifacts: keep one canonical plan and one checklist until lane data
  becomes too large.
- Cadence: use focused checks during packets; reserve full build/lint/test for
  normal commit, push, merge, release, or explicit readiness boundaries.

What not to copy:

- Timeline-specific gate ids.
- Whole-codebase LOC-reduction goals as the primary objective.
- Old compatibility decisions that do not apply to the worker renderer.
- Claude-dependent orchestration. This plan remains Codex-only.

## Source Of Truth And Execution Artifacts

Current source of truth:

- `docs/ongoing/Worker-First-Playback-Renderer.md`: canonical architecture and
  execution plan.
- `docs/ongoing/Worker-First-Playback-Renderer-checklist.md`: user-visible
  progress, gates, lane readiness, and next packets.
- `docs/ongoing/Worker-First-Playback-Renderer-handoff.md`: current execution
  handoff, next worker prompts, blockers, and latest meaningful checks.
- `docs/ongoing/Playback.md`: investigation notes for current playback,
  proxy, and RAM preview behavior.

Do not create a folder full of ledgers up front. Keep ledgers as sections in
the checklist until they become too large or a gate needs a separate executable
manifest.

Checklist rule: whenever a new requirement, lane, gate, baseline item, blocker,
or stop condition is discovered, update the checklist in the same session.

Handoff rule: keep the handoff file short. It is not a packet-history archive.
It should contain only current state, next eligible packets, fresh prompt
inputs, blockers, active high-conflict ownership, and the last meaningful
checks. Long completed packet reports belong in the checklist or commit
history, not in handoff.

## Check Cadence And Batching

The migration will involve many small packets, so checks must be intentional.
Avoid running expensive builds/tests after every worker packet unless the packet
touches a surface where that is the narrowest useful proof.

Rules:

- Worker packets run only the focused checks named in their prompt.
- Read-only packets run no build/lint/test unless their task is to define or
  validate a check.
- Contract-only packets run contract tests, cloneability tests, import-boundary
  scans, and focused type checks when needed.
- UI/target packets run the smallest relevant unit/smoke/browser check, plus
  targeted type checks if APIs changed.
- Runtime ownership packets run focused leak/lifetime tests and targeted scans,
  not the full suite.
- The Codex orchestrator batches broader checks after a group of compatible
  packets lands, for example after the first parallel wave or after several
  contract-only packets integrate cleanly.
- The full `npm run build`, `npm run lint`, and `npm run test` chain runs only
  at AGENTS.md-required boundaries: normal commit, push, release, merge, or
  explicit final readiness. Reuse a passing full-chain result if the exact same
  HEAD has already passed.
- If two or more packets need the same expensive check, run it once after both
  are integrated instead of once per worker.
- If a focused check fails because of unrelated existing worktree state, the
  worker reports the failure and evidence; the orchestrator decides whether to
  batch, defer, or isolate it.

Prompt rule: every worker prompt must list exact expected checks. If the exact
check is unknown, the packet is preflight-only and the worker defines the
smallest useful check instead of doing broad source edits.

## Multi-Agent Execution Model

The codebase is structured well enough for multiple agents to work in parallel,
but only if each packet has an explicit write set. The risky files are not hard
to find: renderer ownership, layer building, timeline state, and engine
singletons are hubs. Parallel agents should build new boundaries around those
hubs first, then migrate callers in bounded follow-up packets.

Execution constraint: use Codex agents only. Historical Claude/Opus reviews may
remain as context in this document, but implementation, packet review,
integration support, and follow-up analysis should be assigned to Codex agents.
Do not make Claude a required orchestrator, reviewer, worker, or merge gate for
this plan.

Rules:

- One Codex orchestrator owns packet assignment, integration order, final
  verification, commits, merges, and pushes.
- The Codex orchestrator writes a fresh packet prompt for every worker run.
  Workers must not rely on previous agent memory, stale branch assumptions, or
  informal chat context. Each prompt restates the current goal, repository
  rules, plan/checklist links, write set, forbidden files, gates, checks, stop
  conditions, and report format.
- Up to 6 Codex agents may work in parallel when write sets are disjoint.
- Every packet declares:
  - goal
  - write set
  - forbidden files
  - expected new contracts/APIs
  - scoped checks
  - stop conditions
  - report format
- Codex workers do not edit outside their packet. Debt found outside scope is
  reported as a follow-up packet.
- Shared contracts are changed in contract-only packets first. Behavior packets
  consume the contract after it lands.
- Central hub files are serialized unless a packet is only adding imports or a
  narrow adapter call.

High-conflict files and areas:

- `src/hooks/useEngine.ts`
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/Compositor.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/renderScheduler.ts`
- `src/stores/timeline/**`
- `src/stores/renderTargetStore.ts`
- `src/engine/render/contracts/index.ts`
- barrel files that re-export shared contracts

These files should normally be touched by one integration packet at a time.
Other agents can work next to them by adding new modules and tests.

Parallel-friendly lanes:

- Contracts lane:
  - `src/engine/render/contracts/**`
  - new graph/provider/job DTO folders
  - cloneability and forbidden-import tests
- Proof/observability lane:
  - `src/services/aiTools/**`
  - playback trace/stat extensions
  - golden manifest tooling
  - frame fingerprint and visible-pixel checks
- Platform lane:
  - new render capability probe module
  - strategy selector tests
  - browser/platform matrix docs and diagnostics
- Scheduler/cache lane:
  - new `RenderJobScheduler` contracts and tests
  - new `RenderCacheRegistry` contracts and tests
  - no migration of existing callers until integration packet
- Target/preview correctness lane:
  - `src/engine/render/dispatcher/cachedFrameRenderer.ts`
  - `src/components/preview/usePreviewRenderTargetRegistration.ts`
  - `src/services/render/previewTargetRegistration.ts`
- Provider lane:
  - new frame provider contracts/state machine
  - adapters around WebCodecs, HTML video, native decoder, proxy, image sources
  - no broad `LayerBuilderService` rewrite until contracts land
- Graph/evaluation lane:
  - new pure graph builder/evaluator modules
  - pure keyframe/source-time interpolation extraction
  - legacy `Layer[]` adapter after contracts are stable
- Render-core lane:
  - compositor/effects/pass scheduler/texture lifetime work
  - starts after graph, provider, scheduler, and target-shell contracts exist

Suggested first Codex parallel wave:

- Codex Agent 1: Packet A/B target correctness.
  Write set: cached-frame renderer, preview target registration hook/service,
  focused tests or smokes.
- Codex Agent 2: Packet F proof harness baseline.
  Write set: AI tools stats/trace/fingerprint/golden manifest modules only.
- Codex Agent 3: Packet G platform capability probe.
  Write set: new capability probe/strategy selector modules and tests.
- Codex Agent 4: Packet H graph DTO contracts.
  Write set: new render graph/provider command contract files and
  cloneability/forbidden-import tests.
- Codex Agent 5: Packet D/E scheduler/cache skeleton.
  Write set: new scheduler/cache registry modules and tests only; no caller
  migration.
- Codex Agent 6: Packet I provider policy contracts.
  Write set: new provider state/request/response contracts and counters only;
  no `LayerBuilderService` migration yet.

Serialized follow-up wave:

- Integrate `RenderHostPort` after target correctness and initial telemetry land.
- Integrate scheduler/cache into existing callers after scheduler/cache tests
  pass.
- Integrate provider contracts into `LayerBuilderService` after provider
  contracts and graph DTOs land.
- Integrate graph evaluator into render/export/RAM/thumbnail paths after graph
  contracts and proof harness exist.
- Move worker shell/presentation after platform probes and visible-pixel proof
  are available.

Codex packet template:

```text
Fresh prompt header:
- You are a Codex worker for MasterSelects.
- Read AGENTS.md first and follow it.
- Treat unrelated worktree changes as someone else's work.
- Do not commit, push, merge, or edit outside the allowed write set.

Lane:
Packet:
Mode: read-only | implementation | verification
Goal:
Read first:
- Current plan/checklist:
Write set:
Forbidden files:
Current contract:
Target contract:
Retired paths in scope:
Runtime invariants:
Inputs already available:
Implementation notes:
Expected gates:
Expected checks:
Stop conditions:
Expected report:
```

Minimum Codex worker report:

- files read
- files changed
- coupling reduced or isolated
- contracts added or consumed
- behavior changed
- gates passed, failed, or still active
- checks run and result
- checks skipped and why
- retired paths classified or deleted
- tests ported, replaced, split, kept, or deleted
- remaining risks and next packet recommendation

## Gate And Checklist Contract

Each phase and implementation packet must expose:

- goal
- allowed write set
- forbidden files or directories
- high-conflict hubs
- do-not rules
- gate ids
- gate subchecks
- focused checks or smoke commands
- exit criteria

A gate that only names a desired state is not implementation-ready. It becomes
implementation-ready only when the subchecks say what proves it.

Gate template:

```text
Gate:
Subchecks:
- static or runtime condition
- fixture/smoke condition
- import/runtime-handle/platform condition
Checks:
- exact test, script, AI bridge command, or rg scan when known
Do not:
- files, domains, or shortcuts that must not be touched to close this gate
Exit:
- observable state that lets the Codex orchestrator mark the gate closed
```

If a Codex worker discovers that a gate lacks subchecks, it stops source edits
for that packet and reports the smallest missing preflight entry.

## First Practical Slice

The first work should not move WebGPU yet. Split it into small packets so each
one has a clear verification target.

Packet A - cached-frame target routing:

- Fix `CachedFrameRenderer` so cached frames route to active target canvases
  without requiring legacy `previewContext`.
- Verify dock preview and mobile preview both still present cached frames.

Packet B - target registration churn:

- Remove preview transparency from target registration deps and keep it as an
  in-place target update.
- Verify toggling transparency during playback does not clear video, scrub, or
  composite caches.

Packet C - render host boundary:

- Add a `RenderHostPort` around the current renderer.
- Route preview target registration through the host.
- Route direct engine commands from toolbar, preview, mobile preview,
  multi-preview, output windows, and scopes through the host.
- Move the `useEngine()` stats interval and render-loop watchdog into the host.
- Add renderer mode telemetry for `main` only.

Packet D - scheduler skeleton:

- Add a main-thread `RenderJobScheduler` facade while rendering still happens
  on the current engine.
- Model live playback, scrub, independent preview, RAM preview, thumbnails,
  clip bake, comp bake, and export as job types.
- Implement priorities, latest-wins scrub cancellation, resize coalescing,
  queue depth metrics, stale-response metrics, and queue-drain tests.
- Do not move WebGPU yet.

Packet E - cache ownership registry:

- Add `RenderCacheRegistry` to name cache owners and lifetime rules for source
  frames, hold frames, composite frames, subcomp outputs, masks, effect plans,
  target surfaces, bake artifacts, thumbnails, and export frames.
- Record which caches are runtime-only and which are durable artifacts.
- Add counters for allocation, reuse, eviction, transfer, release, and leak
  detection.

Packet F - proof harness baseline:

- Create golden project manifests for simple, multi-video, proxy, nested comp,
  masks/effects/transitions, multi-target, RAM/cache, bake, export, and later
  3D/Gaussian/CAD cases.
- Extend `getStats` and `getPlaybackTrace` with renderer mode, job id, target
  id, queue depth, transfer latency, provider waits, presented frame ids, frame
  lifetime counts, pass counts, cache hits, VRAM peak, and visible-pixel state.
- Add frame-fingerprint and DOM-visible capture checks before any worker
  presentation mode.

Packet G - platform capability probe:

- Add a render capability probe that records browser engine, OS, GPU adapter,
  worker WebGPU, OffscreenCanvas transfer, OffscreenCanvas WebGPU context,
  `VideoFrame` transfer, `ImageBitmap` transfer, WebCodecs, and frame import
  into WebGPU.
- Store probe results in renderer stats and `getPlaybackTrace`.
- Add a strategy selector for direct worker presentation, worker render with
  main-thread presentation bridge, worker CPU/ImageBitmap presentation, and the
  temporary main-host development path.
- Add simulated probe tests for Safari-style, Firefox-style, Linux/Mesa-style,
  and Chromium-full capability combinations.

Packet H - graph DTO contracts:

- Introduce `ProjectRenderGraph`, `CompositionRenderGraph`, `RenderGraphDelta`,
  `RenderCommand`, and provider request/response DTOs.
- Add cloneability/forbidden-import tests proving these contracts contain no
  React, stores, DOM media elements, GPU handles, runtime handles, or legacy
  `Layer[]`.
- Decide whether interpolation is worker-owned or eagerly evaluated before the
  graph builder emits DTOs.

Packet I - frame provider policy extraction:

- Wrap current video, image, proxy, WebCodecs, native decoder, and DOM video
  paths in a provider state machine while still on the main thread.
- Add request ids, generations, deadlines, priorities, exact/nearest/hold modes,
  cancellation, late-response handling, and frame release tokens.
- Track created, cloned, transferred, imported, cached, released, closed,
  late-closed, leaked, and fallback-used frame counts.

Phase 0 cross-cutting decisions:

- Decide interpolation authority and backpressure policy.
- Add golden-frame/fingerprint baseline capture.
- Add outstanding frame/provider counters.
- Decide direct decode-worker -> render-worker transfer topology and main-thread
  relay limits.
- Decide the minimum supported strategy for macOS Safari and macOS Firefox
  before worker-presenting mode ships.
- Decide whether the first graph is called `EvaluatedRenderGraph` or the
  `ProjectRenderGraph`/`CompositionRenderGraph` split is introduced
  immediately. Do not try to make the current closure-based
  `RenderFrameSnapshot` the worker payload.

These packets remove known ambiguity and create the boundary without moving all
rendering at once.
