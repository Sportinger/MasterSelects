# Worker-First Playback Renderer Handoff

Status: W0-W4 foundations plus first packet set A-I and Packets J-CP integrated
Updated: 2026-06-16

This file is the short execution handoff for Codex orchestration. It is not the
canonical plan and not a packet-history archive.

Canonical files:

- `docs/ongoing/Worker-First-Playback-Renderer.md`
- `docs/ongoing/Worker-First-Playback-Renderer-checklist.md`
- `docs/ongoing/Playback.md`

## Current State

- Playback/proxy/RAM preview investigation is documented.
- Worker-first architecture plan exists.
- Codex-only multi-agent execution model exists.
- Linux/Mesa, macOS Safari, and Firefox gates exist.
- Complete Refactor execution mechanics have been imported.
- W0 proof/platform surfaces now have concrete modules and focused checks.
- Packet A/B target correctness is integrated:
  cached RAM frames can route to registered target canvases without the legacy
  preview context, and preview transparency updates no longer re-register the
  target.
- Packet A visible proof is covered by
  `tests/unit/cachedFrameVisiblePresentation.smoke.test.ts`, which presents
  cached frames into DOM-attached dock-target and mobile legacy preview canvases
  and verifies nonblank visible pixels.
- Capability probing is conservative: worker WebGPU facts come from a Worker
  probe, and direct worker presentation remains false until a visible-pixel
  worker presentation gate proves it. Probe-created `VideoFrame`,
  `ImageBitmap`, `GPUDevice`, and Worker blob URLs are explicitly closed,
  destroyed, or revoked on success and failure paths.
- Packet H graph DTO contracts, Packet D/E scheduler/cache skeleton, and
  Packet I provider policy contracts are implemented as isolated new modules
  with cloneability/lifetime/queue/cache tests. No existing render callers have
  been migrated.
- Packet C render-host boundary is integrated in `main` mode:
  `src/services/render/renderHostPort.ts` delegates to the existing engine,
  reports renderer ownership telemetry, and is now used by preview target
  registration, `MultiPreviewSlot`, `TargetPreview`, and `TargetList` output
  window commands.
- Packet C now also routes UI hook/component render wake commands through the
  host, moves initialization/render-loop start through the host, and moves stats
  polling plus render-loop watchdog restart logic into
  `renderHostPort.startStatsAndWatchdog()`.
- Packet J migrated the first service-level render wake callers through the
  host: `webCodecsPlayback`, `runtimePlayback`, and
  `layerBuilderProxyFrames`. `tests/unit/renderHostServiceCallers.test.ts`
  protects these files from regaining direct engine wake/cache calls.
- Packet K migrated auxiliary service-level wakes through the host: lazy image
  status changes, video-bake proxy wakes, MIDI scene-camera live updates, and
  selected AI diagnostic/fixture wakes.
- Packet L migrated PlaybackHealth wake/cache commands through the host while
  leaving direct engine diagnostics/readiness inspection in place.
- Packet M migrated VideoSync coordinator wake commands through the host while
  leaving direct engine frame presentation/cache operations in place for a
  future frame-presentation port.
- Packet N migrated timeline store wake/cache commands through the host and
  added `renderHostPort.clearCaches()`. The host no longer top-level imports
  `useTimelineStore`, `playbackHealthMonitor`, or playback debug snapshots, so
  timeline slices can import the host without re-entering timeline store
  construction.
- Packet O migrated video frame cache/presentation and cleanup commands through
  the host. VideoSync, lazy media cleanup, layer playback, slot deck, and media
  deletion cleanup no longer call those engine APIs directly.
- Packet P migrated primary render execution commands through the host:
  `render`, `renderCachedFrame`, composite caching, active composition output
  caching, continuous render, timeline visual demand, play state, and scrub
  state. The remaining `RamPreviewEngine` render calls use an injected render
  engine instance rather than the global singleton and are reserved for a later
  RAM-preview port.
- Packet Q migrated resolution, mask texture, and generated-canvas texture
  commands through the host. `useEngineResolutionSync`,
  `useEngineMaskTextureSync`, and generated Text/Solid/Math canvas slices no
  longer import `WebGPUEngine` directly.
- Packet R migrated readback and capture commands through the host.
  `previewFrameCapture`, AI preview handlers/grid capture, and SAM2 capture
  call `renderHostPort` for `readPixels`, output dimensions, and DOM capture
  canvas lookup.
- Packet S migrated GPU device/last-texture inspection through the host.
  `clipAnalyzer` and GPU scope analysis no longer import `WebGPUEngine`
  directly for `getDevice` or `getLastRenderedTexture`.
- Packet T migrated RAM-preview state and clear-frame commands through the
  host. New-project frame clearing, RAM-preview generation flags, and scrub
  cache range reads no longer call the engine singleton directly. Injected
  `RamPreviewEngine` rendering remains a later port.
- Packet U migrated AI diagnostics through the host. AI stats and debug-export
  handlers read cache stats, render-loop diagnostics, engine infrastructure,
  and render dispatcher debug snapshots through `renderHostPort`; the export
  handler still keeps a `'WebGPUEngine'` log-module filter string.
- Packet V migrated PlaybackHealth and VideoSync diagnostic reads through the
  host. Stats, render-loop state, and LayerCollector readiness no longer call
  the engine singleton directly in those paths.
- Packet W migrated RAM-preview render-engine injection through the host.
  `ramPreviewSlice` and the RAM-preview AI smoke now construct
  `RamPreviewEngine` with `renderHostPort.getRamPreviewRenderEngine()` and no
  longer import `WebGPUEngine`.
- Packet X migrated dev-bridge performance render-loop diagnostics through the
  host. The performance debug action now uses
  `renderHostPort.stopRenderLoopForDiagnostics()` and
  `renderHostPort.startExistingRenderLoopForDiagnostics()` instead of importing
  `WebGPUEngine`.
- Packet Y migrated export render-session, export mask texture, and export
  asset-preload engine coupling behind `exportRenderHostPort`.
  `ExportRenderSessionImpl`, `ExportMaskTextures`, and
  `preloadGaussianSplats` no longer import `WebGPUEngine` directly. Export
  mask sync now receives the session's injected export host instead of reaching
  back to the singleton port from inside `ExportRenderSessionImpl`.
- Review fixes are integrated: priority-changing coalesced jobs re-sort,
  missing capability probes stay explicit instead of placeholder facts, provider
  events reject stale request/provider/generation mutations, and the new W1
  contracts are exported from the render contracts barrel.
- Direct render wake/cache engine calls are now isolated to
  `src/services/render/renderHostPort.ts`. Direct video frame cache/
  presentation and cleanup engine calls are also isolated there. Direct primary
  render commands are isolated there too, except the injected
  `RamPreviewEngine` render engine path. Resolution, mask texture, generated
  canvas texture, compositor binding, readback, output-dimension capture
  helpers, DOM capture canvas lookup, device/last-texture inspection,
  new-project clear-frame, RAM-preview flags, and scrub cache range reads are
  also isolated to the host. AI stats/export diagnostic snapshot reads are
  isolated there too. PlaybackHealth/VideoSync stats, render-loop, and
  LayerCollector diagnostic reads are isolated there too. RAM-preview render
  injection is host-owned. Dev-bridge performance debug render-loop control is
  host-owned. Export render-session, mask texture, gaussian splat, and 3D
  model preload engine calls are isolated to `exportRenderHostPort`. Remaining
  direct engine calls are host-port internals or injected render-engine
  implementation internals.
- `getStats` and `getPlaybackTrace` now expose
  `workerFirstRenderer` with mode, strategy, target ids, golden manifests,
  proof paths, and initial queue/provider/cache/visible-pixel counters.
- DOM-visible canvas proof is anchored at
  `src/services/aiTools/visiblePixelProof.ts:captureDomVisibleCanvasProof`.
- Packet Z added executable W5 prerequisite gates without starting worker
  rendering. `src/services/aiTools/workerFirstW5Gates.ts` evaluates
  `W5_WORKER_SHADOW_PARITY` and `W5_VISIBLE_PRESENTATION_PROVEN`, exposes
  `canStartWorkerWebGpu`, `canStartWorkerPresentation`, and
  `canStartRenderDispatcherCutover`, and keeps all three false until captured
  golden fixtures, shadow fingerprints, queue/lifetime drains, DOM-visible
  nonblank platform proofs, no-stale stress proofs, and worker-capable
  presentation strategies are present.
- Packet AA added W5 gate counter input adapters without starting worker
  rendering. `src/services/aiTools/workerFirstGateInputs.ts` maps
  `RenderSchedulerSnapshot`, `RenderCacheRegistrySnapshot`, and
  `FrameProviderStatus[]` into `workerFirstRenderer.counters`, so W5 queue,
  cache, and frame-lifetime gates can consume real runtime snapshots when those
  feeds are wired.
- Packet AB added runtime-only W5 proof capture wiring without starting worker
  rendering. `src/services/aiTools/workerFirstProofCaptures.ts` records golden
  fixture fingerprints, worker-shadow parity samples, and DOM-visible platform
  proofs as serializable data; `getStats`/`getPlaybackTrace` now pass those
  captures into `workerFirstRenderer.w5Prerequisites`.
- Packet AC added runtime-only W5 counter source wiring without starting worker
  rendering. `src/services/aiTools/workerFirstCounterSources.ts` records
  scheduler, cache, provider, transfer-latency, provider-wait, and presented
  frame snapshots as serializable data; `getStats`/`getPlaybackTrace` now pass
  those sources into `workerFirstRenderer.counters`. Stats snapshots use
  `w5GateEvidenceMode: stats-observation`, so recorded ad-hoc data cannot
  enable Worker WebGPU, worker presentation, or RenderDispatcher cutover.
