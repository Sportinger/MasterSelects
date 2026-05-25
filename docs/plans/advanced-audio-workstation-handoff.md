# Advanced Audio Workstation Handoff

Date: 2026-05-25  
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
- Added a visible `Audio Analysis` graph node for audio-capable clips so artifact-backed analysis signals are not only hidden on the source node.
- Made Node Workspace audio analysis `Refresh` actions force-regenerate matching artifacts instead of returning early when refs already exist.

## Verification Run In This Pass

Passed:

- `npx tsc --noEmit`
- `npm run test -- tests\unit\audio\processedWaveformPyramidService.test.ts tests\stores\timeline\clipSlice.test.ts tests\stores\timeline\keyframeSlice.test.ts`
- `npm run test -- tests\unit\audio\audioRepairSuggestions.test.ts tests\unit\aiNodeRuntime.test.ts tests\unit\nodeGraphProjection.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts`
- `npm run test -- tests\unit\nodeGraphProjection.test.ts tests\unit\aiNodeRuntime.test.ts tests\stores\timeline\clipSlice.test.ts`
- Focused ESLint on the edited audio/node/runtime/timeline files
- Dev bridge hard reload showed no fresh `TimelineClipComponent` or `getSnapshot` errors

Before committing, run the full required checks:

- `npm run build`
- `npm run lint`
- `npm run test`

## Known Follow-Ups

1. Finish the audio track-header polish:
   - Verify the new 210px header across compact/detailed/spectral audio modes.
   - Add better iconography once the app has an icon package or local icon convention for timeline buttons.
   - Tune small-height behavior for audio tracks outside audio focus mode.

2. Complete the remaining Node/AI graph contract work:
   - Add richer status/progress badges on the `Audio Analysis` node itself, not only in the inspector port rows.
   - Consider direct custom-node connection helpers for `frequencyBands`, `spectrum`, `loudness`, beats, and transcript ports.

3. Complete Track F spectral editing:
   - Add spectral brush interaction beyond rectangular selection.
   - Implement true phase-aware spectral resynthesis rather than routing `spectral-resynthesis` through band-gain behavior.
   - Consider GPU-backed spectrogram tile rendering once the CPU canvas path is stable.

4. Complete Track I repair workflow:
   - Add cancellable audio operation previews for repair/bake paths.
   - Add amplitude/loudness-based silence range analysis and true timeline-compacting silence removal.
   - Add room-tone generation/loop DSP.
   - Surface repair suggestions in a reviewed UI flow, not only in AI/Node context.

5. Performance:
   - Continue profiling deep zoom responsiveness after the processed-analysis request-key fix.
   - Watch for render-loop stalls and high-drop-rate warnings in the dev bridge while zooming into long audio clips.

## Important Notes For The Next Agent

- Do not use Claude agents. The user explicitly requested that.
- Keep the implementation non-destructive by default: bypass, undo, source refs, and processed refs must remain separate.
- Do not reintroduce volume into processed-analysis identity or request keys. Static volume and volume automation should stay cheap.
- The user wants the whole advanced audio workstation implemented directly on the timeline, not in a separate editor window.
- The current open UX target for audio tracks is a mixer-strip look in the timeline header: visible meter/fader, pan, S/M/monitor/record/input/Aux/lock/FX controls.
