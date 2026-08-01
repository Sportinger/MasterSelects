# Export

[Back to Index](./README.md)

Video export, animated GIF export, image export, audio-only export, transparent stacked-alpha export, FFmpeg WASM intermediates, named export presets, batch source export, and FCPXML interchange.

---

## Overview

The export panel currently exposes three live encoder paths:

- `webcodecs` for the fast frame-by-frame pipeline
- `htmlvideo` for the precise HTML-video-seeking pipeline
- `ffmpeg` for the CPU FFmpeg WASM pipeline

FCPXML is exposed as a selectable export container for NLE interchange.

### Current Panel Layout

- A sticky summary bar at the top wraps compact badges in at least two columns, ending in a green Export pill that includes the estimated file size when a byte estimate is available.
- Its first badge shows `SaC` when export resolution and frame rate match the active composition, or `NaC` otherwise; clicking `NaC` copies those composition settings into Export.
- Clicking a summary badge smooth-scrolls within that Export panel to the related control group and briefly highlights it.
- A compact command row above `Basic` contains a project-persistent preset list plus `Load`, `Update`, and `Save`.
- The workflow picker (`WebCodecs`, `HTMLVideo`, `FFmpeg`) is its own section above `Basic`.
- `Basic` contains output naming and container selection. The container row is grouped by `Video`, `Image`, `Audio`, and `XML`, and switches output mode by selecting a deliverable directly.
- The `Video` group contains codec selection, resolution, frame rate, bitrate/rate controls, animated GIF palette controls, stacked-alpha, and range toggles.
- The video resolution header includes a compact orientation pictogram. Orientation is independent from the selected preset, so `1080p`, `4K`, and the other preset pills stay selectable in portrait and `Custom` remains reserved for genuinely custom dimensions.
- Narrow dock panels never scroll horizontally: lower option groups stack to one column, chip grids step from three to two and finally one column at the narrowest breakpoint, and summary navigation scrolls only the panel's vertical form.
- In `Image` mode the same middle group becomes an `Image` panel with format-aware resolution and quality controls, and it can export either the current playhead frame or a numbered image sequence folder.
- The `Audio` group contains audio-only format selection, sample rate, bitrate for browser-compressed audio, normalization, and audio-only range controls.
- Lower in the panel, `Advanced Video`, `Advanced Audio`, and `Range & Summary` sections provide raw-value access.
- Export settings, presets, and the batch queue live in `exportStore` and are restored with the project. They are not timeline undo/redo history entries.

### Export Presets

- Presets are stored per project, not in browser-only local storage.
- `Save` prompts for a name and creates a new preset or overwrites an existing preset with the same name.
- `Update` overwrites the currently selected preset without asking for a new name.
- `Load` restores the selected preset back into the live export settings.
- Presets and the current export settings are written into the project UI state and restored with the project.

---

## WebCodecs And HTMLVideo Export

`FrameExporter` is used for both the WebCodecs and HTMLVideo export buttons.

Canvas-backed sources such as text, solids, Lottie, and Rive are re-rendered for every export frame before capture, so the exported frame matches the current timeline time instead of reusing a stale first-frame texture. Motion shape clips are built as `motion` layer sources and rendered by the WebGPU motion renderer at export frame time before compositing.

### Fast Mode

- Uses WebCodecs sequential decoding for a single clip.
- Regular multi-clip exports use source-shared sequential WebCodecs decoders; nested-composition video clips use `ParallelDecodeManager`.
- Parses source media with MP4Box.
- Decode, buffer, and unsupported-file failures remain in the selected workflow. Errors are logged and surfaced; Fast mode does not automatically switch to HTMLVideo.

### Precise Mode

