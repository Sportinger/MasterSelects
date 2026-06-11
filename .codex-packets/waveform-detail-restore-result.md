Implemented the bounded packet. I added [timelineClipCanvasWaveformSpikes.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/utils/timelineClipCanvasWaveformSpikes.ts) and wired it into detailed mode in both [timelineClipCanvasWaveformPainter.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts) and [timelineClipCanvasWorkerWaveformPainter.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts).

Rationale: the spike selection and drawing math is shared through one helper, preserving the old thresholds, percentile ratios, min gap, line widths, alpha formula, and RMS-based inner gap. Main-thread passes `WaveformColumn[]`; worker passes its existing packed `Float32Array` through `columnAt`, so no contract/resource changes were needed. Compact and spectral paths are unchanged.

Checks:

```text
npx tsc -b --pretty false
```

Output: no output.

```text
rg -n "drawTransientPeakSpikes|TransientSpike" src/components/timeline
```

```text
src/components/timeline\workers\timelineClipCanvasWorkerWaveformPainter.ts:2:import { drawTransientPeakSpikes } from '../utils/timelineClipCanvasWaveformSpikes';
src/components/timeline\workers\timelineClipCanvasWorkerWaveformPainter.ts:99:    drawTransientPeakSpikes(context, columnCount, columnAt, width, height);
src/components/timeline\utils\timelineClipCanvasWaveformPainter.ts:16:import { drawTransientPeakSpikes } from './timelineClipCanvasWaveformSpikes';
src/components\timeline\utils\timelineClipCanvasWaveformPainter.ts:51:  drawTransientPeakSpikes(ctx, columns.length, (index) => columns[index], width, height);
src/components\timeline\utils\timelineClipCanvasWaveformSpikes.ts:20:export function drawTransientPeakSpikes(
```

Parity is guaranteed by both painters calling the same helper with the same normalized column data shape. Risk is limited to detailed waveform rendering only; I did not run vitest per packet instructions and did not commit.