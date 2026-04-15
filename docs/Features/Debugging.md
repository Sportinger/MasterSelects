[← Back to Index](./README.md)

# Debugging & Logging

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
| Stack traces | Automatic capture for errors |
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

In development, the browser exposes a lightweight AI-tool console surface in addition to the HTTP bridge:

```javascript
window.aiTools.execute('getStats', {})
window.aiTools.list()
window.aiTools.status()
```

- `execute()` routes through the same shared AI-tool dispatcher used by chat and local bridge callers
- `list()` returns the exported tool definitions
- `status()` returns the quick timeline summary

The dev HTTP bridge uses the same underlying tool registry:

```text
POST /api/ai-tools
```

It also supports the `_list` and `_status` meta-commands, plus targeted execution against the active browser tab through the HMR bridge.

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
- `getLogs`
- `getPlaybackTrace`

Those tools surface:
- Engine state and readiness
- Timing breakdowns
- Decoder and drop information
- Playback health and anomaly data
- Cache and slot-deck stats
- Render loop and render dispatcher state
- WebCodecs / VF pipeline event windows

`getStatsHistory` is capped to 1-30 samples, `getLogs` caps the returned buffer to 1-500 entries, and `getPlaybackTrace` caps the inspected time window and event count so the bridge stays responsive.

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

*Source: `src/services/logger.ts`, `src/services/playbackDebugSnapshot.ts`, `src/services/playbackDebugStats.ts`, `src/services/playbackHealthMonitor.ts`, `src/services/wcPipelineMonitor.ts`, `src/services/vfPipelineMonitor.ts`, `src/services/aiTools/handlers/stats.ts`*