- Uses detached `HTMLVideoElement` instances and browser seeking.
- Tries to wait for ready state and a fresh frame before export captures.
- Is slower than fast mode, but it is the explicit compatibility choice for difficult files or timing cases.

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
- MP4 accepts the full codec list, but browser support is checked with `VideoEncoder.isConfigSupported()`.
- Unsupported combinations are not silently promised by the docs; they must pass the runtime checks or be remapped by the encoder logic.
- The selected bitrate is passed into `VideoEncoder`, but in the WebCodecs path it is a target, not a guaranteed final file bitrate.
- `rateControl = cbr` maps to `VideoEncoderConfig.bitrateMode = "constant"` and falls back to variable bitrate if constant mode is rejected during encoder configuration.
- Browser encoders can undershoot the requested bitrate on simple material, so the panel treats file size as a target estimate rather than an exact promise.

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

## Animated GIF Export

Animated GIF is exposed as `.gif` in the video container group.

### Browser GIF Mode

- Available from the WebCodecs / HTMLVideo workflow selector, but GIF is not a WebCodecs codec.
- Uses the same frame-accurate browser render path, then encodes indexed GIF frames with the `gifenc` JavaScript encoder.
- Supports palette size, global vs per-frame palette mode, forever/once/count loop modes, transparent or opaque GIF output, and binary alpha threshold.
- Uses fast quantization without dithering because `gifenc` has no dithering support.
- Does not support audio.
- Uses the GIF size estimator instead of video bitrate math.
- Stops before rendering when the selected range would exceed the browser encoder's memory budget; use FFmpeg GIF or reduce duration, FPS, or resolution for larger exports.

### FFmpeg GIF Mode

- Available from the FFmpeg workflow selector.
- Uses FFmpeg `palettegen` and `paletteuse` for palette-quality output.
- Supports palette size, global/per-frame palette behavior, dithering, Bayer scale, forever/once/count loop modes, transparent or opaque GIF output, transparency threshold, and frame-difference optimization.
- Does not extract or mux audio.

### Size Estimation

- GIF estimates are based on output pixels, frame count, palette size, dither mode, palette mode, transparency mode, and optimization settings.
- The panel shows a single estimate and a content-dependent range because GIF LZW compression varies heavily with motion, noise, and transparency.
- MP4/WebM estimates continue to use bitrate targets.

---

## Audio Export

Audio export is handled separately from the video encoder.

### Current Flow

- Audio is extracted from the selected timeline range.
- `AudioExportPipeline` renders the mixed audio through the same clip-local path used for processed timeline waveforms.
- Audio-only WAV export writes the mixed `AudioBuffer` as 16-bit PCM WAV.
- WebCodecs export can mux the audio chunks into the final file.

### Supported Behavior

- Audio-only export supports uncompressed WAV (`.wav`) without WebCodecs audio encoding.
- Audio-only export supports MP3 (`.mp3`) through the browser-side Mediabunny MP3 encoder package, without the Native Helper.
- Browser-compressed audio-only export writes AAC (`.aac`) or Opus (`.ogg`), according to runtime support.
- AAC is used for MP4 when supported.
- Opus is used for WebM when supported.
- Clip-local trim, region edit-stack operations including paste/insert/delete silence, reverse, speed/pitch, mute, EQ, and volume are rendered before mixing.
- If the browser cannot encode a usable audio format, the export can proceed without audio.

### Limitation

- Audio availability is determined by browser and container support; export may proceed without audio when no supported format is available.

---

## Image Export

Image export can render a single composited frame at the current playhead position or a numbered still-image sequence over the selected range.

### Supported Formats

- PNG
- JPG
- WebP
- BMP

### Current Behavior

- Timeline `Frame` mode does not use the In/Out range. It renders only the current playhead frame. Direct source batch export instead encodes the complete source image.
- `Sequence` mode uses the normal export range, respects `Use In/Out`, renders at the selected frame rate, and writes numbered image files into a user-selected folder when the browser supports File System Access.
- Browsers without folder write access fall back to a ZIP download.
- Custom resolution still applies before the image is written.
- PNG and BMP are exported losslessly.
- JPG and WebP expose a quality control in the panel.
- Audio is ignored while image export is active.

