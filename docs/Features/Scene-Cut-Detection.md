[Back to Index](./README.md)

# Frame-Accurate Scene-Cut Detection

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

The adaptive detector does not require most of the full frame to change.
Shared-background shot/reverse-shot edits can pass through a combination of
content, histogram, edge, and motion-compensated evidence, while the rolling
baseline keeps ordinary subject motion below the local cut threshold. Detector
version changes invalidate older cut caches so improved scoring is applied on
the next scan.

A candidate is delayed by one frame. This lets the detector suppress an
isolated flash that immediately returns to the preceding image. An
unconfirmed candidate on the final source frame is not emitted.

The first frame after a confirmed boundary supplies both the exact source
timestamp and decoded presentation-frame number.

## Performance and platform behavior

On non-Linux platforms, source frames are cloned into a dedicated analysis
worker. The worker owns its `OffscreenCanvas`, performs the `160x90` readback
and scoring, and applies bounded backpressure so decoded `VideoFrame` handles
cannot accumulate without limit.

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
The same marker resource is rendered by the worker canvas and the Linux
main-thread fallback. The clip Properties **Analysis** summary shows the number
of cuts in the visible clip range (with the source total on hover). If the
source has no cut cache yet, the same row offers **Analyze** or **Retry** and
shows decode progress while the frame-accurate scan runs. The Analysis tab's
top action area also provides dedicated Analyze, Reanalyze, Retry, and Cancel
controls for Scene Cuts alongside the other independent analysis pipelines.
The four channels use a two-column action grid, and **Analyze All** runs the
video-heavy pipelines sequentially to avoid competing decoder and GPU work.

## Scope

This detector intentionally targets hard cuts. Gradual fades and dissolves are
not reported as hard cuts; they require a separate windowed transition
detector. Current results are exposed as a persisted cut index, a found-cut
count in the context menus, and clip markers. Automatic timeline splitting
remains a separate editing action.
