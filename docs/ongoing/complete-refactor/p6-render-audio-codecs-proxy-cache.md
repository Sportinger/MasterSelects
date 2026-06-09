# Complete Refactor - P6 Render Audio Codecs Proxy And Cache

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

Goal: split hot paths by lifecycle and ownership without regressing playback,
scrubbing, export, GPU, audio, or cache behavior.

Current codebase signals:

- `RenderDispatcher.ts`: 2,543 LOC, 41 fan-out, 24 runtime-handle hits.
- Render paths still read live stores during frame work; target state should use
  per-frame snapshots instead of mid-render store reads.
- `WebCodecsPlayer.ts`: 2,539 LOC, 37 runtime-handle hits.
- `WebGPUEngine.ts`: 1,113 LOC, 27 fan-out, 31 runtime-handle hits.
- `LayerCollector.ts`: 1,553 LOC.
- `NestedCompRenderer.ts`: 1,269 LOC.
- `proxyFrameCache.ts`: 3,266 LOC, 53 runtime-handle hits.
- `proxyFrameCache` mixes JPEG/image data, raw `VideoFrame`s, audio elements,
  audio buffers, object URLs, decoder creation, and scrub `AudioContext`
  ownership.
- `proxyGenerator.ts`: 1,427 LOC.
- `thumbnailRenderer.ts`: 1,198 LOC.
- `ClipAudioRenderService.ts`: 2,121 LOC.
- `AudioRecordingService.ts`: 2,058 LOC.
- `audioRoutingManager.ts`: 1,921 LOC.
- `AudioEffectRenderer.ts`: 2,011 LOC.

Target shape:

- Render:
  - `RenderFrameSnapshot`
  - `RenderTargetSnapshot`
  - `RenderOutputRouter`
  - frame request planner
  - layer collection
  - render target routing
  - effect/compositor dispatch
  - nested comp handling
  - diagnostics/stats
- WebCodecs:
  - source open/close lifecycle
  - `VideoFrameLease` or explicit borrow/clone/close contract
  - frame cache with ownership rules
  - seek/playback state
  - decode scheduling
  - error recovery
- Proxy/cache/thumbnail:
  - cache key policy
  - storage owner
  - frame extraction
  - coalesced or batched decode provider instead of per-frame decoder churn
  - object URL revoke accounting
  - `VideoFrame` close accounting
  - thumbnail render
  - cleanup/eviction
- Audio:
  - audio context ownership map
  - live playback routing owner
  - scrub audition owner
  - recording lifecycle
  - clip render planning
  - route graph ownership
  - export/offline rendering owner
  - diagnostics/compat owner
  - effect renderer registry
  - export audio pipeline

Concrete targets:

- Do not begin these splits before Phase 0 smokes exist.
- Each hot-path split must name the invariant preserved:
  - frame identity
  - seek consistency
  - GPU resource lifetime
  - object URL lifetime
  - audio graph route consistency
  - audio context lifetime
  - export frame/audio sync
  - cache eviction correctness
  - `VideoFrame` close/borrow correctness
  - object URL revoke correctness
  - HMR-safe runtime owner behavior

Gates:

- `P6_RENDER_FRAME_SNAPSHOT`
- `P6_RENDER_OUTPUT_ROUTER`
- `P6_RENDER_DISPATCHER_OWNERSHIP_SPLIT`
- `P6_WEBCODECS_LIFECYCLE_SPLIT`
- `P6_VIDEOFRAME_LEASE_CONTRACT`
- `P6_PROXY_CACHE_OWNER_DEFINED`
- `P6_PROXY_CACHE_CLOSE_REVOKE_ACCOUNTING`
- `P6_PROXY_DECODER_COALESCING`
- `P6_THUMBNAIL_PROXY_BOUNDARY`
- `P6_AUDIO_CONTEXT_OWNERSHIP_MAP`
- `P6_AUDIO_RECORDING_AND_ROUTE_BOUNDARY`
- `P6_SCRUB_AUDIOCONTEXT_DISPOSED`
- `P6_EXPORT_AUDIO_SYNC_GUARD`

Checks:

- playback trace smoke
- scrub/seek smoke
- proxy cache pressure smoke
- audio context baseline smoke
- render dispatcher unit tests
- WebCodecs player tests
- proxy frame cache tests
- thumbnail tests
- audio render tests
- export frame/audio sync smoke

Do not:

- Do not start hot-path splits before Phase 0 playback/export/proxy/audio
  smokes have thresholds.
- Do not close or transfer `VideoFrame`, object URL, GPU, or audio resources
  without accounting checks.
- Do not let render paths read live stores during frame work once snapshot
  contracts exist.
- Do not combine live playback, scrub audition, recording, and export audio
  ownership in one manager without an ownership-map exception.

