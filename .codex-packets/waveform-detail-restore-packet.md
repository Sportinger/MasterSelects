You are a worker agent executing one bounded packet. Do not broaden scope.

Lane: timeline-canvas
Packet: waveform-detailed-transient-spikes
Goal: Restore the "detailed" audio waveform look the app had before commit 3d71d3c6 (2026-06-02). The current detailed mode draws only the smoothed signed envelope + RMS band, which reads as blobby. The old renderer additionally drew transient peak spikes (vertical lines at local peak transients), which gave the detailed mode its crisp character. Port the spikes back into BOTH waveform painters (main thread and worker).

## Reference implementation (the old code)

The pre-removal function lives in git history: `git show 3d71d3c6~1:src/components/timeline/components/ClipWaveform.tsx` — functions `drawTransientPeakSpikes` (around line 179) and its helper `percentileFromSorted`, called at the end of `drawDetailedWaveform`. A plain-text excerpt is also saved at `.codex-packets/old-transient-spikes-reference.txt`. Port it faithfully (thresholds, alpha math, min gap px, line widths) rather than re-inventing.

## Current code layout

- Main-thread painter: `src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts` — `drawDetailedCanvasWaveform()` is the integration point (call the spikes after `drawCanvasWaveformCenterLine`).
- Worker painter: `src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts` — `drawWorkerWaveformColumns()` with `mode === 'detailed'`; it consumes a packed Float32Array (min,max,rms,peak per column) instead of WaveformColumn objects. The spike algorithm needs the same data; adapt the loop to the packed layout (a `columnAt(index)` accessor already exists).
- Shared geometry helpers live in `src/components/timeline/utils/timelineClipCanvasWaveformEnvelopePath.ts`. If you extract a shared spike-path helper, it must work for both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D (use a union type or generic — the worker bundle must not import DOM-only modules; check existing imports of the worker painter to see what is allowed).

## Target contract

1. Detailed mode (main thread AND worker) renders transient peak spikes identical in look to the 3d71d3c6~1 reference: same percentile threshold (0.94/0.955 by width), min gap (11/8 px by width), line width (0.9/1.1), alpha formula, inner gap based on rms.
2. Compact and spectral modes unchanged.
3. Visual parity between worker and main-thread rendering (this was the point of commit 3d71d3c6 — do not break it: both painters must draw the same spikes for the same columns).
4. No allocation-heavy per-frame work: the spike pass runs only inside existing draw calls (which are already redraw-driven, not per-frame).
5. Respect file line budgets: product source files stay <= 700 lines; if a painter would exceed its budget, extract the spike helper into the envelope-path module (or a new sibling module `timelineClipCanvasWaveformSpikes.ts`) shared by both painters.

Read first:
- .codex-packets/old-transient-spikes-reference.txt (the reference code)
- src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts
- src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts
- src/components/timeline/utils/timelineClipCanvasWaveformEnvelopePath.ts
- src/components/timeline/utils/waveformLod.ts (WaveformColumn type)

Allowed write set (edit ONLY these; creating timelineClipCanvasWaveformSpikes.ts in utils/ is allowed):
- src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts
- src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts
- src/components/timeline/utils/timelineClipCanvasWaveformEnvelopePath.ts
- src/components/timeline/utils/timelineClipCanvasWaveformSpikes.ts (new, optional)

Forbidden: everything else — especially useTimelineClipCanvasAudioWarmups.ts (another worker owns it right now), the worker contract/model files, and the resource builder.

Checks you MUST run and report verbatim output for:
- npx tsc -b --pretty false
- rg -n "drawTransientPeakSpikes|TransientSpike" src/components/timeline
- (do NOT attempt vitest — the orchestrator runs it after you finish)

Do NOT commit. Never delete/revert files outside your write set.

Report: rationale, checks with actual output, how worker/main parity is guaranteed, risks.
Stop conditions: if parity requires touching the worker contract or resource builder, STOP and report.
