---
title: "Linux / Mesa GPU Constraints"
---

[Back to Index](/features/readme/)

**Read this before adding or refactoring a `<canvas>`, `OffscreenCanvas`, or
WebGPU presentation path.** Linux fallback policy is shared across timeline
canvases, worker presentation, capture transforms, composition feedback, and
proxy scene-cut analysis. This remains a common source of "works on Windows,
blank on Linux" regressions.

---

## Why this keeps happening

MasterSelects is developed and smoke-tested primarily on Windows. On Linux,
the code treats the open-source Mesa stack and hybrid-GPU configurations as
requiring conservative canvas and WebGPU fallbacks. The shared platform gate
identifies Linux (excluding Android) from browser platform data.

Timeline chrome uses a viewport-bounded 2D canvas with worker rendering where
eligible; preview and output rendering use WebGPU. New canvas and GPU paths
must be designed against the constraints below and must use the shared fallback
policy where applicable.

These failures can be silent: successful draw calls or populated canvas
diagnostics do not prove that pixels were composited on screen. Do not rely
only on try/catch or return values when diagnosing them.

---

## Known Mesa failure modes

| # | Symptom | Mechanism | Mitigation in code |
|---|---------|-----------|--------------------|
| 1 | A `<canvas>` goes **blank** past a certain size / when zoomed | An oversized canvas backing store can fail to composite on Linux. The timeline guard does not use the WebGPU texture limit as its canvas limit. | Size canvases to the **visible viewport + overscan**, never the full content width. The timeline backing store is capped at 8192 device pixels. See `useTimelineClipCanvasViewport.ts`. |
| 2 | A worker-driven `OffscreenCanvas` shows for **short** lanes but not **taller** ones | `transferControlToOffscreen()` + a worker 2D context fails to composite the placeholder element for larger surfaces. | Prefer the main-thread renderer on Linux. See `useTimelineClipCanvasWorkerRuntime.ts`. |
| 3 | Canvas content **disappears on minimize/restore**, returning only on hover/interaction | GPU-backed canvas composition can be unreliable after visibility changes. | The Linux main-thread timeline path requests a 2D context with `willReadFrequently: true`; it is also used as the fallback after worker failure. See `timelineClipCanvasMainThreadSurface.ts`. |
| 4 | Video preview is **black**, render loop stalls, then device lost | `device.importExternalTexture({ source })` can return an invalid-but-not-null external texture on open-source Mesa drivers (issue #46). | WebGPU video path; separate from the canvas issues above. Treat external textures as suspect on Linux and retain the engine's adapter/device recovery paths. |
| 5 | Spurious `requestAdapter/requestDevice timed out after Nms` warnings even when WebGPU works | `WebGPUContext.withTimeout` does not clear its `setTimeout` when the real promise resolves first, so the timeout logs regardless. | Cosmetic log noise; `engineReady` is the source of truth. |

---

## Rules for canvas / GPU code

1. **Size to the viewport, not the content.** A timeline/scrolling canvas must
   span the visible viewport plus a small overscan and slide with the scroll
   offset. Never allocate a canvas as wide (or tall) as the full content; at
   high zoom it will exceed the compositable size and blank on Mesa.
2. **Cap the backing store.** Clamp `width * devicePixelRatio` and
   `height * devicePixelRatio` to a safe maximum (we use `8192`), independent of
   `MAX_TEXTURE_SIZE`.
3. **Be cautious with worker `OffscreenCanvas`.** It is an optimization, not a
   baseline. Gate it off where compositing is unreliable (Linux) and keep a
   first-class main-thread fallback that is exercised, not just theoretical.
4. **Prefer the shared Linux software fallback** for long-lived 2D canvases
   (`willReadFrequently: true`) where a canvas is used for pixel processing or
   presentation.
5. **Route canvas fallback decisions through one helper.** Use
   `prefersSoftwareTimelineCanvas()` from `src/utils/canvasPlatform.ts` (the
   timeline utility is a compatibility re-export). The WebGPU context retains
   its separate Linux low-power adapter fallback.
6. **Never trust silent success.** Draw calls completing, diagnostics reporting
   N clips drawn, or `getImageData` showing pixels do **not** prove the canvas
   is on screen. Compositing is a separate step the page cannot observe.
7. **Keep the main-thread path at parity with the worker path.** Because the
   timeline worker is gated off on Linux, the main-thread renderer is the only
   timeline clip-canvas path Linux users see. Fold the same live interaction
   geometry (drag/trim start/duration/in/out) into both paths; the current
   main-thread MIDI preview explicitly builds from geometry-adjusted clips.

---

## How to diagnose (no console access required)

Use the AI debug bridge (see [Debugging](/features/debugging/)):

- `getStats` → `timelineCanvas` diagnostics report per-track `workerMode`,
  `drawnClipCount`, and `workerError`. "All drawn, no errors, nothing visible"
  is the signature of a compositing/size failure.
- Temporary `Logger.warn(...)` probes read back through `getLogs` can report a
  canvas's backing dimensions, `getImageData` opaque-pixel counts, and computed
  visibility — enough to separate a size/compositing failure from a CSS
  regression or a genuine empty backing, without the user touching DevTools.

---

## Where the gates live

- `src/utils/canvasPlatform.ts` — the shared
  `prefersSoftwareTimelineCanvas()` Linux gate; `src/components/timeline/utils/timelineCanvasPlatform.ts`
  re-exports it for timeline callers.
- `src/components/timeline/hooks/useTimelineClipCanvasViewport.ts` —
  viewport-window sizing and the 8192-device-pixel backing-store cap (rules 1–2).
- `src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime.ts` — worker
  disabled on Linux (rule 3).
- `src/components/timeline/utils/timelineClipCanvasMainThreadSurface.ts` —
  `willReadFrequently` software raster on Linux (rule 4).
- `src/engine/core/WebGPUContext.ts` — `shouldUseLowPowerFallback()`,
  hybrid-GPU recovery, and the timeout warnings (modes 4–5).
- `src/services/render/renderHostPort.ts`,
  `src/services/capture/recording/frameTransform.ts`,
  `src/services/mediaRuntime/liveInputRuntime.ts`, and
  `src/services/sceneCutDetection/proxySceneCutAnalyzer.ts` — additional
  shipped consumers of the shared Linux canvas policy.
