---
title: "Live Inputs"
---

Live Inputs turn a browser capture source into a reusable Media Panel item and a normal visual timeline clip. Open the Media Panel **Add** menu, choose **Live Input...**, and select one of these sources:

- a screen, application window, or browser tab through the browser sharing picker;
- the default or a named camera/capture device exposed through `videoinput`;
- the current composition preview as a feedback source.

Each item owns an independent live connection, so several cameras, capture cards, and display sources can be placed on separate tracks and composited in parallel. Transform, crop, opacity, effects, masks, and track stacking use the existing video-layer render path. A live frame keeps requesting preview renders even while timeline playback is paused.

Connected inputs show the existing capture stream through a visible native video element in the Media Panel. This keeps camera previews at the browser's native cadence without opening another capture stream or decoder. The same presentation surface drives editor frame requests while it is visible, so iPad Safari does not fall into a low-frequency idle probe after a few seconds.

The composition Preview uses a native-video fast path when exactly one unmodified 2D camera or display input is visible. Effects, masks, transforms, multiple visual layers, transparency inspection, export, and 3D still use the WebGPU compositor. Live 3D planes sample the current native presentation video directly while taking their plane dimensions from the orientation-aware staging surface; rotating an iPad therefore updates the plane aspect ratio without returning to the stuttering canvas-copy path. Orientation changes reattach the same stream when WebKit leaves an old presentation surface frozen, without reacquiring camera permission.

Select a Live Input clip and open **Transform** in the Properties panel. Its **Live Input** controls are integrated directly below **Source**, where they show connection state, switch between display, camera/capture-device, and composition-feedback sources, choose a video device, or reconnect the source. There is no separate Live tab for a selected clip. Source changes apply to every timeline clip that references the same Media Panel item. Double-clicking a disconnected Live Input in the Media Panel remains a shortcut for reconnecting it. If a source track ends, its item becomes disconnected and must be reconnected.

Because a composition-feedback source is bound to one composition, the **Live Input** controls prevent rebinding a shared item to feedback while that item is also used in another composition. Duplicate the Media Panel item first when separate compositions need independent feedback sources.

When a project is loaded, MasterSelects scans the active and stored composition timelines and exposes a reconnect list for every in-use display or video-device input in Properties until a clip is selected. The list stays synchronized as clips are added or removed, so unused Live Input items do not trigger permission work. Browsers require a fresh user gesture for each screen, window, or tab picker after reload, so those sources must be reconnected with their individual buttons; a page cannot reopen those pickers automatically. Composition-feedback sources need no device permission and reconnect through the preview coordinator.

Deleting an item, opening another project, or creating a new project stops its tracks and releases the runtime resources.

## Composition feedback

Composition feedback captures the previous presented preview frame and feeds it into the next render. It does not recursively render the composition inside itself. Scaling, rotating, fading, or effecting the clip therefore creates controlled feedback trails rather than an immediate render recursion.

A feedback item is bound to the composition in which it was created and can only be placed on that composition's timeline. On Linux, the capture uses the shared software-canvas platform decision and a main-thread 2D mirror capped at 8192 pixels per dimension.

## Persistence and limits

Projects store only a serializable source descriptor and Live Input ID. `MediaStream`, tracks, video elements, frame callbacks, and feedback canvases remain in the runtime registry and are never written into project data or durable stores. Saved device IDs are restored as configuration, but the underlying browser stream is intentionally reacquired through the Properties reconnect controls after reload.

Live Inputs are visual-only in the current implementation: device/display audio is not added to timeline audio tracks. Export is supported as a real-time capture of the connected source. Any export range containing a direct or nested Live Input switches to Precise mode, samples the current runtime video element at wall-clock speed, and preserves the input's presentation dimensions and rotation. A disconnected source or a source that has not produced its first frame fails with a reconnect/readiness message instead of exporting stale media. Because this captures frames as they arrive, it cannot reproduce past live frames deterministically; record the source first when repeatable offline output is required.
