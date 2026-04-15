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
- Fit: `contain`, `cover`, or `fill`
- Animation picker when a `.lottie` package exposes multiple animations
- Background color override

The tab also shows the clip name plus imported width, height, and frame rate metadata when available.

---

## Rendering

Lottie playback is driven by `src/services/vectorAnimation/LottieRuntimeManager.ts`.

- Each clip gets a dedicated runtime canvas.
- Timeline time is converted into a deterministic target frame rather than relying on autoplay.
- The runtime canvas is marked as dynamic, so `TextureManager` re-uploads it every frame instead of caching only the first frame.
- The same canvas-backed source flows through preview, nested comps, slot/background playback, thumbnails, and export.

That shared path is the reason reloading at a different playhead position now shows the correct frame immediately, and why preview and export stay aligned.

---

## Persistence And Reload

Saved data includes:

- media-level vector metadata
- clip-level `vectorAnimationSettings`
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
- Export output is rasterized; there is no vector-native export target.
- If no `Raw/` copy or file handle is available after reload, the clip still needs the normal relink flow.
