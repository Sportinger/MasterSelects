---
title: "Memory Leak"
---

[Back to Index](/features/readme/)

`Memory Leak` is a `generate` effect that shows a block of real memory as if
it were pixel data, in the spirit of the After Effects plug-in of the same
name. It is not noise: the bytes come from the FFmpeg wasm linear memory that
already lives in the editor.

## Why the FFmpeg heap

Browsers zero every fresh allocation: JavaScript `ArrayBuffer`s, newly grown
wasm memory, WebGPU buffers and textures. Reading uninitialised process memory
like a native plug-in is impossible by design. WebAssembly heaps, however, are
zeroed only when they grow; `free()` leaves the old contents in place. After
FFmpeg has demuxed and decoded something, its heap keeps packet fragments,
frame planes, tables and strings until they are overwritten. The effect reads
that heap directly through `FFmpegBridge.getHeapState()` (a live `HEAPU8`
view plus an epoch that increments after every executed command) and never
writes to it.

Consequences that match the original plug-in:

- The picture depends on what ran before in this session, so it differs per
  session, per machine, and after every FFmpeg export or feed.
- A fresh core has written only a few megabytes of its initial 32 MB. The
  effect scans the heap once per epoch into a map of populated 64 KB pages
  (at least 2 percent non-zero words) and walks a virtual address space made
  only of those pages, so the block never scrolls into untouched all-zero
  memory, wherever the populated pages sit. **Feed Clip** adds pages with
  real footage.
- Preview and export in the same session read the same bytes, so an export
  matches the preview as long as no FFmpeg command runs in between. Use
  **Freeze** for cross-session stability.

## Parameters

| Group | Parameter | Meaning |
|---|---|---|
| Memory | Block Width | Interpreted pixel columns (8-1024). Rows follow the composition aspect. Small values give large pixels. |
| Memory | Bit Depth | `Zesty` reads 4 bytes per pixel as RGBA8, `Cloudy` 8 bytes as four 16-bit channels, `Tripping` 16 bytes as four IEEE floats. |
| Memory | Offset (MB) | Start of the block inside the source, wrapped to the heap length. Animatable. |
| Motion | Per Frame | `Hold block` keeps one block, `Advance` (default) moves by the stride every frame, `Shuffle` jumps to a hashed offset per frame. Both moving modes are deterministic per frame and seed. |
| Motion | Advance (KB) | Stride for `Advance`. |
| Motion | Seed | Hash seed for `Shuffle`. |
| Style | Float Mapping | How 32-bit floats become colour: clamp, wrap (`fract(abs(v))`), or absolute. NaN and Inf render as holes. |
| Style | Float Gain | Multiplier applied before float mapping. Animatable. |
| Style | Ignore Alpha | Forces opaque output instead of using the fourth channel as alpha. |
| Style | Mix | Blend between the clip and the memory block. Animatable. |

The frame index for the motion modes is derived from the effect's timeline
time and the active composition frame rate, so scrubbing, playback, and export
produce the same block for the same frame.

## Extra controls

Below the parameter groups the effect renders a status line
(`FFmpeg heap 4.2 MB used of 32.0 MB · run 3 · fed clip.mp4`) and three
actions:

- **Feed Clip** decodes the first two seconds of the selected clip's media
  inside FFmpeg (`-f null -`, nothing is written back). The demuxed packets and
  decoded frames stay in the heap as leftovers and become visible in the
  block. Files above 512 MB are rejected because they must be copied into the
  virtual filesystem.
- **Reshuffle** picks a random offset and seed.
- **Freeze** stores the current block as a project artifact
  (`application/x-masterselects-memory-window`, in the project folder when one
  is open, otherwise in IndexedDB) and writes its artifact id into the hidden
  `snapshot` parameter. The effect then reads the frozen bytes instead of the
  live heap, in every session. **Unfreeze** returns to the live heap. With a
  moving `Per Frame` mode the frozen block is re-walked within itself.

FFmpeg core loads automatically the first time the effect is rendered or its
controls are shown.

## Implementation

- `src/effects/generate/memoryLeak/` — `index.ts` (definition, uniforms),
  `shader.wgsl` (reinterpretation on binding 5), `memoryWindow.ts` (pure
  window and offset math, unit-tested in
  `tests/unit/memoryLeakWindow.test.ts`), `memorySource.ts` (live heap vs
  frozen block), `heapSource.ts` (FFmpeg load, feed, freeze, artifact
  loading), `MemoryLeakControls.tsx` (extra controls, loaded lazily).
- `src/effects/_shared/byteTexture.ts` — generic byte-block upload cache used
  by the effects pipeline for any effect that declares `byteTexture`.
- `src/engine/ffmpeg/FFmpegBridge.ts` — `getHeapState()` and
  `subscribeHeap()`; the epoch bumps after load and after every `execute`.
- App services (render host, artifact service, project file service, media
  store) are imported lazily from the effect modules because the store layer
  imports the effect registry; a static import would form a cycle.
- Debugging: `Logger.enable('MemoryLeak')` plus `Logger.setLevel('DEBUG')`
  logs the resolved window (time, frame index, offset, source) per render.

## Related Docs

- [Effects](/features/effects/)
- [Export](/features/export/)
