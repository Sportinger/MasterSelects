# Playback-Debugging.md — audit 2026-08-02

## Verified (spot checks that held)

- The browser globals in the document exist: `__WC_PIPELINE__` and `__VF_PIPELINE__` expose event, seek, stall, stats, reset, and timeline inspection in `src/services/wcPipelineMonitor.ts` and `src/services/vfPipelineMonitor.ts`; `__PLAYBACK_HEALTH__` exposes snapshots, anomalies, video state, and recovery in `src/services/playbackHealthMonitor.ts`.
- `window.Logger` is installed by `src/services/logger.ts`; the documented `enable`, `setLevel`, `search`, `errors`, `dump`, and `summary` methods exist there. The named playback modules are created in `src/engine/webCodecsPlayer/playerBase.ts`, `src/services/playbackHealthMonitor.ts`, `src/engine/render/LayerCollector.ts`, `src/engine/parallelDecode/frameAccess.ts`, and `src/engine/render/RenderLoop.ts`.
- The listed bridge tools are implemented or registered: telemetry tools in `src/services/aiTools/definitions/stats.ts` and `src/services/aiTools/handlers/stats.ts`; playback simulations in `src/services/aiTools/definitions/playback.ts` and `src/services/aiTools/handlers/playback/simulate.ts`; clip lookup in `src/services/aiTools/definitions/clips.ts` and `src/services/aiTools/handlers/timelineHandlerRegistry.ts`; app reload in `src/services/aiTools/handlers/index.ts`.
- The high-signal playback fields and anomaly names are current: `stalePreviewWhileTargetMoved`, `previewFreezeEvents`, and `decoderResets` are assembled in `src/services/playbackDebug/assembly.ts`; startup `firstPreviewUpdateMs` in `src/services/playbackDebug/runDiagnostics.ts`; health anomalies in `src/services/playbackHealthMonitor.ts` and `src/services/playbackHealth/contracts.ts`.
- Audio diagnostic paths and fields hold: `src/services/audio/audioDiagnostics.ts` produces buffered-ahead and correction summaries, and `src/services/audio/routing/debugSnapshots.ts` supplies `routing.context.baseLatencyMs`.
- The source-FPS guidance matches `src/services/aiTools/handlers/stats.ts`, which resolves `visualTargetFps` from render-target and active-composition frame rates, and `src/services/aiTools/handlers/framePacing.ts`, which samples media/frame and render-loop cadence.

## Outdated or wrong (claim → reality, with file evidence)

- Source map says the five monitoring modules are under `src/services/monitoring/` → that directory/path no longer exists. The current files are `src/services/playbackHealthMonitor.ts`, `src/services/playbackDebugStats.ts`, `src/services/framePhaseMonitor.ts`, `src/services/wcPipelineMonitor.ts`, and `src/services/vfPipelineMonitor.ts`.
- `previewPathCounts.empty` → current renderers emit path labels including `empty-hold`, `paused-empty-hold`, and `target-empty-hold`, not a documented `empty` label. Evidence: `src/engine/render/RenderDispatcher.ts` and `src/engine/render/dispatcher/targetPreviewRenderer.ts`; `src/services/playbackDebug/collectors.ts` records the exact label.
- “On Firefox, expect copied-texture fallback instead of imported external textures.” → no Firefox-specific playback branch was found in current `src/`. `src/engine/texture/TextureManager.ts` attempts `device.importExternalTexture()` for valid HTML video or `VideoFrame` input and returns `null` on failure; copied textures are used elsewhere for image/canvas/frame uploads, not as a Firefox-specific documented fallback.
- “When the dev bridge or Native Helper bridge is available” → the native helper capability is conditional. `src/services/nativeHelper/protocol.ts` exposes optional `SystemInfo.ai_bridge` and `editor_connected`; it is not an unconditional native-helper bridge.

## Noteworthy / unusual

- `__FRAME_PHASES__` is a shipped console surface omitted by the document; `src/services/framePhaseMonitor.ts` exposes `timeline`, `summary`, and `reset`.
- `purgePlaybackPath`, `samplePlaybackFramePacing`, and `getRuntimeDiagnostics` are relevant shipped diagnostic tools omitted by the document; their schemas are in `src/services/aiTools/definitions/stats.ts` and handlers in `src/services/aiTools/handlers/stats.ts` / `framePacing.ts`.
- Full WebCodecs playback remains default-off in `src/engine/featureFlags.ts`, but `src/stores/settingsStore.ts` persists the user toggle and synchronizes both `useFullWebCodecsPlayback` and `disableHtmlPreviewFallback` on rehydration.
- Decoder naming has expanded beyond the document’s two-path framing: `src/types/engineStats.ts` lists full WebCodecs, HTML video/VF and several cache variants, Native Helper, ParallelDecode, and `none` in `EngineStats.decoder`.
- `reloadApp` has a handler and policy entry (`src/services/aiTools/handlers/index.ts`, `src/services/aiTools/policy/registry.ts`) but no matching schema was found under `src/services/aiTools/definitions/`, unlike the other listed tools.
- Historical documents still reference the removed `src/services/monitoring/` directory, including `docs/completed/research/pandino-scr-evaluation-starter.md`; those references were not changed because they are outside this audit’s permitted files.
