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

GPU resources belong to their device/consumer. Slit Scan's atlas has a separate
640 MiB budget; browser decoder storage is additional. Allocate only requested
history and optional lookahead, not a fixed maximum layer count. Temporal resource
failures bypass their effect during preview with an inspector status; an active
export preparation collector must receive the error rather than export a bypass.

## Current graph integration

[`EffectsPipeline`](../../src/effects/EffectsPipeline.ts) currently chooses
`TemporalEffectResources` / `SourceTemporalRuntime` **only for `slit-scan`**.
Its `image.sample-history` node receives the persistent atlas and age metadata;
the same graph feeds the effect and node previews. The absolute clip-time grid,
trim/speed mapping and current-input sample belong to `SourceTemporalRuntime`,
not to the generic frame service.

`usesInputHistory: true` enables compilation of `image.sample-history`; it does
not select deterministic source sampling. A different owner currently falls
through to `InputHistoryRuntime`. Only Slit Scan declares this flag in the
registered effects at this audit. Before adding another source-time effect,
introduce an explicit owner capability/resolver instead of copying the Slit Scan
type check or assuming the node opts in automatically. Keep previous-output
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
