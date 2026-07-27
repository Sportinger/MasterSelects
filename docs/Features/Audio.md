# Audio

[<- Back to Index](./README.md)

Audio in MasterSelects is split into two paths:
live playback sync for timeline editing, and offline audio processing for export.

---

## Playback Overview

- Video imports can create linked audio clips when audio is detected.
- Audio-only files are added as audio clips on audio tracks.
- ElevenLabs speech generated from FlashBoard imports as normal project-local audio under `AI Gen / Audio`.
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
- Timeline track headers and the master bus show runtime Peak/RMS meters plus stereo phase-correlation metadata when routed stereo samples are available. Timeline audio-layer meters and the docked Audio Mixer render stereo snapshots as fixed-scale left/right bars, so the color bands stay tied to the dB scale instead of being rescaled with the active fill. Active meter fills render as segmented LED cells and smooth movement with a 300ms attack and 1s decay. Meter snapshots are collected from the live Web Audio route or the varispeed scrub graph, aggregated in `runtimeAudioMeters`, and are never serialized into project files.
- Settings -> Audio exposes browser input/output devices, latency mode, device API support, output-routing support, current AudioContext state, sample rate, latency, and active route count. Output routing uses browser `AudioContext.setSinkId` when available and falls back to routed media-element `setSinkId`; unsupported browsers stay on the system default output.
- Audio track headers expose Aux send controls inline with track volume, pan, mute/solo, meters, and FX. Full-height and compact audio headers reserve a wide bottom pan rail from the fader area to the right edge while keeping the button block above it; compact headers keep the meter but drop the inline volume fader. Sends can be added, bypassed, routed to a target bus id, switched pre/post fader, and removed without leaving the timeline.
- The docked `Audio Mixer` view is available from the main View menu. It mirrors the same timeline-native track and master state with full-height vertical strips for mute/solo, record-arm, input monitor, faders, center-out bipolar pan controls, meters, sends, track FX, master FX, limiter, and export preflight. Mixer fader scales use the same `-60..+18 dB` range as the fader value and align `0 dB` with the actual fader position. Track strips scroll horizontally when needed while the master strip remains pinned, and clicking an insert opens the FX stack in a floating mixer window. Mixer strip colors are the same persisted track label colors shown on timeline layers; unset tracks stay in the colorless gray state and can be assigned from either right-click menu. Disabling the advanced audio-layer eye hides those colors and uses neutral gray audio rows in the timeline without clearing the labels or changing the mixer. Mixer strip focus and timeline audio-layer selection are synchronized, so selecting either surface highlights the matching strip/lane, smoothly reveals off-screen timeline audio layers, and opens the same track or master Properties target.
- Live playback folds enabled Aux sends into the same master-return gain model used by export: post-fader sends follow track volume, pre-fader sends bypass it, disabled sends are ignored.
- Audio track headers expose `R` record-arm and `I` input-monitor toggles. The timeline toolbar record button starts from the current playhead for armed audio tracks.

## Stem Separation

- Stem generation runs as a background job and publishes generated WAV stems into the project media library when the project/media write path succeeds instead of storing heavy stem payloads on timeline clips. If that publish step cannot complete, the stem result can still remain as artifact-backed project state until it is regenerated or relinked.
- Clips with completed linked stems show a bottom-left `S` badge. Opening it prewarms the source and stem audio files, then shows compact source/stem buttons with pictogram icons.
- Selecting Source, Vocals, Drums, Bass, or another stem switches the clip's media source while preserving trim, timing, effects, and audio edit state.
- Stem source switching is live during playback. The audio sync manager drops stale clip proxy/handoff elements when the active `mediaFileId` changes, so the audible source follows the selected button without stopping playback.
- Project reload relinks completed stem choices from `MediaFile.stemInfo` or the legacy `Stems/<source>/<source> - <Stem>.wav` folder layout.

## Music To MIDI

- Timeline audio clips and video clips with audible audio expose **Music to MIDI...** beside stem separation in the clip context menu.
- The local MuScriptor provider renders the processed audible clip range through `ClipAudioAnalysisOrchestrator`, so it respects the editor's selected audio source and signal-shaping state instead of transcribing an unrelated raw container track.
- The Native Helper runs the pinned PyTorch model locally and streams note/progress events back to the browser. No source audio is uploaded to a cloud inference service.
- Recognized instruments become General MIDI tracks; all resulting tracks and clips are inserted atomically as one undoable edit.
- This is note transcription, not audio separation. MuScriptor does not create new WAV stems and currently assigns a stable default velocity because the model emits no performed velocity.

