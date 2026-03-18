# MediaBunny Migration - Deferred Work

## Phase 1 Completed
- WebCodecs export muxing migrated from mp4-muxer/webm-muxer to MediaBunny
- Low-risk mp4box helper sites migrated (audioDetection, mediaInfoHelpers, mp4MetadataHelper)

## Retained mp4box Sites

| File | Reason for Deferral |
|------|---------------------|
| `src/services/audioExtractor.ts` | Sample-level extraction with manual ADTS header construction. Byte-level parity must be verified per codec. |
| `src/engine/WebCodecsPlayer.ts` | Real-time playback demuxing. Latency-sensitive, sync callback constraints. |
| `src/engine/ParallelDecodeManager.ts` | Sync onReady requirement during appendBuffer. Complex decode pipeline. |
| `src/services/proxyGenerator.ts` | Full demux + sample extraction for proxy generation. |

## Export Architecture Follow-Ups
- **Interleaved audio/video submission**: Current "video first, audio later" flow may buffer excessively for very long exports. Future work should prototype chunked interleaving.
- **Streaming output targets**: For exports >2GB, evaluate MediaBunny's StreamTarget instead of in-memory BufferTarget.
- **Additional container formats**: MediaBunny supports .mov, .mkv, .ts. Could be added to export UI.

## Dependencies
- `mp4box` stays in package.json (4 deferred sites still use it)
- `mp4-muxer` and `webm-muxer` removed after migration verified

## Browser Compatibility Notes
- WebCodecs availability determines codec support (same as before)
- MediaBunny has no additional browser requirements beyond WebCodecs
