> Status: Archived from `docs/ongoing/` on 2026-06-25 after docs triage; historical planning context unless explicitly reopened.

# Worker WebGPU Playback Presentation Plan

Original status before archive: active focused plan for strict `worker-gpu-only` playback presentation.
Created: 2026-06-18
Updated: 2026-06-18

This plan is the focused next step after the worker-first renderer foundation.
It does not introduce another compatibility renderer. The target is the real
worker WebGPU playback path: source frames are worker-owned, compositing is
WebGPU in the worker, presentation is the worker-owned target surface, and
unsupported coverage is reported as a blocking GPU-path gap instead of being
rescued by CPU, 2D canvas, ImageBitmap software presentation, or the retained
main-thread renderer.

Canonical context:

- `docs/ongoing/Worker-First-Playback-Renderer.md`
- `docs/ongoing/Worker-First-Playback-Renderer-checklist.md`
- `docs/ongoing/Worker-First-Playback-Renderer-handoff.md`
- `docs/ongoing/Playback.md`

## Current Baseline

Local Windows/Chromium strict GPU-only testing now proves the first worker-owned
WebGPU presentation gate. The original boundary test was honest but black:
`worker-gpu-only`, `worker-webgpu-present`, main fallback inactive, no software
frame presentation, `lastSoftwareFrame=null`, and rising software block
counters. That showed CPU/software fallback was disabled but no worker GPU
surface was visibly presenting.

2026-06-18 integration result after Wave 0 plus WG-I1/WG-I2:

- Render host mode: `worker-gpu-only`.
- Selected strategy: `worker-webgpu-present`.
- Main fallback: inactive (`fallbackActive=false`).
- Worker WebGPU target surface presents a visible test pattern through the
  transferred Preview canvas.
- Browser proof after reload plus required 5s wait, Comp 2, playhead 0,
  20s playback:
  - evidence JSON:
    `E:\MasterSelectsDebugTemp\masterselects-comp2-worker-gpu-only-gpu-pattern-attach-gated-20s.json`
  - capture PNG:
    `E:\MasterSelectsDebugTemp\masterselects-comp2-worker-gpu-only-gpu-pattern-attach-gated-capture.png`
  - active comp: `Comp 2`, 60 FPS.
  - FPS history: min `56`, max `61`, avg `59.8`.
  - before-pause FPS: `60`, target FPS `60`.
  - `previewPathCounts.worker-gpu-only:gpu-test-pattern=295` in the
    before-pause stats window.
  - `gpuOnlyTestPatternFrameCount=1164`.
  - `gpuOnlyTestPatternFailureCount=0`.
  - `presentationAttempts=1164`, `presentationFailures=0`.
  - `lastSoftwareFrame=null`, `lastAttemptedSoftwareFrame=null`.
  - pixel sample over the capture: 1920x1080, 4352/4352 sampled pixels
    non-black, average RGB about `123/189/21`.
- Early GPU presents are now gated until `attachTargetSurface` succeeds, so
  startup no longer records a false worker WebGPU failure.

This is not real video playback yet. It proves the worker-owned WebGPU surface
is visible and can submit/present without CPU, 2D canvas, software preview, or
main-thread render rescue. The next gate is replacing the test pattern with a
worker-owned source texture path: provider frame -> GPU texture registry ->
minimal GPU compositor -> `worker-gpu-only:video-frame`.

## Size Estimate

This is a large render-runtime slice, not a small playback fix.

Practical estimate:

- Visible worker WebGPU clear/present proof: 1 focused packet, usually
  0.5-1 day if the browser path is valid; longer if target transfer/context
  lifecycle is wrong or platform support is silently broken.
- First real Comp 2 video frame through worker WebGPU: 3-5 packets after the
  clear proof, roughly 1-3 days. This includes a worker-owned frame provider,
  texture import, a basic retained texture registry, and a one-video
  compositor path.
