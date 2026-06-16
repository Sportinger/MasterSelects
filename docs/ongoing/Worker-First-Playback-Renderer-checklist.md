# Worker-First Playback Renderer Checklist

Status: DRAFT - active companion checklist for
`Worker-First-Playback-Renderer.md`
Updated: 2026-06-16

This checklist is the user-visible progress and gate surface for the worker-first
playback renderer plan. The canonical architecture plan remains
`docs/ongoing/Worker-First-Playback-Renderer.md`.

## Progress Snapshot

- [x] Playback/proxy/RAM preview investigation recorded in
      `docs/ongoing/Playback.md`.
- [x] Worker-first architecture plan created.
- [x] Multi-agent review findings incorporated.
- [x] Performance risk section added for complex sessions.
- [x] Linux/Mesa, macOS Safari, and Firefox platform gates added.
- [x] Codex-only multi-agent execution model added.
- [x] Complete Refactor execution discipline imported into the plan.
- [x] Handoff file created for current execution state and next prompts.
- [x] Check batching policy added.
- [x] First practical slice listed as packets A-I.
- [x] Gate matrix converted into exact test/static-check command names.
- [x] First implementation packet assigned.
- [x] Source implementation started.

## How To Read Gates

Each gate is implementation-ready only when it has:

- [ ] gate id
- [ ] subchecks
- [ ] allowed write set
- [ ] forbidden files
- [ ] do-not rules
- [ ] focused checks or smoke commands
- [ ] exit criteria

A checked phase definition means the plan names the target. It does not mean the
source implementation is complete.

## Execution Rules

- [x] Use Codex agents only.
- [x] One Codex orchestrator owns packet assignment, integration order, final
      verification, commits, merges, and pushes.
- [x] The Codex orchestrator gives every worker a fresh packet prompt with
      repo rules, plan/checklist links, write set, forbidden files, gates,
      checks, stop conditions, and report format.
- [x] Workers do not rely on old agent memory, stale branch assumptions, or
      informal chat context.
- [x] Up to 6 Codex workers may run in parallel when write sets are disjoint.
- [x] Shared hubs are serialized unless a packet only adds a narrow adapter call.
- [x] Workers do not edit outside their packet.
- [x] Extra debt found mid-packet is reported, not fixed.
- [x] Focused checks are preferred during packet work.
- [x] Full `npm run build`, `npm run lint`, and `npm run test` are reserved for
      normal commit, push, release, merge, or explicit readiness boundaries.
- [x] Expensive checks are batched after compatible packets integrate, not run
      separately by every worker.
- [x] Worker prompts must name exact expected checks; otherwise the packet is
      preflight-only until the smallest useful check is defined.

## Handoff Contract

Handoff source:

- `docs/ongoing/Worker-First-Playback-Renderer-handoff.md`

The handoff file must stay short and current:

- [x] current state
- [x] next eligible packets
- [x] active blockers
- [x] high-conflict ownership
- [x] fresh prompt inputs
- [x] latest meaningful checks
- [x] check batching policy

Do not:

- [ ] Do not turn handoff into packet history.
- [ ] Do not duplicate long completed worker reports in handoff.
- [ ] Do not use handoff as the canonical architecture plan.

## High-Conflict Ownership

These files and areas require explicit packet ownership before source edits:

- [ ] `src/hooks/useEngine.ts`
- [ ] `src/engine/WebGPUEngine.ts`
- [ ] `src/engine/render/RenderDispatcher.ts`
- [ ] `src/engine/render/Compositor.ts`
- [ ] `src/services/layerBuilder/LayerBuilderService.ts`
- [ ] `src/services/layerBuilder/VideoSyncManager.ts`
- [ ] `src/services/renderScheduler.ts`
- [ ] `src/stores/timeline/**`
- [ ] `src/stores/renderTargetStore.ts`
- [ ] `src/engine/render/contracts/index.ts`
- [ ] shared barrel files that re-export render contracts

## Reviewable Gate Matrix

### W0 - Baseline, Proof, And Platform

Allowed write set:

- `docs/ongoing/**`
- new proof-harness modules under `src/services/aiTools/**`
- new capability-probe modules and tests
- read-only scan outputs if the Codex orchestrator creates them

Forbidden files:

- `src/hooks/useEngine.ts`
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- broad timeline store edits

Gates and subchecks:

- [ ] `W0_PLAYBACK_BASELINE_CAPTURED`
  - [x] current playback/proxy/RAM preview behavior documented
  - [x] golden project manifests defined
  - [x] golden sample times defined
  - [x] frame fingerprint capture path defined
  - [x] controlled main-renderer golden fixture capture bridge defined
  - [x] controlled `solid-text-image` fixture materialization/capture runner defined
  - [x] DOM-visible capture path defined
  - [x] golden fixture fingerprints captured for every manifest/sample time
  - [ ] DOM-visible baseline captures recorded for the required platforms
- [x] `W0_PLATFORM_MATRIX_DEFINED`
  - [x] Windows Chromium target listed
  - [x] Linux Chromium/Mesa target listed
  - [x] Linux Firefox/Mesa target listed
  - [x] macOS Safari target listed
  - [x] macOS Firefox target listed
  - [x] capability probe command/test names defined
- [x] `W0_OBSERVABILITY_SURFACE_DEFINED`
  - [x] `getStats` fields listed with exact owner
  - [x] `getPlaybackTrace` fields listed with exact owner
  - [x] queue/deadline/backpressure counters listed
  - [x] provider lifetime counters listed
  - [x] visible-pixel/nonblank counters listed
  - [x] visible proof/stress producers publish visible-pixel counters into
        `workerFirstRenderer.counters`

Focused checks:

- `npx vitest run tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts`
- `npx vitest run tests/unit/renderCapabilityProbe.test.ts`
- `npx vitest run tests/unit/aiToolStats.test.ts`
- `npx tsc -b --pretty false`

Current W0 owners:

- Golden manifests, sample times, focused check names:
  `src/services/aiTools/workerFirstProofHarness.ts`
- Frame fingerprint path:
  `src/services/aiTools/frameFingerprint.ts`
- Main-renderer golden fixture capture bridge:
  `captureWorkerFirstGoldenFixtureFingerprint` validates manifest id, sample
  time, materialized manifest status, and required current timeline signals
  before recording `source: main-renderer` fingerprints. It rejects
  caller-supplied source/fingerprint evidence and does not enable worker start
  permissions.
- Solid/text/image fixture runner:
  `runWorkerFirstSolidTextImageGoldenFixture` materializes the deterministic
  `solid-text-image` timeline and calls the main-renderer golden bridge for
  manifest sample times `[0, 0.5, 1]`. It is devBridge/internal-only, rejects
  caller-supplied source/fingerprint/sample-time evidence, and does not enable
  worker start permissions.
- AI bridge observability surface:
  `getStats.workerFirstRenderer` and
  `getPlaybackTrace.workerFirstRenderer`, owned by
  `src/services/aiTools/handlers/stats.ts`
- DOM-visible canvas proof path:
  `src/services/aiTools/visiblePixelProof.ts:captureDomVisibleCanvasProof`
- Platform capability probe and presentation strategy selector:
  `src/services/render/renderCapabilityProbe.ts`
- Initial counters: `queueDepth`, `transferLatencyMs`, `providerWaitMs`,
  `presentedFrameId`, frame lifetime counts, pass counts, cache hits/misses/
  evictions/VRAM peak, and visible-pixel nonblank/black/freeze/stale counts.
- Runtime visible-pixel counter producers:
  `captureWorkerFirstVisiblePresentationProof` publishes nonblank/black-frame
  counters from captured fingerprints, and
  `runWorkerFirstVisiblePresentationStressProof` publishes nonblank,
  black-frame, freeze, and stale-visible-frame counters from the controlled
  playback proof.

Do not:

- [ ] Do not move WebGPU to a worker in W0.
- [ ] Do not migrate `LayerBuilderService` in W0.
- [ ] Do not treat GPU readback as presentation proof.

Exit:

- [x] A Codex worker can implement proof/platform probes from explicit gates and
      focused checks without editing render hubs.

### W1 - Contracts And DTOs

Allowed write set:

- new files under `src/engine/render/contracts/**`
- new graph/provider/job DTO modules
- cloneability and forbidden-import tests

Forbidden files:

