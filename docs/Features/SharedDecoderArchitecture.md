# Shared Decoder Architecture - Export System V2

> **Status: Design Proposal (NOT IMPLEMENTED)**
>
> This document is a design proposal for a future V2 export system. None of the components described below (SharedDecoderPool, FrameCacheManager, ExportPlanner) have been implemented.
>
> **Current export system (V1):** Uses `ParallelDecodeManager` (`src/engine/ParallelDecodeManager.ts`) with one VideoDecoder per clip, and `WebCodecsExportMode` (`src/engine/WebCodecsExportMode.ts`) for sequential frame-accurate export decoding. Real-time nested composition rendering uses `NestedCompRenderer` (`src/engine/render/NestedCompRenderer.ts`).

## Problem Statement

The current parallel decode system has fundamental scalability issues:

**Current Issues:**
- One VideoDecoder instance per clip instance (not per unique file)
- Same video file used 2x (regular + nested) -> 2 separate decoders
- Decoders compete for different positions -> constant resets/seeks
- With 10+ nested compositions -> 20+ decoders -> exponential slowdown
- Buffer misalignment: Target at 4.7s, buffer at 8-10s -> constant seeks

**Example Failure:**
```
Timeline time: 4.033s -> Source time: 2.616s
Buffer range: [8.120s-10.540s]
Result: Seek required -> Buffer cleared -> Infinite loop
```

## Design Goals

1. **Scale to Complex Projects**: Handle 10+ nested comps, triple-nested, 50+ unique videos
2. **Predictable Performance**: Linear scaling relative to complexity, no exponential slowdowns
3. **Memory Efficient**: Reuse decoded frames, shared decoder instances
4. **Smart Pre-fetching**: Decode frames in optimal order based on export timeline
5. **Resilient**: Graceful degradation, fallback to HTMLVideoElement if needed
6. **Hybrid Approach**: Use best system for each project complexity level

## Why Hybrid Approach?

**Benefits:**
- Simple projects keep working with proven V1 system (no regression risk)
- Complex projects get V2 where it's actually needed
- Gradual rollout: V2 bugs only affect complex projects
- Lower risk: Don't break what's working for 80% of users
- Better testing: Can compare V1 vs V2 on same project
- User trust: Always have fallback that works

**Risk Mitigation:**
- V1 continues to work -> no breaking changes for existing workflows
- V2 only activates when needed -> contained blast radius
- Manual override -> user can force V1 if V2 has issues
- Clear UI indication -> user knows which system is active

## Research Findings

