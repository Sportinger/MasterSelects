# Audio Intelligence

[Back to Index](./README.md)

Audio Intelligence turns persisted audio analysis into reusable source-time
evidence for the Analysis workspace, Agent Timeline, AI tools, and
non-destructive audio edits. Analysis runs against source audio; the resulting
artifacts are durable and are invalidated when their input audio identity
becomes stale.

---

## Capabilities

The feature combines five Audio Intelligence stages with three connected
analysis and editing integrations:

1. Loudness envelopes retain RMS/LUFS and peak measurements; they are created
   by the separate Loudness Envelope analysis generator.
2. Onset maps identify transients and rhythmic attacks; they are created by
   the separate Beat/Onset analysis generator.
3. Voice activity detection separates speech from non-speech intervals.
4. Transcript alignment refines provider or synthetic word timing against the audio.
5. Speech markers identify breaths, fillers, repetitions, false starts, and long pauses.
6. Prosody contours retain pitch, speech-rate, and energy evidence.
7. Room-tone profiles rank reusable low-noise source ranges.
8. Editing integration uses VAD-first silence detection, zero-crossing edge snaps,
   and persisted room tone before live heuristics.

`startClipAudioIntelligence` runs stages 3 through 7 (or a requested subset).
Loudness and onset artifacts are consumed alongside those results, but are not
stages of that job.

The VAD model is pinned to Silero VAD **v5.1.2**. The model URL, cache version,
manifest provenance, and analyzer version retain that exact version and keep
artifact interpretations stable.

## Artifacts And Agent Timeline Events

| Artifact kind | Main persisted signal | Agent Timeline / editing mapping |
|---|---|---|
| `loudness-envelope` | RMS/LUFS and peak windows | Audio loudness, quality, silence-level, and classification evidence |
| `onset-map` | Timestamped attacks/transients | Audio transient and onset-rate evidence |
| `voice-activity` | Speech spans and confidence | Speech/non-speech coverage; non-speech gaps become silence candidates and pause events |
| `transcript-timing` | Source-aligned word timings | Refined transcript word ranges used by downstream speech analysis |
| `speech-markers` | Breath, filler, repetition, false-start, and long-pause records | `speech-marker` events; repetition and false-start map to disfluency |
| `prosody-contour` | Pitch, speech-rate, and energy curves/summary | Settings and Analysis UI evidence |
| `room-tone-profile` | Ranked quiet candidates and noise floor | Preferred `room-tone-fill` source ranges; it does not fabricate a timeline event |

Agent Timeline materialization keeps analyzer/model provenance and
artifact references on the loudness, onset, VAD, and speech-marker derived
events. Missing coverage remains missing rather than being interpreted as an
empty result.

## Analysis UI

The Analysis overview has an **Audio** sparkline lane for loaded loudness and
VAD evidence and a **Markers** needle lane for speech markers. The Analysis
Action Center includes an Audio Intelligence run card with current state,
progress, marker count, run/re-run, and cancel behavior.

The settings disclosure renders `AnalysisAudioSettings` for audio-bearing
clips. It reports the persisted age of VAD, alignment, markers, prosody, and
room-tone artifacts and exposes one run/re-run or cancel action. The settings
card and lanes read artifacts; they do not trigger implicit provider work.

## AI Tools

| Tool | Purpose |
|---|---|
| `startClipAudioIntelligence` | Starts all five intelligence stages or a requested feature subset in one background job. |
| `findSilentSections` | Returns silence using voice activity first, RMS second, and transcript gaps last, plus the honest `detectionSource`. |
| `getSpeechMarkers` | Returns a bounded source/timeline-time page with kind filters, counts, paging, confidence, and available prosody summary. |
| `getTimelineAnalysis` | Reads bounded Agent Timeline audio/speech events with coverage and provenance. |

Marker text follows the existing `includeText` and explicit external-data
consent redaction when it is exposed through Agent Timeline reads. Times,
kinds, confidence, and counts remain useful when text is withheld.

## Editing Integration

Silence-removal detection first loads the freshest non-stale persisted
`voice-activity` artifact. Speech gaps become `AudioSilenceRange` values; an
overlapping persisted loudness curve supplies `rmsDb`, otherwise the range is
explicitly marked with the `-60 dB` fallback. If VAD is unavailable or
unreadable, the live RMS detector remains the fallback.

The decode used for live RMS is also used to snap every detected source-range
edge to the nearest zero crossing on channel 0 within 10 ms. VAD ranges attempt
the same decode only for snapping and remain usable without it. Room-tone fill
prefers `roomToneProfileToFillParams` from the freshest non-stale persisted
profile; only when no profile is available does it run the live RMS
quiet-range heuristic.

---

*Source: `src/services/audio/intelligence/`,
`src/services/audio/LoudnessEnvelopeGenerator.ts`,
`src/services/audio/BeatOnsetAnalysisGenerator.ts`,
`src/services/agentTimeline/artifacts/audioIntelligencePayloadLoader.ts`,
`src/services/agentTimeline/adapters/audioIntelligenceLegacyAdapter.ts`,
`src/services/aiTools/handlers/speechMarkers.ts`,
`src/stores/timeline/audioEdit/audioDetectionActions.ts`,
`src/services/audio/sampleAccurateSnap.ts`,
`src/components/panels/properties/AnalysisAudioSettings.tsx`*
