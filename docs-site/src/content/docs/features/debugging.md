---
title: "Debugging & Logging"
---

[← Back to Index](/features/readme/)


MasterSelects includes a Logger service plus several playback and health monitors that are surfaced both in the browser console and through the AI bridge.

## Overview

The Logger service (`src/services/logger.ts`) provides:

| Feature | Description |
|---------|-------------|
| Log levels | `DEBUG`, `INFO`, `WARN`, `ERROR` with level filtering |
| Module filtering | Enable debug logs for specific modules only |
| In-memory buffer | 500 entries stored for inspection |
| Global access | `window.Logger` in the browser console |
| AI-agent support | Structured summaries for tool inspection |
| Timestamps | Timestamp prefixes enabled by default |
| Stack traces | Captured when an error object is logged |
| Log sync | Development log sync through `window.LogSync` |

Default log level: `WARN`. Errors are always shown and always buffered. `WARN` and `ERROR` entries are buffered even when they are not displayed.

---

## Console Commands

All commands are available via `window.Logger` or just `Logger` in the browser console.

### Enable / Disable Debug Logs

```javascript
Logger.enable('WebGPU,FFmpeg,Export')
Logger.enable('*')
Logger.disable()
```

### Set Log Level

```javascript
Logger.setLevel('DEBUG')
Logger.setLevel('INFO')
Logger.setLevel('WARN')
Logger.setLevel('ERROR')
```

### Inspect Logs

```javascript
Logger.getBuffer()
Logger.getBuffer('ERROR')
Logger.getBuffer('WARN')
Logger.search('device')
Logger.errors()
Logger.dump(50)
Logger.summary()
Logger.export()
```

### Status & Configuration

```javascript
Logger.status()
Logger.modules()
Logger.clear()
Logger.setTimestamps(false)
```

---

## Log Sync

In development mode the browser automatically syncs redacted log summaries to the dev server every 2 seconds.

`window.LogSync` exposes:

```javascript
LogSync.status()   // 'running' or 'stopped'
LogSync.stop()
LogSync.start()
LogSync.flush()
```

If the dev bridge token is not present, the browser falls back to `sendBeacon` for the local `/api/logs` endpoint. The payload is still redacted before it leaves the page.

---

## AI Tool Debug Surface

In development, the HMR-backed browser client registers the dev HTTP bridge. It dispatches through the shared AI-tool registry with the `devBridge` caller context:

```text
POST /api/ai-tools
```

It supports the `_list` and `_status` meta-commands, plus targeted execution against a connected browser tab through the HMR bridge.