- Packet AD added an AI bridge visible-presentation capture entry point without
  starting worker rendering. The
  `captureWorkerFirstVisiblePresentationProof` tool records the current
  render-host capture canvas as runtime-only W5 visible-presentation evidence
  only when the requested platform/strategy match the latest capability probe.
  It is devBridge/internal-only and does not accept caller-supplied playback
  stress counters. Ordinary `getStats`/`getPlaybackTrace` snapshots remain
  observation-only and cannot enable Worker WebGPU, worker presentation, or
  RenderDispatcher cutover.
- Packet AE added a controlled W5 visible-presentation playback-stress proof
  runner without starting worker rendering. The
  `runWorkerFirstVisiblePresentationStressProof` tool is devBridge/internal-only,
  runs real `simulatePlayback`, requires observed preview frames, derives
  `staleVisibleFrameCount` from playback diagnostics, captures a fingerprinted
  render-host canvas proof, and records the combined proof as runtime-only
  observation data.
- Packet AF wired visible proof tools into the W5 counter source registry
  without starting worker rendering. Visible capture/stress runs now publish
  real `workerFirstRenderer.counters.visiblePixels` data for nonblank ratio,
  black-frame, freeze, and stale-visible-frame counters. At that point,
  scheduler/cache/provider producers were still not wired; later packets now
  publish observation-only runtime diagnostics for all three.
- Packet AG added a controlled golden-fixture fingerprint capture entry point
  without starting worker rendering. The
  `captureWorkerFirstGoldenFixtureFingerprint` tool moves the playhead to a
  manifest sample time, requests a diagnostic render, fingerprints the current
  main render-host capture canvas, and records `source: main-renderer` golden
  evidence only for materialized manifests whose required timeline signals are
  present. It rejects caller-supplied source/fingerprint evidence and
  `fixture-required` manifests, so real fixture materialization and browser
  capture runs are still required.
- Packet AH added a controlled `solid-text-image` golden fixture runner without
  starting worker rendering. The
  `runWorkerFirstSolidTextImageGoldenFixture` tool materializes a deterministic
  solid/text/image timeline, then invokes the existing main-renderer golden
  capture bridge for the manifest sample times `[0, 0.5, 1]`. It rejects
  caller-supplied source/fingerprint/sample-time evidence, is
  devBridge/internal-only, and records observation data only. A real
  Windows/Chromium browser run captured 3/3 manifest fingerprints with
  `nonBlankRatio=1` and hash `441446da`; at that point, the remaining
  `fixture-required` manifests were still uncaptured.
- Packet AJ added a controlled render-capability probe bridge without starting
  worker rendering. The `runWorkerFirstRenderCapabilityProbe` tool rejects
  caller-supplied probe facts and runs the in-browser probe; the real
  Windows/Chromium probe selected `worker-cpu-present` with worker WebGPU/device
  and OffscreenCanvas WebGPU available, direct worker canvas presentation false,
  `VideoFrame` transfer false, and `ImageBitmap`/WebCodecs available.
- Packet AK refreshed visible proof capture before fingerprinting. The
  `captureWorkerFirstVisiblePresentationProof` tool now requests a diagnostic
  render, records render diagnostics, and then fingerprints the current
  render-host capture canvas. This fixed the stale black-canvas proof observed
  after golden materialization; a visible Windows/Chromium run captured
  `renderTarget:preview`, `nonBlankRatio=1`, hash `441446da`.
- Packet AL refined W5 visible-stress stale accounting. The stress proof now
  derives `staleVisibleFrameCount` from `stalePreviewWhileTargetMoved`,
  preview-freeze frames, and startup target-moved stale frames instead of all
  unchanged preview frames, so static golden fixtures do not falsely fail
  no-stale playback proof. Unit coverage was added for this static case. A real
  Windows/Chromium project-video warmup run with three imported MP4s captured
  `previewFrames=77`, `previewUpdates=75`, `staleVisibleFrameCount=0`,
  `nonBlankRatio=0.8867`, hash `06677244` while the tab was visible.
- Packet AM added hidden-tab guards to visible proof capture. DOM-visible proof
  capture now includes document visibility metadata, and the visible capture/
  stress bridge tools fail fast when `document.hidden=true` or
  `visibilityState=hidden`. A live Windows/Chromium bridge retest while the app
  tab was hidden returned the expected foreground-tab errors instead of
  recording black capture/stress proof data. After opening a foreground
  `localhost:5173` tab and targeting its `tabId`, visible capture and visible
  stress passed again on the three project-video timeline with nonblank
  fingerprints and zero derived stale visible frames.
- Packet AN added the first controlled worker-shadow parity runner. The
  `runWorkerFirstSolidTextImageShadowParity` tool materializes
  `solid-text-image`, captures main-renderer fingerprints, renders the same
  data-only fixture plan in a dedicated OffscreenCanvas `.worker.ts`, compares
  fingerprints with fixed thresholds, and records runtime-only W5 shadow parity
  samples. A real Windows/Chromium foreground-tab bridge run captured 3/3
  samples with main hash `441446da`, worker hash `1ef3bca8`,
  `avgRgbDelta=6.53`, `meanLumaDelta=7.2256`, and zero failures.
- Packet AO added the controlled `multi-video` golden fixture runner. The
  `runWorkerFirstMultiVideoGoldenFixture` tool materializes three bundled
  project videos as simultaneous timeline clips, captures manifest sample times
  `[1, 2, 3, 4]` through the main-renderer golden bridge, rejects
  caller-supplied project/source/fingerprint/sample-time evidence and
  asset-list overrides, and keeps W5 start permissions stats-guarded.
  Transient public-video `File`/`Blob` construction is isolated in a media
  import helper outside the W5 proof module boundary. A real Windows/Chromium
  bridge run targeted a visible tab after a 5-second post-refresh wait and
  captured 4/4 nonblank samples with hashes `f8c77360`, `4ca390a6`,
  `c33fc354`, `64c20fad`, `minNonBlankRatio=0.3984`, and zero failures.
- Packet AP added the controlled `nested-comps` golden fixture runner. The
  `runWorkerFirstNestedCompsGoldenFixture` tool materializes reusable parent
  and child composition clips with loaded nested image sources, captures
  manifest sample times `[0, 1.25, 2.5]` through the main-renderer golden
  bridge, rejects caller-supplied project/source/fingerprint/sample-time
  evidence plus caller-supplied composition trees, and keeps W5 start
  permissions stats-guarded. A real Windows/Chromium bridge run set the video
  layout, waited 5 seconds for the preview target to register, and captured
  3/3 nonblank samples from `renderTarget:preview` with hashes `e90a4f0a`,
  `422c7d6c`, `182cc7d2`, `minNonBlankRatio=0.3628`, and zero failures.
- Packet AQ added the controlled `html-provider-fallback` golden fixture
  runner. The `runWorkerFirstHtmlProviderGoldenFixture` tool materializes a
  public-project video fixture through the temporary DOM video provider path,
  attaches an explicit HTML video runtime source, captures manifest sample
  times `[0, 1, 2]` through the main-renderer golden bridge, rejects
  caller-supplied project/source/fingerprint/sample-time evidence plus
  asset/provider overrides, and keeps W5 start permissions stats-guarded.
  Public-video `File`/`Blob` construction and the HTML video handle attachment
  stay isolated in a media import helper outside the W5 proof module boundary.
  A real Windows/Chromium bridge run waited after HMR, set the video layout,
  waited again for the preview target, and captured 3/3 nonblank samples from
  `renderTarget:preview` with hashes `4595eb5f`, `40c44d5f`, `54424a8c`,
  `minNonBlankRatio=0.2708`, HTML video `readyState=4`, `1280x720`, and zero
  failures.
- Packet AR added the controlled `webcodecs-provider` golden fixture runner.
  The `runWorkerFirstWebCodecsProviderGoldenFixture` tool materializes a
  public-project MP4 fixture through a full-mode WebCodecs provider, captures
  manifest sample times `[0, 0.75, 1.5]` through the main-renderer golden
  bridge, rejects caller-supplied project/source/fingerprint/sample-time
  evidence plus asset/provider overrides, and keeps W5 start permissions
  stats-guarded. Public-video `File`/`Blob` construction and WebCodecs setup
  stay isolated in a media import helper outside the W5 proof module boundary.
  A real Windows/Chromium bridge run waited after HMR, set the video layout,
  waited again for the preview target, and captured 3/3 nonblank samples from
  `renderTarget:preview` with hashes `4595eb5f`, `34c35511`, `33522049`,
  `minNonBlankRatio=0.2708`, WebCodecs `fullMode=true`, `hasFrame=true`,
  `1280x720`, and zero failures.
- Packet AS added the controlled `effects-masks-transitions` golden fixture
  runner. The `runWorkerFirstEffectsMasksTransitionsGoldenFixture` tool
  materializes controlled image clips with two color effects, one mask, one
  crossfade transition, and a `screen` blend mode, captures manifest sample
  times `[0, 0.5, 1, 1.5]` through the main-renderer golden bridge, rejects
  caller-supplied proof and fixture override fields, and keeps W5 start
  permissions stats-guarded. The golden bridge now derives the required
  `blend-mode` signal from non-`normal` clip transforms. A real
  Windows/Chromium bridge run targeted the visible tab after the required waits
  and captured 4/4 nonblank samples from `renderTarget:preview` with hashes
  `665e1edc`, `665e1edc`, `67e92d0b`, `ec5ac7ac`, `minNonBlankRatio=1`,
  `alphaCoverage=1`, and zero failures.