- Full direct target architecture for playback, scrub, nested comps, effects,
  transitions, RAM/cache/readback/export parity, and diagnostics: 14-22 bounded
  packets. Expect several days to more than a week depending on how much WGSL
  effect parity is moved in the first pass.

The plan is still direct-to-target. The packet split exists to control risk and
verification, not to ship temporary intermediate renderer paths.

## Non Goals

- No CPU or 2D fallback inside `worker-gpu-only`.
- No `presentSoftwareFrame` path for `worker-webgpu-present`.
- No HTMLVideo snapshot fallback for normal GPU-only playback.
- No main-thread `WebGPUEngine` rescue for preview frames.
- No main-thread DOM canvas bridge as the product strategy.
- No duplicate "temporary GPU presenter" that is unrelated to the final worker
  graph.
- No durable project/store/runtime DTOs that contain DOM, React, Zustand,
  `File`, `Blob`, `HTMLVideoElement`, `HTMLImageElement`, `ImageBitmap`,
  `VideoFrame`, `GPUDevice`, `GPUTexture`, or other runtime handles.

Unsupported scope is allowed to block with clear telemetry. It is not allowed
to silently route to CPU or main-thread rendering in GPU-only mode.

## Target Architecture

```text
Main thread
  React/UI/timeline editing
  renderHostPort mode and target registration
  data-only render graph/delta emission
  no preview frame rendering in worker-gpu-only

Runtime worker
  Worker WebGPU device owner
  OffscreenCanvas WebGPU target owner
  worker-owned VideoFrame/image/proxy/document/3D providers
  GPU texture registry and lifetime ownership
  GPU pass scheduler
  GPU compositor/effects/transitions/nested comp renderer
  presented-frame telemetry
  optional GPU readback for export/proofs, not preview fallback

Decode/provider workers or worker subsystems
  demux/decode/proxy/document/image/3D preparation
  transferable provider payloads and release tokens
  direct handoff into render worker texture registry where possible
```

Normal playback in this architecture cannot depend on DOM `HTMLVideoElement`
snapshots. A strict worker GPU path needs worker-owned source frames. For video
that means Worker WebCodecs, native-helper frames, proxy frames, or another
worker-owned provider. DOM media can stay as a legacy explicit comparison path,
but it is not a valid `worker-gpu-only` source.

## Module Boundaries

Add or evolve modules around final ownership boundaries:

- `workerGpuRuntimeCommands.ts`
  - GPU-only runtime commands and DTOs.
  - No software-frame commands.
  - Commands include target attach/detach, graph init/delta, clock/deadline,
    provider frame availability, render frame, readback, dispose.
- `workerGpuTargetSurface.ts`
  - OffscreenCanvas WebGPU context configuration.
  - Resize/reconfigure/device-lost handling.
  - Visible clear/present proof helpers.
- `workerGpuDevice.ts`
  - Device/adapter acquisition, limits, feature policy, device-lost recovery.
  - One owner for worker GPU lifetime.
- `workerGpuTextureRegistry.ts`
  - Runtime-only texture handles, reference counts, release tokens, cache ids,
    VRAM estimates, import/reuse/evict counters.
- `workerGpuFrameProviders.ts`
  - Worker-owned provider contracts for video, image, proxy, document, and
    later 3D/CAD/Gaussian sources.
  - Request ids, generations, exact/nearest/hold modes, deadline policy, and
    release accounting.
- `workerGpuVideoFrameImporter.ts`
  - `VideoFrame` or provider frame import into GPU textures.
  - `copyExternalImageToTexture` and future zero-copy paths are isolated here.
- `workerGpuRenderGraph.ts`
  - Final GPU render graph DTOs for composition, layer, source, transform,
    opacity, blend, effects, masks, transitions, and nested comp dependencies.
  - Graph DTOs are cloneable and handle-free.
- `workerGpuPassScheduler.ts`
  - Pass ordering, dirty/dependency tracking, nested comp dedupe, target
    routing, and latest-wins playback/scrub cancellation.
