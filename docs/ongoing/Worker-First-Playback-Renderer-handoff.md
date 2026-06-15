# Worker-First Playback Renderer Handoff

Status: DRAFT - no source implementation started
Updated: 2026-06-15

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
- First source work has not started.

## Next Eligible Codex Packets

These can run in parallel if the Codex orchestrator gives each worker a fresh
packet prompt and enforces disjoint write sets:

- Packet A/B: target correctness.
- Packet F: proof harness baseline.
- Packet G: platform capability probe.
- Packet H: graph DTO contracts.
- Packet D/E: scheduler/cache skeleton.
- Packet I: provider policy contracts.

Do not start `RenderHostPort` integration until Packet A/B and basic telemetry
are done. Do not start worker WebGPU until W0-W4 gates are explicit enough to
prove behavior and presentation.

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

- Gate matrix still needs exact test/static-check command names.
- No active packet has been assigned.
- Platform capability probe is not implemented.
- Golden manifests and visible-pixel proof path are not implemented.

## Last Meaningful Checks

- Docs were edited only.
- No source checks were run for this docs-only planning update.