- Packet AT added the controlled `jpeg-proxy` golden fixture runner. The
  `runWorkerFirstJpegProxyGoldenFixture` tool materializes a public-video clip,
  marks its media record as a ready JPEG proxy, seeds deterministic runtime
  JPEG proxy frames, forces the same scrub/drag proxy-substitution state used
  by the LayerBuilder path, captures manifest sample times `[0, 1, 2]` through
  the main-renderer golden bridge, rejects caller-supplied proof/asset/provider/
  proxy-frame overrides, and keeps W5 start permissions stats-guarded. The
  golden bridge now derives `proxy-image` only from active video proxy
  substitution state plus usable JPEG proxy metadata. A real Windows/Chromium
  bridge run targeted the visible tab after the required 5-second post-HMR wait
  and captured 3/3 nonblank samples from `renderTarget:preview` with hashes
  `e39b58f3`, `63584e4a`, `cf787a81`, `minNonBlankRatio=0.5625`,
  `alphaCoverage=1`, proxy frame indices `0/24/48`, proxy status `ready`, and
  zero failures.
- Packet AU added the controlled `multi-target-output-slice` golden fixture
  runner. The `runWorkerFirstMultiTargetOutputSliceGoldenFixture` tool
  materializes the controlled solid/text/image content fixture, registers two
  runtime-only active composition preview targets, configures one enabled
  output slice, captures manifest sample times `[0, 1, 2]` through the
  main-renderer golden bridge, rejects caller-supplied proof/target/canvas/
  slice overrides, and keeps W5 start permissions stats-guarded. The golden
  bridge now derives `render-target` and `output-slice` from serializable render
  target snapshots. A real Windows/Chromium bridge run targeted the visible tab
  after the required 5-second post-HMR wait and captured 3/3 nonblank samples
  from `renderTarget:preview` with hash `adfbb976` at sample times `0/1/2`,
  `nonBlankRatio=1`, `alphaCoverage=1`, active composition targets
  `preview/wfg-output-slice-target-a/wfg-output-slice-target-b`, enabled slice
  count `1`, output preview target `wfg-output-slice-target-a`, and zero
  failures.
- Packet AV added the controlled `ram-cache` golden fixture runner. The
  `runWorkerFirstRamCacheGoldenFixture` tool materializes the controlled
  solid/text/image content fixture, generates RAM preview composite cache
  frames through the existing RAM preview path, requires cached composite frame
  hits for manifest sample times `[0, 0.5, 1]`, captures those samples through
  the main-renderer golden bridge, rejects caller-supplied proof/cache/smoke
  overrides, and keeps W5 start permissions stats-guarded. The golden bridge
  now derives `ram-preview` and `composite-cache` from serializable timeline and
  cache state. A real Windows/Chromium bridge run targeted the visible tab after
  the required 5-second post-HMR wait and captured 3/3 nonblank cached-frame
  samples from `renderTarget:preview` with hash `b511ec5f` at sample times
  `0/0.5/1`, `nonBlankRatio=0.3164`, `alphaCoverage=1`,
  `cachedFrameHit=true` for all samples, cached range `0-1.1667`, composite
  cache count `35`, mode `direct-engine-fallback`, and zero failures.
- Packet AW added the controlled `bake` golden fixture runner. The
  `runWorkerFirstBakeGoldenFixture` tool materializes the controlled
  solid/text/image content fixture, bakes a composition region through the
  existing `FrameExporter`/`videoBakeProxyCache` product path, then bakes a
  clip region through the existing `startRamPreviewForRange` product path.
  The golden bridge now derives `clip-bake` and `composition-bake` only from
  serializable video bake regions with `status: baked`. The runner rejects
  caller-supplied proof, bake-region, bake-proxy, and cached-frame overrides
  and keeps W5 start permissions stats-guarded. A real Windows/Chromium bridge
  run targeted the visible tab after the required 5-second post-HMR wait and
  captured 3/3 nonblank cached-frame samples from `renderTarget:preview` with
  hash `b511ec5f` at sample times `0/1/2`, `nonBlankRatio=0.3164`,
  `alphaCoverage=1`, `cachedFrameHit=true` for all samples, clip bake cached
  range `0-2.1667`, cached frame count `65`, composition bake proxy ready for
  sample times `0/1`, and zero failures.
- Packet AX added the controlled `export` golden fixture runner. The
  `runWorkerFirstExportGoldenFixture` tool materializes the controlled
  solid/text/image content fixture, runs the existing
  `debugExport`/`FrameExporter` export-preview-parity product path, captures
  manifest sample times `[0, 1, 2]` through the main-renderer golden bridge,
  and keeps W5 start permissions stats-guarded. The golden bridge now derives
  `export` only from controlled export evidence with a completed run, nonempty
  blob, published preview samples, and no export parity failures. The runner
  rejects caller-supplied proof, export range/codec/path, blob, and
  export-preview evidence overrides. A real Windows/Chromium bridge run
  targeted the visible tab after the required 5-second post-HMR wait and
  captured 3/3 nonblank samples from `renderTarget:preview`: hash `441446da`
  at sample times `0/1/2`, `nonBlankRatio=1`, `alphaCoverage=1`, export blob
  size `20264`, export preview sample count `18`, export parity best sample
  hash `ad2d2825`, and zero failures.
- Packet AY added the controlled `universal-3d-gaussian-cad` golden fixture
  runner. The `runWorkerFirstUniversal3dGoldenFixture` tool materializes the
  controlled solid/text/image content fixture, adds a real primitive
  mesh/model clip for the `3d` descriptor, and adds Gaussian-splat plus CAD
  technical geometry `SignalAsset` descriptor clips through the existing
  renderer-adapter/text-fallback surface. The golden bridge now derives `3d`,
  `gaussian`, and `cad` from existing clip/source and SignalAsset descriptor
  metadata instead of caller-supplied proof. A real Windows/Chromium bridge run
  hard-reloaded the app, waited the required 5 seconds, and captured 3/3
  nonblank samples from `renderTarget:preview`: hash `d39823e2` at sample
  times `0/1/2`, `nonBlankRatio=1`, `alphaCoverage=1`, timeline signals
  `3d/cad/gaussian/image/model/render-target/solid/text`, and zero failures.
- Packet AZ added the accepted W5 evidence-suite runner without starting worker
  rendering. The `runWorkerFirstW5EvidenceSuite` tool clears volatile proof
  captures, runs every current golden fixture runner plus the
  `solid-text-image` worker-shadow parity runner in one browser proof session,
  and returns an `accepted-gate-run` snapshot. The JPEG-proxy fixture now clears
  the global proxy-frame cache before seeding controlled diagnostic frames, so
  repeated suite runs do not inherit stale proxy-frame budget pressure. A real
  Windows/Chromium bridge run hard-reloaded the app, waited the required
  5 seconds, and passed all 13 suite runners with 38 golden fixture captures,
  3 worker-shadow samples, 0 failed runners, 0 missing golden manifests,
  `workerShadowParity=passed`, `visiblePresentation=blocked`, and all W5
  start-permission booleans still false.
- Packet BA extended the accepted W5 evidence suite to collect local
  visible-presentation stress evidence without starting worker rendering. The
  suite now derives the current W5 proof platform from the in-browser
  capability probe, prepares an extended solid/text/image visible stress
  surface, runs controlled playback stress, and records the resulting
  DOM-visible proof in the accepted snapshot. `renderHostPort.getCaptureCanvas`
  now scores capture candidates and prefers a DOM-visible preview target over
  offscreen output-slice targets, preventing stale offscreen targets from
  poisoning visible-presentation proof. A targeted Windows/Chromium bridge run
  waited 5 seconds after HMR, pinned the focused `tabId`, and passed all 13
  suite runners plus local visible evidence with 38 golden fixture captures,
  3 worker-shadow samples, 1 visible proof, `dom-visible-nonblank=passed`,
  `no-stale-visible-frames-under-stress=passed`, `workerShadowParity=passed`,
  and `visiblePresentation=blocked` only because the other required platforms
  are still missing.
- Packet BB hardened accepted W5 run counters without starting worker
  rendering. `runWorkerFirstW5EvidenceSuite` now clears stale runtime counter
  sources at the start of an accepted run, and the controlled
  `solid-text-image` worker-shadow parity runner records queue-drain,
  cache-drain, provider-drain, and timing counters into the W5 counter registry.
  The visible-stress proof runner now refreshes the render target after
  playback, resets to the controlled capture time, and re-selects the capture
  canvas before fingerprinting, preventing blank post-playback WebGPU canvas
  reads from failing local visible proof. A real Windows/Chromium bridge run
  after reload plus the required 5-second wait passed all 13 suite runners with
  38 golden fixture captures, 3 worker-shadow samples, 1 visible proof,
  `queueDepth=0`, frame lifetime `outstanding=0/leaked=0`,
  `dom-visible-nonblank=passed`, `no-stale-visible-frames-under-stress=passed`,
  `workerShadowParity=passed`, and `visiblePresentation=blocked` only because
  Linux/Mesa, Firefox, Safari, and macOS Firefox proofs are still missing.
- Packet BC extended controlled worker-shadow parity beyond `solid-text-image`
  without starting worker rendering. The suite now also runs
  `multi-target-output-slice-worker-shadow`: it materializes the real
  multi-target/output-slice fixture, captures main-renderer fingerprints at the
  manifest sample times, renders matching data-only OffscreenCanvas worker
  shadow fingerprints, records parity samples, and publishes controlled
  queue/cache/provider/timing drain counters. A real Windows/Chromium bridge run
  after reload plus the required 5-second wait passed all 14 suite runners plus
  local visible evidence with 38 golden fixture captures, 6 worker-shadow
  samples, 1 visible proof, `queueDepth=0`,
  `dom-visible-nonblank=passed`, `no-stale-visible-frames-under-stress=passed`,
  `workerShadowParity=passed`, and `visiblePresentation=blocked` only because
  Linux/Mesa, Firefox, Safari, and macOS Firefox proofs are still missing.
