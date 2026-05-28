# Audio Workstation

[<- Back to Index](./README.md)

The Advanced Audio Workstation turns audio from a clip-side utility into a project-wide signal system. The main editing surface remains the timeline: detailed waveform, spectral, region, image-in-spectrum, and repair operations happen in expanded audio lanes and Audio Focus mode. Docked panels support inspection and bus work, but they do not replace timeline editing.

## Architecture

Audio state is split across source media, clips, tracks, the master bus, project artifacts, and Node Workspace signal metadata.

- Source analysis artifacts live in project-addressable binary manifests and payloads: waveform pyramids, spectrogram tiles, loudness envelopes, beat/onset maps, frequency summaries, and phase correlation.
- Clip `audioState` stores non-destructive edit stacks, spectral image layers, registry-backed FX instances, source/processed analysis refs, and bake provenance.
- Track `audioState` stores fader, pan, mute/solo, record arm, input monitor, sends, meters, and track FX.
- `masterAudioState` stores the master fader, limiter, target LUFS, true-peak ceiling, master FX, and export preflight/measurement state.
- Node Workspace exposes audio analysis directly on the `Source` node for audio-capable clips, alongside the source media ports and audio effect lanes. The source node shows artifact availability/status badges and progress directly on the graph. Audio ports expose artifact refs and bounded summaries, not raw full-length buffers. Waveform and loudness ports are `curve` signals, spectrogram ports are `texture` signals, frequency-band summaries are `table` signals, beats/onsets are `event` signals, transcript timing is a `text` signal, and audio metadata stays a bounded `metadata` signal.
- Source audio-analysis output ports can seed AI/custom nodes directly from the inspector. Those nodes inherit the selected signal type and metadata, connect as analysis sidechains, and stay out of the primary clip output chain unless the user wires them there explicitly. Linked video/audio clips share one graph: selecting either side opens the visual clip's graph, with the linked audio clip feeding the source node's audio and analysis ports.

## Timeline Surface

Audio Focus mode keeps the timeline as the detailed editor. It expands audio lanes while leaving video layers visible as compact context.

