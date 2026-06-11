**Verdict**

OK with changes. The root cause is directionally right: playback is kicking opportunistic decoded-audio-buffer work, the cache cannot hold stacked 5-minute stems, and successful decode attempts have no backoff when the result does not remain useful. But plan A+B is incomplete as written.

**What Checks Out**

The unguarded playback warmup exists at [AudioTrackSyncManager.ts:464](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:464) and [AudioTrackSyncManager.ts:506](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:506). Playback audio uses media/proxy elements via `syncPreviewAudioElement`, while decoded buffers are only needed for varispeed scrub or stem buffer mixing.

The loader does exactly what you described: [audioBufferLoader.ts:212](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrame/audioBufferLoader.ts:212) only cools down failed/source-missing attempts, and [audioBufferLoader.ts:235](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrame/audioBufferLoader.ts:235) clears retry state after a successful decode even if `cacheDecodedAudioBuffer()` returns false.

The allocation math is plausible. A 5-minute stereo 44.1 kHz `AudioBuffer` is about 100.9 MiB: `300 * 44100 * 2 * 4`. The proxy WAV input can add about 50 MiB, and [audioBufferLoader.ts:233](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrame/audioBufferLoader.ts:233) clones that input with `arrayBuffer.slice(0)`.

**Corrections / Gaps**

“Every render frame” is slightly overstated after startup. `syncAudioElements()` throttles to 50 ms at [AudioTrackSyncManager.ts:151](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:151), though startup can run every frame and `usePlaybackLoop` also schedules sync from rAF at [usePlaybackLoop.ts:268](C:/Users/admin/Documents/MasterSelects/src/components/timeline/hooks/usePlaybackLoop.ts:268).

Pure LRU churn would usually leave one buffer cached, not zero. [audioBufferLoader.ts:64](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrame/audioBufferLoader.ts:64) evicts old entries only while size > 1, so after inserting a 101 MiB buffer the newest should remain. `audioBufferCount = 0` points more to runtime admission rejection at [proxyFrameCache.ts:226](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrameCache.ts:226), timing during in-flight decodes, or a clear/dispose path.

Plan A misses another important caller: [audioTrackRuntimeElements.ts:153](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/audioTrackRuntimeElements.ts:153) calls `getAudioBuffer()` whenever a shared audio proxy is not cached. That path is reached from normal audio-track playback via [AudioTrackSyncManager.ts:303](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:303), handoffs, and prebuffering. Standalone audio scrub already has an element fallback in [AudioSyncHandler.ts:171](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioSyncHandler.ts:171), so this decoded-buffer warmup is not required for normal audio tracks.

**Fix Plan Changes**

1. Gate or remove decoded-buffer warmup during playback at [AudioTrackSyncManager.ts:464](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:464) and [AudioTrackSyncManager.ts:506](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/AudioTrackSyncManager.ts:506). Keep `preloadAudioProxy()` for element playback; do not decode scrub buffers there while `ctx.isPlaying`.

2. Also remove or context-gate [audioTrackRuntimeElements.ts:156](C:/Users/admin/Documents/MasterSelects/src/services/layerBuilder/audioTrackRuntimeElements.ts:156). That is the biggest missing piece. If kept, pass an explicit “may warm decoded scrub buffer” flag from callers and make playback callers pass false.

3. Change retry semantics to `nextAllowedAttemptAt`, but do not make it a blind global cooldown for all `getAudioBuffer()` callers. Export at [AudioExportPipeline.ts:521](C:/Users/admin/Documents/MasterSelects/src/engine/audio/AudioExportPipeline.ts:521) awaits this as a preferred source path; a global 5s cooldown can force slow fallback or silent fallback for data-only clips.

4. If adding backoff, apply it to opportunistic scrub warmups, cache-admission failures, and LRU evictions. Plan B only covers `cacheDecodedAudioBuffer() === false`; it does not cover “successfully cached, then evicted by the next lane.” Consider marking evicted IDs in the eviction callback from [audioBufferLoader.ts:64](C:/Users/admin/Documents/MasterSelects/src/services/proxyFrame/audioBufferLoader.ts:64).

5. I would not bump 192 -> 256 MB as part of the root fix. It only changes “one huge buffer” to possibly “two huge buffers” and does not solve 8-lane churn. The interactive budget is 512 MB at [runtimeCoordinatorPolicyCatalog.ts:72](C:/Users/admin/Documents/MasterSelects/src/services/timeline/runtimeCoordinatorPolicyCatalog.ts:72), so holding all lanes is not the intended design.

**Later Architecture**

Split the API by intent: `warmScrubAudioBuffer()` with backoff and low priority, `getAudioBufferForStemMixer()` with bounded demand, and `getAudioBufferForExport()` using export/offline policy and bypassing scrub cooldown. Longer term, decode scrub audio as smaller windows or lower-rate/mono preview buffers instead of full-length float `AudioBuffer`s.

No files were edited; I only read the code.