- Packet BD wired real Main-Host runtime observations into W5 counters without
  starting worker rendering. `workerFirstRuntimeCounterAdapter` derives
  scheduler queue depth from `timelineRuntimeCoordinator` job resources plus
  render-loop demand, derives cache bytes/hits/misses from runtime resource
  memory and render-host cache stats, and derives provider lifetime/wait/frame
  ids from runtime provider diagnostics. `getStats.workerFirstRenderer` and
  `getPlaybackTrace.workerFirstRenderer` now merge those runtime observations
  behind explicitly recorded accepted-run counters, while ordinary stats remain
  `stats-observation` with all worker WebGPU/presentation/cutover start
  booleans false. Real Windows/Chromium bridge proof after reload plus the
  required wait showed `getStats` and `getPlaybackTrace` reporting
  `queueDepth=1`, cache bytes `3686400`, `frameLifetime.outstanding=0`, and
  all W5 start booleans false.
- Packet BE added an explicit serializable worker-first runtime model without
  starting worker rendering. `workerFirstRuntimeModel` represents runtime jobs,
  cache records, provider statuses, timing, pass counters, and visible-pixel
  counters as cloneable records, derives `RenderSchedulerSnapshot` and
  `RenderCacheRegistrySnapshot` from those records, and converts the result
  into the existing W5 counter-source surface. The BD adapter now builds a
  `main-host-observation` runtime snapshot first, then feeds its counter
  sources into `getStats.workerFirstRenderer` and
  `getPlaybackTrace.workerFirstRenderer`.
- Packet BF routes the controlled worker-shadow drain-counter producer through
  the explicit runtime model without changing the shadow renderer. The shared
  `recordWorkerFirstShadowParityRunCounters` path now builds a
  `worker-shadow` runtime snapshot with completed/dropped shadow jobs,
  zero-cache/leak-check counters, and presented-frame timing, then records the
  converted W5 counter sources. Both current shadow runners continue to report
  queue depth zero and false W5 start permissions.
- Packet BG adds the first live Main-Host producer-owned runtime diagnostics
  feed. `renderScheduler.getWorkerFirstRuntimeSnapshot()` now exposes cloneable
  independent-target render jobs and counters for black-frame, active
  layer-filter, nested-texture-copy, composition-render, and
  composition-not-ready outcomes. `getStats`/`getPlaybackTrace` publish this
  diagnostic snapshot and the W5 runtime adapter maps its recent jobs into the
  explicit worker-first runtime model. This is still observation-only and does
  not start worker rendering.
- Packet BH adds live Main-Host cache producer diagnostics without starting
  worker rendering. `ScrubbingCache.getWorkerFirstCacheRuntimeSnapshot()` now
  exposes cloneable cache records for scrub textures, last-frame GPU textures,
  RAM-preview composite frames, and RAM-preview GPU frame cache entries with
  entries/bytes/allocation/reuse/eviction/release counters. `CacheManager` and
  `renderHostPort` publish that snapshot, `getStats`/`getPlaybackTrace` expose
  it as `cacheRuntime`, and the W5 runtime adapter prefers these producer-owned
  cache records over the older `getScrubbingCacheStats`/
  `getCompositeCacheStats` fallback.
- Packet BI adds live provider producer diagnostics without starting worker
  rendering. `providerRuntimeDiagnostics` builds cloneable provider runtime
  records from retained runtime resources and provider health diagnostics,
  preserving provider/source/session/policy/memory fields. `getStats` and
  `getPlaybackTrace` expose this snapshot as `providerRuntime`, and the W5
  runtime adapter prefers these producer-owned provider records over the older
  timeline provider-health fallback.
- Packet BJ adds a controlled runtime export/playback evidence smoke without
  starting worker rendering. `runWorkerFirstRuntimeExportPlaybackSmoke`
  materializes the solid/text/image runtime fixture, runs real
  `simulatePlayback`, runs the browser `debugExport` path with a controlled
  supported codec/container selection, then collects `getStats` and
  `getPlaybackTrace` to verify scheduler/cache/provider runtime feeds are
  present and all W5 start-permission booleans remain false. The W5 tool
  definitions were also split into `workerFirst` and `workerFirstRuntime`
  definition modules so the touched source files stay below the 700 LOC
  ceiling.
- Packet BK adds a controlled platform evidence package tool without starting
  worker rendering. `runWorkerFirstPlatformEvidencePackage` derives the current
  W5 platform from the in-browser capability probe, materializes the controlled
  visible-stress fixture, runs the probe-bound visible presentation stress
  proof, collects `getStats`/`getPlaybackTrace`, and returns a stable SHA-256
  evidence package for that one local platform. The tool rejects caller-supplied
  platform/proof/hash fields and keeps all W5 start-permission booleans false.
- Packet BL extends controlled worker-shadow parity to
  `effects-masks-transitions` without starting worker rendering.
  `runWorkerFirstEffectsMasksTransitionsShadowParity` materializes the real
  effect/mask/transition/blend fixture, captures main-renderer fingerprints,
  renders a data-only OffscreenCanvas worker-shadow profile, records parity
  samples and controlled drain counters, and is included in the default W5
  evidence-suite runner list.
- Packet BM makes the accepted W5 evidence suite phaseable without accepting
  caller-supplied proof data. `runWorkerFirstW5EvidenceSuite` now accepts exact
  controlled `runnerIds` plus `clearBeforeRun=false`, rejects non-array or
  unknown runner ids before clearing proof state, and reports runner selection
  metadata so the full accepted evidence set can be rebuilt across multiple
  targeted bridge calls instead of hitting the bridge response watchdog.
- Packet BN adds a read-only platform evidence matrix verifier without starting
  worker rendering. `verifyWorkerFirstPlatformEvidenceMatrix` accepts packages
  produced by `runWorkerFirstPlatformEvidencePackage`, re-computes each package
  hash with the same canonical serializer, validates schema, required-platform
  coverage, visible-stress invariants, stats/trace start-permission guards,
  duplicate platforms, and missing platforms, and still returns all worker
  WebGPU/presentation/cutover start booleans false.
- Packet BO adds a portable platform evidence collector/verifier script.
  `npm run worker-first:platform:collect -- ...` runs
  `runWorkerFirstPlatformEvidencePackage` against a targeted visible bridge tab
  after the required settle wait and writes a `*.package.json` plus report under
  `tmp/worker-first-platform-evidence/`. `npm run worker-first:platform:verify`
  reads package files and calls `verifyWorkerFirstPlatformEvidenceMatrix`,
  writing a matrix report. This is the handoff path for collecting the missing
  Linux/Mesa, Firefox, Safari, and macOS Firefox packages on real target
  browsers.
- Packet BP makes platform matrix verification available offline from Node.
  `npm run worker-first:platform:verify -- <packages...>` now verifies package
  files without a running browser tab, recomputes SHA-256 hashes with the same
  canonical payload ordering, and writes mode-specific matrix reports. The
  `--bridge` flag still cross-checks the same package set through the in-app
  `verifyWorkerFirstPlatformEvidenceMatrix` tool when a visible bridge tab is
  available.
- Packet BQ adds an offline platform-matrix status command for in-progress
  collection. `npm run worker-first:platform:status -- <packages...>` reads the
  same package artifacts and prints valid/missing/duplicate/invalid counts while
  exiting successfully for incomplete matrices, so target-machine collection can
  be tracked without treating expected missing platforms as command failure.
- Packet CE adds `--latest-per-platform` for `worker-first:platform:status`
  and `worker-first:platform:verify`. The default verifier remains strict and
  still reports duplicate valid packages for the same platform, while the new
  option reduces retry-heavy artifact directories to the newest package per
  target platform for operator progress checks.
- Packet CF adds a non-mutating platform evidence doctor. `npm run
  worker-first:platform:doctor -- --latest-per-platform` reads the same package
  artifacts, applies the offline matrix verifier, checks whether a dev-bridge
  tab is connected, records the selected tab id, writes a doctor report, and
  exits successfully without running any browser proof.
- Packet CG captures real `linux-chromium-mesa` platform evidence from a
  headed Linux Chromium running in the Playwright Docker image against the
  host-bound Vite server. The capability probe now records WebGL debug renderer
  details when WebGPU adapter info is empty and no longer consumes a
  main-thread GPU device during probing. Platform package capture also
  suppresses startup welcome overlays, forwards `captureSettleMs`, and treats
  occluded visible proofs as collection failures so `collect` and matrix
  verification agree.
- Packet CH audits Linux Firefox/Mesa through headed Playwright Firefox in the
  Docker image with an explicit 10s app-load wait before bridge collection. The
  capability probe now times out stalled main-thread `requestAdapter()` calls
  and still records WebGL Mesa details, which lets the Firefox run resolve to
  `linux-firefox-mesa` instead of hanging or reporting an unknown platform. The
  Firefox package remains invalid because the app engine cannot get a WebGPU
  adapter in this Docker Mesa/llvmpipe target, so the golden fixture fails with
  no active render-capture canvas.
- Packet CI captures valid Linux Firefox/Mesa evidence after installing Mesa
  Vulkan ICDs in the Playwright Firefox Docker container. The successful run
  used `mesa-vulkan-drivers`/`vulkan-tools`, `VK_ICD_FILENAMES` pointing at
  `lvp_icd.json`, `MOZ_WEBGPU_FEATURES=vulkan`, Firefox WebGPU/force prefs,
  and a 12s post-`window.aiTools` wait before bridge collection. It proves the
  previous CH failure was an environment Vulkan-runtime gap rather than an app
  visible-presentation failure.
