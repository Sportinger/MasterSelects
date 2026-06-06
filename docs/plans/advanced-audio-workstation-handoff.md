# Advanced Audio Workstation Handoff

Date: 2026-05-26  
Branch: `issue-144-advanced-audio-workstation`

## Current State

The advanced audio work is implemented directly in the timeline rather than in a separate editor window. Audio clips now have richer waveform/spectrogram display modes, non-destructive edit stacks, spectral selections, image-in-spectrum layers, processed/source analysis artifacts, recording state, mixer controls, and Node/AI context wiring.

Recent fixes in this handoff pass:

- Fixed the `TimelineClipComponent` crash caused by hook order instability while clips move between tracks.
- Fixed unstable `AudioRecordingService.getSnapshot()` behavior by caching recovery snapshots.
- Added recording storage quota and persistence warnings in the timeline controls and audio mixer.
- Prevented static volume changes from causing processed waveform/spectrogram auto-regeneration by using the existing processed audio identity hash for the timeline request key.
- Added deterministic rule-based audio repair suggestions from cached loudness, frequency, and phase analysis.
- Exposed repair suggestions to AI node authoring context and runtime context without raw audio buffers.
- Started the professional audio track-header redesign: audio tracks now use a wider timeline header with mixer-strip style controls, vertical meter/fader, pan, S/M/monitor/R/Aux/lock/FX buttons.
- Upgraded Node Workspace audio analysis ports from generic `metadata` ports to semantic signal types: `curve` waveform/loudness/phase, `texture` spectrum tiles, `table` frequency bands/summaries, `event` beats/onsets, `text` transcript timing, and bounded `metadata` audio metadata.
- Added `frequencyBands` and `audioMetadata` aliases to AI node runtime signals so generated nodes can read compact analysis tables and source/routing metadata without raw audio buffers.
- Integrated audio analysis into the `Source` graph node for audio-capable clips so artifact-backed analysis signals live with the media source.
- Made Node Workspace audio analysis `Refresh` actions force-regenerate matching artifacts instead of returning early when refs already exist.
- Added `Source` node audio-analysis summary params plus graph badges/progress for ready, partial, missing, and processed artifact state.
- Surfaced cached repair suggestions in the Audio Edit Stack panel and made Apply create non-destructive whole-clip `repair` or `mono-sum` operations with suggestion/evidence metadata.
- Added cancellable per-suggestion repair preview/audition from the Audio Edit Stack. Preview and Apply share the same operation builder, render through `ClipAudioRenderService`, and play a bounded clip window around the playhead.
- Added Silence Cleanup in the Audio Edit Stack panel. It detects quiet ranges from decoded clip audio, applies compacting non-destructive `delete-silence` operations, shortens the clip duration, and exposes same-track ripple as a panel toggle.
- Added Room Tone Fill for selected audio regions. The operation loops detected quiet source ranges in `ClipAudioRenderService`, uses a deterministic low-level fallback when no source tone is available, and remains non-destructive in the clip edit stack.
- Fixed the timeline audio track meter: vertical RMS/scale layers no longer collapse to a 1px top line, and peak position is now rendered as a positioned hold line.
- Added generic Audio Edit Stack auditioning. The panel can now preview the raw source, current bake-like edit stack, and an individual selected operation using bounded `ClipAudioRenderService` renders without mutating the source, effects, or timeline state.
- Added Shift/Alt spectral brush selection in Spectral Audio mode. Brush selections stay on the timeline, render as soft elliptical overlays, and persist brush shape/radius metadata on non-destructive spectral edit operations.
- Replaced the `spectral-resynthesis` band-gain fallback with a phase-preserving STFT/overlap-add render path. `spectral-mask` still uses the faster deterministic bandpass-gain path.
- Added direct source audio-analysis port-to-AI node creation in Node Workspace. Waveform, spectrum, loudness, frequency-band, beat/onset, phase, transcript, and audio-metadata ports now expose an `AI` action that creates a matching custom node, connects it as a typed sidechain, and avoids accidentally inserting analysis nodes into the main clip output chain.
- Linked video/audio clips now resolve to a single visual-clip graph. Selecting either side shows the same graph, with source audio and analysis ports targeting the linked audio clip and one combined `Clip Output` node accepting both texture and audio.
- Added pure linked-graph ownership regression coverage. The tests pin the exact behavior that selecting linked audio resolves to the visual graph owner, selecting linked video keeps that owner, legacy audio-side graph edits are projected onto the visual owner when the owner has no graph yet, and an existing visual graph is never overwritten by stale audio-side state.
- Wired the AI/custom-node render runtime to linked audio clips. When a visual clip graph renders with a separate linked audio clip, generated nodes now receive the linked clip's bounded analysis refs, metadata, waveform summary, audio-track routing state, and linked source-node port metadata through `context.audio`, `input.audio`, `context.signals`, and `context.graph`.
- Wired direct source audio-analysis links into renderable AI/custom nodes as bounded named inputs. Texture-chain AI nodes can now receive connected frequency-band tables, audio metadata, and other source audio ports through `input.<portId>` and `context.signals.connectedInputs`, while retaining the global bounded aliases for `frequencyBands`, `beats`, `onsets`, and `audioMetadata`.
- Added clip identity to the bounded AI audio source/metadata context. Generated nodes can now distinguish the graph owner from the linked audio clip through `audio.source.clipId`, `audio.source.linkedClipId`, `audio.metadata.clipId`, and `audio.metadata.linkedClipId` without receiving raw buffers.
- Made source audio-port `AI` actions create renderable audio-reactive visual AI nodes when the graph owner is visual. The node is inserted into the texture chain and receives the selected audio port as a named sidechain such as `frequencyBands`, while audio-only graph owners keep the existing analysis-typed standalone node behavior.
- Upgraded replace-mode image-in-spectrum layers from bandpass gain shaping to STFT image resynthesis. The render path maps image luminance into time/frequency magnitudes, reuses source phase where possible, and synthesizes deterministic phase for silent bins so replace layers can create spectral content non-destructively.
- Improved replace-mode image-in-spectrum quality. Silent-bin synthesis now uses deterministic phase continuity across STFT frames instead of frame-random phase, spectral image masks are kept at higher source resolution, and mask sampling is bilinear so image-driven edits/resynthesis avoid hard pixel-boundary stepping.
- Bounded inline spectrogram CPU rendering for deep zoom. The render plan caps draw pixels, preserves the visible timeline span, and `TimelineClipCanvas` / `utils/spectrogramCanvas` use lookup tables instead of recalculating time/frequency for every pixel.
- Fixed the timeline and mixer audio meters so colored Peak/RMS fills use transform-scaled layers again, with the white line acting only as a peak marker.
- Added Transient Cleanup in the Audio Edit Stack panel. It detects high-crest peaks, creates non-destructive `repairType: transient-soften` operations, and renders the softening through `ClipAudioRenderService` for preview, bake, processed analysis, and export parity.
- Added responsive audio track-header density modes. Full-height audio lanes keep the mixer-strip controls, medium lanes use a two-row compact control matrix, and very small lanes collapse fader/pan while keeping core buttons stable instead of clipping three rows of controls.
- Polished the timeline audio track headers toward the mixer-strip target with local SVG icons, dB/pan readouts, compact Aux labels, and clearer Peak/RMS meter layering.
- Deferred inline spectrogram canvas drawing to cancellable animation frames. Rapid zoom/scroll updates cancel stale scheduled draws, so the bounded CPU renderer no longer spends a frame painting geometry the user has already moved past.
- Added bounded rendered preflight measurement history on the master bus. The Audio Mixer now keeps recent LUFS/true-peak range measurements visible after later static checks, so mastering decisions can compare multiple rendered passes without rerunning export immediately.
- Added punch-in input warmup for recording. The service starts paused capture handles shortly before punch-in and resumes them at the punch point, reducing permission/device startup latency without adding pre-roll audio to committed clips.
- Added a dedicated dynamics view inside clip, track, and master FX stacks. Compressor, de-esser, limiter, and noise gate effects now show transfer curves plus threshold/ceiling/floor and timing readouts using the same registry params that feed live/offline/export processing.
- Added live gain-reduction snapshots to runtime audio meters for Web Audio compressor/de-esser processors. The dynamics views now show `GR` readouts keyed by effect id, and master aggregation keeps the strongest current reduction per effect id across active track meters.
- Wired limiter and noise gate into the live route processor contract. Normal playback now creates sample-domain preview nodes for those processors, varispeed scrub audio no longer treats them as compressor fallbacks, and live meters can publish limiter/gate `GR` snapshots with the same effect ids as the FX stack.
- Added offline/export automation support for deterministic sample-domain FX. Limiter, noise gate, delay, and reverb now evaluate `effect.<id>.<param>` keyframes in their sample render loops, and the delay renderer now honors `toneHz` in the offline path.
- Fixed the production build blocker in `AudioEditStackTab` by making audio-region selection narrowing explicit before reading source in/out points.
- Raised the timeline zoom cap to 10,000 px/sec for precise audio editing and added 10ms/20ms ruler/grid intervals at the deepest zoom levels.
- Deferred inline waveform canvas drawing to cancellable animation frames, matching the spectrogram behavior so rapid zoom/scroll updates cancel stale waveform paints before they block interaction.
- Added artifact-backed stereo/multi-channel waveform rendering. The timeline canvas waveform path draws separated channel lanes from waveform pyramid channel data and can render artifact-only waveforms even when no legacy normalized thumbnail array is present.
- Added processed-analysis display status for timeline waveform/spectrogram lanes. When a clip needs processed analysis but only source/legacy data is available, the lane gets a visible `SRC` approximation badge and stale stripe; loading, missing, and failed processed artifacts get distinct `PEND`, `MISS`, and `ERR` states.
- Added timeline waveform `CLIP` and `SIL` diagnostics. The badges use source/processed waveform pyramid peak/RMS data for artifact-backed clipping and silence checks, apply cheap display gain for volume-only output changes, and avoid treating normalized legacy thumbnails as clipping evidence.
- Added audio-volume fade/automation overlay curves on timeline audio clips. The curve is derived from enabled legacy or registry `audio-volume` keyframes, so volume automation remains visible while source/processed waveform artifacts stay reusable.
- Strengthened project persistence coverage for the full spectral/edit-stack state. The project save/load test now verifies spectral image layers with keyframes, spectral-resynthesis operations, room-tone operations, and bake history survive without embedding transient waveform/job payloads.
- Added a React render test for the timeline audio mixer-strip header. It verifies full, compact, and condensed audio density classes plus real meter/fader, dB, pan, Aux, and SVG icon markup.
- Added regression coverage for the timeline track context menu reported during audio header work. The test verifies outside pointer-down dismissal, capture-phase dismissal even when timeline surfaces stop propagation, inside pointer safety, and Escape dismissal.
- Added explicit bake/render coverage for non-destructive audio edit stacks. The bake test verifies the clip is rendered through `ClipAudioRenderService`, imported as derived audio media, retargeted to the baked source, cleared of active edits, assigned source analysis refs, and given bake-history provenance.
- Added focused splice-smoothing DSP coverage in `ClipAudioRenderService` so the named repair operation is verified separately from de-click, hum-notch, loudness-match, transient, room-tone, and silence tests.
- Reduced stale preview work during deep zoom/scrub. `proxyFrameCache` now treats large scrub jumps as teleports, drops stale queued proxy preloads for the same media, keeps media ids with underscores parse-safe, and exposes the dropped-preload count in proxy stats. `LayerBuilderService` now refuses held proxy frames that are too far from the requested media time during drag scrubs, and `RenderDispatcher` now clears stale empty drag holds after large target jumps, so old proxy/canvas holds do not mask the current target after a large timeline jump.
- Tightened playback diagnostics for proxy-backed scrub preview. Cold/seeking HTML video elements no longer make a scrub run `bad` when most visible preview frames are responsive proxy/scrub-cache frames with no freeze streaks. Freeze/held-proxy cases still remain `bad`.
- Added paused/drag playhead proxy-frame prewarm. `setPlayheadPosition` now kicks a deduplicated exact proxy-frame load for the active video clip while paused or scrubbing, so cold deep-zoom teleports have an exact frame queued before the render path would otherwise fall through to empty/nearest fallback. This does not touch audio analysis refs or processed waveform invalidation.
- Quieted false RenderLoop watchdog wakeups for paused inactive timelines. If no playback, scrub, continuous render, render request, warmup suppression, or fresh active-video demand exists, the watchdog now settles the loop into idle instead of logging repeated stall warnings and forcing unnecessary renders.
- Added registry-backed Parametric EQ and Saturation processors. Parametric EQ now has descriptor/UI params plus live and offline/export peaking-filter rendering; Saturation has drive/tone/mix params plus deterministic sample-domain offline/export rendering and matching live/scrub route support.
- Added registry-backed utility channel processors for Polarity Invert, Mono Sum, and Channel Swap. These are marked default-audible, so adding them invalidates processed analysis even when params match defaults, and they render through normal playback routing, varispeed scrub audio, processed waveform/spectrogram generation, bake, and export.
- Added registry-backed Hum Notch as a default-audible repair insert effect. It now has descriptor/UI params for frequency, Q, harmonics, and mix, renders as a Web Audio harmonic notch chain offline/export, projects into live playback and varispeed scrub routing, and invalidates processed analysis when added.
- Added registry-backed De-click as a default-audible repair insert effect. It now has descriptor/UI params for threshold, ratio, and mix, renders as deterministic sample-domain interpolation offline/export, projects into live playback and varispeed scrub routing, and invalidates processed analysis when added.
- Added registry-backed Stereo Split as a default-audible utility effect and wired `split-stereo` region edit rendering. The processor copies a selected source channel across selected output channels for live playback, varispeed scrub, processed analysis, bake, and export.
- Added registry-backed Pan as a required gain processor. It has a normalized `pan` param, renders through `StereoPannerNode` offline/export, projects into normal playback and varispeed scrub routing, stays processed-analysis-neutral at the centered default, and invalidates processed analysis when moved off center.
- Added registry-backed Normalize as the required Peak/RMS/LUFS processor. It measures the full render buffer, applies bounded target gain, enforces a ceiling after gain, renders during processed analysis/bake/export, and is intentionally not projected to live routing because it needs a full-buffer measurement.
- Added registry-backed Expander as the required companion to Noise Gate. It has threshold, ratio, max range, attack, and release params, renders with deterministic downward-expansion DSP offline/export, projects into normal playback and varispeed scrub routing, participates in dynamics transfer-curve UI, and publishes live `GR` snapshots.
- Added registry-backed Noise Reduction as the basic non-neural broadband repair processor. It has threshold, reduction depth, sensitivity, attack, release, and mix params, renders with deterministic envelope-based broadband reduction offline/export, projects into normal playback and varispeed scrub routing, and stays processed-analysis-neutral at the fully dry/default state.
- Added registry-backed Spectral Gate as the required spectral dynamics insert. It has threshold, reduction depth, low/high crossover, attack, release, and mix params, shares one deterministic three-band DSP helper across live playback, varispeed scrub, processed analysis, bake, and export, and stays processed-analysis-neutral at the fully dry/default state.
- Added stereo phase-correlation runtime metering. Normal routed playback and varispeed scrub now sample post-pan L/R analyser data, aggregate phase/width into track and master meter snapshots, and show a correlation marker in the timeline and Audio Mixer meters.
- Removed the Volume tab's open-time creation of missing legacy `audio-volume` and `audio-eq` effects. The tab now shows lazy defaults and creates the legacy effect only when the user edits the control, satisfying the no-dirty-history migration requirement.

