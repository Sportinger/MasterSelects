[Back to Index](./README.md)

# Playback Debugging

Targeted workflow for preview stalls, scrub freezes, decode drift, and render-path mismatches.

---

## What To Use First

Playback bugs in MasterSelects usually span three layers at once:

- media readiness and browser decode state
- render-loop and target scheduling state
- timeline-to-preview sync and cache behavior

Use the browser monitors and AI bridge tools together instead of guessing from the UI.

---

## Browser Surfaces

These globals are the fastest way to inspect the live playback path:

- `window.__WC_PIPELINE__` for WebCodecs events, seeks, stalls, and aggregate counters
- `window.__VF_PIPELINE__` for HTML video / VideoFrame fallback events
- `window.__PLAYBACK_HEALTH__` for health state, anomalies, active video status, and recovery helpers
- `window.__FRAME_PHASES__` for per-frame phase timelines and summaries
- `window.Logger` for buffered module logs and redacted summaries

Useful console setup:

```javascript
Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')
Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')
Logger.setLevel('DEBUG')
```

Additional shortcuts:

```javascript
Logger.search('device')
Logger.errors()
Logger.dump(50)
Logger.summary()
```

---

## AI Bridge Tools

When the development bridge is available, prefer the structured tools:

- `getStats`
- `getStatsHistory`
- `getAudioDiagnostics`
- `getLogs`
- `getPlaybackTrace`
- `getRuntimeDiagnostics`
- `purgePlaybackPath`
- `samplePlaybackFramePacing`
- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getClipDetails`
- `reloadApp`

The most useful payload for real playback bugs is usually:

1. `getStats`
2. `getPlaybackTrace`
3. `getLogs` filtered to playback modules

For crackling, pops, or dropouts during audible playback, capture `getAudioDiagnostics` during the noise. It reports per-element ready/buffer state, approximate source-time drift, Web Audio context latency/state, routing graph state, and recent `audio_drift` / `audio_drift_correct` events.

---

## Signals To Watch

These fields are the highest-signal indicators across trace, stats, and simulation results:

- `stalePreviewWhileTargetMoved`
- `decoderResets`
- `previewFreezeEvents`
- `previewPathCounts` entries such as `empty-hold`, `paused-empty-hold`, and `target-empty-hold`
- `driftSeconds`
- `getAudioDiagnostics.events.correctionMs`
- `getAudioDiagnostics.mediaElements[].buffered.bufferedAheadSeconds`
- `getAudioDiagnostics.routing.context.baseLatencyMs`
- `firstPreviewUpdateMs`
- `FRAME_STALL`
- `SEEK_STUCK`
- `HIGH_DROP_RATE`
- `GPU_SURFACE_COLD`

If the preview is black after reload, also confirm the browser media element is actually ready. A valid render path with a cold or unready surface still produces empty frames.

---

## Common Failure Patterns

### Black Preview Or Black Source Monitor

- Check browser media `readyState` first.
- Check `getStats.decoder` and `playback.pipeline`: the active path can be full WebCodecs, HTML video / VideoFrame (including cache variants), Native Helper, or ParallelDecode.
- If external texture import fails, inspect the media readiness and the recorded GPU/runtime diagnostics before assuming a browser-specific fallback.

### Scrub Freezes Or Delayed Updates

- Inspect `previewFreezeEvents` and `firstPreviewUpdateMs`.
- Check whether RAM preview is stale while the target moved.
- Confirm whether the render loop is idle and requires restarting.

### Drift During Playback

- Check `driftSeconds`, handoff events, and active anomaly flags.
- Compare the active decoder/pipeline with the WebCodecs and VF event streams to see where sync diverged.
- Verify whether the issue is clip-specific with `getClipDetails`.

### Source FPS Higher Than Composition FPS

- Playback preview is visually locked to the active composition frame rate. A 60 fps video in a 30 fps composition should show about 30 render/preview updates per second, not every decoded source frame.
- `samplePlaybackFramePacing` may still report the browser media element advancing at the source cadence through `videoQuality` / video frame callbacks. Use `renderLoop.renderCountDelta`, `stats.fps`, `stats.targetFps`, `playback.previewUpdateFps`, and `visualTargetFps` to confirm the visible composition cadence.
- During playback, the HTML media clock stays continuous to avoid per-frame seeking; visual layer target times are quantized to composition frames for cache/provider selection and deterministic preview presentation.
- Full WebCodecs playback is disabled by the default feature flag, but can be enabled through the persisted settings toggle; it disables the HTML preview fallback.

### Export Looks Fine But Preview Is Wrong

- Compare target routing and render-target state in `getStats`.
- Confirm the issue is not limited to a popup output or independent preview target.
- Check whether cached hold frames or fallback frames are masking a decode problem.

---

## Minimal Repro Routine

1. Reload the app.
2. Reproduce once without changing settings.
3. Capture `getStats`.
4. Capture `getPlaybackTrace`.
5. Enable targeted logger modules and reproduce again.
6. Compare whether the issue happens on the main preview, source monitor, and popup output.

This isolates whether the problem is in decode, render scheduling, target routing, or overlay state.

---

## Source Map

- `src/services/playbackHealthMonitor.ts`
- `src/services/playbackDebugStats.ts`
- `src/services/framePhaseMonitor.ts`
- `src/services/wcPipelineMonitor.ts`
- `src/services/vfPipelineMonitor.ts`
- `src/components/preview/Preview.tsx`
- `src/components/preview/SourceMonitor.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/nativeHelper/NativeHelperClient.ts`
