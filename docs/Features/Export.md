# Export

[Back to Index](./README.md)

Video export, image export, audio-only export, transparent stacked-alpha export, FFmpeg WASM intermediates, named export presets, and FCPXML interchange.

---

## Overview

The export panel currently exposes three live encoder paths:

- `webcodecs` for the fast frame-by-frame pipeline
- `htmlvideo` for the precise HTML-video-seeking pipeline
- `ffmpeg` for the CPU FFmpeg WASM pipeline

FCPXML is exposed as a selectable export container for NLE interchange.

### Current Panel Layout

- A sticky summary bar at the top shows compact badges plus the primary export button.
- Clicking a summary badge smooth-scrolls to the related control group and briefly highlights it.
- A compact command row above `Basic` contains a project-persistent preset list plus `Load`, `Update`, and `Save`.
- The workflow picker (`WebCodecs`, `HTMLVideo`, `FFmpeg`) is its own section above `Basic`.
- `Basic` contains output naming and container selection. The container row is grouped by `Video`, `Image`, `Audio`, and `XML`, and switches output mode by selecting a deliverable directly.
- The `Video` group contains codec selection, resolution, frame rate, bitrate/rate controls, stacked-alpha, and range toggles.
- In `Image` mode the same middle group becomes an `Image` panel with format-aware resolution and quality controls, and it exports only the current playhead frame.
- The `Audio` group contains sample rate, bitrate, normalization, and audio-only range controls.
- Lower in the panel, legacy `Advanced Video`, `Advanced Audio`, and `Range & Summary` sections still exist for raw-value access.
- Export settings and preset selection now live in a shared store, so changes inside the Export tab participate in global undo/redo and are restored with the project.

### Export Presets

- Presets are stored per project, not in browser-only local storage.
- `Save` prompts for a name and creates a new preset or overwrites an existing preset with the same name.
- `Update` overwrites the currently selected preset without asking for a new name.
- `Load` restores the selected preset back into the live export settings.
- Presets and the current export settings are written into the project UI state and restored with the project.

---

## WebCodecs And HTMLVideo Export

`FrameExporter` is used for both the WebCodecs and HTMLVideo export buttons.

Canvas-backed sources such as text, solids, and Lottie are re-rendered for every export frame before capture, so the exported frame matches the current timeline time instead of reusing a stale first-frame texture.

### Fast Mode

- Uses WebCodecs sequential decoding for a single clip.
- Uses `ParallelDecodeManager` when multiple clips are present in the export range.
- Parses source media with MP4Box.
- Prefetches frames ahead of the render position.
- Can fall back to HTMLVideo-based precise export on specific decode or file-size failures.

### Precise Mode

- Uses detached `HTMLVideoElement` instances and browser seeking.
- Tries to wait for ready state and a fresh frame before export captures.
- Is slower than fast mode, but it is the compatibility fallback when fast mode fails.

### Automatic Fallbacks

- Large source media can bypass fast mode and switch directly to precise mode.
- Fast mode also retries precise mode on known decode / buffer / unsupported-file failures.

### Current File-Size Thresholds

- Single source file limit: 1.5 GB
- Total source files limit: 2 GB

These are current code limits, not generic recommendations.

---

## Output Codec Support

### WebCodecs / HTMLVideo Export

Supported containers:

- MP4
- WebM

Supported codecs are checked at runtime:

- H.264
- H.265
- VP9
- AV1

### Runtime Behavior

- WebM is limited to VP9 or AV1.
- MP4 accepts the full codec list, but browser support is still checked with `VideoEncoder.isConfigSupported()`.
- Unsupported combinations are not silently promised by the docs; they must pass the runtime checks or be remapped by the encoder logic.
- The selected bitrate is passed into `VideoEncoder`, but in the WebCodecs path it is still a target, not a guaranteed final file bitrate.
- `rateControl = cbr` maps to `VideoEncoderConfig.bitrateMode = "constant"` and falls back to variable bitrate if constant mode is rejected during encoder configuration.
- Browser encoders can still undershoot the requested bitrate on simple material, so the panel treats file size as a target estimate rather than an exact promise.

---

## Stacked Alpha Export

`stackedAlpha` is supported in the WebCodecs / HTMLVideo export path.

### How It Works