## Verification Run In This Pass

Passed:

- Latest phase/correlation meter pass: `npx tsc --noEmit`, `npm run build`, focused ESLint on `audioMetering`, `audioRoutingManager`, `proxyFrameCache`, `AudioLevelMeter`, and focused Vitest for audio metering, meter UI, registry/type guards, graph route settings, renderer registry, and processed waveform eligibility.
- `npx tsc --noEmit`
- `npx eslint src\components\panels\properties\VolumeTab.tsx src\engine\audio\AudioEffectRegistry.ts src\engine\audio\AudioEffectRenderer.ts src\services\audio\audioGraphRouteSettings.ts src\services\audioRoutingManager.ts src\services\proxyFrameCache.ts src\components\panels\properties\AudioEffectStackControl.tsx src\components\panels\properties\audioDynamicsView.ts src\types\index.ts src\types\audio.ts tests\unit\VolumeTab.test.tsx tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\processedWaveformPyramidService.test.ts tests\unit\audioDynamicsView.test.ts`
- `npm run test -- tests\unit\VolumeTab.test.tsx tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\processedWaveformPyramidService.test.ts tests\unit\audioDynamicsView.test.ts tests\unit\proxyFrameCache.test.ts`
- `npm run build`
- `npm run test`
- `npm run test -- tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioMetering.test.ts tests\unit\audioDynamicsView.test.ts`
- `npx eslint src\types\audio.ts src\services\audio\audioGraphRouteSettings.ts src\services\audioRoutingManager.ts src\services\proxyFrameCache.ts src\components\panels\properties\AudioEffectStackControl.tsx src\components\panels\properties\audioDynamicsView.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audioDynamicsView.test.ts`
- `npm run test -- tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\clipAudioRenderService.test.ts`
- `npx eslint src\engine\audio\AudioEffectRenderer.ts tests\unit\audio\audioEffectRendererRegistry.test.ts`
- `npm run test -- tests\unit\audio\processedWaveformPyramidService.test.ts tests\stores\timeline\clipSlice.test.ts tests\stores\timeline\keyframeSlice.test.ts`
- `npm run test -- tests\unit\audio\audioRepairSuggestions.test.ts tests\unit\aiNodeRuntime.test.ts tests\unit\nodeGraphProjection.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts tests\stores\timeline\clipSlice.test.ts`
- `npm run test -- tests\stores\timeline\audioEditSlice.test.ts tests\unit\audio\audioRepairSuggestions.test.ts`
- `npm run test -- tests\unit\audio\audioRepairSuggestionOperations.test.ts tests\unit\audio\audioRepairPreviewService.test.ts tests\stores\timeline\audioEditSlice.test.ts tests\unit\audio\audioRepairSuggestions.test.ts`
- `npm run test -- tests\unit\audio\audioSilenceDetection.test.ts tests\unit\audio\clipAudioRenderService.test.ts tests\stores\timeline\audioEditSlice.test.ts tests\unit\audio\audioRepairPreviewService.test.ts tests\unit\audio\audioRepairSuggestionOperations.test.ts`
- `npm run test -- tests\stores\timeline\trackSlice.test.ts tests\unit\audio\audioMetering.test.ts`
- `npm run test -- tests\unit\audio\audioEditPreviewService.test.ts`
- `npx eslint src\services\audio\AudioEditPreviewService.ts src\components\panels\properties\AudioEditStackTab.tsx tests\unit\audio\audioEditPreviewService.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npx eslint src\services\nodeGraph\clipGraphProjection.ts src\components\panels\nodes\NodeGraphCanvas.tsx tests\unit\nodeGraphProjection.test.ts`
- `npm run test -- tests\unit\nodeGraphLinking.test.ts`
- `npx eslint src\services\nodeGraph\clipGraphLinking.ts tests\unit\nodeGraphLinking.test.ts`
- `npm run test -- tests\unit\aiNodeRuntime.test.ts`
- `npx eslint src\services\nodeGraph\aiNodeRuntime.ts src\services\layerBuilder\LayerBuilderService.ts tests\unit\aiNodeRuntime.test.ts`
- `npx eslint src\services\nodeGraph\aiNodeRuntime.ts tests\unit\aiNodeRuntime.test.ts`
- `npm run test -- tests\unit\layerBuilderService.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npx eslint src\services\layerBuilder\LayerBuilderService.ts src\services\nodeGraph\aiNodeRuntime.ts tests\unit\layerBuilderService.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npm run test -- tests\unit\timelineSpectralSelection.test.ts tests\stores\timeline\audioEditSlice.test.ts`
- `npx eslint src\components\timeline\TimelineTrack.tsx src\components\timeline\TimelineClipCanvas.tsx src\components\timeline\utils\timelineActiveTargets.ts src\stores\timeline\audioEditSlice.ts src\stores\timeline\types.ts tests\unit\timelineSpectralSelection.test.ts tests\stores\timeline\audioEditSlice.test.ts`
- `npm run test -- tests\unit\audio\clipAudioRenderService.test.ts`
- `npx eslint src\services\audio\ClipAudioRenderService.ts tests\unit\audio\clipAudioRenderService.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\stores\timeline\nodeGraphSlice.test.ts`
- `npx eslint src\services\nodeGraph\clipGraphProjection.ts src\stores\timeline\nodeGraphSlice.ts src\stores\timeline\types.ts src\stores\timeline\exportEditLock.ts src\components\panels\nodes\NodeWorkspacePanel.tsx tests\unit\nodeGraphProjection.test.ts tests\stores\timeline\nodeGraphSlice.test.ts`
- `npm run test -- tests\unit\spectrogramRenderPlan.test.ts tests\unit\timelineSpectrogramCanvas.test.ts tests\unit\timelineSpectralSelection.test.ts tests\unit\waveformLod.test.ts`
- `npx eslint src\components\timeline\TimelineClipCanvas.tsx src\components\timeline\utils\spectrogramCanvas.ts src\components\timeline\utils\spectrogramRenderPlan.ts src\services\timeline\timelineSpectrogramArtifactWarmup.ts tests\unit\spectrogramRenderPlan.test.ts tests\unit\timelineSpectrogramCanvas.test.ts`
- `npm run test -- tests\unit\audio\audioTransientDetection.test.ts tests\unit\audio\clipAudioRenderService.test.ts tests\stores\timeline\audioEditSlice.test.ts tests\unit\AudioLevelMeter.test.tsx`
- `npx eslint src\services\audio\audioTransientDetection.ts src\services\audio\ClipAudioRenderService.ts src\stores\timeline\audioEditSlice.ts src\stores\timeline\types.ts src\stores\timeline\exportEditLock.ts src\components\panels\properties\AudioEditStackTab.tsx tests\unit\audio\audioTransientDetection.test.ts tests\unit\audio\clipAudioRenderService.test.ts tests\stores\timeline\audioEditSlice.test.ts tests\unit\AudioLevelMeter.test.tsx`
- `npm run test -- tests\unit\timelineAudioLayout.test.ts tests\unit\AudioLevelMeter.test.tsx`
- `npx eslint src\components\timeline\TimelineHeader.tsx src\components\timeline\components\AudioLevelMeter.tsx src\components\timeline\utils\audioTrackHeaderDensity.ts tests\unit\timelineAudioLayout.test.ts tests\unit\AudioLevelMeter.test.tsx`
- `npm run test -- tests\unit\timelineSpectrogramCanvas.test.ts tests\unit\spectrogramRenderPlan.test.ts`
- `npx eslint src\components\timeline\TimelineClipCanvas.tsx src\components\timeline\utils\spectrogramCanvas.ts src\components\timeline\utils\spectrogramRenderPlan.ts src\services\timeline\timelineSpectrogramArtifactWarmup.ts tests\unit\timelineSpectrogramCanvas.test.ts tests\unit\spectrogramRenderPlan.test.ts`
- `npm run test -- tests\unit\audioAutomationCurve.test.ts tests\unit\waveformLod.test.ts tests\unit\timelineSpectrogramCanvas.test.ts`
- `npx eslint src\components\timeline\TimelineClipCanvas.tsx src\services\timeline\timelineWaveformArtifactWarmup.ts src\services\timeline\timelineSourceWaveformWarmup.ts src\services\timeline\timelineSpectrogramArtifactWarmup.ts src\components\timeline\utils\spectrogramCanvas.ts tests\unit\timelineSpectrogramCanvas.test.ts`
- `npm run test -- tests\stores\timeline\playbackSlice.test.ts tests\unit\waveformLod.test.ts tests\unit\spectrogramRenderPlan.test.ts tests\unit\timelineSpectrogramCanvas.test.ts`
- `npx eslint src\stores\timeline\constants.ts src\components\timeline\hooks\useTimelineHelpers.ts src\components\timeline\TimelineRuler.tsx src\components\timeline\TimelineClipCanvas.tsx tests\stores\timeline\playbackSlice.test.ts tests\helpers\storeFactory.ts tests\unit\timelineSpectrogramCanvas.test.ts`
- `npm run test -- tests\stores\timeline\trackSlice.test.ts`
- `npx eslint src\types\audio.ts src\stores\timeline\trackSlice.ts src\components\panels\audio-mixer\AudioMixerPanel.tsx tests\stores\timeline\trackSlice.test.ts`
- `npm run test -- tests\unit\audio\audioRecordingService.test.ts`
- `npx eslint src\services\audio\AudioRecordingService.ts src\services\audio\timelineRecordingWorkflow.ts src\components\panels\audio-mixer\AudioMixerPanel.tsx tests\unit\audio\audioRecordingService.test.ts`
- `npm run test -- tests\unit\audioDynamicsView.test.ts`
- `npx eslint src\components\panels\properties\AudioEffectStackControl.tsx src\components\panels\properties\audioDynamicsView.ts tests\unit\audioDynamicsView.test.ts`
- `npm run test -- tests\unit\audio\audioMetering.test.ts tests\unit\audioDynamicsView.test.ts`
- `npx eslint src\types\audio.ts src\services\audio\audioMetering.ts src\services\audioRoutingManager.ts src\components\panels\properties\AudioEffectStackControl.tsx src\components\panels\properties\audioDynamicsView.ts src\components\panels\properties\VolumeTab.tsx src\components\panels\audio-mixer\AudioMixerPanel.tsx tests\unit\audio\audioMetering.test.ts tests\unit\audioDynamicsView.test.ts`
- `npm run test -- tests\unit\projectMediaPersistence.test.ts`
- `npx eslint tests\unit\projectMediaPersistence.test.ts`
- `npm run test -- tests\unit\TimelineHeaderAudioStrip.test.tsx tests\unit\timelineAudioLayout.test.ts tests\unit\AudioLevelMeter.test.tsx`
- `npx eslint tests\unit\TimelineHeaderAudioStrip.test.tsx src\components\timeline\TimelineHeader.tsx src\components\timeline\utils\audioTrackHeaderDensity.ts`
- `npm run test -- tests\unit\audio\clipAudioRenderService.test.ts tests\stores\timeline\audioEditBakeSlice.test.ts`
- `npx eslint tests\unit\audio\clipAudioRenderService.test.ts tests\stores\timeline\audioEditBakeSlice.test.ts`
- `npm run test -- tests\stores\timeline\audioEditSlice.test.ts tests\stores\timeline\audioEditBakeSlice.test.ts tests\unit\audio\clipAudioRenderService.test.ts tests\unit\projectMediaPersistence.test.ts`
- `npm run test -- tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts`
- `npx eslint src\services\proxyFrameCache.ts src\services\layerBuilder\LayerBuilderService.ts tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts`
- `npm run test -- tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts tests\unit\renderDispatcher.test.ts`
- `npx eslint src\services\proxyFrameCache.ts src\services\layerBuilder\LayerBuilderService.ts src\engine\render\RenderDispatcher.ts tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts tests\unit\renderDispatcher.test.ts`
- `npm run test -- tests\unit\playbackDebugStats.test.ts tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts tests\unit\renderDispatcher.test.ts`
- `npx eslint src\services\playbackDebugStats.ts src\services\proxyFrameCache.ts src\services\layerBuilder\LayerBuilderService.ts src\engine\render\RenderDispatcher.ts tests\unit\playbackDebugStats.test.ts tests\unit\proxyFrameCache.test.ts tests\unit\layerBuilderService.test.ts tests\unit\renderDispatcher.test.ts`
- `npx tsc --noEmit`
- `npx vitest run tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\processedWaveformPyramidService.test.ts`
- `npm run test -- tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts`
- `npm run test -- tests\unit\proxyFrameCache.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts`
- `npm run test -- tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\processedWaveformPyramidService.test.ts tests\stores\timeline\clipSlice.test.ts`
- `npm run test -- tests\unit\proxyFrameCache.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts`
- `npx eslint src\engine\audio\AudioEffectRegistry.ts src\engine\audio\AudioEffectRenderer.ts src\services\audio\audioGraphRouteSettings.ts src\services\audioRoutingManager.ts src\services\proxyFrameCache.ts src\components\panels\properties\AudioEffectStackControl.tsx src\types\index.ts tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts`
- `npx eslint src\engine\audio\AudioEffectRegistry.ts src\engine\audio\AudioEffectRenderer.ts src\services\audio\audioGraphRouteSettings.ts src\services\audioRoutingManager.ts src\services\proxyFrameCache.ts src\services\audio\processedWaveformEligibility.ts src\types\index.ts tests\unit\audioEffectRegistry.test.ts tests\unit\typeHelpers.test.ts tests\unit\audio\audioGraphRouteSettings.test.ts tests\unit\audio\audioEffectRendererRegistry.test.ts tests\unit\audio\processedWaveformPyramidService.test.ts tests\stores\timeline\clipSlice.test.ts`
- `npm run build`
- `npm run test -- tests\unit\audio\clipAudioRenderService.test.ts` (19 tests; includes bilinear image-mask sampling and phase-continuous silent-bin replace resynthesis)
- `npm run test -- tests\unit\TrackContextMenu.test.tsx`
- `npx eslint src\components\timeline\TrackContextMenu.tsx tests\unit\TrackContextMenu.test.tsx`
- `npm run build`
- `npm run lint` (historical full-run result from the audio workstation batch; deleted timeline waveform/spectrogram wrapper hooks no longer exist in the current issue branch)
- `npm run test` (213 files, 2791 tests)
- `npm run test -- tests\stores\timeline\nodeGraphSlice.test.ts tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npx eslint src\stores\timeline\nodeGraphSlice.ts src\services\nodeGraph\clipGraphProjection.ts tests\stores\timeline\nodeGraphSlice.test.ts`
- Focused ESLint on the edited audio/node/runtime/timeline files
- Dev bridge hard reload showed no fresh `TimelineClipComponent` or `getSnapshot` errors
- Dev bridge runtime check after the deep-zoom update returned active browser stats, no fresh React/runtime crash logs, `drops.lastSecond=0`, and an OK playback trace window. The remaining `HIGH_DROP_RATE` entry is historical in the current loaded sample timeline and should be watched during actual zoom/scrub repros.
- Dev bridge `debugExport` smoke test on the loaded linked video/audio timeline passed for `startTime=14`, `durationSeconds=1`, `640x360`, `15fps`, `includeAudio=true`, `exportMode=fast`. It returned a `video/mp4` blob of `979520` bytes in `2094ms`, `effectiveAudio=true`, `audioClipCount=1`, no errors, and stable engine infrastructure before/after.
- Earlier dev bridge scrub probe on the loaded timeline at `zoom ~= 500 px/s` used DOM playhead dragging for a custom 832ms scrub across 4.8s, 5.2s, 5.8s, 4.95s, 6.05s, and 5.4s. Post-run stats held `60fps`, `drops.lastSecond=0`, and render time stayed low (`avg 2.22ms`, `max 3.42ms`) with no new warning or error logs, but proxy-frame scrub preview produced stale/freeze frames (`p95PreviewUpdateGapMs ~= 75.8`, `maxPreviewUpdateGapMs ~= 191.2`, `previewFreezeEvents=2`).
- After the proxy preload/held-frame/empty-hold fixes, the same loaded timeline teleport scrub from `19.160s` to the 4.8s-6.05s range at `zoom ~= 500 px/s` used DOM playhead dragging over `6886px`, held the post-run playback trace at `ok`, produced no new warnings/errors, and reduced the problematic scrub metrics to `previewFreezeEvents=0`, `stalePreviewWhileTargetMoved=1`, `p95PreviewUpdateGapMs=52.1`, `maxPreviewUpdateGapMs=55.1`, and post-run render time `avg 1.2ms`, `max 2.37ms`. The immediate run diagnostics can still report `bad` because very fast teleports briefly emit empty/held preview frames, but the stale proxy-frame freeze path is no longer the dominant issue.
- After playback diagnostics were made proxy-preview-aware, the same DOM teleport scrub from `19.160s` to the 4.8s-6.05s range at `zoom ~= 500 px/s` returned immediate run `status=ok` and trace `status=ok`. The run still reported the underlying HTML element as `seekingVideos=1`, `coldVideos=1`, `worstReadyState=1`, but the visible preview was responsive (`previewFrames=36`, `previewUpdates=31`, `previewFreezeEvents=0`, `stalePreviewWhileTargetMoved=1`, `p95PreviewUpdateGapMs=58.3`, `maxPreviewUpdateGapMs=62.8`, mostly `proxy-frame`), with no new warnings/errors and post-run render time `avg 2.9ms`, `max 3.54ms`.
- After the paused/drag proxy prewarm and RenderLoop watchdog changes, a cold hard-reload DOM teleport scrub from `15.853s` through 4.8s/5.2s/5.8s/4.95s/6.05s/5.4s at `zoom ~= 500 px/s` returned `status=ok`: `previewFrames=48`, `previewUpdates=40`, `previewFreezeEvents=0`, `stalePreviewWhileTargetMoved=1`, `p95PreviewUpdateGapMs=46.6`, `maxPreviewUpdateGapMs=50.6`, `proxy-frame=42`, `empty=2`, `proxy-frame-nearest=1`, and `gpu-not-ready-drop=3`. The same cold jump before prewarm returned `status=bad` with `previewUpdates=24`, `previewFreezeEvents=4`, `stalePreviewWhileTargetMoved=16`, `empty=9`, and `gpu-not-ready-drop=10`.

