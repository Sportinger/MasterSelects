# Worker-First Playback Renderer Checklist

Status: DRAFT - active companion checklist for
`Worker-First-Playback-Renderer.md`
Updated: 2026-06-15

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
- [x] First practical slice listed as packets A-I.
- [ ] Gate matrix converted into exact test/static-check command names.
- [ ] First implementation packet assigned.
- [ ] Source implementation started.

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
  - [ ] golden project manifests defined
  - [ ] golden sample times defined
  - [ ] frame fingerprint capture path defined
  - [ ] DOM-visible capture path defined
- [ ] `W0_PLATFORM_MATRIX_DEFINED`
  - [x] Windows Chromium target listed
  - [x] Linux Chromium/Mesa target listed
  - [x] Linux Firefox/Mesa target listed
  - [x] macOS Safari target listed
  - [x] macOS Firefox target listed
  - [ ] capability probe command/test names defined
- [ ] `W0_OBSERVABILITY_SURFACE_DEFINED`
  - [ ] `getStats` fields listed with exact owner
  - [ ] `getPlaybackTrace` fields listed with exact owner
  - [ ] queue/deadline/backpressure counters listed
  - [ ] provider lifetime counters listed
  - [ ] visible-pixel/nonblank counters listed

Do not:

- [ ] Do not move WebGPU to a worker in W0.
- [ ] Do not migrate `LayerBuilderService` in W0.
- [ ] Do not treat GPU readback as presentation proof.

Exit:

- [ ] A Codex worker can implement proof/platform probes from explicit gates and
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

- [ ] `W1_RENDER_COMMANDS_CLONE_SAFE`
  - [ ] `RenderCommand` DTOs contain no stores, React, DOM media elements, GPU
        handles, runtime handles, functions, `Map`, `Set`, or legacy `Layer[]`
  - [ ] structured-clone tests exist
  - [ ] JSON round-trip tests exist where appropriate
- [ ] `W1_GRAPH_CONTRACTS_DEFINED`
  - [ ] `ProjectRenderGraph` contract exists
  - [ ] `CompositionRenderGraph` contract exists
  - [ ] `RenderGraphDelta` contract exists
  - [ ] source/provider references are data-only
- [ ] `W1_PROVIDER_CONTRACTS_DEFINED`
  - [ ] provider request/response DTOs exist
  - [ ] provider states and substatus exist
  - [ ] frame ownership token model exists

Do not:

- [ ] Do not retrofit the current closure-based `RenderFrameSnapshot` as the
      worker payload.
- [ ] Do not introduce broad `types.ts` dumps.

Exit:

- [ ] Contract tests pass and behavior remains unchanged.

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

- [ ] `W2_CACHED_FRAME_TARGET_ROUTING`
  - [ ] cached frames route to active target canvases without legacy
        `previewContext`
  - [ ] dock preview and mobile preview present cached frames
- [ ] `W2_TARGET_REGISTRATION_STABLE`
  - [ ] transparency toggles update target state in place
  - [ ] playback, scrub, and composite caches are not cleared by cosmetic target
        updates
- [ ] `W2_RENDER_HOST_BOUNDARY`
  - [ ] UI direct engine calls are listed
  - [ ] host facade owns stats and render-loop watchdog plan
  - [ ] renderer mode telemetry includes `main`

Exit:

- [ ] Existing renderer behavior is unchanged, but UI ownership is ready to move
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

- [ ] `W3_RENDER_JOB_SCHEDULER_DEFINED`
  - [ ] live playback job type exists
  - [ ] scrub job type exists
  - [ ] independent preview job type exists
  - [ ] RAM preview, bake, export, and thumbnail job types exist
  - [ ] priority, cancellation, coalescing, and queue-drain tests exist
- [ ] `W3_RENDER_CACHE_REGISTRY_DEFINED`
  - [ ] cache owners listed
  - [ ] key, memory estimate, invalidation source, and release path exist
  - [ ] allocation/reuse/eviction/leak counters exist

Exit:

- [ ] Scheduler/cache contracts are testable without moving WebGPU.

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

- [ ] `W4_PROVIDER_STATE_MACHINE_DEFINED`
  - [ ] source/session scoped states exist
  - [ ] request id, generation, deadline, priority, and mode exist
  - [ ] exact/nearest/hold/prewarm policies are defined
- [ ] `W4_FRAME_LIFETIME_OWNERSHIP_DEFINED`
  - [ ] borrowed/owned/transferred states exist
  - [ ] release token path exists
  - [ ] created/cloned/transferred/imported/cached/released/closed/leaked
        counters exist

Exit:

- [ ] Provider policy can wrap existing behavior before render migration.

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
  - [ ] golden fingerprints match within tolerance
  - [ ] queue depth stays bounded
  - [ ] frame/provider outstanding count returns to zero
- [ ] `W5_VISIBLE_PRESENTATION_PROVEN`
  - [ ] DOM-visible captures are nonblank
  - [ ] no stale visible frames under playback stress
  - [ ] Windows Chromium, Linux Chromium/Mesa, Linux Firefox/Mesa, macOS Safari,
        and macOS Firefox pass with selected presentation strategy

Exit:

- [ ] Worker-presenting mode is allowed only for platforms whose strategy gates
      are green.

## First Queued Codex Packets

- [ ] Packet A/B: target correctness.
- [ ] Packet F: proof harness baseline.
- [ ] Packet G: platform capability probe.
- [ ] Packet H: graph DTO contracts.
- [ ] Packet D/E: scheduler/cache skeleton.
- [ ] Packet I: provider policy contracts.

## Active Packet

None.

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
- [ ] Firefox worker WebGPU/presentation strategy is unproven.
- [ ] Linux/Mesa visible presentation remains a required real-hardware gate.

Test migration:

- [ ] Existing preview/export/RAM/thumbnail tests need classification before
      render graph migration.
