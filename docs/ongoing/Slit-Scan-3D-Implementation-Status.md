# Slit Scan 3D implementation status

Private implementation note, 2026-09-23. Do not publish or stage this file.

The user explicitly confirmed DIS is released, then questioned its quality after
showing the red overlay. Release permission is not accuracy evidence. Preserve
parallel DIS work; the direct numerical probe below exposes a large-motion limit.
The user requests ordinary browser operation, without the AI bridge. AGENTS.md
was updated in local documentation commit `81302662`.

## Implemented foundations (not a completed feature)

- `src/effects/time/slit-scan/geometryContract.ts`: explicit base sampler;
  derives numeric query using the existing demand graph; signed continuous
  source age delegates to the existing temporal source mapping. GPU resources
  are runtime-only. Ready/preparing/error cannot mix partial frame packages.
- Scene layer base/collector and LayerSpaceEffectRenderer now forward temporal
  source and source masks, preserving the per-layer render clock scope.
- `geometryReference.ts`: fixed object-local perspective/orthographic image
  reference matrices; no dependency on the orbit camera.
- `SlitScanSurfacePass.ts` and `SlitScanSurface.wgsl`: procedural GPU triangle
  grid, ray displacement, clipping bounds, fragment reprojection and premultiplied
  alpha. This pass is not yet connected to NativeSceneRenderer.

## Evidence

- `npx vitest run tests/unit/slitScanGeometry.test.ts`: 2 passed.
- `npx vitest run tests/unit/layerSpaceEffectRenderer.test.ts`: 1 passed, including
  source/mask forwarding and export render scope.
- Browser GPU test at `/tests/manual/slit-scan-surface.html`: perspective and
  orthographic, 64x64 grid, 128x128 synthetic color with varying alpha, signed
  sinusoidal displacement amplitude 1.7. Both: maximum RGBA byte error 1,
  mean error 0.015045166015625, alpha error 0, holes 0. This verifies the actual
  mesh pass against expected premultiplied color, not the complete editor path.
- Probe tab ID `1374897805`; editor tab `1374897694`, Chrome browser `1`.
  Revalidate browser inventory before reuse. Never close tabs.
- `/tests/manual/slit-scan-dis-quality.html` calls the actual DisFlowGpu with
  synthetic 128x128 adjacent images, dt=.04 (and -.04), and reads RGBA16F output.
  Still: EPE 0. X=2: mean EPE .00193 px; Y=-2: .00176 px;
  subpixel (.5,-.25): .02092 px; reverse PTS: .00172 px. All accepted 100%.
  Flat: confidence/validity 0. Occlusion: covered-center confidence .00118;
  cut: mean confidence .000661. Large (8,5): accepted fraction .2231,
  accepted mean EPE .4169 px, p95 1.0209 px: FAIL. Probe thresholds declared
  before execution: acceptance >.6, mean EPE <.5, p95 <1, flat/cut/occlusion
  confidence <.15. Texture is a sum of sinusoids; do not generalize to all media.
  The probe tab now displays this DIS result. No algorithm code was modified.

## Remaining scope

Latest implementation continuation (not yet tested):

- User explicitly requests all tests/checks at the end, after implementation.
  Do not run intermediate vitest/TypeScript/browser probes.
- EffectsPipeline now has a synchronous geometry capture sink; landmark upload
  ownership moved to EffectLandmarkBuffers to keep the main file bounded.
- GeometryQueryOutput renders a Float32 query using the exact graph/resources.
  GeometryAgeField maps it through an 8193-entry relative source-age table and
  applies bounded confidence-weighted DIS deformation with spatial edge guards.
- SlitScanSceneSurfaces is wired into NativeSceneRenderer; collector routes the
  stack through Slit Scan to object space and excludes those planes from PlanePass.
- SlitScanGeometryControls/geometryParameters implement representation, explicit
  sampler, reference matrices, depth/flow/smoothing/quality, preview-only reset.
  Settings are ordinary serialized effect params. All 3 modes are exposed.
- BandTrajectoryField traces bounded adjacent-PTS chains using both DIS directions.
  DisFlowGpu optionally stores independently computed backward fields;
  DisMotionCache exposes DisTrajectory on its runtime atlas resource. SourceMotionHistory
  requests it for the geometry owner and lowers its analysis budget for bands.
- Surface shader switches to band positions, omits invalid cells, and uses a
  documented alpha cutout for self-overlap. This is unverified implementation.
