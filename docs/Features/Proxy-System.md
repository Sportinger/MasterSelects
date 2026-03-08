# Proxy System

[<- Back to Index](./README.md)

WebCodecs-accelerated proxy generation for smooth editing of large video files.

---

## Table of Contents

- [Overview](#overview)
- [Proxy Generation](#proxy-generation)
- [Proxy Playback](#proxy-playback)
- [Storage](#storage)
- [Configuration](#configuration)

---

## Overview

### Purpose
Large video files (4K, high bitrate) can be slow to scrub. Proxies provide:
- Smaller, faster decode files
- Smooth timeline scrubbing
- Full quality on export

### How It Works
1. Generate low-res proxy of video
2. Edit using proxy files
3. Final export uses original media

---

## Proxy Generation

### Starting Generation
1. Right-click video in Media Panel
2. Select "Generate Proxy"
3. Generation starts in background (proxies stored in project folder automatically)

### Generation Process (WebCodecs + Parallel Canvas)
The proxy generator uses a pipeline for maximum speed:

1. **Video Demuxing**: MP4Box parses the video container and extracts samples
2. **Video Decoding**: WebCodecs VideoDecoder with hardware acceleration
3. **Parallel Canvas Resize**: Pool of 8 OffscreenCanvases resize frames in parallel
4. **JPEG Encoding**: Each canvas independently does `drawImage` then `convertToBlob` to JPEG

### Resume from Disk
- Proxy generation can be interrupted and **resumed from disk**
- If generation is interrupted (browser close, crash), it picks up where it left off
- Already-generated frame indices on disk are skipped automatically
- No need to start over from scratch

### Technical Details
- **Max Resolution**: 1280px width (maintains aspect ratio)
- **Canvas Pool Size**: 8 parallel encoding canvases
- **Decode Batch Size**: 30 samples fed at a time before yielding
- **Output Format**: JPEG at 82% quality
- **Frame Rate**: 30 fps proxy
- **Fallback**: If decode fails with codec description, retries without description

### Automatic Project Folder Storage
Proxies are automatically stored in your project folder:
```
MyProject/
  Proxy/
    {mediaHash}/
      frames/
        000000.jpg
        000001.jpg
        ...
```

No folder picker needed - proxies go directly to project folder.

### Partial Proxies
- Can use proxy while generating
- Frames available immediately
- Falls back to original for missing frames

### Audio Extraction
- After video proxy frames complete, audio is extracted in the background (non-blocking)
- Audio proxy is stored separately via `projectFileService.saveProxyAudio()`
- Audio extraction failures are non-fatal

---

## Proxy Playback

### Automatic Switching
Editor automatically uses:
- Proxy frames when available
- Original video when proxy missing
- Seamless transition between

### Timeline Integration
- Proxy frames display in preview
- Scrubbing uses proxy cache
- Playback synced with timeline
- **Yellow indicator** on timeline ruler shows cached proxy frames (proxy cache indicator)
- **Warmup button**: Preload proxy frames into cache before playback for smoother start

### Preview Quality
- Proxies shown during editing
- Clear enough for decision-making
- Full quality visible in export preview

---

## Storage

### Project Folder Storage
Proxies stored in your project folder:
- No separate folder selection needed
- Files persist with project
- Hash-based deduplication

### File Organization
```
ProjectFolder/Proxy/{mediaHash}/frames/
```
- `{mediaHash}` = content hash of file (first 2MB)
- Same file imported twice shares proxies
- Portable with project folder

### Storage Requirements
- Depends on proxy resolution (1280px max)
- Delete `Proxy/` folder to reclaim space

### Deduplication
Files are identified by content hash:
- Same video = same proxies
- Re-import doesn't regenerate

---

## Configuration

### Proxy Mode Toggle
- Proxy mode starts disabled (`proxyEnabled: false`)
- Toggle enables/disables proxy playback
- When enabled, all video elements are muted and paused (proxy frames replace video playback)

### Proxy Completion
- Proxy is considered complete when >= 98% of expected frames are generated
- Completion check: `frameCount >= Math.ceil(duration * 30) * 0.98`

---

## Background Processing

### Progress Indication
- Shows generation progress as percentage
- Frame count progress
- Cancelable (preserves partial proxy as "ready" if frames exist)

### Resource Usage
- WebCodecs hardware-accelerated decoding
- Doesn't block UI
- Can edit while generating
- Only one proxy generates at a time (`currentlyGeneratingProxyId` gate)

---

## Troubleshooting

### Proxy Not Used
- Check if proxy mode is enabled
- Verify proxy status is 'ready'
- Check file permissions

### Slow Generation
- WebCodecs hardware acceleration required
- Check chrome://gpu
- Large files take time

### Storage Full
- Delete old proxies (remove `Proxy/` folder in project)
- Check disk space

---

## Technical Implementation

### Files

| File | Purpose |
|------|---------|
| `src/services/proxyGenerator.ts` | `ProxyGeneratorWebCodecs` class - MP4Box demuxing + WebCodecs decode + parallel canvas JPEG encode |
| `src/stores/mediaStore/slices/proxySlice.ts` | Zustand slice: generateProxy, cancelProxyGeneration, proxy state management |
| `src/stores/mediaStore/constants.ts` | `PROXY_FPS = 30` |
| `src/services/projectFileService.ts` | Disk I/O: saveProxyFrame, getProxyFrameCount, getProxyFrameIndices |
| `src/services/audioExtractor.ts` | Audio proxy extraction (lazy-imported) |

---

## Related Features

- [Media Panel](./Media-Panel.md) - Proxy controls
- [GPU Engine](./GPU-Engine.md) - GPU acceleration
- [Preview](./Preview.md) - Proxy playback
- [Project Persistence](./Project-Persistence.md) - Proxy paths

---

## Tests

No dedicated unit tests -- this feature requires hardware-dependent APIs (WebCodecs, OffscreenCanvas) that cannot be easily mocked.

---