- Packet CJ adds `worker-first:platform:macos-runbook`, a non-mutating CLI
  runbook that prints the exact real-Mac Safari and Firefox collection commands,
  the 12s visible-tab wait settings, and the copy-back/final-verify steps. It
  does not synthesize macOS evidence; it only removes operator ambiguity for
  the two remaining target-browser packages.
- Packet CK adds missing-platform next-step guidance to platform `status`,
  `verify`, and `doctor`. When the latest matrix is down to macOS Safari/Firefox
  only, the commands now print and record the real-Mac
  `worker-first:platform:macos-runbook` handoff instead of leaving the operator
  to infer the next command from the missing-platform list.
- Packet CL adds a compact platform proof summary to `status`, `verify`, and
  `doctor`: each required platform now prints `valid`/`missing` plus strategy,
  visible stress frame count, stale visible frame count, and nonblank ratio for
  the selected package. This makes the final 5/5 audit readable from command
  output without opening package JSON.
- Packet CM adds a focused CLI regression test for the platform evidence
  script. It verifies that `macos-runbook` prints the real-Mac Safari/Firefox
  commands and that `status --latest-per-platform` prints proof details plus
  the Mac next-step guidance from a temporary partial matrix.
- Packet CN extends that CLI regression coverage to the expected-failing
  `verify --latest-per-platform` path. The test now asserts nonzero exit,
  proof-summary output, Mac next-step guidance, and the `nextStep` plus
  missing-platform fields written into the generated verify report.
- Packet CO adds a real dev-bridge auth preflight. The Vite AI-tools bridge now
  exposes authenticated `GET /api/ai-tools/auth-check`, and
  `worker-first:platform:doctor` calls it without dispatching any browser tool.
  The doctor report records `bridgeAuthStatus`/`bridgeAuthError`, and the CLI
  regression test covers token mismatch detection with a fake bridge server.
- Packet CP updates durable feature documentation for the CO/CJ platform
  evidence operator flow. `docs/Features/Debugging.md` now documents
  `/api/ai-tools/auth-check`, `worker-first:platform:doctor`, status, and the
  real-Mac runbook; `docs/Features/Security.md` documents the dev bridge
  preflight auth rules; `docs/Features/AI-Integration.md` documents the
  status/auth-check distinction in the HMR bridge architecture.
- Packet CQ hardens the platform evidence collector load gate. `collect` now
  polls for a live, responsive dev-bridge target tab before starting the
  post-selection settle wait, validates explicit `--target-tab-id` values are
  still connected, then waits `--wait-ms` again before dispatching
  `runWorkerFirstPlatformEvidencePackage`. This preserves the required
  post-refresh/post-load wait while avoiding early failures against a still
  hydrating MasterSelects tab.
- Packet CR makes the collector wait auditable in generated reports. Collect
  reports now record the target-tab wait timeout, elapsed target wait, poll
  count, selected tab before/after the post-selection settle wait, requested
  settle duration, and actual settle elapsed time. This lets macOS/Linux
  package reviewers prove the run waited for MasterSelects to load before
  playback/pixel evidence was captured.
- Packet CS adds non-blocking companion-report readiness audits to the platform
  CLI. `status`, `verify`, and `doctor` now inspect matching `*.report.json`
  files for the selected packages and print/read back whether readiness is
  auditable, missing, legacy-without-readiness, or invalid. The matrix gate
  still depends on package evidence only; the readiness audit is operator
  evidence for new Mac/Linux packages.
- Packet CT hardens bridge target selection against stale Presence tabs.
  `collect`/bridge verification now only accept tabs whose bridge Presence was
  seen within the last 10000ms and that are not marked unresponsive. `doctor`
  prints fresh/stale/unresponsive tab counts so operators know whether to
  foreground or reload a browser before starting a long platform proof.
- Packet CU refreshes the Windows/Chromium platform package with an auditable
  readiness report. A newly opened local Chrome tab on `localhost:5173`
  registered fresh Presence, then `collect --target-tab-id ...` produced a new
  `windows-chromium` package plus matching report with target wait,
  post-selection settle wait, and selected-tab metadata.
- Packet CV keeps failed platform collect payloads out of the selectable package
  matrix. If the browser-side proof returns `success=false`, the CLI now writes
  the payload as `*.failed.json`, records `selectablePackage=false` in the
  companion report, and leaves `*.package.json` only for successful evidence.
  This prevents a failed Linux/macOS refresh from displacing the latest valid
  package during `--latest-per-platform` status/verify.
- Packet BR adds a script-side target-platform expectation guard for package
  collection. `npm run worker-first:platform:collect -- --expect-platform <id>`
  still lets the in-browser proof derive the package platform itself, then fails
  the collector if the returned package platform differs from the requested
  target-machine id. The collection report records the expectation and whether
  it matched.
- Packet BS extends controlled worker-shadow parity to `jpeg-proxy`. The new
  `runWorkerFirstJpegProxyShadowParity` bridge tool materializes the real
  deterministic JPEG-proxy fixture, captures main-renderer fingerprints,
  renders matching data-only OffscreenCanvas worker-shadow fingerprints for
  sample times `0/1/2`, records parity samples and controlled drain counters,
  and remains observation-only with all W5 start booleans false.
- Packet BT extends controlled worker-shadow parity to `nested-comps`. The new
  `runWorkerFirstNestedCompsShadowParity` bridge tool materializes the real
  nested composition fixture, captures main-renderer fingerprints, renders a
  matching data-only OffscreenCanvas worker-shadow profile for sample times
  `0/1.25/2.5`, records parity samples and controlled drain counters, and
  remains observation-only with all W5 start booleans false.
- Packet BU extends controlled worker-shadow parity to `ram-cache`. The new
  `runWorkerFirstRamCacheShadowParity` bridge tool materializes the real
  RAM-preview/composite-cache fixture, requires cached-frame hits for sample
  times `0/0.5/1`, captures main-renderer cache fingerprints, renders a
  matching data-only OffscreenCanvas worker-shadow profile, records parity
  samples and controlled drain counters, and remains observation-only with all
  W5 start booleans false.
- Packet BV extends controlled worker-shadow parity to `bake`. The new
  `runWorkerFirstBakeShadowParity` bridge tool materializes the real
  clip-bake and composition-bake fixture, requires baked cached-frame hits for
  sample times `0/1/2`, captures main-renderer bake fingerprints, renders a
  matching data-only OffscreenCanvas worker-shadow profile, records parity
  samples and controlled drain counters, and remains observation-only with all
  W5 start booleans false.
- Packet BW extends controlled worker-shadow parity to `export`. The new
  `runWorkerFirstExportShadowParity` bridge tool materializes the real export
  preview-parity fixture through the existing export smoke, reads the controlled
  main-renderer export fingerprints from the export golden runner, renders a
  matching data-only OffscreenCanvas worker-shadow profile for sample times
  `0/1/2`, records parity samples and controlled drain counters, and remains
  observation-only with all W5 start booleans false.
- Packet BX extends controlled worker-shadow parity to
  `universal-3d-gaussian-cad`. The new
  `runWorkerFirstUniversal3dShadowParity` bridge tool materializes the real
  descriptor fixture for model/Gaussian/CAD signals, captures main-renderer
  fingerprints for sample times `0/1/2`, renders a matching data-only
  OffscreenCanvas worker-shadow profile, records parity samples and controlled
  drain counters, and remains observation-only with all W5 start booleans
  false.
- Packet BY split shared worker-shadow fingerprinting out of
  `workerFirstSolidTextImageShadow.worker.ts` into
  `workerFirstShadowWorkerFingerprint.ts` without changing rendering behavior.
  The shared shadow worker is no longer at the product-source LOC ceiling
  (`595` LOC; helper `106` LOC), leaving room for the remaining video/provider
  shadow packets.
- Packet BZ extends controlled worker-shadow parity to `multi-video`. The new
  `runWorkerFirstMultiVideoShadowParity` bridge tool materializes the real
  three-video fixture, captures main-renderer fingerprints for sample times
  `1/2/3/4`, renders a matching data-only OffscreenCanvas worker-shadow
  profile, records parity samples and controlled drain counters, and remains
  observation-only with all W5 start booleans false.
- Packet CA split Worker-First shadow-parity AI tool definitions out of the
  dense runtime-definition hub. `workerFirstRuntime.ts` now composes the shadow
  definitions from `workerFirstShadowRuntime.ts`, preserving the same bridge
  tool names while dropping the runtime-definition hub from `671` LOC to `166`
  LOC.
- Packet CB split the multi-video worker-shadow draw profile out of
  `workerFirstSolidTextImageShadow.worker.ts` into
  `workerFirstShadowVideoProfiles.ts` without changing parity behavior. The
  shared shadow worker dropped from `690` LOC to `602` LOC, leaving room for the
  remaining provider-shadow draw profiles.
- Packet CC extends controlled worker-shadow parity to
  `html-provider-fallback`. The new
  `runWorkerFirstHtmlProviderShadowParity` bridge tool materializes the real
  HTML-video provider fixture, captures main-renderer fingerprints for sample
  times `0/1/2`, renders a matching data-only OffscreenCanvas provider-video
  worker-shadow profile, records parity samples and controlled drain counters,
  and remains observation-only with all W5 start booleans false.
- Packet CD extends controlled worker-shadow parity to `webcodecs-provider`.
  The new `runWorkerFirstWebCodecsProviderShadowParity` bridge tool materializes
  the real full-mode WebCodecs provider fixture through an internal
  shadow-only materializer that skips the expensive sequential-export predecode,
  captures main-renderer fingerprints for sample times `0/0.75/1.5`, renders a
  matching data-only OffscreenCanvas provider-video worker-shadow profile,
  records parity samples and controlled drain counters, and remains
  observation-only with all W5 start booleans false.

