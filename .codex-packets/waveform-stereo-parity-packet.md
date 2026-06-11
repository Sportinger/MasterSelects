You are a worker agent executing one bounded packet. Do not broaden scope.

Lane: timeline-canvas
Packet: waveform-stereo-worker-parity
Goal: The worker-rendered timeline clip waveforms are MONO while the main-thread fallback painter renders STEREO (one lane per channel). Users see the correct stereo view only while tracks are in main-thread fallback, then it degrades to mono once the worker takes over. Make the worker path render the same per-channel lanes as the main-thread painter.

## Root cause

`createTimelineClipCanvasWorkerWaveformResource` in `src/components/timeline/utils/timelineClipCanvasWaveformResource.ts` (~line 84) picks only the FIRST channel:
`const channelIndex = resolveTimelineClipCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, height)[0] ?? 0;`
so `TimelineClipCanvasWorkerWaveformResource` (contract) carries a single packed column set, and `drawWorkerWaveformColumns` paints one full-height lane.

The main-thread reference behavior is `drawTimelineClipCanvasAudioWaveform` in `src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts`: it resolves up to MAX_RENDERED_WAVEFORM_CHANNELS (2) channel indexes (1 if lane height < 42), computes `laneGap = 2` between lanes, `laneHeight = max(8, (h - laneGap*(n-1))/n)`, builds a LOD + smooth + normalize PER CHANNEL, draws a separator line between lanes, and paints each lane (envelope + RMS + center line + transient spikes).

## Target contract

1. Extend `TimelineClipCanvasWorkerWaveformResource` in `src/components/timeline/utils/timelineClipCanvasWorkerContract.ts` to carry per-channel column data, e.g. `channels: Array<{ columns: number[]; columnCount: number }>` (keep `mode`). If the existing flat fields must stay for compatibility with other readers, check all readers first (rg for the type name) — prefer a clean replacement if all readers are in the write set.
2. `createTimelineClipCanvasWorkerWaveformResource`: build columns for EVERY index returned by `resolveTimelineClipCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, height)` — reusing the same per-channel pipeline (buildWaveformLod -> smoothWaveformColumns -> normalizeWaveformColumnsForDisplay) with the SAME parameters the main-thread painter uses. Note the main painter normalizes per lane with laneHeight-independent params, so per-channel normalize is identical to what it does.
3. `drawWorkerWaveformColumns` in `src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts`: replicate the main painter's lane layout — laneGap 2, laneHeight formula, separator stroke `rgba(255,255,255,0.12)` between lanes, then per lane: existing envelope/RMS/center-line/transient-spike drawing translated into the lane (use context save/translate/restore like the main painter does).
4. Visual parity goal: for a stereo clip, worker output must match the main-thread fallback output (same lanes, same style). Mono clips keep current appearance.
5. Check the resource serialization path (how the resource travels to the worker — `timelineClipCanvasWorkerModel.ts` / message building) and keep transfer efficient (plain arrays / Float32Array as currently done). Update any type plumbing needed.

Read first:
- src/components/timeline/utils/timelineClipCanvasWaveformResource.ts
- src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts (reference behavior)
- src/components/timeline/utils/timelineClipCanvasWorkerContract.ts
- src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts
- src/components/timeline/utils/timelineClipCanvasWaveformSpikes.ts (shared spike helper)
- rg -n "TimelineClipCanvasWorkerWaveformResource|mixdownWaveform" src — find ALL readers of the resource type and update them consistently (mixdownWaveform uses the same resource type; keep it working, mono is fine there if that is its current data shape).

Allowed write set:
- src/components/timeline/utils/timelineClipCanvasWaveformResource.ts
- src/components/timeline/utils/timelineClipCanvasWorkerContract.ts
- src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts
- src/components/timeline/utils/timelineClipCanvasWorkerModel.ts (only if the message plumbing requires it)
- any worker-side file that calls drawWorkerWaveformColumns (read first, report which)

Forbidden: the main-thread painter (it is the reference, do not change its output), the warmup hook, stores, services.

Checks you MUST run and report verbatim output for:
- npx tsc -b --pretty false
- rg -n "channels|columnCount" src/components/timeline/utils/timelineClipCanvasWorkerContract.ts
- (do NOT attempt vitest — the orchestrator runs it after you finish)

Do NOT commit. Never delete/revert files outside your write set. Respect LOC budgets (<=700 per product file; the architecture registry test enforces per-file ceilings — if a file would grow past its ceiling, extract a helper module within the write set directory instead).

Report: files changed with rationale, all readers of the resource type you found and how each was handled, checks with actual output, risks.
Stop conditions: if parity requires changes outside the write set, STOP and report.
