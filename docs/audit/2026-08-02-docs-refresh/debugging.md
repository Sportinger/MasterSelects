# Debugging.md — audit 2026-08-02

## Verified (spot checks that held)

- `src/services/logger.ts` exports `Logger`, installs `window.Logger`, defaults to `WARN`, uses a 500-entry buffer, exposes the documented console methods, and auto-starts `window.LogSync` every two seconds only in Vite development mode.
- Logger warnings and errors are buffered even when filtered from console output; error objects are redacted and retain a redacted stack. Evidence: `src/services/logger.ts`.
- The redacted `/api/logs` sync and its no-token `navigator.sendBeacon` fallback are implemented in `src/services/logger.ts`; the endpoint is installed by `tools/devBridge/supportEndpoints.ts` through `tools/devBridge/vitePlugin.ts`.
- `/api/ai-tools`, unauthenticated bridge-status `GET`, authenticated `/auth-check`, `_list`, `_status`, HMR tab targeting, and `.ai-bridge-token` support are implemented in `tools/devBridge/vitePlugin.ts`, `src/services/aiTools/devBridge/browser/client.ts`, and `scripts/run-worker-first-platform-evidence.mjs`.
- `debugExport` is an implemented dev-bridge/console/internal handler. It uses `FrameExporter`, applies `maxRuntimeMs` cancellation, and returns blob, progress, settings, engine, export-host, and recent-error diagnostics. Evidence: `src/services/aiTools/handlers/export.ts`, `src/services/aiTools/policy/registry.ts`.
- The three documented playback globals and the listed playback tools exist. Evidence: `src/services/wcPipelineMonitor.ts`, `src/services/vfPipelineMonitor.ts`, `src/services/playbackHealthMonitor.ts`, `src/services/aiTools/definitions/stats.ts`, and `src/services/aiTools/handlers/stats.ts`.
- Playback warmup state and the `Preparing playback` preview overlay are implemented. Evidence: `src/stores/timeline/playbackSlice.ts`, `src/stores/timeline/playbackWarmup.ts`, `src/components/preview/usePreviewPlaybackDisplay.ts`, and `src/components/preview/PreviewStatusOverlays.tsx`.
- The documented logger module examples mostly resolve to live `Logger.create(...)` users, including `WebGPUEngine`, `FFmpegBridge`, `AudioEncoder`, `ProjectCore`, `Timeline`, `Toolbar`, `PerformanceMonitor`, and `History`. Evidence: the matching files under `src/engine/`, `src/services/`, `src/stores/`, `src/hooks/`, and `src/components/common/`.

## Outdated or wrong (claim → reality, with file evidence)

- `window.aiTools.execute/list/status` → no `window.aiTools` assignment exists in the repository. The browser client receives HMR messages and calls `executeAITool(..., 'devBridge', ...)` directly; `_list` and `_status` are HMR bridge meta-tools. Evidence: `src/services/aiTools/devBridge/browser/client.ts`, `src/services/aiTools/bridge.ts`, `src/editorBoot.ts`.
- “Automatic capture for errors” → stacks are captured when the logged value is an `Error`; a plain `log.error(message)` has no automatic stack. Evidence: `ModuleLogger.createEntry` in `src/services/logger.ts`.
- The playback AI-tool list omitted shipped runtime-debug tools → `getRuntimeDiagnostics`, `clearRuntimeDiagnostics`, and `samplePlaybackFramePacing` are exported tool definitions and handlers. Evidence: `src/services/aiTools/definitions/stats.ts`, `src/services/aiTools/handlers/index.ts`.
- The source footer omitted the dev bridge and runtime-diagnostics implementation → the active files are `src/services/aiTools/bridge.ts`, `tools/devBridge/vitePlugin.ts`, and `src/services/runtimeDiagnostics.ts`.

## Noteworthy / unusual

- Runtime diagnostics are separate from `Logger`: they wrap browser console methods, retain up to 2,000 redacted entries, and additionally capture window errors, unhandled rejections, WebGPU uncaptured errors, and device-loss events. Evidence: `src/services/runtimeDiagnostics.ts`.
- `window.LogSync` is exposed whenever `window` exists, but automatic syncing starts only under `import.meta.env.DEV`; this distinction is easy to miss when using the global manually. Evidence: `src/services/logger.ts`.
- The bridge has additional debug-state and debug-action endpoints (`/api/debug/state`, `/api/debug/preview-state`, `/api/debug/slot-state`, `/api/debug/action`) that the feature doc does not cover. Evidence: `tools/devBridge/vitePlugin.ts`, `src/services/aiTools/devBridge/browser/debugState.ts`.
- The repository worktree contains extensive unrelated edits; this audit did not alter them. Only this findings file and `docs/Features/Debugging.md` were changed.
