# Audio Workstation

[<- Back to Index](./README.md)

The Advanced Audio Workstation turns audio from a clip-side utility into a project-wide signal system. The main editing surface remains the timeline: detailed waveform, spectral, region, image-in-spectrum, and repair operations happen in expanded audio lanes and Audio Focus mode. Docked panels support inspection and bus work, but they do not replace timeline editing.

## Architecture

Audio state is split across source media, clips, tracks, the master bus, project artifacts, and Node Workspace signal metadata.

- Source analysis artifacts live in project-addressable binary manifests and payloads: waveform pyramids, spectrogram tiles, loudness envelopes, beat/onset maps, frequency summaries, and phase correlation.
- Clip `audioState` stores non-destructive edit stacks, spectral image layers, registry-backed FX instances, source/processed analysis refs, and bake provenance.
- Track `audioState` stores fader, pan, mute/solo, record arm, input monitor, sends, meters, and track FX.
- `masterAudioState` stores the master fader, limiter, target LUFS, true-peak ceiling, master FX, and export preflight/measurement state.
- Node Workspace exposes a visible `Audio Analysis` node for audio-capable clips, alongside source ports and audio effect lanes. Audio ports expose artifact refs and bounded summaries, not raw full-length buffers. Waveform and loudness ports are `curve` signals, spectrogram ports are `texture` signals, frequency-band summaries are `table` signals, beats/onsets are `event` signals, transcript timing is a `text` signal, and audio metadata stays a bounded `metadata` signal.

## Timeline Surface

Audio Focus mode keeps the timeline as the detailed editor. It expands audio lanes while leaving video layers visible as compact context.

- Detailed Audio mode renders high-resolution waveform pyramids through timeline LOD windows.
- Spectral Audio mode renders real spectrogram tile artifacts inline.
- Audio region selections create non-destructive edit-stack operations for silence, insert/delete silence, reverse, polarity, channel operations, and repairs.
- Spectral selections create time/frequency edit operations and image-in-spectrum layers.
- The Audio Edit Stack panel surfaces cached rule-based repair suggestions from loudness, frequency, and phase analysis. Suggestions can be auditioned through the same render path used by the edit stack before applying. Applying a suggestion creates a non-destructive whole-clip repair or mono-sum operation with evidence metadata; it does not mutate the source file.
- Silence Cleanup detects quiet clip ranges from decoded source audio with configurable threshold/minimum duration controls. Removing detected silence adds non-destructive compacting `delete-silence` operations, shortens the timeline clip, and optionally ripples later same-track clips through the store action.
- Room Tone Fill uses selected audio regions as non-destructive fill targets. It loops detected quiet source ranges through the clip render path, with a deterministic low-level noise fallback when no reusable source tone is available.
- Bake/render creates derived media while preserving the original source file.

## Mixer Surface

The docked Audio Mixer is a bus and routing workspace inside the same dock system. It is opened from `View -> Panels -> Audio Mixer`.

- Track strips expose mute, solo, record-arm, input monitor, level meters, volume, pan, input device id, sends, and track FX.
- The master strip exposes master metering, fader, limiter, true-peak ceiling, target LUFS, master FX, and export preflight.
- Record controls use the same `AudioRecordingService` as the timeline toolbar. The service prefers AudioWorklet PCM capture into WAV and falls back to MediaRecorder when AudioWorklet is unavailable.
- Timeline In/Out markers act as the punch range for toolbar and Mixer recording. Sessions can wait for punch-in, checkpoint active chunks, auto-stop at punch-out, and keep active/stopped/error recovery entries visible until the commit path succeeds, the recovered artifact is retried, or the entry is dismissed.
- Mixer meters subscribe per strip so level updates do not force the full panel to re-render.

## Analysis Efficiency

Static and automated volume changes are treated as display/output gain. They do not invalidate source artifacts, processed refs, or processed analysis identity. Signal-shaping changes still invalidate processed refs.

Volume-safe changes include:

- Legacy `audio-volume` effect params.
- Registry `audio-volume` effect params.
- `audio-volume` automation keyframes.
- Track/master faders.

Signal-shaping changes include:

- EQ, filters, compressor, limiter, noise gate, delay, reverb, de-esser.
- Speed, reverse, mute, source-revision, edit-stack, and spectral-layer changes.

## Verification

Current focused checks cover:

- Dock registration for the Audio Mixer panel.
- Volume-only clip edits preserving processed analysis refs.
- Volume automation preserving processed analysis refs.
- Signal-shaping edits invalidating processed refs.
- Processed analysis identity excluding static/automated volume.
- Recording service start/stop/commit behavior, punch-in/out scheduling, fallback backend selection, active chunk and stopped-blob recovery, browser storage quota/persistence warnings, and direct WAV metadata preservation.
- Track/master routing, sends, export preflight, and audio export paths.
- Node Workspace audio projection and AI runtime context for semantic audio ports, `frequencyBands`, `audioMetadata`, repair suggestions, and artifact-only bounded summaries.
- Node Workspace `Generate`/`Refresh` actions for audio analysis ports. Refresh forces regeneration instead of returning early when a matching artifact ref already exists.
- Rule-based repair suggestions previewed and applied from the Audio Edit Stack as non-destructive edit operations with processed-analysis invalidation.
- Silence detection, compacting delete-silence render output, and timeline/store duration updates for detected silence removal.
- Room-tone fill render output, store operation creation, and processed-analysis invalidation.

## Sources

- `src/components/panels/audio-mixer/AudioMixerPanel.tsx`
- `src/components/timeline/TimelineClip.tsx`
- `src/components/timeline/TimelineControls.tsx`
- `src/components/timeline/TimelineHeader.tsx`
- `src/stores/timeline/helpers/audioAnalysisStateHelpers.ts`
- `src/services/audio/processedWaveformEligibility.ts`
- `src/services/audio/ClipAudioAnalysisOrchestrator.ts`
- `src/services/audio/ClipAudioRenderService.ts`
- `src/services/audio/AudioRecordingService.ts`
- `src/services/nodeGraph/clipGraphProjection.ts`
- `src/services/nodeGraph/aiNodeRuntime.ts`
- `src/services/nodeGraph/aiNodeAuthoringContext.ts`
- `src/engine/audio/AudioEffectRegistry.ts`
- `src/engine/audio/AudioExportPipeline.ts`
