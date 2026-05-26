# Flex EQ Full Scope Plan

## Context

MasterSelects should replace the current split between fixed `audio-eq`, single-band
`audio-parametric-eq`, high-pass, low-pass, and UI-only graph drawing with one
professional, flexible EQ architecture.

This is not a short-term visual polish pass. The target is a native MasterSelects
equalizer that can behave as a 3-band EQ, 10-band graphic EQ, fully parametric EQ,
mastering EQ, dynamic EQ, spectral-dynamics processor, EQ matching tool, and
project-wide EQ instance controller. Those modes should be presets and workflows
over one shared EQ data model, DSP compiler, response renderer, analyzer pipeline,
and automation contract.

The commercial EQ reference is useful as a quality benchmark for interaction,
analyzer display, filter breadth, dynamic operation, instance control, and mastering
workflow. MasterSelects must build its own native implementation, visual language,
project schema, and audio graph integration.

## Product Goal

Create one `audio-eq` effect that supports:

- Up to 24 bands per instance.
- Any mix of graphic, parametric, cut, shelf, notch, band-pass, tilt, and all-pass
  bands.
- Presets/views for 3-band, 10-band graphic, vocal cleanup, mastering, custom,
  and match-generated EQs.
- Zero-latency, natural-phase, and linear-phase processing modes.
- Per-band stereo, left, right, mid, side, and future surround channel targeting.
- Dynamic EQ per band.
- Spectral Dynamics per band for narrow problem-frequency compression/expansion.
- Real-time spectrum analysis with pre, post, and pre+post display.
- Response graph drawing based on real filter math, not connected UI points.
- EQ Sketch: draw a rough target response and fit bands to it.
- Spectrum Grab: create/adjust bands from peaks in the analyzer.
- EQ Match: match one signal's spectral profile to another.
- Character Modes for clean, subtle, and warm analog-style saturation.
- Copy/paste of bands and full EQ curves between clip, track, and master instances.
- Project-wide instance list for all open EQs with search, quick jump, minimap, and
  curve-copy workflows.
- Sample-accurate automation where technically valid.
- Export parity with live playback and processed-analysis cache invalidation.

## Current Code Baseline

### Data And Registry

- `src/engine/audio/AudioEffectRegistry.ts` defines
  `AudioEffectParamValue = number | boolean | string`, which blocks nested EQ band
  arrays.
- `src/types/audio.ts` defines `AudioEffectInstance.params` as
  `Record<string, string | number | boolean>`.
- `audio-eq` is currently a 10-band graphic EQ with flat params
  `band31`, `band62`, `band125`, `band250`, `band500`, `band1k`, `band2k`,
  `band4k`, `band8k`, and `band16k`.
- `audio-parametric-eq` is a separate one-band effect with `frequencyHz`,
  `gainDb`, and `q`.

### Rendering

- `AudioEffectRenderer.renderEffectInstances()` is the shared offline/export path.
- `AudioEffectRenderer.createEQChain()` builds a fixed 10 peaking-filter chain.
- `AudioEffectRenderer.createParametricEQNode()` builds one peaking filter.
- High-pass and low-pass are separate descriptors and separate render branches.

### Live Routing

- `src/services/audio/audioGraphRouteSettings.ts` exposes live settings as:
  - `volume`
  - `eqGains: number[]`
  - `processors: LiveAudioRouteProcessor[]`
- `src/services/audioRoutingManager.ts` creates 10 fixed EQ filters per route and
  also supports separate `parametric-eq`, `high-pass`, and `low-pass` processors.
- The live analyzer node currently feeds meter snapshots. It does not expose a
  professional EQ spectrum model with pre/post taps.

### Audio Graph And Project Identity

- `src/engine/audio/AudioGraphRenderer.ts` normalizes registered effect params
  from fixed registry `paramNames`, drops unknown keys, and drops non-primitive
  values.
- `AudioGraphEffectDescriptor.params` currently stores primitives only.
- `audioAnalysisIdentity.ts` serializes effect params into processed-analysis cache
  identity, but relies on the current primitive-safe shape.

### Automation

- Effect automation uses paths shaped like `effect.{effectId}.{paramName}`.
- `keyframeSlice.ts` handles effect properties only when `property.split('.')`
  has exactly 3 parts.
- This cannot address nested per-band properties like
  `effect.eq1.eq.bands.band-2.frequencyHz`.

### UI

