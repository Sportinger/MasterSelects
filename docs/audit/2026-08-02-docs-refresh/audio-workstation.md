# Audio-Workstation.md — audit 2026-08-02

## Verified (spot checks that held)

- The source, clip, track, master, and project audio contracts exist in `src/types/audio.ts`; analysis artifact persistence and project indexing are implemented in `src/services/audio/projectAudioState.ts`.
- Audio Focus mode, the 10,000 px/sec zoom ceiling, audio-region controls, waveform/spectrogram drawing, and audio track-header controls are present under `src/stores/timeline/` and `src/components/timeline/` (including `constants.ts`, `TimelineControls.tsx`, `interactionShell/ClipAudioRegionControls.tsx`, and `utils/spectrogramCanvas.ts`).
- The docked mixer, lazy panel loader, pinned master strip, routing/meter services, registry FX, and recording backends are implemented in `src/components/panels/audio-mixer/`, `src/services/audio/routing/`, `src/engine/audio/AudioEffectRegistry.ts`, and `src/services/audio/recording/`.
- Node Workspace audio projection and bounded analysis signals are implemented in `src/services/nodeGraph/clipGraphProjectionAudio.ts`, `aiNodeRuntimeAudioAnalysisSignals.ts`, and `aiNodeRuntimeAudioArtifactSignals.ts`.
- The document's named core source paths all exist. Focused audio tests also exist for edit/bake state, node-graph state, and stem separation in `tests/stores/timeline/`.

## Outdated or wrong (claim → reality, with file evidence)

- “Track `audioState` stores ... meters” → `TrackAudioState` stores `meterMode`, but live values are held separately in `RuntimeAudioMeterState.trackMeters`; they are not persisted on each track's audio state. Evidence: `src/types/audio.ts` (`TrackAudioState`, `RuntimeAudioMeterState`). The feature doc now reflects this split.

## Noteworthy / unusual

- The document omitted shipped audio artifact families and their UI entry points: stem separation, voice activity, transcript alignment, speech markers, prosody, room-tone profiles, Music to MIDI, and the metronome. The document now mentions them. Evidence: `src/types/audio.ts`, `src/stores/timeline/clip/clipAudioIntelligenceActions.ts`, `src/components/timeline/ClipAudioAIContextMenuItems.tsx`, `src/components/common/MuscriptorSetupDialog.tsx`, and `src/components/timeline/MetronomeButton.tsx`.
- Stem separation is deliberately full-clip only: `StemSeparationService` throws for a requested region. Its production HTDemucs browser model is a 180,534,758-byte download, so first use is materially heavier than the rest of the timeline audio workflow. Evidence: `src/services/audio/stemSeparation/StemSeparationService.ts` and `src/services/audio/stemSeparation/modelCatalog.ts`.
- `ClipAudioState` has supported `stemSeparation` state even though the prior document's architecture list omitted it. Evidence: `src/types/audio.ts` and `src/services/audio/projectAudioState.ts`.