See [MuScriptor Music-to-MIDI](./MuScriptor.md) for model setup, licensing, provider architecture, and limitations.

## Audio Effects

Audio clip controls live in the Properties panel under `CLIP Effects`; clip edit-stack operations live under `CLIP Audio Edits`, and clip transcripts remain clip-only under `CLIP Transcript`. Linked video/audio companions share the same transcript state, so selecting either clip opens the same transcript view. Selecting an audio track/layer switches the same panel to `TRACK Controls`, `TRACK Effects`, and `TRACK Sends`; selecting the master bus switches it to `MASTER Controls` and `MASTER Effects`.
For audio clips, `CLIP Effects` renders the `VolumeTab`.

- Volume is stored as the `audio-volume` effect and displayed in dB.
- EQ is stored as the canonical `audio-eq` effect. Legacy 10-band params are still loadable, while new state uses a flexible schema for 3-band, 10-band graphic, parametric, mastering, match, or custom band layouts up to 24 bands.
- `AudioEffectRegistry` is the source of truth for audio effect descriptors, defaults, automation metadata, and render support.
- Registered professional effects now include pan, normalize, parametric EQ, high-pass filter, low-pass filter, hum notch, de-click, noise reduction, spectral gate, compressor, de-esser, limiter, noise gate, expander, delay, reverb, saturation, polarity invert, mono sum, channel swap, and stereo split in addition to volume and 10-band EQ.
- Offline rendering applies registry-backed effect instances through `AudioEffectRenderer`; Web Audio nodes cover gain, pan, legacy static EQ-compatible paths, parametric EQ, filters, hum notch, compressor, and split-band de-essing, while deterministic sample-domain processors cover flexible EQ dynamic bands, STFT Spectral Dynamics, peak/RMS/LUFS normalize, de-click, broadband noise reduction, spectral gate, limiter, noise gate, expander, delay, reverb, saturation, polarity invert, mono sum, channel swap, and stereo split. Clip processed analysis and export use this same renderer through `ClipAudioRenderService`.
- The flexible EQ UI renders a FabFilter-style graph with log-frequency grid, analyzer traces, colored band response fills, summed response curve, draggable handles, a searchable preset browser with tags/favorites/user presets, local A/B slots, curve/band clipboard, Sketch, Spectrum Grab, EQ Match snapshot controls, Band Solo live audition, dynamic EQ controls, and Spectral Dynamics controls per selected band. Frequency, gain, Q, slope, dynamic EQ numeric controls, and Spectral Dynamics numeric controls expose nested keyframe paths; the selected band has an all-numeric stopwatch, and the EQ stack item header can write all numeric EQ keyframes at the playhead. Spectral Dynamics uses STFT overlap-add processing to compress or expand only bins inside the selected band's frequency range, so narrow resonances can be controlled without broad static EQ movement.
- The flex EQ analyzer is sampled at display rate: the audio routing manager (master bus, MIDI node routes) and the audio sync handler (routed media elements) register live spectrum taps in `runtimeSpectrumTaps`, and the EQ reads the tap once per animation frame with attack/release easing. Meter-bus snapshots remain the fallback for scopes without a live tap (e.g. stem-mixer tracks, which currently publish no spectrum), so the analyzer no longer depends on meter publish cadence or the engine render loop. When the spectrum source stops (playback stop, route teardown), the trace releases to the silence floor and clears instead of freezing the last frame. Band drags coalesce param commits to at most one store update per frame, and the EQ canvas redraws without per-frame layout reads.
- `audio-eq` character modes are rendered as part of the EQ instance: `clean` is transparent, `subtle` adds gentle transformer-style saturation, and `warm` adds stronger bounded tube-style saturation after the filters. Static linear-phase EQ renders through a compensated FFT/FIR processor in the offline/export path and declares explicit latency for render planning; dynamic and Spectral Dynamics bands continue through their dedicated sample processors.
- Steeper low/high cuts and shelves are rendered through deterministic biquad cascades in the response graph, live route, processed previews, and export. Brickwall low/high cuts map to the steepest bounded cascade in the current zero-latency path.
- The audio engine keeps a project-wide EQ instance registry that collects clip, track, master, and legacy clip EQ instances through the same canonical normalizer. The former Audio Mixer "EQ Instances" list UI was removed; effect inspection and editing happen in the mixer FX windows and the Properties panel stacks.
- The audio Properties tabs expose registry-backed FX stacks for adding, reordering, bypassing, removing, and editing clip `audioState.effectStack`, track `audioState.effectStack`, and `masterAudioState.effectStack` effects. EQ is an optional stack insert like the other audio effects; older legacy clip-level EQs remain editable only when they already exist on the clip. Static default effects stay no-op; non-default signal-shaping params invalidate only processed analysis refs.
- Static and automated `audio-volume` changes are handled as output/display gain. They do not invalidate source artifacts or processed waveform/spectrogram/loudness/beat/frequency refs; normalize, EQ, filter, dynamics, time, spectral gate, saturation, utility channel processors, speed, reverse, and edit-stack changes remain signal-shaping and invalidate processed refs. EQ Band Solo is display/live-audition state only: live routing can isolate soloed bands, while export/offline render and processed-analysis identity continue to use the full audible EQ state.
- The `Keep Pitch` toggle maps to the clip-level `preservesPitch` flag.
- The tab displays lazy default values for missing `audio-volume` and creates that legacy volume effect only when the user edits volume, so opening Properties does not dirty history. EQ is not created by opening the tab; users add it from the `Audio FX Stack`.

