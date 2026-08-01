# MuScriptor.md — audit 2026-08-02

## Verified (spot checks that held)

- The timeline menu exposes **Music to MIDI...** alongside **Stem Separation...** only when an audible audio clip is resolved: `src/components/timeline/ClipAudioAIContextMenuItems.tsx`.
- The client service, Zustand store, Native Helper command wrapper, MIDI commit slice, Rust provider module, and bundled Python sidecar all exist at the Source Map locations: `src/services/muscriptor/`, `src/stores/muscriptorStore.ts`, `src/services/nativeHelper/nativeHelperMuscriptorCommands.ts`, `src/stores/timeline/midiClipSlice.ts`, `tools/native-helper/src/muscriptor/`, and `tools/native-helper/python/muscriptor_server.py`.
- Setup, gated model download, start, transcription, cancellation, stop, uninstall, and status are implemented as the eight documented protocol commands: `src/services/nativeHelper/protocol.ts`, `src/services/nativeHelper/nativeHelperMuscriptorCommands.ts`, and `tools/native-helper/src/protocol/commands.rs`.
- The processed-audio path resolves audible linked audio, renders it with `needsProcessed: true`, stages a WAV in a provider temp directory or project fallback, and cleans it up in `transcribePrepared`: `src/services/muscriptor/audioPreparation.ts` and `src/services/muscriptor/MuscriptorService.ts`.
- MIDI mapping validates pitch/time/instrument, groups and sorts notes deterministically, maps known groups to GM programs, marks drums, and uses a stable `0.8` velocity: `src/services/muscriptor/eventMapping.ts`.
- Commit is one state update followed by one `captureSnapshot('Music to MIDI')`; it rejects missing, locked, stale, or empty input: `src/stores/timeline/midiClipSlice.ts`.
- The helper keeps a pinned MuScriptor source revision, separate model markers/cache, and a provider-specific virtual environment; it also allows the provider temp root without granting the broader local app-data directory: `tools/native-helper/src/muscriptor/env.rs` and `tools/native-helper/src/session.rs`.
- The HF token is component-local, passed only as `HF_TOKEN` to the download subprocess, and explicitly redacted from helper errors: `src/components/common/MuscriptorSetupDialog.tsx` and `tools/native-helper/src/muscriptor/env.rs`.

## Outdated or wrong (claim → reality, with file evidence)

- `muscriptor_start` “Load a variant on auto/CUDA/MPS/CPU” → the UI and client protocol expose only `auto`, `cpu`, and `cuda`; MPS is selected by the Python sidecar only when `auto` is used and MPS is available. Evidence: `src/services/nativeHelper/protocol.ts`, `src/components/common/MuscriptorSetupDialog.tsx`, `src/components/common/settings/MuscriptorFeatureSettings.tsx`, and `tools/native-helper/python/muscriptor_server.py`.

## Noteworthy / unusual

- Cancelling does not leave the sidecar resident: the helper terminates the whole provider process as the hard cancellation boundary, preserves the installed runtime/model cache, and requires a later start. Evidence: `tools/native-helper/src/muscriptor/websocket.rs` and `src/services/nativeHelper/nativeHelperMuscriptorCommands.ts`.
- Runtime/model management is also shipped in **AI Features** settings, not only through the timeline context menu. Evidence: `src/components/common/settings/AIFeaturesSettings.tsx` and `src/components/common/settings/MuscriptorFeatureSettings.tsx`.
- Although transcription provenance retains `sourceFingerprint`, the commit gate independently compares `sourceFileKey` and the current processed-audio-state hash; it does not compare the fingerprint directly. Evidence: `src/services/muscriptor/MuscriptorService.ts` and `src/stores/timeline/midiClipSlice.ts`.