The full required checks above passed after the latest Track F image-resynthesis, track-menu regression coverage, linked-audio AI runtime wiring, proxy scrub, and playback diagnostics work. Re-run them before committing if additional changes are made.

## Known Follow-Ups

1. Finish the audio track-header polish:
   - Browser-check the responsive density classes across compact/detailed/spectral audio modes once a visual test session is available. The React render coverage now verifies the expected markup/classes, but it cannot replace a pixel-level visual pass.

2. Complete Track F spectral editing:
   - Consider GPU-backed spectrogram tile rendering once the pixel-budgeted CPU canvas path has been profiled in the browser.
   - Continue tuning replace-mode spectral image resynthesis quality with real listening tests and larger imported images. The render path now keeps larger masks, bilinearly samples them, and uses phase-continuous silent-bin synthesis, but the remaining quality call needs audible/browser verification rather than another narrow unit test.

3. Performance:
   - Continue profiling deep zoom responsiveness after the processed-analysis request-key, waveform/spectrogram stale-frame cancellation, and spectrogram draw-budget fixes.
   - Watch for render-loop stalls and high-drop-rate warnings in the dev bridge while zooming into long audio clips.
   - Continue tuning the first few frames after very large scrub teleports. Proxy-frame freeze events and false `bad` diagnostics are gone in the latest bridge probe, but the preview can still transition through a small number of `empty-hold`/`empty` frames during extreme jumps.

## Important Notes For The Next Agent

- Do not use Claude agents. The user explicitly requested that.
- Keep the implementation non-destructive by default: bypass, undo, source refs, and processed refs must remain separate.
- Do not reintroduce volume into processed-analysis identity or request keys. Static volume and volume automation should stay cheap.
- The user wants the whole advanced audio workstation implemented directly on the timeline, not in a separate editor window.
- The current open UX target for audio tracks is a mixer-strip look in the timeline header: visible meter/fader, pan, S/M/monitor/record/input/Aux/lock/FX controls.
