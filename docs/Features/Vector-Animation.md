[Back to Index](./README.md)

# Vector Animation

Vector animation clips currently ship through the Lottie path. `.lottie` packages and Lottie JSON files import as first-class media items, render through the same timeline/export pipeline as other clips, and expose clip-specific controls in the Properties panel.

`rive` is still only a reserved type in the data model. It is not wired into import, runtime playback, or export yet.

---

## Supported Sources

- `.lottie` packages
- Lottie JSON files when the JSON structure is positively identified as a Lottie animation

The import path does not treat arbitrary `.json` files as animation. Files are sniffed first, then promoted to `type: 'lottie'` only when the payload matches expected Lottie structure.

---

## Timeline Behavior

- Lottie clips live on video tracks.
- The clip bar shows an `L` badge in the timeline.
- `naturalDuration`, frame rate, dimensions, animation names, and other vector metadata are extracted during import.
- Loop-enabled clips can be extended beyond their source duration on the right trim edge.
- Copy/paste, nested compositions, slot decks, and background-layer playback preserve the clip type and vector animation settings.

---

## Properties Panel

Lottie clips add a dedicated `Lottie` tab in the unified Properties panel.

Current controls:

- Loop toggle
- End behavior: `hold`, `clear`, or `loop`
- Playback mode: `forward`, `reverse`, `bounce`, or `reverse-bounce`
- Fit: `contain`, `cover`, or `fill`
- Render resolution override with fallback to the imported animation size
- Animation picker when a `.lottie` package exposes multiple animations
- State Machine picker when a `.lottie` package exposes state machines
- State override plus stepped state keyframes for discrete timeline-driven state changes
- Boolean and numeric state-machine inputs as normal stopwatch keyframe properties
- Background color override

The tab also shows the clip name plus imported width, height, and frame rate metadata when available.

---

## Rendering

Lottie playback is driven by `src/services/vectorAnimation/LottieRuntimeManager.ts`.

- Each clip gets a dedicated runtime canvas.
- The runtime canvas can use the imported animation size or the clip-level render resolution override.
- Timeline time is converted into a deterministic target frame rather than relying on autoplay.
- Bounce modes are resolved in the timeline-time mapping, so preview and export render the same ping-pong frames.
- If a state machine is selected, `lottieState.{stateMachine}` keyframes resolve the active state at the current timeline time before the frame is rendered.
- If state-machine inputs are keyframed, the interpolated input values are applied before the frame is rendered.
- The runtime canvas is marked as dynamic, so `TextureManager` re-uploads it every frame instead of caching only the first frame.
- The same canvas-backed source flows through preview, nested comps, slot/background playback, thumbnails, and export.

That shared path is the reason reloading at a different playhead position now shows the correct frame immediately, and why preview and export stay aligned.

---

## Persistence And Reload

Saved data includes:

- media-level vector metadata
- clip-level `vectorAnimationSettings`
- Lottie playback mode, render resolution, state machine selection, static state override, state keyframes, and state-machine input values
- serialized timeline clip type `lottie`
- clipboard payloads and nested-composition clip data

On project load, the app restores the Lottie clip metadata from project data and recreates the runtime from the file, the copied `Raw/` media, or a recovered file handle.

If a retained `File` object still exists after refresh but the browser object URL is dead, the Media panel regenerates the missing URL and image/video thumbnail automatically.

---

## Export

Lottie export does not use a separate renderer.

- The export layer builder asks the runtime for the correct frame at the current export time.
- That frame is composited through the normal GPU path with effects, transforms, masks, nested comps, and other layers.
- Output is rasterized into the final render like any other canvas-backed source.

This keeps Lottie clips deterministic in fast preview, precise export, and image export.

---

## Current Limits

- Only Lottie is implemented today. Rive is not.
- State machine support currently targets `.lottie` packages through `@lottiefiles/dotlottie-web`; Rive state machines are still not wired.
- Boolean and numeric state-machine inputs are exposed as keyframe controls. String inputs are static for now, and trigger/event inputs are not deterministic timeline controls yet.
- State selection uses stepped `lottieState.{stateMachine}` keyframes rather than bezier curves because named states are discrete strings.
- Export output is rasterized; there is no vector-native export target.
- If no `Raw/` copy or file handle is available after reload, the clip still needs the normal relink flow.
