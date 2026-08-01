# GPU-Engine.md — audit 2026-08-02

## Verified (spot checks that held)

- `WebGPUEngine` remains the main-thread facade and owns `WebGPUContext`, `CacheManager`, `ExportCanvasManager`, a unified `targetCanvases` map, device-loss reconfiguration, and output-window delegation (`src/engine/WebGPUEngine.ts`).
- Video external-texture import accepts both `HTMLVideoElement` and `VideoFrame`; image and canvas sources use `copyExternalImageToTexture` (`src/engine/texture/TextureManager.ts`). Firefox’s copied-video fallback still captures a persistent frame and falls back to the previous frame (`src/engine/render/htmlVideoPreviewFallback.ts`).
- Export still initializes an OffscreenCanvas, waits for `device.queue.onSubmittedWorkDone()` before creating a `VideoFrame`, and falls back to pixel readback (`src/engine/managers/ExportCanvasManager.ts`, `src/engine/export/ExportRenderSessionImpl.ts`). Stacked alpha remains double-height RGB-over-alpha-as-luma (`src/engine/managers/ExportCanvasManager.ts`, `src/engine/export/FrameExporter.ts`).
- The output pipeline has separate grid-on, grid-off, and stacked-alpha uniform/bind-group caches, and skips a canvas whose `getCurrentTexture()` throws (`src/engine/pipeline/OutputPipeline.ts`).
- Idle timeout (~1 s), watchdog cadence (2 s), watchdog stall threshold (~3 s), export render suppression, and HMR-persistent render-host state all remain implemented (`src/engine/render/RenderLoop.ts`, `src/services/render/renderHostPort.ts`, `src/hooks/useEngine.ts`).
- Composite RAM preview limits remain 900 frames / 512 MiB and the GPU RAM-preview cache remains 60 frames (`src/engine/texture/scrubbingCache/ramPreviewCache.ts`). Preview-quality scaling still applies the persisted multiplier before `renderHostPort.setResolution(...)` (`src/hooks/engine/useEngineResolutionSync.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “Scrubbing is limited to about 30 fps” → `SCRUB_FRAME_TIME` is 15 ms, so the current baseline is roughly 60 fps; a newly decoded frame still bypasses it (`src/engine/render/RenderLoop.ts`).
- “Idle detection is suppressed until the first play event” → reload warmup suppression is bounded to 3 seconds and can also end at first play (`src/engine/render/RenderLoop.ts`).
- “`ScrubbingCache` keeps 300 video scrub frames” → the GPU scrub-texture cache is capped at 192 frames and 192 MiB, with a 960-pixel maximum dimension; its key quantization remains 30 fps (`src/engine/texture/scrubbingCache/scrubTextureCache.ts`, `src/engine/texture/scrubbingCache/cacheKeys.ts`).
- “Grid Replicator MVP … capped at 100 instances” → `MOTION_REPLICATOR_SHADER_MAX_INSTANCES` and the default buffer capacity are 100,000. The effective count is additionally bounded by device, target, and user limits (`src/engine/motion/MotionTypes.ts`, `src/engine/motion/MotionFrameRuntime.ts`, `src/engine/motion/replicator/runtimeContracts.ts`).
- “`useRenderGraph` is still a stub” → no such runtime flag exists. The active feature-flag module contains no `useRenderGraph`, while the adjustment evidence records that the stale flag was removed and the shared compositor path is active (`src/engine/featureFlags.ts`, `docs/evidence/motion-design/md7-adjustment-render-graph.md`).
- The motion-appearance list omitted texture fill → shader kind 4 is texture fill, alongside the four listed kinds (`src/engine/motion/shaders/motionShapes.wgsl`, `src/engine/motion/MotionBuffers.ts`).

## Noteworthy / unusual

- `workerFirstRenderHost` is implemented but default-disabled; `renderHostPort` selects the main fallback unless the worker flag and runtime capability checks allow a worker host. The enabled `timelineCanvasWorker` flag is a separate eligible-row timeline renderer (`src/engine/featureFlags.ts`, `src/services/render/renderHostPort.ts`).
- GPU scopes are real but are not resources owned by `WebGPUEngine`: scope panels construct their own `ScopeRenderer` from the render host’s device (`src/components/panels/scopes/useScopeAnalysis.ts`, `src/engine/analysis/ScopeRenderer.ts`).
- The document’s old “Grid Replicator MVP” wording is materially behind the code: current motion code includes instanced replication, texture-fill handling, and a 100,000-instance shader ceiling, while the active plan retains completion gates for broader Motion Design work (`src/engine/motion/MotionRenderer.ts`, `src/engine/motion/MotionTypes.ts`, `docs/plans/motion-design-ai-completion-plan.md`).
- `useGaussianSplat` is true, and the dispatcher has native 3D-scene and Gaussian-splat loading/processing paths; the flag’s inline comment still calls it an “old WebGL path,” despite the current GPU renderer files (`src/engine/featureFlags.ts`, `src/engine/render/RenderDispatcher.ts`, `src/engine/gaussian/core/GaussianSplatGpuRenderer.ts`).