- `VolumeTab.tsx` still owns the legacy clip-level volume and EQ surface.
- `AudioEffectStackControl.tsx` renders most audio effects as generic param grids
  and special-cases `audio-eq` to the new graph.
- `GraphicalEqualizerControl.tsx` draws a useful first graph, but its curve is
  derived by connecting band gain points. It is not a true filter response graph,
  does not render real spectrum data, and does not model Q, filter type, phase,
  dynamic behavior, or channel mode.

## Core Decision

There will be one canonical EQ descriptor: `audio-eq`.

All EQ modes are presets, views, or migrations over the same canonical state.

- 3-band EQ: 3 default bands.
- 10-band graphic EQ: 10 fixed-frequency bell bands.
- Parametric EQ: freely movable bands.
- Mastering EQ: same model with mastering-oriented defaults and analyzer range.
- Match EQ: generated band set plus provenance.
- Dynamic EQ: dynamic settings attached to bands.
- Spectral Dynamics: spectral processor settings attached to bands.
- High-pass, low-pass, notch, shelves, all-pass: band types, not separate long-term
  effects.

The current `audio-parametric-eq`, `audio-high-pass`, and `audio-low-pass` can
remain loadable for compatibility, but new authoring should use `audio-eq`.

## Target Data Model

### JSON-Safe Effect Param Values

Replace primitive-only params with JSON-safe values:

```ts
export type AudioEffectParamValue =
  | string
  | number
  | boolean
  | null
  | AudioEffectParamValue[]
  | { [key: string]: AudioEffectParamValue };
```

Update:

- `AudioEffectInstance.params`
- `AudioGraphEffectDescriptor.params`
- `AudioGraphEffectPlanStep.params`
- audio graph canonicalization
- processed-analysis identity serialization
- project persistence tests
- type helper tests

### Canonical EQ State

```ts
export type AudioEqPhaseMode = 'zero-latency' | 'natural' | 'linear';
export type AudioEqCharacterMode = 'clean' | 'subtle' | 'warm';
export type AudioEqAnalyzerMode = 'off' | 'pre' | 'post' | 'pre-post';

export type AudioEqBandType =
  | 'bell'
  | 'low-shelf'
  | 'high-shelf'
  | 'low-cut'
  | 'high-cut'
  | 'notch'
  | 'band-pass'
  | 'tilt-shelf'
  | 'all-pass';

export type AudioEqBandStereoMode =
  | 'stereo'
  | 'left'
  | 'right'
  | 'mid'
  | 'side'
  | 'surround';

export interface AudioEqBandDynamics {
  enabled: boolean;
  mode: 'compress' | 'expand';
  thresholdDb: number;
  rangeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  sidechainMode: 'self' | 'external';
  sidechainFilterHz?: number;
  sidechainFilterQ?: number;
}

export interface AudioEqBandSpectralDynamics {
  enabled: boolean;
  mode: 'compress' | 'expand';
  thresholdDb: number;
  rangeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  resolution: 'low-latency' | 'balanced' | 'mastering';
}

export interface AudioEqBand {
  id: string;
  enabled: boolean;
  type: AudioEqBandType;
  frequencyHz: number;
  gainDb: number;
  q: number;
  slopeDbPerOct?: number;
  brickwall?: boolean;
  stereoMode: AudioEqBandStereoMode;
  channelMask?: string[];
  dynamic?: AudioEqBandDynamics;
  spectralDynamics?: AudioEqBandSpectralDynamics;
}

export interface AudioEqParamsV2 {
  schemaVersion: 2;
  presetKind:
    | '3-band'
    | '10-band-graphic'
    | 'parametric'
    | 'mastering'
    | 'match'
    | 'custom';
  phaseMode: AudioEqPhaseMode;
  characterMode: AudioEqCharacterMode;
  analyzerMode: AudioEqAnalyzerMode;
  analyzerRangeDb: 3 | 6 | 12 | 30;
  pianoDisplay: boolean;
  bands: AudioEqBand[];
  selectedBandIds?: string[];
  match?: AudioEqMatchState;
  sketch?: AudioEqSketchState;
}
```

### Match And Sketch State

```ts
export interface AudioEqMatchState {
  enabled: boolean;
  sourceRef?: string;
  targetRef?: string;
  amount: number;
  smoothing: number;
  generatedAt?: string;
}

export interface AudioEqSketchState {
  lastStrokeId?: string;
  fittedBandIds?: string[];
  simplification: number;
  maxGeneratedBands: number;
}
```