Live routing uses `audioRoutingManager` when EQ, pan, above-unity gain, Aux send gain, runtime metering, or browser-supported registry processors are active. Each live track route feeds a shared master bus; track meters are tapped after clip/track processing and before master processing/fader, while the master meter is tapped from the post-master output. When playback stops, routed meters continue polling the Web Audio graph while delay/reverb/master tails are still audible, then clear after the tail decays. Current live processors include registry pan, parametric EQ, high-pass, low-pass, hum notch, de-click, noise reduction, spectral gate, compressor, de-esser, limiter, noise gate, expander, delay, reverb, saturation, polarity invert, mono sum, channel swap, and stereo split. Varispeed scrub audio mirrors the supported route contract for registry pan, parametric EQ, hum notch, de-click, noise reduction, spectral gate, limiter, noise gate, expander, saturation, polarity invert, mono sum, channel swap, and stereo split instead of silently dropping those processors. Normalize is render-time only because it needs full-buffer Peak/RMS/LUFS measurement before applying gain. If a route is pure gain at or below unity and no meter is needed, playback falls back to direct `element.volume` updates.

## Waveforms

- Audio clips generate waveforms from decoded audio data.
- Import-time waveform generation produces the lightweight legacy preview first, then writes the source waveform-pyramid artifact to the active project artifact store so later timeline placements can reuse it.
- Lightweight waveform previews preserve stereo and multichannel peak lanes in `waveformChannels`; the legacy `waveform` array remains an aggregate fallback for old projects and analysis helpers.
- Timeline context-menu waveform regeneration refreshes the lightweight preview on request; source waveform-pyramid artifacts are generated at import time and reused by dragged timeline clips.
- Source waveform pyramids and processed waveform pyramids can be stored as audio analysis artifacts.
- New waveform pyramids store all levels/channels/statistics in one packed Float32 artifact payload instead of separate min/max/RMS/peak payload files per channel. Older split-stat waveform manifests still load for existing projects.
- Source and processed loudness envelopes can be stored as artifact-backed LUFS/RMS/peak curve payloads with summary metrics.
- Source and processed beat grids/onset maps can be stored as artifact-backed spectral-flux event lists for node, repair, and edit workflows.
- Source and processed frequency summaries/phase-correlation maps can be stored as artifact-backed frequency-band and stereo-health payloads for node, repair, and visual workflows.
- Region gain, silence, cut, and duration-preserving delete-silence edits are also applied directly to the visible waveform columns as a predictive display path. Dragging a region gain line updates the displayed amplitude from the current source/legacy LOD immediately; the processed waveform artifact is refreshed later as a background cache, not as a visible clip progress/error state or UI dependency.
- Processed waveforms first try a fast derived path when the edit can be represented from the source waveform pyramid, including region gain, silence, cut, insert/delete silence without timeline compaction, reverse, polarity invert, channel swap, and stereo split. This keeps detailed waveform display while making simple region edits update from cached pyramid data instead of re-rendering the audio buffer.
- Complex processed waveforms are generated through the same clip-local offline audio render path used by export, including trim, repair operations, compacting silence deletes, spectral edits, speed/pitch, and signal-shaping processors such as flexible EQ, dynamic EQ, and STFT Spectral Dynamics. Clip volume, including volume automation, is treated as output/display gain so changing loudness does not force heavy analysis regeneration.
- Processed analysis invalidation is scoped to signal-shaping changes. Cache-neutral `audioState` metadata patches and pure `audio-volume` effect-stack updates keep processed refs reusable; edit stacks, spectral layers, mute, source revision, speed/reverse, and non-default signal-shaping effects invalidate processed refs.
- Spectral Audio mode generates source or processed spectrogram tile artifacts on demand and renders those tiles directly in the timeline lane.
- Processed spectrograms are keyed by the same clip audio-state hash as processed waveforms, so edit-stack, speed, reverse, mute, and audio effects get their own stale-safe spectral display.
- Node Workspace audio ports can generate/refresh waveform, processed waveform, spectrogram, loudness, beat, onset, phase, and frequency-summary artifacts from the node inspector. AI/custom-node authoring and runtime context receive bounded artifact refs, cached loudness/frequency/phase summaries, and clip/track/master routing snapshots without exposing raw audio buffers.
- Spectrogram, loudness, beat/onset, and frequency/phase timeline jobs share `ClipAudioAnalysisOrchestrator` for source/processed buffer preparation and expose a semantic `audioAnalysisJob` while keeping the legacy waveform progress indicator compatible.
- Source waveform pyramids are generated during import, with lazy upgrade remaining as a fallback for legacy media or clips that have only a lightweight waveform preview.
- Source waveform-pyramid bucket analysis yields back to the browser between bounded chunks so timeout/cancel signals can be handled and the timeline does not freeze during detailed analysis. Divisible pyramid levels derive from the finest PCM pass instead of re-scanning the decoded audio for each level.
- Detailed waveform display uses a perceptual display scale: the RMS/loudness body is the primary readable shape, the peak envelope is a quieter underlay, and high-crest peaks are drawn as selective transient spikes instead of a continuous outer peak trace. Worker-rendered clip waveforms preserve available stereo/multichannel lanes and match the main-thread fallback styling instead of collapsing artifact-backed stereo data to a mono canvas.
- Nested composition clips generate waveforms from the mixed-down buffer when available.
- Large files are skipped: audio-only files above 4 GB and video files above 500 MB.
- Legacy waveform display normalizes bounded peak data for display. Old saved projects may only have an aggregate mono fallback until their waveform preview is regenerated.

