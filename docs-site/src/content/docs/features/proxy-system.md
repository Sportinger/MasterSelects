---
title: "Proxy System"
---

[Back to Index](/features/readme/)

JPEG image proxy generation and playback for smoother scrubbing of large video files.

---

## Overview

For File System Access projects, image proxies are stored inside the project folder and are used only when proxy mode is enabled.

### Current Behavior

- Proxy mode mutes and pauses the original video elements when enabled.
- In File System Access projects, video proxies are stored as packed JPEG frame data in the project folder.
- The editor falls back to the original media when proxy data is missing.
- Audio proxy files are optional and non-fatal.
- Video proxy generation also performs scene-cut analysis when the current media has no valid scene-cut result.

---

## Proxy Generation

Proxy generation is handled by `ProxyGeneratorWebCodecs`.

### Current Pipeline

1. MP4Box parses the source file.
2. Codec configuration is extracted from the sample entry (`avcC`, `hvcC`, `vpcC`, or `av1C`) and passed to WebCodecs.
3. WebCodecs `VideoDecoder` decodes frames.
4. When Dedicated Workers are available, decoded `VideoFrame` objects are transferred to a bounded worker pool; otherwise a main-thread `OffscreenCanvas` pool is used.
5. The selected encoder pool resizes on `OffscreenCanvas` and encodes a JPEG frame.
6. JPEG frames are saved into project proxy pack files plus an index.
7. The decoded frames can also feed scene-cut analysis during the same generation pass.

### Current Settings

- Maximum width: 1280 px
- Proxy frame rate: 30 fps
- Decode batch size: 30 samples
- Image format: JPEG
- JPEG quality: 0.82
- Worker encoder pool: up to 8 Dedicated Workers, leaving 2 hardware threads reserved when possible

### Queue Support

- Enabling proxy mode starts the next missing video proxy immediately.
- When proxy mode is already enabled, newly imported videos are added to the proxy generation flow as soon as import finishes.
- The timeline proxy button shows the active queue position while generating, for example `Generating 1/5`.

### Completion Rule

- A proxy is marked ready when the generated JPEG frame index contains at least 98 percent of the expected frame indices.

### Resource Limit

- Only one proxy generation runs at a time.
- Additional videos are processed sequentially by the proxy generation queue.

---

## Storage

For File System Access projects, video proxies are stored under `Proxy/{storageKey}/`, where `storageKey` is the file hash when available and otherwise the media file ID.

### Current On-Disk Layout

- Video proxies are written as packed JPEG data: `Proxy/{storageKey}/frames_0000.pack`, `Proxy/{storageKey}/frames_0001.pack`, and `Proxy/{storageKey}/frames.index.json`.
- The index maps each frame index to a pack filename, byte offset, byte size, and MIME type.
- Project compatibility supports `frame_000000.jpg` and `.webp` frame files.
- Audio proxies are written as WAV files under `Audio Proxies/`, using a sanitized storage-key filename such as `<storageKey>.wav`. Project compatibility supports `Proxy/{storageKey}/audio.wav` and `Proxy/{storageKey}/audio.m4a` files.

### Backend Caveat

- Image proxy frame storage currently uses the File System Access project-handle path. The Native Helper path supports audio proxies but does not persist image proxy frames.

### Deduplication

- Storage is keyed by `fileHash` when available.
- If no file hash is available, the media file ID is used.

---

## Proxy Playback

`proxyFrameCache` loads JPEG frame blobs on demand and keeps decoded `HTMLImageElement` objects in memory for scrubbing.

### Current Behavior

- Exact image-frame lookups are cached in memory.
- Nearest-frame and held-frame fallbacks smooth scrubbing while requested frames are still loading.
- Playback can use proxy audio when it exists.
- Missing proxy frames fall back to the original source media.

### Cache Limits

- Image-frame cache size: 900 frames
- Scrubbing preload window: 90 frames around the scrub position in active scrubs
- Parallel preload batch size: 16

### Limitation

- The proxy cache reads image frames from the project folder. It does not use IndexedDB as an alternate store.

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

- Audio extraction is non-blocking after the JPEG proxy frames complete.
- Audio proxy failures are treated as non-fatal.
- If extraction succeeds, the current audio proxy is saved as WAV. Project compatibility supports `audio.m4a` proxy files.
- Scrub audio uses decoded WAV/AudioBuffer data and schedules pitch-stable short grains with minimal overlap.
- Fast scrub jumps fade out older grains before scheduling the new position so stale audio does not stack up.

### Limitation

- Proxy audio is best-effort. The editor keeps working even if audio extraction fails.

---

## Sources

Key implementation files:

- `src/services/proxyGenerator.ts`
- `src/workers/proxyFrameEncodeWorker.ts`
- `src/services/proxyFrameCache.ts`
- `src/stores/mediaStore/slices/proxySlice.ts`
- `src/stores/timeline/proxyCacheSlice.ts`
- `src/services/project/ProjectFileService.ts`
- `src/services/project/domains/ProxyStorageService.ts`
