[Back to Project](../../README.md)

# MuScriptor Music-to-MIDI

MuScriptor, developed by Kyutai and Mirelo, is the local multi-instrument music-transcription provider behind the timeline's **Music to MIDI...** action. It converts the audible, processed range of an audio or video clip into native MasterSelects MIDI clips and General MIDI tracks. It is audio-to-MIDI transcription, not stem separation; the existing stem workflow remains a separate neighboring action.

## User Flow

1. Start the Native Helper.
2. Right-click an audio clip, or a video clip with audible linked/source audio.
3. Choose **Music to MIDI...**, next to **Stem Separation...**.
4. Install the pinned local runtime once.
5. Choose `small`, `medium`, or `large`, accept the model license on HuggingFace, and download the selected model with a read token.
6. Optionally restrict decoding to specific instrument groups.
7. Start transcription and commit the resulting tracks to the timeline.

The default is `small`, which is the practical CPU choice. `medium` trades more memory and compute for accuracy; `large` is intended for capable GPUs.

## Local Runtime Boundary

```text
Timeline clip
  -> resolve audible audio (linked audio is preferred when applicable)
  -> render the processed clip range
  -> encode a temporary WAV
  -> Native Helper (WebSocket 9876)
  -> persistent MuScriptor Python sidecar (loopback-only dynamic port)
  -> streamed note/progress events
  -> atomic MIDI timeline commit
```

The browser never runs PyTorch. The Rust Native Helper owns an isolated MuScriptor virtual environment, pinned upstream source revision, provider cache, model markers, temporary staging directory, and sidecar lifecycle. MatAnyone2 and MuScriptor reuse provisioning patterns but do not share Python environments or model caches.

The model stays resident between transcription jobs. Setup, model download, model loading, transcription, cancellation, stop, and uninstall are explicit Native Helper commands. Long-running browser requests use activity-reset timeouts: valid progress keeps the operation alive, while a silent sidecar eventually fails with an actionable timeout.

## Audio Preparation

MuScriptor receives what the editor audibly plays, not an arbitrary source file:

- linked audio is resolved through the shared audible-audio resolver;
- trim, constant/variable speed, reverse, gain, channel routing, and supported audio processing are rendered through the clip audio-analysis pipeline;
- the rendered analysis buffer is encoded as WAV and staged under the provider temp root, with project-temp fallback during helper upgrades;
- the temporary WAV is deleted after success, failure, or cancellation;
- a source file key and processed clip-state hash are checked again before committing, so replacing the source or changing trim, speed, reverse, effects, or audio keyframes during inference cannot commit a stale result.

## MIDI Mapping And Commit

MuScriptor emits note starts and ends with pitch, time, and instrument group. MasterSelects validates those events, matches note pairs, discards malformed/out-of-range data, and groups notes deterministically by instrument. Known groups map to General MIDI programs; drums use the GM drum channel semantics.

All generated tracks and clips are committed as one timeline edit and therefore one undo step. An empty or stale result performs no mutation. Result data retains both its source fingerprint and processed clip-state hash as provenance; source-file identity and the current processed state are validated independently.

## Model And License Rules

- MuScriptor source code is MIT-licensed.
- Published model weights are gated under CC BY-NC 4.0.
- The user must accept the selected model's HuggingFace license before downloading it.
- The HuggingFace token is sent only for that download command. It is not stored in Zustand, project data, helper configuration, or logs.
- Because the weights are non-commercial, users must verify that their intended use complies with the model license.

## Native Helper Protocol

| Command | Purpose |
|---|---|
| `muscriptor_status` | Runtime, model, GPU, sidecar, temp-path, and instrument status |
| `muscriptor_setup` | Create/update and validate the pinned isolated runtime |
| `muscriptor_download_model` | Download one gated model variant with a transient HF token |
| `muscriptor_start` | Load a variant on auto/CUDA/MPS/CPU and start the persistent sidecar |
| `muscriptor_transcribe` | Run one WAV transcription with optional instrument constraints |
| `muscriptor_cancel` | Cancel the active job |
| `muscriptor_stop` | Stop the sidecar and release model memory |
| `muscriptor_uninstall` | Remove provider runtime, models, cache, and temp files |

All file paths crossing into the sidecar are checked against the Native Helper's allowed roots. The provider's exact temp directory is allowed; the broader local application-data directory is not.

## Current Limitations

- Model weights require a HuggingFace account, accepted license, network access for the one-time download, and sufficient local disk space.
- CPU transcription is supported but can be slow, especially beyond the `small` model.
- MuScriptor provides note timing, pitch, and instrument class but no performed velocity. MasterSelects currently assigns a stable default MIDI velocity.
- Transcription produces editable MIDI tracks; it does not render separated audio stems.

## Source Map

| Area | Location |
|---|---|
| Browser service and mapping | `src/services/muscriptor/` |
| Provider store | `src/stores/muscriptorStore.ts` |
| Native Helper commands | `src/services/nativeHelper/nativeHelperMuscriptorCommands.ts` |
| Timeline commit | `src/stores/timeline/midiClipSlice.ts` |
| Native runtime | `tools/native-helper/src/muscriptor/` |
| Python sidecar | `tools/native-helper/python/muscriptor_server.py` |
