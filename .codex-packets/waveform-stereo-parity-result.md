Implemented `waveform-stereo-worker-parity` without touching the main-thread painter.

**Files changed**
- [timelineClipCanvasWorkerContract.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/utils/timelineClipCanvasWorkerContract.ts:47): added optional per-channel waveform payloads while keeping legacy `columns` / `columnCount`.
- [timelineClipCanvasWaveformResource.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/utils/timelineClipCanvasWaveformResource.ts:77): worker resource builder now builds normalized columns for every resolved render channel.
- [timelineClipCanvasWorkerModel.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/utils/timelineClipCanvasWorkerModel.ts:185): normal clip waveforms preserve channels and pack them into one transfer buffer.
- [timelineClipCanvasWorkerWaveformPainter.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts:24): worker painter now lays out stereo lanes with `laneGap = 2`, per-lane drawing, and separators.
- [timelineClipCanvas.worker.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/workers/timelineClipCanvas.worker.ts:204): updated both waveform call sites to pass the full resource.

**Readers handled**
- `drawWorkerWaveformColumns` callers: only [timelineClipCanvas.worker.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/workers/timelineClipCanvas.worker.ts:204), updated for clip waveforms and composition mixdowns.
- `timelineClipCanvasWorkerModel.ts`: normal waveform clone now preserves stereo channels; `.columns` remains the packed transfer buffer.
- `timelineClipCanvasWorkerPayloadMetrics.ts`: unchanged; byte counting still works because worker-facing `.columns.byteLength` now includes packed channel data.
- `timelineClipCanvasWorkerPreparedResources.ts`: unchanged; optional `channels` keeps legacy composition mixdown clone compatible. Mixdowns remain mono as before.
- Other `mixdownWaveform` hits are raw timeline/source data paths, not worker resource consumers.

**Checks**
`npx tsc -b --pretty false`
```text
```

`rg -n "channels|columnCount" src/components/timeline/utils/timelineClipCanvasWorkerContract.ts`
```text
49:  columnCount: number;
55:  columnCount: number;
56:  channels?: readonly TimelineClipCanvasWorkerWaveformChannelResource[];
```

I did not run vitest, per packet instruction. Risks: no visual/browser screenshot was run in this worker packet; verification is type-level plus scoped code audit. The worktree also has an unrelated untracked `.codex-packets/` directory that I did not touch.