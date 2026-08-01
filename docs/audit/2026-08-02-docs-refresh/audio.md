# Audio.md — audit 2026-08-02

## Verified (spot checks that held)

- The default timeline has two video tracks and one audio track (`src/stores/timeline/constants.ts:20-24`), and video import calls `detectVideoAudio()` before removing an initially linked audio clip (`src/stores/timeline/clip/addVideoClip.ts:220-260`).
- The primary live path is `LayerBuilderService` -> `AudioTrackSyncManager` -> `AudioSyncHandler` (`src/services/layerBuilder/LayerBuilderService.ts:9,61-66`, `src/services/layerBuilder/AudioTrackSyncManager.ts:1,62-64`, `src/services/layerBuilder/AudioSyncHandler.ts:61-63`). Runtime meters and spectrum taps are present in the timeline store and routing code (`src/stores/timeline/trackSlice.ts:115,512-538`, `src/services/audioRoutingManager.ts:94,333,358`).
- The audio FX registry contains the documented effect IDs, including normalize, EQ, dynamics, time, repair, and utility processors (`src/engine/audio/AudioEffectRegistry.ts:3-25,253+`); the flexible EQ control and EQ compiler/renderer modules exist (`src/components/panels/properties/FlexEqualizerControl.tsx`, `src/engine/audio/eq/AudioEqCompiler.ts`, `src/engine/audio/eq/AudioEqLinearPhase.ts`).
- Source-waveform limits are 4 GiB for audio and 500 MiB for video (`src/stores/timeline/helpers/waveformHelpers.ts:9-13`). The timeline implements Audio Focus, Detailed Audio, Spectral Audio, region gain/silence mapping, and the `-∞ dB` label (`src/components/timeline/TimelineControls.tsx:504-533`, `src/components/timeline/utils/audioRegionDisplay.ts:6-11,133-134,183-220`).
- Browser audio decoding for the current export/analysis pipeline is `AudioExtractor` plus `AudioContext.decodeAudioData` (`src/engine/audio/AudioExtractor.ts:22-60,100-110`), and the exporter imports that class (`src/engine/audio/AudioExportPipeline.ts:15,80-108`). Recording, mixer, stem separation, and Music-to-MIDI modules are present under `src/services/audio/AudioRecordingService.ts`, `src/components/panels/audio-mixer/AudioMixerPanel.tsx`, `src/services/audio/stemSeparation/`, and `src/services/muscriptor/`.

## Outdated or wrong (claim → reality, with file evidence)

- “`useLayerSync` still contains a direct playback sync path with the same basic rules.” → `useLayerSync` skips its direct sync while playing and delegates playback to `LayerBuilderService` (`src/components/timeline/hooks/useLayerSync.ts:105-106,155-160`). Its retained `syncLayerAudioPlayback()` uses absolute speed and therefore does not reproduce the primary path’s reverse-speed muting (`src/components/timeline/utils/layerSyncAudioPlayback.ts:31-37,96-124`). The document now describes it as a legacy paused-layer path instead.
- Sources listed `src/components/panels/properties/AudioEqualizerInstanceList.tsx`. → That path does not exist; the active EQ UI is `src/components/panels/properties/FlexEqualizerControl.tsx` (referenced by `src/components/panels/properties/VolumeTab.tsx:304+`). The source list now names the real file.

## Noteworthy / unusual

- `src/services/audioExtractor.ts` is an older MP4Box-based extraction helper, but no production import references it (`rg` found only its own definition). Current audio analysis/export consumers use `src/engine/audio/AudioExtractor.ts`; this makes the document’s “not MP4Box” statement accurate for the current pipeline but potentially confusing beside the dead-looking legacy helper.
- `useLayerSync.ts` contains a malformed comment character sequence near its RAF debounce comment (`src/components/timeline/hooks/useLayerSync.ts:199-201`). It is not user-visible and was left untouched because this audit is documentation-only.
