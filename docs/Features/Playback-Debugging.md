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

When the dev bridge or Native Helper bridge is available, prefer the structured tools:

- `getStats`
- `getStatsHistory`
- `getLogs`
- `getPlaybackTrace`
- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getClipDetails`
- `reloadApp`

The most useful payload for real playback bugs is usually:

1. `getStats`
2. `getPlaybackTrace`
3. `getLogs` filtered to playback modules

---

## Signals To Watch

These fields are the highest-signal indicators in traces and health snapshots:

- `stalePreviewWhileTargetMoved`
- `decoderResets`
- `previewFreezeEvents`
- `previewPathCounts.empty`
- `driftSeconds`
- `firstPreviewUpdateMs`
- `FRAME_STALL`
- `SEEK_STUCK`
- `HIGH_DROP_RATE`
- `GPU_SURFACE_COLD`

If the preview is black after reload, also confirm the browser media element is actually ready. A valid render path with a cold or unready surface will still produce empty frames.

---

## Common Failure Patterns

### Black Preview Or Black Source Monitor

- Check browser media `readyState` first.
- Confirm whether the app is on the WebCodecs path or the HTML video fallback path.
- On Firefox, expect copied-texture fallback instead of imported external textures.

### Scrub Freezes Or Delayed Updates

- Inspect `previewFreezeEvents` and `firstPreviewUpdateMs`.
- Check whether RAM preview is stale while the target moved.
- Confirm whether the render loop idled and had to restart.

### Drift During Playback

- Check `driftSeconds`, handoff events, and active anomaly flags.
- Compare WebCodecs and fallback pipeline events to see where sync diverged.
- Verify whether the issue is clip-specific with `getClipDetails`.

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

- `src/services/monitoring/playbackHealthMonitor.ts`
- `src/services/monitoring/playbackDebugStats.ts`
- `src/services/monitoring/framePhaseMonitor.ts`
- `src/services/monitoring/wcPipelineMonitor.ts`
- `src/services/monitoring/vfPipelineMonitor.ts`
- `src/components/preview/Preview.tsx`
- `src/components/preview/SourceMonitor.tsx`
- `src/services/aiTools/bridge.ts`
- `src/services/nativeHelper/NativeHelperClient.ts`