- `workerGpuCompositor.ts`
  - Fullscreen/quad pipelines, blending, alpha, transform, color management,
    target clear, and final output pass.
- `workerGpuEffects.ts` plus per-effect WGSL modules
  - GPU-native effect parity. Existing worker software effect code is reference
    behavior only, not a runtime fallback.
- `workerGpuTransitions.ts`
  - GPU masks/transitions in final pass form.
- `workerGpuNestedComposition.ts`
  - Nested comp render targets and texture cache ownership.
- `workerGpuReadback.ts`
  - Debug/export/proof readback. This is not preview presentation fallback.

Existing modules can stay as input context, but strict GPU-only must not call
the software presentation path:

- `workerSoftwarePreviewFrame.ts`
- `workerRenderHostSoftwarePainter.ts`
- `workerSoftwareHtmlVideoSnapshotCache.ts`
- `workerPresentingCompositeCache.ts`
- `presentSoftwareFrame` runtime command

## Direct Implementation Plan

### Packet WG-0: GPU-Only Guardrail Lock

Goal: make the current black preview an intentional, measurable GPU-only
boundary.

Work:

- Keep `worker-gpu-only` strict.
- Keep CPU/software counters visible in render-host diagnostics.
- Add a static/unit guard that `worker-gpu-only` cannot call
  `buildWorkerSoftwarePreviewFrame`, `presentSoftwareFrame`,
  `cacheWorkerSoftwareHtmlVideoSnapshot`, or main fallback preview methods.

Exit:

- Focused tests prove software path is blocked.
- Bridge stats show `worker-gpu-only`, `worker-webgpu-present`,
  `fallbackActive=false`, `presentationAttempts=0`, and rising blocked
  counters under playback.

### Packet WG-1: Visible Worker WebGPU Target Proof

Goal: prove direct worker WebGPU presentation is visible before implementing
video.

Work:

- Extract `workerGpuTargetSurface.ts` from the current GPU presenter.
- Add a command such as `presentGpuTestPattern` that clears the worker-owned
  WebGPU target to a frame-indexed color/pattern and submits it.
- Add telemetry for:
  - context configured
  - canvas size and DPR
  - preferred format
  - device acquired
  - command submitted
  - `onSubmittedWorkDone` resolved
  - presented frame id
- Add bridge proof that captures the visible canvas after a required 5s
  post-refresh wait.

Exit:

- `captureFrame` sees a non-black worker WebGPU test pattern from
  `workerRenderHost:preview`.
- If still black, this packet stops and records the exact surface/device
  failure evidence. It does not add a CPU fallback.

### Packet WG-2: GPU Runtime Command Boundary

Goal: separate final GPU commands from software-frame commands.

Work:

- Add GPU-only command DTOs.
- Add cloneability and forbidden-handle tests.
- Keep runtime handles in worker state, never in command payloads.
- Add command ids, target ids, timeline times, deadlines, and cancellation
  policy.

Exit:

- GPU runtime handlers accept GPU commands without importing software painter
  modules.
- Boundary tests forbid `WorkerRenderSoftwareFrame` and legacy `Layer[]` in the
  GPU command surface.

### Packet WG-3: Worker-Owned VideoFrame Provider For Normal Playback

Goal: make Comp 2's normal forward video source worker-owned.

Work:

- Extend or split the current Worker WebCodecs runtime so forward playback can
  provide fresh frames, not only reverse/faster playback.
- Load source bytes through a worker-owned provider session.
- Support frame requests by timeline time with exact/nearest/hold mode.
- Add frame lifetime counters:
  - decoded
  - delivered
  - imported
  - released
  - closed
  - late
  - stale
  - leaked
- Keep unsupported containers explicit. They may block, but they must not use
  HTMLVideo snapshots in GPU-only.

Exit:

- Bridge stats for Comp 2 show a worker provider session for `streifen.mp4`.
- Provider can deliver frame metadata and at least one fresh `VideoFrame` or
  importable frame payload to the render worker.

### Packet WG-4: GPU Texture Registry And Frame Import

