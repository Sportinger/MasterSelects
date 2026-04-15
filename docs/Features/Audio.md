# Audio

[<- Back to Index](./README.md)

Audio in MasterSelects is split into two paths:
live playback sync for timeline editing, and offline audio processing for export.

---

## Playback Overview

- Video imports can create linked audio clips when audio is detected.
- Audio-only files are added as audio clips on audio tracks.
- Default timeline tracks include two video tracks and one audio track.
- Live playback uses HTMLMediaElement timing plus drift correction, not a separate audio master clock.

## Live Playback

The main runtime path is `LayerBuilderService` -> `AudioTrackSyncManager` -> `AudioSyncHandler`.
`useLayerSync` still contains a direct playback sync path with the same basic rules.

- Playback rate follows clip speed, clamped to the browser-safe range of 0.25x to 4x.
- Audio is muted for reverse or other non-standard playback speeds.
- `preservesPitch` is applied from the clip setting, defaulting to on.
- Scrubbing is snippet-based and throttled; it is not continuous time-stretched scrub audio.
- Current drift is corrected when the element gets too far from the expected time.
- Same-source sequential audio clips can hand off to the previous element, and upcoming clips may be pre-buffered before they hit the playhead.
- Nested composition mixdown audio and proxy audio are synced through the same runtime path.
- Audio status is tracked as `playing`, `drift`, `silent`, or `error` for performance stats.

## Volume And EQ

Audio clip controls live in the Properties panel under the `Effects` tab.
For audio clips, that tab renders the `VolumeTab`.

- Volume is stored as the `audio-volume` effect and displayed in dB.
- EQ is stored as the `audio-eq` effect with 10 bands: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k.
- The `Keep Pitch` toggle maps to the clip-level `preservesPitch` flag.
- The tab auto-adds missing `audio-volume` and `audio-eq` effects when opened.

Live routing uses `audioRoutingManager` when EQ is active.
If no EQ is active, playback falls back to direct `element.volume` updates.

## Waveforms

- Audio clips generate waveforms from decoded audio data.
- Nested composition clips generate waveforms from the mixed-down buffer when available.
- Large files are skipped: audio-only files above 4 GB and video files above 500 MB.
- Waveform generation uses the first channel only and normalizes peak data for display.

## Import And Detection

Video audio detection uses `detectVideoAudio()` with MediaBunny for MP4-based containers,
HTMLVideoElement probing as a fallback, and a light WebM/MKV header check.
If detection stays inconclusive, the code falls back to assuming audio exists.

Audio extraction for playback and export uses browser `decodeAudioData`, not MP4Box.

## Multicam And Analysis

- `audioAnalyzer` provides RMS level curves and downsampled fingerprints.
- `audioSync` uses normalized cross-correlation to compute offsets.
- `MulticamDialog` and `multicamStore` use those offsets for clip alignment.
- Transcript-based sync exists separately when clip transcripts are available.

## Composition Mixdown

`compositionAudioMixer` mixes nested composition audio into a single buffer.
It also creates a playable WAV-backed `HTMLAudioElement` and a waveform for timeline display.
That mixdown buffer is reused by export when the composition is part of the export range.

## Export

Audio export is handled by `engine/audio`:
`AudioExportPipeline` -> `AudioExtractor` -> `TimeStretchProcessor` -> `AudioEffectRenderer` -> `AudioMixer` -> `AudioEncoderWrapper`.

- `FrameExporter` uses `AudioExportPipeline.exportAudio()` for normal video exports with audio.
- `FrameExporter` uses `AudioExportPipeline.exportRawAudio()` for the FFmpeg export path.
- `ExportPanel` also exposes standalone audio export through the same pipeline.
- The pipeline applies clip trimming, speed changes, EQ, volume, mixing, and then encoding.
- `AudioEncoderWrapper` prefers AAC-LC and falls back to Opus if the browser supports it.
- Peak normalization is optional and only happens during export when enabled.

Important limitation:
the WebCodecs audio encoder is required for the standalone encoded audio path.
FFmpeg exports can still receive raw audio because they use `exportRawAudio()`.

## Limitations

- No compression or dynamics processing.
- No reverb, delay, or noise reduction.
- No LUFS loudness normalization.
- No spectrum analyzer UI.
- Live audio is limited by browser `playbackRate` behavior and cannot play backwards.

## Sources

`src/services/audioManager.ts`, `src/services/audioRoutingManager.ts`, `src/services/layerBuilder/AudioSyncHandler.ts`,
`src/services/layerBuilder/AudioTrackSyncManager.ts`, `src/services/audioAnalyzer.ts`, `src/services/audioSync.ts`,
`src/services/compositionAudioMixer.ts`, `src/stores/timeline/helpers/audioDetection.ts`,
`src/stores/timeline/helpers/audioTrackHelpers.ts`, `src/stores/timeline/helpers/waveformHelpers.ts`,
`src/components/panels/properties/VolumeTab.tsx`, `src/components/panels/properties/EffectsTab.tsx`,
`src/components/panels/properties/index.tsx`, `src/components/export/ExportPanel.tsx`,
`src/engine/export/FrameExporter.ts`, `src/engine/audio/*`