## Next Eligible Codex Packets

Next work:

- Migrate render wake/cache command call sites in small batches:
  done for current `requestRender`/`requestNewFrameRender`/cache-clear
  inventory.
- Next packets should harden W5 prerequisites: collect the remaining platform
  evidence packages on macOS Safari and macOS Firefox.
  The accepted evidence suite can now rebuild the golden
  fixture, twelve-shadow, controlled drain-counter, local Windows/Chromium
  visible-stress, Main-Host runtime-counter observation, independent
  render-scheduler producer, cache producer diagnostics, provider producer
  diagnostics, and explicit runtime-model mapping set after reloads, including
  phasing over targeted bridge calls when the full suite would exceed the bridge
  timeout. The BJ smoke adds a separate local export/playback/runtime-feed
  proof, BK adds a hashable local platform package, BN adds the matrix
  verifier that can reject missing, duplicate, tampered, or invariant-failing
  platform packages, BO adds the script wrapper to collect/verify package
  artifacts, BP makes matrix verification independent of a live app tab, BQ
  adds a non-failing status command for in-progress package aggregation, BR
  adds a collect-time platform expectation guard for target-machine runs, BS
  adds the `jpeg-proxy` worker-shadow runner, BT adds the `nested-comps`
  worker-shadow runner, BU adds the `ram-cache` worker-shadow runner, BV adds
  the `bake` worker-shadow runner, BW adds the `export` worker-shadow runner,
  BX adds the `universal-3d-gaussian-cad` worker-shadow runner, BY split the
  shared worker fingerprint helper so the next shadow runners can stay below
  the source ceiling, BZ adds the `multi-video` worker-shadow runner, and CA
  splits the shadow tool-definition block out of the runtime definition hub,
  CB splits the multi-video worker draw profile out of the shared worker, CC
  adds the `html-provider-fallback` worker-shadow runner, and CD adds the
  `webcodecs-provider` worker-shadow runner. CE/CF make the package directory
  easier to operate during cross-machine collection with latest-per-platform
  reduction and a read-only doctor report.
  The full platform matrix is still unproven until the macOS Safari and macOS
  Firefox packages are collected from real target browsers and pass the offline
  or bridge matrix verifier.
  Do not start worker WebGPU presentation, worker presentation, or
  RenderDispatcher cutover until those gates report green in
  `workerFirstRenderer.w5Prerequisites`.

Do not start worker WebGPU, worker presentation, or RenderDispatcher cutover
work from the current state. W0-W4 are explicit foundations, and the first
Windows/Chromium `solid-text-image`/`multi-video`/`nested-comps` golden
captures, the `html-provider-fallback` and `webcodecs-provider` golden
captures, the `effects-masks-transitions`, `jpeg-proxy`,
`multi-target-output-slice`, `ram-cache`, `bake`, `export`, and
`universal-3d-gaussian-cad` golden captures, accepted-suite golden evidence,
local Windows/Chromium visible-stress proof, a hashable local Windows/Chromium
platform evidence package, a read-only platform-matrix verifier, a portable
platform evidence collector/verifier script, a collector platform-expectation
guard, and `solid-text-image`,
`multi-target-output-slice`, `effects-masks-transitions`, `jpeg-proxy`,
`nested-comps`, `ram-cache`, `bake`, `export`,
`universal-3d-gaussian-cad`, `multi-video`, `html-provider-fallback`, and
`webcodecs-provider` worker-shadow
proof plus controlled drain counters exist, but the visible platform matrix is
incomplete, worker-shadow parity still covers only the twelve controlled fixture
surfaces, and the real scheduler/cache/provider runtime producers are
observation-adapted into the explicit model rather than accepted as worker-owned
start-permission evidence.

## Fresh Prompt Requirements

Every worker prompt must include:

- `AGENTS.md` must be read first.
- Current plan/checklist/handoff paths.
- Packet lane, id, and mode.
- Allowed write set.
- Forbidden files.
- High-conflict files to avoid.
- Current contract and target contract.
- Runtime invariants.
- Expected gates.
- Exact focused checks.
- Stop conditions.
- Required report format.

Workers must not rely on previous agent memory, stale branch assumptions, or
informal chat context.

## Check Batching Policy

Workers run only the focused checks named in their prompt.

Do not run broad checks by default:

- no full `npm run build`
- no full `npm run lint`
- no full `npm run test`

Run broad checks only when:

- AGENTS.md requires it for normal commit, push, release, merge, or explicit
  final readiness
- the orchestrator batches them after several compatible packets integrate
- a packet's narrowest meaningful proof genuinely is a broader check

Batching examples:

- Run cloneability/import-boundary tests once after Packet H and Packet I
  contract changes integrate.
- Run AI bridge/proof smokes once after Packet F and Packet G observability
  changes integrate.
- Run target preview smokes once after Packet A/B lands.
- Run the full build/lint/test chain only at normal command boundaries or
  explicit readiness.

If an expensive check would be duplicated by multiple packets, defer it to the
orchestrator batch unless the packet is otherwise unprovable.

## Active High-Conflict Ownership

None.

High-conflict files require explicit ownership before source edits:

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

## Current Blockers

- Worker WebGPU/presentation remains blocked until W1-W4 gates and visible
  proof gates are materially stronger.
- Worker-presenting work must still wait for visible presentation and
  shadow-parity gates; Packet C only closes the main-mode host boundary, and
  Packet Z only makes those W5 gates executable.
- Golden manifests are defined, and all current manifests have real
  Windows/Chromium main-renderer browser captures. `solid-text-image`,
  `multi-target-output-slice`, `effects-masks-transitions`, `jpeg-proxy`,
  `nested-comps`, `ram-cache`, `bake`, `export`,
  `universal-3d-gaussian-cad`, `multi-video`, `html-provider-fallback`, and
  `webcodecs-provider` have real worker-shadow parity runs; do not claim full
  worker-shadow or cross-platform parity from the current unit tests.
- Proof captures are now recordable in memory; `solid-text-image` and
  `multi-video`, `nested-comps`, `html-provider-fallback`, `webcodecs-provider`,
  `effects-masks-transitions`, `jpeg-proxy`, `multi-target-output-slice`,
  `ram-cache`, `bake`, `export`, and `universal-3d-gaussian-cad`
  main-renderer golden captures exist, `solid-text-image`,
  `multi-target-output-slice`, `effects-masks-transitions`, `jpeg-proxy`, and
  `nested-comps`, `ram-cache`, `bake`, `export`, and
  `universal-3d-gaussian-cad`, `multi-video`, `html-provider-fallback`, and
  `webcodecs-provider` worker-shadow
  parity have been captured, and cross-platform visible presentation runs have
  not been captured yet.
- The visible-presentation AI bridge capture/stress path has been exercised on
  Windows/Chromium inside the accepted suite, but it has not yet been exercised
  across the required platform matrix.
- The playback-stress proof runner has a Windows/Chromium project-video warmup
  pass while the tab was visible. Hidden tabs now correctly reject live
  visible-proof reruns; when multiple app tabs are connected, target the
  visible/focused `tabId` before collecting runtime W5 proof.
- W5 counter sources are now recordable in memory and wired into stats. Packet
  BB publishes controlled shadow-run queue/cache/provider/timing drain counters,
  and Packet BD derives observation-only counters from real Main-Host
  scheduler/cache/provider/render-loop snapshots. Packet BE maps those
  observations through explicit cloneable worker-runtime job/cache/provider
  records. Packet BF maps the controlled worker-shadow drain producer through
  the same runtime-model path. Packet BG maps the live independent
  render-scheduler producer into the same model. Packet BH maps live cache
  producers into the same model. Packet BI maps live provider runtime resources
  and provider health into the same model. Packet BJ adds a live local
  export/playback smoke over those runtime feeds. The next migration is
  remaining platform evidence, not start-permission wiring.
- Visible proof and stress tools now publish real visible-pixel counter data;
  the stress proof refreshes the render target at a controlled capture time
  before fingerprinting.
- Worker-first stats are observation-only until an accepted W5 gate run is
  explicitly wired; the start-permission booleans remain false in ordinary
  `getStats`/`getPlaybackTrace` snapshots.
- Packet BD's stats path now derives real Main-Host runtime counter
  observations for `getStats.workerFirstRenderer` and
  `getPlaybackTrace.workerFirstRenderer` from serializable coordinator/cache/
  render-loop snapshots. These observations are not accepted W5 start
  permissions; ordinary stats remain `stats-observation` and start booleans
  remain false.
- Packet BE's runtime model is still observation-only. It creates the data
  shape needed for worker-owned scheduler/cache/provider producers, but ordinary
  stats remain `stats-observation` and start booleans remain false.
- Packet BG's independent render-scheduler diagnostics are cloneable and
  visible in stats, but they are not accepted W5 start permissions.
- Packet BH's cache producer diagnostics are cloneable and visible in stats,
  but they are not accepted W5 start permissions.
- Packet BI's provider producer diagnostics are cloneable and visible in stats,
  but they are not accepted W5 start permissions.
- Packet BJ's runtime export/playback smoke proves a local browser playback run,
  browser export blob, and scheduler/cache/provider runtime-feed exposure, but
  it is still observation-only and not accepted cross-platform start evidence.
- Packet BK's platform evidence package proves one local platform package
  (`windows-chromium` in the current run) with a hashable report, but the
  required Linux/Mesa, Firefox, and macOS platform packages remain missing.
