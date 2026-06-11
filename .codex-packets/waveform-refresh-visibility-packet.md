You are a worker agent executing one bounded packet. Do not broaden scope.

Lane: timeline-canvas
Packet: waveform-refresh-visibility
Goal: After a page refresh, audio clip waveforms in the timeline stay invisible until the user hovers over the clip. Make them appear automatically once their waveform pyramid artifacts finish loading.

## Diagnosis hints (verify in code)

- `src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts`: the waveform warmup effect filters refs with `!waveformPyramidsRef.current.has(refId)` and publishes `null` into the map when `warmTimelineWaveformArtifacts` reports a missing/failed load. A `null` entry is NEVER retried for the lifetime of the component — unlike the spectrogram path right below it, which has a `SPECTROGRAM_ARTIFACT_RETRY_MS = 2000` retry loop (`spectrogramMissedAtRef` + `bumpSpectrogramRetry`).
- Right after a refresh the artifact store may not be ready yet (project handle restoring), so the first load returns null, gets cached as null, and the clip renders without waveform. Hovering the clip changes `hoveredClipId`, forces a redraw, and the prepared-resource path falls through `waveformPyramids?.get(refId) ?? getCachedTimelineWaveformArtifact(refId)` to the module-level cache, which by then has the pyramid — that is why hover "fixes" it.
- `src/services/timeline/timelineWaveformArtifactWarmup.ts` returns status 'ready' | 'missing' | 'error' per ref in its onResult callback.

## Target contract

1. Mirror the spectrogram retry pattern for waveform pyramid loads: when a ref resolves to null (missing or error), record the miss time and re-attempt after ~2000 ms (bounded retry loop driven by a reducer nonce + timeout, exactly like the spectrogram effect). On eventual success, publish the pyramid and call `requestRedraw()` (already wired).
2. Do not retry forever at high frequency: per-ref retry no more often than every 2000 ms; the loop naturally stops once all refs resolve (timer only scheduled while unresolved refs exist).
3. Keep the existing immediate-load path and the `controller.abort()` cleanup semantics intact.
4. No changes to the artifact warmup service or the painter modules.

Read first:
- src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts (whole file — the spectrogram effect is the template)
- src/services/timeline/timelineWaveformArtifactWarmup.ts (load result statuses)

Allowed write set (edit ONLY this file):
- src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts

Forbidden: everything else.

Checks you MUST run and report verbatim output for:
- npx tsc -b --pretty false
- rg -n "RETRY_MS|MissedAt|bumpSpectrogramRetry|bumpWaveformRetry" src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts
- (do NOT attempt vitest — the orchestrator runs it after you finish)

Do NOT commit. Never delete/revert files outside your write set.

Report: rationale, checks with actual output, risks, out-of-scope observations.
Stop conditions: if the fix requires changes outside the single allowed file, STOP and report.