## Timeline Audio Editing

- `Audio Focus` is available from the Timeline `View` menu.
- Audio Focus keeps editing on the main timeline: video tracks remain visible as compact context, while audio tracks get larger lanes for detailed waveform work.
- In Audio Focus with `Detailed Audio`, holding Ctrl/Strg and dragging inside an audio clip creates an inline audio region selection, while normal left-drag still moves clips.
- Double-clicking a detailed audio clip in Audio Focus selects the full visible clip as an audio region.
- Dragging an already selected audio region repositions that region inside the clip while preserving its duration; dragging outside the selected region keeps the normal whole-clip move behavior. Dragging the selected region's left or right edge resizes the region directly. Matching edit-stack operations are moved/resized in place with their existing operation ids instead of duplicating a new region edit.
- Region selections snap to nearby waveform valleys as a zero-cross-safe fallback when source waveform data is available.
- The selected audio region shows a horizontal gain line. Dragging the line up/down creates or updates a non-destructive `gain` edit for that region, and the side handles set the fade-in/fade-out of that gain change. The lower 2% of the gain lane maps from -24 dB down to a true silence endpoint shown as `-∞ dB`.
- Existing region edit markers are shown as subtle timeline overlays only while their region is not actively selected; clicking a marker reopens that region for editing.
- Region edit markers stack from the top of the clip downward when ranges overlap, and the Timeline View menu can hide/show those markers without bypassing the underlying edits.
- The active region highlight spans the full clip height so its boundaries are visible across the complete audio clip.
- Clicking outside the active audio region, its context menu, or an edit marker closes the region highlight.
- Right-clicking the selected audio region opens the secondary edit menu for copy/paste, silence, insert silence, delete audio, reverse, invert polarity, left/right channel swap, mono sum, stereo split to mono, and repair operations.
- The audio-region context menu is portaled to the document body, exposes direct Split/Cut/Copy/Paste commands at the top, and groups secondary commands into compact right-opening submenus for clipboard, time, direction, channels, and repair commands. Split cuts at both region edges and selects the newly isolated middle clip. Cut copies the selected region, lifts it out of the audio track, and leaves the original audio as the two remaining left/right clip parts.
- The audio-region context menu also exposes Region FX presets such as high pass, low pass, presence boost, compressor, de-esser, noise gate, and saturation. These are stored as region edit-stack operations instead of global clip effects, so they move/resize with the highlighted region and are applied by preview, bake, and export only inside that source range.
- Scrub/live preview applies simple region edit-stack volume changes for gain fades, silence/cut, and duration-preserving delete-silence instead of always auditioning the unedited source level. While the gain line is being dragged, a transient preview state drives playback/scrub volume before the undoable edit is committed on mouse-up.
- Scrub/live playback also routes Region FX while the playhead is inside the edited source range. Detailed waveform display keeps using the immediate source-pyramid preview while the exact processed waveform refresh runs in the background.
- Repair operations currently include 50 Hz hum notch filtering, de-click interpolation, splice-edge smoothing, and region RMS loudness matching. They are stored as `repair` edit-stack operations, so bypass, bake, processed analysis, and export all use the same path.
- In Audio Focus with `Spectral Audio`, holding Ctrl/Strg and dragging inside an audio clip creates a time/frequency selection over the inline spectrogram.
- The spectral region toolbar can add non-destructive `spectral-mask` or `spectral-resynthesis` edit-stack operations with bounded frequency metadata.
- The spectral region toolbar can also turn the selected Media panel image into an image-in-spectrum layer. Image layers are stored on `clip.audioState.spectralLayers`, rendered as overlays in the spectral lane, editable from the selected clip `Audio Edits` tab, keyframable for opacity/gain/frequency bounds, and can also be created by dropping an image from the Media panel onto the spectral hit area.
- `spectral-mask` operations render through the shared clip audio render path as deterministic band-limited attenuation, so processed waveforms, bake, and export hear the same edit.
- Image-in-spectrum layers render through `ClipAudioRenderService` by decoding image luminance/alpha into bounded time/frequency masks. Layer keyframes are evaluated during the same render path so animated gain/opacity/frequency bounds stay consistent across processed analysis, bake, and export. `attenuate`, `boost`, `gate`, `sidechain-mask`, and `replace` currently use deterministic, phase-preserving band operations.
- Edit-stack operations live on `clip.audioState.editStack`; they can be inspected from the Properties panel `Audio Edits` tab and bypassed, removed, cleared, or baked without mutating the original media file.
- Baking active edit-stack operations creates a new WAV media source in the Media Panel `Baked Audio` folder and stores the project-local file under `Raw/Baked Audio/`. It resets the clip edit stack, keeps the old source immutable, and records bake provenance plus a restore snapshot in `audioState.bakeHistory`. Unbake restores the latest reversible bake back to the original media source with its region edit stack, waveforms, and analysis refs when the source media is still available.

