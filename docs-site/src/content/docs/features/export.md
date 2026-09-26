---
title: "Export"
---

[Back to Index](/features/readme/)

Video export, animated GIF export, image export, audio-only export, transparent stacked-alpha export, FFmpeg WASM intermediates, named export presets, batch source export, and FCPXML interchange.

---

## Overview

The export panel currently exposes three live encoder paths:

- `webcodecs` for the fast frame-by-frame pipeline
- `htmlvideo` for the precise HTML-video-seeking pipeline
- `ffmpeg` for the CPU FFmpeg WASM pipeline

FCPXML is exposed as a selectable export container for NLE interchange.

### Current Panel Layout

- During video export, red `Cancel` discards the run. Yellow `Finish File Early` below it finishes the current frame, finalizes the partial file, and downloads it. Available after the first frame in WebCodecs, HTMLVideo, FFmpeg, and HAP; disabled during preparation and finalization. Audio ends with the partial video (browser-compressed audio keeps only complete packets). Audio-only, GIF, image sequences, and batch conversion do not offer early finish.

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

- Export canvas capture snapshots the submitted GPU image immediately, without a per-frame `queue.onSubmittedWorkDone()` round trip. The retained `VideoFrame` remains valid if canvas cleanup happens afterward; capture no longer reads a nullable canvas field after yielding.
- A canvas capture failure still permits pixel readback, but disables repeated direct-capture attempts only for that export canvas. Initializing a new export retries the direct path.
- `tests/browser/export-canvas-probe.html` is a dev-only synthetic WebGPU check: it compares immediate/waited capture, verifies alternating frame pixels, encodes H.264, and reproduces the former cleanup race without changing a project. Its timings are not whole-editor export benchmarks.
- Uses WebCodecs sequential decoding for a single clip.
- FAST export resolves the requested time to a source sample, waits for that exact decoded frame, and fails if it stays unavailable instead of silently substituting a buffered neighbor. The Windows beta harness verifies the complete exported frame sequence with independently decoded frame counters.
- When a decoder withholds the exact frame past the first rolling window, FAST export submits a bounded number of later samples while releasing older buffered frames. This lets reordered frames arrive without accepting a neighboring frame in the output.
- Repeated short source-time jumps, such as frames from a sped-up clip, continue decoding from the current cursor and discard skipped outputs. Distant jumps restart at a keyframe.
- Regular multi-clip exports use source-shared sequential WebCodecs decoders; nested-composition video clips use `ParallelDecodeManager`.
- Parses source media with MP4Box.
- Decode, buffer, and unsupported-file failures remain in the selected workflow. Errors are logged and surfaced; Fast mode does not automatically switch to HTMLVideo.

### Precise Mode

Nested preview and export account for each composition wrapper's start time and trim when seeking deeper video sources.

- Uses detached `HTMLVideoElement` instances and browser seeking.
- Prepares nested video sources for the selected export range and parent trims. Ordinary forward 1x composition branches skip unused descendants; retimed or transition-driven branches keep conservative preparation. Composition wrappers do not consume video decoders.
- If a required video cannot be admitted within the media budget, preparation reports the failure before rendering.
- Waits for ready state and a fresh frame before capture. A temporarily unavailable nested source triggers the export readiness retry; an older preview composition texture is never accepted as the current export frame.
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
- AAC is the MP4 default. Browser exports default to 192 kbps and retry with a Chromium-compatible AAC bitrate when the requested bitrate is unsupported.
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

- A visual clip's **Export Current Frame** context-menu command renders the whole active composition at its full resolution, independent of preview quality. Its JPG has a black background, without preview overlays. Use the export panel's PNG or WebP format for transparency.
- Timeline `Frame` mode does not use the In/Out range. It renders only the current playhead frame. Direct source batch export instead encodes the complete source image.
- `Sequence` mode uses the normal export range, respects `Use In/Out`, renders at the selected frame rate, and writes numbered image files into a user-selected folder when the browser supports File System Access.
- Browsers without folder write access fall back to a ZIP download.
- Custom resolution still applies before the image is written.
- PNG and BMP are exported losslessly.
- JPG and WebP expose a quality control in the panel.
- Audio is ignored while image export is active.

### Glyph Artifact Export

When the current frame contains a supported glyph/cell treatment, the Advanced
panel can export the exact cell result independently of the normal raster
deliverable:

- **TXT** writes the character grid as plain UTF-8 text.
- **SVG** creates real vector `<text>` cells; it does not embed a raster frame.
- **Web Pack** bundles TXT, SVG, metadata, and optional gzip tracking sidecar
  data in a ZIP.

The exporter uses the same grid/ramp contract as the GPU glyph path. Files and
Blobs are created only for the download operation and are never stored in
durable project state.

### Batch Source Export

- Media files can be queued for batch export from the export panel.
- The queue can use each job's own settings or apply one shared technical configuration while retaining individual file names.
- Direct source jobs bypass timeline-only outputs and In/Out markers; source images are exported at the selected output resolution.

---

## Browser-Native HAP Export

HAP is a dedicated browser encoder choice rather than an FFmpeg codec. It
produces QuickTime `.mov` files through the WebGPU block encoder and exposes
HAP, HAP Alpha, and HAP Q formats for VJ and media-server playback. The export
summary, size estimate, progress UI, persistent presets, and project settings
all treat HAP as its own encoder; video exports use PCM audio when audio is
included.

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

Baked Datamosh transitions are prepared as ordinary project-backed video media before frame rendering. Preview and export therefore consume the same cached codec artifact; export does not run the I-frame-removal bake again. Isolated source renders used by the baker stage detached HTML video frames through a canvas before WebGPU import so a newly sought frame cannot collapse into a repeated source column.

WebCodecs decoder startup submits a bounded search window of up to 32 samples before waiting for delayed initial output. It does not insert a separate output wait after each small startup chunk; normal decoding still waits for its target, and end-of-source decoding still drains the decoder. This supports hardware decoders that briefly report an empty queue before delivering their first frame.

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

### Decoder loss while awaiting a frame

FAST export includes the final exact-frame wait in its bounded decoder recovery. If the browser loses the decoder after samples were submitted, export recreates it and restarts from the preceding keyframe once. It still requires the exact source frame; a missing frame or failed recreation produces an explicit failure instead of substituting a neighboring frame or retrying indefinitely.

Export submissions retain exclusive ownership until the runner and its cleanup settle. Same-tick duplicate starts and restart attempts during cancellation are ignored; cancellation leaves the timeline export lock in place until cleanup finishes. A later export can start normally after completion or failure.

### Encoder allocation during preparation

Video export checks codec support and selects the audio format before preparation, but allocates the video encoder only when the first RGBA or zero-copy frame is ready. Slow source loading, audio rendering, and asset preparation therefore do not hold an idle video codec that the browser can reclaim. Cancellation during preparation discards the pending encoder and muxer. This does not restore inaccessible source files or prevent resource loss after encoding has begun.
