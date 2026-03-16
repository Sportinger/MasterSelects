[← Back to Index](./README.md)

# Debugging & Logging

MASterSelects includes a professional Logger service designed for both human debugging and AI-assisted development.

## Overview

The Logger service (`src/services/logger.ts`) provides:

| Feature | Description |
|---------|-------------|
| **Log Levels** | DEBUG, INFO, WARN, ERROR with level filtering |
| **Module Filtering** | Enable debug logs for specific modules only |
| **In-Memory Buffer** | 500 entries stored for inspection (WARN/ERROR always buffered; DEBUG/INFO only when displayed) |
| **Global Access** | `window.Logger` available in browser console |
| **AI-Agent Support** | Structured data for AI code assistants |
| **Timestamps** | Timestamp prefixes (enabled by default) |
| **Stack Traces** | Automatic capture for errors |
| **Log Sync** | Auto-syncs logs to dev server in development mode (`window.LogSync`) |

**Default log level: `WARN`** -- only warnings and errors are shown by default. Use `Logger.setLevel('DEBUG')` or `Logger.setLevel('INFO')` for more verbose output.

---

## Console Commands

All commands are available via `window.Logger` or just `Logger` in the browser console.

### Enable/Disable Debug Logs

```javascript
// Enable debug logs for specific modules (comma-separated)
// Uses substring matching (case-insensitive)
Logger.enable('WebGPU,FFmpeg,Export')

// Enable all debug logs
Logger.enable('*')

// Disable debug logs (errors still shown)
Logger.disable()
```

### Set Log Level

```javascript
// Show all logs (DEBUG and above)
Logger.setLevel('DEBUG')

// Show INFO and above (hide DEBUG)
Logger.setLevel('INFO')

// Show only warnings and errors (DEFAULT)
Logger.setLevel('WARN')

// Show only errors
Logger.setLevel('ERROR')
```

**Note:** Errors are always displayed regardless of log level. DEBUG messages additionally require the module to be enabled via `Logger.enable()`.

### Inspect Logs

```javascript
// Get all buffered logs
Logger.getBuffer()

// Get only errors
Logger.getBuffer('ERROR')

// Get only warnings and errors
Logger.getBuffer('WARN')

// Search logs by keyword (searches message, module name, and data)
Logger.search('device')
Logger.search('export')

// Get recent errors only
Logger.errors()

// Pretty print last N entries (default 50)
Logger.dump(50)

// Get summary for AI agents
Logger.summary()
// Returns: { totalLogs, errorCount, warnCount, recentErrors, activeModules }

// Export all logs as JSON string
Logger.export()
// Returns JSON with: config, modules list, and all buffered logs
```

### Status & Configuration

```javascript
// Show current configuration
Logger.status()
// Output:
// [Logger] Current Configuration:
// ┌─────────────────────┬───────────────────────┐
// │ Debug Enabled       │ WebGPU, FFmpeg        │
// │ Min Level           │ WARN                  │
// │ Timestamps          │ true                  │
// │ Buffer Size         │ 500                   │
// │ Buffer Used         │ 127                   │
// │ Registered Modules  │ 45                    │
// └─────────────────────┴───────────────────────┘

// List all registered modules (sorted alphabetically)
Logger.modules()
// Returns: ['AudioEncoder', 'AudioMixer', 'Compositor', 'Export', ...]

// Clear the log buffer
Logger.clear()

// Toggle timestamps
Logger.setTimestamps(false)
```

### Log Sync (Dev Mode)

In development mode, logs are automatically synced to the dev server every 2 seconds via `POST /api/logs`. Control this with `window.LogSync`:

```javascript
// Check sync status
LogSync.status()   // 'running' or 'stopped'

// Stop syncing
LogSync.stop()

// Start syncing
LogSync.start()
```

---

## Usage in Code

### Basic Usage

```typescript
import { Logger } from '@/services/logger';

// Create a logger for your module
const log = Logger.create('MyModule');

// Log at different levels
log.debug('Verbose debugging info', { data });  // Only shows if module enabled AND level <= DEBUG
log.info('Important event');                     // Shows if level <= INFO
log.warn('Warning message', data);               // Orange in console, always buffered
log.error('Error occurred', error);              // Red, always shows, always buffered, captures stack
```

### Timing Helper

```typescript
const log = Logger.create('Export');

// Start timing
const done = log.time('Encoding video');

// ... do work ...

// Log completion with duration
done();
// Output: [Export] Encoding video completed in 1234.56ms
```