## Target Modules

Create `src/engine/audio/eq/`:

- `AudioEqTypes.ts`: canonical types, constants, limits.
- `AudioEqDefaults.ts`: default bands, presets, mastering ranges.
- `AudioEqLegacy.ts`: v1/legacy mapping, validation, migration helpers.
- `AudioEqResponse.ts`: response curve math for UI and tests.
- `AudioEqCompiler.ts`: convert canonical bands to live/offline/export plans.
- `AudioEqBiquad.ts`: coefficient/frequency-response utilities.
- `AudioEqLinearPhase.ts`: FIR/FFT plan generation for linear phase.
- `AudioEqDynamics.ts`: per-band dynamic processor primitives.
- `AudioEqSpectralDynamics.ts`: STFT spectral processor primitives.
- `AudioEqMatch.ts`: spectral comparison and filter-fit utilities.
- `AudioEqSketch.ts`: drawn curve simplification and filter fitting.
- `AudioEqInstanceRegistry.ts`: project-wide EQ instance discovery.

Create UI modules under `src/components/panels/properties/eq/`:

- `AudioEqualizerPanel.tsx`
- `AudioEqualizerGraph.tsx`
- `AudioEqualizerBandControls.tsx`
- `AudioEqualizerAnalyzerCanvas.tsx`
- `AudioEqualizerPresetBrowser.tsx`
- `AudioEqualizerInstanceList.tsx`
- `AudioEqualizerSketchLayer.tsx`
- `AudioEqualizerSpectrumGrabLayer.tsx`

## DSP Architecture

### Compiled EQ Plan

All paths compile canonical params into one plan:

```ts
export interface CompiledAudioEqPlan {
  effectId: string;
  phaseMode: AudioEqPhaseMode;
  characterMode: AudioEqCharacterMode;
  latencySamples: number;
  bands: CompiledAudioEqBandPlan[];
  spectralBands: CompiledAudioEqSpectralBandPlan[];
  postCharacter?: CompiledAudioEqCharacterPlan;
}
```

The plan is used by:

- live playback
- clip processed preview
- processed waveform/spectrogram generation
- export
- response graph rendering
- cache identity

### Filter Types

Support:

- Bell
- Low shelf
- High shelf
- Low cut
- High cut
- Notch
- Band pass
- Tilt shelf
- All pass

Slopes:

- 6 to 96 dB/oct for cuts and shelves.
- Fractional slopes where possible, e.g. `3`, `14.2`.
- Brickwall for high-cut and low-cut.

Implementation:

- Zero-latency and natural phase use IIR/Biquad cascades.
- Linear phase uses FIR/FFT convolution with explicit latency.
- Fractional slopes use coefficient interpolation or cascaded filter fitting.
- Brickwall uses steep cascades for live preview and FIR for linear-phase/export.

### Phase Modes

- `zero-latency`: low-latency IIR, default for editing.
- `natural`: IIR with analog-style matching and smoother response.
- `linear`: FIR/FFT convolution, declared latency, export-quality first.

The renderer must expose latency so timeline sync/export can compensate.

### Character Modes

- `clean`: no saturation.
- `subtle`: gentle program/frequency-dependent transformer-style saturation.
- `warm`: stronger tube-style saturation.

Character processing belongs to the EQ plan, not a separate manually stacked
effect, because presets, copy/paste, match, and A/B should treat it as part of the
EQ instance.

## Live Routing Changes

Replace the fixed `eqGains` path:

```ts
export interface AudioRouteEffectSettings {
  volume: number;
  processors: LiveAudioRouteProcessor[];
}
```

Add:

```ts
type LiveAudioRouteProcessor =
  | { id: string; type: 'eq'; plan: CompiledAudioEqPlan }
  | existingProcessors;
```

`audioRoutingManager` should:

- Stop creating 10 fixed EQ filters for every route.
- Build an EQ processor chain from `CompiledAudioEqPlan`.
- Reuse/update nodes when band count/type signatures are stable.
- Rebuild nodes when band topology changes.
- Support analyzer taps:
  - route source/pre-EQ
  - post-EQ
  - post-track/master where available
- Keep meter snapshots separate from spectrum snapshots.

## Offline And Export Changes

`AudioEffectRenderer` should:

- Replace `createEQChain()` and `createParametricEQNode()` with
  `createCompiledEqNodeChain()`.
