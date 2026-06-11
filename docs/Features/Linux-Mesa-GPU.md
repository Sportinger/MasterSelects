# Linux / Mesa GPU Constraints

[Back to Index](./README.md)

**Read this before adding or refactoring anything that renders to a `<canvas>`,
an `OffscreenCanvas`, or a WebGPU surface.** This is the single most common
source of "works on Windows, blank on Linux" regressions in this project.

---

## Why this keeps happening

MasterSelects is developed and smoke-tested primarily on Windows with
proprietary GPU drivers. A large share of our Linux users run the **open-source
Mesa stack** (RADV / radeonsi for AMD, NVK for NVIDIA, llvmpipe for software),
often on hybrid laptops (AMD Renoir iGPU + discrete NVIDIA). Mesa's WebGPU
(Vulkan via Dawn) and GPU-accelerated 2D canvas paths are **stricter and fail
more silently** than the drivers we develop against.

Combined with the project's "everything becomes a GPU signal" architecture —
which pushes video, audio, images, and timeline chrome through WebGPU and
GPU-accelerated canvases — every new GPU/canvas feature can independently
rediscover the same Mesa limits. The fix is not to special-case bugs one by one
after they ship, but to **design canvas/GPU code against the constraints below
from the start**, and route platform decisions through the shared helpers.

The defining property of these failures: **no exception is thrown, nothing
returns null, diagnostics report success.** The draw calls "work"; the pixels
just never reach the screen. Do not rely on try/catch or return values to detect
them.

---

## Known Mesa failure modes

| # | Symptom | Mechanism | Mitigation in code |
|---|---------|-----------|--------------------|
| 1 | A `<canvas>` goes **blank** past a certain size / when zoomed | An over-sized GPU-accelerated canvas (backing store beyond what the driver will composite) renders nothing. `MAX_TEXTURE_SIZE` (often 16384) is *not* a safe target on Mesa. | Size canvases to the **visible viewport + overscan**, never the full content width. Cap the backing store well below the hardware max. See `TimelineClipCanvas.tsx`. |
| 2 | A worker-driven `OffscreenCanvas` shows for **short** lanes but not **taller** ones | `transferControlToOffscreen()` + a worker 2D context fails to composite the placeholder element for larger surfaces. | Prefer the main-thread renderer on Linux. See `useTimelineClipCanvasWorkerRuntime.ts`. |
| 3 | Canvas content **disappears on minimize/restore**, returning only on hover/interaction | The GPU discards the accelerated canvas backing on visibility change; nothing triggers a repaint. | Use a **software raster** (`getContext('2d', { willReadFrequently: true })`) on Linux — CPU-backed surfaces survive visibility changes and composite like any bitmap. See `useTimelineClipCanvasMainThreadDraw.ts`. |
| 4 | Video preview is **black**, render loop stalls, then device lost | `device.importExternalTexture({ source })` returns an *invalid-but-not-null* `GPUExternalTexture` on Mesa (Dawn `ImportMemory` size mismatch), or `vkAllocateMemory` OOM on hybrid GPUs. See issue #46. | WebGPU video path; separate from the canvas issues above. Treat external textures as suspect on Linux. |
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
4. **Prefer software raster on Linux** for long-lived 2D canvases
   (`willReadFrequently: true`). It avoids the size-blank, the worker-composite,
   and the minimize/restore failure modes at once.
5. **Route platform decisions through one helper.** Use
   `prefersSoftwareTimelineCanvas()` (`src/components/timeline/utils/timelineCanvasPlatform.ts`),
   which mirrors `WebGPUContext.shouldUseLowPowerFallback()`. Do not scatter ad
   hoc `navigator.platform` checks.
6. **Never trust silent success.** Draw calls completing, diagnostics reporting
   N clips drawn, or `getImageData` showing pixels do **not** prove the canvas
   is on screen. Compositing is a separate step the page cannot observe.

---

## How to diagnose (no console access required)

These bugs were diagnosed entirely through the AI debug bridge (see
[Debugging](./Debugging.md)):

- `getStats` → `timelineCanvas` diagnostics report per-track `workerMode`,
  `drawnClipCount`, and `workerError`. "All drawn, no errors, nothing visible"
  is the signature of a compositing/size failure.
- Temporary `Logger.warn(...)` probes read back through `getLogs` can report a
  canvas's backing dimensions, `getImageData` opaque-pixel counts, and computed
  visibility — enough to separate a size/compositing failure from a CSS
  regression or a genuine empty backing, without the user touching DevTools.

---

## Where the gates live

- `src/components/timeline/utils/timelineCanvasPlatform.ts` — the
  `prefersSoftwareTimelineCanvas()` Linux gate.
- `src/components/timeline/TimelineClipCanvas.tsx` — viewport-size cap (rules 1–2).
- `src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime.ts` — worker
  disabled on Linux (rule 3).
- `src/components/timeline/hooks/useTimelineClipCanvasMainThreadDraw.ts` —
  `willReadFrequently` software raster on Linux (rule 4).
- `src/engine/core/WebGPUContext.ts` — `shouldUseLowPowerFallback()`,
  hybrid-GPU recovery, and the timeout warnings (modes 4–5).

History: issue #259 (timeline lanes blank on Linux after the #228 GPU clip-canvas
refactor) and issue #46 (`importExternalTexture` silent failure on Mesa).
