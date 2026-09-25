# Temporal frame access

Call-site audit: 2026-09-23. This describes current ownership and migration
candidates, not measured speedups for consumers that have not been migrated.

## Choose the contract before choosing the cache

| Required input | Owner to use | Meaning |
| --- | --- | --- |
| Current timeline frame | Media runtime playback/export sessions and `TextureManager` | Maintains presentation, audio synchronization and codec-specific providers. |
| Original video at explicit source PTS | `SourceFrameService` + `TemporalFrameUploader` | Deterministic source access independent of the playback history. |
| Previous rendered effect output | `EffectsPipeline` feedback state / `image.frame-history` | Recursively processed output; replacing it with original video changes the effect. |
| Previously rendered effect input | `InputHistoryRuntime` | Rolling capture, including preceding effects; reset/hold/advance follows the render clock. |
| CPU pixels for analysis | An explicit CPU consumer adapter | Decode can be shared, but algorithms accepting `ImageData` still require pixel conversion. |

## Motion fields and Slit Scan reconstruction

Motion analysis is an image-graph contract. `image.optical-flow` accepts two
explicit images and their signed time interval. `image.source-motion` declares
a source-video history window; its `denseInverseSearch` option selects cached
DIS source pairs. The original local Lucas-Kanade route remains available for
existing authored consumers. Neither uses the previous playback frame.
Motion RG is UV velocity per graph-delay second, B confidence, A validity.

The generated Slit Scan detector enables DIS. `SourceMotionHistory` obtains
original PTS through `ResidentTemporalRuntime`, shared `SourceFrameService`
leases and `TemporalFrameUploader`. The DIS raw-image budget is 64 MiB; its
RGBA16F flow atlas uses the same slot layout (up to 128 MiB, plus scratch).
Analysis starts at a 320-pixel maximum edge and reduces it for long windows.
Adjacent analysis frames are selected from the real timestamp index, including
variable frame rates and trim boundaries, rather than arbitrary scan samples.
With stabilization selected, both images use its reference coordinate system.

