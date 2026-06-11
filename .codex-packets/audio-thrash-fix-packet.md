You are a worker agent executing one bounded packet. Do not broaden scope.

Lane: audio-runtime
Packet: audio-buffer-thrash-fix
Goal: Stop the playback-time decoded-audio-buffer thrash (per-frame scrub warmups re-decoding ~100MB WAV buffers that the cache cannot retain) without slowing the stem-mixer or export paths.

## Background (verified by live measurement and an independent review)

During timeline playback with 8 audio lanes (5-minute WAV stems), the JS heap grows ~60 MB/s and the UI drops to ~19 fps from GC pauses. Cause: opportunistic "scrub warmup" calls to `proxyFrameCache.getAudioBuffer()` run during playback; a decoded 5-min stereo buffer is ~101 MiB while the cache budget is 192 MB / 3 entries, so buffers are decoded, evicted (or never admitted), and immediately re-requested — an endless decode loop. Decoded buffers are ONLY needed for varispeed scrub audio and stem buffer mixing, never for normal element-based playback.

Review findings to honor:
- `audioTrackRuntimeElements.ts` line ~156 is reached from normal audio-track playback (via AudioTrackSyncManager line ~303) and is likely the main driver for standalone audio lanes.
- `AudioExportPipeline.ts` line ~521 awaits `getAudioBuffer()` as a preferred source; it must NOT get a new cooldown.
- The stem buffer mixer (`audioTrackStemBufferMixers.ts` ~281) needs buffers during playback; it must NOT get a new cooldown.
- Backoff must cover BOTH "decoded but not retained" (cacheDecodedAudioBuffer returns false) AND "cached, then evicted by the next lane" (eviction callback in `enforceAudioBufferCacheLimit`).
- While implementing, inspect the runtime admission path used by `cacheDecodedAudioBuffer` (around proxyFrameCache.ts line ~226): mid-playback diagnostics showed audioBufferCount = 0, which suggests admission may reject these buffers outright. Report what you find (do not redesign admission).

Read first:
- src/services/proxyFrame/audioBufferLoader.ts (whole file)
- src/services/proxyFrameCache.ts (focus: getAudioBuffer ~621, cacheDecodedAudioBuffer / admission ~200-260, clear paths ~700-770)
- src/services/layerBuilder/AudioTrackSyncManager.ts (focus: ~150, ~290-320, ~440-510)
- src/services/layerBuilder/audioTrackRuntimeElements.ts (focus: ~130-200)
- src/services/layerBuilder/types.ts (FrameContext.isPlaying)
- src/engine/audio/AudioExportPipeline.ts (~510-530, read-only context)
- src/services/layerBuilder/audioTrackStemBufferMixers.ts (~270-290, read-only context)

Allowed write set (edit ONLY these):
- src/services/proxyFrame/audioBufferLoader.ts
- src/services/proxyFrameCache.ts
- src/services/layerBuilder/AudioTrackSyncManager.ts
- src/services/layerBuilder/audioTrackRuntimeElements.ts

Forbidden: everything else. In particular do NOT touch AudioExportPipeline.ts, audioTrackStemBufferMixers.ts, AudioSyncHandler.ts, stores, engine, components.

## Target contract

1. New explicit warmup entry point on proxyFrameCache, e.g. `warmScrubAudioBuffer(mediaFileId, videoElementSrc?)`:
   - Applies a per-mediaFileId warm backoff (`nextAllowedWarmAt`, ~5000 ms) that is set when (a) a decode result could not be retained in the cache, (b) a cached buffer for that id gets evicted by the LRU/byte limit, or (c) runtime admission rejects retention.
   - Otherwise delegates to the existing load path (dedup via `loading`, existing failure cooldowns).
   - `getAudioBuffer()` keeps its current semantics for stem mixer and export callers — no new cooldown there beyond the existing source-not-found/decode-error handling.
2. Convert the existing `retryTime` map semantics from "attempted at" to "next allowed attempt at" (`now + cooldownMs` written, `now < value` checked) so all cooldowns share one mechanism. Keep the existing 3000 ms windows for source-not-found and decode errors. Update the interface comment.
3. Warmup call sites:
   - AudioTrackSyncManager ~464 and ~506: only warm when NOT playing (`!ctx.isPlaying`); switch to `warmScrubAudioBuffer`. Keep `preloadAudioProxy()` calls unchanged (element preload is still wanted).
   - audioTrackRuntimeElements ~156: switch to `warmScrubAudioBuffer` and skip while `useTimelineStore.getState().isPlaying` (file may import the timeline store; check existing import conventions in that file first). Keep `preloadAudioProxy()`.
4. Eviction/admission instrumentation: when the warm backoff triggers, log once per file at debug level (Logger module already present in audioBufferLoader).
5. No behavior change for scrubbing itself: when the user scrubs (isDraggingPlayhead), warmups may run (subject to backoff) and `playScrubAudio`'s own buffer demand path stays as is.

Checks you MUST run and report verbatim output for:
- npx tsc -b --pretty false
- rg -n "getAudioBuffer\(" src/services/layerBuilder src/services/proxyFrame src/services/proxyFrameCache.ts
- rg -n "warmScrubAudioBuffer" src
- (do NOT attempt vitest — it cannot run in your sandbox; the orchestrator runs it after you finish)

Do NOT commit (sandbox cannot) and never delete/revert files outside your write set.

Report: files changed with a short rationale per file, checks run with ACTUAL OUTPUT pasted, what you found in the admission path (why audioBufferCount could be 0 mid-playback), risks, anything out of scope you noticed (report, don't fix).

Stop conditions: if the contract cannot be met without editing files outside the write set, or if the admission path turns out to make the warm backoff ineffective, STOP and report instead of improvising.
