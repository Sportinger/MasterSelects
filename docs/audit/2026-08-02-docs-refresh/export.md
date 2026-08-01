# Export.md — audit 2026-08-02

## Verified (spot checks that held)

- The panel has WebCodecs, HTMLVideo, and FFmpeg workflows; the container chooser also exposes image, audio, and FCPXML outputs (`src/components/export/panel/ExportTopSections.tsx`, `src/components/export/panel/ExportBasicsSection.tsx`, `src/stores/exportStore.ts`).
- Browser video export supports MP4/WebM and runtime-checks H.264, H.265, VP9, and AV1; WebM is restricted to VP9/AV1 (`src/engine/export/codecHelpers.ts`, `src/engine/export/VideoEncoderWrapper.ts`).
- Stacked alpha doubles export-canvas height and uses the `stackedAlpha` output mode (`src/engine/managers/ExportCanvasManager.ts`, `src/engine/pipeline/OutputPipeline.ts`, `src/engine/export/FrameExporter.ts`).
- GIF, WAV/MP3/browser audio, image frame/sequence, FFmpeg, and FCPXML paths are implemented by dedicated runners (`src/components/export/runners/gifExportRunner.ts`, `audioOnlyExportRunner.ts`, `stillImageExportRunner.ts`, `imageSequenceExportRunner.ts`, `ffmpegDirectExportRunner.ts`, `fcpxmlExportRunner.ts`).
- FFmpeg loads the local `/ffmpeg` core, uses synchronous `callMain()`, reports parsed progress, and exposes ProRes, DNxHR, MJPEG, FFV1, UT Video, and GIF (`src/engine/ffmpeg/FFmpegBridge.ts`, `src/engine/ffmpeg/codecs.ts`).
- FCPXML 1.10 exports clip/timing/track references, deliberately skips compositions and text, and can include audio references (`src/services/export/fcpxmlExport.ts`).
- Project save/load persists export settings, presets, selected preset, and batch state (`src/services/project/projectSave.ts`, `src/services/project/load/loadDockFlashboardHydration.ts`, `src/stores/exportStore.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “Uses `ParallelDecodeManager` when multiple clips are present” → regular multi-clip Fast exports use source-shared sequential WebCodecs decoders; parallel decode is selected for nested video clips (`src/engine/export/clipPreparation/fastMode.ts`, `src/engine/export/clipPreparation/parallelMode.ts`).
- “Large source media is routed to HTMLVideo Precise” and the stated 1.5 GB / 2 GB limits → no matching size-guard or automatic Fast-to-Precise fallback exists in the current export preparation code; Fast failures are surfaced and the user selects Precise explicitly (`src/engine/export/ClipPreparation.ts`, `src/engine/export/clipPreparation/fastMode.ts`, `src/engine/export/clipPreparation/preciseMode.ts`).
- “Export-tab changes participate in global undo/redo” → `exportStore` is persisted and auto-synced, but it does not call the timeline history APIs; timeline editing code owns snapshot capture (`src/stores/exportStore.ts`, `src/services/project/projectLifecycle.ts`, `src/stores/historyStore.ts`).
- “Frame mode renders only the current playhead frame” → true for timeline still-image export, but direct-source batch image jobs encode the complete source file and bypass In/Out markers (`src/components/export/panel/ExportImageControls.tsx`, `src/components/export/panel/ExportBasicsSection.tsx`, `src/components/export/batch/BatchSourceExportRunner.ts`).
- “The PNG frame export action calls `engine.readPixels()`, copies to a canvas, then exports PNG” → current still-image export reads the export-render-session pixels and encodes the selected PNG/JPG/WebP/BMP format; it is not PNG-only and does not use that documented canvas path (`src/components/export/runners/stillImageExportRunner.ts`, `src/components/export/runners/runnerUtils.ts`).

## Noteworthy / unusual

- Batch source export is shipped but was absent from the feature document. It has queue, shared-settings, and per-job runtime modules (`src/components/export/batch/BatchExportQueue.tsx`, `useBatchExportController.ts`, `BatchSourceExportRunner.ts`).
- Browser GIF export has explicit memory/output admission caps (384 MiB raw frames and 512 MiB estimated output), while FFmpeg GIF has a separate pipeline (`src/engine/export/BrowserGifExporter.ts`, `src/components/export/runners/gifExportRunner.ts`, `src/components/export/runners/ffmpegDirectExportRunner.ts`).
- The FFmpeg loader injects a UMD script and relies on `window.createFFmpegCore`; that is a deliberate but browser-global integration point (`src/engine/ffmpeg/FFmpegBridge.ts`).
- Some visible export UI strings contain mojibake, including workflow select labels and batch-queue symbols; this is unrelated to the doc but likely user-visible (`src/components/export/panel/ExportTopSections.tsx`, `src/components/export/batch/BatchExportQueue.tsx`).