- Audio-capable imports build the fast stereo/multichannel preview first, then persist the source waveform pyramid in the project artifact store. Detailed Audio mode reuses that artifact on timeline placement, while compact/deep-zoom lazy upgrade remains a fallback for legacy preview-only media. Current waveform pyramids use one packed Float32 payload for all levels/channels/statistics, and older split-stat manifests remain readable. The timeline context-menu regenerate action refreshes the fast preview only, while detailed artifact generation remains cancellable and yields during bucket analysis.
- Simple processed waveform changes, including region gain, derive directly from the source waveform pyramid for near-instant UI feedback when the operation is mathematically representable from existing buckets. The clip waveform also applies region gain/silence preview math directly to the currently visible LOD columns while the user drags, so the display does not jump back to raw source while the processed artifact refreshes. For these derivable edits, processed waveform regeneration is treated as background cache refresh and does not show the red waveform-generation border or progress bar on the clip. Full processed audio rendering remains the path for repair DSP, speed/pitch, spectral edits, compacting delete-silence, and signal-shaping FX.
- Spectral Audio mode renders real spectrogram tile artifacts inline.
- Artifact-backed waveform lanes render stereo and multi-channel sources as separated channel lanes when the waveform pyramid includes channel data. Legacy thumbnails remain mono fallback views.
- Waveform and spectrogram lanes show compact processed-analysis status badges. `SRC` means the lane is temporarily showing source/legacy data while non-destructive edits, FX, speed, or spectral layers require processed analysis; `PEND`, `MISS`, and `ERR` distinguish loading, missing, and failed processed artifacts.
- Waveform lanes also show compact `CLIP` and `SIL` diagnostic badges from the visible source/processed waveform pyramid. Clipping evidence only comes from true artifact peak data; normalized legacy thumbnails are used only for safe digital-silence detection.
- Audio-volume fades and volume automation render as a timeline overlay curve on audio clips. The curve is derived from enabled legacy or registry `audio-volume` keyframes and stays separate from source/processed analysis artifacts.
- Inline spectrogram canvases render the visible clip window with an adaptive pixel budget and precomputed frame/frequency lookup tables, so deep zoom stretches a bounded canvas instead of redrawing unbounded millions of pixels per clip.
- Waveform canvases render the visible clip window on cancellable animation frames. Rapid zoom/scroll updates cancel stale waveform draws, and the timeline zoom cap now reaches 10,000 px/sec with 10ms/20ms ruler intervals for precise audio editing.
- Audio region selections are created with Ctrl/Strg-drag in Audio Focus so normal left-drag outside a selected region can still move clips. Left-dragging an already selected region repositions that region inside the clip while preserving its duration, and dragging the selected region's left/right edges resizes the region directly. Matching edit-stack operations move/resize in place, preserving their operation ids rather than creating duplicate region edits. Selected regions expose a direct gain line with fade-in/fade-out handles for common level changes, with the bottom 2% of the lane reserved for a true silence `-∞ dB` endpoint below -24 dB. Dragging those controls publishes a transient gain preview for live playback, scrub, and waveform drawing; mouse-up commits the non-destructive edit once. Right-click opens direct Split/Cut/Copy/Paste actions first, then secondary non-destructive edit-stack operations grouped into compact submenus for silence, insert/delete silence, reverse, polarity, channel operations, and repairs. Cut copies the selected region and lifts it out of the track, leaving the original audio as the remaining left/right clip parts.
- Scrub and normal playback preview follow simple region edit-stack level changes for gain fades, silence/cut, and duration-preserving delete-silence, so auditioning a marked region no longer always plays the raw source level.
- Audio track headers use timeline-embedded mixer-strip controls with live Peak/RMS metering, automatic left/right stereo bars when the runtime snapshot has channel data, stereo phase-correlation metadata, fader, dB readout, center-out bipolar pan controls, pan readout, core routing buttons, responsive density classes, and compact fallbacks for short tracks.
- Spectral selections create time/frequency edit operations and image-in-spectrum layers. Rectangle drags remain the precise selection tool; Shift/Alt drags use a soft spectral brush selection that stores brush radius/shape metadata on the resulting non-destructive spectral operation. `spectral-resynthesis` renders through a phase-preserving STFT/overlap-add path that edits selected magnitudes while keeping source phase, instead of reusing the cheaper band-gain filter path used by `spectral-mask`. Replace-mode spectral image layers use STFT image resynthesis: image luminance controls bin magnitudes, source phase is reused when available, and silent bins use phase-continuous deterministic synthesis instead of frame-random phase. Spectral image masks are stored at higher resolution and sampled bilinearly so image-driven edits do not step at pixel boundaries.
- The Audio Edit Stack panel surfaces cached rule-based repair suggestions from loudness, frequency, and phase analysis. Suggestions can be auditioned through the same render path used by the edit stack before applying. Applying a suggestion creates a non-destructive whole-clip repair or mono-sum operation with evidence metadata; it does not mutate the source file.
- The Audio Edit Stack panel can also audition the current stack before baking, preview a selected manually authored operation in isolation, and A/B compare against a source-only preview. These previews render bounded clip windows through `ClipAudioRenderService` with bake-like settings, so source media, effects, and timeline state are not mutated.
- Silence Cleanup detects quiet clip ranges from decoded source audio with configurable threshold/minimum duration controls. Removing detected silence adds non-destructive compacting `delete-silence` operations, shortens the timeline clip, and can optionally ripple later same-track clips from the panel.
- Room Tone Fill uses selected audio regions as non-destructive fill targets. It loops detected quiet source ranges through the clip render path, with a deterministic low-level noise fallback when no reusable source tone is available.
- Transient Cleanup detects short high-crest peaks from decoded clip audio and adds non-destructive `repairType: transient-soften` operations. The same edit-stack render path handles preview, bake/render, processed waveform/spectrogram generation, and export.
- Bake/render creates derived media while preserving the original source file.

## Mixer Surface

The docked Audio Mixer is a bus and routing workspace inside the same dock system. It is opened from `View -> Panels -> Audio Mixer`.