- DIS coarsest search now tries a bounded integer seed grid to address the observed
  large-motion failure. Re-run the existing numerical probe only in final checks.
- Known TypeScript constructor parameter-property errors in DIS files were changed
  to explicit fields; metadata upload copies to an ArrayBuffer-backed typed array.
- TemporalEffectResources rejects stale Hybrid results for geometry and subtracts
  numeric field bytes from the history budget. Required flow joins existing waits.
- New draft feature doc: docs/Features/Slit-Scan-3D.md. README/index links still pending.

The older remaining-scope paragraphs below predate these changes. Audit against
current code, especially full frame metadata/identity, UI sampler discovery on
expanded graphs, scope cleanup/HMR/device loss, scene capability detection,
multi-object downstream effects, band eligibility and UI camera reset behavior.
Nothing above has been re-tested after the user's defer-testing instruction.

A is partial: connect the frame package to the Slit Scan owner using its evaluated
graph and resolved resources, retain discrete sampling metadata, and handle
stabilization identity and async consistency. B's synthetic projection proof
passes; add changed-view evidence when scene camera wiring is available.

C: numeric float query/age field generation, native scene layer/pass routing,
stack boundary, UI, durable settings/reference and sampler, resource cleanup,
seek/playback/reload and actual export verification.

D: integrate released DIS fields at matching sample UV/delay, bounded/confidence
weighted deformation, boundary-aware smoothing, fallback/status, export barrier.

E: explicit linear-profile seed-line trajectories, genuine correspondence across
source times, segment termination/identity and documented transparency behavior.
Do not approximate backward trajectories by negating forward flow at the same UV.

Then feature documentation/README, final build once, local commit only own allowed
changes. Shared tree has many unrelated staged and unstaged changes. Do not stage
whole files containing others' changes without isolating own hunks. No feature
commit or completion claim yet.

## Continuation 2026-09-23 14:00 UTC

Implemented additional integration fixes (not yet acceptance-verified):
- Validate band profile and trajectory before overwriting the age texture held by the last complete preview package.
- Missing/deleted geometry samplers report status without per-frame exception spam; export still fails explicitly.
- Explicit unfilterable-float bindings for rgba32float query/age fields in both compute passes.
- Single Slit Scan scene output no longer multiplies clip opacity twice.
- Geometry inspector resolves shared effect owners via findClipOperatorEffect and reports graph errors rather than silently hiding them.

Live investigation: Effects tab sometimes remains at Loading for minutes after HMR/reload. It did render once; geometry sampler list empty and status The effect owner is unavailable. Subsequent reload has not yet reached effect controls. No final build, export, or final feature commit. Check the owner issue against cold module state; do not assume the helper fixed it. Browser editor tab 1374897694 remains open. Old GPU probe tab 1374897805 is no longer available (tool reported missing), do not reuse stale handle.

Outstanding integration issue: sceneCompositeStyle only retains post-projection effects for a single visual layer. Multi-visual Slit Scan scenes still need correct per-owner downstream routing; documentation currently overstates that part. Required final DIS large-motion rerun, C/D/E live acceptance, actual video export, final build and selective commit are still outstanding. No broad tests or intermediate build were run this continuation.

## Continuation 2026-09-23 14:12 UTC

- Per-owner post-projection effects implemented in SlitScanProjectedEffects, retaining mesh depth and moving generated outside pixels to far plane. Collector passes downstream stack; synthetic scene excludes it to prevent duplication. Slit surfaces now join transparent-plane depth order after opaque draws. Final acceptance still required.
- Inspector was stuck in lazy Suspense. Direct EffectsTab import resolved it; inspected actual rendered UI now shows source/masks and all samplers. Geometry controls take exact operatorGraph from both inspector callers rather than requiring another owner lookup.
- Four targeted files passed, 12 tests (slitScanGeometry, layerSpaceEffectRenderer, effectsPipelineTemporalFailure, sceneEffectRouting). No full suite/build.
- DIS GPU quality page final pass all 9: still0 error; x mean .001667px; y .001756; subpixel .020920; large(8,5) accepted .923503, mean .007559px,p95 .007071; reversePTS .001687. Flat confidence0; occlusion masked confidence0; cut mean confidence .001106. Threshold accepted>.6, mean EPE<.5px,p95<1px; low-texture/cut confidence<.15. Earlier large motion failure fixed.
- Restarted exact dev-full --lan tree; new root PID9412; all4 services listening. Logs TEMP/masterselects-slit-scan-dev.{out,err}.log. No bridge used.
- Live editor: base sampler explicitly selected history; reference camera button used; delay/timeFactor changed from8/8 to1/1 to shorten test preparation. Time surface ready, visible bike image at74.4sec, no captured browser errors. Six next-frame clicks to74.6sec, set In74.4 and Out74.6 (0.19range UI), saving automatic. Export via panel started at1080p24fpsH264, output slit-scan-3d-reference-check, audio disabled. Must inspect ongoing export, not restart blindly.
- Browser editor1374897694; finalProbe1374897809 at DIS quality page, must markHandoff each turn, never close. Old surfaceProbe missing.
- Export completed: Downloads/slit-scan-3d-reference-check.mp4, 428636 bytes; ffprobe1920x1080,24fps,5frames,.208333sec. Decoded firstframe to TEMP/slit-scan-3d-export-frame.png and inspected: valid bike content, noticeably closer/cropped vs preview reference camera. Stored scene camera differs; need align camera before pixel parity comparison (do not assume export bug or claim parity).
- After export, current editor playhead51.733 and in/out cleared; possible parallel/user interaction or export restoration. Re-read UI before dependent actions.