- Render legacy 10-band, legacy single parametric, high-pass, and low-pass via
  the canonical EQ normalizer.
- Keep pure sample effects flushing behavior intact.
- Declare latency for linear-phase EQ and compensate in clip/export render plans.
- Use the same smoothing/interpolation behavior as live playback.

`AudioExportPipeline` should:

- Accept compiled EQ effect instances from clip, track, and master plans.
- Preserve export parity for clip-level, track-level, and master-level EQ.
- Include EQ latency in export timing decisions.
- Include EQ state in preflight measurement identity.

## Audio Graph Normalization

`AudioGraphRenderer` must support structured params:

- Replace registered param normalization with descriptor-specific normalizers.
- `audio-eq` uses `normalizeAudioEqParams()`.
- Unknown/payload-shaped fields are still rejected, but nested JSON-safe EQ fields
  are retained.
- Graph keys must canonicalize nested arrays by stable band order and stable band
  IDs.

Diagnostics:

- invalid band type
- duplicate band ID
- too many bands
- invalid slope
- unsupported surround mode
- linear-phase latency not supported in a given live context
- spectral dynamics disabled because required STFT path is unavailable

## Legacy Migration

### Old 10-Band `audio-eq`

Map flat params to:

- `presetKind: '10-band-graphic'`
- 10 enabled `bell` bands
- fixed frequencies: `31`, `62`, `125`, `250`, `500`, `1000`, `2000`, `4000`,
  `8000`, `16000`
- `q: 1.4`
- `gainDb` from old band param
- stable band IDs matching old params, e.g. `band31`, `band1k`

### Old `audio-parametric-eq`

Map to:

- `presetKind: 'parametric'`
- one enabled `bell` band
- frequency/gain/q from legacy params

### Old High/Low Pass Effects

Long term:

- New authoring should create `audio-eq` with `low-cut` or `high-cut` bands.
- Existing effects remain loadable and renderable until project migration can
  safely consolidate them.

### Saving Strategy

Do not rewrite every old project on load just because it contains EQ.

Rules:

- Load old shapes through runtime normalization.
- Save v2 only when the EQ instance is edited or when an explicit project
  migration runs.
- Preserve old legacy effects in undo/redo history until the edit boundary.

## Automation Contract

New paths:

```text
effect.<effectId>.eq.bands.<bandId>.frequencyHz
effect.<effectId>.eq.bands.<bandId>.gainDb
effect.<effectId>.eq.bands.<bandId>.q
effect.<effectId>.eq.bands.<bandId>.slopeDbPerOct
effect.<effectId>.eq.bands.<bandId>.dynamic.thresholdDb
effect.<effectId>.eq.bands.<bandId>.dynamic.rangeDb
effect.<effectId>.eq.characterMode
effect.<effectId>.eq.phaseMode
```

Required changes:

- `parseEffectKeyframeProperty()` must support variable depth.
- `setPropertyValue()` must route nested EQ writes to a dedicated EQ update helper.
- `EffectKeyframeToggle` needs a generic property prop, not only `effectId` and
  `paramName`.
- Old paths like `effect.eq1.band1k` must map to
  `effect.eq1.eq.bands.band1k.gainDb` during legacy normalization.
- Band reorder must not affect automation because band IDs are stable.
- Deleting a band must either remove its automation or mark it orphaned for undo.

## Analyzer And Spectrum

Create `AudioSpectrumService`.

Responsibilities:

- Register live analyzer taps by owner scope, owner ID, effect ID, and tap type.
- Produce smoothed log-frequency bins for UI.
- Support analyzer ranges: 3, 6, 12, and 30 dB.
- Support `pre`, `post`, and `pre-post` overlays.
- Support static fallback from `frequency-summary` artifacts.
- Support peak hold and average curves.
- Expose spectrum snapshots without embedding raw full-length audio data.

Snapshot shape:

```ts
export interface AudioSpectrumSnapshot {
  scope: 'clip' | 'track' | 'master';
  ownerId: string;
  effectId?: string;
  tap: 'pre' | 'post' | 'sidechain';
  updatedAt: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  bins: Float32Array;
  peakBins?: Float32Array;
}
```

Project persistence should not store live spectrum snapshots. It should store only
analysis artifact refs and user display preferences.

## Graph UI

Replace `GraphicalEqualizerControl` with a real EQ graph:

