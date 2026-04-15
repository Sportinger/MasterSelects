# GPU Engine

[Back to Index](./README.md)

WebGPU rendering, texture management, preview output, export capture, and GPU-backed analysis.

---

## Overview

`WebGPUEngine` is a thin facade over the rendering subsystems. It owns WebGPU context setup, texture and cache managers, the render loop, the render dispatcher, output windows, and export canvas state.

The engine currently supports:

- Main preview rendering
- Independent preview targets
- Popup output windows
- Sliced output / corner-pin rendering
- RAM preview and scrubbing caches
- Zero-copy export frames when the export canvas path is available
- CPU readback as a fallback path

---

## Architecture

### Core Pieces

- `WebGPUContext` handles adapter/device setup and device-loss recovery.
- `RenderLoop` runs the RAF loop, idle detection, scrub limiting, and watchdog recovery.
- `RenderDispatcher` handles per-frame texture import, compositing, output, and preview fallbacks.
- `RenderTargetManager` owns ping/pong compositing buffers plus independent preview buffers.
- `TextureManager` and `MaskTextureManager` manage image/video/mask textures.
- `CacheManager` owns scrubbing cache, composite RAM preview cache, and GPU frame cache.
- `ExportCanvasManager` owns the export OffscreenCanvas and stacked-alpha mode.

### Runtime State

- The engine keeps a unified `Map` of target canvases.
- Preview canvases and output windows are reconfigured after device restore.
- HMR reuses the engine singleton when possible.

---

## Texture Paths

### Video

- `HTMLVideoElement` is imported as an external texture when the browser supports it.
- `VideoFrame` can also be imported as an external texture.
- Firefox preview uses copied textures instead of external video import because imported frames can intermittently go black.

### Images And Canvas

- Images and canvases are copied into `rgba8unorm` GPU textures.
- Cached image views are reused when possible.

### Masks

- Mask textures are uploaded per layer.
- A 1x1 white fallback texture is used when no mask is present.

### Limitation

- The zero-copy path only applies when the browser and source type support it. Preview and export still have explicit fallback paths.

---

## Render Loop

### Idle And Scrub Control

- Idle mode starts after about 1 second of no activity.
- Idle detection is suppressed until the first play event so browser video surfaces can warm up.
- Playback is limited to about 60 fps.
- Scrubbing is limited to about 30 fps unless a fresh video frame arrives.

### Watchdog

- A watchdog checks for stalls every 2 seconds.
- If the render loop stops producing frames for about 3 seconds while it should be active, it wakes the loop or restarts it.

### Export And RAM Preview

- The render loop skips preview rendering while export is active.
- Export and RAM preview both set flags through `ExportCanvasManager`.
- These modes are separate from the normal preview path, but they share the same engine.

---

## Preview Fallback Chain

`RenderDispatcher` uses a best-effort chain for video preview:

1. Cached scrubbing frame
2. Copied fallback frame
3. Live external texture import
4. Last known frame or same-clip hold frame

This is why preview can stay stable during seeks even when a fresh frame is not yet ready.

### Firefox Special Case

- Firefox uses `getCopiedHtmlVideoPreviewFrame()` for HTML video preview stability.
- That path copies the current video frame into a persistent GPU texture and falls back to the previous stable frame when needed.

---

## Output And Export

### OutputPipeline

- The output pipeline uses separate uniform buffers for transparency grid off/on and stacked-alpha export.
- `renderToCanvas()` catches canvas-context loss and simply skips that target for the frame.
- Bind-group caches are separate per output mode.

### Stacked Alpha

- Stacked alpha doubles the encoded export height.
- RGB is rendered in the top half and alpha grayscale in the bottom half.
- `ExportCanvasManager` creates the doubled-height OffscreenCanvas when stacked alpha is enabled.

### Readback

- `readPixels()` is the CPU fallback path.
- It is used by export fallback paths and preview capture utilities.
- It is slower than the zero-copy export path and should be treated as a fallback, not the normal route.

---

## Export Canvas

`ExportCanvasManager` is responsible for export-state flags and the export canvas lifecycle.

### Current Behavior

- `initExportCanvas()` creates an OffscreenCanvas with WebGPU context.
- `createVideoFrameFromExport()` waits for `device.queue.onSubmittedWorkDone()` before constructing a `VideoFrame`.
- If the zero-copy path cannot be created, export falls back to `readPixels()`.
- `cleanupExportCanvas()` clears the canvas and stacked-alpha state after export.

### Limitation

- Zero-copy export only works when OffscreenCanvas + WebGPU + `VideoFrame` creation are available and the export canvas can be configured.

---

## Feature Flags

Runtime flags are exposed on `window.__ENGINE_FLAGS__`.

- `useRenderGraph` is still a stub.
- `useDecoderPool` is not wired.
- `useFullWebCodecsPlayback` and `disableHtmlPreviewFallback` are synced with the persisted settings toggle.
- `useLiveSlotTrigger` swaps slot-grid clicks from editor-open behavior to direct live triggering.
- `useWarmSlotDecks` prepares reusable slot-owned live decks for faster layer adoption.
- `use3DLayers` and `useGaussianSplat` are enabled in this branch.

---

## Performance Notes

- `ScrubbingCache` keeps 300 video scrub frames at 30 fps quantization.
- Composite RAM preview caches are capped at 900 frames and 512 MB.
- GPU RAM preview cache is capped at 60 frames.
- These are hard cache limits from code, not benchmark promises.

### Preview Quality

- `useEngine()` scales the active-composition base resolution by the persisted preview-quality multiplier before calling `engine.setResolution(...)`.
- `Full`, `Half`, and `Quarter` therefore change the GPU render size for engine-backed preview targets.
- Export output resolution still comes from the composition/export settings, not from preview quality.

---

## Troubleshooting

| Problem | What To Check |
|---|---|
| Black preview after reload | Video GPU surfaces may not be warm yet. The engine suppresses idle until first play, but browser readiness still matters. |
| Firefox preview instability | HTML video fallback should be using copied textures, not external import. |
| Export canvas missing | Verify WebGPU context creation on OffscreenCanvas and device validity. |
| Device lost | The engine attempts recovery and reconfigures canvases, but a manual reload may still be needed. |

---

## Sources

Key implementation files:

- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/RenderLoop.ts`
- `src/engine/render/htmlVideoPreviewFallback.ts`
- `src/engine/pipeline/OutputPipeline.ts`
- `src/engine/managers/ExportCanvasManager.ts`
- `src/engine/texture/ScrubbingCache.ts`
- `src/engine/core/RenderTargetManager.ts`
- `src/engine/featureFlags.ts`
- `src/engine/video/VideoFrameManager.ts`
