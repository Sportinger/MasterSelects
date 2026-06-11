Implemented the bounded packet in [useTimelineClipCanvasAudioWarmups.ts](C:/Users/admin/Documents/MasterSelects/src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts).

Rationale: waveform artifact misses now mirror the spectrogram retry pattern. A missing/error result records `waveformMissedAtRef`, schedules a `2000ms` reducer-driven retry via `bumpWaveformRetry`, and does not cache terminal `null` as a finished state. On success it clears the miss marker, publishes the pyramid, and calls `requestRedraw()`.

Checks:

```text
npx tsc -b --pretty false
```

```text
```

```text
rg -n "RETRY_MS|MissedAt|bumpSpectrogramRetry|bumpWaveformRetry" src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts
```

```text
33:const WAVEFORM_ARTIFACT_RETRY_MS = 2000;
34:const SPECTROGRAM_ARTIFACT_RETRY_MS = 2000;
71:  const [waveformRetryNonce, bumpWaveformRetry] = useReducer((n: number) => n + 1, 0);
72:  const [spectrogramRetryNonce, bumpSpectrogramRetry] = useReducer((n: number) => n + 1, 0);
77:  const waveformMissedAtRef = useRef<Map<string, number>>(new Map());
78:  const spectrogramMissedAtRef = useRef<Map<string, number>>(new Map());
168:        const missedAt = waveformMissedAtRef.current.get(refId);
169:        return missedAt === undefined || now - missedAt >= WAVEFORM_ARTIFACT_RETRY_MS;
177:        waveformMissedAtRef.current.set(refId, Date.now());
181:            bumpWaveformRetry();
182:          }, WAVEFORM_ARTIFACT_RETRY_MS);
186:      waveformMissedAtRef.current.delete(refId);
220:        const missedAt = spectrogramMissedAtRef.current.get(refId);
221:        return missedAt === undefined || now - missedAt >= SPECTROGRAM_ARTIFACT_RETRY_MS;
229:        spectrogramMissedAtRef.current.set(refId, Date.now());
233:            bumpSpectrogramRetry();
234:          }, SPECTROGRAM_ARTIFACT_RETRY_MS);
238:      spectrogramMissedAtRef.current.delete(refId);
```

Risks: I did not run vitest per instruction. I also did not browser-test the refresh/hover behavior; the orchestrator can verify that flow.

Out-of-scope observations: the working tree already contains unrelated changes in `src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts`, `src/components/timeline/workers/timelineClipCanvasWorkerWaveformPainter.ts`, untracked `.codex-packets/`, and untracked `src/components/timeline/utils/timelineClipCanvasWaveformSpikes.ts`. I left them untouched.