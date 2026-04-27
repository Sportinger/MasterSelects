# Preview & Playback

[Back to Index](./README.md)

WebGPU preview with RAM preview caching, source monitor playback, edit overlays, multi-preview targets, and output windows.

---

## Overview

The preview system is built around a single WebGPU engine and a unified render-target store. The main preview canvas, additional preview panels, multi-preview slots, and output windows all register as render targets and are rendered through the same engine path.

Current preview-related overlays and modes include:

- Main composition preview
- Source monitor for raw media playback
- Edit mode overlay for clip/layer transforms
- Mask and SAM2 overlays
- Statistics overlay
- Multi-preview panel
- Output windows with separate popup canvases

---

## Preview Targets

### Main Preview

- Renders the active composition or a pinned composition source.
- Uses `engine.registerTargetCanvas()` to attach the canvas to WebGPU.
- Registers as an active-comp or independent render target in `renderTargetStore`.

### Independent Previews

- Non-active compositions are rendered as independent targets.
- `renderScheduler` drives those targets without depending on the main editor preview loop.
- Each target can toggle its own transparency grid state.
- Edit mode is panel-local: the Edit button only affects that preview, and the global `Tab` shortcut targets the focused preview or, with no focused preview, the first editable preview.

### Output Windows

- Output windows are popup windows managed by `OutputWindowManager`.
- They reconnect after refresh when the session still knows the window was open.
- Popup focus is transferred only when playback is not active, so playback is less likely to stall in the background.

---

## Source Monitor

The source monitor shows a raw media file in the preview panel instead of the composition.

### Behavior

- Video sources always use the panel-local HTML `<video>` path in this branch.
- Images render through a plain `<img>` element in the same panel surface.
- Supports images, but images do not show transport controls.
- Time display, play/pause, scrubbing, start/end buttons, and frame stepping are provided for video sources.
- `Space` toggles playback and `Escape` closes the monitor without also triggering the timeline shortcut.

### Limitation

- The source monitor is a playback aid, not a WebGPU preview target. It does not use the composition render path or the shared WebCodecs preview/runtime selection logic.

---

## Playback And Render Loop

### Render Loop

The engine render loop is RAF-based and has three important behaviors:

- It idles after about 1 second of inactivity.
- Idle detection is suppressed until the first play event so browser video surfaces can warm up after reload.
- A watchdog checks for stalls and restarts the loop if it dies while the engine is expected to render.

### Playback Limits

- Playback is rate-limited to about 60 fps.
- Scrubbing is rate-limited to about 30 fps unless a fresh frame arrives via `requestVideoFrameCallback`.
- The loop does not render while export is active.

### Browser Fallbacks

- HTML video preview on Firefox uses copied textures instead of imported external textures because imported frames can go black there.
- The render path prefers live video import when the frame is ready, but it can fall back to cached frames or the last known frame to avoid black flashes.

---

## RAM Preview

RAM preview is implemented by `RamPreviewEngine` and the timeline RAM preview slice.

### Current Behavior

- Frames are generated outward from the playhead.
- Only frames where there is visible content are generated.
- Each frame is verified against expected video positions before it is committed.
- Caching uses the same composition render path as normal preview, then stores the composited frame for later playback.

### Current Cache Limits

- Scrubbing cache: 300 frames
- Composite RAM preview cache: 900 frames and 512 MB memory budget
- GPU RAM preview cache: 60 frames
- RAM preview generation runs at 30 fps
- Frame verification tolerance is `0.04` seconds

### Notes

- The green timeline range indicator comes from cached RAM preview frames.
- The proxy cache indicator is separate and comes from `proxyFrameCache`, not from RAM preview.
- RAM preview generation is best-effort; it skips frames when the clip positions drift during generation.

---

## Multi Preview And Output Routing

### Multi Preview

- Multi-preview renders four slots in a shared panel.
- Slots can follow the active composition or pin a specific composition.
- The auto-distribute mode maps the first four layers of a chosen composition to the four slots.

### Output Routing

- Output targets are registered in `renderTargetStore`.
- Output canvases, preview canvases, and windows all use the same source routing model.
- `ShowTransparencyGrid` is per-target, not global.

---

## Edit Mode

Edit mode is a canvas overlay for layer transforms.

### What It Does

- Selects a layer from the preview and syncs the corresponding clip in the timeline.
- Shows bounding boxes and drag handles for the selected layer.
- Supports zoom, pan, and transform gestures.
- Uses a full-container overlay canvas so pasteboard space outside the composition remains interactive.
- Multiple preview panels can mix edit and non-edit views at the same time.
- 3D object handles remain visible across preview modes; selecting one activates the native 3D scene gizmo for that clip.
- Edit views can render a projected world grid that follows camera-view animation instead of snapping as a screen overlay. The grid plane matches the edit view: Front uses XY at `z=0`, Side uses YZ at `x=0`, and Top/free camera uses XZ at `y=0`.

### Limitation

- Edit mode is only available for editable sources. It is disabled for non-editable preview sources.

---

## Preview Quality

The UI exposes Full / Half / Quarter preview quality choices.

### Current State

- The setting is persisted in `settingsStore`.
- The selector is visible in preview UI.
- `useEngine()` reads the value, scales the active composition resolution by `1`, `0.5`, or `0.25`, and calls `engine.setResolution(...)`.

### Practical Impact

- Lower preview quality reduces the engine-backed preview resolution for the main preview, multi-preview targets, and output targets that share the engine path.
- It does not change export resolution or the HTML-only source monitor.

---

## Current Limitations

- Firefox does not use zero-copy HTML video import for preview frames.
- RAM preview and proxy cache generation are separate systems.
- Browser media readiness still controls how quickly source monitor and preview frames appear after reload.
- Source monitor playback is intentionally HTML-only and does not mirror the engine's preview backend selection.

---

## Sources

Key implementation files:

- `src/components/preview/Preview.tsx`
- `src/components/preview/SourceMonitor.tsx`
- `src/components/preview/StatsOverlay.tsx`
- `src/components/preview/MultiPreviewPanel.tsx`
- `src/components/preview/PreviewBottomControls.tsx`
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/htmlVideoPreviewFallback.ts`
- `src/services/ramPreviewEngine.ts`
- `src/services/proxyFrameCache.ts`
- `src/stores/timeline/ramPreviewSlice.ts`
- `src/stores/timeline/proxyCacheSlice.ts`
