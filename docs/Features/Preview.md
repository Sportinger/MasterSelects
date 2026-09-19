# Preview & Playback

[Back to Index](./README.md)

WebGPU-backed preview with RAM preview caching, source monitor playback, edit overlays, multi-preview targets, and output windows.

---

## Overview

The preview system uses a shared render host and a unified render-target store. The main preview canvas, additional preview panels, multi-preview slots, and output windows all register as render targets through the shared render-target path.

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
- Uses `renderHostPort.registerTargetCanvas()` through the preview-target registration helper to attach the canvas to WebGPU.
- Registers as an active-comp or independent render target in `renderTargetStore`.
- Normal composition previews use the same viewer navigation model as the Source Monitor: wheel or trackpad gestures zoom around the pointer, middle-button drag pans, and zooming fully out stops at Fit (100%) and restores the centered position.
- The shared lower transport provides scrubbing, edit/frame navigation, playback, and toggleable timeline In/Out flags. Clicking an active In or Out flag removes that point again.
- A failed WebGPU initialization replaces the canvas with a large, high-contrast error panel. The message distinguishes unavailable WebGPU, missing adapters, request timeouts, and renderer-resource failures without recommending a particular browser and keeps Linux/Vulkan guidance visible.
- The Linux/Vulkan performance banner remains visible until dismissed. Dismissal is stored locally, so subsequent engine initializations do not show it again.

### Independent Previews

- Non-active compositions are rendered as independent targets.
- `renderScheduler` drives those targets without depending on the main editor preview loop.
- A pinned child preview follows the parent playhead when that child is used as a nested composition. Linked audio companions do not create a second visual occurrence.
- Parent and child previews reuse the already-composited nested GPU frame when their time and resolution match. The parent still applies its own wrapper transform, effects, masks, and crop.
- Reusing the same child composition more than once in a parent keeps every visual instance on the normal nested render path during playback; paused preview may use the matching composited passthrough frame without turning the child's audio companion into a visual layer.
- Pausing preserves the complete final ping-pong accumulator, including the last composited layer.
- Adding, removing, replacing, or converting a layer in the active nested composition rebinds its runtime sources and invalidates dependent parents automatically. Transform, effect, text, and keyframe edits remain on the lightweight live-evaluation path.
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
- Images and videos support wheel zoom and middle-button panning; image sources also provide a crop tool with aspect-ratio presets.
- Source-specific playback and placement controls are hosted in the same lower Preview transport shell used by composition previews, while retaining the Source Monitor's own timeline and marked range.
- Time display, play/pause, scrubbing, start/end buttons, and frame stepping are provided for video sources.
- Audio sources provide waveform scrubbing, playback controls, In/Out marking, and placement actions for inserting or dragging the selected range into the timeline.
- `Space` toggles source playback only while the pointer hovers the playable source monitor. Outside it, `Space` controls timeline playback.
- Starting timeline playback through any transport path closes the source monitor and restores the composition preview.
- `Escape` closes the monitor without also triggering a timeline shortcut.

### Limitation

- The source monitor is a playback aid, not a WebGPU preview target. It does not use the composition render path or the shared WebCodecs preview/runtime selection logic.

---

## Playback And Render Loop

### Render Loop

The engine render loop is RAF-based and has three important behaviors:

- It idles after about 1 second of inactivity.
- Idle detection is suppressed until the first play event so browser video surfaces can warm up after reload.
- A watchdog checks for stalls and restarts the loop if it dies while the engine is expected to render.
- The composition playback clock is hosted above individual dock layouts. Switching between Video Edit, Color, and other editor layouts therefore preserves active playback and keeps every mounted transport and compact playhead synchronized.

### Playback Limits

- Imported video clips expose a **Free Run** checkbox in the Transform tab. While the clip is visible, its existing HTML video source loops on its own clock instead of seeking with the timeline; it keeps updating when timeline playback is paused. Offline export stays timeline-timed and deterministic.
- Playback is rate-limited to about 60 fps.
- Dynamic preview target FPS is derived from the active composition's
  `frameRate`; renderer RAF may still report a 60 fps loop while the visual
  target is 24/25/30/etc.
