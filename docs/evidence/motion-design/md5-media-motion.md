# MD5 — Media Motion (Texture Fills) Evidence

Closed 2026-08-01. Scope shipped: image + frozen-video texture fills on motion
shapes, replicated with one decode per unique reuse key, authorable via AI
tools and the appearance stack editor.

## Visible scenario: video wall

`md5/video-wall-4x3-freeze-2s-preview.jpg` — live preview of a 4×3 replicator
grid (12 instances, tile 320×180, spacing 340×200). Every tile shows the SAME
video frame: `masterselects_github.mp4` frozen at `time = 2 s`, fit `cover`.
The right panel shows the MD5-B4 authoring UI (media picker, fit, time with
the video hint) and the collapsed-by-default Property Browser.

Authored end-to-end through the un-gated AI tools in a disposable evidence
session (`importLocalFiles` → `createMotionShapeClip` →
`updateMotionAppearances` remove color-fill / add texture-fill →
`configureMotionReplicator` 4×3). A gpu `captureFrame` readback of the same
scene shows the identical 12-tile wall (in-conversation capture, 1920×1080).

## Dedupe guarantee

One decode per unique `(sourceId, quantized resolved time, render
parameters)` reuse key. For the wall: 12 instances, same frozen time → ONE
extraction. Proven by unit tests (`motionMediaVideoFreezeMd5.test.ts`: pool
plan admits 1 frame, requests 1..11 reuse it; acquisition spy shows exactly
one extraction; release frees extraction resources).

## Scope decisions on record

- Video texture fills are STILLS: `TextureFillAppearance.time` freezes one
  frame. Loop/pingpong/reverse/per-instance offsets need a schema extension
  (deferred; the frozen media planners already support those modes).
- Frame extraction uses an offscreen HTMLVideoElement seek (accuracy =
  browser seek precision, not exact WebCodecs). Upgrade path documented in
  `motionTextureAcquisition.ts`.
- Appearance presets intentionally REJECT texture fills (media references
  would dangle in shared presets) — regression-tested.

## Bugs found by this evidence stage (both fixed)

1. `copyExternalImageToTexture` requires `COPY_DST | RENDER_ATTACHMENT` on
   the destination — B1 created textures without RENDER_ATTACHMENT; Dawn
   rejected every upload (uncaptured error). Unit tests with mocked GPU can
   never catch this class.
2. `motionShapes.wgsl` `sampleAppearance` kind dispatch: color fill (0) fell
   into the texture branch (sampled the transparent fallback → ALL motion
   shapes invisible, silently); texture fill (4) was swallowed by the
   too-broad gradient branch. This had made every motion shape invisible on
   real GPUs since B1 landed. WGSL is never executed by vitest; the MD9
   golden-fingerprint pass is the systematic net. Until then: any WGSL change
   gets one live `engine.readPixels()` check.

## Environment caveats for reproduction

- Evidence tab MUST be foreground: hidden tabs throttle timers (seek
  extraction 10–12 s vs ~1 s) and MediaInfo times out at import, leaving the
  media file without `duration` → video source correctly fail-closed as
  `TEXTURE_MEDIA_MISSING: unavailable or invalid`.
- Disposable evidence sessions reset their in-memory state when the project
  dialog re-appears/is confirmed — capture immediately after building the
  scene.