Goal: import provider frames into worker GPU textures with explicit lifetime.

Work:

- Add texture registry entries keyed by provider source id and frame time.
- Add `copyExternalImageToTexture` import path for `VideoFrame`/importable
  sources.
- Add release/fence policy after GPU submit.
- Add texture size, format, VRAM estimate, import latency, and reuse counters.

Exit:

- A provider frame imports to a GPU texture.
- The texture is reused or released deterministically.
- No `ImageBitmap` software frame is built for preview.

### Packet WG-5: Minimal Final GPU Compositor

Goal: render one video layer plus solid background through the final compositor
module.

Work:

- Add quad vertex pipeline.
- Add transform, opacity, source rect, alpha, and target clear.
- Composite imported video texture into the target surface.
- Emit presented-frame events using the same counter source consumed by
  `getStats` and `getPlaybackTrace`.

Exit:

- Comp 2 capture is visibly non-black and shows the video frame.
- Playback stats show `previewFrames > 0` and a GPU path count such as
  `worker-gpu-only:video-frame`.
- Software blocked counters no longer need to rise for ordinary render ticks
  once GPU source coverage is present.

### Packet WG-6: Playback Cadence And Backpressure

Goal: make 60 FPS Comp 2 playback run on the worker GPU cadence without stale
queues.

Work:

- Use active composition FPS as visual cadence.
- Latest-wins render deadlines for playback.
- Drop stale provider responses and stale GPU render commands.
- Track render gap, provider wait, import, pass, submit, and present timings.
- Keep the 5s post-refresh testing rule in all bridge repro instructions.

Exit:

- 20s Comp 2 playback reports target 60 FPS, preview frames/updates from the
  GPU path, no unbounded queue growth, and truthful drop/stale counters.

### Packet WG-7: GPU Layer Coverage Expansion

Goal: move from one-video proof to final playback feature coverage without CPU
fallback.

Work, in bounded subpackets:

- solids and text/image textures
- blend modes
- color and canvas-filter-equivalent effects as WGSL
- pixel/source-resampling effects
- transition masks
- nested compositions
- output slices and independent preview targets
- RAM preview cache textures
- export/proof readback from GPU texture output

Exit:

- Each feature either renders through GPU-only or blocks with a named
  unsupported GPU feature reason.
- No feature uses software preview presentation as a fallback in
  `worker-gpu-only`.

### Packet WG-8: Export And Readback Integration

Goal: use the same worker GPU render graph for export/proofs instead of the
worker software readback path.

Work:

- Add GPU output texture readback for debug/export.
- Keep export readback in `workerGpuReadback.ts`.
- Reuse graph/provider/texture registry, not a separate export renderer.
- Keep unsupported export frames blocked in GPU-only.

Exit:

- `debugExport` can render a short Comp 2 range through worker GPU readback.
- Export telemetry reports `worker-gpu-readback`.

## Invariants

- `worker-gpu-only` is allowed to be black while a required GPU feature is
  missing. It is not allowed to be silently rescued.
- A presented frame in `worker-gpu-only` must have a worker GPU frame id.
- `getStats` and `getPlaybackTrace` must distinguish:
  - no GPU frame
  - GPU clear/test pattern
  - GPU VideoFrame source
  - GPU image/text/solid source
  - GPU nested comp
  - GPU readback/export
- CPU/software counters are diagnostic guardrails. A healthy GPU-only playback
  run should not continuously increment them.
- Device loss or surface invisibility blocks the GPU-only gate and records
  evidence. It does not downgrade to CPU in this mode.

## Test Plan

Focused checks by packet:

- `npx tsc -b`
- `npx vitest run tests/unit/workerPresentingRenderHostPort.test.ts`
- `npx vitest run tests/unit/workerRenderHostRuntime.test.ts`
- New GPU boundary tests:
  - worker GPU command cloneability
  - no software-frame imports in GPU runtime handlers
  - texture registry lifetime and release
  - provider frame lifetime accounting
  - compositor solid/video draw command construction