- Canvas or WebGL for spectrum, grid, heat/peak layers, response fills.
- SVG/HTML overlay for selected points, labels, handles, context menus.
- Log-frequency X axis from 20 Hz to 20 kHz.
- dB Y axis with separate mastering/mixing ranges.
- Piano Display optional frequency labels as notes.
- One fill per band based on true filter response.
- One summed response curve based on compiled EQ plan.
- Separate pre/post spectrum traces.
- Optional gain-reduction overlay for dynamic/spectral bands.

Graph interactions:

- Drag point X/Y: frequency/gain.
- Modifier or wheel on point: Q.
- Alt/right-click: reset or context menu.
- Double-click: add band.
- Delete: remove selected bands.
- Drag empty graph in Sketch mode: draw target curve.
- Drag spectrum peak in Spectrum Grab mode: create/filter band.
- Multi-select with marquee/shift-click.
- Band Solo from selected band.

Controls:

- Band type segmented control/icons.
- Frequency, gain, Q, slope fields/knobs.
- Dynamic toggle with threshold/range/attack/release.
- Stereo mode selector.
- Phase mode and Character mode per instance.
- Analyzer pre/post mode and range selector.
- A/B, copy, paste, reset, preset browser.

## Visual Reference And Art Direction

Primary visual reference:

```text
C:\Users\admin\Desktop\0000_Fabfilter_ProQ3_Test_01_GUI-1079577-1024x615.jpg
```

This image is a reference for rendering quality, graph density, hierarchy, and
interaction feel. MasterSelects should not copy the brand, logo, exact labels, or
pixel layout. The target is a native MasterSelects EQ surface with comparable
visual sophistication.

Required visual qualities:

- Fine, layered frequency-grid lines with clear major/minor hierarchy.
- Log-frequency vertical grid with subtle density changes toward low frequencies.
- Horizontal dB grid with a strong but restrained 0 dB center line.
- Dark glass-like graph background with very low-contrast depth gradients.
- Grey live spectrum trace/fill behind the EQ response, with pre/post variants.
- Colored per-band filter lobes that are translucent, soft-edged, and visibly
  tied to each band handle.
- A summed response curve that reads as the primary audible result.
- Individual band curves/fills that remain legible without overpowering the
  summed curve.
- Handles with crisp centers, light rims, and subtle glow/drop-shadow.
- Selected band affordance: handle, vertical guide, value tooltip, and associated
  controls should clearly belong together.
- Analyzer and response layers should never look like flat decorative SVG blobs;
  they must reflect real data from the EQ response/spectrum pipeline.
- The visual density should support mastering work: quiet enough for long use,
  precise enough for small changes, and polished enough to feel professional.

Layering order:

1. Graph background and vignette/depth treatment.
2. Minor frequency and dB grid.
3. Major frequency and dB grid.
4. Analyzer spectrum fills/traces.
5. Per-band response fills.
6. Per-band response strokes.
7. Summed EQ response curve.
8. Selected-band guides and tooltip.
9. Band handles and active hover/selection effects.
10. Axis labels, piano labels, and range labels.

Color rules:

- Use multiple band colors, but keep saturation controlled through alpha and
  glow rather than solid neon blocks.
- Boost areas should feel warm/bright; cut areas can lean cooler/darker.
- Spectrum should stay neutral grey unless comparing pre/post.
- Pre/post spectrum overlays should be distinguishable without dominating the
  filter curves.
- The UI should not collapse into a one-note purple/blue theme. Purple bands are
  allowed, but they must be balanced with cyan, green, yellow, and red/orange
  accents.

Graph rendering implementation:

- Use Canvas or WebGL for the dense spectrum, grid, soft fills, and gradients.
- Use SVG or HTML overlay for interactive handles, tooltips, focus rings, and
  accessible controls.
- Device-pixel-ratio scaling is required for crisp fine lines.
- Render graph layers from deterministic data structures so screenshots can be
  compared across iterations.
- Keep graph rendering decoupled from audio parameter mutation to avoid UI stalls
  during drags.

## Visual QA Iteration Workflow

The visual implementation must be screenshot-driven. A single implementation pass
is not enough for this surface.

Workflow for each visual pass:

1. Start the dev server with `npm run dev` or reuse an existing local dev server.
2. Open the EQ surface in the browser with a known seeded EQ state:
   - flat response
   - 3-band preset
   - 10-band graphic preset
   - dense custom 12-16 band mastering preset
   - selected narrow notch
   - pre/post analyzer active