## Continuation 2026-09-23 14:41 UTC
- User prioritizes debugging current regressions over adding features; explicitly allows targeted tests and builds, prefers code investigation, has handed over the existing editor tab. No bridge.
- Added durable DIS cache fields and Analysis reference, CACHE_MOTION external folder mapping. Corrected erroneous ProjectFile.id guard to pin actual FSA directory/native path. Tests use real binary Blob implementation (jsdom Blob lacks arrayBuffer).
- Removed per-pair sequential disk waits: bounded DisFlowWriteQueue, four jobs / 64 MiB packed payload, bounded read batches. Reference package save runs alongside binary saves, not before GPU analysis. Timings separate GPU, readback, checksum, binary file and project reference. Root physical-storage latency still not live measured; do not claim fully fixed.
- 5 persistence/queue tests pass. 2 SourceMotionHistory bypass tests pass: inactive geometry/scan smoothing cancels running DIS via destroy while auxiliary numeric passes with active params retain work. Completed smoothing fields remain warm.
- Visible 3D geometry section moved to inspector top, shared enable switch changes to 2D and remembers geometryLastMode. Live switch activation showed Reference time surface/history and exposed controls; off state observed. Live stopped bypass still needs complete acceptance.
- Two full builds passed (latest finished16:34:57 local) before adaptive fix. Current build session77660 running for adaptive fix. Log TEMP/masterselects-slit-final-build.log.
- Adaptive defect: planner only reduced spatial resolution under VRAM pressure, so 1080p short windows stayed full size despite Adaptive. Added <=960 max edge (further memory reduction unchanged), preserved1920 temporal samples. Full resident cache no longer unconditionally released on Play; retained only if full allocation plus interactive ceiling fit selected shared budget. 2 targeted adaptiveTemporalPreview tests pass. Docs/README updated.
- Normal CUA browser APIs work; editorDebug.dev.logs also works. markHandoff triggered extension-update message earlier; not an actual UI blocker. Old finalProbe absent in current tab inventory; never close tabs. Browser editor1374897694 remains open.
- Browser log warnings: many Slow history snapshot capture and HIGH_DROP_RATE. No new DIS logs observed. Base playback without effect at30target: roughly29 effective FPS, render0.84ms; with earlier2D effect22effective and8.44ms. Samples not strictly same segment and background build affected first measurement, so not conclusive comparison.
- Current local test state shifted between PXL video and bike compositions, likely user actions/reload. Always reread. Last fresh bike test at10.933s had no effect visible; one Apply click yielded two SlitScans; removed last extra (button569). One active SlitScan remains, resident4GiB/adaptive/1920/nearest/delay1/timeFactor1,3Doff. Do not assume original PXL remains selected.
- User screenshot widebands: Nearest and Blend observed at different points. With Full resolution+Blend screenshot showed softened moving pillar rather than coarse original tiles; source PXL30fps, timeFactor4,delay1. Cannot claim 1920 distinct video frames. Still need reliable fixed-state verification; user prefers code first.
- Remaining A-E acceptance still incomplete: reference parity actual editor/export camera, flow/band, deterministic seeks/playback, reload persistence, downstream GPU effects, final selective own commit. No feature commit or push yet; private plans/status must remain unstaged.