- Bridge checks:
  - set `worker-gpu-only`
  - reload
  - wait 5 seconds
  - open Comp 2
  - set playhead 0
  - run playback 10s and 20s
  - capture visible frame
  - inspect `getStats` and `getPlaybackTrace`

Full readiness checks remain the normal AGENTS.md chain at readiness/commit
boundaries:

- `npm run build`
- `npm run lint`
- `npm run test`

## Parallel Agent Execution Plan

MasterSelects already has the execution structure for this: bounded packets,
disjoint write sets, explicit forbidden files, focused checks, and up to 6
parallel Codex workers. Use that structure here. Doppelspitze stays disabled
unless the user explicitly re-enables it; coordination is through packet
prompts, reports, and normal chat updates.

Parallelism rule: only new leaf modules, tests, and read-only audits run in
parallel. Integration into render-host/runtime hub files is serialized.

### Wave 0: Parallel Preflight And Contracts

These agents can run at the same time because their write sets are disjoint.

#### Agent WG-A: Visible Worker WebGPU Target Proof

Goal: isolate and prove direct worker WebGPU target visibility.

Write set:

- `src/services/render/workerGpuTargetSurface.ts`
- `src/services/render/workerGpuDevice.ts`
- `tests/unit/workerGpuTargetSurface.test.ts`
- optional narrow edits to `src/services/render/workerRenderHostGpuPresenter.ts`
  only if the new module is extracted from it

Forbidden files:

- `src/services/render/workerPresentingRenderHostPort.ts`
- `src/services/render/workerRenderHostRuntimeHandlers.ts`
- `src/services/render/workerRenderHostRuntimeCommands.ts`
- software preview modules

Checks:

- `npx vitest run tests/unit/workerGpuTargetSurface.test.ts`
- `npx tsc -b`

Stop conditions:

- Needs runtime command integration.
- Needs host/bridge integration.
- Direct worker WebGPU clear cannot be proven in unit tests alone.

Report:

- Whether the module can configure a WebGPU canvas context.
- What runtime command integration is needed next.
- Any browser/platform assumptions discovered.

#### Agent WG-B: GPU Runtime Command Contracts

Goal: define cloneable GPU-only DTOs without software-frame payloads.

Write set:

- `src/services/render/workerGpuRuntimeCommands.ts`
- `src/services/render/workerGpuRenderGraph.ts`
- `tests/unit/workerGpuRuntimeCommands.test.ts`

Forbidden files:

- runtime handlers
- runtime bridge
- render host
- worker software modules

Checks:

- `npx vitest run tests/unit/workerGpuRuntimeCommands.test.ts`
- `npx tsc -b`

Stop conditions:

- Any DTO wants a DOM/GPU/runtime handle.
- Any test needs existing runtime-handler integration.

Report:

- Command list.
- Transferable policy.
- Forbidden-handle scan result.

#### Agent WG-C: GPU Texture Registry

Goal: build worker-owned GPU texture lifetime accounting behind a final API.

Write set:

- `src/services/render/workerGpuTextureRegistry.ts`
- `tests/unit/workerGpuTextureRegistry.test.ts`

Forbidden files:

- runtime handlers
- provider modules outside the new registry tests
- existing software bitmap cache modules

Checks:

- `npx vitest run tests/unit/workerGpuTextureRegistry.test.ts`
- `npx tsc -b`

Stop conditions:

- Requires real `GPUTexture` construction in jsdom.
- Requires provider or compositor integration.

Report:

- API shape.
- Ownership/ref-count rules.
- Counters exposed for stats.

#### Agent WG-D: Worker GPU Frame Provider Contracts

Goal: define provider request/response/lifetime contracts for normal playback.

Write set:

- `src/services/render/workerGpuFrameProviders.ts`
- `tests/unit/workerGpuFrameProviders.test.ts`

Forbidden files:

- `workerRenderHostRuntimeWebCodecs.ts`
- layer builder modules
- media runtime modules
- render host hub files

