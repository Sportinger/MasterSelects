# Preview.md — audit 2026-08-02

## Verified (spot checks that held)

- The Preview, independent-target, and output-window flow is backed by `renderTargetStore`, `renderScheduler`, and `OutputWindowManager` (`src/stores/renderTargetStore.ts`, `src/services/render/previewTargetRegistration.ts`, `src/services/renderScheduler.ts`, `src/engine/managers/OutputWindowManager.ts`). Output windows retain open IDs in `sessionStorage` and reconnect through `reconnectOutputWindows` (`src/engine/managers/OutputWindowManager.ts`, `src/engine/engineCore/outputWindowController.ts`).
- Source Monitor is an HTML-media surface, not a composition render target. It uses panel-local `<video>`, `<audio>`, and `<img>` elements, includes waveform/In/Out/placement controls for audio, and owns the Space/Escape handling (`src/components/preview/SourceMonitor.tsx`, `src/components/preview/sourceMonitor/useSourceMonitorKeyboard.ts`).
- The RAF loop has a one-second idle timeout, first-play idle suppression, a watchdog, a 60 fps visual target cap, export suppression, and Firefox-only copied-video fallback (`src/engine/render/RenderLoop.ts`, `src/engine/render/htmlVideoPreviewFallback.ts`).
- RAM preview is implemented by `RamPreviewEngine` and the timeline slice, plans frames outward from the playhead, verifies video positions, runs at 30 fps, and uses the documented 900-frame/512 MiB composite and 60-frame GPU cache limits (`src/services/ramPreviewEngine.ts`, `src/services/ramPreview/framePlanning.ts`, `src/services/ramPreview/clipTiming.ts`, `src/stores/timeline/constants.ts`, `src/engine/texture/scrubbingCache/ramPreviewCache.ts`).
- Multi Preview remains a 2x2/four-slot panel with composition and layer-index sources; per-target transparency and panel-local edit camera routing are implemented (`src/components/preview/MultiPreviewPanel.tsx`, `src/components/preview/MultiPreviewSlot.tsx`, `src/components/preview/usePreviewRenderTargetRegistration.ts`, `src/components/preview/Preview.tsx`).

## Outdated or wrong (claim → reality, with file evidence)

- “A single WebGPU engine” and direct `engine.registerTargetCanvas()` registration → preview targets register through `renderHostPort` in `registerPreviewTarget`; `WebGPUEngine` is the main-fallback implementation, not the only render-host abstraction. Evidence: `src/services/render/previewTargetRegistration.ts`, `src/services/render/renderHostPort.ts`, `src/engine/WebGPUEngine.ts`.
- “Scrubbing is rate-limited to about 30 fps” → `SCRUB_FRAME_TIME` is 15 ms, documented in code as approximately 60 fps (unless a new decoded frame is ready). Evidence: `src/engine/render/RenderLoop.ts`.
- The `worker-gpu-only` paragraphs described the staging path as if it were the current normal state → worker-first hosting and full WebCodecs playback are both false by default; `worker-gpu-only` is a persisted development/diagnostic mode. Evidence: `src/engine/featureFlags.ts`, `src/services/render/renderHostPort.ts`, `src/stores/settingsStore.ts`.
- “`useEngine()` … calls `engine.setResolution(...)`” → `useEngineResolutionSync()` calculates the scaled active-composition size and calls `renderHostPort.setResolution(...)`. Evidence: `src/hooks/engine/useEngineResolutionSync.ts`.

## Noteworthy / unusual

- The source monitor has shipped image/video wheel zoom, middle-button panning, and image cropping with aspect-ratio presets, none of which the audited document mentioned. Evidence: `src/components/preview/SourceMonitor.tsx`, `src/components/preview/sourceMonitor/SourceMonitorImageCrop.tsx`.
- The source list is not fully representative of the current wiring: it omits `src/services/render/previewTargetRegistration.ts`, `src/hooks/engine/useEngineResolutionSync.ts`, and `src/engine/managers/OutputWindowManager.ts`.
- The RenderLoop scrubbing branch still contains a stale “~30fps baseline” comment immediately above the 15 ms (~60 fps) constant/guard. Evidence: `src/engine/render/RenderLoop.ts`.
