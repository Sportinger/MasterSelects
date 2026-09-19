---
title: "ProRes Browser Decode"
---

## Status

Browser-local ProRes decode is an experimental, disabled-by-default backend.
The progressive ProRes 422 path is implemented and proven in Chromium, but it
must not be advertised as a cross-browser default until the remaining rollout
matrix passes.

The gate is `flags.turboResProRes` in `src/engine/featureFlags.ts`. When it is
off, existing browser WebCodecs, HTML-media, proxy, and Native Helper behavior
is unchanged.

## Supported scope

| Source | Current behavior |
|---|---|
| `apco` ProRes 422 Proxy | Experimental progressive decode |
| `apcs` ProRes 422 LT | Experimental progressive decode |
| `apcn` ProRes 422 | Experimental progressive decode; browser-proven |
| `apch` ProRes 422 HQ | Experimental progressive decode; fixture-proven |
| `ap4h` ProRes 4444 | Recognized, but production enablement waits for alpha visual gates |
| `ap4x` ProRes 4444 XQ | Recognized, but production enablement waits for alpha/12-bit visual gates |
| `aprn` / `aprh` ProRes RAW | Explicitly unsupported |
| Interlaced ProRes | Explicitly rejected until a field/deinterlace policy exists |

The current WebGPU path is primarily RGBA8. Retaining 10/12-bit and HDR source
metadata does not imply end-to-end HDR or high-bit-depth monitoring/export.

## Decode path

```text
MOV/MP4 File
  -> range-backed Mediabunny input
  -> encoded ProRes packet
  -> TurboRes WASM decoder
  -> capability-selected planar output
  -> VideoFrame
  -> MediaRuntime decode session
  -> WebGPU preview / Source Monitor / thumbnail / proxy / export consumer
```

TurboRes is a `RuntimeFrameProvider` backend beside WebCodecs. It is not part of
`WebCodecsPlayer`, does not own audio, and is never stored in Zustand or project
JSON. Decoder, frame pool, packets, workers, `File`, and `VideoFrame` references
remain session-owned runtime state.

## Import and persistence

MOV/MP4 metadata is read independently of `<video>` support. The durable media
record keeps the raw `videoCodecId` FourCC plus friendly codec, duration, fps,
coded/display dimensions, rotation, pixel aspect, color hints, HDR capability,
alpha capability, and audio metadata. Older projects keep these fields optional
and lazily probe missing ISOBMFF metadata.

Project restore rebinds runtime IDs to restored video and audio clips while
keeping runtime-only handles outside serialized state.

## Playback and product surfaces

- Preview, paused display, scrubbing, forward playback, reverse playback, and
  looping request frames through the same provider/session boundary.
- Source Monitor uses a provider-backed canvas for ProRes instead of relying on
  an unplayable `<video>` element.
- Media and timeline thumbnails can request a single TurboRes frame.
- Proxy and scene-cut paths use a decoded-frame strategy while retaining their
  existing JPEG/backpressure pipeline.
- Audio stays independent. Linked audio, waveform analysis, audio proxies, and
  export mixing do not depend on native ProRes video playback.
- Export requests exact provider frames and feeds ordinary `VideoFrame`s into
  the existing WebGPU renderer. Timing policy and decode backend remain
  separate. Packet intervals remain half-open with only floating-point boundary
  tolerance, so mixed-rate output such as 24 fps from a 23.976 fps source keeps
  the correct preceding source frame instead of rejecting a valid exact seek.

## Scheduling, memory, and cleanup

The runtime coordinator admits two resources per provider session: a runtime
binding and a frame provider. Estimates include bounded demux/decoder/frame
memory rather than charging the complete source file.

Shared memory is used only when TurboRes and the browser report it available;
otherwise the decoder uses message-passing workers. Concurrency is explicitly
bounded by policy and never defaults independently to all logical CPU cores for
every clip.

Decode sessions own both their provider and the coordinator lease. Replacing or
disposing a session destroys the provider and releases the lease exactly once.
Clip deletion, project replacement, and removal of a no-audio linked placeholder
all release their media-runtime owner. A repeated import/scrub/delete browser
probe must return TurboRes provider/session/resource counts to zero.

## Proven browser evidence

On Windows Chromium, with the shared-memory path and concurrency `4`:

- A real 1920x1080 23.98 fps `apcn` MOV displayed through TurboRes in the WebGPU
  preview.
- Scrubbing, forward playback, reverse playback, and loop wrap completed
  without a preview freeze.
- A 60-second browser-local export completed with 1800 frames and independent
  audio. The 14.3 MB result probed as H.264 1920x1080 at 30 fps plus stereo AAC
  48 kHz.
- Full reload/project restore rebuilt the runtime source correctly.
- Removing a no-audio `apch` fixture drained two active TurboRes sessions to
  zero providers, leases, and sessions.

This evidence does not substitute for Firefox, Safari, macOS, Linux/Mesa, 4K,
or ProRes 4444 alpha validation.

## Diagnostics

- `getStats.providerRuntime.providers` identifies `providerKind: "turbores"`.
- `getStats.timelineRuntimeCoordinator` exposes active runtime-playback leases,
  session counts, frame-provider counts, and estimated heap use.
- The `RuntimePlayback` logger reports provider initialization failures with the
  media source and FourCC.
- Provider debug info includes FourCC, output format, shared-memory mode,
  concurrency, queue depth, decoded/prefetched/discarded/error counts, and last
  decode latency.

## Rollout gates

Keep the feature disabled by default until product policy accepts the remaining
matrix:

1. `ap4h` and `ap4x` straight/premultiplied alpha through visible WebGPU output.
2. Chromium message-passing mode, Firefox, and Safari.
3. Windows, macOS, and Linux/Mesa presentation.
4. 1080p/4K single-source, overlap, scrub-storm, export, and memory recovery.
5. Explicit product messaging for RGBA8/HDR limitations and interlaced media.

The detailed living plan and evidence log is
`docs/ongoing/TurboRes-ProRes-Browser-Decode-Integration-Plan.md`.