### Grouped Logs

```typescript
const log = Logger.create('Compositor');

log.group('Rendering frame 42', () => {
  log.debug('Collecting layers');
  log.debug('Applying effects');
  log.debug('Compositing');
});
// Output is grouped in console when DEBUG enabled for this module
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
// GPU/Rendering
Logger.enable('WebGPU,Compositor,RenderLoop,TextureManager')

// Export pipeline
Logger.enable('Export,FrameExporter,VideoEncoder,AudioEncoder,FFmpeg')

// Audio system
Logger.enable('Audio,AudioMixer,AudioEncoder,TimeStretch')

// Project/Storage
Logger.enable('Project,ProjectCore,FileStorage')

// Timeline
Logger.enable('Timeline,Clip,Track,Keyframe')
```

---

## AI-Agent Inspection

The Logger is designed to help AI code assistants (like Claude) understand what's happening in the application.

### Summary for AI

```javascript
const summary = Logger.summary();
// {
//   totalLogs: 234,
//   errorCount: 2,
//   warnCount: 5,
//   recentErrors: [...last 10 errors...],
//   activeModules: ['WebGPUEngine', 'Export', 'FFmpegBridge']  // modules from last 100 log entries
// }
```

### Search for Issues

```javascript
// Find all logs related to a specific issue
Logger.search('device lost')
Logger.search('encode failed')
Logger.search('permission denied')
```

### Export for Analysis

```javascript
// Get full log data as JSON string
const logData = Logger.export();
// Contains: config, modules, and all buffered logs
```

---

## Log Entry Structure

Each log entry contains:

```typescript
interface LogEntry {
  timestamp: string;    // ISO timestamp
  level: LogLevel;      // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module: string;       // Module name
  message: string;      // Log message
  data?: unknown;       // Optional attached data (Error objects serialized to {name, message})
  stack?: string;       // Stack trace (for errors)
}
```

---

## Buffering Behavior

To avoid excessive memory allocations from high-frequency debug logs (e.g., per-frame render logs), the buffer uses a selective strategy:

- **WARN and ERROR** entries are always buffered (for post-mortem debugging)
- **DEBUG and INFO** entries are only buffered when they are actually displayed (module enabled + level threshold met)
- Buffer is a FIFO ring of 500 entries max

---

## Persistence

Logger configuration is saved to `localStorage`:

- Key: `logger_config`
- Stores: enabled modules, level, timestamps setting, buffer size

Configuration persists across page refreshes.

---

## Performance Monitoring

In addition to the Logger, MASterSelects includes performance monitoring:

### PerformanceStats (`src/engine/stats/PerformanceStats.ts`)

Tracks:
- Frame rate (FPS) - updated every 250ms
- RAF gap (requestAnimationFrame latency) - exponential moving average
- Texture import time
- Render pass time
- Submit time
- Frame drops and drop reasons (`slow_raf`, `slow_import`, `slow_render`)
- Decoder type and WebCodecs info
- Audio status
- Layer count

Frame drops are detected when RAF gap exceeds 2x the target frame time (33.3ms at 60fps). During scrubbing, the baseline is adjusted to 33ms (intentional 30fps limit).

### PerformanceMonitor (`src/services/performanceMonitor.ts`)

- Auto-starts when the module is imported
- Checks every 500ms for slow frames (>100ms threshold)
- After 5 consecutive slow frames, automatically resets quality parameters to defaults
- Provides callback system for performance events via `onSlowPerformance(callback)`
- Quality parameters are identified by the `quality` flag in effect parameter definitions

Available exports:
```typescript
import {
  startPerformanceMonitor,
  stopPerformanceMonitor,
  reportRenderTime,
  resetAllQualityParams,
  onSlowPerformance,
  isPerformanceMonitorActive,
} from '@/services/performanceMonitor';
```

---

## Pipeline Monitor Globals

MasterSelects exposes two pipeline monitor objects on the `window` for console-based debugging of the playback decode pipeline.

### `window.__WC_PIPELINE__`

WebCodecs pipeline state inspection. Set by `wcPipelineMonitor.ts`, this ring-buffer monitor records all WebCodecs decode pipeline events:

- `decode_feed`, `decode_output` -- sample feed and frame output
- `frame_read`, `frame_drop` -- frame consumption and drops
- `decoder_reset` -- decoder reinitialization
- `pending_seek_start/end`, `seek_start/end/skip/cancel/publish` -- seek lifecycle
- `collector_hold`, `collector_drop` -- frame collector decisions
- `drift_correct`, `queue_pressure`, `stall`, `rAF_gap` -- health metrics
- `play`, `pause`, `advance_seek` -- playback state changes

