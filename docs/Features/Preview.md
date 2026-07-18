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
- During edit-mode scrubbing, independent previews keep their last visible frame while the video decoder seeks instead of flashing black.
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
- Audio sources use a panel-local audio playback path with waveform display and scrubbing.
- Images render through a plain `<img>` element in the same panel surface.
- Supports images, but images do not show transport controls.
- Time display, play/pause, scrubbing, start/end buttons, and frame stepping are provided for video sources.
- Audio sources provide waveform scrubbing, playback controls, In/Out marking, and placement actions for inserting or dragging the selected range into the timeline.
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

- Imported video clips expose a **Free Run** checkbox in the Transform tab. While the clip is visible, its existing HTML video source loops on its own clock instead of seeking with the timeline; it keeps updating when timeline playback is paused. Offline export stays timeline-timed and deterministic.
- Playback is rate-limited to about 60 fps.
- Dynamic preview target FPS is derived from the active composition's
  `frameRate`; renderer RAF may still report a 60 fps loop while the visual
  target is 24/25/30/etc.
- Scrubbing is rate-limited to about 30 fps unless a fresh frame arrives via `requestVideoFrameCallback`.
- The loop does not render while export is active.
- During normal playback outside strict worker GPU mode, video clips stay on the live HTMLVideo/WebGPU import path even when JPEG proxy frames are available. Proxy image frames are used for paused preview, scrub fallback, and timeline thumbnails, but not as the primary playback surface because dense cut sequences need the browser video decoder and cut warmup path to remain active.
- In strict `worker-gpu-only` mode on the current staging path, timeline video playback hydrates hidden `HTMLVideoElement` sources, lets the browser HTML decoder drive media time, transfers the current HTML video frame as an `ImageBitmap`, and presents it through Worker WebGPU. Worker WebCodecs playback is disabled by default in this mode.
- Strict `worker-gpu-only` normal 1x forward playback no longer starts Worker WebCodecs stream sessions while the HTMLVideo worker-GPU experiment is active. Reverse playback and non-1x playback fall back to the HTMLVideo sync path instead of binding worker WebCodecs runtime sources.
- Strict `worker-gpu-only` playback keeps simultaneous visible video clips as separate transferred HTMLVideo frame layers, so overlapping video layers can still carry independent opacity, blend mode, and effect parameters into Worker WebGPU.
- Strict `worker-gpu-only` playback composites visible video layers in Worker WebGPU. The path carries opacity, blend mode, inline color effects (`brightness`, `contrast`, `saturation`, `invert`), and worker GPU shader-compatible color/distort/stylize/keying effects (`hue-shift`, `exposure`, `temperature`, `vibrance`, `levels`, `threshold`, `posterize`, `vignette`, `pixelate`, `kaleidoscope`, `mirror`, `rgb-split`, `wave`, `twirl`, `bulge`, `scanlines`, `grain`, `sharpen`, `edge-detect`, `glow`, `chroma-key`) into the worker-side layer shader. Heavy multi-pass effects still need dedicated worker GPU passes.
- In strict `worker-gpu-only` HTMLVideo mode, frame cadence depends on the browser HTMLVideo decoder and the host-to-worker `ImageBitmap` transfer cadence; stats label presented frames as `worker-gpu-only:video-frame`.
- In strict `worker-gpu-only` HTMLVideo mode, active scrubbing uses the HTMLVideo seek/warmup path and then transfers the displayed frame to Worker WebGPU.

### Browser Fallbacks

- HTML video preview uses copied textures only on Firefox because imported frames can go black there; Chromium paths stay on live video import to avoid stale or corrupt copied textures.
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
- Isolated layer slots render the layer as its source by normalizing non-normal blend modes for that slot only. The original composition layer keeps its stored blend mode.
- Every editable Preview panel owns its viewport camera and panel-sized render surface. Any number of visible panels can therefore show different live perspectives of the same composition while sharing timeline, selection, object transforms, and gizmo state.
- A panel in Edit mode is rendered as an independent target; non-edit panels continue to show the timeline camera instead of inheriting or freezing the edited panel's view.

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
- Uses the full panel viewport instead of constraining the edit surface to the composition aspect ratio, including for 2D layers.
- Multiple preview panels can mix edit and non-edit views at the same time. Camera and object changes update every visible view immediately, while each panel keeps its own perspective.
- 3D object handles remain visible across preview modes; selecting one activates the native 3D scene gizmo for that clip.
- In camera Edit mode, the independent editor camera always orbits the scene origin `(0, 0, 0)`; timeline and viewport selection do not change its pivot.
- Camera Edit mode uses an independent editor camera with a 35 mm default, initially offset so the timeline camera is visible as an object. Navigating the editor view never changes the timeline camera; dragging the timeline camera's object gizmo updates its output live in every normal Preview.
- The projected timeline-camera frame in camera Edit mode is a world-space object drawn from the camera's FOV/mm and Resolution X/Y. It becomes smaller with distance, wide lenses draw a larger front frame, tele lenses draw a smaller one, and the frame aspect follows the camera resolution.
- Edit views can render a projected world grid that follows camera-view animation instead of snapping as a screen overlay. The grid plane matches the edit view: Front uses XY at `z=0`, Side uses YZ at `x=0`, and Top/free camera uses XZ at `y=0`.
- Holding Shift while dragging a layer in Edit mode enables snapping for that drag. The layer can snap to composition edges/center and to the bounds of other visible layers; without Shift, layer movement stays free.

### Scene Camera Navigation

- When Scene Nav is active on a camera clip, the preview wheel moves the real camera position along the current view direction, updating Position X/Y/Z as needed. It does not change FOV or millimeters.
- The Transform tab shows the same lens value as both FOV degrees and full-frame-equivalent mm; those lens fields are independent from camera position.
- Resolution X/Y controls the camera gate aspect used by the edit-view camera frame.
- In FPS navigation, wheel still changes movement speed while the camera is actively moving or looking; otherwise it moves the camera position forward/backward.

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