Checks:

- `npx vitest run tests/unit/workerGpuFrameProviders.test.ts`
- `npx tsc -b`

Stop conditions:

- Needs source-specific implementation.
- Needs WebCodecs/native/proxy integration.

Report:

- Provider states.
- Request modes.
- Lifetime counters.
- How normal forward playback differs from reverse/faster playback.

#### Agent WG-E: GPU Stats And Trace Schema

Goal: prepare observability fields for GPU-only frames without changing
behavior.

Write set:

- `src/services/aiTools/workerFirstCounterSources.ts`
- `src/services/playbackDebugStats.ts`
- `src/types/engineStats.ts`
- focused tests under `tests/unit/*Stats*.test.ts` and
  `tests/unit/workerFirstCounterSources.test.ts`

Forbidden files:

- render host runtime integration
- GPU implementation modules owned by other agents

Checks:

- `npx vitest run tests/unit/workerFirstCounterSources.test.ts tests/unit/playbackDebugStats.test.ts tests/unit/aiToolStats.test.ts`
- `npx tsc -b`

Stop conditions:

- Requires runtime GPU commands to generate real events.

Report:

- New path labels.
- New counters.
- Backward compatibility with existing worker-only/software stats.

#### Agent WG-F: Guardrail Tests And Static Scans

Goal: make it hard to reintroduce CPU/software fallback into
`worker-gpu-only`.

Write set:

- `tests/unit/workerGpuOnlyGuardrails.test.ts`
- optional updates to existing render guard tests

Forbidden files:

- product source except test-only helpers

Checks:

- `npx vitest run tests/unit/workerGpuOnlyGuardrails.test.ts`
- targeted `rg` scans encoded in the test or report

Stop conditions:

- A guard requires source refactoring outside tests.

Report:

- Guard list.
- Any current violations.
- Suggested integration packet if a violation needs source edits.

### Wave 1: Serialized Runtime Integration

Run after Wave 0 reports are reviewed. One lead agent or one worker at a time
touches hub files.

Packet WG-I1: register GPU commands in runtime handlers.

Write set:

- `src/services/render/workerRenderHostRuntimeCommands.ts`
- `src/services/render/workerRenderHostRuntimeHandlers.ts`
- `src/services/render/workerRenderHostRuntimeBridge.ts`
- `src/workers/runtimeHost.worker.ts` only if handler registration changes
- focused runtime tests

Consumes:

- WG-A target surface module
- WG-B command contracts
- WG-F guardrails

Exit:

- Runtime can execute GPU clear/test command.
- `presentSoftwareFrame` remains rejected for `worker-webgpu-present`.

Packet WG-I2: host/bridge visible GPU proof.

Write set:

- `src/services/render/workerPresentingRenderHostPort.ts`
- `src/services/aiTools/handlers/renderHost.ts` only if bridge needs a helper
- focused host/AI tests

Consumes:

- WG-I1 runtime command support
- WG-E stats schema

Exit:

- Bridge can set `worker-gpu-only`, reload, wait 5 seconds, trigger a worker
  GPU test pattern, and capture a visible non-black frame.

### Wave 2: Parallel Source And GPU Feature Buildout

Run only after WG-I2 proves visible worker WebGPU target presentation.

Parallel candidates:

- Provider implementation worker:
  - owns `workerRenderHostRuntimeWebCodecs.ts` or a new
    `workerGpuWebCodecsFrameProvider.ts`
  - implements normal forward frame delivery for Comp 2
- Texture import worker:
  - owns `workerGpuVideoFrameImporter.ts`
  - consumes the texture registry API
- Compositor worker:
  - owns `workerGpuCompositor.ts` and shader tests
  - renders solid/video quads from mocked textures
- Scheduler worker:
  - owns `workerGpuPassScheduler.ts`
  - implements latest-wins playback deadlines
- Stats worker:
  - owns AI trace extraction updates and tests

Serialized integration after Wave 2:

