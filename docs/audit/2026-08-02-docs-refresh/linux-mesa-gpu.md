# Linux-Mesa-GPU.md — audit 2026-08-02

## Verified (spot checks that held)

- The timeline clip canvas is viewport-windowed and the backing store is capped at 8192 device pixels: `src/components/timeline/hooks/useTimelineClipCanvasViewport.ts`.
- Linux disables the timeline `OffscreenCanvas` worker path through `prefersSoftwareTimelineCanvas()`: `src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime.ts`.
- The main-thread timeline surface requests `getContext('2d', { willReadFrequently: true })` on the Linux policy path: `src/components/timeline/utils/timelineClipCanvasMainThreadSurface.ts`.
- `getStats` exposes `timelineCanvas` diagnostics, including `workerMode`, `workerError`, and fallback data; `getLogs` is a registered AI-tool handler: `src/services/aiTools/handlers/stats.ts`, `src/services/timeline/timelineCanvasDiagnostics.ts`, `src/services/aiTools/handlers/index.ts`.
- `WebGPUContext.withTimeout()` intentionally leaves its timer uncleared, and Linux adapter/device recovery retries a low-power adapter: `src/engine/core/WebGPUContext.ts`.
- `TextureManager.importVideoTexture()` documents the invalid-but-not-null Mesa external-texture condition and guards/catches ordinary invalid-source/import failures: `src/engine/texture/TextureManager.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Everything becomes a GPU signal” and all timeline chrome flows through WebGPU/GPU canvases → the timeline clip body renderer is a 2D canvas with a main-thread fallback; worker mode is feature-flagged and only used for eligible rows. The default render host is also `main-fallback`: `src/components/timeline/TimelineClipCanvas.tsx`, `src/components/timeline/hooks/useTimelineClipCanvasMainThreadDraw.ts`, `src/engine/featureFlags.ts`, `src/services/render/renderHostPort.ts`.
- The absolute statement that these failures throw no exception, return no null, and report success → overstates the implementation. `prepareTimelineClipCanvasMainThreadSurface()` returns `null` on unavailable contexts and `TextureManager.importVideoTexture()` returns `null` for invalid sources or caught import errors: `src/components/timeline/utils/timelineClipCanvasMainThreadSurface.ts`, `src/engine/texture/TextureManager.ts`.
- The mode-1 implementation reference to `TimelineClipCanvas.tsx` and an unspecified “safe maximum (we use 8192)” → the actual sizing/cap logic is in `useTimelineClipCanvasViewport.ts`; `TimelineClipCanvas.tsx` supplies the CSS-width ceiling but not the backing-store calculation: `src/components/timeline/hooks/useTimelineClipCanvasViewport.ts`, `src/components/timeline/TimelineClipCanvas.tsx`.
- The shared helper path is stated as `src/components/timeline/utils/timelineCanvasPlatform.ts` → that file is now a compatibility re-export; the implementation is `src/utils/canvasPlatform.ts`: both files checked.
- The mode-3 implementation reference to `useTimelineClipCanvasMainThreadDraw.ts` → the Linux `willReadFrequently` context option now lives in `timelineClipCanvasMainThreadSurface.ts`, called by that hook: `src/components/timeline/utils/timelineClipCanvasMainThreadSurface.ts`, `src/components/timeline/hooks/useTimelineClipCanvasMainThreadDraw.ts`.
- The mode-4 explanation names Dawn `ImportMemory` size mismatch and `vkAllocateMemory` OOM as current causes → neither string/cause is present in the client repository. Current code supports only the documented invalid-but-not-null external-texture warning and recovery behaviour: `src/engine/texture/TextureManager.ts`, `src/engine/core/WebGPUContext.ts`.
- The issue-#275 MIDI regression narrative is no longer the current implementation description → the main-thread painter now creates MIDI preview resources from geometry-adjusted clip state, matching the intended live trim/drag geometry: `src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts`, `src/components/timeline/utils/timelineClipCanvasClipGeometry.ts`.

## Noteworthy / unusual

- The shared Linux policy has spread beyond the timeline: it blocks worker-presenting render-host modes and is used for capture-frame transforms, composition-feedback streams, and proxy scene-cut analysis: `src/services/render/renderHostPort.ts`, `src/services/capture/recording/frameTransform.ts`, `src/services/mediaRuntime/liveInputRuntime.ts`, `src/services/sceneCutDetection/proxySceneCutAnalyzer.ts`.
- `src/services/render/mainFallbackRenderHostPort.ts` independently checks `navigator.platform` to show the Linux Vulkan warning; this is separate from the shared canvas-policy helper.
- `docs-site/src/content/docs/features/linux-mesa-gpu.md` is a stale duplicate of the audited document and still contains the old paths and unsupported mode-4 causal detail. It was not edited because this audit was limited to the two requested files.
- Repository version is 2.4.4 in `package.json`; the feature-doc index still says version 2.0.6 in `docs/Features/README.md`, a separate documentation-drift item outside this bounded audit.