- Packet BL's effects/masks/transitions worker-shadow runner broadens parity to
  effect, mask, transition, and blend-mode fixture signals, but it is still a
  controlled 2D worker-shadow proof and not full worker-presenting parity.
- Packet BM's phaseable accepted suite now rebuilds the volatile golden/
  three-shadow/local visible-stress evidence set after reloads without relying
  on caller-supplied proof state. The targeted Windows/Chromium bridge run
  reported 12/12 golden manifests captured, 38 golden fixture captures,
  10 shadow samples, 1 visible proof,
  `dom-visible-nonblank=passed`, `no-stale-visible-frames-under-stress=passed`,
  `queueDepth=0`, frame lifetime `outstanding=0/leaked=0`,
  `workerShadowParity=passed`, `visiblePresentation=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- Packet BN's matrix verifier can validate a full set of hashable platform
  packages, but it does not replace the missing target-browser runs and does
  not promote imported packages into W5 start permissions by itself.
- Packet BO's script wrapper proves the package artifact path end-to-end on
  Windows/Chromium and reports the expected incomplete matrix with the four
  non-Windows target platforms missing.
- Packet BP's offline verifier removes the need for a live bridge tab when
  aggregating package artifacts from target machines; the bridge verifier
  remains available as a parity cross-check.
- Packet BQ's status command is not a W5 gate; it is an operator-friendly
  progress view over the same package validation logic while the matrix is
  incomplete.
- Packet BR's `--expect-platform` guard prevents accidental target-machine
  mislabeling during package collection, but it is still only a collector
  safety check. It does not synthesize platform evidence and does not replace
  the missing real Linux/Mesa, Firefox, Safari, or macOS Firefox package runs.
- Packet BS's `jpeg-proxy` worker-shadow runner broadens controlled parity to a
  deterministic proxy-image/video signal, but it is still a data-only
  worker-shadow proof. It does not imply worker-presenting parity and does not
  change the missing cross-platform visible-proof blocker.
- Packet BT's `nested-comps` worker-shadow runner broadens controlled parity to
  deterministic nested composition reuse, but it is still a data-only
  worker-shadow proof. It does not imply worker-presenting parity and does not
  change the missing cross-platform visible-proof blocker.
- Packet BU's `ram-cache` worker-shadow runner broadens controlled parity to
  cached RAM-preview/composite-cache samples, but it is still a data-only
  worker-shadow proof. It does not imply worker-presenting parity and does not
  change the missing cross-platform visible-proof blocker.
- Packet BV's `bake` worker-shadow runner broadens controlled parity to
  clip-bake and composition-bake cached samples, but it is still a data-only
  worker-shadow proof. It does not imply worker-presenting parity and does not
  change the missing cross-platform visible-proof blocker.
- Packet BW's `export` worker-shadow runner broadens controlled parity to the
  export preview-parity fixture, but it is still a data-only worker-shadow
  proof. It does not imply worker-presenting parity and does not change the
  missing cross-platform visible-proof blocker.
- Packet BX's `universal-3d-gaussian-cad` worker-shadow runner broadens
  controlled parity to model/Gaussian/CAD descriptor signals, but it is still a
  data-only worker-shadow proof. It does not imply worker-presenting parity and
  does not change the missing cross-platform visible-proof blocker.
- Packet BY is a behavior-preserving LOC split only. It does not add a new W5
  surface and does not change the provider or platform-evidence blockers.
- Packet BZ's `multi-video` worker-shadow runner broadens controlled parity to
  real project video timelines, but it is still a data-only worker-shadow
  proof. It does not imply worker-presenting parity and does not change the
  missing platform-evidence blocker.
- Packet CA is a behavior-preserving AI tool definition split only. It does
  not add a new W5 surface and does not change the remaining provider or
  platform-evidence blockers.
- Packet CB is a behavior-preserving worker draw-profile split only. It does
  not add a new W5 surface and does not change the platform-evidence blocker.
- Packet CC's `html-provider-fallback` worker-shadow runner broadens
  controlled parity to the HTML video provider fallback surface, but it is
  still a data-only worker-shadow proof. It does not imply worker-presenting
  parity and does not change the platform-evidence blocker.
- Packet CD's `webcodecs-provider` worker-shadow runner broadens controlled
  parity to the full-mode WebCodecs provider surface, but it is still a
  data-only worker-shadow proof. It does not imply worker-presenting parity and
  does not change the missing cross-platform visible-proof blocker.

## Last Meaningful Checks

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
- Post-CQ collector load-gate regression:
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
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  5 tests. The delayed-tab fake bridge test now also asserts collect report
  readiness metadata: `targetWaitTimeoutMs`, `targetPollCount`,
  `selectedTabBeforeSettle`, `selectedTabAfterSettle`,
  `postSelectionSettleMs`, elapsed target wait, and elapsed settle wait.
  `node --check scripts\run-worker-first-platform-evidence.mjs` passed.
  `npm run worker-first:platform:doctor -- --latest-per-platform` reported
  `Bridge auth: ok`, `Collector wait: 5000ms`, and wrote
  `tmp\worker-first-platform-evidence\20260616-124908Z-platform-doctor.report.json`.
- Post-CS companion-report audit:
  `npx vitest run tests/unit/workerFirstPlatformEvidenceCli.test.ts` passed
  6 tests, including auditable companion reports and missing companion report
  summaries. `node --check scripts\run-worker-first-platform-evidence.mjs`
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
  call proved another tab could respond, so Packet CT removed stale-tab fallback
  selection. After the fix, `npm run worker-first:platform:doctor --
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
- Post-CV Linux Chromium/Mesa auditable refresh attempt:
  A headed Playwright Docker Chromium could register the bridge and expose Mesa
  WebGL/llvmpipe, but not WebGPU. The collect run mapped the platform as
  `linux-chromium-mesa` with `worker-cpu-present`, then failed because no active
  render-capture canvas was available after load (`engineReady=false`). Adding
  Mesa Vulkan drivers exposed llvmpipe Vulkan to `vulkaninfo`, but Chromium
  Vulkan flags failed GPU process initialization in the container, so no valid
  auditable Linux replacement package was produced. The failed payload was moved
  to
  `tmp\worker-first-platform-evidence\20260616-131655Z-linux-chromium-mesa-fnv1a-367a87.failed.json`;
  after the Packet CV CLI hardening, failed collects write `*.failed.json`
  directly and cannot be selected by `status --latest-per-platform`.
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
  3 shadow samples and 0 failures. The suite result remained
  expected-incomplete (`W5 evidence suite did not complete all required local
  evidence`), `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
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
  3 shadow samples and 0 failures. The suite result remained
  expected-incomplete (`W5 evidence suite did not complete all required local
  evidence`), `workerShadowParity=blocked`, and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
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
- Invalid expected-platform guard:
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
  - Passed; all three npm aliases are registered.
- Offline status proof:
  `npm run worker-first:platform:status -- tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  exited successfully and reported `Valid packages: 1/1`, no invalid or
  duplicate packages, and missing `linux-chromium-mesa`,
  `linux-firefox-mesa`, `macos-safari`, and `macos-firefox`.
- Packet BP script checks:
  `node --check scripts/run-worker-first-platform-evidence.mjs`
  - Passed.
- Offline expected-incomplete matrix proof:
  `npm run worker-first:platform:verify -- tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  reported `Valid packages: 1/1`, no invalid or duplicate packages, missing
  `linux-chromium-mesa`, `linux-firefox-mesa`, `macos-safari`, and
  `macos-firefox`, and wrote
  `tmp\worker-first-platform-evidence\20260616-090319Z-offline-platform-matrix.report.json`.
- Bridge cross-check of the same single package:
  `npm run worker-first:platform:verify -- --bridge tmp\worker-first-platform-evidence\20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  reported the same incomplete matrix and wrote
  `tmp\worker-first-platform-evidence\20260616-090319Z-bridge-platform-matrix.report.json`.
- Packet BO script checks:
  `node scripts/run-worker-first-platform-evidence.mjs --help`
  - Passed.
- `npm pkg get scripts.worker-first:platform:collect scripts.worker-first:platform:verify`
  - Passed; both npm aliases are registered.
- Real Windows/Chromium script proof after opening/refocusing a visible
  `http://localhost:5173/` tab and waiting 5 seconds:
  `npm run worker-first:platform:collect -- --duration-ms 1000 --min-preview-frames 1 --sample-width 16 --sample-height 9 --wait-ms 5000`
  passed and wrote
  `tmp/worker-first-platform-evidence/20260616-085944Z-windows-chromium-513968b2f0a6.package.json`
  with evidence hash
  `513968b2f0a6cff6b71b9b16543221f8027469d23c001d1e5beb135b2ada9470`.
- Expected-incomplete matrix script proof:
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
- Real phased Windows/Chromium bridge proof after opening/refocusing a visible
  `http://localhost:5173/` tab and waiting 5 seconds: the suite was rebuilt
  over targeted `runnerIds` phases with `clearBeforeRun` true only for the
  first phase. The final visible-only call returned `success=true`,
  `goldenFixtures=38`, `shadowSamples=10`, `visibleProofs=1`,
  no failed runners, no failed visible evidence, no missing golden manifests,
  `workerShadowParity=passed`, `visiblePresentation=blocked`,
  `w5GateEvidenceMode=accepted-gate-run`, `frameCount=47`,
  `staleVisibleFrameCount=0`, `nonBlankRatio=1`, and all W5 start booleans
  false.
