---
title: "Frame-Accurate Scene-Cut Detection"
---

MasterSelects detects hard shot boundaries from every decoded source video
frame. The detector records the presentation timestamp of the first frame of
the new shot, so results remain frame-accurate for variable-frame-rate and
50/60 fps footage even though the JPEG proxy itself is capped at 30 fps.

## Workflow

- New proxy generation runs scene-cut detection in the same sequential
  `VideoDecoder` pass, before frames are deduplicated to the proxy frame rate.
- Existing proxies are left ready and untouched. **Regenerate > Scene Cuts**
  in either the Media or Timeline clip context menu starts a decode-only source
  scan.
- Results are stored on the source `MediaFile` and persisted in the project.
  The cache contains detector/schema versions, analysis dimensions, decoded
  and expected frame counts, and a source size/last-modified fingerprint.
- Replaced, changed, incomplete, or old-version sources are not accepted as a
  current frame-accurate cache.

## Detector

Every decoded source frame is resized to `160x90`. The detector combines:

- per-pixel Y/Cb/Cr difference;
- the percentage of materially changed pixels;
- global Y/Cb/Cr histogram distance;
- edge-change ratio with one-pixel tolerance;
- a small translation search that compensates camera pans up to eight
  analysis pixels;
- an adaptive threshold based on the preceding two seconds.

Shared-background shot/reverse-shot edits can pass through a combination of
content, histogram, edge, and motion-compensated evidence, while the rolling
baseline keeps ordinary subject motion below the local cut threshold. Detector
version changes invalidate older cut caches and apply improved scoring during
rescan.

A candidate is delayed by one frame. This lets the detector suppress an
isolated flash that immediately returns to the preceding image. An
unconfirmed candidate on the final source frame is not emitted.

The first frame after a confirmed boundary supplies both the exact source
timestamp and decoded presentation-frame number.

## Performance and platform behavior

When `Worker` and `OffscreenCanvas` are available and the Linux safety policy
does not apply, source frames are cloned into a dedicated analysis worker. The
worker owns its `OffscreenCanvas`, performs the `160x90` readback and scoring,
and applies bounded backpressure so decoded `VideoFrame` handles cannot
accumulate without limit. Other environments fall back to the main-thread
software analyzer.

Linux follows the shared Mesa safety policy and uses a main-thread software 2D
canvas with `willReadFrequently: true`. The canvas is fixed at `160x90` and
never scales with source resolution or timeline width.

Scene-cut progress is based on decoded source frames, not written proxy JPEGs.
Proxy readiness and scene-cut analysis state remain independent.

## Timeline display

Detected cuts are drawn as thin dashed black vertical markers on video clips.
Their stroke width and dash size shrink as markers become denser while zooming
out, so a cut-heavy source does not cover its thumbnails. Marker positions are
mapped from the stored source timestamps into each clip's current in/out range,
including live trim previews and reversed playback.
Cuts outside the visible source range and linked audio clips are not marked.
The same marker painter is used by the worker canvas and the Linux main-thread
fallback. The clip Properties **Analysis** action bar includes a **Cuts**
control that shows the source-wide cut count or decode progress and changes
between Analyze, Reanalyze, Retry, and Cancel as its state changes. It sits
alongside Focus & motion, Faces, Transcript, Audio intelligence, and AI Scenes.
**Analyze all** coordinates visual analysis, scene cuts, transcript, and audio
intelligence; source-decoding jobs share a resource lock, while audio and
provider work can run independently. AI Scenes remains an individual action.

## Scope

This detector targets frame-to-frame hard-boundary signals. Results are
exposed as a persisted cut index, a found-cut count in the context menus, and
clip markers. Automatic timeline splitting remains a separate editing action.
