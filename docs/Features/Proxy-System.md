# Proxy System

[Back to Index](./README.md)

Proxy generation and playback for smoother editing of large video files.

---

## Overview

Proxies are stored inside the project folder and are used only when proxy mode is enabled. The current implementation does not generate a separate proxy folder picker or a detached proxy library.

### Current Behavior

- Proxy mode mutes and pauses the original video elements when enabled.
- Proxy frames are loaded from the project folder when they exist.
- The editor falls back to the original media when proxy data is missing.
- Audio proxy files are optional and non-fatal.

---

## Proxy Generation

Proxy generation is handled by `ProxyGeneratorWebCodecs`.

### Current Pipeline

1. MP4Box parses the source file.
2. WebCodecs `VideoDecoder` decodes frames.
3. A pool of 8 `OffscreenCanvas` instances resizes and encodes frames in parallel.
4. Each frame is encoded to a JPEG blob.
5. The frame is saved to the project proxy folder.

### Current Settings

- Maximum width: 1280 px
- Proxy frame rate: 30 fps
- JPEG quality: 0.82
- Decode batch size: 30 samples

### Resume Support

- Existing frame indices are read from disk before generation starts.
- Already-saved frames are skipped.
- Generation can resume after interruption instead of starting over.

### Completion Rule

- A proxy is marked ready when it reaches at least 98 percent of the expected frame count.

### Resource Limit

- Only one proxy generation runs at a time.

---

## Storage

Proxies are stored in the project folder under `Proxy/{mediaId}/`.

### Current On-Disk Layout

- Proxy frames are written as `frame_000000.webp`, `frame_000001.webp`, and so on.
- Audio proxy is written as `audio.m4a`.
- A `proxy.mp4` file is supported by the storage facade, but this branch does not use that path in the active generation flow.

### Important Drift

- The generator currently writes JPEG blobs, even though the frame files are named with a `.webp` extension.
- Browsers load the files by bytes, so playback still works, but the extension does not match the encoded content.

### Deduplication

- Storage is keyed by `fileHash` when available.
- If no file hash is available, the media file ID is used.

---

## Proxy Playback

`proxyFrameCache` loads frames from the project folder and keeps them in memory for fast scrubbing.

### Current Behavior

- Exact frame lookups are cached in memory.
- The cache also preloads nearby frames to smooth playback and scrubbing.
- Playback can use proxy audio when it exists.
- Missing proxy frames fall back to the original source media.

### Cache Limits

- Frame cache size: 900 frames
- Scrubbing preload window: 90 frames around the scrub position in active scrubs
- Parallel preload batch size: 16

### Limitation

- The proxy cache only reads from the project folder. It does not use IndexedDB as an alternate store.

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
- If extraction succeeds, the audio is saved as `audio.m4a`.

### Limitation

- Proxy audio is best-effort. The editor keeps working even if audio extraction fails.

---

## Current Limitations

- Frame files are named `.webp` even though the generator writes JPEG blobs.
- `proxy.mp4` storage support exists but is not part of the active generation flow.
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
