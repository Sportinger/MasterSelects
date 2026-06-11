You are a read-only review worker. Give a second opinion on a performance root-cause analysis and a proposed fix plan. Do NOT edit any files.

## Context: measured symptom

MasterSelects (this repo), timeline with 1 video clip + 8 audio lanes (7 standalone 5-minute stereo WAV stems + 1 video-linked audio). During timeline playback the ENTIRE UI lags (knobs, meters, panels). Live measurements via the dev bridge in the running app:

- Page rAF drops to ~19 fps during playback, 35 longtasks / 23 long-animation-frames in 8s.
- JS heap grows ~60 MB/s during playback (observed 1.0 GB -> 2.3 GB), collapses back to ~950 MB after pause. So: allocation flood + GC pauses, not a leak.
- LoAF script attribution (top offenders during playback):
  - 444ms total: FrameRequestCallback in usePlaybackLoop.ts
  - 199ms + 28ms total: BaseAudioContext.decodeAudioData.then in src/services/proxyFrame/audioBufferLoader.ts
- Timeline track canvases do NOT redraw during playback (draw counters frozen) — waveform painting ruled out.
- proxy audio buffer cache state mid-playback: audioBufferCount = 0 (cache effectively empty despite constant decodes).

## Diagnosed causal chain (please verify against the code)

1. src/services/layerBuilder/AudioTrackSyncManager.ts line ~464: inside the per-frame sync loop:
   `if (mediaFile && (mediaFile.audioProxyStatus === 'generating' || hasUsableAudioProxy(mediaFile))) { void proxyFrameCache.getAudioBuffer(mediaFile.id); }`
   This "scrub warmup" runs EVERY render frame for every clip, including during playback. Similar transient call sites: AudioTrackSyncManager.ts ~506 and src/services/layerBuilder/audioTrackRuntimeElements.ts ~156. src/services/layerBuilder/audioTrackStemBufferMixers.ts ~281 also calls getAudioBuffer but stem mixers genuinely need buffers during playback.
2. src/services/proxyFrame/audioBufferLoader.ts: MAX_AUDIO_BUFFER_CACHE_BYTES = 192 MB, MAX_AUDIO_BUFFER_CACHE_ENTRIES = 3. A decoded 5-min stereo 44.1kHz buffer is ~103 MB, so the cache holds ONE such buffer; 8 lanes keep evicting each other.
3. loadAudioBufferForScrub has dedup for in-flight loads and a 3s retry cooldown ONLY for "source not found" and decode errors. A SUCCESSFUL decode that immediately gets evicted (or is not retained, `cacheDecodedAudioBuffer` returns false) has NO cooldown -> the per-frame warmup re-requests it next frame -> endless decode loop, each cycle allocating ~50 MB ArrayBuffer + ~50 MB clone (arrayBuffer.slice(0)) + ~103 MB AudioBuffer.

## Proposed fix plan (not yet implemented)

A. Gate the scrub warmup call sites in AudioTrackSyncManager (lines ~464 and ~506) with `!ctx.isPlaying` (FrameContext has isPlaying). Warmup is purely scrub preparation; during playback audio comes from HTMLAudioElements, not decoded buffers.
B. In loadAudioBufferForScrub: when the decoded buffer could not be retained in the cache (cacheDecodedAudioBuffer returns false), set a ~5s cooldown for that mediaFileId (extend the existing retryTime mechanism, possibly changing its semantics from "attempted at" to "next allowed attempt at"). This kills any remaining redecode loop from other call sites (audioTrackRuntimeElements ~156 has no FrameContext). Concern: stem buffer mixer path (audioTrackStemBufferMixers ~281) NEEDS buffers during playback; a 5s cooldown could delay stem playback start when cache pressure is high — hence 5s, not 30s.
C. Optionally bump cache budget 192->256 MB and 3->4 entries to make multi-lane varispeed scrub slightly more useful. Open question: is holding ~103 MB decoded audio per lane even desirable, or should stacked-lane scrubbing just use the element-based scrub audio fallback (which exists and engages automatically when no buffer is cached)?

## Your task

1. Read the cited files (and anything else you need) and verify or refute the causal chain. Flag anything we misread.
2. Critique the fix plan: correctness risks, edge cases (scrub start right after playback stops, stem mixers, export pipeline AudioExportPipeline.ts ~522 which awaits getAudioBuffer, project load warmups), and whether the retryTime semantic change is safe for all callers (check proxyFrameCache.ts usages around lines 621-769).
3. Suggest a better architecture if you see one (e.g. demand-driven decode leases, decode-on-scrub-start only, smaller decode targets like mono/lower-sample-rate scrub buffers, OPFS-backed PCM windows) — but distinguish "do now" from "later packet".
4. Be specific: file paths + line-level reasoning. End with a clear verdict: plan OK as-is / OK with changes (list them) / wrong approach (why).