Based on web research ([WebCodecs Best Practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs), [Remotion WebCodecs](https://www.remotion.dev/docs/media-parser/webcodecs), [W3C WebCodecs Issues](https://github.com/w3c/webcodecs/issues/424)):

### Key Insights

1. **Decoder Reuse**: VideoDecoder can be reused via `reset()` + `configure()` pattern
2. **Hardware Limits**: Very limited memory buffer for hardware decoders - pause until frames freed
3. **Queue Management Critical**: Monitor `decodeQueueSize` to prevent memory buildup
4. **Workers for Parallelism**: Move decoding to workers for true parallelism
5. **Frame Cache**: Professional editors use proprietary formats (ProRes, DNxHR) for frame cache
6. **Nested Comp Optimization**: Pre-render and cache nested compositions

### Professional Editor Patterns

From [DaVinci Resolve Render Cache](https://creativevideotips.com/tutorials/davinci-resolve-render-cache-essentials):
- Timeline rendered at timeline resolution in proprietary format
- Smart cache invalidation (RED for RAW, h265, effects, transitions)
- Pre-render when machine idle for 5 seconds

From [After Effects Optimization](https://pixflow.net/blog/the-ultimate-guide-to-after-effects-optimization/):
- Avoid unnecessary nested comps inside pre-comps
- Render complex comps to flattened files

## Architecture Design

### Core Components

```
                     Export Orchestrator
  - Analyzes timeline
  - Creates export plan
  - Coordinates all subsystems

      Shared       Frame       Nested
      Decoder      Cache       Comp
      Pool         Manager     Renderer

            Video Encoder
```

### 1. Shared Decoder Pool

**Purpose**: One VideoDecoder instance per unique video file (not per clip instance)

**Key Features:**
- File-based decoder mapping: `Map<fileHash, DecoderInstance>`
- Decoder reuse via `reset()` + `configure()` when switching between clips
- Worker-based for true parallelism (one worker per decoder)
- Smart position tracking to minimize seeks

### 2. Frame Cache Manager

**Purpose**: LRU cache for decoded frames with intelligent eviction

**Key Features:**
- Per-file frame buffers with configurable size (default: 120 frames per file)
- LRU eviction when cache full
- Cache statistics for monitoring
- Optional disk cache for very large projects

### 3. Export Planner

**Purpose**: Analyze timeline and optimize decode scheduling (no pre-rendering!)

**Key Features:**
- Analyzes full export range to understand file usage patterns
- Groups clips by file to minimize decoder switches
- Pre-calculates decode positions to minimize seeks
- Plans ahead 2-3 seconds for smooth pipeline
- Adaptive planning based on decoder performance

### 4. Nested Composition Renderer (Just-In-Time)

**Purpose**: Render nested compositions on-demand during export (After Effects style)

**Key Strategy:**
- **NO pre-rendering** - render nested comps frame-by-frame as needed
- Recursively resolve from deepest to shallowest for each frame
- Optional single-frame cache for repeated access within same frame
- Minimal memory footprint

## Implementation Plan

All phases are **not yet started**.

### Phase 1: Core Infrastructure
- [ ] Implement `SharedDecoderPool` with worker-based decoders
- [ ] Implement file-hash based decoder mapping
- [ ] Implement `FrameCacheManager` with LRU cache
- [ ] Add decoder reuse via reset() + configure()

### Phase 2: Export Planner & Scheduling
- [ ] Implement `ExportPlanner` timeline analysis
- [ ] Implement file usage pattern detection
- [ ] Add runtime decode scheduling (look-ahead)

### Phase 3: Nested Comp Just-In-Time Rendering
- [ ] Implement export-oriented `NestedCompRenderer`
- [ ] Add recursive layer building for export
- [ ] Integrate with SharedDecoderPool for nested clips

### Phase 4: Integration & Main Export Loop
- [ ] Integrate all components into `FrameExporter`
- [ ] Implement new export loop with just-in-time nested rendering
- [ ] Implement comprehensive error handling (NO auto-fallbacks)

### Phase 5: Polish & Production Ready
- [ ] Add export settings UI (cache size: 200MB/500MB/2GB)
- [ ] Optimize worker communication (SharedArrayBuffer?)
- [ ] Add detailed logging for debugging complex exports

## Migration Strategy - HYBRID APPROACH

**Smart Auto-Selection:**
Automatically choose the best system based on project complexity:

```typescript
function selectExportSystem(clips, tracks, compositions): 'V1' | 'V2' {
  const videoClips = clips.filter(c => c.source?.type === 'video')
  const uniqueFiles = new Set(videoClips.map(c => c.mediaFileId)).size
  const hasNestedComps = compositions.some(c => c.isNested)
  const nestedClipCount = countNestedClips(compositions)

  // Simple project: Use V1 (current system - proven, stable)
  if (uniqueFiles <= 3 && !hasNestedComps) {
    return 'V1'
  }

  // Medium complexity: Use V1 if < 8 files, otherwise V2
  if (uniqueFiles <= 8 && nestedClipCount <= 5) {
    return 'V1'
  }

  // Complex project: Always use V2 (shared decoders needed)
  return 'V2'
}
```

**Error Handling Philosophy:**
```
NO HIDDEN FALLBACKS!

If V2 selected (auto or manual):
  -> V2 must work or throw clear error
  -> NO automatic fallback to V1
  -> Show detailed error message with:
    - What failed (decoder, cache, worker)
    - Which file/clip caused issue
    - Suggestion: "Try Legacy System (V1) in Export Settings"

User can MANUALLY switch to V1 if needed.
```

## Performance Targets

**Current System (V1):**
- Simple project (3 clips): ~2x realtime
- Complex project (10+ clips): ~0.1x realtime (FAILS)

**Target System (V2):**
- Simple project (3 clips): ~3x realtime (50% faster)
- Medium project (10 clips): ~2x realtime
- Complex project (20 clips, 5 nested): ~1.5x realtime
- Triple-nested (10 levels): ~1x realtime

**Memory Targets:**
- Cache < 500MB for typical projects
- Peak memory < 2GB for complex projects
- No memory leaks over long exports

## References

- [Chrome WebCodecs Best Practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [Remotion WebCodecs Guide](https://www.remotion.dev/docs/media-parser/webcodecs)
- [W3C WebCodecs Explainer](https://github.com/w3c/webcodecs/blob/main/explainer.md)
- [DaVinci Resolve Render Cache](https://creativevideotips.com/tutorials/davinci-resolve-render-cache-essentials)
- [WebCodecs Issues: Decoder Reuse](https://github.com/w3c/webcodecs/issues/424)
- [Video Frame Processing Performance](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/)

---

**Document Version**: 1.0
**Author**: Claude (AI Assistant)
**Date**: 2026-01-27
**Status**: Design Proposal -- Not Implemented