- Track strips fill the mixer panel vertically and expose mute, solo, record-arm, input monitor, level meters, volume, center-out bipolar pan controls, sends, and insert slots. Track strips scroll horizontally when they exceed the available width. Track label colors are shared with timeline layers, can be changed from either the layer context menu or the mixer strip context menu, and default to the colorless gray state until the user assigns a label color. Turning the advanced audio-layer eye off suppresses the timeline color indicators and returns audio rows to the neutral gray lane style only; persisted labels and mixer strips remain unchanged.
- The master strip stays pinned outside the horizontal track scroller and exposes master metering, fader, limiter, true-peak ceiling, target LUFS, master FX, and export preflight.
- Clicking a track or master insert opens the stack in a floating FX editor so plugin controls do not consume strip height.
- Live playback routes track outputs into a shared master bus. Track strip meters are post clip/track FX and pre-master, and the master strip meter is post-master so the master fader does not change individual track meters. Mixer strips render true left/right stereo bars from per-channel analyser buffers, using a fixed dB color scale rather than a rescaled gradient fill. Stopped playback keeps metering routed Web Audio tails until the signal decays.
- Rendered export preflight keeps a bounded LUFS/true-peak/RMS measurement history on the master bus, so recent measured passes remain visible in the mixer after static checks.
- Dynamics effects in clip, track, and master FX stacks have a dedicated transfer-curve view for compressor, de-esser, limiter, noise gate, and expander settings. The displayed threshold, ceiling, floor, range, attack, release, and ratio values are the same registry params consumed by live/offline/export processing.
- During live routed playback, compressor, de-esser, limiter, noise gate, and expander processors publish gain-reduction snapshots into the same runtime meter state as Peak/RMS and stereo phase correlation. Web Audio dynamics use native reduction where available; limiter/noise-gate/expander use the same sample-domain processor family as offline/export rendering. The FX dynamics views display those live `GR` values by effect id, and the master bus shows the strongest active reduction per effect id.
- Registry FX stacks now include pan, normalize, parametric EQ, hum notch, de-click, noise reduction, spectral gate, and saturation as first-class processors. Pan uses the same normalized -1..1 control in live playback, scrub preview, and offline/export rendering; normalize measures the full render buffer and applies Peak/RMS/LUFS target gain with ceiling protection during processed analysis, bake, and export; parametric EQ uses the same peaking filter params in live playback and offline/export rendering; hum notch uses a default-audible harmonic notch chain across live, scrub, processed analysis, bake, and export; de-click uses deterministic transient interpolation across live, scrub, processed analysis, bake, and export; noise reduction uses a non-neural broadband envelope reducer across live, scrub, processed analysis, bake, and export; spectral gate uses a shared deterministic three-band gate for live playback, scrub preview, processed analysis, bake, and export; saturation uses deterministic drive/tone/mix processing for offline/export and mirrored live/scrub routing.
- Utility channel processors are also registry-backed: polarity invert, mono sum, channel swap, and stereo split render in live playback, varispeed scrub preview, processed analysis, bake, and export. They are marked default-audible so simply adding the effect invalidates processed analysis even when their params equal defaults.
- Record controls use the same `AudioRecordingService` as the timeline toolbar. The service prefers AudioWorklet PCM capture into WAV and falls back to MediaRecorder when AudioWorklet is unavailable.
- Timeline In/Out markers act as the punch range for toolbar and Mixer recording. Sessions can wait for punch-in, warm input capture shortly before the punch point without writing pre-roll audio, checkpoint active chunks, auto-stop at punch-out, and keep active/stopped/error recovery entries visible until the commit path succeeds, the recovered artifact is retried, or the entry is dismissed.
- Mixer meters subscribe per strip so level updates do not force the full panel to re-render.

## Analysis Efficiency

Static and automated volume changes are treated as display/output gain. They do not invalidate source artifacts, processed refs, or processed analysis identity. Signal-shaping changes still invalidate processed refs.

Volume-safe changes include:

- Legacy `audio-volume` effect params.
- Registry `audio-volume` effect params.
- `audio-volume` automation keyframes.
- Track/master faders.

Signal-shaping changes include:

- Normalize, EQ, pan, filters, hum notch, de-click, noise reduction, spectral gate, compressor, limiter, noise gate, expander, delay, reverb, de-esser, saturation, and utility channel processors.
- Speed, reverse, mute, source-revision, edit-stack, and spectral-layer changes.

## Verification

Current focused checks cover:

- Dock registration for the Audio Mixer panel.
- Volume-only clip edits preserving processed analysis refs.
- Volume automation preserving processed analysis refs.
- Signal-shaping edits invalidating processed refs.
- Processed analysis identity excluding static/automated volume.
- Recording service start/stop/commit behavior, punch-in/out scheduling, fallback backend selection, active chunk and stopped-blob recovery, browser storage quota/persistence warnings, and direct WAV metadata preservation.
- Punch-in input warmup with paused capture handles that resume exactly at the punch point.
- Track/master routing, sends, export preflight, and audio export paths.
- Rendered preflight measurement history preservation across later static checks.
- Dynamics FX view-model coverage for compressor, de-esser, limiter, noise gate, and expander transfer curves.
- Runtime meter aggregation for left/right stereo channel peaks, stereo phase correlation, plus live compressor/de-esser and sample-domain limiter/noise-gate/expander gain-reduction snapshots.
- Offline/export automation for deterministic sample-domain FX, including automated limiter ceilings/input gain, noise-gate thresholds/floors/timing, expander thresholds/ratios/ranges/timing, delay mix/feedback/time/tone, and reverb mix/decay/damping.
- Registry coverage verifies pan, normalize, parametric EQ, hum notch, de-click, noise reduction, spectral gate, and saturation descriptors, live route projection where supported, type guards, default-audible processed-analysis invalidation, and deterministic sample-domain rendering without constructing an unrelated offline node graph.
- Utility FX coverage verifies polarity invert, mono sum, channel swap, and stereo split descriptors, default-audible processed-analysis invalidation, live route projection, edit-stack rendering where applicable, and deterministic offline rendering.
- Node Workspace audio projection and AI runtime context for semantic audio ports, `frequencyBands`, `audioMetadata`, repair suggestions, and artifact-only bounded summaries.
- Node Workspace `Generate`/`Refresh` actions for audio analysis ports. Refresh forces regeneration instead of returning early when a matching artifact ref already exists.
- Node Workspace `Source` graph node status/progress params and badges for ready/partial/missing audio artifact state.
- Node Workspace direct AI/custom node creation from waveform, spectrum, loudness, frequency-band, beat/onset, phase, transcript, and audio-metadata ports without corrupting the main signal chain. On visual graph owners, those actions now create renderable texture AI Nodes in the main visual chain and attach the selected audio port as a bounded named sidechain.
- Node Workspace linked-clip ownership coverage verifies that selecting linked audio resolves to the visual clip graph owner, selecting linked video keeps the same owner, legacy audio-side graph edits are projected onto the visual owner when needed, and existing visual graph edits win over stale audio-side state.
- Node Workspace runtime coverage verifies that the shared visual clip graph receives analysis, metadata, track-routing context, and linked source-node port metadata from the linked audio clip during render, so `context.audio`, `context.graph`, `signals.frequencyBands`, and `signals.audioMetadata` match the same source-node audio ports shown in the editor. Connected source audio-analysis ports are also exposed as bounded named AI-node inputs and under `signals.connectedInputs`, allowing audio-reactive texture nodes to consume frequency tables or audio metadata without raw buffers.
- Rule-based repair suggestions previewed and applied from the Audio Edit Stack as non-destructive edit operations with processed-analysis invalidation.
- Current edit-stack and selected-operation previews render through the same bake path without carrying unrelated clip effects into the audition.
- Silence detection, compacting delete-silence render output, and timeline/store duration updates for detected silence removal.
- Room-tone fill render output, store operation creation, and processed-analysis invalidation.
- Explicit audio edit-stack bake coverage for derived media import, clip retargeting, analysis refs, cleared edit stacks, and bake-history provenance.
- Transient detection, transient-soften repair rendering, edit-stack operation creation, export-lock handling, and processed-analysis invalidation.
- Focused repair DSP coverage for hum notch, de-click, splice smoothing, loudness matching, transient softening, room-tone fill, and silence compaction.
- Spectral rectangle/brush selection math and brush metadata on stored spectral edit operations.
- Phase-preserving STFT render behavior for `spectral-resynthesis`, including target-band attenuation without collapsing unrelated frequency content.
- Replace-mode image-in-spectrum resynthesis from silent source bands, proving image layers can synthesize audible spectral content instead of only filtering existing source energy.
- Replace-mode image-in-spectrum quality coverage for bilinear image-mask sampling and phase-continuous tonal synthesis from silent bins.
- Spectrogram render planning caps deep-zoom canvas draw pixels while preserving the visible timeline span.
- Artifact-backed waveform rendering coverage verifies stereo pyramid channels are drawn as separate canvas lanes and can render without a legacy thumbnail array.
- Timeline analysis display status coverage distinguishes current processed artifacts from source approximations, pending refs, missing refs, and failed loads.
- Timeline waveform diagnostic coverage distinguishes artifact-backed clipping, output-gain silence, normalized legacy thumbnails, and trimmed source ranges.
- Timeline audio automation curve coverage verifies legacy and registry `audio-volume` keyframes are extracted, sorted, clamped for display, and ignored when the backing effect is disabled or bypassed.
- Deep-zoom timeline checks cover the 10,000 px/sec zoom cap, high-resolution ruler/grid intervals, and cancellable waveform/spectrogram canvas redraws.
- Deep-zoom scrub checks cover proxy-frame teleport behavior: stale queued proxy preloads are dropped after large scrub jumps, held proxy/canvas frames are rejected when too far from the target media time, playback diagnostics distinguish responsive proxy scrub preview from genuinely cold playback, and the dev bridge teleport scrub no longer reports proxy-frame freeze events.
- Timeline audio track-header checks cover responsive density selection, dB/pan readout formatting, and vertical meter fill/peak/phase-marker behavior.
- Audio meter checks cover automatic layer-meter stereo selection and the docked mixer's independent left/right stereo bar rendering without the mono phase-marker overlay.
- Timeline audio track-header render checks cover full, compact, and condensed mixer-strip markup with meter/fader, Aux label, SVG icon, dB, and pan readout DOM.
- Timeline track context-menu checks cover outside pointer-down dismissal, capture-phase dismissal through propagation-stopping timeline surfaces, inside-menu pointer safety, and Escape dismissal.
- Project save/load coverage preserves spectral image layers with keyframes, spectral edit operations, room-tone fill operations, and bake history while excluding transient waveform-generation and analysis-job payloads.

## Sources

- `src/components/panels/audio-mixer/AudioMixerPanel.tsx`
- `src/components/timeline/TimelineClip.tsx`
- `src/components/timeline/TimelineControls.tsx`
- `src/components/timeline/TimelineHeader.tsx`
- `src/components/timeline/components/ClipWaveform.tsx`
- `src/components/timeline/utils/audioWaveformDiagnostics.ts`
- `src/stores/timeline/helpers/audioAnalysisStateHelpers.ts`
- `src/services/audio/processedWaveformEligibility.ts`
- `src/services/audio/ClipAudioAnalysisOrchestrator.ts`
- `src/services/audio/ClipAudioRenderService.ts`
- `src/services/audio/audioTransientDetection.ts`
- `src/services/audio/AudioEditPreviewService.ts`
- `src/services/audio/AudioRecordingService.ts`
- `src/services/nodeGraph/clipGraphProjection.ts`
- `src/services/nodeGraph/aiNodeRuntime.ts`
- `src/services/nodeGraph/aiNodeAuthoringContext.ts`
- `src/engine/audio/AudioEffectRegistry.ts`
- `src/engine/audio/AudioExportPipeline.ts`
- `src/engine/audio/spectralGateProcessor.ts`
