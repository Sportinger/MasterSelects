# Proxy System

[Back to Index](./README.md)

All-intra MP4 proxy generation and playback for smoother editing of large video files.

---

## Overview

Proxies are stored inside the project folder and are used only when proxy mode is enabled. The current implementation does not generate a separate proxy folder picker or a detached proxy library.

### Current Behavior

- Proxy mode mutes and pauses the original video elements when enabled.
- Video proxies are stored as `proxy.mp4` files in the project folder.
- The editor falls back to the original media when proxy data is missing.
- Audio proxy files are optional and non-fatal.
- The legacy `frame_000000.jpg` / `.webp` proxy-frame sequence path is disabled.

---

## Proxy Generation

Proxy generation is handled by `ProxyGeneratorWebCodecs`.

### Current Pipeline

1. MP4Box parses the source file.
2. Codec configuration is extracted from the sample entry (`avcC`, `hvcC`, `vpcC`, or `av1C`) and passed to WebCodecs.
3. WebCodecs `VideoDecoder` decodes frames.
4. A single `OffscreenCanvas` resizes frames to the proxy resolution.
5. WebCodecs `VideoEncoder` encodes every proxy frame as a H.264 keyframe.
6. MediaBunny muxes the encoded frames into `proxy.mp4`.
7. The MP4 proxy is saved to the project proxy folder.

### Current Settings

- Maximum width: 1280 px
- Proxy frame rate: 30 fps
- Decode batch size: 30 samples
- Video codec: H.264 in MP4
- Keyframe interval: every frame

### Queue Support

- Enabling proxy mode starts the next missing video proxy immediately.
- When proxy mode is already enabled, newly imported videos are added to the proxy generation flow as soon as import finishes.
- The timeline proxy button shows the active queue position while generating, for example `Generating 1/5`.

### Completion Rule

- A proxy is marked ready when the generated all-intra MP4 reaches at least 98 percent of the expected frame count.

### Resource Limit

- Only one proxy generation runs at a time.
- Additional videos are processed sequentially by the proxy generation queue.

---

## Storage

Proxies are stored in the project folder under `Proxy/{mediaId}/`.

### Current On-Disk Layout

- Video proxies are written as `Proxy/{mediaId}/proxy.mp4`.
- Legacy `frame_000000.jpg`, `frame_000001.jpg`, and `.webp` frame sequences are not generated or read by the active proxy path.
- Audio proxies are written as WAV files under the project audio-proxy folder, using a sanitized storage-key filename such as `<mediaId>.wav`. Older `Proxy/{mediaId}/audio.wav` and `Proxy/{mediaId}/audio.m4a` files are still read for compatibility.

### Backend Caveat

- Video proxy MP4 storage currently uses the File System Access project handle path. Native Helper-backed projects can persist audio proxies through the native backend, but video proxy MP4 files are not written through the same native path yet.

### Deduplication

- Storage is keyed by `fileHash` when available.
- If no file hash is available, the media file ID is used.

---

## Proxy Playback

`proxyFrameCache` loads `proxy.mp4`, demuxes the all-intra samples, decodes requested frames through WebCodecs, and keeps a small `VideoFrame` cache for scrubbing.

### Current Behavior

- Exact all-intra frame lookups are cached in memory.
- The cache decodes frames directly from MP4 samples instead of loading JPEG files.
- Playback can use proxy audio when it exists.
- Missing proxy frames fall back to the original source media.

### Cache Limits

- VideoFrame cache size: 120 frames
- Scrubbing preload window: 90 frames around the scrub position in active scrubs
- Parallel preload batch size: 16

### Limitation

- The proxy cache only reads `proxy.mp4` from the project folder. It does not use IndexedDB as an alternate store.

---

## Warmup

The warmup button in the proxy cache path does not generate proxy files.

### What It Does

- It seeks the source video elements in 0.5 second steps.
- It is meant to warm browser decode and cache state.
- It includes nested composition clips.

### What It Does Not Do

- It does not create new proxy frames.
- It does not convert media into proxy format.

---

## Audio Proxies

After the video frames finish, the code attempts to extract audio in the background.

### Current Behavior

- Audio extraction is non-blocking after the frame sequence completes.
- Audio proxy failures are treated as non-fatal.
- If extraction succeeds, the current audio proxy is saved as WAV. Legacy `audio.m4a` proxy files remain readable.

### Limitation

- Proxy audio is best-effort. The editor keeps working even if audio extraction fails.

---

## Current Limitations

- Native Helper-backed projects do not currently persist video proxy MP4 files through the same native path.
- Proxy generation is browser-session based and relies on WebCodecs and OffscreenCanvas support.
- Only one generation can run at a time.

---

## Sources

Key implementation files:

- `src/services/proxyGenerator.ts`
- `src/services/proxyFrameCache.ts`
- `src/stores/mediaStore/slices/proxySlice.ts`
- `src/stores/timeline/proxyCacheSlice.ts`
- `src/services/project/ProjectFileService.ts`
- `src/services/project/domains/ProxyStorageService.ts`
