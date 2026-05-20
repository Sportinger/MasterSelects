[Back to Index](./README.md)

# Vector Animation

Vector animation clips support Lottie and Rive as first-class media items. `.lottie`, Lottie JSON, and `.riv` files import into the Media panel, render through the same timeline/export pipeline as other clips, and expose clip-specific controls in the Properties panel.

---

## Supported Sources

- `.lottie` packages
- Lottie JSON files when the JSON structure is positively identified as a Lottie animation
- `.riv` Rive files via `@rive-app/canvas`

The import path does not treat arbitrary `.json` files as animation. Files are sniffed first, then promoted to `type: 'lottie'` only when the payload matches expected Lottie structure. Rive imports are extension-based and use `type: 'rive'`.

---

## Timeline Behavior

- Vector animation clips live on video tracks.
- The clip bar shows an `L` badge for Lottie and an `R` badge for Rive.
- `naturalDuration`, frame rate, dimensions, animation names, and other vector metadata are extracted during import.
- Loop-enabled clips can be extended beyond their source duration on the right trim edge.
- Copy/paste, nested compositions, slot decks, and background-layer playback preserve the clip type and vector animation settings.

---

## Properties Panel

Vector animation clips add a dedicated provider tab in the unified Properties panel: `Lottie` for Lottie clips and `Rive` for Rive clips.

Current controls:

- Loop toggle
- End behavior: `hold`, `clear`, or `loop`
- Playback mode: `forward`, `reverse`, `bounce`, or `reverse-bounce`
- Fit: `contain`, `cover`, or `fill`
- Render resolution override with fallback to the imported animation size
- Rive artboard picker when the file exposes multiple artboards
- Animation picker when the file exposes multiple animations
- State Machine picker when the file exposes state machines
- State override plus stepped state keyframes for discrete timeline-driven state changes
- Boolean and numeric state-machine inputs as normal stopwatch keyframe properties
- Rive view model and instance picker for Data Binding
- Rive boolean, numeric, integer, and color Data Binding properties as stopwatch keyframe properties
- Rive string and enum Data Binding properties as static clip settings
- Background color override

The tab also shows the clip name plus imported width, height, and frame rate metadata when available.

---

## Rendering

Runtime playback is split by provider and routed through `src/services/vectorAnimation/VectorAnimationRuntimeManager.ts`.

- Lottie playback is driven by `src/services/vectorAnimation/LottieRuntimeManager.ts`.
- Rive playback is driven by `src/services/vectorAnimation/RiveRuntimeManager.ts` using `@rive-app/canvas`.

- Each clip gets a dedicated runtime canvas.
- The runtime canvas can use the imported animation size or the clip-level render resolution override.
- Timeline time is converted into a deterministic target frame rather than relying on autoplay.
- Bounce modes are resolved in the timeline-time mapping, so preview and export render the same ping-pong frames.
- If a state machine is selected, `lottieState.{stateMachine}` keyframes resolve the active state at the current timeline time before the frame is rendered.
- If state-machine inputs are keyframed, the interpolated input values are applied before the frame is rendered.
- Rive Data Binding values use `riveData.{property}` keyframes for numeric, boolean, integer, and color properties and are applied before draw.
- Rive Events are subscribed through `EventType.RiveEvent` with automatic event side effects disabled. Events are logged for debugging rather than opening URLs or running implicit browser actions.
- Rive runtime asset loading keeps the Rive CDN fallback enabled and leaves a custom asset-loader hook in place for future project-local asset resolution.
- The runtime canvas is marked as dynamic, so `TextureManager` re-uploads it every frame instead of caching only the first frame.
- The same canvas-backed source flows through preview, nested comps, slot/background playback, thumbnails, and export.

That shared path is the reason reloading at a different playhead position now shows the correct frame immediately, and why preview and export stay aligned.

---

## Persistence And Reload

Saved data includes:

- media-level vector metadata
- clip-level `vectorAnimationSettings`
- playback mode, render resolution, artboard, state machine selection, static state override, state keyframes, state-machine input values, view model selection, and Data Binding values
- serialized timeline clip type `lottie` or `rive`
- clipboard payloads and nested-composition clip data

On project load, the app restores vector animation metadata from project data and recreates the runtime from the file, the copied `Raw/` media, or a recovered file handle.

If a retained `File` object still exists after refresh but the browser object URL is dead, the Media panel regenerates the missing URL and image/video thumbnail automatically.

---

## Export

Vector animation export does not use a separate renderer.

- The export layer builder asks the runtime for the correct frame at the current export time.
- That frame is composited through the normal GPU path with effects, transforms, masks, nested comps, and other layers.
- Output is rasterized into the final render like any other canvas-backed source.

This keeps vector animation clips aligned in fast preview, precise export, and image export.

---

## Current Limits

- Rive state machines use the public high-level WASM runtime. Input values are timeline-driven, but state-machine internal progression is limited by the high-level runtime API.
- Boolean and numeric state-machine inputs are exposed as keyframe controls. String inputs are static for Lottie, and trigger/event inputs are not deterministic timeline controls yet.
- Rive image/font/audio asset loading currently relies on embedded assets or the Rive CDN fallback. Project-local asset binding is a future extension point.
- State selection uses stepped `lottieState.{stateMachine}` keyframes rather than bezier curves because named states are discrete strings.
- Export output is rasterized; there is no vector-native export target.
- If no `Raw/` copy or file handle is available after reload, the clip still needs the normal relink flow.