3. Capture screenshots from the dev server after each pass.
4. Compare screenshots against the local reference image and against the previous
   MasterSelects iteration.
5. Adjust spacing, contrast, grid density, alpha, gradients, handle styling, and
   label placement.
6. Repeat until the graph reads as a professional analyzer/EQ surface, not a
   chart widget.

Required screenshot set:

- Full properties panel at common desktop width.
- Compact mixer/track FX stack.
- Master EQ panel.
- Narrow panel/mobile-constrained width.
- Selected band tooltip/controls visible.
- Analyzer pre/post visible.
- 24-band stress case.

Acceptance checks per screenshot:

- Fine grid lines are visible but not noisy.
- Spectrum sits behind the EQ response and does not fight selected controls.
- Colored filter lobes read as smooth frequency responses.
- Summed response remains the most important curve.
- Text labels do not overlap handles, tooltips, controls, or neighboring labels.
- Handles are easy to locate on dark and busy spectrum areas.
- Narrow notches, shelves, and cut slopes are visually distinct.
- The panel still feels like MasterSelects, not a third-party plugin clone.

Implementation agents should keep temporary screenshots out of source control
unless they are deliberately added as design references. If persistent visual
artifacts are useful, store them under a clearly named design-review folder and
do not mix them with runtime assets.

## Dynamic EQ

Per-band dynamic EQ should use the same band response as static EQ and add gain
movement based on detector state.

For live:

- Use Web Audio worklet where possible.
- Use ScriptProcessor only as compatibility fallback.
- Track gain reduction per band for UI.

For offline/export:

- Use deterministic sample/block processing.
- Same attack/release and sidechain filter math as live.

Band dynamic state:

- compress/expand
- threshold
- range
- ratio
- attack
- release
- sidechain filter
- external sidechain placeholder for future routing

## Spectral Dynamics

Spectral Dynamics is not the same as dynamic EQ. It acts inside a frequency range
and changes only bins that exceed threshold.

Implementation:

- STFT/overlap-add processor.
- Resolution modes:
  - low-latency
  - balanced
  - mastering
- Reuse spectrogram/STFT infrastructure from the audio workstation.
- UI shows activity overlay inside the selected band's frequency area.
- Export must be deterministic and match processed analysis cache identity.

This can ship after static flexible EQ and regular dynamic EQ are stable, but the
data model should reserve fields now.

## EQ Sketch

EQ Sketch workflow:

1. User draws a rough curve in the graph.
2. Stroke is sampled on log-frequency grid.
3. Simplifier turns the stroke into a bounded target response.
4. Fitter creates or adjusts bands to approximate the target.
5. Generated bands remain normal editable bands.

Constraints:

- Respect max 24 bands.
- Avoid creating dense tiny bands for jitter.
- Store sketch provenance only as metadata; final sound comes from bands.
- Provide undo group for the whole sketch action.

## Spectrum Grab

Spectrum Grab workflow:

1. Analyzer identifies stable spectral peaks/resonances.
2. UI exposes grab handles on peaks.
3. Dragging a handle creates or adjusts a bell/notch band.
4. Width/Q is inferred from peak width and refined by user.

Spectrum Grab should use live spectrum snapshots first and frequency-summary
artifacts as fallback.

## EQ Match

EQ Match workflow:

1. Capture source spectrum.
2. Capture target/reference spectrum.
3. Compute smoothed delta curve.
4. Fit up to a configured number of EQ bands.
5. Store generated bands and match metadata.

Use cases:

- Match clip to reference clip.
- Match track to master reference.
- Match master to imported reference audio.

Non-goals:

- Do not mutate original audio.
- Do not hide generated changes. The match result must be inspectable as editable
  bands.

## Instance List

Create a project-wide EQ instance registry.

Sources:

- clip `audioState.effectStack`
- track `audioState.effectStack`
- master `effectStack`
- future node/workspace EQ instances

Instance list UI:

- Compact spectrum mini-view per instance.
- Search by clip/track/master name.
- Filter by scope.
- Quick jump to owner.
- Copy/paste full EQ curve.
- Optional linked editing for selected instances.
- Auto-focus instance under cursor when list is open.

## Preset Browser

Preset records:

```ts
export interface AudioEqPreset {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  params: AudioEqParamsV2;
  createdAt?: string;
  updatedAt?: string;
  builtin?: boolean;
}
```