- Scrubbing is rate-limited to about 60 fps unless a fresh frame arrives via `requestVideoFrameCallback`.
- The loop does not render while export is active.
- During normal playback outside strict worker GPU mode, video clips stay on the live HTMLVideo/WebGPU import path even when JPEG proxy frames are available. Proxy image frames are used for paused preview, scrub fallback, and timeline thumbnails, but not as the primary playback surface because dense cut sequences need the browser video decoder and cut warmup path to remain active.
- Split, recreate, undo, and similar timeline edits bind lazy media elements to the current clip owner instead of inheriting a predecessor clip's DOM handle. This keeps every active video layer available after continued editing and applies equally inside nested compositions.
- During forward playback, a healthy live HTML-video frame may replace a stale pre-edit presentation-owner marker when its source time still matches the requested timeline time. Paused preview, scrubbing, and seeking retain strict owner checks, so cached frames cannot leak between clips while live multi-layer composition remains continuous.
- Worker-first render hosts, including a strict `worker-gpu-only` diagnostic mode, are present but feature-gated. The normal default is the main fallback render host; full WebCodecs playback is also disabled by default.
- When enabled for worker-GPU diagnostics, the worker path can present HTML-video frames or Worker WebCodecs frames and labels its presentation paths in playback statistics. Capability and browser support determine the active path.

### Browser Fallbacks

- Firefox uses copied HTML-video textures because imported frames can go black there.
- Android Chromium copies HTML-video preview frames into persistent GPU textures during playback, pause, and seeking. This avoids the session-first and intermittent black frames caused by unstable external video textures on mobile GPU drivers.
- A collapsed timeline In/Out selection is treated as no active range, so Play uses the full composition instead of stopping immediately.
- Full-frame composite, copy, and output passes use one oversized triangle instead of a two-triangle quad. This avoids diagonal half-frame loss on affected Android WebGPU drivers.
- The render path prefers live video import when the frame is ready, but it can fall back to cached frames or the last known frame to avoid black flashes.

---

## RAM Preview

RAM preview is implemented by `RamPreviewEngine` and the timeline RAM preview slice.

### Current Behavior

- Frames are generated outward from the playhead.
- Only frames where there is visible content are generated.
- Each frame is verified against expected video positions before it is committed.
- Caching uses the same composition render path as normal preview, then stores the composited frame for playback.

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
- Every camera-edit Preview owns its viewport camera and panel-sized render surface. Any number of visible panels can therefore show different live perspectives of the same composition while sharing timeline, selection, object transforms, and gizmo state.
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
- Touch uses the same edit paths as mouse input: one finger can drag layer and mask controls, including the scene gizmo's axis arrows, rotation rings, and center grip. A free one-finger drag in the perspective 3D Edit view orbits the editor camera without stealing touches that begin on those gizmos.
- Two-finger pinch cancels an active one-finger orbit and changes edit-view zoom or camera distance continuously from the live finger spacing, without fixed zoom steps. In both 2D and 3D Preview Edit modes its touch zoom delta is amplified to four times the normal preview pinch rate.
- 2D transform, text, and mask editing preserve the composition resolution and aspect ratio; only camera/3D edit views use the full panel viewport for an independent perspective.
- Moving or scaling a layer publishes a transient render transform once per animation frame, so the canvas and edit handles stay live without rewriting the durable clip, mask state, or RAM-preview caches. The final transform is committed as one history batch when the pointer is released.
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
- `useEngineResolutionSync()` reads the value, scales the active composition resolution by `1`, `0.5`, or `0.25`, and calls `renderHostPort.setResolution(...)`.

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
- `src/components/preview/usePreviewRenderTargetRegistration.ts`
- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/htmlVideoPreviewFallback.ts`
- `src/engine/render/layerCollector/htmlVideoReadyCollector.ts`
- `src/engine/managers/OutputWindowManager.ts`
- `src/hooks/engine/useEngineResolutionSync.ts`
- `src/services/ramPreviewEngine.ts`
- `src/services/proxyFrameCache.ts`
- `src/services/render/previewTargetRegistration.ts`
- `src/services/timeline/lazyMediaElements.ts`
- `src/stores/timeline/ramPreviewSlice.ts`
- `src/stores/timeline/proxyCacheSlice.ts`