### Batch Source Export

- Media files can be queued for batch export from the export panel.
- The queue can use each job's own settings or apply one shared technical configuration while retaining individual file names.
- Direct source jobs bypass timeline-only outputs and In/Out markers; source images are exported at the selected output resolution.

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
- Animated GIF

### Supported Containers

- MOV
- MKV
- AVI
- MXF
- GIF

### Current Limitations

- HAP is not available in this build.
- GIF export is silent.
- This build does not expose a shared decoder pool.
- Multi-threaded mode is only reported as a capability check; the exported core path is synchronous.
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

Still-image export renders the current composited frame through an export render session.

### Current Path

- The runner reads back the rendered RGBA pixels.
- It encodes the pixels as PNG, JPG, WebP, or BMP according to the selected image format.

### Limitation

- Still-image and image-sequence paths use CPU pixel readback.

---

## Export Process Notes

### WebCodecs / HTMLVideo

1. Prepare clips and runtimes for the selected export mode.
2. Seek all clips to each export time.
3. Build layers for that frame.
4. Render procedural motion shapes, nested compositions, transitions, and supported 3D assets, then composite through the GPU engine.
5. Capture a `VideoFrame` from the export canvas when possible, otherwise fall back to pixel readback.
6. Encode and mux the file.

### FFmpeg

1. Render each frame through the GPU engine.
2. Read pixels from the GPU.
3. Collect frames in memory.
4. Extract audio if enabled and the selected output supports audio.
5. Run FFmpeg encoding.

### Limitation

- Neither path is background rendering. Both depend on the current browser session.

### Browser Export Debugging

When export fails in the UI, reproduce the same browser-side path through the dev bridge before changing exporter code:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
$body = @{ tool = 'debugExport'; args = @{ includeAudio = $true; exportMode = 'fast'; download = $false; maxRuntimeMs = 25000 } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

`debugExport` calls `FrameExporter` in the active browser tab and returns blob metadata, sampled progress, engine readiness before/after, and recent Export/WebGPU logs. It intentionally does not download unless `download = $true`. Use `maxRuntimeMs` to cancel cleanly before a long bridge request appears hung.

Interpret the result as follows:

- Blob `size > 0`: browser export works; debug UI download/progress/preset handling next.
- `WebGPU device lost during export` plus broken `getStats` fields such as `renderLoop.isRunning=false`, `renderDispatcher=null`, or `targetCanvasCount=0`: hard-reload the browser tab or call `reloadApp`, then retest.
- Video-only timelines should skip audio work even if `includeAudio = $true`; a long "Rendering audio" phase usually points at audio-range detection.

---

## Current Limitations

- Preview and export are separate pipelines, even though they reuse the same engine.
- Precise export still depends on browser media readiness and seek behavior.
- FFmpeg export is blocking.
- The exporter does not provide a true multi-pass render pipeline.

---

## Sources

Key implementation files:

- `src/components/export/ExportPanel.tsx`
- `src/components/export/useExportState.ts`
- `src/components/export/useExportRunController.ts`
- `src/components/export/exportHelpers.ts`
- `src/components/export/runners/`
- `src/components/export/panel/`
- `src/engine/export/FrameExporter.ts`
- `src/engine/export/ClipPreparation.ts`
- `src/engine/export/BrowserGifExporter.ts`
- `src/engine/export/ImageSequenceExporter.ts`
- `src/engine/export/VideoSeeker.ts`
- `src/engine/export/VideoEncoderWrapper.ts`
- `src/engine/export/codecHelpers.ts`
- `src/engine/managers/ExportCanvasManager.ts`
- `src/engine/pipeline/OutputPipeline.ts`
- `src/services/export/fcpxmlExport.ts`
- `src/engine/ffmpeg/FFmpegBridge.ts`
- `src/engine/ffmpeg/codecs.ts`
