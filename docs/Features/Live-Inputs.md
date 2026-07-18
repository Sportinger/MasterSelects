[Back to Features](./README.md)

# Live Inputs

Live Inputs turn a browser capture source into a reusable Media Panel item and a normal visual timeline clip. Open the Media Panel **Add** menu, choose **Live Input...**, and select one of these sources:

- a screen, application window, or browser tab through the browser sharing picker;
- the default or a named camera/capture device exposed through `videoinput`;
- the current composition preview as a feedback source.

Each item owns an independent live connection, so several cameras, capture cards, and display sources can be placed on separate tracks and composited in parallel. Transform, crop, opacity, effects, masks, and track stacking use the existing video-layer render path. A live frame keeps requesting preview renders even while timeline playback is paused.

Connected inputs also show live thumbnails in the Media Panel and a larger preview after the normal hover delay. These previews sample the input's existing runtime video into a canvas capped at 320x180: visible thumbnails update once per second, while the hover preview updates up to four times per second. They do not open another capture stream or video decoder, and off-screen thumbnails stop repainting.

Select a Live Input clip and open **CLIP Live** in the Properties panel to see its connection state, switch between display, camera/capture-device, and composition-feedback sources, choose a video device, or reconnect the source. Source changes apply to every timeline clip that references the same Media Panel item. Double-clicking a disconnected Live Input in the Media Panel remains a shortcut for reconnecting it.

Because a composition-feedback source is bound to one composition, **CLIP Live** prevents rebinding a shared item to feedback while that item is also used in another composition. Duplicate the Media Panel item first when separate compositions need independent feedback sources.

When a project is loaded, MasterSelects scans the active and stored composition timelines and opens **CLIP Live** with a reconnect list for every in-use display or video-device input. The list stays synchronized as clips are added or removed, so unused Live Input items do not trigger permission work. Browsers require a fresh user gesture for each screen, window, or tab picker after reload, so those sources must be reconnected with their individual buttons; a page cannot reopen those pickers automatically. Composition-feedback sources need no device permission and reconnect through the preview coordinator.

Deleting an item, opening another project, or creating a new project stops its tracks and releases the runtime resources.

## Composition feedback

Composition feedback captures the previous presented preview frame and feeds it into the next render. It does not recursively render the composition inside itself. Scaling, rotating, fading, or effecting the clip therefore creates controlled feedback trails rather than an immediate render recursion.

A feedback item is bound to the composition in which it was created and can only be placed on that composition's timeline. On Linux/Mesa, the capture uses the shared software-canvas platform decision and a main-thread 2D mirror capped at 8192 pixels per dimension.

## Persistence and limits

Projects store only a serializable source descriptor and Live Input ID. `MediaStream`, tracks, video elements, frame callbacks, and feedback canvases remain in the runtime registry and are never written into project data or durable stores. Saved device IDs are restored as configuration, but the underlying browser stream is intentionally reacquired through **CLIP Live** after reload.

Live Inputs are visual-only in the current implementation: device/display audio is not added to timeline audio tracks. They are intended for live preview and compositing; deterministic offline export cannot reproduce past live frames unless the result is recorded first.