## Import And Detection

Video audio detection uses `detectVideoAudio()` with MediaBunny for MP4-based containers,
HTMLVideoElement probing as a fallback, and a light WebM/MKV header check.
If detection stays inconclusive, the code falls back to assuming audio exists.

Audio extraction for playback and export uses browser `decodeAudioData`, not MP4Box.

## Recording

`AudioRecordingService` records armed audio tracks through the browser input stack and commits the result back into the existing media/timeline pipeline.

- Track `recordArm`, `inputMonitor`, and optional `inputDeviceId` live on `TrackAudioState`.
- Settings -> Audio supplies the default recording input device when a record-armed track has no track-specific input device.
- Recording can be controlled from either the timeline toolbar or the docked Audio Mixer. Both paths use the same `AudioRecordingService` and the same armed-track state.
- Starting recording groups armed tracks by input device, requests microphone input, prefers an `AudioWorklet` PCM capture backend, falls back to `MediaRecorder` when required, and stores active-session recovery metadata in local storage.
- AudioWorklet capture writes streamed `Float32` PCM chunks directly into 16-bit PCM WAV files through the shared audio file encoder, so it avoids a decode/re-encode pass and preserves sample-rate/channel metadata.
- MediaRecorder fallback captures browser-native chunks and transcodes to WAV when the browser can decode the recorded blob.
- Stopping recording prepares recorded audio files, imports the files into the Media panel with project-copy enabled, and adds audio clips at the original playhead start time.
- Timeline In/Out markers define punch recording. If the playhead is before the In marker, recording enters `waiting-for-punch`, starts capture when timeline time reaches In, and stops/commits automatically at Out.
- After commit, source waveform and loudness jobs are queued for each recorded clip so timeline display and Node/AI context can use the same artifact-backed analysis path as imported files.
- Active recording sessions checkpoint MediaRecorder chunks and bundled AudioWorklet PCM chunks into recovery artifacts. Stopped sessions also persist their final captured blobs until media import and clip creation succeed, so failed commits remain visible and can be retried from the Mixer recovery list. Cancelling recording stops media tracks and clears recovery metadata without adding clips.

