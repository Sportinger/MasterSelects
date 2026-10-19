# H.265 / HEVC decoding

MP4/MOV sources tagged `hvc1` or `hev1` use the shared `hevc` frame provider. The decision is based on the actual codec configuration, not the operating system. Linux/Chrome without HEVC support is one affected configuration; native availability also varies on other platforms.

## Decoder selection

1. Read MP4 decoder configuration and packet timing without loading the entire video into memory.
2. Ask WebCodecs whether that configuration is supported, then require an actual decoded first frame.
3. If unsupported, configuration fails, decoding errors, or no frame arrives within the bounded wait, use FFmpeg's HEVC decoder in the existing libavcodec WASM worker. Subsequent native decoding failures use the same fallback.

The WASM binary is fetched only for software decoding. No upload, external service, browser flags, or pre-conversion is required. Decode stays off the main thread. Main and Main10 4:2:0 output are supported; unsupported pixel formats report an error. Software decoding does not guarantee real-time 4K playback. This feature does not automatically create proxies.

## Playback slower than real time

Software decoding can be slower than the source frame rate (measured: 1080p50 HEVC at
about 36 fps in WASM). The GOP engine measures the cost per frame of its restarts. When
it is slower than real time and a playback request would restart behind the playhead,
it jumps ahead to the next key frame instead (`playbackJumps` in `getStats`). The
provider holds that picture until the playhead reaches it (`playbackHolds`), then
decodes forward. Seeks, scrubbing and export stay frame exact. The playback health
monitor does not purge a decoder that still advances this way: its pause plus exact
seek cost another full GOP. Measured on a 100-minute 1080p50 HEVC clip: before, about
4 frames in 10 s and a black preview with three automatic purges; after, about 12 preview
updates per second without purges during playback.

## Shared consumers

- Source monitor (including audio, seeking and rotation) and muted Media hover playback.
- Timeline playback and scrubbing, including reversed/non-monotonic source requests.
- Media thumbnails and timeline thumbnails.
- Explicit proxy generation through the existing codec provider strategy.
- FAST and precise export through the existing exact-frame provider contract.
- Temporal source-frame consumers using `SourceFrameService`.

The MP4 timestamp index preserves variable frame intervals and maps presentation order separately from decode order. Decoder sessions retain their GOP state across nearby forward requests. Output frames, workers, packet readers and failure caches stay in runtime owners, not project data. Canvas consumers apply container rotation; GPU playback and export receive the source rotation separately.

## Implementation and diagnostics

- `src/services/mediaRuntime/hevc/`: packet index, native/WASM adapters and adaptive provider.
- `src/services/mediaRuntime/codec/GopDecodeEngine.ts`: shared GOP engine, also used by MXF.
- `src/services/mediaRuntime/codec/LibavWorker.ts`: shared worker ownership and error propagation.
- `tools/libavcodec-wasm/`: reproducible FFmpeg n7.1.1 / emsdk 3.1.50 build; HEVC decoder and parser are enabled.
- `public/wasm/libavcodec/SOURCE.md`: provenance, license, rebuild instructions and binary checksums.

Logger module `HEVC` records selection and failures. Provider diagnostics report `hwAccel: webcodecs` or `wasm-worker`, codec string, fallback reason, packet/seek statistics and decode latency. The source monitor displays load and failure state instead of leaving decoder failures unexplained.

## Validation (2026-10-13)

- Chrome/Linux without native HEVC: two original Pixel 4K portrait clips render in the source monitor; an additional Main10 fixture renders through WASM. H.264 still uses HTML playback.
- Timeline preview preserves portrait orientation. FAST and precise 3-second exports produce H.264 video plus non-silent audio; exported frames were inspected.
- Exact seeks at 0, 2, 9, 1 and 13.8 seconds match the original packet timestamps, including reverse/distant requests. Temporal reads and resumed proxy generation produce correctly oriented frames.
- Targeted regression suite: 101 tests covering capability/failure fallback, worker disposal/errors, VFR/reordering, orientation, source monitor, thumbnails, proxies, temporal frames and existing MXF/renderer behavior. Native success and failure paths are unit-tested; other operating systems have not been tested with this change.