- connect provider frames to texture import
- connect texture import to compositor
- connect compositor to runtime render command
- connect runtime presented-frame events to host stats

### Wave 3: Feature Parity Lanes

After Comp 2 is visibly rendering through GPU-only, feature parity can split by
domain:

- WGSL color/effect lane
- transition/mask lane
- text/image/source texture lane
- nested composition lane
- RAM/cache/readback/export lane
- platform proof lane

Each lane must keep the same rule: GPU-only either renders through worker GPU
or emits a named blocker. It must not add a CPU fallback.

### Worker Packet Template

Use this exact template for each parallel worker prompt:

```text
You are a Codex worker for MasterSelects.
Read AGENTS.md first and follow it.
You are not alone in this worktree. Treat unrelated changes as someone else's
active work. Do not revert, clean, reformat, or overwrite unrelated changes.
Do not commit, push, or merge.

Plan:
- docs/ongoing/Worker-WebGPU-Playback-Presentation.md
- docs/ongoing/Worker-First-Playback-Renderer.md

Packet:
Goal:
Write set:
Forbidden files:
Inputs:
Expected API/contract:
Do not:
- Do not introduce CPU/2D/software fallback in worker-gpu-only.
- Do not use WorkerRenderSoftwareFrame as a GPU command payload.
- Do not add DOM/runtime handles to cloneable DTOs.
Checks:
Stop conditions:
Report:
- files read
- files changed
- contracts added or consumed
- checks run
- blockers
- next integration need
```

## Packet Ownership

High-conflict files should be serialized:

- `src/services/render/renderHostPort.ts`
- `src/services/render/workerPresentingRenderHostPort.ts`
- `src/services/render/workerRenderHostRuntimeHandlers.ts`
- `src/services/render/workerRenderHostRuntimeCommands.ts`
- `src/services/render/workerRenderHostRuntimeBridge.ts`
- `src/workers/runtimeHost.worker.ts`

Parallel-friendly new modules:

- GPU target/device/surface modules.
- Texture registry tests.
- Provider state machine tests.
- GPU graph DTO tests.
- WGSL/effect modules after contracts land.
- AI bridge/stat extraction tests.

## Open Decisions

- Resolved locally on Windows/Chromium: direct worker WebGPU OffscreenCanvas
  presentation is visible after the runtime sends a worker GPU test-pattern
  command and the host gates early presents until `attachTargetSurface`
  succeeds. This was a missing runtime/host command path, not a proven browser
  platform limitation.
- Should the first normal playback provider use Worker WebCodecs for all
  eligible videos, or should native-helper/proxy frames be promoted at the same
  time for unsupported containers?
- Should text be rasterized in a worker-local canvas then imported as a GPU
  texture, or should the first text path use an atlas/SDF pipeline?
- How much of the current worker software effect parity should be ported to
  WGSL before declaring Comp 2 video playback healthy? The recommended answer:
  Comp 2 only needs video + transforms; full parity is a separate gate.
- Should GPU readback use a persistent staging buffer pool immediately or start
  with a simple per-readback buffer behind the final `workerGpuReadback.ts`
  API?

## Success Definition

The first useful success is:

- Comp 2, 60 FPS, one real video clip.
- `worker-gpu-only`.
- Reload plus 5s wait.
- Playback from 0 for 20 seconds.
- Visible, non-black preview from `workerRenderHost:preview`.
- `previewPathCounts` contains worker GPU frames.
- `presentationAttempts` for software frames stays `0`.
- `lastSoftwareFrame` stays `null`.
- Main fallback stays inactive.
- No unbounded queue growth, no stale response storm, and truthful drop stats.

The full success is:

- Playback, scrub, RAM preview, nested comps, effects, transitions, output
  slices, capture/proofs, and export all use the same worker GPU graph and
  provider/texture ownership model.
- Unsupported features are explicit GPU blockers, not fallback routes.
- `worker-only` software can remain as a historical comparison mode while it is
  still useful, but the product worker GPU path does not depend on it.