## Multicam And Analysis

- `audioAnalyzer` provides RMS level curves and downsampled fingerprints.
- `audioSync` uses normalized cross-correlation plus FFT-backed waveform/envelope correlation to compute offsets.
- The Timeline clip context menu exposes Sync via Audio for selected clips with at least two audible sources; the command realigns the selected audio/video pairs and stores the result as a manual linked group.
- `MulticamDialog` and `multicamStore` still use the legacy media-id offset path for the experimental multicam flow.
- Transcript-based sync exists separately when clip transcripts are available.

## Composition Mixdown

`compositionAudioMixer` mixes nested composition audio into a single buffer.
It also creates a playable WAV-backed `HTMLAudioElement` and a waveform for timeline display.
That mixdown buffer is reused by export when the composition is part of the export range.

## Export

Audio export is handled by `engine/audio`:
`AudioExportPipeline` -> `AudioGraphRenderer` -> `AudioExtractor` -> `ClipAudioRenderService` -> `AudioEffectRenderer` -> `AudioMixer` -> `AudioEncoderWrapper`.

- `FrameExporter` uses `AudioExportPipeline.exportAudio()` for normal video exports with audio.
- `FrameExporter` uses `AudioExportPipeline.exportRawAudio()` for the FFmpeg export path.
- `ExportPanel` also exposes standalone audio export through the same pipeline.
- Audio-only WAV export uses `exportRawAudio()` and writes a 16-bit PCM WAV file.
- The pipeline applies clip trimming, region edit-stack operations including paste/insert/delete silence, reverse, repair, spectral masks, speed changes, clip/track/master registry effects, track pan, graph-based mute/solo, enabled track sends as master-return mix entries, mixing, master fader, optional target-LUFS gain, final limiter/peak normalization, and then encoding.
- The Master bus popover includes Export Preflight `Check` and `Measure` actions. `Check` stores graph/static-state warnings on `masterAudioState.exportPreflight`; `Measure` renders the current export audio range and records integrated LUFS, true peak, sample peak, RMS, and loudness-target delta before adding measured clipping, true-peak, silence, and LUFS-target warnings.
- `AudioEncoderWrapper` prefers AAC-LC and falls back to Opus if the browser supports it.
- Peak normalization is optional and only happens during export when enabled.

Important limitation:
the WebCodecs audio encoder is required for the standalone browser-compressed audio path.
Audio-only WAV export does not require WebCodecs audio encoding.
FFmpeg exports can still receive raw audio because they use `exportRawAudio()`.

## Limitations