- Live bridge preflight verified that non-array `runnerIds` are rejected before
  clearing proof state: `runnerIds='solid-text-image-golden'` returned
  `invalidRunnerIdsArg=true`.
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
  `runWorkerFirstEffectsMasksTransitionsShadowParity` passed 4/4 samples for
  `effects-masks-transitions` with renderer
  `worker-offscreen-2d-effects-masks-transitions`, `mainNonBlank=1`,
  `workerNonBlank=1`, zero failures, and max observed deltas
  `avgRgbDelta=30.7599`, `meanLumaDelta=17.4127`,
  `nonBlankRatioDelta=0`, `colorRangeDelta=40.7405`.
- Follow-up `getStats.workerFirstRenderer` after the BL live runner reported
  `shadowSamples=4`, `golden-fingerprint-parity` evidence for
  `effects-masks-transitions@0/0.5/1/1.5`, `w5GateEvidenceMode=stats-observation`,
  and all W5 start booleans false.
- A live `runWorkerFirstW5EvidenceSuite` attempt after opening a visible tab
  timed out at the AI bridge response layer with
  `Timeout: no browser tab responded within 30s`; the suite is now longer than
  the bridge's 30-second response watchdog, so this is recorded as a bridge
  timeout, not a failed W5 runner.
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
- Live bridge stats proof for BI was captured with a local headless Chrome tab
  after the required 5-second wait. Plain `getStats` exposed the top-level
  `providerRuntime` shape on a fresh empty project. A follow-up
  `runWorkerFirstHtmlProviderGoldenFixture` attempt failed its headless golden
  captures, but the subsequent `getStats.providerRuntime` contained 17
  producer-owned provider records (`providerKind=image`) with
  `w5GateEvidenceMode=stats-observation` and
  `canStartWorkerWebGpu/canStartWorkerPresentation/canStartRenderDispatcherCutover=false`.
- `npx vitest run tests/unit/cacheManagerRuntimeReporting.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 5 files, 12 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 30 files, 305 tests.
- Live bridge stats proof for BH was not captured: `getStats` still returned
  `Timeout: no browser tab responded within 30s`. The Vite server itself
  responded with HTTP 200 on `http://localhost:5173/`, so this remains a
  browser-tab bridge-client issue until a tab is reopened/refocused.
- `npx vitest run tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 5 files, 11 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 30 files, 304 tests.
- Live bridge stats proof for BG was not captured: `getStats` still returned
  `Timeout: no browser tab responded within 30s`. The Vite server itself
  responded with HTTP 200 on `http://localhost:5173/`, so this remains a
  browser-tab bridge-client issue until a tab is reopened/refocused.
- `npx vitest run tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts`
  - Passed: 5 files, 17 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 29 files, 303 tests.
- Live bridge runner proof for BF was not captured: after reload attempts, the
  AI bridge returned `Timeout: no browser tab responded within 30s` for
  `runWorkerFirstMultiTargetOutputSliceShadowParity`,
  `runWorkerFirstSolidTextImageShadowParity`, and later `getStats`. The Vite
  server itself still responded with HTTP 200 on `http://localhost:5173/`, so
  this is recorded as a missing browser-tab bridge proof rather than a passed
  runtime proof.
- `npx vitest run tests/unit/workerFirstRuntimeModel.test.ts tests/unit/aiToolStats.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstGateInputs.test.ts`
  - Passed: 4 files, 10 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstRuntimeModel.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 29 files, 303 tests.
- Real Windows/Chromium AI bridge proof after reload plus required wait:
  `getStats.workerFirstRenderer` reported
  `w5GateEvidenceMode=stats-observation`, `queueDepth=1`, cache bytes
  `3686400`, `frameLifetime.outstanding=0`, one runtime resource, and all W5
  start booleans false. A follow-up `getPlaybackTrace.workerFirstRenderer`
  retry reported `w5GateEvidenceMode=stats-observation`, `queueDepth=1`, and
  `canStartWorkerWebGpu=false`.
- `npx vitest run tests/unit/aiToolStats.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstCounterSources.test.ts`
  - Passed: 3 files, 8 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Real Windows/Chromium AI bridge proof after reload plus required wait:
  `getPlaybackTrace.workerFirstRenderer` reported `w5GateEvidenceMode=stats-observation`
  and runtime-derived `queueDepth=1`; after the tab settled further,
  `getStats.workerFirstRenderer` also reported `w5GateEvidenceMode=stats-observation`,
  `queueDepth=1`, cache bytes `3686400`, `frameLifetime.outstanding=0`, one
  runtime resource, and all W5 start booleans false.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 28 files, 301 tests.
- `npx vitest run tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 6 files, 189 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Real Windows/Chromium AI bridge proof after reload plus required 5-second
  wait: `runWorkerFirstMultiTargetOutputSliceShadowParity` passed 3/3
  samples for `multi-target-output-slice`; all samples were nonblank
  (`mainNonBlank=1`, `workerNonBlank=1`), with renderer
  `worker-offscreen-2d-multi-target-output-slice`.
- Real Windows/Chromium AI bridge proof after reload plus required 5-second
  wait: `runWorkerFirstW5EvidenceSuite` passed all 14 runners plus
  `render-capability-probe`, `visible-stress-fixture`, and
  `visible-presentation-stress`; 38 golden fixture captures, 6 shadow samples,
  1 visible proof, `nonBlankRatio=1`, `frameCount=311`,
  `staleVisibleFrameCount=0`, `workerShadowParity=passed`,
  `visiblePresentation=blocked` only for missing Linux/Mesa, Firefox, Safari,
  and macOS Firefox platform proofs, and all W5 start booleans false.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 28 files, 300 tests.
- `npx vitest run tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstW5Gates.test.ts`
  - Passed: 3 files, 15 tests.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 27 files, 294 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Real Windows/Chromium AI bridge proof after reload plus required 5-second
  wait: `runWorkerFirstW5EvidenceSuite` passed all 13 runners plus
  `render-capability-probe`, `visible-stress-fixture`, and
  `visible-presentation-stress`; 38 golden fixture captures, 3 shadow samples,
  1 visible proof, `queueDepth=0`, frame lifetime `outstanding=0/leaked=0`,
  `nonBlankRatio=1`, `frameCount=285`, `staleVisibleFrameCount=0`,
  `dom-visible-nonblank=passed`,
  `no-stale-visible-frames-under-stress=passed`, `workerShadowParity=passed`,
  `visiblePresentation=blocked` only for missing Linux/Mesa, Firefox, Safari,
  and macOS Firefox platform proofs, and all W5 start booleans false.
- `npx vitest run tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/renderHostPort.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/aiToolDefinitions.test.ts`
  - Passed: 4 files, 148 tests.
- `npx tsc -b --pretty false`
  - Passed.
- Targeted real Windows/Chromium AI bridge proof against focused `tabId`
  `bfa74cfe-6f88-41a3-bfe9-b82256aadc6c` after 5-second post-HMR wait:
  `runWorkerFirstW5EvidenceSuite` passed all 13 runners, plus
  `render-capability-probe`, `visible-stress-fixture`, and
  `visible-presentation-stress`; 38 golden fixture captures, 3 shadow samples,
  1 visible proof, `nonBlankRatio=1`, `frameCount=308`,
  `staleVisibleFrameCount=0`, `dom-visible-nonblank=passed`,
  `no-stale-visible-frames-under-stress=passed`, `workerShadowParity=passed`,
  `visiblePresentation=blocked` only for the missing non-Windows platforms.
- `npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts`
  - Passed: 27 files, 292 tests.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstProofHarness.test.ts`
  - Passed: 3 files, 13 tests.
- Real AI bridge evidence after a hard reload and required 5-second wait:
  `runWorkerFirstW5EvidenceSuite` passed all 13 runners with
  `goldenFixtures=38`, `shadowSamples=3`, `visibleProofs=0`,
  `w5GateEvidenceMode=accepted-gate-run`, `workerShadowParity=passed`,
  `visiblePresentation=blocked`, and all W5 start booleans false.
- Follow-up `getStats.workerFirstRenderer` reported ordinary
  `w5GateEvidenceMode=stats-observation`, 12/12 golden manifests captured,
  38 golden fixture captures, 3 shadow samples, `workerShadowParity=passed`,
  `visiblePresentation=blocked`, and all W5 start booleans false.
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
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts`
  - Passed: 2 files, 9 tests after Packet X.
- `npx tsc -b --pretty false`
  - Passed.
- `npx vitest run tests/unit/exportRenderSession.test.ts tests/unit/exportAssetPreload.test.ts tests/unit/exportRenderHostPortBoundary.test.ts`
  - Passed: 3 files, 16 tests.
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
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/renderHostServiceCallers.test.ts tests/unit/exportRenderSession.test.ts tests/unit/exportAssetPreload.test.ts tests/unit/exportRenderHostPortBoundary.test.ts tests/unit/cachedFrameRenderer.test.ts tests/unit/cachedFrameVisiblePresentation.smoke.test.ts tests/unit/usePreviewRenderTargetRegistration.test.tsx tests/unit/previewTargetRegistration.test.ts tests/unit/renderOutputRouterAdapter.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/renderCapabilityProbe.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/renderGraphContracts.test.ts tests/unit/renderJobScheduler.test.ts tests/unit/renderCacheRegistry.test.ts tests/unit/frameProviderPolicy.test.ts tests/unit/renderContracts.test.ts tests/unit/aiToolStats.test.ts`
  - Passed: 19 files, 77 tests.
- `npx vitest run tests/unit/renderHostPort.test.ts tests/unit/previewTargetRegistration.test.ts tests/unit/usePreviewRenderTargetRegistration.test.tsx tests/unit/cachedFrameVisiblePresentation.smoke.test.ts`
  - Passed: 4 files, 15 tests.
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

Install note:

- `npm install` was run because `node_modules` was missing; npm reported
  12 existing audit findings.