### `window.__VF_PIPELINE__`

VideoFrame (HTMLVideo + VideoFrame API) pipeline state inspection. Set by `vfPipelineMonitor.ts`, this ring-buffer monitor records VF-mode playback events:

- `vf_capture`, `vf_read`, `vf_drop` -- frame delivery lifecycle
- `vf_gpu_cold`, `vf_gpu_ready` -- GPU surface warmup
- `vf_play`, `vf_pause`, `vf_seek_fast`, `vf_seek_precise`, `vf_seek_done` -- playback and seeking
- `vf_drift`, `vf_stall`, `vf_readystate_drop` -- health and sync
- `audio_drift`, `audio_drift_correct`, `audio_status`, `audio_master_change`, `audio_rate_change` -- audio sync

Both monitors use a 5000-event ring buffer and are readable from the browser console at any time.

---

## Playback Monitoring Services

MasterSelects includes 7 dedicated monitoring services for playback debugging and health tracking:

| Service | File | Description |
|---------|------|-------------|
| **playbackHealthMonitor** | `playbackHealthMonitor.ts` | Detects 8 anomaly types (FRAME_STALL, WARMUP_STUCK, RVFC_ORPHANED, SEEK_STUCK, READYSTATE_DROP, GPU_SURFACE_COLD, RENDER_STALL, HIGH_DROP_RATE). Per-clip escalation: 3+ anomalies within 12s triggers aggressive recovery |
| **playbackDebugStats** | `playbackDebugStats.ts` | Real-time stats for the `playback` field in EngineStats -- pipeline name, decoder resets, pending seek timing, collector hold/drop counts |
| **playbackDebugSnapshot** | `playbackDebugStats.ts` | Point-in-time snapshots of video element state, anomaly history, and frame cadence for debugging |
| **framePhaseMonitor** | `framePhaseMonitor.ts` | Frame lifecycle phase tracking -- measures time spent in stats, build, render, sync-video, sync-audio, and cache phases per frame |
| **vfPipelineMonitor** | `vfPipelineMonitor.ts` | VideoFrame pipeline event ring buffer (see `window.__VF_PIPELINE__` above) |
| **wcPipelineMonitor** | `wcPipelineMonitor.ts` | WebCodecs pipeline event ring buffer (see `window.__WC_PIPELINE__` above) |
| **scrubSettleState** | `scrubSettleState.ts` | Tracks scrub-to-play transition state per clip -- manages settle, retry, and warmup stages after scrubbing stops |

---

## Troubleshooting

### Common Debug Scenarios

**Black preview / No rendering:**
```javascript
Logger.enable('WebGPU,Compositor,RenderLoop')
Logger.setLevel('DEBUG')
// Check for device issues, texture errors
```

**Export fails:**
```javascript
Logger.enable('Export,FrameExporter,VideoEncoder,FFmpeg')
Logger.setLevel('DEBUG')
// Check for encoding errors, codec issues
```

**Audio out of sync:**
```javascript
Logger.enable('Audio,AudioMixer,TimeStretch')
Logger.setLevel('DEBUG')
// Check for timing issues
```

**File import problems:**
```javascript
Logger.enable('Media,Import,Project')
Logger.setLevel('DEBUG')
// Check for file access, format issues
```

**Performance issues:**
```javascript
Logger.enable('PerformanceMonitor')
Logger.setLevel('DEBUG')
// Check for slow frame warnings and quality resets
```

---

## Best Practices

1. **Use appropriate log levels:**
   - `debug` for verbose/frequent logs (disabled by default)
   - `info` for important events
   - `warn` for recoverable issues
   - `error` for failures

2. **Include context data:**
   ```typescript
   log.debug('Frame rendered', { frameNumber, duration, layerCount });
   ```

3. **Use timing for performance:**
   ```typescript
   const done = log.time('Heavy operation');
   // ... work ...
   done();
   ```

4. **Keep module names consistent** with file/class names

5. **Don't log sensitive data** (API keys, user data)

6. **Remember the default level is WARN** -- add `Logger.setLevel('DEBUG')` when troubleshooting

---

## Related Documents

- [GPU Engine](./GPU-Engine.md) -- Troubleshooting rendering, texture, and WebGPU issues
- [AI Integration](./AI-Integration.md) -- AI debug tools and AI-agent inspection

---

*Updated March 2026 - verified against codebase*