- Basic non-neural broadband noise reduction is available as a deterministic registry insert for live playback, scrub preview, processed analysis, bake, and export. Advanced noise-profile learning, spectral restoration, and neural denoise are still out of scope.
- Runtime meters cover live Peak/RMS track and master previews, left/right stereo channel peaks, and stereo phase correlation for routed playback/scrub graphs. Offline loudness analysis remains artifact-based for LUFS/history/detail views.
- Recording persists active/stopped/error recovery metadata, stores active chunks and stopped capture blobs as artifacts, exposes stale entries in the Audio Mixer, and removes temporary recovery artifacts after a successful retry or dismiss. Before recovery-backed capture starts, `AudioRecordingService` estimates browser storage headroom, requests persistent storage for long or low-headroom takes when the browser supports it, and surfaces quota/persistence warnings in the toolbar and Audio Mixer.
- Export applies the master target LUFS when set. The gain is computed from the rendered master bus after master effects/fader, capped to +/-24 dB, skipped for effective silence, and applied before the final limiter/peak normalization stage. Registry Normalize can also be inserted into clip, track, or master FX stacks for render-time Peak, RMS, or LUFS normalization with a true-peak ceiling.
- Live playback and export render enabled track sends into the master mix as send-return audio. Dedicated return-bus effect chains are still part of the broader mixer work.
- Compressor, de-esser, limiter, noise gate, expander, delay, reverb, pan, parametric EQ, hum notch, de-click, noise reduction, spectral gate, saturation, polarity invert, mono sum, channel swap, and stereo split have live-routing support plus offline/export render support. Normalize has processed-analysis, bake, and export render support. Full noise-profile restoration and full de-click restoration suites are still broader workstation work.
- Region RMS loudness matching exists through the non-destructive repair stack, and registry Normalize covers Peak/RMS/LUFS render-time normalization. Deeper true-peak loudness auditing beyond the current preview/ceiling path remains broader mastering work.
- Spectral Audio mode has artifact-backed spectrogram display, time/frequency and brush-style region edit operations, renderable spectral masks, phase-preserving spectral resynthesis, and deterministic image-in-spectrum layers with layer keyframes. Image-in-spectrum replacement can resynthesize silent source bands with phase-continuous bins, but higher-level restoration/noise-profile workflows remain broader workstation work.
- Live audio is limited by browser `playbackRate` behavior and cannot play backwards.

## Sources

`src/services/audioManager.ts`, `src/services/audioRoutingManager.ts`, `src/services/layerBuilder/AudioSyncHandler.ts`,
`src/services/layerBuilder/AudioTrackSyncManager.ts`, `src/services/audioAnalyzer.ts`, `src/services/audioSync.ts`,
`src/services/compositionAudioMixer.ts`, `src/stores/timeline/helpers/audioDetection.ts`,
`src/stores/timeline/helpers/audioTrackHelpers.ts`, `src/stores/timeline/helpers/waveformHelpers.ts`,
`src/stores/timeline/audioEditSlice.ts`, `src/services/audio/ClipAudioRenderService.ts`,
`src/services/audio/SpectrogramTileSetGenerator.ts`, `src/services/audio/timelineSpectrogramCache.ts`,
`src/services/audio/LoudnessEnvelopeGenerator.ts`, `src/services/audio/timelineLoudnessEnvelopeCache.ts`,
`src/services/audio/BeatOnsetAnalysisGenerator.ts`, `src/services/audio/beatOnsetManifest.ts`,
`src/services/audio/FrequencyPhaseAnalysisGenerator.ts`, `src/services/audio/frequencyPhaseManifest.ts`,
`src/services/audio/timelineFrequencyPhaseCache.ts`,
`src/services/audio/ClipAudioAnalysisOrchestrator.ts`, `src/services/audio/clipAudioAnalysisJobs.ts`,
`src/components/timeline/utils/spectralSelection.ts`,
`src/engine/audio/AudioEffectRegistry.ts`, `src/engine/audio/AudioEffectRenderer.ts`,
`src/engine/audio/spectralGateProcessor.ts`,
`src/engine/audio/eq/*`,
`src/components/panels/properties/AudioEqualizerInstanceList.tsx`,
`src/components/panels/properties/VolumeTab.tsx`, `src/components/panels/properties/EffectsTab.tsx`,
`src/components/panels/properties/AudioEditStackTab.tsx`,
`src/components/timeline/utils/spectrogramCanvas.ts`, `src/services/timeline/timelineSpectrogramArtifactWarmup.ts`,
`src/components/panels/nodes/NodeWorkspacePanel.tsx`,
`src/components/panels/properties/index.tsx`, `src/components/export/ExportPanel.tsx`,
`src/services/audio/AudioRecordingService.ts`,
`src/components/panels/audio-mixer/AudioMixerPanel.tsx`,
`src/engine/export/FrameExporter.ts`, `src/engine/audio/*`
