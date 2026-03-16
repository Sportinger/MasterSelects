# MediaBunny Migration Plan

## Overview

Migrate MasterSelects from `mp4-muxer` + `webm-muxer` + `mp4box` to [MediaBunny](https://www.npmjs.com/package/mediabunny), a unified media toolkit that supersedes all three libraries.

## Motivation

- `mp4-muxer` and `webm-muxer` are deprecated in favor of MediaBunny (same author)
- MediaBunny provides a single API for MP4, WebM, MKV, MOV, MPEG-TS, and more
- Reduces dependency count and maintenance burden
- Gains features: streaming targets (for >2GB exports), subtitle tracks, metadata tags
- `mp4box` usage for demuxing/metadata can gradually be replaced by MediaBunny's `Input` API

## Scope

### Phase 1: Export Muxing + Low-Risk mp4box Helpers

**Export muxing (Agent A):**
- Replace `mp4-muxer` and `webm-muxer` in `VideoEncoderWrapper.ts` with MediaBunny `Output`
- Create `MediaBunnyMuxerAdapter.ts` abstraction layer
- Update codec helpers in `codecHelpers.ts` if needed

**Low-risk mp4box helpers (Agent B):**
- `src/stores/timeline/helpers/audioDetection.ts` — audio track detection
- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts` — media info extraction
- `src/stores/timeline/helpers/mp4MetadataHelper.ts` — MP4 metadata reading

**Tests, docs, cleanup (Agent C):**
- Update/create unit tests for adapter and codec helpers
- Document deferred work and migration status
- Plan dependency cleanup

### Phase 2: Deferred (Higher-Risk mp4box Sites)

These sites have complex demuxing requirements and are deferred:
- `src/services/audioExtractor.ts` — sample-level extraction with ADTS headers
- `src/engine/WebCodecsPlayer.ts` — real-time playback demuxing
- `src/engine/ParallelDecodeManager.ts` — parallel decode pipeline
- `src/services/proxyGenerator.ts` — proxy generation demux

## Architecture: MuxerAdapter Pattern

```typescript
interface MuxerAdapter {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Promise<void>;
  getBuffer(): ArrayBuffer;
}
```

Factory function `createMuxerAdapter(config)` returns the appropriate adapter for mp4 or webm containers, backed by MediaBunny's `Output` + `BufferTarget`.

## Codec Mapping

| MasterSelects VideoCodec | MediaBunny VideoCodec | Old mp4-muxer | Old webm-muxer |
|--------------------------|----------------------|---------------|----------------|
| `h264` | `avc` | `avc` | N/A |
| `h265` | `hevc` | `hevc` | N/A |
| `vp9` | `vp9` | `vp9` | `V_VP9` |
| `av1` | `av1` | `av1` | `V_AV1` |

| MasterSelects AudioCodec | MediaBunny AudioCodec |
|--------------------------|----------------------|
| `aac` | `aac` |
| `opus` | `opus` |

## Dependency Changes

| Package | Action |
|---------|--------|
| `mediabunny` | ADD |
| `mp4-muxer` | REMOVE (after Phase 1 verified) |
| `webm-muxer` | REMOVE (after Phase 1 verified) |
| `mp4box` | KEEP (Phase 2 deferred sites still use it) |

## Phase 1 Status

Phase 1 implementation is in progress across three parallel worktrees:
- **Agent A (Export):** Creating `MediaBunnyMuxerAdapter.ts`, updating `VideoEncoderWrapper.ts`
- **Agent B (Metadata):** Migrating `audioDetection.ts`, `mediaInfoHelpers.ts`, `mp4MetadataHelper.ts`
- **Agent C (Tests/Docs):** Unit tests for adapter interface, migration documentation, deferred work plan

All changes target the `staging` branch. The `mediabunny` package (v1.39.2) has been added to `package.json` dependencies. After merge and verification, `mp4-muxer` and `webm-muxer` will be removed.
