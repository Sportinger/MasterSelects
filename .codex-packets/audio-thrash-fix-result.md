Implemented the bounded packet. No commit made. Untracked `.codex-packets/` was already present and untouched.

Changed files:
- `src/services/proxyFrame/audioBufferLoader.ts`: added warmup-only backoff state, converted `retryTime` to “next allowed attempt at”, added eviction/not-retained warm backoff hooks.
- `src/services/proxyFrameCache.ts`: added `warmScrubAudioBuffer()`, wired backoff on not-retained decoded buffers and LRU eviction, cleared new warm state in clear/dispose paths.
- `src/services/layerBuilder/AudioTrackSyncManager.ts`: normal playback no longer warms decoded scrub buffers; paused/scrub paths use `warmScrubAudioBuffer()`.
- `src/services/layerBuilder/audioTrackRuntimeElements.ts`: standalone audio proxy warmup now skips while the timeline store says playback is active.

Admission path finding:
`cacheDecodedAudioBuffer()` checks `canRetainAudioBufferResource()` before inserting into `audioBufferCache`. That resource reports `heapBytes = buffer.length * channels * 4` under the `interactive` policy. If the runtime coordinator rejects it, the method returns `false` before `audioBufferCache.set(...)`, so `audioBufferCount = 0` mid-playback is plausible when every large WAV decode is rejected by runtime budget/admission. Separately, admitted buffers can still be evicted by the 192 MB / 3-entry cache limit.

Checks run:

```text
$ npx tsc -b --pretty false
(no output)
```

```text
$ rg -n "getAudioBuffer\(" src/services/layerBuilder src/services/proxyFrame src/services/proxyFrameCache.ts
src/services/proxyFrameCache.ts:631:  async getAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
src/services/proxyFrameCache.ts:652:   * Demand callers (stem mixer/export/scrub playback) should use getAudioBuffer().
src/services/proxyFrameCache.ts:665:    return this.getAudioBuffer(mediaFileId, videoElementSrc);
src/services/proxyFrameCache.ts:683:      this.getAudioBuffer(mediaFileId, videoElementSrc);
src/services/layerBuilder\audioTrackStemBufferMixers.ts:281:      void proxyFrameCache.getAudioBuffer(layer.mediaFileId);
```

```text
$ rg -n "warmScrubAudioBuffer" src
src\services\layerBuilder\audioTrackRuntimeElements.ts:158:        void proxyFrameCache.warmScrubAudioBuffer(mediaFileId);
src\services\layerBuilder\AudioTrackSyncManager.ts:465:        void proxyFrameCache.warmScrubAudioBuffer(mediaFile.id);
src\services\layerBuilder\AudioTrackSyncManager.ts:507:            void proxyFrameCache.warmScrubAudioBuffer(mediaFile.id);
src\services\proxyFrameCache.ts:654:  async warmScrubAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
```

Risk: the new cooldown only throttles opportunistic warmups by design. Direct demand paths, including stem buffer mixing, export, and actual scrub playback, still use `getAudioBuffer()` and can still request buffers immediately. Vitest was not run per instruction.