`DisFlowGpu` independently implements the fast DIS path described by
[Kroeger et al.](https://arxiv.org/abs/1603.03590): Gaussian pyramid, mean-normalized
8×8 inverse-compositional patch search, overlapping stride-4 patches, spatial
propagation and residual-weighted densification at each scale. It additionally
checks forward/backward correspondence. Variational refinement is not included;
this is not the OpenCV binary or a learned model. Both directions are solved on
the GPU without CPU pixel readback. Each submitted pair yields before the next.

`DisMotionCache` keys fields by exact reference/target PTS and source allocation.
Changing threshold or output size reuses measured pairs. Source/analysis-size or
stabilization changes invalidate the cache; evicted PTS need recomputation.
Raw slots remain pinned while analysis is pending, and destruction waits for
submitted work. Cached UV/source-second velocities are converted by per-grid
metadata to graph-clock velocity, including Time factor, reverse/variable speed
and held boundaries. Every output pixel looks up its own source time directly;
the cached DIS lookup is not decimated to the old 80-pixel playback field.

`motion.temporal-deformation` uses inverse singular values of
`I + velocity_pixels * gradient(delay)^T`. **Stretch threshold (×)** compares
maximum stretch (default 2, transition width 0.25), weighted by confidence.
Pure compression does not activate the mask. The generated time-gradient-only
detector migrates to this path without replacing authored scan wiring; its old
parameter remains available for custom consumers. RGB-separated time sampling
retains its existing smoothing bypass.

The nine-tap directional filter blends pixels, not intermediate video frames.
Only the preview-owner overlay is forced off during export. When radius and eye
are off, compiler shortcuts remove analysis resources and their owners release
leases. Pending analysis leaves an invalid optional mask while preview continues;
export waits through the shared preparation collector. Runtime handles remain
device-local; graphs contain ordinary reusable typed nodes. Builds/test execution
are paused. Live DIS accuracy, cache/performance behavior and export parity still
require verification; do not infer a measured speedup from this implementation.

## Shared source path

The implementation lives in
[`src/services/mediaRuntime/sourceFrames/`](../../src/services/mediaRuntime/sourceFrames/SourceFrameService.ts).
`SourceFrameService.acquire({ id, url, file })` returns an owner lease. Its `ready`
promise supplies the source timestamp index. `request({ times, priority, signal,
onFrame })` coalesces source PTS requests, borrows exact native media-cache frames,
and schedules a separate background decoder. Nearby forward refills reuse its
sequential cursor; backward/distant seeks restart at an appropriate source point.
Required work preempts lookahead, and replacement requests cancel obsolete work
for that lease. Retain a lease for the consumer's lifetime, then call `release()`.

`onFrame` is synchronous and borrows its resource. Encode **and submit** GPU work
before returning. Do not close borrowed handles, retain them in stores, or keep
dozens of cloned decoder surfaces: that exhausted hardware decoder surfaces in
live testing. The reader closes decoded handles after delivery. An asynchronous
CPU/inference consumer needs a bounded ownership/conversion adapter; passing an
async callback does not extend the borrow.

[`TemporalFrameUploader`](../../src/engine/texture/TemporalFrameUploader.ts)
imports native VideoFrames and renders resize, rotation and color conversion into
a persistent RGBA texture layer. JPEG proxies copy directly into a reusable GPU
transfer texture before that render pass. There is no Canvas/ImageData readback
in this source-image path. Browser/driver-internal copies and codec implementations
are not controlled by this API; this is not a universal zero-copy guarantee.

Proxy-permitted requests may supply `proxyFps` when their media has a compatible
JPEG proxy. `SourceProxyFrames` uses the existing proxy cache, at most four explicit loads,
and the inverse of the generator's normalized, rounded PTS indexing. Bins shared
by multiple source frames are rejected. Missing/corrupt/ambiguous proxies fall
back to originals; requests without `proxyFps` never accept proxy pixels. Do not use a
nearest-cached-frame fallback for deterministic temporal effects. No automatic
proxy generation is triggered. Legacy all-intra and TurboRes/HAP proxy contracts
need separate timestamp/geometry validation before they can be admitted.

Source-time consumers call `proxyFrameCache.getFrame(..., false)` to share exact
loads without redirecting interactive timeline preloading. Do not treat each
historical sample as a new playback/scrub position. Slit Scan replenishes its own
lookahead on ready output frames as the grid advances, not only after a cache miss.

Slit Scan Small preview can reuse proxies; Full size follows the preview's global
Proxy switch. `SourceProxyDimensions` reads actual JPEG dimensions and source
rotation before atlas allocation. Do not allocate original 4K history for a
1280 × 720 proxy. Cache identity includes proxy mode, and status is based on the
resident frames' actual origin. Full-size export explicitly requests originals.

The service shares decoding, not arbitrary processed images or every GPU atlas.
`HybridTemporalRuntime` is an optional Slit Scan consumer of the same frame leases
and `TemporalFrameUploader`. It preserves the absolute temporal grid but deduplicates
decoded PTS. Per-pixel UV/delay evaluation stays on the GPU; oversized windows read
back a compact usage bitset, consume resident frames first, then reuse atlas slots
in source-ordered batches. RGBA16F additive accumulation reconstructs the two
temporal interpolation contributions. Fully resident windows avoid demand readback
and decoding. Derived demand/current graphs preserve authored mapping and current
input processing. Export uses the existing temporal preparation barrier. Hybrid
samples can follow source resolution (up to 8192 positions); the resident atlas
remains bounded by memory and device array-layer limits. Hybrid currently uses
original sources even when preview proxies are enabled.

`ResidentTemporalRuntime` adds an opt-in `temporalStorage: resident` consumer.
With `temporalPreview: adaptive`, TemporalEffectResources owns a separate resident
interactive cache for playback, dragging and paused parameter edits. A complete-window estimate chooses
a power-of-two downscale and reserves capacity before the clipped history grows;
it never changes temporal sample count. Paused renders refresh the adaptive result while
full-quality preparation completes, and account for its bytes in the remaining
resident/Hybrid budget. Export excludes and releases the interactive cache.
Interactive results capture the current input into an owned texture in the same
render encoder. They never retain a borrowed compositor ping/pong view for pause.
EffectsPipeline captures complete effect outputs in TemporalPreviewFrames. During
refills it presents this owned image instead of retaining mutable atlas/metadata
views. The snapshot cache is capped at four images / 64 MiB (one oversized image
is allowed), with GPU destruction deferred until submitted work completes.
Snapshots are presentation-only and never become temporal source history.
It implements a logical x/y/time volume using tiled 2D texture-array pages rather
than introducing a second shader resource type. Texture array layer count is not
used as a temporal sample cap: frames can occupy independent tiles within pages.
The shared TemporalFrameUploader renders borrowed source frames into those tiles
with viewport/scissor bounds. The original decode lease and PTS index remain owned
by SourceFrameService. No decoder-per-sample or rolling rendered-output history.

The mode keeps the entire requested window resident. Two-row RGBA32F metadata
maps the existing temporal grid to two physical source slots plus a source blend;
header mode 4 selects the resident sampler. A binary lower-bound search finds grid
neighbors; negative slots sample the current effect input. Spatial UVs clamp within
each tile to avoid neighboring-frame bleed. The metadata allocation and tile pages
obey the selected 640 MiB to 4 GiB budget and device limits. Allocation follows
distinct PTS plus 25% headroom (minimum four optional slots), capped by source
frame count and budget. Growth retires the old allocation before replacement;
GPU allocation and initial upload validation complete before readiness.
Incomplete windows do not
produce partially sampled exports: pending work joins the preparation barrier.
Interactive cache misses hold the last complete effect image. Dropping missing grid
positions would bridge large time gaps with current/old frames and create hard seams
in Nearest mode, so no partial metadata reaches the resident sampler. Initial load
uses the source input until the first complete image. This path never feeds export. Lookahead fills
up to twelve spare slots and is not cancelled merely because playback reaches its
pending PTS. GPU out-of-memory allocation retries once without optional headroom.
Typed capacity errors or exhausted GPU allocation retries select Hybrid streaming
in TemporalEffectResources. A per-effect settings signature latches that fallback
across advancing playback, avoiding repeated allocation attempts/cache eviction.
Changing memory/window/quality settings permits another resident attempt. Async
memory failures resolve the preparation barrier before routing the next resolve
through Hybrid; other export failures remain errors. Interactive source-load errors
retry after one second, retaining decoded GPU slots when the reader is available.
Stable source slots are reused across window
advances and spare slots can prefetch future PTS. Preview/export, mask/time-map and
stabilization semantics remain in the existing graph/source contracts.

Reference principle: [TouchDesigner Texture 3D](https://derivative.ca/UserGuide/Texture_3D_TOP)
and [Time Machine](https://derivative.ca/UserGuide/Time_Machine_TOP).
This is an independent implementation of the resident-history principle, not a
TouchDesigner integration. A Full HD resident preview has been observed, but
playback/export regression checks and performance measurements remain pending;
no real-time performance claim has been established. Compiled image program keys
include emitted WGSL so surviving GPU pipeline caches cannot confuse revised
temporal sampling helpers with the previous implementation during HMR.

The optional `temporalBatch: block` Hybrid export path reverses source/output
iteration for the standard linear graph. An exact, unrounded export frame step
is scoped to the synchronous temporal preparation collector. The planner builds
up to eight output windows, deduplicates their source PTS, and requests them in
source order through the same SourceFrameService lease. LinearTemporalBlockGpu
uses TemporalFrameUploader.importVideo to draw conservative strip rectangles
straight from each borrowed external texture into RGBA16F output tiles. Submit
before the callback returns. No retained decoder surfaces, full source-atlas
uploads, or GPU demand readbacks are needed for these historical contributions.
Current-input contributions are added only when consuming an output tile.
Tile memory is reserved from Hybrid's existing budget. Cache identity includes
source mapping, temporal settings, effect parameters and exact export spacing;
only a matching local output time can consume a tile. Eligibility fails closed
for custom graphs, spatial protection, stabilization, non-linear profiles, time
maps and reduced source resolution. Preview keeps the existing Hybrid path.
This implementation is opt-in and still awaits execution of its GPU/regression
and performance validation; do not infer a measured speedup from the architecture.

Slit Scan's `timeFactor` expands the requested source horizon by 1–100×. Source
times and stabilization coverage use that full horizon; uploaded age metadata is
divided by the factor so saved/custom graph delay coordinates remain unchanged.
This applies to both cache and Hybrid GPU paths, including demand bitsets and
export preparation. It does not change clip speed, audio, duration or output FPS.

GPU resources belong to their device/consumer. Slit Scan's atlas has a separate
640 MiB budget; browser decoder storage is additional. Allocate only requested
history and optional lookahead, not a fixed maximum layer count. Temporal resource
failures bypass their effect during preview with an inspector status; an active
export preparation collector must receive the error rather than export a bypass.

## Current graph integration

Temporal owners now declare `sourceTimeOwner` explicitly in their fullscreen
effect definition. Slit Scan retains TemporalEffectResources; Time Stack uses
TimeStackResources and ResidentTemporalRuntime with explicit output-relative
delays and a bounded continuous-window/lookahead cache. Both share SourceFrameService and TemporalFrameUploader. Time Stack's
single graph sampler runs inside Sequence Blend and shares one atlas for every
iteration. Its export preparation requires the complete window.

Slit Scan's `image.sample-history` receives its persistent atlas and age metadata;
the same graph feeds the effect and node previews. Slit Scan retains its absolute
clip-time grid, trim/speed mapping and current-input semantics. Time Stack uses
explicit relative delays through `sourceTemporalWindow` and one shared sampler
inside Sequence Blend. Source windows share decoding and GPU upload infrastructure.

`usesInputHistory: true` enables compilation of `image.sample-history`; it does
not select deterministic source sampling by itself. Owners additionally declare
`sourceTimeOwner` and route through `TemporalEffectResources.resolveSource`.
Unowned history continues to use InputHistoryRuntime. Keep previous-output
feedback and preceding-effect input history distinct.

## Other paths and consumers

| Path | Actual consumers / nodes | Reuse assessment |
| --- | --- | --- |
| `TimeMapMediaRuntime` → `openPreparedFrameCache` → `openSurfaceFrames.read()` | Slit Scan's external image/video time map; `image.named-input` with `slit-scan:time-map` | **Best direct GPU migration.** Video currently decodes to ImageData and uploads again. Borrow source frames and upload directly; static images can also avoid CPU readback. Preserve map start, hold boundaries, luma/alpha and output-time semantics. No 64-frame atlas is needed for a single map image. |
| `DepthEstimationControls` + `bakeDepthVideo` → `openSurfaceFrames.read()` | Tracking panel depth preview/bake; resulting depth video may feed Slit Scan's time map | **Good decode-sharing candidate.** Each `read()` calls `VideoSampleSink.getSample()`, unlike the new persistent cursor. `DepthRuntime.infer()` still copies ImageData to its worker and preprocessing reads CPU pixels; removing that requires a separate inference-input change. Measure decoding versus inference first. |
| `cableDepthReader` → `openSurfaceFrames.read()` | Face Cables scene-depth bake when saved depth is unavailable; feeds `depth.calibrate`, `geometry.depth`, `geometry.merge-surface`, `collision.mesh` | **Good decode-sharing candidate.** Reuses only its last depth result today. Benefits affect preparation/baking, not the already baked cable-rendering shader. Preserve depth calibration and source mapping; the CPU inference boundary remains. |
| `LandmarkTrackingService.trackClip()` → repeated HTMLVideoElement seeks | Effects inspector's Track Landmarks; supplies Subject, Motion Lab, HUD Tracker, CCTV Surveillance, Trace Motion, Rain Reveal, Stardust and Hand Particles | **Good isolation/correctness candidate.** Currently pauses and seeks the clip video for each analysis sample, then restores it. Shared background decoding could supply exact PTS without moving playback. MediaPipe currently uses the CPU delegate; inference and its monotonic model clock remain separate. |
| `preciseFaceTracking` → `openSurfaceFrames.readRange()` | Precise face tracking, Face Cables and saved face-landmark/face-mesh consumers (`geometry.face`) | **Partial reuse only.** Already decodes an ordered batch; not a decoder-per-frame loop. Sharing cancellation/index/cache may help, but CPU detection and sidecar creation remain. |
| `trackSurface` / `solveTerrain` → `openSurfaceFrames.readRange()` | Tracking workspace planar/3D solve, Surface Overlay and Terrain Overlay consumers | **Partial reuse only.** Already batched. Planar workers need CPU pixels; terrain solving creates JPEG files for the solver. Overlay playback uses saved tracking results, not this decoder. |
| `SurfacePreview` → `openSurfaceFrames.read()` | Legacy controls still reachable from the Tracking workspace | **Potential preview migration.** Currently reads ImageData and puts it onto a 2D canvas. Can borrow a frame and draw/resize without the readback, while retaining exact frame identity and overlays. |
| Feedback state / `image.frame-history` | Acuarela, Rom1, ASCII Ghost; Trace Motion and Voxel Relief also declare feedback | **Keep its semantics.** These consume prior processed output in GPU textures, not independently decoded source times. The new source cache does not replace recursive feedback. |
| `SlitScanMaskRuntime` → `generateMaskTexture` | Slit Scan protection map (`slit-scan:protection`) | **Not a source-decoding migration.** Rasterizes vector/animated masks. A GPU mask-rasterization optimization would be a separate task. |
| Media runtime + normal playback/export providers | Timeline source frames, `image.frame`, ordinary effects/transitions | **Retain these owners.** Existing playback, export, worker and specialized-codec paths have their own timing and lifetime contracts. The shared service borrows exact cached native frames without seeking their decoder. |

## Retained paths without active product consumers

- `NativeTemporalRuntime` and `PreparedInputHistoryRuntime` have unit-test
  consumers but no current product instantiation. Do not use them as templates
  for new temporal effects. `StreamedTemporalCompositor` and
  `TemporalDemandReadback` remain referenced through the former legacy runtime.
- `openPreparedFrameCache` / `PreparedFrameCache` are **not** wholly dead:
  `TimeMapMediaRuntime` still uses them.
- `surfaceFrameReader.readGpuTimes()` has tests but no current product caller;
  Slit Scan now uses `SourceFrameService`.
- `proxyFrameCache.getVideoFrame()` → `decodeProxyVideoFrameFromSource()` creates
  a decoder per all-intra request, but no outside product caller was found.
  Current active proxy presentation loads JPEGs. Optimize/reconnect this path
  only if legacy video proxy support is intentionally restored.

## Suggested order

1. Add explicit source-time resource ownership for reusable temporal graph owners.
2. Move external time-map images/videos onto direct GPU upload.
3. Share decoding for depth preview/bake and Face Cables depth, with one explicit
   bounded CPU adapter until inference can consume another representation.
4. Replace the general landmark tracker's repeated clip-video seeks; separately
   assess already batched precise-face/planar/terrain analysis.
5. Remove truly unreferenced legacy temporal implementations and their obsolete
   tests in a deliberate cleanup, retaining the CPU readers still in use.

Regression evidence should cover exact PTS (including VFR collisions), reverse
and trimmed clips, quality changes, missing proxies, cancellation, seek-versus-
playback equivalence, ownership release and export preparation barriers. Log
module `SourceFrames` reports proxy/decoded counts and elapsed time for larger
windows. Compare the actual consumer's bottleneck before promising a speedup.
