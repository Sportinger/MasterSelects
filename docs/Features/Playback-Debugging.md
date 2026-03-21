[← Back to Index](./README.md)

# Playback Debugging & Stress Testing

Practical guide for debugging preview, playback, scrubbing, teleports, paused seeks, and post-refresh bootstrap issues in MASterSelects.

This document focuses on the playback-specific debugging paths that are easy to miss if you only look at the generic logger or the UI stats overlay.

---

## Table of Contents

- [Scope](#scope)
- [Current Debug Defaults](#current-debug-defaults)
- [Debugging Layers](#debugging-layers)
- [Dev Bridge Basics](#dev-bridge-basics)
- [Playback Debug Tools](#playback-debug-tools)
- [Repro Recipes](#repro-recipes)
- [How To Read The Metrics](#how-to-read-the-metrics)
- [Common Trace Patterns](#common-trace-patterns)
- [Common Gotchas](#common-gotchas)
- [Useful Test Files](#useful-test-files)
- [Related Docs](#related-docs)

---

## Scope

Use this guide when you are debugging any of the following:

- Normal playback stutter or visible freeze
- Scrubbing that feels delayed, stale, or catches up after mouse-up
- Teleport plus play regressions
- Paused seek / frame-step regressions
- Post-refresh black preview before first play
- WebCodecs versus HTML / VideoFrame pipeline behavior
- AI-bridge reproducible playback tests

This page complements, rather than replaces:

- [Preview & Playback](./Preview.md) for user-facing behavior and UI
- [Debugging](./Debugging.md) for generic logging and window globals
- [AI Integration](./AI-Integration.md) for the bridge and tool architecture

---

## Current Debug Defaults

Current engine flags in `src/engine/featureFlags.ts` default to a WebCodecs-first debug posture:

```typescript
useFullWebCodecsPlayback: true
disableHtmlPreviewFallback: true
```

That means:

- Preview/playback is expected to run through full WebCodecs where possible
- HTML preview recovery paths are disabled by default for debugging
- HTML media elements still exist for audio and some runtime plumbing

Flags are exposed at runtime via:

```javascript
window.__ENGINE_FLAGS__
```

If playback behavior changes unexpectedly after a branch switch, check the current values first.

---

## Debugging Layers

There are five useful layers of playback debugging in this codebase:

### 1. Manual UI Repro

Best for:

- Visual correctness
- "It feels delayed" reports
- Mouse-up settle behavior
- Arrow-key frame stepping
- Hard refresh behavior before first play

Manual repro matters because some issues are only obvious to the eye even when short-window stats still look acceptable.

### 2. Stats Overlay

Best for:

- Quick decoder / pipeline confirmation
- FPS, render time, layer count
- Pending seek and decoder reset counters
- Audio drift at a glance

This is the fastest sanity check, but it is not enough for short freezes or event-order bugs.

### 3. Browser Console Monitors

Best for:

- Low-level event ordering
- Raw pipeline event inspection
- Ad hoc inspection during manual UI testing

Useful globals:

- `window.__WC_PIPELINE__`
- `window.__VF_PIPELINE__`
- `window.Logger`
- `window.__ENGINE_FLAGS__`

### 4. AI Bridge Tools

Best for:

- Repeatable scripted repros
- Capturing telemetry immediately after a run
- Running hard reloads and stress paths without touching the UI

This is the most useful layer when you need reproducible playback or scrub debugging.

### 5. Unit Tests

Best for:

- Locking down regression paths
- Verifying player / sync / collector behavior without the browser UI
- Guarding tricky paused-seek and restore logic

Tests should confirm invariants, but they do not replace live runs for visual smoothness.

---

## Dev Bridge Basics

In development, the browser exposes AI tools via:

```text
POST http://localhost:5173/api/ai-tools
Authorization: Bearer <token from .ai-bridge-token>
```

The bridge token is written to:

```text
.ai-bridge-token
```

### Minimal Node Example

For scripted playback debugging, Node `fetch()` or `curl` has been the most reliable path.

```javascript
const fs = require('fs');
const token = fs.readFileSync('.ai-bridge-token', 'utf8').trim();

async function call(tool, args = {}) {
  const res = await fetch('http://localhost:5173/api/ai-tools', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ tool, args }),
  });
  return await res.json();
}
```

### Example: Set Playhead, Run Scrub, Pull Trace

```javascript
const out = {};
out.set = await call('setPlayhead', { time: 0 });
out.scrub = await call('simulateScrub', {
  pattern: 'random',
  speed: 'wild',
  durationMs: 9000,
  minTime: 0,
  maxTime: 240,
  seed: 424242,
});
out.trace = await call('getPlaybackTrace', { windowMs: 12000, limit: 1200 });
console.log(JSON.stringify(out, null, 2));
```

### Why Prefer Node Or Curl For Stress Runs

For complex playback/scrub args, Node `fetch()` and `curl` have been more reliable in live debugging than ad hoc PowerShell wrappers. If a scripted run mysteriously falls back to default values, switch to a direct JSON POST before trusting the result.

---

## Playback Debug Tools

The tools below are the main playback-debugging surface area.

| Tool | Best for | Important notes |
|------|----------|-----------------|
| `getTimelineState` | Confirm current clip, playhead, zoom, track count | Use first so you know which clip the run will hit |
| `getClipDetails` | Inspect source/runtime state of a single clip | Includes `debugSource` with `webCodecsReady`, `webCodecsHasFrame`, `runtimeSourceId`, `runtimeSessionKey`, `needsReload` |
| `setPlayhead` | Teleport to a time | Teleport is not equivalent to dragging |
| `play` / `pause` | Manual transport control | Useful for small repro sequences |
| `getStats` | Instant snapshot | Good for current decoder/pipeline state; poor for short spikes |
| `getStatsHistory` | Short sampled history | Good for drifting or unstable runs over a few seconds |
| `getPlaybackTrace` | Event timeline plus aggregated playback stats | Primary tool for playback debugging; increase `limit` for longer runs |
| `getLogs` | Browser-side logger buffer | Good for `PlaybackHealth`, `CutTransition`, or specific module warnings |
| `reloadApp` | Reproduce post-refresh issues | Supports `mode: "hard"` or `mode: "soft"` |
| `simulateScrub` | Pure DOM scrub stress | Uses real playhead drag targets when present |
| `simulatePlayback` | Play for N ms and measure actual progress | Returns run-bounded diagnostics including startup timing |
| `simulatePlaybackPath` | Mixed play/scrub preset | Good for stable regression comparison across builds |

### `getClipDetails` Debug Fields

`getClipDetails` is especially useful when the clip exists but preview still does not render. It exposes:

- `hasVideoElement`
- `videoReadyState`
- `hasAudioElement`
- `hasWebCodecsPlayer`
- `webCodecsReady`
- `webCodecsFullMode`
- `webCodecsHasFrame`
- `webCodecsPendingSeekTime`
- `runtimeSourceId`
- `runtimeSessionKey`
- `isLoading`
- `needsReload`

This helps separate:

- clip not restored
- runtime not bound
- player not ready
- player ready but no frame published

### `simulateScrub`

Patterns:

- `short`
- `long`
- `random`
- `custom`

Speeds:

- `slow`
- `normal`
- `fast`
- `wild`

Behavior:

- Uses DOM drag when `[data-ai-id="timeline-playhead"]` and `[data-ai-id="timeline-tracks"]` exist
- Falls back to store-driven scrubbing if DOM targets are unavailable
- Returns drag metadata such as `dragMode`, `pausedAfterGrab`, `zoom`, `scrollX`, `pixelDistance`, and client X coordinates

### `simulatePlayback`

Useful args:

- `startTime`
- `durationMs`
- `playbackSpeed`
- `settleMs`
- `resetDiagnostics`

Returns:

- actual transport delta
- drift versus expected delta
- stall information
- run-bounded diagnostics

### `simulatePlaybackPath`

Current preset:

- `play_scrub_stress_v1`

Sequence:

1. Play 1s from clip start
2. Scrub while playing to 30s in 1s
3. Play 1s
4. Scrub while playing to 3m in 2s
5. Play 2s
6. Scrub while playing back to 10s in 1s
7. Play 5s

This is the reference mixed playback/scrub stress path used during recent WebCodecs debugging.

---

## Repro Recipes

These are the most useful repeatable playback-debugging flows.

### 1. Baseline Normal Playback

Purpose:

- Check whether normal playback is okay before chasing scrub-specific bugs

Recipe:

```javascript
await call('setPlayhead', { time: 0 });
await call('simulatePlayback', {
  startTime: 0,
  durationMs: 15000,
  resetDiagnostics: true,
});
await call('getPlaybackTrace', { windowMs: 16000, limit: 1200 });
```

Look at:

- `driftSeconds`
- `previewFreezeEvents`
- `longestPreviewFreezeMs`
- `decoderResets`
- `queuePressureEvents`

### 2. Teleport Then Play

Purpose:

- Reproduce "old frame hangs, then catches up"
- Reproduce "black gap after teleport"

Recipe:

```javascript
await call('pause', {});
await call('setPlayhead', { time: 120 });
await call('play', {});
await call('simulatePlayback', {
  durationMs: 3000,
  settleMs: 150,
  resetDiagnostics: true,
});
```

Look at:

- startup timings
- `pendingSeekResolves`
- `avgPendingSeekMs`
- `previewPathCounts.empty`
- `stalePreviewWhileTargetMoved`

### 3. Random Wild DOM Scrub

Purpose:

- Stress retargeting, decoder resets, stale frame handling, and mouse-up settle

Recipe:

```javascript
await call('setPlayhead', { time: 0 });
await call('simulateScrub', {
  pattern: 'random',
  speed: 'wild',
  durationMs: 9000,
  minTime: 0,
  maxTime: 240,
  seed: 424242,
});
await call('getPlaybackTrace', { windowMs: 12000, limit: 1200 });
```

Look at:

- `dragMode`
- `stalePreviewWhileTargetMoved`
- `seeks`
- `decoderResets`
- `previewFreezeEvents`
- `previewPathCounts`

### 4. Mixed Play/Scrub Regression Path

Purpose:

- Compare builds against a fixed reference run

Recipe:

```javascript
await call('setPlayhead', { time: 0 });
await call('simulatePlaybackPath', {
  preset: 'play_scrub_stress_v1',
  startTime: 0,
  resetDiagnostics: true,
});
await call('getPlaybackTrace', { windowMs: 20000, limit: 1200 });
```

Look at:

- whether target times are hit
- whether play segments advance correctly
- `runDiagnostics.playback`
- `runDiagnostics.startup`

### 5. Refresh Before First Play

Purpose:

- Reproduce "preview stays black until I play"
- Reproduce paused bootstrap regressions

Recipe:

```javascript
await call('reloadApp', { mode: 'hard', delayMs: 250 });
// reconnect / wait briefly, then:
await call('getTimelineState', {});
await call('getStats', {});
await call('getClipDetails', { clipId });
await call('getPlaybackTrace', { windowMs: 10000, limit: 1200 });
```

Look at:

- `decoder`
- `layerCount`
- `pipeline`
- `debugSource.webCodecsReady`
- `debugSource.webCodecsHasFrame`
- `debugSource.webCodecsPendingSeekTime`

If the clip exists and the player is ready, but there is still no frame, the failure is usually in paused bootstrap or paused strict-seek publish rather than restore state alone.

### 6. Manual-Only Checks

Some bugs are better tested by hand than by script:

- Arrow-key frame step
- Exact mouse-up settle feel
- Visual jumpiness after hard refresh
- Whether scrub feels delayed even when it is technically advancing

In those cases, combine manual UI repro with `getPlaybackTrace` and `getLogs` immediately after.

---

## How To Read The Metrics

The metrics below are the ones that have proven most useful in real playback debugging.

### Transport Correctness

- `initialPosition` / `finalPosition`: where the run really started and ended
- `deltaSeconds`: actual transport delta during the run
- `driftSeconds`: actual delta minus expected delta
- `clipStartTime`: anchor used by `simulatePlaybackPath`

If transport is correct but preview is wrong, the bug is usually in frame publish / preview path, not the playhead clock.

### Preview Freshness

- `previewFrames`: how many preview frames were observed
- `previewUpdates`: how many of those actually changed the visible frame
- `stalePreviewFrames`: repeated visible frames
- `stalePreviewWhileTargetMoved`: repeated frames while the target time was changing
- `previewFreezeEvents`: grouped visible freezes
- `longestPreviewFreezeMs`: worst single freeze
- `avgPreviewUpdateGapMs` / `maxPreviewUpdateGapMs`: how long preview went without a visible update
- `avgPreviewDriftMs` / `maxPreviewDriftMs`: displayed frame time versus target time
- `previewPathCounts`: how many preview frames came from `webcodecs`, `empty`, or other paths

These numbers are usually the most important for scrub feel.

### Decoder Churn

- `seeks`: total seek operations
- `advanceSeeks`: playback-driven advances
- `decoderResets`: hard decoder resets
- `queuePressureEvents`: queue saturation / pressure warnings
- `avgDecodeLatencyMs` / `maxDecodeLatencyMs`: decode latency
- `pendingSeekResolves`: how many pending seeks actually resolved
- `avgPendingSeekMs` / `maxPendingSeekMs`: pending seek duration

If these counters explode during scrubbing, the scrub path is still too reset-heavy.

### Video State Summary

- `decoder`: current engine decoder label
- `pipeline`: current playback pipeline summary
- `activeVideos`
- `playingVideos`
- `seekingVideos`
- `warmingUpVideos`
- `coldVideos`
- `worstReadyState`

This is the fastest way to tell whether the browser is actively playing, stuck in seek, or still cold.

### Startup Timing

Run-bounded diagnostics from `simulatePlayback` / `simulatePlaybackPath` include:

- `firstDecodeOutputMs`
- `firstPreviewFrameMs`
- `firstPreviewUpdateMs`
- `initialTargetMovedStaleFrames`
- `initialTargetMovedStaleMs`

These are much better than raw snapshots for startup and teleport debugging because they do not depend on you polling at the right time.

### Health Anomalies

The health monitor tracks anomalies such as:

- `FRAME_STALL`
- `WARMUP_STUCK`
- `RVFC_ORPHANED`
- `SEEK_STUCK`
- `READYSTATE_DROP`
- `GPU_SURFACE_COLD`
- `RENDER_STALL`
- `HIGH_DROP_RATE`

`HIGH_DROP_RATE` is common in bad scrub runs and is a useful signal that the decoder is doing work but the preview is not keeping up.

---

## Common Trace Patterns

### Healthy Seek / Publish Flow

Typical healthy WebCodecs event shape:

```text
seek_start
decoder_reset
decode_feed
decode_output
seek_publish
```

This means:

- a target was requested
- the decoder restarted from an appropriate keyframe
- samples were fed
- decoded frames arrived
- a frame was actually published to preview

### Bad Pattern: Intermediate-Frame Storm

Typical bad shape:

```text
seek_start
decoder_reset
decode_feed ...
decode_output
frame_drop reason=seek_intermediate
decode_feed ...
decode_output
frame_drop reason=seek_intermediate
```

This often correlates with:

- high `decoderResets`
- high `seeks`
- high `stalePreviewWhileTargetMoved`
- scrub feeling behind the cursor

### Bad Pattern: Flush Without Publish

If you see a flush/seek completion but no publish event, the player may have decoded work without ever promoting a frame to visible preview. That often explains black or frozen paused preview states.

### Bad Pattern: Empty Preview After Settle

On the VF side:

```text
vf_wc_settle_seek
vf_preview_frame previewPath=empty
vf_preview_frame previewPath=empty
```

This usually means the preview dropped its old frame before a replacement frame became visible.

### Bad Pattern: Visible Stale Frame

Repeated VF preview frames like:

```text
changed=false
targetMoved=true
previewPath=webcodecs
```

mean the target time is moving but the same visible frame is still being displayed.

---

## Common Gotchas

### `getStats` Can Look Fine While The UI Still Felt Bad

`getStats` is only a single snapshot. Short freezes and stale spans can disappear between samples. Use:

- `simulatePlayback` or `simulatePlaybackPath` run diagnostics
- `getPlaybackTrace`
- `getStatsHistory`

### Increase Trace Limits For Long Runs

`getPlaybackTrace` defaults to:

- `windowMs = 5000`
- `limit = 200`

For long or stormy runs, that is often too small. Prefer:

```javascript
await call('getPlaybackTrace', { windowMs: 12000, limit: 1200 });
```

or even `limit: 2000` if the run is dense.

### Hard Reload Beats HMR For Long-Lived Playback Objects

Changes in:

- `WebCodecsPlayer`
- restore/bootstrap logic
- media runtime services

do not always replace already-created player instances via HMR. After editing those paths, use a real reload before trusting live results.

### `setPlayhead` Is Not A Scrub

Teleporting with `setPlayhead` is useful, but it does not exercise:

- DOM drag logic
- playhead grab/pause flow
- pixel-to-time mapping
- release behavior

If the bug is "manual scrub feels wrong", use `simulateScrub` or the real UI.

### `simulateScrub` Is Best When DOM Targets Exist

If the timeline DOM targets are missing, `simulateScrub` falls back to store-driven scrubbing. That is still useful, but it is not equivalent to a true playhead drag.

### Refresh Bugs Are Different From Teleport Bugs

The post-refresh paused bootstrap path has different failure modes from normal paused seeks or teleports. Treat it as a separate repro family.

---

## Useful Test Files

The following tests have been the most relevant during playback debugging:

| File | Focus |
|------|-------|
| `tests/unit/webCodecsPlayer.test.ts` | WebCodecs seek, publish, scrub, resume behavior |
| `tests/unit/videoSyncManager.test.ts` | Sync routing, paused/playback seek policy, runtime handoff |
| `tests/unit/videoSyncManagerSyncGate.test.ts` | Sync gate and preview-provider activation |
| `tests/unit/layerCollector.test.ts` | Preview path selection, hold/drop behavior |
| `tests/unit/layerBuilderService.test.ts` | Runtime provider selection and layer assembly |
| `tests/unit/mediaRuntime.test.ts` | Runtime playback session/provider behavior |
| `tests/unit/playbackDebugStats.test.ts` | Aggregated playback metric calculations |
| `tests/unit/timelineRestorePreview.test.ts` | Reload / restore preview bootstrap |
| `tests/unit/playheadState.test.ts` | Internal playhead hold / sync behavior |
| `tests/unit/aiToolPolicy.test.ts` | Bridge policy for playback debug tools |

These tests are good regression guards, but live browser runs are still required for perceived smoothness.

---

## Related Docs

- [Preview & Playback](./Preview.md)
- [Debugging](./Debugging.md)
- [AI Integration](./AI-Integration.md)
- [Native Helper](./Native-Helper.md)
- [Project Persistence](./Project-Persistence.md)

---

*Documentation updated March 2026*