- `src/hooks/useEngine.ts`
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/services/layerBuilder/LayerBuilderService.ts` except read-only inspection
- existing playback behavior paths

Gates and subchecks:

- [x] `W1_RENDER_COMMANDS_CLONE_SAFE`
  - [x] `RenderCommand` DTOs contain no stores, React, DOM media elements, GPU
        handles, runtime handles, functions, `Map`, `Set`, or legacy `Layer[]`
  - [x] structured-clone tests exist
  - [x] JSON round-trip tests exist where appropriate
- [x] `W1_GRAPH_CONTRACTS_DEFINED`
  - [x] `ProjectRenderGraph` contract exists
  - [x] `CompositionRenderGraph` contract exists
  - [x] `RenderGraphDelta` contract exists
  - [x] source/provider references are data-only
- [x] `W1_PROVIDER_CONTRACTS_DEFINED`
  - [x] provider request/response DTOs exist
  - [x] provider states and substatus exist
  - [x] frame ownership token model exists

Focused checks:

- `npx vitest run tests/unit/renderGraphContracts.test.ts tests/unit/renderContracts.test.ts`
- `npx vitest run tests/unit/frameProviderPolicy.test.ts`
- `npx tsc -b --pretty false`

Do not:

- [ ] Do not retrofit the current closure-based `RenderFrameSnapshot` as the
      worker payload.
- [ ] Do not introduce broad `types.ts` dumps.

Exit:

- [x] Contract tests pass and behavior remains unchanged.

### W2 - Target Correctness And Render Host

Allowed write set:

- `src/engine/render/dispatcher/cachedFrameRenderer.ts`
- `src/components/preview/usePreviewRenderTargetRegistration.ts`
- `src/services/render/previewTargetRegistration.ts`
- new render host facade modules after W0/W1 gates are explicit

Forbidden files:

- provider migration files
- graph evaluator migration files
- worker WebGPU entrypoints

Gates and subchecks:

- [x] `W2_CACHED_FRAME_TARGET_ROUTING`
  - [x] cached frames route to active target canvases without legacy
        `previewContext`
  - [x] dock preview and mobile preview present cached frames
        - Unit-covered target and legacy-preview routes:
          `tests/unit/cachedFrameRenderer.test.ts`
        - Visible-pixel smoke:
          `tests/unit/cachedFrameVisiblePresentation.smoke.test.ts`
- [x] `W2_TARGET_REGISTRATION_STABLE`
  - [x] transparency toggles update target state in place
  - [x] playback, scrub, and composite caches are not cleared by cosmetic target
        updates
- [x] `W2_RENDER_HOST_BOUNDARY`
  - [x] UI direct engine calls are listed
  - [x] host facade owns stats and render-loop watchdog plan
        - `renderHostPort.startStatsAndWatchdog()` owns the stats interval,
          base engine stats publication, optional playback/main-thread debug
          enrichment, and render-loop restart watchdog.
  - [x] renderer mode telemetry includes `main`
        - `src/services/render/renderHostPort.ts` reports `mode: 'main'`
          with lifecycle, stats, and watchdog ownership on `renderHostPort`.
        - First caller migration routes preview target registration,
          `MultiPreviewSlot`, `TargetPreview`, and `TargetList` output-window
          actions through the host facade.
        - UI hook/component render wake commands now route through the host.

Current direct engine call inventory from focused source scans:

- No direct target/output/render-wake/init/start/primary-render engine commands
  remain in `src/components/**` or `src/hooks/**` outside `renderHostPort`.
- No direct `WebGPUEngine` imports remain in `src/hooks/**` or
  `src/components/**`; component capture and scope inspection paths now route
  through `renderHostPort`.
- First service-level render wake migration is integrated:
  `src/services/mediaRuntime/webCodecsPlayback.ts`,
  `src/services/mediaRuntime/runtimePlayback.ts`, and
  `src/services/layerBuilder/layerBuilderProxyFrames.ts` now route wake
  commands through `renderHostPort`.
- Auxiliary service-level render wake migration is integrated:
  `src/services/timeline/lazyImageElements.ts`,
  `src/services/videoBakeProxyCache.ts`,
  `src/services/midi/midiParameterApplicators.ts`, and selected AI diagnostic/
  fixture wake paths now route through `renderHostPort`.
- Playback health wake/cache migration is integrated:
  `src/services/playbackHealthMonitor.ts` keeps direct engine diagnostics, but
  render wake/cache commands now route through `renderHostPort`.
- VideoSync wake migration is integrated:
  `src/services/layerBuilder/videoSync*.ts` files keep direct engine frame
  cache/presentation diagnostics where needed, but render wake commands now
  route through `renderHostPort`.
- Timeline store wake/cache migration is integrated:
  timeline slices now route render wake/cache commands through `renderHostPort`;
  direct engine render wake/cache calls are isolated to `renderHostPort`.
- Frame-presentation/video-cache migration is integrated:
  video frame cache, presentation marker, pre-cache, GPU-ready, and cleanup
  commands now route through `renderHostPort`.
- Primary render execution migration is integrated:
  `render`, `renderCachedFrame`, composite caching, active composition output
  caching, continuous render, timeline visual demand, play state, and scrub
  state commands now route through `renderHostPort`. The remaining
  `RamPreviewEngine` render calls use an injected render engine instance rather
  than the global singleton and are reserved for a later RAM-preview port.
- Resolution, mask-texture, and generated-canvas texture migration is
  integrated:
  `setResolution`, output dimensions for mask/text sizing, mask texture
  updates/removals, generated canvas texture uploads, and compositor binding
  invalidation now route through `renderHostPort`.

Exit:

- [x] Existing renderer behavior is unchanged, but UI ownership is ready to move
      behind the host.

### W3 - Scheduler And Cache Registry

Allowed write set:

- new scheduler/cache contract modules
- focused scheduler/cache tests
- no caller migration until gates are green

Forbidden files:

- `src/services/renderScheduler.ts` behavior migration until the skeleton is
  tested
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`

Gates and subchecks:

- [x] `W3_RENDER_JOB_SCHEDULER_DEFINED`
  - [x] live playback job type exists
  - [x] scrub job type exists
  - [x] independent preview job type exists
  - [x] RAM preview, bake, export, and thumbnail job types exist
  - [x] priority, cancellation, coalescing, and queue-drain tests exist
- [x] `W3_RENDER_CACHE_REGISTRY_DEFINED`
  - [x] cache owners listed
  - [x] key, memory estimate, invalidation source, and release path exist
  - [x] allocation/reuse/eviction/leak counters exist

Focused checks:

- `npx vitest run tests/unit/renderJobScheduler.test.ts tests/unit/renderCacheRegistry.test.ts`
- `npx tsc -b --pretty false`

Exit:

- [x] Scheduler/cache contracts are testable without moving WebGPU.

### W4 - Frame Provider Policy

Allowed write set:

- new provider state-machine modules
- provider request/response contracts
- focused provider lifetime tests

Forbidden files:

- broad `LayerBuilderService` rewrite
- renderer collector rewrites
- native decoder behavior migration until provider contracts are green

Gates and subchecks:

- [x] `W4_PROVIDER_STATE_MACHINE_DEFINED`
  - [x] source/session scoped states exist
  - [x] request id, generation, deadline, priority, and mode exist
  - [x] exact/nearest/hold/prewarm policies are defined
- [x] `W4_FRAME_LIFETIME_OWNERSHIP_DEFINED`
  - [x] borrowed/owned/transferred states exist
  - [x] release token path exists
  - [x] created/cloned/transferred/imported/cached/released/closed/leaked
        counters exist

Focused checks:

- `npx vitest run tests/unit/frameProviderPolicy.test.ts`
- `npx tsc -b --pretty false`

Exit:

- [x] Provider policy can wrap existing behavior before render migration.

### W5 - Worker Shell And Presentation

Allowed write set:

- worker shell modules
- target surface manager modules
- platform presenter modules
- tests/smokes after W0-W4 gates are green

Forbidden files:

- deleting legacy renderer before worker-shadow and worker-presenting gates pass
- moving 3D/Gaussian/CAD before video/image/text/effects graph parity

Gates and subchecks:

- [ ] `W5_WORKER_SHADOW_PARITY`
  - [x] executable gate evaluator exists
  - [ ] golden fingerprints match within tolerance
  - [x] queue-depth bound is enforced by the gate evaluator
  - [x] frame/provider outstanding/leak drain is enforced by the gate evaluator
  - [x] queue depth stays bounded in captured worker-shadow runs
  - [x] frame/provider outstanding count returns to zero in captured
        worker-shadow runs
- [ ] `W5_VISIBLE_PRESENTATION_PROVEN`
  - [x] executable gate evaluator exists
  - [x] AI bridge capture entry point can record the current render-host
        capture canvas as visible-presentation evidence when the requested
        platform/strategy match the latest capability probe
  - [x] controlled AI bridge stress runner can derive no-stale evidence from
        real playback diagnostics instead of caller-supplied counters
  - [x] DOM-visible nonblank proof is enforced by the gate evaluator
  - [x] no-stale playback stress proof is enforced by the gate evaluator
  - [ ] DOM-visible captures are nonblank in captured platform runs
  - [ ] no stale visible frames under playback stress in captured platform runs
  - [ ] Windows Chromium, Linux Chromium/Mesa, Linux Firefox/Mesa, macOS Safari,
        and macOS Firefox pass with selected presentation strategy
        - [x] Windows Chromium package passes.
        - [x] Linux Chromium/Mesa package passes.
        - [x] Linux Firefox/Mesa package passes with Mesa Vulkan ICDs.
        - [ ] macOS Safari package is still required from a real Mac.
        - [ ] macOS Firefox package is still required from a real Mac.

Exit:

- [ ] Worker-presenting mode is allowed only for platforms whose strategy gates
      are green.

Current W5 prerequisite gate owners:

- `src/services/aiTools/workerFirstW5Gates.ts` evaluates
  `W5_WORKER_SHADOW_PARITY` and `W5_VISIBLE_PRESENTATION_PROVEN`.
- `src/services/aiTools/workerFirstGateInputs.ts` maps scheduler, cache, and
  provider snapshots into `workerFirstRenderer.counters` for W5 gate input.
- `src/services/aiTools/workerFirstCounterSources.ts` records runtime-only
  scheduler, cache, provider, transfer-latency, provider-wait, and presented
  frame snapshots plus visible-pixel counters as serializable data for the W5
  counter adapters.
- `src/services/aiTools/workerFirstProofCaptures.ts` records runtime-only
  golden fixture fingerprints, worker-shadow parity samples, and DOM-visible
  platform proofs as serializable data for the W5 prerequisite report.
- `src/services/aiTools/workerFirstVisibleCaptureBridge.ts` exposes the
  `captureWorkerFirstVisiblePresentationProof` AI bridge tool for recording the
  current render-host capture canvas as probe-bound visible-presentation
  evidence. The tool is devBridge/internal-only and does not accept
  caller-supplied playback stress counters.
- `src/services/aiTools/workerFirstVisibleStressBridge.ts` exposes the
  `runWorkerFirstVisiblePresentationStressProof` AI bridge tool for running
  controlled playback, requiring observed preview frames, deriving
  `staleVisibleFrameCount` from playback diagnostics, and recording a
  fingerprinted render-host canvas proof.
- `src/services/aiTools/workerFirstPlatformEvidencePackage.ts` exposes the
  `runWorkerFirstPlatformEvidencePackage` AI bridge tool for deriving the
  current proof platform from the in-browser capability probe, running the
  controlled visible-stress proof, collecting stats/trace, and returning a
  hashable one-platform evidence package without enabling W5 start permissions.
- `src/services/aiTools/workerFirstEffectsMasksTransitionsShadowParity.ts`
  exposes the `runWorkerFirstEffectsMasksTransitionsShadowParity` AI bridge
  tool for recording controlled worker-shadow parity over effect, mask,
  transition, and blend-mode fixture signals.
- `src/services/aiTools/workerFirstProofPlatform.ts` owns shared platform/
  strategy validation against the latest render capability probe.
- `workerFirstRenderer.w5Prerequisites` exposes `canStartWorkerWebGpu`,
  `canStartWorkerPresentation`, and `canStartRenderDispatcherCutover`.
- All three start permissions remain false until captured golden fixtures,
  worker-shadow fingerprints, queue/lifetime drains, DOM-visible nonblank
  platform proofs, no-stale stress proofs, and worker-capable presentation
  strategies are all present.

Focused checks:

- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
- `npx tsc -b --pretty false`

## First Queued Codex Packets

- [x] Packet A/B: target correctness.
      - Packet A implementation, unit route coverage, and dock/mobile
        visible-pixel smoke integrated.
      - Packet B implementation and unit hook/service coverage integrated.
- [x] Packet F: proof harness baseline.
- [x] Packet G: platform capability probe.
- [x] Packet H: graph DTO contracts.
- [x] Packet D/E: scheduler/cache skeleton.
- [x] Packet I: provider policy contracts.
- [x] Packet C: render host boundary.
      - Main-mode host facade owns lifecycle, stats, watchdog, preview target
        registration, output-window commands, and UI render wake commands.
- [x] Packet J: runtime/provider render wake host migration.
      - `webCodecsPlayback`, `runtimePlayback`, and `layerBuilderProxyFrames`
        route render wake commands through `renderHostPort`.
      - Static boundary test prevents those service call sites from regaining
        direct engine wake/cache calls.
- [x] Packet K: auxiliary service render wake host migration.
      - Lazy image status changes, video-bake proxy presentation wakes, MIDI
        scene-camera live updates, and selected AI diagnostic/fixture wakes
        route through `renderHostPort`.
      - Boundary test covers all Packet J/K service call sites.
- [x] Packet L: playback-health render wake/cache host migration.
      - PlaybackHealth keeps engine diagnostics/readiness inspection, while
        purge, recovery, and reset wake/cache commands route through
        `renderHostPort`.
- [x] Packet M: VideoSync render wake host migration.
      - VideoSync coordinator wake commands route through `renderHostPort`.
      - Existing direct engine calls in VideoSync are now limited to frame
        presentation/cache operations for a later frame-presentation port.
- [x] Packet N: timeline store render wake/cache host migration.
      - Timeline store slices route render wake/cache commands through
        `renderHostPort`.
      - `renderHostPort.clearCaches()` was added for full cache invalidation.
      - Host top-level imports no longer pull in `useTimelineStore`,
        `playbackHealthMonitor`, or playback debug snapshots, preventing
        timeline-slice import cycles.
- [x] Packet O: frame-presentation/video-cache host migration.
      - `renderHostPort` owns current-engine delegation for video frame cache,
        presentation marker, pre-cache, GPU-ready, and cleanup commands.
      - VideoSync, lazy media cleanup, layer playback, slot deck, and media
        deletion cleanup call through the host instead of the engine singleton.
- [x] Packet P: primary render execution host migration.
      - Direct primary render, cached-frame render, composite cache, active
        composition output cache, continuous render, timeline visual demand,
        play state, and scrub state commands route through `renderHostPort`.
      - Static boundary tests now block those direct singleton calls in the
        migrated callers.
- [x] Packet Q: resolution and texture command host migration.
      - `useEngineResolutionSync`, `useEngineMaskTextureSync`, and generated
        Text/Solid/Math canvas slices route resolution, mask texture, canvas
        texture, and compositor binding commands through `renderHostPort`.
      - No direct `WebGPUEngine` imports remain in `src/hooks/**` or those
        generated-canvas slices.
- [x] Packet R: readback and capture host migration.
      - `previewFrameCapture`, AI preview handlers/grid capture, and SAM2
        capture call `renderHostPort` for `readPixels`, output dimensions, and
        DOM capture canvas lookup.
      - Direct `engine.readPixels`/`engine.getOutputDimensions` calls are now
        isolated to `renderHostPort`.
- [x] Packet S: GPU inspection host migration.
      - `clipAnalyzer` and GPU scope analysis call `renderHostPort` for
        `getDevice` and `getLastRenderedTexture`.
      - Direct engine device/last-texture inspection calls are isolated to
        `renderHostPort`.
- [x] Packet T: RAM-preview state and clear-frame host migration.
      - New-project frame clearing, RAM-preview generation flags, and scrub
        cache range reads route through `renderHostPort`.
      - Direct `engine.clearFrame`, `engine.setGeneratingRamPreview`, and
        `engine.getScrubbingCachedRanges` calls are isolated to
        `renderHostPort`; injected `RamPreviewEngine` rendering remains a
        later port.
- [x] Packet U: AI diagnostics host migration.
      - AI stats and debug-export handlers read cache stats, render-loop
        diagnostics, engine infrastructure, and render dispatcher debug
        snapshots through `renderHostPort`.
      - Direct engine diagnostic snapshot calls in those handlers are isolated
        to `renderHostPort`; the export handler still contains a
        `'WebGPUEngine'` log-module filter string.
- [x] Packet V: playback health diagnostics host migration.
      - PlaybackHealth and VideoSyncManager read stats, render-loop state, and
        LayerCollector readiness through `renderHostPort`.
      - Direct `engine.getStats`, `engine.getRenderLoop`, and
        `engine.getLayerCollector` calls in those paths are isolated to
        `renderHostPort`.
- [x] Packet W: RAM-preview render-engine injection host migration.
      - `renderHostPort.getRamPreviewRenderEngine()` exposes the existing
        minimal `RamPreviewRenderEngine` contract.
      - `ramPreviewSlice` and the RAM-preview AI smoke construct
        `RamPreviewEngine` through the host and no longer import
        `WebGPUEngine`.
- [x] Packet X: dev-bridge performance diagnostics host migration.
      - The performance debug action uses
        `renderHostPort.stopRenderLoopForDiagnostics()` and
        `renderHostPort.startExistingRenderLoopForDiagnostics()` for render-loop
        suppression probes.
      - The dev-bridge performance action no longer imports `WebGPUEngine`.
- [x] Packet Y: export render host port migration.
      - `exportRenderHostPort` owns current-engine delegation for export
        session setup, per-frame render/capture, export mask textures, gaussian
        splat preload, scene renderer initialization, and 3D model preload.
      - `ExportRenderSessionImpl`, `ExportMaskTextures`, and
        `preloadGaussianSplats` no longer import `WebGPUEngine` directly.
      - Export mask sync receives the session's injected export host instead of
        reaching back to the singleton port from inside `ExportRenderSessionImpl`.
- [x] Packet Z: W5 prerequisite gate evaluator.
      - `workerFirstW5Gates` makes shadow parity and visible-presentation gates
        executable without starting worker rendering.
      - `workerFirstRenderer.w5Prerequisites` reports that Worker WebGPU,
        worker presentation, and RenderDispatcher cutover must remain blocked
        until the W5 gates are actually green.
- [x] Packet AA: W5 gate counter input adapter.
      - `workerFirstGateInputs` maps `RenderSchedulerSnapshot`,
        `RenderCacheRegistrySnapshot`, and `FrameProviderStatus[]` into
        `workerFirstRenderer.counters`.
      - Non-empty queues, cache pressure, outstanding provider frames, and
        provider leaks can now feed the W5 prerequisite report instead of being
        represented only by static zero counters.
- [x] Packet AB: W5 proof capture registry and stats wiring.
      - `workerFirstProofCaptures` records golden fixture fingerprints,
        worker-shadow parity samples, and DOM-visible presentation proofs as
        runtime-only serializable data.
      - `getStats` and `getPlaybackTrace` pass recorded captures into
        `workerFirstRenderer.w5Prerequisites`; real worker-shadow and
        cross-platform capture runs are still required before any cutover.
- [x] Packet AC: W5 counter source registry and stats wiring.
      - `workerFirstCounterSources` records scheduler, cache, provider,
        transfer-latency, provider-wait, and presented-frame snapshots as
        runtime-only serializable data.
      - `getStats` and `getPlaybackTrace` pass recorded counter sources into
        `workerFirstRenderer.counters`; Packet BD later adds observation-only
        Main-Host runtime counters, while explicit worker job/provider run data
        is still required before the W5 gates can prove readiness.
      - Normal stats snapshots use `w5GateEvidenceMode: stats-observation`, so
        ad-hoc registry data cannot enable Worker WebGPU, worker presentation,
        or RenderDispatcher cutover.
- [x] Packet AD: W5 visible-presentation AI bridge capture entry point.
      - `captureWorkerFirstVisiblePresentationProof` records the current
        render-host capture canvas as runtime-only W5 visible-presentation
        evidence only when the requested platform/strategy match the latest
        capability probe.
      - The tool is devBridge/internal-only and does not accept caller-supplied
        playback stress counters.
      - The tool is observation data only; ordinary stats snapshots remain
        guarded and cannot enable Worker WebGPU, worker presentation, or
        RenderDispatcher cutover.
- [x] Packet AE: W5 visible-presentation playback-stress proof runner.
      - `runWorkerFirstVisiblePresentationStressProof` runs controlled
        `simulatePlayback`, requires observed preview frames, derives
        `staleVisibleFrameCount` from playback diagnostics, and records a
        fingerprinted render-host canvas proof.
      - The tool is devBridge/internal-only and records observation data only;
        ordinary stats snapshots remain guarded and cannot enable Worker
        WebGPU, worker presentation, or RenderDispatcher cutover.
- [x] Packet AF: W5 visible-pixel counter producer wiring.
      - Visible capture/stress proof tools publish real
        `workerFirstRenderer.counters.visiblePixels` data into
        `workerFirstCounterSources`.
      - Scheduler/cache/provider runtime producers are still not wired and
        remain explicit W5 blockers.
- [x] Packet AG: W0/W5 golden fixture main-renderer capture bridge.
      - `captureWorkerFirstGoldenFixtureFingerprint` records fingerprinted
        main-renderer evidence from the current render-host capture canvas for
        materialized manifest/sample combinations.
      - The tool is devBridge/internal-only, rejects caller-supplied source or
        fingerprint data, rejects `fixture-required` manifests, and requires
        observed current timeline signals to satisfy the selected manifest.
      - Real fixture materialization and browser capture runs are still
        required before the golden-manifest gate can pass.
- [x] Packet AH: `solid-text-image` golden fixture runner.
      - `runWorkerFirstSolidTextImageGoldenFixture` materializes a deterministic
        solid/text/image timeline and captures all `solid-text-image` manifest
        sample times through the existing main-renderer golden capture bridge.
      - The runner is devBridge/internal-only, rejects caller-supplied source,
        fingerprint, and sample-time proof fields, and records observation data
        only.
      - A real Windows/Chromium browser-bridge run captured 3/3 manifest sample
        fingerprints with `nonBlankRatio=1` and hash `441446da`. The
        in-memory stats snapshot later also reported `goldenFixtures=3`, but
        remaining `fixture-required` manifests were still uncaptured at that
        point.
- [x] Packet AJ: W0/W5 render capability probe bridge.
      - `runWorkerFirstRenderCapabilityProbe` runs the in-browser render
        capability probe from the AI bridge, rejects caller-supplied probe
        facts, and returns the probe plus selected strategy without enabling
        any W5 start permissions.
      - Real Windows/Chromium probe selected `worker-cpu-present` because
        worker WebGPU/device and OffscreenCanvas WebGPU are available, direct
        worker canvas presentation remains false, and `VideoFrame` transfer is
        false while `ImageBitmap` transfer and WebCodecs are available.
- [x] Packet AK: W5 visible capture freshness.
      - `captureWorkerFirstVisiblePresentationProof` now requests a diagnostic
        render before reading the render-host capture canvas, then records the
        refreshed canvas source and render diagnostics with the proof.
      - This fixed the stale black-canvas capture seen after golden fixture
        materialization; the real Windows/Chromium visible proof captured
        `renderTarget:preview`, `nonBlankRatio=1`, hash `441446da`, attached
        and unoccluded.
- [x] Packet AL: W5 visible stress stale metric refinement.
      - `runWorkerFirstVisiblePresentationStressProof` now derives
        `staleVisibleFrameCount` from `stalePreviewWhileTargetMoved`,
        preview-freeze frames, and startup target-moved stale frames instead of
        treating every unchanged static preview frame as stale.
      - The unit suite now covers static unchanged frames separately so a
        still-image/golden fixture cannot falsely fail the no-stale W5 proof.
      - A real Windows/Chromium project-video run using three imported MP4s
        proved visible playback while the app tab was visible:
        `previewFrames=77`, `previewUpdates=75`,
        `staleVisibleFrameCount=0`, `nonBlankRatio=0.8867`, hash `06677244`.
        The same proof cannot be rerun while the browser tab reports
        `document.hidden=true`; hidden-tab runs produce `layerCount=0`,
        `previewFrames=0`, and black capture counters.
- [x] Packet AM: W5 hidden-tab visible-proof guard.
      - DOM-visible proof capture now records document visibility metadata and
        rejects hidden documents before accepting visible-presentation evidence.
      - Visible capture and stress bridge tools fail fast when
        `document.hidden=true`/`visibilityState=hidden`, so hidden-tab black
        captures cannot be recorded as W5 proof data.
      - A live Windows/Chromium bridge retest while the app tab was hidden
        returned the expected foreground-tab errors for capture and stress.
      - After opening a foreground `localhost:5173` tab and targeting its
        `tabId`, visible capture and stress proof passed again on the three
        project-video timeline with nonblank fingerprints and zero derived
        stale visible frames.
- [x] Packet AN: `solid-text-image` worker-shadow parity bridge.
      - `runWorkerFirstSolidTextImageShadowParity` materializes the controlled
        `solid-text-image` fixture, captures main-renderer fingerprints, renders
        the same data-only fixture plan in a dedicated `.worker.ts`
        OffscreenCanvas 2D worker, compares fingerprints with fixed thresholds,
        and records runtime-only W5 shadow parity samples.
      - The tool rejects caller-supplied main/worker fingerprints, source, and
        thresholds, remains devBridge/internal-only, and keeps all W5 start
        permissions stats-guarded.
      - A real Windows/Chromium foreground-tab bridge run captured 3/3
        worker-shadow parity samples: main hash `441446da`, worker hash
        `1ef3bca8`, `avgRgbDelta=6.53`, `meanLumaDelta=7.2256`,
        `nonBlankRatioDelta=0`, and zero failures.
- [x] Packet AO: `multi-video` golden fixture runner.
      - `runWorkerFirstMultiVideoGoldenFixture` materializes three bundled
        project videos as simultaneous timeline clips, captures manifest sample
        times `[1, 2, 3, 4]` through the main-renderer golden bridge, and keeps
        W5 start permissions stats-guarded.
      - The runner rejects caller-supplied project ids, source/fingerprint/
        sample-time evidence, and asset-list overrides. Transient `File`/`Blob`
        construction is isolated in a media import helper outside the W5 proof
        module boundary.
      - A real Windows/Chromium bridge run targeted a visible tab after a
        5-second post-refresh wait and captured 4/4 nonblank samples:
        hashes `f8c77360`, `4ca390a6`, `c33fc354`, `64c20fad`,
        `minNonBlankRatio=0.3984`, and zero failures.
- [x] Packet AP: `nested-comps` golden fixture runner.
      - `runWorkerFirstNestedCompsGoldenFixture` materializes reusable parent
        and child composition clips with loaded nested image sources, captures
        manifest sample times `[0, 1.25, 2.5]` through the main-renderer
        golden bridge, and keeps W5 start permissions stats-guarded.
      - The runner rejects caller-supplied project ids, source/fingerprint/
        sample-time evidence, and caller-supplied composition trees. It stays
        devBridge/internal-only and keeps runtime handles out of durable W5
        proof state.
      - A real Windows/Chromium bridge run set the video layout, waited 5
        seconds for the preview target to register, and captured 3/3 nonblank
        samples from `renderTarget:preview`: hashes `e90a4f0a`, `422c7d6c`,
        `182cc7d2`, `minNonBlankRatio=0.3628`, and zero failures.
- [x] Packet AQ: `html-provider-fallback` golden fixture runner.
      - `runWorkerFirstHtmlProviderGoldenFixture` materializes a public-project
        video fixture through the temporary DOM video provider path, attaches an
        explicit HTML video runtime source, captures manifest sample times
        `[0, 1, 2]` through the main-renderer golden bridge, and keeps W5 start
        permissions stats-guarded.
      - The runner rejects caller-supplied project ids, source/fingerprint/
        sample-time evidence, asset overrides, and provider handles. Public
        video `File`/`Blob` construction plus the HTML video handle attachment
        stay isolated in the media import helper outside the W5 proof module
        boundary.
      - A real Windows/Chromium bridge run waited after HMR, set the video
        layout, waited again for the preview target, and captured 3/3 nonblank
        samples from `renderTarget:preview`: hashes `4595eb5f`, `40c44d5f`,
        `54424a8c`, `minNonBlankRatio=0.2708`, `alphaCoverage=1`, HTML video
        `readyState=4`, `1280x720`, and zero failures.
- [x] Packet AR: `webcodecs-provider` golden fixture runner.
      - `runWorkerFirstWebCodecsProviderGoldenFixture` materializes a
        controlled public MP4 fixture, attaches a full-mode WebCodecs provider
        without keeping an HTML video handle in the final clip source, captures
        manifest sample times `[0, 0.75, 1.5]` through the main-renderer
        golden bridge, and keeps W5 start permissions stats-guarded.
      - The runner rejects caller-supplied project ids, source/fingerprint/
        sample-time evidence, asset overrides, and provider handles. Transient
        public-video `File`/`Blob` construction plus WebCodecs setup stay
        isolated in the media import helper outside the W5 proof module
        boundary.
      - A real Windows/Chromium bridge run waited after HMR, set the video
        layout, waited again for the preview target, and captured 3/3 nonblank
        samples from `renderTarget:preview`: hashes `4595eb5f`, `34c35511`,
        `33522049`, `minNonBlankRatio=0.2708`, `alphaCoverage=1`, WebCodecs
        `fullMode=true`, `hasFrame=true`, `1280x720`, and zero failures.
- [x] Packet AS: `effects-masks-transitions` golden fixture runner.
      - `runWorkerFirstEffectsMasksTransitionsGoldenFixture` materializes
        controlled image clips with two color effects, one mask, a crossfade
        transition, and a `screen` blend mode, then captures manifest sample
        times `[0, 0.5, 1, 1.5]` through the main-renderer golden bridge.
      - The runner rejects caller-supplied project ids, source/fingerprint/
        sample-time evidence, clip/effect/mask/transition overrides, and blend
        mode overrides. The golden bridge now derives the required `blend-mode`
        signal from non-`normal` clip transforms.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required waits and captured 4/4 nonblank samples from
        `renderTarget:preview`: hashes `665e1edc`, `665e1edc`, `67e92d0b`,
        `ec5ac7ac`, `minNonBlankRatio=1`, `alphaCoverage=1`, effect count `2`,
        mask count `1`, transition count `1`, blend mode `screen`, and zero
        failures.
- [x] Packet AT: `jpeg-proxy` golden fixture runner.
      - `runWorkerFirstJpegProxyGoldenFixture` materializes a public-video
        clip, marks its media record as ready JPEG proxy, seeds deterministic
        runtime JPEG proxy frames, forces the same scrub/drag proxy-substitution
        state used by the LayerBuilder path, and captures manifest sample times
        `[0, 1, 2]` through the main-renderer golden bridge.
      - The golden bridge now derives `proxy-image` only when a video clip has
        active proxy substitution state, usable JPEG proxy metadata, and the
        timeline is in a scrub/drag-preview state. The runner rejects
        caller-supplied project ids, source/fingerprint/sample-time evidence,
        assets, providers, and proxy frames.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required 5-second post-HMR wait and captured 3/3 nonblank samples from
        `renderTarget:preview`: hashes `e39b58f3`, `63584e4a`, `cf787a81`,
        `minNonBlankRatio=0.5625`, `alphaCoverage=1`, proxy frame indices
        `0/24/48`, proxy status `ready`, proxy format `jpeg-sequence`, and zero
        failures.
- [x] Packet AU: `multi-target-output-slice` golden fixture runner.
      - `runWorkerFirstMultiTargetOutputSliceGoldenFixture` materializes the
        controlled solid/text/image content fixture, registers two runtime-only
        active composition preview targets, configures one enabled output slice,
        and captures manifest sample times `[0, 1, 2]` through the
        main-renderer golden bridge.
      - The golden bridge now derives `render-target` and `output-slice` from
        serializable render target snapshots. The runner rejects caller-supplied
        project ids, source/fingerprint/sample-time/target-snapshot evidence,
        render target overrides, canvas overrides, and slice config overrides.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required 5-second post-HMR wait and captured 3/3 nonblank samples from
        `renderTarget:preview`: hash `adfbb976` at sample times `0/1/2`,
        `nonBlankRatio=1`, `alphaCoverage=1`, active composition targets
        `preview/wfg-output-slice-target-a/wfg-output-slice-target-b`, enabled
        slice count `1`, output preview target `wfg-output-slice-target-a`, and
        zero failures.
- [x] Packet AV: `ram-cache` golden fixture runner.
      - `runWorkerFirstRamCacheGoldenFixture` materializes the controlled
        solid/text/image content fixture, generates RAM preview composite cache
        frames through the existing RAM preview path, requires cached composite
        frame hits for manifest sample times `[0, 0.5, 1]`, and captures those
        samples through the main-renderer golden bridge.
      - The golden bridge now derives `ram-preview` and `composite-cache` from
        serializable timeline/cache state. The runner rejects caller-supplied
        project ids, source/fingerprint/sample-time/target-snapshot evidence,
        preview range overrides, cached frame overrides, composite cache
        overrides, and smoke-path overrides.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required 5-second post-HMR wait and captured 3/3 nonblank cached-frame
        samples from `renderTarget:preview`: hash `b511ec5f` at sample times
        `0/0.5/1`, `nonBlankRatio=0.3164`, `alphaCoverage=1`, `cachedFrameHit`
        `true` for all samples, cached range `0-1.1667`, composite cache count
        `35`, mode `direct-engine-fallback`, and zero failures.
- [x] Packet AW: `bake` golden fixture runner.
      - `runWorkerFirstBakeGoldenFixture` materializes the controlled
        solid/text/image content fixture, marks and bakes a composition video
        region through the existing `FrameExporter`/`videoBakeProxyCache`
        product path, then marks and bakes a clip video region through the
        existing `startRamPreviewForRange` product path.
      - The golden bridge now derives `clip-bake` and `composition-bake` only
        from serializable video bake regions with `status: baked`. The runner
        rejects caller-supplied project ids, source/fingerprint/sample-time/
        target-snapshot evidence, bake-region overrides, bake-proxy overrides,
        and cached-frame overrides.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required 5-second post-HMR wait and captured 3/3 nonblank cached-frame
        samples from `renderTarget:preview`: hash `b511ec5f` at sample times
        `0/1/2`, `nonBlankRatio=0.3164`, `alphaCoverage=1`, `cachedFrameHit`
        `true` for all samples, clip bake cached range `0-2.1667`, cached
        frame count `65`, composition bake proxy ready for sample times `0/1`,
        and zero failures.
- [x] Packet AX: `export` golden fixture runner.
      - `runWorkerFirstExportGoldenFixture` materializes the controlled
        solid/text/image content fixture, runs the existing
        `debugExport`/`FrameExporter` export-preview-parity product path, then
        captures manifest sample times `[0, 1, 2]` through the main-renderer
        golden bridge.
      - The golden bridge now derives `export` only from controlled export
        evidence with a completed run, nonempty blob, published preview samples,
        and no export parity failures. The runner rejects caller-supplied
        project ids, source/fingerprint/sample-time/target-snapshot evidence,
        export range/codec/path overrides, blob overrides, and export-preview
        evidence overrides.
      - A real Windows/Chromium bridge run targeted the visible tab after the
        required 5-second post-HMR wait and captured 3/3 nonblank samples from
        `renderTarget:preview`: hash `441446da` at sample times `0/1/2`,
        `nonBlankRatio=1`, `alphaCoverage=1`, export blob size `20264`,
        export preview sample count `18`, export parity best sample hash
        `ad2d2825`, and zero failures.
- [x] Packet AY: `universal-3d-gaussian-cad` golden fixture runner.
      - `runWorkerFirstUniversal3dGoldenFixture` materializes the controlled
        solid/text/image content fixture, adds a real primitive mesh/model clip
        for the `3d` descriptor, and adds Gaussian-splat plus CAD technical
        geometry `SignalAsset` descriptor clips through the existing
        renderer-adapter/text-fallback surface.
      - The golden bridge now derives `3d` from 3D/model clips or CAD/model
        signal descriptors, derives `gaussian` from Gaussian signal
        descriptors, and derives `cad` from DXF/STEP-style SignalAsset
        extension/MIME/format-family metadata. The runner rejects
        caller-supplied proof fields, descriptor overrides, SignalAsset
        evidence, and content-fixture overrides.
      - A real Windows/Chromium bridge run hard-reloaded the app, waited the
        required 5 seconds, and captured 3/3 nonblank samples from
        `renderTarget:preview`: hash `d39823e2` at sample times `0/1/2`,
        `nonBlankRatio=1`, `alphaCoverage=1`, timeline signals
        `3d/cad/gaussian/image/model/render-target/solid/text`, and zero
        failures.

## Active Packet

None - first packet set A-I and follow-up Packets J-CP integrated locally.

- `src/services/render/renderHostPort.ts` adds a main-thread host facade.
- Preview target registration, `MultiPreviewSlot`, `TargetPreview`, and
  `TargetList` route their target/output commands through the facade.
- The host now owns initialization, render-loop start, stats polling, and
  render-loop watchdog restart logic.
- UI hook/component target, output, and render-wake commands route through the
  facade.
- Review fixes are integrated: priority-changing coalesced jobs re-sort,
  missing capability probes stay explicit instead of placeholder facts, provider
  events reject stale request/provider/generation mutations, and the new W1
  contracts are exported from the render contracts barrel.
- Direct engine render wake/cache commands are isolated to `renderHostPort`.
- Direct engine frame-presentation/video-cache commands are isolated to
  `renderHostPort`.
- Direct engine primary render commands are isolated to `renderHostPort`, except
  the `RamPreviewEngine` implementation's injected render-engine interface.
- Direct engine resolution, mask texture, generated canvas texture, and
  compositor binding commands are also isolated to `renderHostPort`.
- Direct engine readback, output-dimension capture helpers, and DOM capture
  canvas lookup are also isolated to `renderHostPort`.
- Direct engine device/last-texture inspection calls are also isolated to
  `renderHostPort`.
- Direct engine new-project clear-frame, RAM-preview flag, and scrub cache range
  commands are also isolated to `renderHostPort`.
- Direct AI stats/export engine diagnostic snapshot calls are also isolated to
  `renderHostPort`.
- Direct PlaybackHealth/VideoSync stats, render-loop, and LayerCollector
  diagnostic calls are also isolated to `renderHostPort`.
- RAM-preview render-engine injection is also host-owned.
- Dev-bridge performance render-loop diagnostic control is also host-owned.
- Export render-session, mask texture, gaussian splat, and 3D model preload
  engine calls are isolated to `exportRenderHostPort`; export mask sync uses the
  session-injected export host when a session provides one.
- W5 prerequisite gates are executable through `workerFirstW5Gates`, and the
  AI stats/trace `workerFirstRenderer` snapshot now exposes blocked/passed/
  failed gate state plus the three start-permission booleans.
- W5 gate input adapters can translate scheduler/cache/provider snapshots into
  the same `workerFirstRenderer.counters` used by the W5 prerequisite gates.
- W5 counter sources are recordable in memory and exposed through
  `workerFirstRenderer.counters`. Main-Host runtime observations and
  controlled worker-shadow drain counters now map through an explicit
  serializable worker-first runtime model. The live independent render
  scheduler and live cache producers now also publish cloneable runtime
  diagnostics into that model, but actual worker-owned provider producers are
  not running yet.
- Visible capture/stress proof tools now publish real visible-pixel counters
  into `workerFirstRenderer.counters.visiblePixels`.
- Worker-first stats are observation-only until an accepted W5 gate run is
  explicitly wired; ordinary `getStats`/`getPlaybackTrace` snapshots keep all
  start-permission booleans false.
- After the Packet AY hard reload, the volatile in-browser proof registry held
  only the AY universal fixture captures, `w5GateEvidenceMode` remained
  `stats-observation`, `capabilityProbeStatus` was `missing`, and all three W5
  start-permission booleans remained false. The next W5 work needs a fresh
  accepted evidence set rather than relying on prior in-memory captures.
- W5 proof captures are recordable in memory and exposed through
  `workerFirstRenderer.proofCaptures`. The `solid-text-image` manifest has a
  real Windows/Chromium main-renderer golden capture and a real
  Windows/Chromium worker-shadow parity run; the `multi-video` manifest has a
  real Windows/Chromium main-renderer golden capture; the `nested-comps`
  manifest has a real Windows/Chromium main-renderer golden capture; the
  `html-provider-fallback` manifest has a real Windows/Chromium main-renderer
  golden capture; the `webcodecs-provider` manifest has a real
  Windows/Chromium main-renderer golden capture from a full-mode WebCodecs
  provider; the `effects-masks-transitions` manifest has a real
  Windows/Chromium main-renderer golden capture; the `jpeg-proxy` manifest has
  a real Windows/Chromium main-renderer golden capture from the JPEG proxy
  substitution path; the `multi-target-output-slice` manifest has a real
  Windows/Chromium main-renderer golden capture from controlled render-target
  and output-slice routing; the `ram-cache` manifest has a real
  Windows/Chromium main-renderer golden capture from cached composite RAM
  preview frames; the `bake`, `export`, and `universal-3d-gaussian-cad`
  manifests also have real Windows/Chromium main-renderer golden captures. Full
  cross-platform visible-pixel runs are still missing.
- `captureWorkerFirstGoldenFixtureFingerprint` can record current main
  render-host canvas fingerprints for materialized manifests when the loaded
  timeline exposes the required signals. All currently defined golden manifests
  now have controlled materialization runners and Windows/Chromium
  main-renderer capture evidence.
- `runWorkerFirstSolidTextImageGoldenFixture` can materialize and capture the
  `solid-text-image` manifest through the dev bridge. It has unit coverage and
  a real Windows/Chromium browser run with 3 nonblank captures.
- `runWorkerFirstMultiVideoGoldenFixture` can materialize and capture the
  `multi-video` manifest through the dev bridge using bundled project videos.
  It has unit coverage and a real Windows/Chromium browser run with 4 nonblank
  captures after a 5-second post-refresh wait.
- `runWorkerFirstNestedCompsGoldenFixture` can materialize and capture the
  `nested-comps` manifest through the dev bridge using reusable nested parent
  and child compositions. It has unit coverage and a real Windows/Chromium
  browser run with 3 nonblank captures after a 5-second preview-layout wait.
- `runWorkerFirstHtmlProviderGoldenFixture` can materialize and capture the
  `html-provider-fallback` manifest through the dev bridge using a public
  project video and the temporary HTML video runtime provider path. It has unit
  coverage and a real Windows/Chromium browser run with 3 nonblank captures
  after post-HMR and preview-layout waits.
- `runWorkerFirstHtmlProviderShadowParity` can materialize and capture the
  same `html-provider-fallback` manifest, render a data-only OffscreenCanvas
  provider-video worker-shadow profile, and record controlled parity/counter
  evidence. It has unit coverage and a real Windows/Chromium browser run with
  3 shadow samples and 0 failures after reload plus the 7-second wait.
- `runWorkerFirstWebCodecsProviderGoldenFixture` can materialize and capture
  the `webcodecs-provider` manifest through the dev bridge using a public
  project video and a full-mode WebCodecs runtime provider. It has unit
  coverage and a real Windows/Chromium browser run with 3 nonblank captures
  after post-HMR and preview-layout waits.
- `runWorkerFirstWebCodecsProviderShadowParity` can materialize the same
  full-mode WebCodecs provider fixture through a shadow-only materializer,
  capture main-renderer fingerprints, render a data-only OffscreenCanvas
  provider-video worker-shadow profile, and record controlled parity/counter
  evidence. It has unit coverage and a real Windows/Chromium browser run with
  3 shadow samples and 0 failures after reload plus a 15-second wait.
- `runWorkerFirstEffectsMasksTransitionsGoldenFixture` can materialize and
  capture the `effects-masks-transitions` manifest through the dev bridge using
  controlled image clips with effects, a mask, a transition, and a non-normal
  blend mode. It has unit coverage and a real Windows/Chromium browser run with
  4 nonblank captures after the required post-HMR/preview waits.
- `runWorkerFirstJpegProxyGoldenFixture` can materialize and capture the
  `jpeg-proxy` manifest through the dev bridge using a public video plus
  controlled runtime JPEG proxy cache frames and active scrub proxy
  substitution state. It has unit coverage and a real Windows/Chromium browser
  run with 3 nonblank captures after the required 5-second post-HMR wait.
- `runWorkerFirstMultiTargetOutputSliceGoldenFixture` can materialize and
  capture the `multi-target-output-slice` manifest through the dev bridge using
  controlled runtime preview targets and output-slice routing. It has unit
  coverage and a real Windows/Chromium browser run with 3 nonblank captures
  after the required 5-second post-HMR wait.
- `runWorkerFirstRamCacheGoldenFixture` can materialize and capture the
  `ram-cache` manifest through the dev bridge using existing RAM preview
  generation and cached composite frame presentation. It has unit coverage and a
  real Windows/Chromium browser run with 3 nonblank cached-frame captures after
  the required 5-second post-HMR wait.
- `runWorkerFirstBakeGoldenFixture`, `runWorkerFirstExportGoldenFixture`, and
  `runWorkerFirstUniversal3dGoldenFixture` can materialize and capture the bake,
  export, and universal 3D/Gaussian/CAD manifests through existing product or
  descriptor surfaces. Each has unit coverage and a real Windows/Chromium
  bridge run with 3 nonblank captures after the required 5-second wait.
- `captureWorkerFirstVisiblePresentationProof` can record the current
  render-host capture canvas as probe-bound W5 visible-presentation evidence
  after requesting a fresh diagnostic render. Windows/Chromium is proven for
  a visible tab; the required platform matrix still has to be exercised.
- `runWorkerFirstVisiblePresentationStressProof` can collect no-stale playback
  stress evidence from real playback diagnostics and now counts only stale
  frames under target-motion demand. A Windows/Chromium project-video warmup
  stress run proved nonblank, moving visible playback with zero derived stale
  visible frames while the tab was visible; hidden-tab runs remain invalid.
- Visible proof and stress bridge tools now reject hidden browser tabs before
  recording proof data. A targeted foreground-tab rerun passed; future bridge
  reruns should use the visible/focused `tabId` when more than one app tab is
  connected.
- `runWorkerFirstSolidTextImageShadowParity` can record the first real
  worker-shadow W5 parity samples for `solid-text-image` through a dedicated
  OffscreenCanvas worker. The latest W5 report marks `golden-fingerprint-parity`
  passed for 3 samples, while `golden-fixtures-captured` remains blocked by 3
  uncaptured manifests in that AN-era report; later golden-fixture runners and
  Packet BM's phased accepted-suite run closed the current local
  Windows/Chromium evidence rebuild. W5 still needs the remaining non-Windows
  platform evidence packages plus a passing BN/BP matrix verification before
  any worker presentation/cutover start.
- Direct engine calls that remain outside host ports are injected render-engine
  implementation internals, not singleton imports from migrated callers.

Latest focused checks:

- Post-CD fresh Windows/Chromium platform package:
  `npm run worker-first:platform:collect -- --expect-platform windows-chromium --wait-ms 15000 --timeout-ms 300000 --duration-ms 5000 --min-preview-frames 3`
  returned `success`, selected tab `0695dc78-30f4-488b-b71d-56630bf88a2f`,
  wrote
  `tmp\worker-first-platform-evidence\20260616-111509Z-windows-chromium-5a291aab7b6e.package.json`,
  and produced evidence hash
  `5a291aab7b6eaf2210b8fff0366dc2821302303443fc9bab526f6d4d142b86db`.
  The package records platform `windows-chromium`, strategy
  `worker-cpu-present`, visible stress `frameCount=287`,
  `staleVisibleFrameCount=0`, `nonBlankRatio=1`, stats/trace start booleans
  false, and accepted gate counts `38 golden / 38 shadow / 1 visible` with
  `workerShadowParityStatus=passed`.
- Post-CD platform matrix verification for that package:
  `npm run worker-first:platform:status -- tmp\worker-first-platform-evidence\20260616-111509Z-windows-chromium-5a291aab7b6e.package.json`
  reported `Valid packages: 1/1`, `Invalid packages: 0`, and missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox`. Offline `verify` wrote
  `tmp\worker-first-platform-evidence\20260616-111516Z-offline-platform-matrix.report.json`
  and bridge `verify --bridge` wrote
  `tmp\worker-first-platform-evidence\20260616-111530Z-bridge-platform-matrix.report.json`;
  both correctly exited nonzero because the full cross-platform matrix is still
  incomplete.
- Packet CE platform aggregation helper:
  `scripts/run-worker-first-platform-evidence.mjs` now supports
  `--latest-per-platform` for `status` and `verify`. `node --check
  scripts\run-worker-first-platform-evidence.mjs` passed. Strict
  `npm run worker-first:platform:status` over the default output directory
  reported 3 valid Windows packages and `Duplicate platforms:
  windows-chromium`; `npm run worker-first:platform:status --
  --latest-per-platform` reported `Packages: 1 selected from 3`,
  `Valid packages: 1/1`, no duplicates, and the four expected missing target
  platforms. `npm run worker-first:platform:verify -- --latest-per-platform`
  wrote
  `tmp\worker-first-platform-evidence\20260616-111637Z-offline-platform-matrix.report.json`
  and correctly exited nonzero because the matrix is still incomplete.
- Packet CF platform doctor:
  `npm run worker-first:platform:doctor -- --latest-per-platform` passed and
  wrote
  `tmp\worker-first-platform-evidence\20260616-112157Z-platform-doctor.report.json`.
  It selected 1 package from 3, reported `Valid packages: 1/1`, missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox`, found 0 invalid packages, confirmed bridge clients were
  connected on `http://localhost:5173`, selected tab
  `0695dc78-30f4-488b-b71d-56630bf88a2f`, and recorded the 5000ms collector
  wait. Local audit: WSL Ubuntu currently has WSLg display variables but lacks
  Linux `node`, Chromium, Firefox, and `xvfb-run`; Docker is running but has no
  browser images. The current Vite server is bound to `[::1]:5173`, so WSL or
  containers cannot collect target packages from it without starting a host
  bound server and installing/providing real Linux browsers. No synthetic
  Linux/Mesa or macOS package was produced.
- Packet CG Linux Chromium/Mesa platform package:
  a host-bound Vite server on `http://172.20.96.1:5174/` plus a headed
  Playwright Docker Chromium tab produced a valid `linux-chromium-mesa`
  package. `npm run worker-first:platform:collect -- --base-url
  http://172.20.96.1:5174 --target-tab-id
  8f44bc99-5de2-44af-8b8e-546889c7731a --expect-platform
  linux-chromium-mesa --wait-ms 7000 --timeout-ms 300000 --duration-ms 3000
  --min-preview-frames 2 --sample-width 16 --sample-height 9
  --capture-settle-ms 1200 --start-time 0.5` returned `success` and wrote
  `tmp\worker-first-platform-evidence\20260616-115046Z-linux-chromium-mesa-c34c0bd31f80.package.json`.
  The package records strategy `worker-cpu-present`, GPU adapter
  `Google Inc. (Mesa) ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL
  4.5)`, visible stress `frameCount=10`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=1`, `attached=true`, `viewportIntersecting=true`, and
  `centerOccluded=false`.
- Post-CG matrix status:
  `npm run worker-first:platform:status -- --latest-per-platform` reported
  `Packages: 2 selected from 8`, `Valid packages: 2/2`, `Invalid packages: 0`,
  and missing only `linux-firefox-mesa`, `macos-safari`, and `macos-firefox`.
  `npm run worker-first:platform:verify -- --latest-per-platform` wrote
  `tmp\worker-first-platform-evidence\20260616-115054Z-offline-platform-matrix.report.json`
  and correctly exited nonzero because those three platform packages are still
  missing.
- Packet CH Linux Firefox/Mesa audit:
  a headed Playwright Docker Firefox tab opened `http://172.20.96.1:5175/`,
  waited 10000ms after `domcontentloaded`, confirmed `window.aiTools=true`,
  `isSecureContext=true`, `navigator.gpu=true`, and WebGL/WebGL2
  `Mesa llvmpipe, or similar`, then called
  `runWorkerFirstPlatformEvidencePackage` through the bridge. The resulting
  package
  `tmp\worker-first-platform-evidence\20260616-120940Z-linux-firefox-mesa-0b872474d34f.firefox-docker.package.json`
  correctly resolves `linux-firefox-mesa` with strategy `worker-cpu-present`,
  but is invalid: `fixtureSucceeded=false`, `visibleStressSucceeded=false`, and
  fixture captures fail with `No active render capture canvas is available`.
  Console evidence records `Failed to get GPU adapter (all attempts)`,
  `RenderHostPort Engine initialization failed`, and two 2000ms Firefox
  `requestAdapter` timeouts. Report:
  `tmp\worker-first-platform-evidence\20260616-120940Z-linux-firefox-mesa-0b872474d34f.firefox-docker.report.json`.
- Post-CH matrix status:
  `npm run worker-first:platform:status -- --latest-per-platform` reported
  `Packages: 3 selected from 9`, `Valid packages: 2/3`, `Invalid packages: 1`,
  and still lists `linux-firefox-mesa`, `macos-safari`, and `macos-firefox` as
  missing because the Firefox package is deliberately invalid evidence.
  `npm run worker-first:platform:verify -- --latest-per-platform` wrote
  `tmp\worker-first-platform-evidence\20260616-121214Z-offline-platform-matrix.report.json`
  and correctly exited nonzero.
- Post-CH focused checks:
  `npx vitest run tests/unit/renderCapabilityProbe.test.ts
  tests/unit/workerFirstPlatformEvidencePackage.test.ts
  tests/unit/workerFirstVisibleStressBridge.test.ts
  tests/unit/aiToolDefinitions.test.ts` passed 166 tests, and
  `npx tsc -b --pretty false` passed.
- Packet CI Linux Firefox/Mesa Vulkan package:
  after installing `mesa-vulkan-drivers` and `vulkan-tools` inside the
  Playwright Firefox Docker container, `vulkaninfo --summary` exposed a
  llvmpipe Vulkan device. A headed Firefox tab opened
  `http://172.20.96.1:5175/` with `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`,
  `MOZ_WEBGPU_FEATURES=vulkan`, Firefox WebGPU/force prefs, and the secure
  context allowlist. The run waited for `window.aiTools`, then another 12000ms,
  then polled bridge presence before calling
  `runWorkerFirstPlatformEvidencePackage`. It returned `success=true` and
  wrote
  `tmp\worker-first-platform-evidence\20260616-121906Z-linux-firefox-mesa-c7a094abdf71.firefox-vulkan-docker.package.json`.
  The package records strategy `worker-webgpu-main-present`, worker WebGPU
  device `true`, visible stress `frameCount=82`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=1`, `attached=true`, `viewportIntersecting=true`, and
  `centerOccluded=false`. Report:
  `tmp\worker-first-platform-evidence\20260616-121906Z-linux-firefox-mesa-c7a094abdf71.firefox-vulkan-docker.report.json`.
- Post-CI matrix status:
  `npm run worker-first:platform:status -- --latest-per-platform` reported
  `Packages: 3 selected from 10`, `Valid packages: 3/3`,
  `Invalid packages: 0`, and missing only `macos-safari` and `macos-firefox`.
  `npm run worker-first:platform:verify -- --latest-per-platform` wrote
  `tmp\worker-first-platform-evidence\20260616-122105Z-offline-platform-matrix.report.json`
  and correctly exited nonzero because those two macOS platform packages are
  still missing.
- Packet CJ macOS runbook CLI:
  `worker-first:platform:macos-runbook` prints the exact real-Mac Safari and
  Firefox collection commands, including `--expect-platform macos-safari`,
  `--expect-platform macos-firefox`, 12000ms visible-tab wait, 300000ms bridge
  timeout, visible stress args, and copy-back/final-verify instructions. This is
  not synthetic evidence; it is the handoff surface for collecting the two
  remaining target-browser packages on a real Mac.
- Post-CJ script checks:
  `node --check scripts\run-worker-first-platform-evidence.mjs` passed,
  `node scripts\run-worker-first-platform-evidence.mjs --help` lists
  `macos-runbook`, `npm pkg get` confirms the
  `worker-first:platform:macos-runbook` alias, and
  `npm run worker-first:platform:macos-runbook` prints `macos-safari`,
  `macos-firefox`, the no-Playwright-WebKit warning, and the normalized
  `tmp/worker-first-platform-evidence` copy-back path.
- Post-CJ matrix status:
  `npm run worker-first:platform:status -- --latest-per-platform` still reports
  `Packages: 3 selected from 10`, `Valid packages: 3/3`,
  `Invalid packages: 0`, and missing only `macos-safari` and `macos-firefox`.
  `npm run worker-first:platform:verify -- --latest-per-platform` wrote
  `tmp\worker-first-platform-evidence\20260616-122430Z-offline-platform-matrix.report.json`
  and correctly exited nonzero because those two macOS packages remain absent.
- Post-CK next-step guidance checks:
  `npm run worker-first:platform:status -- --latest-per-platform`,
  `npm run worker-first:platform:verify -- --latest-per-platform`, and
  `npm run worker-first:platform:doctor -- --latest-per-platform` all print
  `Next: run npm run worker-first:platform:macos-runbook on a real Mac...`.
  The latest expected-incomplete verify report is
  `tmp\worker-first-platform-evidence\20260616-122639Z-offline-platform-matrix.report.json`;
  the latest doctor report is
  `tmp\worker-first-platform-evidence\20260616-122639Z-platform-doctor.report.json`.
- Post-CL platform proof summary:
  `npm run worker-first:platform:status -- --latest-per-platform` and
  expected-failing `npm run worker-first:platform:verify -- --latest-per-platform`
  now print `Platform proofs:` with
  `windows-chromium: valid strategy=worker-cpu-present frames=287 stale=0 nonBlank=1`,
  `linux-chromium-mesa: valid strategy=worker-cpu-present frames=10 stale=0 nonBlank=1`,
  `linux-firefox-mesa: valid strategy=worker-webgpu-main-present frames=82 stale=0 nonBlank=1`,
  and the two missing macOS rows. The latest expected-incomplete verify report
  is `tmp\worker-first-platform-evidence\20260616-122918Z-offline-platform-matrix.report.json`.
- Post-CM CLI regression check:
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  2 tests covering the real-Mac `macos-runbook` output and partial-matrix
  proof-summary/next-step status output.
- Post-CN CLI regression check:
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  3 tests covering the real-Mac `macos-runbook`, partial-matrix status proof
  summary, and expected-failing verify report `nextStep` metadata.
- Post-CO bridge auth preflight:
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  4 tests, including a fake bridge-server token mismatch that must produce
  `Bridge auth: failed` and write `bridgeAuthError` into the doctor report.
  `npm run worker-first:platform:doctor -- --latest-per-platform` now prints
  `Bridge auth: ok` against the live `localhost:5173` bridge and wrote
  `tmp\worker-first-platform-evidence\20260616-123740Z-platform-doctor.report.json`.
- Post-CP durable feature docs:
  `docs/Features/Debugging.md` documents `/api/ai-tools/auth-check`,
  `worker-first:platform:doctor`, status, and `macos-runbook`;
  `docs/Features/Security.md` documents the dev bridge status/auth-check/POST
  auth rules; `docs/Features/AI-Integration.md` documents the status/auth-check
  distinction in the HMR bridge architecture.
- Post-CQ collector load-gate regression:
  `worker-first:platform:collect` now polls for a live, responsive dev-bridge
  target tab before starting the post-selection settle wait, revalidates the
  selected tab after the wait, and rejects stale explicit `--target-tab-id`
  values before dispatching `runWorkerFirstPlatformEvidencePackage`.
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  5 tests, including delayed bridge-tab registration before collect;
  `node --check scripts\run-worker-first-platform-evidence.mjs` passed.
  `npm run worker-first:platform:doctor -- --latest-per-platform` reported
  `Bridge auth: ok`, `Collector wait: 5000ms`, 3/3 valid selected packages,
  and wrote
  `tmp\worker-first-platform-evidence\20260616-124607Z-platform-doctor.report.json`.
  `npm run worker-first:platform:status -- --latest-per-platform` still reports
  the same three valid platform proofs and missing only `macos-safari` and
  `macos-firefox`.
- Post-CR readiness-report regression:
  Collect reports now record the target-tab wait timeout, elapsed target wait,
  poll count, selected tab before/after the post-selection settle wait,
  requested settle duration, and actual settle elapsed time. This makes the
  required post-load wait auditable for imported Linux/macOS packages.
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  5 tests, including assertions for the delayed-tab readiness metadata, and
  `node --check scripts\run-worker-first-platform-evidence.mjs` passed.
  `npm run worker-first:platform:doctor -- --latest-per-platform` reported
  `Bridge auth: ok`, `Collector wait: 5000ms`, and wrote
  `tmp\worker-first-platform-evidence\20260616-124908Z-platform-doctor.report.json`.
- Post-CS companion-report audit:
  `status`, `verify`, and `doctor` now inspect matching `*.report.json`
  companion files for the selected packages and include a non-blocking
  readiness audit. The audit separates missing companion reports,
  legacy-without-readiness reports, invalid readiness metadata, and auditable
  reports. `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts`
  passed 6 tests, including auditable companion reports and missing companion
  report summaries. `node --check scripts\run-worker-first-platform-evidence.mjs`
  passed. `npm run worker-first:platform:status -- --latest-per-platform`
  still reports 3/3 valid selected platform packages, missing only
  `macos-safari` and `macos-firefox`, plus
  `Readiness reports: 0/3 auditable (missing report: 0, legacy report: 3, invalid: 0)`
  for the older pre-CR Windows/Linux reports.
- Post-CT stale-tab audit:
  A fresh Windows/Chromium recollect attempt selected stale hidden tab
  `73c2c721-c3eb-45ec-b256-0d3feb1677c6` (`lastSeenAgoMs` about 47s) and
  timed out after 300s without a browser response. The failed report
  `tmp\worker-first-platform-evidence\20260616-130041Z-unknown-platform-nohash.report.json`
  captured the stale target in readiness metadata. A direct short `getStats`
  call proved another tab could respond, so `collect`/bridge verification now
  only accept tabs whose bridge Presence is fresh (`lastSeenAgoMs <= 10000`)
  and not unresponsive. `doctor` now prints fresh/stale/unresponsive tab
  counts. After the fix, `npm run worker-first:platform:doctor --
  --latest-per-platform` reports `Fresh tabs: 0/4 (stale: 4, unresponsive: 0,
  threshold: 10000ms)` and `Target tab: -`, preventing another long collect
  against stale Presence. `npx vitest run
  tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed 6 tests and
  `node --check scripts\run-worker-first-platform-evidence.mjs` passed.
- Post-CU Windows/Chromium auditable refresh:
  A new local Chrome window opened `http://localhost:5173/` and registered tab
  `572559f6-fe23-4f65-b2c3-517d259ca858` as fresh/visible. `npm run
  worker-first:platform:collect -- --target-tab-id
  572559f6-fe23-4f65-b2c3-517d259ca858 --expect-platform windows-chromium
  --wait-ms 12000 --timeout-ms 300000 --duration-ms 3000
  --min-preview-frames 2 --sample-width 16 --sample-height 9
  --capture-settle-ms 1200 --start-time 0.5 --reset-diagnostics` returned
  `success` and wrote
  `tmp\worker-first-platform-evidence\20260616-130559Z-windows-chromium-c085ce457863.package.json`
  plus matching report
  `tmp\worker-first-platform-evidence\20260616-130559Z-windows-chromium-c085ce457863.report.json`.
  The selected Windows package now records `frameCount=190`,
  `staleVisibleFrameCount=0`, `nonBlankRatio=1`, and readiness
  `targetWaitedMs=59`, `targetPollCount=1`,
  `postSelectionSettleWaitedMs=12001`. Post-collect `status` and `doctor`
  report `Packages: 3 selected from 11`, `Valid packages: 3/3`, missing only
  `macos-safari`/`macos-firefox`, and `Readiness reports: 1/3 auditable
  (missing report: 0, legacy report: 2, invalid: 0)`.
- Post-CV failed-collect package isolation:
  A Linux Chromium/Mesa auditable refresh attempt in headed Playwright Docker
  reached Mesa WebGL/llvmpipe and platform mapping, but did not expose WebGPU or
  an active render-capture canvas after load. Installing Mesa Vulkan drivers
  exposed Vulkan llvmpipe to the container, but Chromium Vulkan startup failed,
  so no valid Linux replacement package was produced. Failed collect payloads
  now write `*.failed.json` with `selectablePackage=false` in the report instead
  of matching the selectable `*.package.json` glob; the failed Linux payload was
  moved to
  `tmp\worker-first-platform-evidence\20260616-131655Z-linux-chromium-mesa-fnv1a-367a87.failed.json`.
- Post-CD runtime export/playback bridge smoke:
  `runWorkerFirstRuntimeExportPlaybackSmoke` with `playbackDurationMs=750`,
  `exportDurationSeconds=0.5`, `exportWidth=160`, `exportHeight=90`,
  `exportFps=8`, and `maxRuntimeMs=20000` returned `success=true`.
  Playback observed 44 moving frames and 0 stalled frames, export produced a
  2491-byte `video/mp4` blob without timeout, stats/trace runtime feeds were
  present, and stats/trace start-permission booleans remained false.
- Post-CD phased local W5 evidence rebuild after `reloadApp` on
  `http://localhost:5173/`, waiting 15 seconds, and collecting only
  `*-worker-shadow` runner ids with `clearBeforeRun=false` after the first
  phase:
  - Final shadow phase returned `success=true`, 38 golden fixture captures,
    38 worker-shadow samples, 0 missing golden manifests,
    `workerShadowParity=passed`, and
    `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
  - A follow-up no-runner visible/capability phase
    (`runnerIds=[]`, `clearBeforeRun=false`, `includeVisiblePresentationProofs=true`)
    returned `success=true`, capability platform `windows-chromium`,
    selected strategy `worker-cpu-present`, visible stress
    `frameCount=285`, `staleVisibleFrameCount=0`, `nonBlankRatio=1`,
    proof captures `38 golden / 38 shadow / 1 visible`, and
    `visiblePresentation=blocked` because the cross-platform visible-proof
    matrix is still incomplete.
- Packet CD focused tests:
  `npx vitest run tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 6 files, 217 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 45 files, 393 tests.
- CD live Windows/Chromium bridge proof after `reloadApp` on
  `http://localhost:5173/` and waiting 15 seconds:
  `runWorkerFirstWebCodecsProviderShadowParity` passed with 3 samples,
  0 failures, renderer `worker-offscreen-2d-webcodecs-provider`, sample times
  `0/0.75/1.5`, main nonblank `0.2813..0.4375`, worker nonblank `0.2734`,
  and `w5StartPermissionsRemainStatsGuarded=true`.
- CD targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with
  `runnerIds=['webcodecs-provider-worker-shadow']` and
  `includeVisiblePresentationProofs=false` reported runner success with
  3 shadow samples and 0 failures. The suite correctly remained incomplete,
  with all three W5 start-permission booleans false.
- Packet CC focused tests:
  `npx vitest run tests/unit/workerFirstHtmlProviderShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 211 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 44 files, 388 tests.
- CC live Windows/Chromium bridge proof after `reloadApp` on
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstHtmlProviderShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-html-provider-fallback`, sample times `0/1/2`,
  main nonblank `0.2813..0.4375`, worker nonblank `0.2734`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- CC targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with
  `runnerIds=['html-provider-fallback-worker-shadow']` and
  `includeVisiblePresentationProofs=false` reported runner success with
  3 shadow samples and 0 failures. The suite correctly remained incomplete,
  with all three W5 start-permission booleans false.
- Packet CB focused tests:
  `npx vitest run tests/unit/workerFirstMultiVideoShadowParity.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts`
  - Passed: 2 files, 8 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 43 files, 383 tests.
- CB live Windows/Chromium bridge proof after `reloadApp` on
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstMultiVideoShadowParity` passed with 4 samples, 0 failures,
  renderer `worker-offscreen-2d-multi-video`, sample times `1/2/3/4`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- CB boundary checks: `workerFirstSolidTextImageShadow.worker.ts` 602 LOC and
  `workerFirstShadowVideoProfiles.ts` 92 LOC.
- Packet CA focused definition checks:
  `npx vitest run tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 2 files, 193 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 43 files, 383 tests.
- CA boundary checks: `definitions/workerFirstRuntime.ts` 166 LOC,
  `definitions/workerFirstShadowRuntime.ts` 132 LOC,
  `definitions/workerFirst.ts` 644 LOC, and `handlers/index.ts` 668 LOC.
- Packet BZ focused tests:
  `npx vitest run tests/unit/workerFirstMultiVideoShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 210 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 43 files, 383 tests.
- BZ live Windows/Chromium bridge proof after `reloadApp` on
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstMultiVideoShadowParity` passed with 4 samples, 0 failures,
  renderer `worker-offscreen-2d-multi-video`, sample times `1/2/3/4`,
  main nonblank `0.3984..0.4219`, worker nonblank `0.3516`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- BZ targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['multi-video-worker-shadow']`
  and `includeVisiblePresentationProofs=false` reported runner success with
  4 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- BZ boundary checks: `workerFirstSolidTextImageShadow.worker.ts` 690 LOC,
  `workerFirstMultiVideoShadowParity.ts` 266 LOC,
  `definitions/workerFirstRuntime.ts` 671 LOC, and `handlers/index.ts` 668 LOC.
- Packet BY focused tests:
  `npx vitest run tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstRamCacheShadowParity.test.ts tests/unit/workerFirstBakeShadowParity.test.ts tests/unit/workerFirstExportShadowParity.test.ts tests/unit/workerFirstUniversal3dShadowParity.test.ts`
  - Passed: 5 files, 20 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 42 files, 378 tests.
- BY live Windows/Chromium bridge proof after `reloadApp` on
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstUniversal3dShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-universal-3d-gaussian-cad`, sample times
  `0/1/2`, and `w5StartPermissionsRemainStatsGuarded=true`.
- BY boundary checks: `workerFirstSolidTextImageShadow.worker.ts` 595 LOC and
  `workerFirstShadowWorkerFingerprint.ts` 106 LOC.
- Packet BX focused tests:
  `npx vitest run tests/unit/workerFirstUniversal3dShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 209 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 42 files, 378 tests.
- BX live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstUniversal3dShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-universal-3d-gaussian-cad`, sample times
  `0/1/2`, timeline signals `3d/cad/gaussian/image/model/solid/text`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- BX targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with
  `runnerIds=['universal-3d-gaussian-cad-worker-shadow']` and
  `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BW focused tests:
  `npx vitest run tests/unit/workerFirstExportShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 207 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 41 files, 372 tests.
- BW live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstExportShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-export`, sample times `0/1/2`, export preview
  parity `completed=true`, export blob size `19958`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- BW targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['export-worker-shadow']`
  and `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BV focused tests:
  `npx vitest run tests/unit/workerFirstBakeShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 205 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 40 files, 366 tests.
- BV live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstBakeShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-bake`, sample times `0/1/2`, baked cache hits
  for every sample, and `w5StartPermissionsRemainStatsGuarded=true`.
- BV targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['bake-worker-shadow']` and
  `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BU focused tests:
  `npx vitest run tests/unit/workerFirstRamCacheShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 203 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 39 files, 360 tests.
- BU live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstRamCacheShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-ram-cache`, sample times `0/0.5/1`, cache hits
  for every sample, and `w5StartPermissionsRemainStatsGuarded=true`.
- BU targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['ram-cache-worker-shadow']`
  and `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BT focused tests:
  `npx vitest run tests/unit/workerFirstNestedCompsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 201 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 38 files, 354 tests.
- BT live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstNestedCompsShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-nested-comps`, sample times `0/1.25/2.5`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- BT targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['nested-comps-worker-shadow']`
  and `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BS focused tests:
  `npx vitest run tests/unit/workerFirstJpegProxyShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 5 files, 199 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Broad Worker-First focused suite:
  `npx vitest run <all tests/unit/workerFirst*.test.ts from rg --files> tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 37 files, 348 tests.
- BS live Windows/Chromium bridge proof after opening/refocusing
  `http://localhost:5173/` and waiting 7 seconds:
  `runWorkerFirstJpegProxyShadowParity` passed with 3 samples, 0 failures,
  renderer `worker-offscreen-2d-jpeg-proxy`, sample times `0/1/2`, and
  `w5StartPermissionsRemainStatsGuarded=true`.
- BS targeted W5 suite runner proof:
  `runWorkerFirstW5EvidenceSuite` with `runnerIds=['jpeg-proxy-worker-shadow']`
  and `includeVisiblePresentationProofs=false` reported runner success with
  3 samples and 0 failures. The suite result remained expected-incomplete
  (`W5 evidence suite did not complete all required local evidence`),
  `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BR script checks:
  `node --check scripts/run-worker-first-platform-evidence.mjs`
  - Passed.
- `node scripts/run-worker-first-platform-evidence.mjs --help`
  - Passed and documents `--expect-platform <id>` for `collect`.
- BR invalid expected-platform guard:
  `node scripts/run-worker-first-platform-evidence.mjs collect --expect-platform nope`
  - Rejected before any bridge call with the required-platform id list.
- BR live Windows/Chromium collector proof after opening/refocusing a visible
  `http://localhost:5173/` tab and waiting 5 seconds:
  `npm run worker-first:platform:collect -- --expect-platform windows-chromium --duration-ms 1000 --min-preview-frames 1 --sample-width 16 --sample-height 9 --wait-ms 5000`
  passed with returned platform `windows-chromium`, wrote
  `tmp\worker-first-platform-evidence\20260616-090809Z-windows-chromium-50dd61100cba.package.json`,
  and reported evidence hash
  `50dd61100cba470c2631c779d875b3ae50a8c7734135239813a09cbce2a1bee3`.
- BR offline status proof:
  `npm run worker-first:platform:status -- tmp\worker-first-platform-evidence\20260616-090809Z-windows-chromium-50dd61100cba.package.json`
  exited successfully and reported `Valid packages: 1/1`, no invalid or
  duplicate packages, and missing `linux-chromium-mesa`,
  `linux-firefox-mesa`, `macos-safari`, and `macos-firefox`.
- Packet BQ script checks:
  `node --check scripts/run-worker-first-platform-evidence.mjs`
  - Passed.
- `node scripts/run-worker-first-platform-evidence.mjs --help`
  - Passed and documents the new `status` command.
- `npm pkg get scripts.worker-first:platform:collect scripts.worker-first:platform:verify scripts.worker-first:platform:status`
  - Passed.
- BQ offline status proof:
  `npm run worker-first:platform:status -- tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  exited successfully and reported `Valid packages: 1/1`, no invalid or
  duplicate packages, and missing `linux-chromium-mesa`,
  `linux-firefox-mesa`, `macos-safari`, and `macos-firefox`.
- Packet BP script checks:
  `node --check scripts/run-worker-first-platform-evidence.mjs`
  - Passed.
- BP offline expected-incomplete matrix proof:
  `npm run worker-first:platform:verify -- tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  reported `Valid packages: 1/1`, no invalid or duplicate packages, missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox`, and wrote
  `tmp\worker-first-platform-evidence\20260616-090319Z-offline-platform-matrix.report.json`.
- BP bridge cross-check of the same single package:
  `npm run worker-first:platform:verify -- --bridge tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  reported the same incomplete matrix and wrote
  `tmp\worker-first-platform-evidence\20260616-090319Z-bridge-platform-matrix.report.json`.
- Packet BO script checks:
  `node scripts/run-worker-first-platform-evidence.mjs --help`
  - Passed.
- `npm pkg get scripts.worker-first:platform:collect scripts.worker-first:platform:verify`
  - Passed.
- BO live collector proof after opening/refocusing a visible `localhost:5173`
  tab and waiting 5 seconds:
  `npm run worker-first:platform:collect -- --duration-ms 1000 --min-preview-frames 1 --sample-width 16 --sample-height 9 --wait-ms 5000`
  passed and wrote
  `tmp/worker-first-platform-evidence/20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  with evidence hash
  `513968b2f0a6cff6b71b9b16543221f8027469d23c001d1e5beb135b2ada9470`.
- BO expected-incomplete matrix proof:
  `npm run worker-first:platform:verify -- tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  reported `Valid packages: 1/1`, no invalid or duplicate packages, and missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox`; the command exits nonzero because the matrix is incomplete.
- Packet BN focused tests:
  `npx vitest run tests/unit/workerFirstPlatformEvidenceMatrix.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 4 files, 189 tests.
- `npx tsc -b --pretty false`
  - Passed.
- W5 focused suite including Packet BN:
  `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstPlatformEvidenceMatrix.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 35 files, 340 tests.
- BN boundary checks: `workerFirstPlatformEvidenceMatrix.ts` 252 LOC,
  `workerFirstPlatformEvidencePackage.ts` 474 LOC,
  `definitions/workerFirstRuntime.ts` 388 LOC, `handlers/index.ts` 647 LOC,
  `policy/registry.ts` 443 LOC, `workerFirstProofHarness.ts` 305 LOC,
  `workerFirstPlatformEvidenceMatrix.test.ts` 220 LOC.
- BN hygiene: `git diff --check` passed with CRLF warnings only; conflict
  marker scan passed; durable runtime-handle scan on the matrix verifier found
  no `WebGPUEngine`, GPU, DOM/media handle, `File`/`Blob`, `Map<`, or `Set<`
  matches.
- Packet BM focused tests:
  `npx vitest run tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 3 files, 186 tests.
- `npx tsc -b --pretty false`
  - Passed.
- W5 focused suite including Packet BM:
  `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 34 files, 333 tests.
- BM boundary checks: `workerFirstW5EvidenceSuite.ts` 603 LOC,
  `definitions/workerFirst.ts` 637 LOC,
  `workerFirstW5EvidenceSuite.test.ts` 515 LOC.
- BM live bridge proof after opening/refocusing a visible `localhost:5173` tab
  and waiting 5 seconds: targeted `runnerIds` phases rebuilt the accepted W5
  suite with `clearBeforeRun` true only for the first phase. The final
  visible-only call returned `success=true`, `goldenFixtures=38`,
  `shadowSamples=10`, `visibleProofs=1`, no failed runners, no failed visible
  evidence, no missing golden manifests, `workerShadowParity=passed`,
  `visiblePresentation=blocked`, `w5GateEvidenceMode=accepted-gate-run`,
  `frameCount=47`, `staleVisibleFrameCount=0`, `nonBlankRatio=1`, and all W5
  start booleans false. A live preflight also verified non-array `runnerIds`
  are rejected before proof-state clearing.
- Packet BL focused tests:
  `npx vitest run tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 6 files, 195 tests.
- `npx tsc -b --pretty false`
  - Passed.
- W5 focused suite including Packet BL:
  `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 34 files, 330 tests.
- BL live bridge proof after opening a fresh visible `localhost:5173` tab and
  waiting 5 seconds:
  `runWorkerFirstEffectsMasksTransitionsShadowParity` passed 4/4
  `effects-masks-transitions` samples with `mainNonBlank=1`,
  `workerNonBlank=1`, zero failures, and max deltas
  `avgRgbDelta=30.7599`, `meanLumaDelta=17.4127`,
  `nonBlankRatioDelta=0`, `colorRangeDelta=40.7405`. Follow-up `getStats`
  showed the 4 shadow samples in observation mode and all W5 start booleans
  false.
- Packet BK focused tests:
  `npx vitest run tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 3 files, 180 tests.
- `npx tsc -b --pretty false`
  - Passed.
- W5 focused suite including Packet BK:
  `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 33 files, 323 tests.
- BK live bridge proof after opening a fresh visible `localhost:5173` tab and
  waiting 5 seconds:
  `runWorkerFirstPlatformEvidencePackage` passed for `windows-chromium`,
  strategy `worker-cpu-present`, evidence hash
  `75ed56078ef2299e917394eb56bab9a0a79170cf05bed3dccbcc4de186359732`,
  visible stress `frameCount=42`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=1`, and all W5 start booleans false.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 26 files, 287 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Boundary scan over W5 AI tool modules for durable runtime handles:
  `WebGPUEngine|RenderDispatcher|GPUDevice|GPUTexture|HTMLVideoElement|HTMLImageElement|File|Blob|Map<|Set<`
  - Passed: word-boundary scan found no durable runtime handles in the W5 proof
    modules.
- `git diff --check --` on the changed W5 AI tool/test/docs files
  - Passed with CRLF normalization warnings only.
- Real AI bridge evidence on Windows/Chromium:
  capability probe selected `worker-cpu-present`; `solid-text-image` golden
  capture produced 3 nonblank fingerprints; visible capture produced
  `nonBlankRatio=1`; project-video warmup stress produced
  `previewFrames=77`, `previewUpdates=75`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=0.8867`. The latest bridge retest first confirmed hidden-tab
  capture/stress proof attempts reject with explicit foreground-tab errors,
  then targeted a foreground tab and passed visible capture
  (`nonBlankRatio=0.8867`, hash `06677244`) plus visible stress
  (`previewFrames=80`, `previewUpdates=74`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=0.9141`, hash `095aad65`). Packet AN then targeted the
  foreground tab and passed `runWorkerFirstSolidTextImageShadowParity` with
  3 worker-shadow samples: main hash `441446da`, worker hash `1ef3bca8`,
  `avgRgbDelta=6.53`, `meanLumaDelta=7.2256`,
  `nonBlankRatioDelta=0`. Packet AO then targeted a visible tab after a
  5-second post-refresh wait and passed
  `runWorkerFirstMultiVideoGoldenFixture` with 4 nonblank main-renderer samples:
  hashes `f8c77360`, `4ca390a6`, `c33fc354`, `64c20fad`,
  `minNonBlankRatio=0.3984`. Packet AP then set the video layout, waited 5
  seconds for the preview target to register, and passed
  `runWorkerFirstNestedCompsGoldenFixture` with 3 nonblank main-renderer
  samples from `renderTarget:preview`: hashes `e90a4f0a`, `422c7d6c`,
  `182cc7d2`, `minNonBlankRatio=0.3628`. Packet AQ then waited after HMR, set
  the video layout, waited 5 seconds for the preview target, and passed
  `runWorkerFirstHtmlProviderGoldenFixture` with 3 nonblank main-renderer
  samples from `renderTarget:preview`: hashes `4595eb5f`, `40c44d5f`,
  `54424a8c`, `minNonBlankRatio=0.2708`, HTML video `readyState=4`,
  `1280x720`. Packet AR then waited after HMR, set the video layout, waited 5
  seconds for the preview target, and passed
  `runWorkerFirstWebCodecsProviderGoldenFixture` with 3 nonblank main-renderer
  samples from `renderTarget:preview`: hashes `4595eb5f`, `34c35511`,
  `33522049`, `minNonBlankRatio=0.2708`, WebCodecs `fullMode=true`,
  `hasFrame=true`, `1280x720`. Packet AS then targeted the visible tab after
  the required waits and passed
  `runWorkerFirstEffectsMasksTransitionsGoldenFixture` with 4 nonblank
  main-renderer samples from `renderTarget:preview`: hashes `665e1edc`,
  `665e1edc`, `67e92d0b`, `ec5ac7ac`, `minNonBlankRatio=1`,
  `alphaCoverage=1`, fixture signals `blend-mode/effect/image/mask/transition`.
  Packet AT then targeted the same visible tab after the required 5-second
  post-HMR wait and passed `runWorkerFirstJpegProxyGoldenFixture` with 3
  nonblank main-renderer samples from `renderTarget:preview`: hashes
  `e39b58f3`, `63584e4a`, `cf787a81`, `minNonBlankRatio=0.5625`,
  `alphaCoverage=1`, proxy frame indices `0/24/48`, proxy status `ready`, and
  fixture signals `audio-clock/proxy-image/video`. Packet AU then targeted the
  same visible tab after the required 5-second post-HMR wait and passed
  `runWorkerFirstMultiTargetOutputSliceGoldenFixture` with 3 nonblank
  main-renderer samples from `renderTarget:preview`: hash `adfbb976` at sample
  times `0/1/2`, `nonBlankRatio=1`, `alphaCoverage=1`, active composition
  targets `preview/wfg-output-slice-target-a/wfg-output-slice-target-b`,
  enabled slice count `1`, output preview target
  `wfg-output-slice-target-a`, and fixture signals
  `image/output-slice/render-target/solid/text`. Packet AV then targeted the
  same visible tab after the required 5-second post-HMR wait and passed
  `runWorkerFirstRamCacheGoldenFixture` with 3 nonblank cached-frame
  main-renderer samples from `renderTarget:preview`: hash `b511ec5f` at sample
  times `0/0.5/1`, `nonBlankRatio=0.3164`, `alphaCoverage=1`,
  `cachedFrameHit=true` for all samples, cached range `0-1.1667`, composite
  cache count `35`, mode `direct-engine-fallback`, and fixture signals
  `composite-cache/image/ram-preview/render-target/solid/text`.
  Packet AW then targeted the same visible tab after the required 5-second
  post-HMR wait and passed `runWorkerFirstBakeGoldenFixture` with 3 nonblank
  cached-frame main-renderer samples from `renderTarget:preview`: hash
  `b511ec5f` at sample times `0/1/2`, `nonBlankRatio=0.3164`,
  `alphaCoverage=1`, `cachedFrameHit=true` for all samples, clip bake cached
  range `0-2.1667`, cached frame count `65`, composition bake proxy ready for
  sample times `0/1`, and fixture signals
  `clip-bake/composite-cache/composition-bake/image/ram-preview/render-target/solid/text`.
  Packet AX then targeted the same visible tab after the required 5-second
  post-HMR wait and passed `runWorkerFirstExportGoldenFixture` with 3 nonblank
  main-renderer samples from `renderTarget:preview`: hash `441446da` at sample
  times `0/1/2`, `nonBlankRatio=1`, `alphaCoverage=1`, export blob size
  `20264`, export preview sample count `18`, export parity best sample hash
  `ad2d2825`, and fixture signals `export/image/render-target/solid/text`.
  Packet AY then hard-reloaded the app, waited the required 5 seconds, and
  passed `runWorkerFirstUniversal3dGoldenFixture` with 3 nonblank
  main-renderer samples from `renderTarget:preview`: hash `d39823e2` at sample
  times `0/1/2`, `nonBlankRatio=1`, `alphaCoverage=1`, and fixture signals
  `3d/cad/gaussian/image/model/render-target/solid/text`.
- Follow-up `getStats.workerFirstRenderer` after Packet AY reported
  `w5GateEvidenceMode=stats-observation`, `capabilityProbeStatus=missing`,
  only the AY universal fixture captures in volatile memory, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- [x] Packet AZ: accepted W5 evidence-suite runner.
      - `runWorkerFirstW5EvidenceSuite` clears volatile proof captures, runs
        every current golden fixture runner plus the `solid-text-image`
        worker-shadow parity runner, and returns an explicit
        `accepted-gate-run` snapshot without enabling worker rendering,
        worker presentation, or RenderDispatcher cutover.
      - The JPEG-proxy fixture now clears the global proxy-frame cache before
        seeding controlled diagnostic proxy frames, so repeated suite runs do
        not inherit stale proxy-frame budget pressure.
      - Real Windows/Chromium bridge proof: after hard reload plus the required
        5-second wait, the suite passed all 13 runners with 38 golden fixture
        captures, 3 worker-shadow samples, 0 missing golden manifests,
        `workerShadowParity=passed`, `visiblePresentation=blocked`, and all
        W5 start-permission booleans false.
      - Follow-up `getStats.workerFirstRenderer` reported ordinary
        `w5GateEvidenceMode=stats-observation`, 12/12 golden manifests
        captured, 38 golden fixture captures, 3 shadow samples,
        `workerShadowParity=passed`, `visiblePresentation=blocked`, and all
        W5 start-permission booleans false.
- [x] Packet BA: accepted W5 suite local visible-stress evidence.
      - `runWorkerFirstW5EvidenceSuite` now derives the current proof platform
        from the in-browser capability probe, prepares an extended
        solid/text/image stress surface, runs controlled visible-presentation
        playback stress, and records that proof in the accepted snapshot.
      - `renderHostPort.getCaptureCanvas()` now scores capture candidates and
        prefers a DOM-visible preview canvas over offscreen output-slice
        targets, so visible-presentation proof does not accidentally sample a
        stale offscreen target after multi-target fixtures.
      - Real Windows/Chromium bridge proof: after a required 5-second HMR wait
        and targeting the focused `tabId`, the suite passed all 13 fixture/
        shadow runners plus `render-capability-probe`,
        `visible-stress-fixture`, and `visible-presentation-stress` with
        38 golden fixture captures, 3 worker-shadow samples, 1 visible proof,
        `nonBlankRatio=1`, `frameCount=308`, `staleVisibleFrameCount=0`,
        `dom-visible-nonblank=passed`,
        `no-stale-visible-frames-under-stress=passed`,
        `workerShadowParity=passed`, and `visiblePresentation=blocked` only
        because Linux/Mesa, Firefox, and macOS platform proofs are still
        missing. All W5 start-permission booleans remained false.
- [x] Packet BB: accepted W5 suite controlled shadow drain counters and stable
      visible-stress recapture.
      - `runWorkerFirstW5EvidenceSuite` now clears stale runtime counter
        sources at the start of an accepted run, so old scheduler/cache/
        provider observations cannot leak into a later gate snapshot.
      - `runWorkerFirstSolidTextImageShadowParity` records controlled
        shadow-run queue/cache/provider/timing counters into the W5 counter
        registry. The accepted snapshot now proves `queueDepth=0` and frame
        lifetime `outstanding=0/leaked=0` for the captured
        `solid-text-image` worker-shadow run.
      - `runWorkerFirstVisiblePresentationStressProof` now resets to the
        controlled capture time after playback stress, requests a fresh
        diagnostic render, and re-selects the capture canvas before
        fingerprinting. This fixed the post-reload blank WebGPU-canvas read
        seen during BA retest.
      - Real Windows/Chromium bridge proof: after reload plus the required
        5-second wait, the suite passed all 13 fixture/shadow runners plus
        `render-capability-probe`, `visible-stress-fixture`, and
        `visible-presentation-stress` with 38 golden fixture captures,
        3 worker-shadow samples, 1 visible proof, `queueDepth=0`, frame
        lifetime `outstanding=0/leaked=0`, `nonBlankRatio=1`, `frameCount=285`,
        `staleVisibleFrameCount=0`, `dom-visible-nonblank=passed`,
        `no-stale-visible-frames-under-stress=passed`,
        `workerShadowParity=passed`, and `visiblePresentation=blocked` only
        because Linux/Mesa, Firefox, and macOS platform proofs are still
        missing. All W5 start-permission booleans remained false.
- [x] Packet BC: second controlled worker-shadow parity runner for
      multi-target/output-slice.
      - `runWorkerFirstMultiTargetOutputSliceShadowParity` materializes the
        real `multi-target-output-slice` fixture, captures main-renderer
        fingerprints at manifest sample times `0/1/2`, renders a matching
        data-only OffscreenCanvas worker-shadow fingerprint for each sample,
        records parity samples, and publishes controlled queue/cache/provider/
        timing drain counters.
      - `runWorkerFirstW5EvidenceSuite` now runs 14 controlled fixture/shadow
        runners: the 12 golden fixtures plus `solid-text-image-worker-shadow`
        and `multi-target-output-slice-worker-shadow`. The accepted snapshot now
        carries 6 worker-shadow samples when both controlled shadow runners
        pass.
      - Real Windows/Chromium bridge proof: after reload plus the required
        5-second wait, the new shadow runner passed 3/3 samples with
        `mainNonBlank=1`, `workerNonBlank=1`, and renderer
        `worker-offscreen-2d-multi-target-output-slice`.
      - Real Windows/Chromium bridge proof: after reload plus the required
        5-second wait, the suite passed all 14 fixture/shadow runners plus
        `render-capability-probe`, `visible-stress-fixture`, and
        `visible-presentation-stress` with 38 golden fixture captures,
        6 worker-shadow samples, 1 visible proof, `queueDepth=0`,
        `nonBlankRatio=1`, `frameCount=311`, `staleVisibleFrameCount=0`,
        `workerShadowParity=passed`, and `visiblePresentation=blocked` only
        because Linux/Mesa, Firefox, and macOS platform proofs are still
        missing. All W5 start-permission booleans remained false.
- [x] Packet BD: Main-Host runtime counter observation adapter.
      - `workerFirstRuntimeCounterAdapter` derives W5 scheduler/cache/provider
        counter sources from serializable runtime data: `timelineRuntimeCoordinator`
        job/provider/resource snapshots, render-host scrubbing/composite cache
        stats, and render-loop demand state.
      - `getStats.workerFirstRenderer` and `getPlaybackTrace.workerFirstRenderer`
        now merge those runtime observations behind explicitly recorded
        accepted-run counters. This is still `stats-observation`; it does not
        enable worker WebGPU, worker presentation, or RenderDispatcher cutover.
      - Real Windows/Chromium bridge proof after reload plus the required wait:
        `getPlaybackTrace.workerFirstRenderer` reported
        `w5GateEvidenceMode=stats-observation` and runtime-derived
        `queueDepth=1`; after the tab settled further,
        `getStats.workerFirstRenderer` reported `queueDepth=1`, cache bytes
        `3686400`, `frameLifetime.outstanding=0`, one runtime resource, and all
        W5 start-permission booleans false.
- [x] Packet BE: explicit worker-first runtime job/provider/cache model.
      - `workerFirstRuntimeModel` represents runtime jobs, cache records,
        provider statuses, timing, pass counters, and visible-pixel counters as
        cloneable serializable records.
      - The model derives `RenderSchedulerSnapshot` and
        `RenderCacheRegistrySnapshot` from those records and converts the
        snapshot into the existing W5 counter-source surface.
      - `workerFirstRuntimeCounterAdapter` now builds a
        `main-host-observation` runtime snapshot before feeding runtime
        observations into `getStats.workerFirstRenderer` and
        `getPlaybackTrace.workerFirstRenderer`. This remains
        `stats-observation`; all W5 start-permission booleans remain false.
- `npx vitest run tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 4 files, 10 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 29 files, 303 tests.
- Real Windows/Chromium bridge proof after reload plus the required wait:
  `getStats.workerFirstRenderer` reported `w5GateEvidenceMode=stats-observation`,
  `queueDepth=1`, cache bytes `3686400`, `frameLifetime.outstanding=0`, one
  runtime resource, and all W5 start-permission booleans false. A follow-up
  `getPlaybackTrace.workerFirstRenderer` retry reported
  `w5GateEvidenceMode=stats-observation`, `queueDepth=1`, and
  `canStartWorkerWebGpu=false`.
- [x] Packet BF: controlled worker-shadow drain counters through runtime model.
      - `recordWorkerFirstShadowParityRunCounters` now builds a `worker-shadow`
        runtime snapshot with completed/dropped shadow jobs, zero-cache
        leak-check counters, empty providers, and presented-frame timing before
        recording W5 counter sources.
      - `runWorkerFirstSolidTextImageShadowParity` and
        `runWorkerFirstMultiTargetOutputSliceShadowParity` keep their existing
        rendering/parity behavior, but their drain counters now exercise the
        explicit runtime-model path.
      - This remains observation data only; all worker WebGPU, worker
        presentation, and RenderDispatcher cutover start permissions remain
        false.
- `npx vitest run tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts`
  - Passed: 5 files, 17 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 29 files, 303 tests.
- Live bridge runner proof for Packet BF was not captured. After reload
  attempts, the AI bridge returned `Timeout: no browser tab responded within
  30s` for both shadow parity runners and later for `getStats`, while the Vite
  server still returned HTTP 200 on `http://localhost:5173/`.
- [x] Packet BG: independent render scheduler producer diagnostics.
      - `renderScheduler.getWorkerFirstRuntimeSnapshot()` exposes cloneable
        recent independent-target render jobs and counters for black-frame,
        active-layer-filter, nested-texture-copy, composition-render, and
        composition-not-ready outcomes.
      - `getStats` and `getPlaybackTrace` publish the independent render
        scheduler diagnostic snapshot, and
        `workerFirstRuntimeCounterAdapter` maps its recent jobs into the
        explicit runtime-model job records used by W5 counters.
      - This is observation-only producer data; it does not enable worker
        WebGPU, worker presentation, or RenderDispatcher cutover.
- `npx vitest run tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 5 files, 11 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 30 files, 304 tests.
- Live bridge stats proof for Packet BG was not captured: `getStats` returned
  `Timeout: no browser tab responded within 30s`, while the Vite server still
  returned HTTP 200 on `http://localhost:5173/`.
- [x] Packet BH: cache producer diagnostics through runtime model.
      - `ScrubbingCache.getWorkerFirstCacheRuntimeSnapshot()` exposes cloneable
        cache records for scrub textures, last-frame GPU textures, RAM-preview
        composite frames, and RAM-preview GPU frame cache entries.
      - `CacheManager` and `renderHostPort` publish the cache runtime snapshot,
        `getStats`/`getPlaybackTrace` expose it as `cacheRuntime`, and
        `workerFirstRuntimeCounterAdapter` prefers these producer-owned cache
        records over the legacy scrubbing/composite cache stats fallback.
      - This is observation-only producer data; it does not enable worker
        WebGPU, worker presentation, or RenderDispatcher cutover.
- `npx vitest run tests/unit/cacheManagerRuntimeReporting.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 5 files, 12 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 30 files, 305 tests.
- Live bridge stats proof for Packet BH was not captured: `getStats` still
  returned `Timeout: no browser tab responded within 30s`, while the Vite
  server still returned HTTP 200 on `http://localhost:5173/`.
- [x] Packet BI: provider producer diagnostics through runtime model.
      - `providerRuntimeDiagnostics` builds cloneable provider runtime records
        from retained runtime resources and provider health diagnostics,
        preserving provider/source/session/policy/memory fields.
      - `getStats` and `getPlaybackTrace` expose the snapshot as
        `providerRuntime`, and `workerFirstRuntimeCounterAdapter` prefers
        these producer-owned provider records over the legacy timeline
        provider-health fallback.
      - This is observation-only producer data; it does not enable worker
        WebGPU, worker presentation, or RenderDispatcher cutover.
- `npx vitest run tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 5 files, 11 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 31 files, 307 tests.
- BI boundary checks: `providerRuntimeDiagnostics.ts` 167 LOC,
  `workerFirstRuntimeCounterAdapter.ts` 428 LOC, `handlers/stats.ts` 450 LOC;
  durable DOM/GPU/media-handle scan passed for the provider runtime diagnostics
  and adapter files.
- Live bridge stats proof for Packet BI was captured with a local headless
  Chrome tab after the required 5-second wait. Plain `getStats` exposed the
  top-level `providerRuntime` shape on a fresh empty project. A follow-up
  `runWorkerFirstHtmlProviderGoldenFixture` attempt failed its headless golden
  captures, but the subsequent `getStats.providerRuntime` contained 17
  producer-owned provider records (`providerKind=image`) with
  `w5GateEvidenceMode=stats-observation` and all W5 start-permission booleans
  false.
- [x] Packet BJ: runtime export/playback evidence smoke.
      - `runWorkerFirstRuntimeExportPlaybackSmoke` materializes the controlled
        solid/text/image runtime fixture, runs real `simulatePlayback`, runs the
        browser `debugExport` path with controlled codec/container selection,
        then collects `getStats` and `getPlaybackTrace`.
      - The smoke requires observed playback motion, an export blob, live
        scheduler/cache/provider runtime-feed shapes, and false W5
        start-permission booleans in both stats and trace.
      - Worker-first tool definitions were split into `workerFirst` and
        `workerFirstRuntime` definition modules so the touched source files
        stay below the 700 LOC ceiling.
- `npx vitest run tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts`
  - Passed: 6 files, 183 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 32 files, 312 tests.
- BJ boundary checks: `workerFirstRuntimeExportPlaybackSmoke.ts` 272 LOC,
  `definitions/stats.ts` 134 LOC, `definitions/workerFirst.ts` 608 LOC,
  `definitions/workerFirstRuntime.ts` 273 LOC, `handlers/index.ts` 601 LOC;
  durable DOM/GPU/media-handle scan passed for the new runtime smoke handler
  and test.
- Real bridge proof with local headless Chrome after the required 5-second
  wait: `runWorkerFirstRuntimeExportPlaybackSmoke` passed with playback
  `movingFrames=37`, export blob size `2094` (`video/mp4`, `h264/mp4`,
  `timedOut=false`), `cacheRuntimeRecordCount=4`,
  `providerRuntimeRecordCount=1`, `workerFirstRendererPresent=true`,
  `w5GateEvidenceMode=stats-observation`, and all W5 start booleans false.
- [x] Packet BK: hashable per-platform evidence package.
      - `runWorkerFirstPlatformEvidencePackage` rejects caller-supplied
        platform/proof/hash fields, runs the in-browser capability probe,
        prepares the controlled visible-stress fixture, runs the probe-bound
        visible-presentation stress proof, collects `getStats` and
        `getPlaybackTrace`, and returns a stable evidence package for one local
        platform.
      - The package is still evidence collection only: it does not enable worker
        WebGPU, worker presentation, or RenderDispatcher cutover, and it does
        not prove the required Linux/Mesa, Firefox, or macOS platform runs.
- `npx vitest run tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 3 files, 180 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 33 files, 323 tests.
- BK boundary checks: `workerFirstPlatformEvidencePackage.ts` 474 LOC,
  `definitions/workerFirstRuntime.ts` 327 LOC, `handlers/index.ts` 640 LOC,
  `policy/registry.ts` 431 LOC, `workerFirstPlatformEvidencePackage.test.ts`
  311 LOC; the new service/test durable runtime-handle scan had no
  `WebGPUEngine`, GPU, DOM/media handle, `File`/`Blob`, `Map`, or `Set`
  matches.
- First live BK bridge attempt after reload timed out with
  `Timeout: no browser tab responded within 30s`; opening a fresh visible
  `http://localhost:5173/` tab and waiting 5 seconds fixed the bridge.
- Real bridge proof after the visible-tab wait:
  `runWorkerFirstPlatformEvidencePackage` passed for `windows-chromium` with
  strategy `worker-cpu-present`, evidence hash
  `75ed56078ef2299e917394eb56bab9a0a79170cf05bed3dccbcc4de186359732`,
  visible stress `frameCount=42`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=1`, stats `cacheRuntimeRecordCount=4`,
  `providerRuntimeRecordCount=1`, `w5GateEvidenceMode=stats-observation`, and
  all W5 start booleans false. The accepted gate summary still reports missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox` platform packages.
- [x] Packet BL: third controlled worker-shadow parity runner.
      - `runWorkerFirstEffectsMasksTransitionsShadowParity` materializes the
        real `effects-masks-transitions` fixture, captures main-renderer
        fingerprints at manifest sample times `0/0.5/1/1.5`, renders a
        matching data-only OffscreenCanvas worker-shadow profile, records parity
        samples, and publishes controlled drain counters.
      - The default W5 evidence-suite runner list now includes
        `effects-masks-transitions-worker-shadow`, so an accepted suite rebuild
        covers three worker-shadow fixture surfaces: `solid-text-image`,
        `multi-target-output-slice`, and `effects-masks-transitions`.
      - This broadens W5 worker-shadow parity to effect, mask, transition, and
        blend-mode fixture signals, but it is still controlled 2D
        worker-shadow evidence, not worker-presenting cutover permission.
- `npx vitest run tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 6 files, 195 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts`
  - Passed: 34 files, 330 tests.
- BL boundary checks: `workerFirstEffectsMasksTransitionsShadowParity.ts` 266
  LOC, `workerFirstSolidTextImageShadow.worker.ts` 394 LOC,
  `workerFirstSolidTextImageShadowParity.ts` 406 LOC,
  `workerFirstW5EvidenceSuite.ts` 531 LOC,
  `definitions/workerFirstRuntime.ts` 368 LOC, `handlers/index.ts` 644 LOC,
  `policy/registry.ts` 437 LOC.
- Real bridge proof after opening a fresh visible `http://localhost:5173/` tab
  and waiting 5 seconds:
  `runWorkerFirstEffectsMasksTransitionsShadowParity` passed 4/4 samples with
  renderer `worker-offscreen-2d-effects-masks-transitions`,
  `mainNonBlank=1`, `workerNonBlank=1`, zero failures, and max observed deltas
  `avgRgbDelta=30.7599`, `meanLumaDelta=17.4127`,
  `nonBlankRatioDelta=0`, `colorRangeDelta=40.7405`. Follow-up
  `getStats.workerFirstRenderer` reported 4 shadow samples,
  `w5GateEvidenceMode=stats-observation`, and all W5 start booleans false.
- A live `runWorkerFirstW5EvidenceSuite` attempt after opening a visible tab
  timed out at the AI bridge response layer with
  `Timeout: no browser tab responded within 30s`; the suite is now longer than
  the bridge's 30-second response watchdog, so this is recorded as a bridge
  timeout, not a failed W5 runner.
- [x] Packet BM: phaseable accepted W5 evidence-suite runner.
      - `runWorkerFirstW5EvidenceSuite` now accepts exact controlled
        `runnerIds` and `clearBeforeRun=false`, so an accepted evidence rebuild
        can be split over multiple targeted bridge calls without accepting
        caller-supplied proof data.
      - Unknown runner ids and non-array `runnerIds` are rejected before
        clearing proof captures or counter sources. The result includes
        `runnerSelection` metadata with selected, skipped, requested, and
        clear-state details.
      - Real Windows/Chromium bridge proof: after opening/refocusing a visible
        `localhost:5173` tab and waiting 5 seconds, phased runner calls rebuilt
        38 golden fixture captures and 10 worker-shadow samples; a final
        visible-only call passed with 1 visible proof, `frameCount=47`,
        `staleVisibleFrameCount=0`, `nonBlankRatio=1`,
        `workerShadowParity=passed`, `visiblePresentation=blocked`, and all
        W5 start-permission booleans false.
- [x] Packet BN: read-only platform evidence matrix verifier.
      - `verifyWorkerFirstPlatformEvidenceMatrix` verifies the hashable
        packages returned by `runWorkerFirstPlatformEvidencePackage` across all
        required W5 platforms. It recomputes each package hash with the same
        canonical serializer, validates schema, required-platform coverage,
        worker-capable strategy, visible-stress frame/nonblank/stale counters,
        stats/trace start-permission guards, missing platforms, and duplicate
        platforms.
      - The verifier is read-only devBridge/internal automation. It reports
        matrix completeness but keeps worker WebGPU, worker presentation, and
        RenderDispatcher cutover booleans false; real target-browser package
        generation is still required for Linux Chromium/Mesa, Linux
        Firefox/Mesa, macOS Safari, and macOS Firefox.
- [x] Packet BO: platform evidence package collector/verifier script.
      - `scripts/run-worker-first-platform-evidence.mjs` provides `collect`
        and `verify` commands, with npm aliases
        `worker-first:platform:collect` and `worker-first:platform:verify`.
        `collect` targets the focused/visible bridge tab, waits for the tab to
        settle, runs `runWorkerFirstPlatformEvidencePackage`, and writes both a
        `*.package.json` artifact and a full report under
        `tmp/worker-first-platform-evidence/`.
      - Packet CE added `--latest-per-platform` for `status` and `verify`. The
        strict default still detects duplicate valid packages for the same
        platform, while the new option selects the newest package per platform
        for retry-heavy artifact directories.
      - Packet CF added `worker-first:platform:doctor`, a non-mutating
        preflight/status command that applies the offline matrix verifier,
        checks bridge/tab readiness, records the selected tab id, writes a
        doctor report, and exits successfully without running a browser proof.
      - `verify` reads package files (or all `*.package.json` files from the
        output directory) and calls `verifyWorkerFirstPlatformEvidenceMatrix`,
        writing a matrix report. A local Windows/Chromium collector run passed;
        verifying that single package correctly reports the four remaining
        required platform packages as missing.
- [x] Packet BP: offline platform matrix verification.
      - `worker-first:platform:verify` now verifies package files offline by
        default, recomputing SHA-256 hashes from the same canonical package
        payload ordering and applying the same platform/stress/start-guard
        invariants as the app verifier.
      - `worker-first:platform:verify -- --bridge <packages...>` remains
        available as a browser/app parity cross-check when a visible bridge tab
        is connected. Offline and bridge verification of the current single
        Windows package both report the same incomplete matrix.
- [x] Packet BQ: non-failing platform matrix status view.
      - `worker-first:platform:status` reads package files with the offline
        matrix verifier and prints valid/missing/duplicate/invalid counts, but
        exits successfully for incomplete matrices. This is for tracking
        in-progress target-platform collection; `worker-first:platform:verify`
        remains the failing gate.
- [x] Packet BR: collect-time target-platform expectation guard.
      - `worker-first:platform:collect -- --expect-platform <id>` validates
        that the returned hashable package's self-reported platform matches the
        target-machine id expected by the operator. The expected id is recorded
        in the collection report, but it is not forwarded into the in-browser
        proof tool and cannot synthesize or relabel evidence.
      - A live Windows/Chromium collector run with
        `--expect-platform windows-chromium` passed and produced package
        `tmp\worker-first-platform-evidence\20260616-090809Z-windows-chromium-50dd61100cba.package.json`;
        the platform matrix still remains incomplete until the four required
        non-Windows target-browser packages are collected.
- [x] Packet BS: fourth controlled worker-shadow parity runner.
      - `runWorkerFirstJpegProxyShadowParity` materializes the real
        deterministic `jpeg-proxy` fixture, captures main-renderer fingerprints,
        renders data-only OffscreenCanvas worker-shadow fingerprints for sample
        times `0/1/2`, records parity samples, and publishes controlled
        queue/cache drain counters without enabling worker WebGPU,
        worker-presentation, or RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['jpeg-proxy-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet BT: fifth controlled worker-shadow parity runner.
      - `runWorkerFirstNestedCompsShadowParity` materializes the real
        deterministic `nested-comps` fixture, captures main-renderer
        fingerprints, renders data-only OffscreenCanvas worker-shadow
        fingerprints for sample times `0/1.25/2.5`, records parity samples, and
        publishes controlled queue/cache drain counters without enabling worker
        WebGPU, worker-presentation, or RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['nested-comps-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet BU: sixth controlled worker-shadow parity runner.
      - `runWorkerFirstRamCacheShadowParity` materializes the real
        RAM-preview/composite-cache fixture, requires cached-frame hits for
        sample times `0/0.5/1`, captures main-renderer cache fingerprints,
        renders data-only OffscreenCanvas worker-shadow fingerprints, records
        parity samples, and publishes controlled queue/cache drain counters
        without enabling worker WebGPU, worker-presentation, or
        RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['ram-cache-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet BV: seventh controlled worker-shadow parity runner.
      - `runWorkerFirstBakeShadowParity` materializes the real clip-bake and
        composition-bake fixture, requires baked cached-frame hits for sample
        times `0/1/2`, captures main-renderer bake fingerprints, renders
        data-only OffscreenCanvas worker-shadow fingerprints, records parity
        samples, and publishes controlled queue/cache drain counters without
        enabling worker WebGPU, worker-presentation, or RenderDispatcher
        cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['bake-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet BW: eighth controlled worker-shadow parity runner.
      - `runWorkerFirstExportShadowParity` materializes the real export
        preview-parity fixture through the existing export smoke, reads the
        controlled main-renderer export fingerprints from the export golden
        runner, renders data-only OffscreenCanvas worker-shadow fingerprints,
        records parity samples, and publishes controlled queue/cache drain
        counters without enabling worker WebGPU, worker-presentation, or
        RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['export-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet BX: ninth controlled worker-shadow parity runner.
      - `runWorkerFirstUniversal3dShadowParity` materializes the real
        universal 3D/Gaussian/CAD descriptor fixture, captures main-renderer
        fingerprints, renders data-only OffscreenCanvas worker-shadow
        fingerprints, records parity samples, and publishes controlled
        queue/cache drain counters without enabling worker WebGPU,
        worker-presentation, or RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with
        `runnerIds=['universal-3d-gaussian-cad-worker-shadow']` confirmed the
        runner is phaseable; the overall suite correctly remained incomplete/
        blocked because the other golden, visible, and platform evidence was
        intentionally not collected in that call.
- [x] Packet BY: shared worker-shadow fingerprint helper split.
      - Moved pixel fingerprinting/hash helpers from
        `workerFirstSolidTextImageShadow.worker.ts` into
        `workerFirstShadowWorkerFingerprint.ts` without changing any draw path.
      - The shared shadow worker dropped from 696 LOC to 595 LOC, with the new
        helper at 106 LOC, so the next video/provider shadow runners have room
        under the 700 LOC source ceiling.
- [x] Packet BZ: tenth controlled worker-shadow parity runner.
      - `runWorkerFirstMultiVideoShadowParity` materializes the real
        three-video fixture, captures main-renderer fingerprints, renders
        data-only OffscreenCanvas worker-shadow fingerprints, records parity
        samples, and publishes controlled queue/cache drain counters without
        enabling worker WebGPU, worker-presentation, or RenderDispatcher cutover
        permissions.
      - Live Windows/Chromium bridge proof passed with 4 samples and 0 failures.
        A targeted W5 suite call with `runnerIds=['multi-video-worker-shadow']`
        confirmed the runner is phaseable; the overall suite correctly remained
        incomplete/blocked because the other golden, visible, and platform
        evidence was intentionally not collected in that call.
- [x] Packet CA: Worker-First shadow runtime tool-definition split.
      - Moved the repeated worker-shadow parity AI tool definition schemas into
        `workerFirstShadowRuntime.ts` and composed them from
        `workerFirstRuntime.ts`, preserving the same bridge tool names.
      - `workerFirstRuntime.ts` dropped from 671 LOC to 166 LOC, creating room
        for the remaining provider-shadow bridge definitions.
- [x] Packet CB: multi-video worker-shadow draw-profile split.
      - Moved the multi-video worker-shadow drawing profile into
        `workerFirstShadowVideoProfiles.ts` without changing the runner or
        parity thresholds.
      - `workerFirstSolidTextImageShadow.worker.ts` dropped from 690 LOC to
        602 LOC; live Windows/Chromium multi-video shadow parity remained green
        with 4 samples and 0 failures.
- [x] Packet CC: eleventh controlled worker-shadow parity runner.
      - `runWorkerFirstHtmlProviderShadowParity` materializes the real
        HTML-video provider fallback fixture, captures main-renderer
        fingerprints, renders data-only OffscreenCanvas provider-video
        worker-shadow fingerprints, records parity samples, and publishes
        controlled queue/cache drain counters without enabling worker WebGPU,
        worker presentation, or RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with
        `runnerIds=['html-provider-fallback-worker-shadow']` confirmed the
        runner is phaseable; the overall suite correctly remained incomplete
        because the other golden, visible, and platform evidence was
        intentionally not collected in that call.
- [x] Packet CD: twelfth controlled worker-shadow parity runner.
      - `runWorkerFirstWebCodecsProviderShadowParity` materializes the real
        full-mode WebCodecs provider fixture through a shadow-only materializer,
        captures main-renderer fingerprints, renders data-only OffscreenCanvas
        provider-video worker-shadow fingerprints, records parity samples, and
        publishes controlled queue/cache drain counters without enabling worker
        WebGPU, worker presentation, or RenderDispatcher cutover permissions.
      - Live Windows/Chromium bridge proof passed with 3 samples and 0 failures.
        A targeted W5 suite call with
        `runnerIds=['webcodecs-provider-worker-shadow']` confirmed the runner is
        phaseable; the overall suite correctly remained incomplete because the
        other golden, visible, and platform evidence was intentionally not
        collected in that call.
- `npx vitest run tests/unit/aiToolStats.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstCounterSources.test.ts`
  - Passed: 3 files, 8 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 28 files, 301 tests.
- `npx vitest run tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 6 files, 189 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 28 files, 300 tests.
- `npx vitest run tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstW5Gates.test.ts`
  - Passed: 3 files, 15 tests.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 27 files, 294 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/renderHostPort.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/aiToolDefinitions.test.ts`
  - Passed: 4 files, 148 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 27 files, 292 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 13 files, 187 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "WebGPUEngine|RenderDispatcher|GPUDevice|GPUTexture|HTMLVideoElement|HTMLImageElement|File|Blob|Map<|Set<" src\services\aiTools\workerFirstSolidTextImageGoldenFixture.ts src\services\aiTools\workerFirstGoldenFixtureBridge.ts src\services\aiTools\workerFirstVisibleStressBridge.ts src\services\aiTools\workerFirstVisibleCaptureBridge.ts src\services\aiTools\workerFirstProofPlatform.ts src\services\aiTools\workerFirstCounterSources.ts src\services\aiTools\workerFirstProofCaptures.ts src\services\aiTools\workerFirstProofHarness.ts src\services\aiTools\workerFirstGateInputs.ts src\services\aiTools\workerFirstW5Gates.ts`
  - Passed: no durable runtime handle matches; only
    start-permission property names matched.
- `git diff --check -- src\services\aiTools\workerFirstSolidTextImageGoldenFixture.ts src\services\aiTools\definitions\stats.ts src\services\aiTools\policy\registry.ts src\services\aiTools\handlers\index.ts src\services\aiTools\workerFirstProofHarness.ts tests\unit\workerFirstSolidTextImageGoldenFixture.test.ts tests\unit\workerFirstProofHarness.test.ts tests\unit\aiToolDefinitions.test.ts tests\unit\aiToolPolicy.test.ts`
  - Passed with CRLF normalization warnings only.
- Read-only `codex exec` second-opinion review for Packet AH was attempted and
  timed out after 154 seconds without a usable report. The prior Packet AG
  review attempt also timed out after 184 seconds.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/exportRenderSession.test.ts tests/unit/exportAssetPreload.test.ts tests/unit/exportRenderHostPortBoundary.test.ts`
  - Passed: 5 files, 25 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n 'from .*WebGPUEngine|import\\(.*WebGPUEngine' src/services src/stores src/hooks src/components src/engine/export`
  - Passed: only `src/services/render/renderHostPort.ts` and
    `src/engine/export/exportRenderHostPort.ts` import the engine singleton.
- `npx vitest run tests/unit/exportRenderSession.test.ts tests/unit/exportAssetPreload.test.ts tests/unit/exportRenderHostPortBoundary.test.ts`
  - Passed: 3 files, 16 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts`
  - Passed: 2 files, 9 tests after Packet X.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/aiToolStats.test.ts tests/unit/playbackSliceGate.test.ts tests/unit/timelineSessionGuard.test.ts tests/unit/serializationNestedRestore.test.ts tests/unit/timelineArchitectureRegistry.test.ts`
  - Passed: 7 files, 116 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/playbackHealthMonitor.test.ts tests/unit/videoSyncManager.test.ts tests/unit/videoSyncManagerSyncGate.test.ts tests/unit/layerBuilderService.test.ts`
  - Passed: 6 files, 90 tests.
- `rg -n "WebGPUEngine|engine\\.(getStats|getLayerCollector|getRenderLoop)" src\\services\\playbackHealthMonitor.ts src\\services\\layerBuilder\\VideoSyncManager.ts`
  - Passed: no matches.
- `rg -n "engine\\.(getStats|getLayerCollector)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n 'engine\\.(getScrubbingCacheStats|getCompositeCacheStats|getDebugInfrastructureState|getRenderDispatcherDebugSnapshot)' src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n 'engine\\.getRenderLoop' src/stores src/services src/hooks src/components`
  - Passed: only `renderHostPort` and dev-bridge performance debug action
    remain.
- `rg -n "engine\\.(clearFrame|setGeneratingRamPreview|getScrubbingCachedRanges)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n "WebGPUEngine|engine\\.(clearFrame|setGeneratingRamPreview|getScrubbingCachedRanges)" src\\stores\\mediaStore\\slices\\projectSlice.ts src\\stores\\timeline\\proxyCacheSlice.ts`
  - Passed: no matches.
- `rg -n "WebGPUEngine|engine\\.(getDevice|getLastRenderedTexture)" src\\services\\clipAnalyzer.ts src\\components\\panels\\scopes\\useScopeAnalysis.ts`
  - Passed: no matches.
- `rg -n "engine\\.(getDevice|getLastRenderedTexture)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n "WebGPUEngine|engine\\.(readPixels|getOutputDimensions)" src\\services\\previewFrameCapture.ts src\\services\\aiTools\\handlers\\preview.ts src\\services\\aiTools\\utils.ts src\\components\\panels\\SAM2Panel.tsx src\\components\\preview\\SAM2Overlay.tsx`
  - Passed: no matches.
- `rg -n "engine\\.(readPixels|getOutputDimensions)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n "engine\\.(setResolution|getOutputDimensions|updateMaskTexture|removeMaskTexture|getTextureManager)" src/stores src/services src/hooks src/components`
  - Passed: `setResolution`, mask texture, and `getTextureManager` commands
    are isolated to `renderHostPort`.
- `rg -n "WebGPUEngine" src/hooks src/stores/timeline/textClipSlice.ts src/stores/timeline/solidClipSlice.ts src/stores/timeline/mathSceneClipSlice.ts`
  - Passed: no matches.
- `rg -n "engine\\.(render\\(|renderCachedFrame|cacheCompositeFrame|cacheActiveCompOutput|setContinuousRender|setTimelineVisualDemand|setIsPlaying|setIsScrubbing)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` and injected
    `src/services/ramPreviewEngine.ts` matches.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/playbackSliceGate.test.ts tests/unit/timelineSessionGuard.test.ts tests/unit/serializationNestedRestore.test.ts`
  - Passed: 5 files, 52 tests.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/videoSyncManager.test.ts tests/unit/videoSyncManagerSyncGate.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/layerPlaybackManagerWarmDeck.test.ts tests/unit/slotDeckManager.test.ts tests/unit/projectMediaPersistence.test.ts`
  - Passed: 8 files, 116 tests.
- `npx vitest run tests/unit/timelineArchitectureRegistry.test.ts`
  - Passed: 1 file, 63 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "engine\\.(requestRender|requestNewFrameRender|clearVideoCache|clearScrubbingCache|clearCompositeCache|clearCaches)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `rg -n "engine\\.(cleanupVideo|preCacheVideoFrame|ensureVideoFrameCached|cacheFrameAtTime|markVideoFramePresented|captureVideoFrameAtTime|getLastPresentedVideoTime|markVideoGpuReady)" src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` matches.
- `npx vitest run tests/unit/renderHostServiceCallers.test.ts tests/unit/videoSyncManager.test.ts tests/unit/videoSyncManagerSyncGate.test.ts tests/unit/layerBuilderService.test.ts`
  - Passed: 4 files, 80 tests.
- `npx vitest run tests/unit/renderHostServiceCallers.test.ts tests/unit/playbackHealthMonitor.test.ts tests/unit/videoBakeProxyCache.test.ts tests/unit/layerBuilderService.test.ts`
  - Passed: 4 files, 39 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostServiceCallers.test.ts tests/unit/videoBakeProxyCache.test.ts tests/unit/layerBuilderService.test.ts`
  - Passed: 3 files, 35 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostServiceCallers.test.ts tests/unit/webCodecsHelpers.test.ts tests/unit/mediaRuntime.test.ts tests/unit/layerBuilderService.test.ts`
  - Passed: 4 files, 57 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/previewTargetRegistration.test.ts tests/unit/usePreviewRenderTargetRegistration.test.tsx tests/unit/cachedFrameVisiblePresentation.smoke.test.ts`
  - Passed: 4 files, 15 tests.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/exportRenderSession.test.ts tests/unit/exportAssetPreload.test.ts tests/unit/exportRenderHostPortBoundary.test.ts tests/unit/cachedFrameRenderer.test.ts tests/unit/cachedFrameVisiblePresentation.smoke.test.ts tests/unit/usePreviewRenderTargetRegistration.test.tsx tests/unit/previewTargetRegistration.test.ts tests/unit/renderOutputRouterAdapter.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/renderCapabilityProbe.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/renderGraphContracts.test.ts tests/unit/renderJobScheduler.test.ts tests/unit/renderCacheRegistry.test.ts tests/unit/frameProviderPolicy.test.ts tests/unit/renderContracts.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 19 files, 77 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n 'from .*WebGPUEngine|import\\(.*WebGPUEngine' src/services src/stores src/hooks src/components src/engine/export`
  - Passed: only `src/services/render/renderHostPort.ts` and
    `src/engine/export/exportRenderHostPort.ts` import the engine singleton.
- `rg -n 'engine\\.(requestRender|requestNewFrameRender|clearVideoCache|clearScrubbingCache|clearCompositeCache|clearCaches|render\\(|renderCachedFrame|cacheCompositeFrame|cacheActiveCompOutput|setContinuousRender|setTimelineVisualDemand|setIsPlaying|setIsScrubbing)' src/stores src/services src/hooks src/components`
  - Passed: only `src/services/render/renderHostPort.ts` and injected
    `src/services/ramPreviewEngine.ts` matches.
- `rg -n 'WebGPUEngine|engine\\.' src/engine/export/ExportRenderSessionImpl.ts src/engine/export/ExportMaskTextures.ts src/engine/export/preloadGaussianSplats.ts`
  - Passed: no matches.
- `npm run build`
  - Passed.
- `npm run lint`
  - Passed with 1 existing warning in
    `src/components/panels/scopes/useScopeAnalysis.ts:37` (`react-hooks/refs`).
- `npm run test`
  - Passed: 470 files, 4458 tests.
- `npx vitest run tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 4 files, 10 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "WebGPUEngine|RenderDispatcher|document\\.|window\\.|HTMLCanvasElement|GPU" src/services/aiTools/workerFirstW5Gates.ts tests/unit/workerFirstW5Gates.test.ts`
  - Passed: no runtime WebGPU/DOM dependency in the W5 gate module; matches
    are test/property names only.
- `npx vitest run tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 5 files, 13 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "WebGPUEngine|RenderDispatcher|document\\.|window\\.|HTMLCanvasElement|GPU" src/services/aiTools/workerFirstGateInputs.ts src/services/aiTools/workerFirstW5Gates.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts`
  - Passed: no runtime WebGPU/DOM dependency in the W5 gate input module;
    matches are test/property names only.
- `npx vitest run tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 6 files, 17 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "WebGPUEngine|RenderDispatcher|GPUDevice|GPUTexture|HTMLVideoElement|HTMLImageElement|File|Blob|Map<|Set<" src\\services\\aiTools\\workerFirstProofCaptures.ts src\\services\\aiTools\\workerFirstProofHarness.ts src\\services\\aiTools\\workerFirstW5Gates.ts src\\services\\aiTools\\workerFirstGateInputs.ts`
  - Passed: no durable runtime handle matches; only
    `canStartRenderDispatcherCutover` property names matched.
- `npx vitest run tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 7 files, 19 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `rg -n "WebGPUEngine|RenderDispatcher|GPUDevice|GPUTexture|HTMLVideoElement|HTMLImageElement|File|Blob|Map<|Set<" src\\services\\aiTools\\workerFirstCounterSources.ts src\\services\\aiTools\\workerFirstProofCaptures.ts src\\services\\aiTools\\workerFirstProofHarness.ts src\\services\\aiTools\\workerFirstGateInputs.ts src\\services\\aiTools\\workerFirstW5Gates.ts`
  - Passed: no durable runtime handle matches; only
    start-permission property names matched.

## Debt Ledgers

Adapter debt:

- [ ] Legacy `Layer[]` adapter must remain isolated until graph descriptor parity
      exists.
- [ ] `RenderFrameSnapshot` must not become the worker payload.

Retired paths:

- [ ] User-facing RAM preview appears disabled; clip bake still reaches RAM
      preview internals.
- [ ] Dormant MP4 proxy `VideoFrame` path must be deleted or rebuilt as a real
      provider.

Platform gaps:

- [ ] Safari worker WebGPU/presentation strategy is unproven.
- [x] Linux Firefox/Mesa visible presentation passed in headed Docker Firefox
      once Mesa Vulkan ICDs were installed and selected.
- [ ] macOS Firefox platform package remains required on a real Mac.

Test migration:

- [ ] Existing preview/export/RAM/thumbnail tests need classification before
      render graph migration.