Features:

- Tags
- Favorites
- Search
- Factory presets
- User presets
- Import/export preset JSON
- Apply full preset
- Apply only bands
- Apply only analyzer/phase/character settings

## Undo, Redo, A/B, Copy/Paste

All EQ operations must be timeline-history aware:

- Add/remove band
- Move band
- Edit frequency/gain/Q/slope
- Change type
- Enable/disable band
- Toggle dynamic/spectral dynamics
- Apply preset
- EQ Sketch fit
- Spectrum Grab create/edit
- EQ Match apply
- Copy/paste curve

A/B should be local to the EQ instance and should not break timeline undo. A/B
switching changes active params but should be represented as one undoable action
when committed.

## Node Workspace Integration

Expose EQ as audio graph data, not raw buffers:

- EQ node input/output ports.
- Spectrum as bounded table/texture refs.
- Response curve as `curve` signal.
- Band list as metadata/table signal.
- Dynamic gain reduction as bounded telemetry signal.

AI/custom-node context should receive:

- band summary
- analyzer availability
- current selected band
- response bounds
- warnings

It should not receive raw full-length audio samples.

## Performance Requirements

Targets:

- 24 static bands live without UI stalls.
- Analyzer on master and selected clip/track without render loop stalls.
- UI graph redraw decoupled from audio graph updates.
- Drag latency under one animation frame for UI feedback.
- Audio parameter smoothing prevents zipper noise.
- Export remains deterministic.
- Long timelines avoid full reanalysis on every drag.

Implementation rules:

- Debounce heavy processed-analysis invalidation during drag, but keep audible live
  feedback immediate.
- Use approximate response during drag if needed, then refine.
- Cache response curves by normalized EQ plan and graph dimensions.
- Reuse Web Audio nodes when topology is unchanged.

## Processed Analysis And Cache Identity

EQ changes that affect sound must invalidate processed waveform/spectrogram data.

Rules:

- Analyzer display settings alone do not invalidate processed analysis.
- Band visual selection does not invalidate processed analysis.
- Band frequency/gain/Q/type/slope/dynamic/spectral settings do invalidate.
- Phase mode and character mode invalidate.
- Live-only UI state is excluded from audio-state identity.

`processedWaveformEligibility.ts` must use `normalizeAudioEqParams()` to detect
non-default audible EQ state.

`audioAnalysisIdentity.ts` must canonicalize nested EQ params with stable band
order and stable band IDs.

## Tests

### Unit

- Legacy 10-band to v2 mapping.
- Legacy parametric to v2 mapping.
- Default EQ is silent/no-op.
- Audible EQ requires processed analysis.
- Analyzer-only changes do not require processed analysis.
- Band add/remove/reorder preserves stable IDs.
- Automation path parsing for nested EQ paths.
- Response curves for bell/shelf/cut/notch/all-pass.
- Slope and brickwall validation.
- Phase mode latency reporting.
- Character mode deterministic output bounds.
- Dynamic EQ gain reduction math.
- Spectral Dynamics STFT processor identity and bounds.

### Integration

- Clip EQ live/offline/export parity.
- Track EQ live/offline/export parity.
- Master EQ live/offline/export parity.
- Old project with `band1k` opens and renders same or within tolerance.
- Old project with `audio-parametric-eq` opens and renders same or within
  tolerance.
- Keyframes on old `band*` properties still work after migration.
- Processed waveform invalidates only when audible EQ changes.
- Copy/paste EQ curve between clip, track, and master.
- Preset apply creates one undo action.
- EQ Sketch creates bounded bands and is undoable.
- EQ Match creates editable bands and is undoable.

### UI

- Graph renders nonblank in desktop and narrow panel widths.
- Text labels do not overlap critical controls.
- Dragging points updates frequency/gain.
- Wheel/modifier updates Q.
- Band Solo toggles audible preview.
- Analyzer pre/post displays update without blocking.
- Instance list can jump to owner.
- Preset browser search/favorite/tag flows.

## Implementation Order

### Phase 1: Schema And Normalization

- Add JSON-safe audio effect param type.
- Add `AudioEqParamsV2` types and defaults.
- Add `normalizeAudioEqParams()`.
- Add legacy mapping for current 10-band and single parametric EQ.
- Update audio graph param normalization for structured EQ params.
- Update processed-analysis identity for nested params.