For bridge preflight, `GET /api/ai-tools` reports connected browser tabs without auth, while `GET /api/ai-tools/auth-check` validates the bearer token without dispatching a browser tool. This catches stale `.ai-bridge-token` files when multiple dev servers are running.

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools/auth-check' -Method Get -Headers $headers
```

The worker-first platform-evidence helper wraps these checks:

```powershell
npm run worker-first:platform:doctor -- --latest-per-platform
npm run worker-first:platform:status -- --latest-per-platform
npm run worker-first:platform:macos-runbook
```

`doctor` prints matrix status, platform proof summaries, bridge tab status,
fresh/stale tab counts, and `Bridge auth: ok` or the token error. `collect`
first waits for a fresh dev-bridge target tab to register
(`lastSeenAgoMs <= 10000` and not unresponsive), then waits `--wait-ms` again
after target-tab selection before dispatching the proof tool; the default is
5000ms. If doctor reports `Fresh tabs: 0/...`, foreground or reload the target
browser tab before collecting. Collection reports include readiness metadata
(`targetPollCount`, `targetWaitedMs`, selected tab before/after settle, and
actual settle wait) so a package can be audited for the required post-load wait.
`status`, `verify`, and `doctor` read matching companion `*.report.json` files
when present and print a non-blocking readiness audit (`missing report`,
`legacy report`, or `invalid`). Failed `collect` payloads are written as
`*.failed.json`, never `*.package.json`, so incomplete runs cannot displace the
latest valid per-platform package. `macos-runbook` prints the exact real-Mac
Safari/Firefox collection commands for the remaining platform packages; it is
not synthetic platform evidence.

### Export Debug Via Bridge

Use `debugExport` when the UI export fails or appears stuck and the dev server plus browser tab are already running. It is a dev-bridge-only handler, not a public chat tool.

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

$body = @{
  tool = 'debugExport'
  args = @{
    startTime = 0
    durationSeconds = 1.0
    width = 640
    height = 360
    fps = 15
    includeAudio = $false
    exportMode = 'fast'
    download = $false
    maxRuntimeMs = 25000
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

For the current timeline and export defaults:

```powershell
$body = @{ tool = 'debugExport'; args = @{ includeAudio = $true; exportMode = 'fast'; download = $false } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

The result includes blob size/type, progress samples, settings, engine state before/after export, and recent export/GPU warnings or errors. `maxRuntimeMs` cancels the export cleanly before the dev-bridge request appears hung. A blob with `size > 0` proves the browser `FrameExporter` path can render and encode. If the UI still fails afterward, inspect `ExportPanel`, preset state, progress state, and download handling.

If logs show `WebGPU device lost during export` and `getStats` reports `renderLoop.isRunning=false`, `renderDispatcher=null`, or `targetCanvasCount=0`, the browser engine is in a stale device state. Use `reloadApp` or hard-reload the tab before retesting. Windows `powerPreference` warnings and NativeHelper WebSocket failures are not automatically export blockers.

### Full-App Screenshots And UI Probes

For a visual UI failure, select the intended browser session explicitly and call `captureAppScreenshot` on the `devBridge` surface. The default captures the visible app viewport; `fullPage: true` captures the complete scrolling document. Output scaling is reduced automatically when needed to stay within bridge-safe image dimensions. The result is returned as MCP image content and its base64 payload is omitted from durable traces.

Use `clickAppControl` to reproduce a visible button, link, disclosure, or other specific control without switching to a separate browser automation stack. Use `probeSameOriginRequest` to inspect a failing local `/api/` call from the authenticated tab; it returns selected headers and a bounded redacted body instead of exposing cookies or unrestricted URLs. All three tools are development-only and must be called with an explicit target session when multiple tabs are present.

---

## Monitoring Surfaces

The app exposes several runtime monitors that feed the AI debug tools and the console:

| Surface | What it exposes |
|---------|-----------------|
| `window.__WC_PIPELINE__` | WebCodecs ring-buffer events, stalls, seeks, timeline views, and aggregate stats |
| `window.__VF_PIPELINE__` | HTMLVideo / VideoFrame ring-buffer events, audio timelines, stall context, and aggregate stats |
| `window.__PLAYBACK_HEALTH__` | Health snapshot, anomaly list, active video states, and recovery helpers |

The playback-related AI tools read from the same sources:
- `getStats`
- `getStatsHistory`
- `getAudioDiagnostics`
- `getLogs`
- `getRuntimeDiagnostics`
- `clearRuntimeDiagnostics`
- `getPlaybackTrace`
- `purgePlaybackPath`
- `samplePlaybackFramePacing`

Those tools surface:
- Engine state and readiness
- Timing breakdowns
- Decoder and drop information
- Playback health and anomaly data
- Cache and slot-deck stats
- Render loop and render dispatcher state
- WebCodecs / VF pipeline event windows
- Audio media element ready/buffer state, Web Audio context latency, routing graph state, and recent audio drift/correction events
- Captured console output, window errors, unhandled rejections, WebGPU uncaptured errors, and device-lost events

`purgePlaybackPath` resets the live playback path at the current playhead without a page reload. It clears VideoSync warmups/seeks, retargets active HTMLVideo/WebCodecs providers, resets GPU-ready state, and can resume playback automatically. The health monitor can invoke the same path when `vf_preview_frame` telemetry shows the playhead target moving while the preview frame remains frozen.

When playback start has to wait for active HTML video readiness, `TimelineState.playbackWarmup` is set until the readiness gate finishes or is canceled. A settled current frame (`HAVE_CURRENT_DATA`, not seeking) starts immediately after a hop or scrub. A last presented frame within 350 ms of the exact mapped source target is also reusable, so playback can start while the decoder catches up behind the active layer's frame hold. The gate and its small `Preparing playback` overlay remain for genuinely cold targets where no reusable frame exists; background VideoSync warmups during normal playback do not look like blocking loading states.

HTML playback stop keeps a decoded frame within 50 ms of the playhead and aligns the playhead to that presented frame instead of issuing another precision seek. Larger lag still settles exactly; the tolerance prevents rapid play/pause cycles from creating a seek queue that makes later starts cold.

`getAudioDiagnostics` is the focused bridge tool for audio crackle/dropout debugging. Capture it during audible playback to inspect `mediaSummary`, per-element `buffered.bufferedAheadSeconds`, `routing.context.baseLatencyMs`, `status.drift`, and `events.correctionMs`.

`getStatsHistory` is capped to 1-30 samples, `getAudioDiagnostics` caps the inspected event window and returned event count, `getLogs` caps the returned buffer to 1-500 entries, `getRuntimeDiagnostics` caps returned entries to 1-1000, and `getPlaybackTrace` caps the inspected time window and event count so the bridge stays responsive.

`getRuntimeDiagnostics` reads the browser runtime-diagnostics buffer. Use `clearRuntimeDiagnostics` before a reproducible dev-bridge run; the buffer records console calls, window errors, unhandled rejections, and WebGPU errors/device-loss events.

---

## Usage in Code

```typescript
import { Logger } from '@/services/logger';

const log = Logger.create('MyModule');

log.debug('Verbose debugging info', { data });
log.info('Important event');
log.warn('Warning message', data);
log.error('Error occurred', error);
```

### Timing Helper

```typescript
const log = Logger.create('Export');
const done = log.time('Encoding video');
// ...
done();
```

### Grouped Logs

```typescript
const log = Logger.create('Compositor');

log.group('Rendering frame 42', () => {
  log.debug('Collecting layers');
  log.debug('Applying effects');
  log.debug('Compositing');
});
```

---

## Module Naming Convention

Modules are named after their file or class:

| File | Module Name |
|------|-------------|
| `WebGPUEngine.ts` | `WebGPUEngine` |
| `FFmpegBridge.ts` | `FFmpegBridge` |
| `AudioEncoder.ts` | `AudioEncoder` |
| `ProjectCoreService.ts` | `ProjectCore` |
| `Timeline.tsx` | `Timeline` |
| `Toolbar.tsx` | `Toolbar` |
| `PerformanceMonitor.ts` | `PerformanceMonitor` |
| `useGlobalHistory.ts` | `History` |

### Common Module Groups

```javascript
Logger.enable('WebGPU,Compositor,RenderLoop,TextureManager')
Logger.enable('Export,FrameExporter,VideoEncoder,AudioEncoder,FFmpeg')
Logger.enable('Audio,AudioMixer,AudioEncoder,TimeStretch')
Logger.enable('Project,ProjectCore,FileStorage')
Logger.enable('Timeline,Clip,Track,Keyframe')
```

---

## AI-Agent Inspection

The Logger is designed to help AI code assistants understand what is happening in the application.

### Summary for AI

```javascript
const summary = Logger.summary();
// {
//   totalLogs: 234,
//   errorCount: 2,
//   warnCount: 5,
//   recentErrors: [...],
//   activeModules: ['WebGPUEngine', 'Export', 'FFmpegBridge']
// }
```

### Search for Issues

```javascript
Logger.search('device lost')
Logger.search('encode failed')
Logger.search('permission denied')
```

### Export for Analysis

```javascript
const logData = Logger.export();
// Includes config, registered modules, and the buffered logs
```

---

## Playback Debugging

The most useful browser-console globals for playback issues are:

- `window.__WC_PIPELINE__`
- `window.__VF_PIPELINE__`
- `window.__PLAYBACK_HEALTH__`

Useful log modules:

```javascript
Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')
Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')
Logger.setLevel('DEBUG')
```

The playback monitors feed the AI bridge stats tools, so `getStats` and `getPlaybackTrace` are the canonical way to capture a reproducible snapshot when the browser console alone is not enough.

---

## Pinned Windows quality campaigns

Internal campaign tooling in `scripts/windows-quality/` freezes the existing
eight-case Windows beta corpus, source inputs, reference media and environment
receipt before execution. Use the adapter README for provisioning and commands.
A campaign requires an explicit exclusive desktop grant and keeps original reports,
process records and artifact hashes after failure or interruption. A passing small
campaign does not establish full editor coverage or authorize a release.

The static feature inventory and its byte-provenance checks live under
`tests/windows-quality/inventory/`; only immutable inventory JSON descriptions
belong under `tests/playwright/campaigns/`. Historical CRLF-archive references and
exact-Git references remain separate. Validate each against its declared source
bytes, rather than normalizing a changed checkout to make a check pass.

The private execution ledger in `docs/ongoing/Adaptive-Quality-Execution.md` records
which checks actually ran and which native, deployment and recovery proofs remain
missing. Internal producer/receiver adapters reside in the separate Social service;
synthetic adapter reports never substitute for observed editor failures.

Complete Pages artifact checks additionally live in
`scripts/windows-quality/pages-artifact.mjs` and `qualify-pages-artifact.mjs`.
They bind frontend, compiled Functions, routes and private configuration inputs,
reject changes during staging, and require an independently retained seal hash.
Their package-byte result does not qualify browser behavior, production bindings,
authenticated API behavior or deployment/recovery. See the adapter README for
the explicit-path qualification command and filesystem regression controls.

## Log Entry Structure

Each log entry contains:

```typescript
{
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  module: string;
  message: string;
  data?: unknown;
  stack?: string;
}
```

---

*Source: `src/services/logger.ts`, `src/services/runtimeDiagnostics.ts`, `src/services/playbackDebugSnapshot.ts`, `src/services/playbackDebugStats.ts`, `src/services/playbackHealthMonitor.ts`, `src/services/wcPipelineMonitor.ts`, `src/services/vfPipelineMonitor.ts`, `src/services/aiTools/bridge.ts`, `src/services/aiTools/handlers/stats.ts`, `tools/devBridge/vitePlugin.ts`*

## Keyframe disclosure timing

Development `POST /api/debug/action` supports `measure-keyframe-disclosure` with an explicit top-level `targetTabId` and `args: { trackId, clipId?, profile? }`. Wait for project loading to finish and keep the editor visible. It optionally selects the clip, toggles the track twice, measures synchronous React commit time and the following two animation frames, and restores selection/disclosure. `paintedMs: null` means the paint deadline expired or the tab became hidden. The result includes selected IDs and diamond counts so empty/unloaded rows cannot be mistaken for a successful dense-row benchmark. Optional CPU sampling covers the initial selection; bridge transport and tool preview capture are excluded from reported times.


### Chunk-load recovery diagnostics

A failed dynamic import can request one reload, with a 60-second session cooldown.
The `vite:preloadError` event must retain its default behavior: cancelling it makes
Vite resolve the failed import as `undefined`, causing a secondary React lazy-module
error. Requesting navigation is not proof that navigation completed; an unsaved-project
warning may cancel it. Preserve the original rejection so diagnostics and callers
retain the actual module failure.

### Composition video-load failures

`CompositionRenderer` video-load errors include `mediaErrorCode` (1 aborted, 2 network, 3 decode, 4 unsupported source, or null), `readyState`, `networkState`, `fileSize`, and `mimeType`, captured before cleanup resets the media element. These fields distinguish browser-reported failure classes; code 4 alone does not prove an unsupported codec, and a decode failure does not prove a corrupt file. No source URL or raw browser error message is added. Older events without these fields cannot be classified retroactively.

### Cancelled clip analysis

An explicitly cancelled clip/face analysis restores its prior analysis state and does not emit `ClipAnalyzer: Analysis failed` when the pending runtime rejects. The cancellation request remains logged. A runtime failure without a cancellation request still sets the error state and produces the error diagnostic; matching an AbortError name alone does not suppress it.

### Expected WebGPU teardown

Device-loss diagnostics include `expected`. WebGPUContext marks devices immediately before intentional destruction during teardown or a power-preference change. Only a marked device reporting reason `destroyed` is recorded as INFO; unmarked destruction and all other loss reasons remain ERROR. The marker is held weakly in runtime diagnostics state and survives development module reloads. Historical records without the marker cannot establish whether a device was intentionally destroyed.

## Copying-sort startup compatibility

`main.tsx` loads `runtime/arrayCopySorting.ts` immediately after boot diagnostics and before the UI graph. It installs `Array.prototype.toSorted` only when unavailable, preserving native implementations and sorting a fresh dense array rather than mutating application state. This addresses the observed missing-method startup errors in Chrome 109 sessions; it does not supply missing GPU, storage or media APIs. The isolated-browser check removes the native method before navigation and verifies the editor shell renders without a `toSorted` error. Unit coverage includes frozen state, stable equal-key order, sparse arrays, array-like inputs, custom iterators/species and invalid arguments.

## Optional credential storage recovery

YouTube credential database initialization retries one `AbortError` before returning a failure. Security/access errors are not retried, and no credential write is replayed. Persistent open failure remains visible through the settings error log; a later load can try again. This handles transient database initialization, not browser storage denial or damaged ciphertext.

### Protecting edits during chunk recovery

Project auto-sync registers a lightweight veto for automatic chunk-error reloads while an open project is dirty or the workspace contains unsaved work before a project file exists. Projectless store edits survive repeated auto-sync setup and HMR; existing media, timeline clips and chat messages are also checked when no project is open. Hydration/save mirroring does not mark new edits. The boot module queries this without importing editor stores. A veto records `reload_deferred`, leaves the original import rejected, and consumes neither the reload flag nor the cooldown marker. Creating/saving a clean project allows subsequent recovery. Explicit project closure clears the transient edit marker. Teardown removes the guard. Manual navigation uses the same unsaved-work condition. No automatic save is started; this does not fix the failed network request or promise that a failed lazy component can retry without a later reload.

### TFLite initialization severity

The exact standalone `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` line is retained as INFO even when received on console.error. Original console method metadata remains available. The production reporter uploads ERROR entries, so this informational line no longer counts as a runtime failure. Extra arguments, Error objects and other INFO-prefixed console errors are not downgraded.

### Credential transaction lifetime

YouTube credential reads, writes and deletion wait for their IndexedDB transaction to finish and close the operation connection in a finally block. An aborted transaction is reported as failure even after its individual request succeeded. Encryption keys are read from durable storage for each operation rather than retained after a potentially failed write. First-use key selection uses one readwrite transaction: concurrent callers adopt the key already committed by another caller instead of overwriting it. No real credentials are included in diagnostic payloads.