- The export canvas height is doubled.
- The top half contains RGB.
- The bottom half contains alpha as grayscale.
- `OutputPipeline` mode `2` and `ExportCanvasManager` handle the stacked-alpha render path.

### Limitation

- This is a stacked-alpha format, not a conventional single-layer transparent video container.

---

## Audio Export

Audio export is handled separately from the video encoder.

### Current Flow

- Audio is extracted from the selected timeline range.
- `AudioExportPipeline` renders the mixed audio.
- WebCodecs export can mux the audio chunks into the final file.

### Supported Behavior

- AAC is used for MP4 when supported.
- Opus is used for WebM when supported.
- If the browser cannot encode a usable audio format, the export can proceed without audio.

### Limitation

- The docs should not promise every container will always carry audio. The code checks support first and may disable audio for unsupported browsers or containers.

---

## Image Export

Image export renders a single composited frame at the current playhead position.

### Supported Formats

- PNG
- JPG
- WebP
- BMP

### Current Behavior

- The export does not use the In/Out range. It always renders only the current playhead frame.
- Custom resolution still applies before the image is written.
- PNG and BMP are exported losslessly.
- JPG and WebP expose a quality control in the panel.
- Audio is ignored while image export is active.

---

## FFmpeg Export

The FFmpeg path is a separate CPU-based export pipeline.

### Current Build Characteristics

- Loads the FFmpeg core from the local `/ffmpeg` path on demand.
- Uses a single synchronous `callMain()` execution model.
- Blocks the UI while encoding is running.
- Reports progress from FFmpeg log output where possible.

### Supported Video Codecs

- ProRes
- DNxHR / DNxHD family
- FFV1
- UTVideo
- MJPEG

### Supported Containers

- MOV
- MKV
- AVI
- MXF

### Current Limitations

- HAP is not available in this build.
- This build does not expose a shared decoder pool.
- Multi-threaded mode is only reported as a capability check; the exported core path is still synchronous.
- `callMain()` blocks while encoding, so it is not the same runtime profile as the WebCodecs path.

---

## FCPXML Export

FCPXML export is available through the container chooser as `.fcpxml`.

### What It Exports

- Timeline structure
- Clip timing and track layout
- Basic audio placement

### What It Does Not Export

- Compositions are skipped
- Text clips are skipped
- The XML points back to media by file reference, so it is an interchange file, not a self-contained rendered deliverable

### Limitation

- This is useful for NLE round-tripping, not for final media delivery.

---

## Frame Export

The PNG frame export action reads the current composited frame from the GPU.

### Current Path

- `engine.readPixels()` reads the frame back from GPU memory.
- The pixels are copied into a canvas.
- The canvas is then exported as a PNG file.

### Limitation

- This path is a CPU readback. It is correct, but it is not a zero-copy route.

---

## Export Process Notes

### WebCodecs / HTMLVideo

1. Prepare clips and runtimes for the selected export mode.
2. Seek all clips to each export time.
3. Build layers for that frame.
4. Render through the GPU engine.
5. Capture a `VideoFrame` from the export canvas when possible, otherwise fall back to pixel readback.
6. Encode and mux the file.

### FFmpeg

1. Render each frame through the GPU engine.
2. Read pixels from the GPU.
3. Collect frames in memory.
4. Extract audio if enabled.
5. Run FFmpeg encoding.

### Limitation

- Neither path is background rendering. Both depend on the current browser session.

---

## Current Limitations

- Preview and export are separate pipelines, even though they reuse the same engine.
- Precise export still depends on browser media readiness and seek behavior.
- FFmpeg export is blocking.
- The exporter does not currently provide a true multi-pass render pipeline.

---

## Sources

Key implementation files:

- `src/components/export/ExportPanel.tsx`
- `src/components/export/useExportState.ts`
- `src/components/export/exportHelpers.ts`
- `src/engine/export/FrameExporter.ts`
- `src/engine/export/ClipPreparation.ts`
- `src/engine/export/VideoSeeker.ts`
- `src/engine/export/VideoEncoderWrapper.ts`
- `src/engine/export/codecHelpers.ts`
- `src/engine/managers/ExportCanvasManager.ts`
- `src/engine/pipeline/OutputPipeline.ts`
- `src/services/export/fcpxmlExport.ts`
- `src/engine/ffmpeg/FFmpegBridge.ts`
- `src/engine/ffmpeg/codecs.ts`