Exit criteria:

- Existing tests pass.
- Old 10-band EQ state normalizes to canonical v2.
- No old projects are rewritten just by loading.

### Phase 2: Response Math

- Implement filter response math.
- Implement summed response generation.
- Implement per-band fill/curve samples.
- Add golden response tests.
- Replace UI point-connection curve with true response data.

Exit criteria:

- Graph displays true band lobes and summed curve.
- Current 10-band EQ visually resembles real filter response.

### Phase 3: Offline Renderer

- Compile canonical EQ to offline render plan.
- Replace fixed `createEQChain()` and single `createParametricEQNode()` paths.
- Preserve old render behavior within tolerance.
- Add phase mode and latency groundwork.

Exit criteria:

- Offline tests prove legacy parity.
- Export can render canonical EQ params.

### Phase 4: Live Routing

- Replace fixed `eqGains` with compiled EQ processors.
- Rebuild/reuse dynamic Web Audio filter chains.
- Add pre/post analyzer taps.
- Keep existing meters stable.

Exit criteria:

- Live playback matches offline within tolerance for static EQ.
- Analyzer snapshots are available for selected scope.

### Phase 5: Full Graph UI

- Create `AudioEqualizerGraph`.
- Render spectrum, grid, band fills, summed response, handles.
- Add band selection, add/remove, type, frequency, gain, Q, slope controls.
- Integrate in `VolumeTab`, `AudioEffectStackControl`, mixer track FX, and master
  FX surfaces.

Exit criteria:

- One UI handles 3-band, 10-band, parametric, and custom EQ.
- Current legacy Volume tab no longer has a separate special EQ implementation.

### Phase 6: Automation And History

- Add nested EQ property parsing.
- Add generic nested effect param update helpers.
- Add keyframe toggles for band fields.
- Ensure undo/redo grouping for graph operations.

Exit criteria:

- Band frequency/gain/Q automation works.
- Legacy band keyframes still load.

### Phase 7: Presets, A/B, Copy/Paste

- Add factory presets.
- Add user preset persistence.
- Add A/B state.
- Add copy/paste bands and full curves.

Exit criteria:

- Presets and A/B are undo-safe.
- Curves can move between clip, track, and master.

### Phase 8: Dynamic EQ

- Add per-band dynamic settings.
- Add live/offline dynamic processor.
- Add gain reduction telemetry.
- Add graph overlays.

Exit criteria:

- Dynamic EQ is audible, visible, automatable, and export-safe.

### Phase 9: Spectral Dynamics

- Add STFT spectral processor.
- Add spectral-dynamics band settings.
- Add analyzer/graph overlays.
- Integrate with processed-analysis cache.

Exit criteria:

- Spectral Dynamics handles narrow resonances without broad EQ movement.
- Export and processed preview are deterministic.

### Phase 10: Sketch, Grab, Match, Instance List

- Add EQ Sketch fitting.
- Add Spectrum Grab.
- Add EQ Match.
- Add project-wide instance list.

Exit criteria:

- User can draw, grab, match, and manage EQs across a project.
- Generated bands remain editable normal bands.

## Risks And Decisions To Keep Explicit

- Linear-phase mode requires latency compensation and can be expensive.
- Spectral Dynamics requires STFT infrastructure and should not block static EQ.
- Surround/Atmos targeting should be represented in schema now, but can render as
  unsupported with diagnostics until channel routing exists.
- Character Modes need careful gain staging to avoid clipping surprises.
- EQ Match must be inspectable and editable, not a hidden black-box correction.
- Dynamic graph UI must not tie audio parameter updates to expensive analyzer
  redraws.
- Legacy migration must be reversible through undo and safe for existing projects.

## Definition Of Done

The Flex EQ is complete when:

- A single `audio-eq` can represent 3-band, 10-band, parametric, mastering, custom,
  dynamic, and spectral-dynamics EQ setups.
- Clip, track, and master EQ use the same engine and UI components.
- Live playback, processed previews, analysis artifacts, and export are equivalent
  within documented tolerances.
- Old projects with `audio-eq`, `audio-parametric-eq`, `audio-high-pass`, and
  `audio-low-pass` remain loadable and render correctly.
- The graph shows true filter response and spectrum, not decorative approximations.
- Automation, undo/redo, A/B, presets, copy/paste, sketch, grab, match, and
  instance management work without special-case drift.
