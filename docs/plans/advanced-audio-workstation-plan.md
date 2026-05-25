# Advanced Audio Workstation Plan

## Context

GitHub issue #144 points at AudioMass as a reference for advanced browser audio editing. AudioMass is useful as a product benchmark, but MasterSelects should not embed or clone it. MasterSelects should build a native audio workstation layer that fits the existing timeline, project persistence, export pipeline, Node Workspace, Signal IR, and long-term "every file becomes a signal" architecture.

This is a full target-architecture plan, not an MVP plan. The implementation is ordered by dependency and integration risk, but the intended result is the complete system: non-destructive audio editing, professional effects, high-resolution waveforms, spectral editing, image-in-spectrum workflows, repair tools, mixer/bus/recording, Node Workspace audio signals, and export parity.

Model-based audio editing is intentionally excluded for now because it requires model/vendor choices that should not block the core workstation architecture. The architecture still exposes bounded audio context to existing AI/custom-node authoring so later model features can be added without redesigning analysis, artifacts, or node ports.

## Full Scope

### In Scope

- Non-destructive clip, region, and spectral editing with undo, redo, bypass, reorder, revision history, and explicit bake/render.
- A durable audio schema covering source assets, analysis artifacts, edit stacks, track audio state, master bus state, job state, and derived media provenance.
- High-resolution multi-channel waveform pyramids with min/max/RMS/peak, source and processed variants, cache identity, and timeline LOD rendering.
- Offline/on-demand analysis for waveform, loudness, spectrogram, mel spectrogram, phase/correlation, beats, onsets, silence, clipping, and frequency summaries.
- Timeline-embedded spectral editing with tiled STFT rendering, time/frequency selection, spectral brush tools, image-driven masks, and DSP-based image-to-spectrum resynthesis.
- A first-class `AudioEffectRegistry` that replaces hardcoded `audio-volume` and `audio-eq` handling and defines live/offline/export behavior for every processor.
- Clip, track, send, and master bus processing with meters, limiter, LUFS/true-peak monitoring, track FX, record arm, and input monitoring.
- Recording through `AudioWorklet` where available, with project persistence, waveform generation, punch-in/punch-out, and recording recovery behavior.
- Non-model repair and assisted workflows: silence removal, hum notch, de-click, splice smoothing, loudness matching, room-tone loop/generation from local audio, and rule-based effect suggestions.
- Node Workspace audio/spectral signals: `audio`, `waveform`, `spectrum`, `frequencyBands`, `loudness`, `beats`, `onsets`, `transcript`, and `audioMetadata`.
- Bounded AI/custom-node context so existing AI Node authoring can understand available audio data without receiving raw full-length buffers.
- Project migration for existing `clip.waveform`, `audio-volume`, `audio-eq`, nested composition audio, exported projects, and saved old compositions.
- Full verification for save/load, undo/redo, export, live/offline parity, cache invalidation, long-file behavior, and node artifact boundaries.

### Explicit Non-Goals

- Mutating original media files.
- Letting arbitrary generated node code process full raw audio buffers in the browser main context.
- Shipping model-based stem separation, neural denoise, dialogue enhancement, voice isolation, music/source separation, or automatic mastering until a separate model strategy is chosen.
- Regenerating every heavy analysis artifact synchronously on every drag. The UI should show responsive approximations immediately and refine artifacts through cancellable background jobs.

## Current MasterSelects Baseline

MasterSelects already has a strong NLE-oriented audio base:

- Linked video/audio clips and audio-only clips on audio tracks.
- Audio track mute/solo and clip-level fades through `audio-volume` keyframes.
- Per-clip `audio-volume` and `audio-eq` effects.
- Live EQ/volume routing through Web Audio.
- Offline export through `AudioExportPipeline`, `AudioExtractor`, `TimeStretchProcessor`, `AudioEffectRenderer`, and `AudioMixer`.
- Audio-only WAV/browser-compressed export.
- Proxy audio, nested composition mixdown, waveform display, multicam audio sync, and transcript-aware features.
- Existing `Cache/waveforms` and `Cache/artifacts` project storage foundations.
- Existing NodeGraph and Signal IR signal types for `audio`, `texture`, `curve`, `table`, `event`, `text`, and `metadata`.

Key current limitations:

- Audio effects are hardcoded special cases, not a registry-backed system like visual effects.
- `audio-volume` and `audio-eq` are wired into types, UI filtering, live routing, offline rendering, and node projection.
- Clip waveforms are embedded as `number[]` on clips, generated from the first channel, normalized, capped, and often saved in project JSON.
- Current waveform generation can decode full files on the main thread through `file.arrayBuffer()` and `AudioContext.decodeAudioData()`.
- `CacheService.saveWaveform()` stores a single raw `Float32Array` without schema, version, channel layout, or fingerprint metadata.
- No expanded timeline sample/region audio editor.
- No inline spectral view, spectral selection, or image-based spectral editing.
- No compressor, limiter, gate, de-esser, reverb, delay, LUFS normalization, de-click, hum removal, or basic non-neural noise reduction as registry-backed effects.
- No track-level pan/volume/effects/metering bus model.
- No native recording workflow in the main timeline.
- NodeGraph ports do not yet carry artifact refs, freshness state, generation actions, or semantic audio roles.

## Design Principles

1. Original media is immutable. User edits are stored as non-destructive operations; derived audio assets are created only by explicit bake/render, repair jobs, recording, or export/runtime cache requirements.
2. Every audible operation must define both live behavior and offline/export behavior before it ships.
3. Audio analysis must produce reusable project artifacts, not temporary UI-only arrays.
4. Waveform, spectrogram, loudness, transcript, beat, and onset data are signals that can feed UI, effects, node graphs, future assistants, and visual rendering.
5. Heavy decode, analysis, repair, and spectral work runs through cancellable worker, WASM, WebCodecs, FFmpeg, or Native Helper jobs. Browser Web Audio full-file decode is only a bounded fallback.
6. Timeline clips remain the primary editing surface. Detailed audio editing happens inline through expanded audio lanes and Audio Focus Mode, while audio state still has its own durable schema rather than being hidden inside generic clip effects.
7. The feature should feel like part of a media compositor, not a separate DAW bolted onto the side.

## Locked Decisions

- Audio editing is non-destructive. Clip edits are stored as `ClipAudioEditStack` operations and optional revision pointers. Users can undo, redo, bypass operations, reorder compatible operations, and bake/render when they want a concrete media asset.
- Analysis is offline/on-demand by default, with responsive previews during interaction. Long jobs expose progress, cancellation, partial artifacts, retry state, and stale/missing diagnostics.
- Clip waveform thumbnails show the processed state when practical. The UI may show immediate approximations while background jobs compute precise processed pyramids.
- Node graph spectral data exposes both representations: `spectrum` as a texture/tile artifact for visual processing and `frequencyBands` as a compact table/curve for automation, node logic, and bounded AI/custom-node context.
- Generated node or AI-node code must not receive unbounded raw audio buffers or perform arbitrary heavy audio processing. Heavy processing runs through approved built-in, worker, WASM, WebCodecs, FFmpeg, or Native Helper jobs.
- Spectral image masks and DSP-based image-to-spectrum resynthesis are in scope for the full target. Model-based generation is not required.
- Analysis artifacts should reuse the existing Signal Artifact direction where possible. If a new folder is added for derived media, it must be explicit in project constants, save/load, relink, export, and Native Helper paths.

## Target Architecture

```text
MediaFile / AudioSourceAsset
  -> AudioDecodeService
  -> AudioAnalysisService
     -> AudioAnalysisArtifact
        -> waveformPyramid
        -> processedWaveformPyramid
        -> spectrogramTileSet
        -> loudnessEnvelope
        -> beatGrid / onsetMap
        -> phaseCorrelation
        -> transcript / wordTiming
  -> SignalArtifact / Project Artifact Manifest

TimelineClip
  -> ClipAudioState
     -> sourceRevisionId
     -> editStack
     -> spectralLayers
     -> effectStack
     -> analysisRefs
  -> ClipProcessingStack
  -> TrackAudioState
  -> SendBusState
  -> MasterAudioState
  -> LiveAudioRenderer
  -> OfflineAudioRenderer
  -> ExportEncoder

Node Workspace
  -> semantic audio ports
  -> artifact-backed signal refs
  -> bounded AI/custom-node context
```

### Core Modules

| Module | Purpose |
|---|---|
| `AudioSchemaMigrationService` | Migrates legacy `clip.waveform`, `audio-volume`, `audio-eq`, old project clips, and serialized compositions into the new audio schema. |
| `AudioDecodeService` | Provides safe decode paths for small browser files, long files, video-with-audio, proxies, WebCodecs, FFmpeg, WASM, and Native Helper backends. |
| `AudioAnalysisService` | Owns waveform pyramids, spectrogram tiles, loudness envelopes, beats, onsets, phase/correlation, stale checks, job queueing, persistence, and retrieval. |
| `AudioArtifactStore` | Stores binary manifests and chunks through Signal artifacts / `Cache/artifacts`, with compatibility adapters for existing `Cache/waveforms`. |
| `AudioEffectRegistry` | Single source of truth for audio effect descriptors, params, UI metadata, live processors, offline processors, latency, tails, bypass, and automation. |
| `AudioGraphRenderer` | Shared graph builder for clip, track, send, master, live playback, offline render, waveform processing, and export. |
| `AudioAssetDerivationService` | Creates explicit derived media assets from bake/render, recording, repair, spectral edits, and export-cache operations. |
| `TimelineAudioDetailMode` | Expands audio clips/tracks inside the timeline for waveform, region, automation, markers, edit-stack, and bake/render work. |
| `AudioFocusMode` | Timeline layout mode that makes audio lanes large and precise while compacting/dimming video layers for context. |
| `InlineSpectralCanvas` | Timeline-embedded waveform/spectrogram/mel/phase surface with spectral selections, image layers, brush tools, and resynthesis preview/export. |
| `AudioInspectorPanel` | Docked side inspector for selected clip/track/master params, analysis status, artifact refs, and explicit actions. It is not the main editor surface. |
| `AudioMixerPanel` | Docked track, send, master, meter, limiter, LUFS, record-arm, and input-monitor UI for bus-level work. |
| `AudioRecordingService` | AudioWorklet-based recording into project media with recovery, waveform generation, punch-in/out, and timeline clip creation. |
| `NodeAudioSignalAdapter` | Projects audio analysis artifacts and audio graph outputs into NodeGraph/Signal IR ports and bounded AI/custom-node context. |

## Schema And Persistence Contract

This is the foundation. It must be implemented as part of the full feature, not treated as cleanup after UI work.

### Audio Analysis Artifacts

Analysis artifacts are project-addressable records with stable metadata, binary payload refs, and invalidation keys.

```ts
type AudioAnalysisArtifactKind =
  | 'waveform-pyramid'
  | 'processed-waveform-pyramid'
  | 'spectrogram-tiles'
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'phase-correlation'
  | 'transcript-timing'
  | 'frequency-summary';

interface AudioAnalysisArtifact {
  id: string;
  kind: AudioAnalysisArtifactKind;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  decoderId: string;
  decoderVersion: string;
  analyzerVersion: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  payloadRefs: SignalArtifactRef[];
  manifestRef: SignalArtifactRef;
  createdAt: number;
  stale: boolean;
  warnings?: AudioAnalysisWarning[];
}
```

### Clip Audio State

```ts
interface ClipAudioState {
  sourceAudioRevisionId?: string;
  editStack: ClipAudioEditOperation[];
  effectStack: AudioEffectInstance[];
  spectralLayers: SpectralImageLayer[];
  sourceAnalysisRefs: MediaFileAudioAnalysisRefs;
  processedAnalysisRefs: MediaFileAudioAnalysisRefs;
  bakeHistory: AudioDerivedAssetRef[];
  muted?: boolean;
  soloSafe?: boolean;
}

interface ClipAudioEditOperation {
  id: string;
  type:
    | 'trim'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'insert-silence'
    | 'delete-silence'
    | 'reverse'
    | 'invert-polarity'
    | 'swap-channels'
    | 'mono-sum'
    | 'split-stereo'
    | 'repair'
    | 'spectral-mask'
    | 'spectral-resynthesis';
  enabled: boolean;
  params: Record<string, unknown>;
  timeRange?: { start: number; end: number };
  channelMask?: number[];
  createdAt: number;
}
```

### Track And Master State

```ts
interface TrackAudioState {
  trackId: string;
  volumeDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  recordArm: boolean;
  inputMonitor: boolean;
  inputDeviceId?: string;
  effectStack: AudioEffectInstance[];
  sends: AudioSendState[];
  meterMode: 'peak' | 'rms' | 'lufs';
}

interface MasterAudioState {
  volumeDb: number;
  limiterEnabled: boolean;
  targetLufs?: number;
  truePeakCeilingDb: number;
  effectStack: AudioEffectInstance[];
  exportPreflight: AudioExportPreflightState;
}
```

### Node Port Metadata

`NodeGraphSignalType` should stay generic. `waveform`, `spectrum`, `frequencyBands`, `beats`, and similar names should be semantic port IDs backed by metadata.

```ts
interface NodeGraphPortMetadata {
  semanticKind:
    | 'audio-source'
    | 'waveform'
    | 'spectrum'
    | 'frequency-bands'
    | 'loudness'
    | 'beats'
    | 'onsets'
    | 'transcript'
    | 'audio-metadata';
  signalRefId?: string;
  artifactId?: string;
  available: boolean;
  stale: boolean;
  generateAction?: AudioAnalysisJobRequest;
  previewable: boolean;
}
```

### Storage Decision

- Large analysis payloads should use Signal artifacts / `Cache/artifacts` with binary manifests and chunk refs.
- Existing `Cache/waveforms` stays as a compatibility cache until all old project waveforms are migrated.
- Baked/rendered audio that should behave like user media is stored as a derived `MediaFile` with provenance. Add a project folder such as `Derived/audio` only if project constants, Native Helper, relink, export, cleanup, and save/load all support it.
- Project JSON stores refs and manifests, not raw waveform arrays.
- Existing `clip.waveform: number[]` remains readable for old projects but should be converted to artifact refs on save or background migration.

### History And Undo

Undo/redo must cover:

- Clip audio edit stack changes.
- Audio effect stack changes.
- Track and master audio state changes.
- Node port/artifact reference changes.
- Derived asset references.
- Analysis job completion that changes project-visible refs.

Long-running job bytes do not need to be deleted on undo immediately, but the project refs must roll back correctly. Cleanup can remove unreferenced artifacts later.

## Audio Decode And Job Runtime

Long-file safety is a core requirement.

- Do not rely on full-file `arrayBuffer()` plus `AudioContext.decodeAudioData()` for large files.
- Use a tiered decode strategy:
  - WebCodecs/demux path where codec/container support is available.
  - FFmpeg or Native Helper path for long files, video-with-audio, unsupported codecs, and chunked extraction.
  - WASM decoder path where practical.
  - Web Audio decode only for bounded small files and compatibility fallback.
- Jobs must support progress, cancellation, partial output, retry, stale detection, and cleanup.
- Every analysis artifact stores decoder identity and analyzer version so cache invalidation is deterministic.
- The runtime worker host should be reused where possible instead of creating isolated one-off workers.

## High-Resolution Clip Waveforms

The current clip waveform display should become an artifact-backed multi-resolution waveform system.

### Waveform Pyramid

```ts
interface WaveformPyramid {
  mediaFileId: string;
  sourceFingerprint: string;
  sampleRate: number;
  channels: number;
  duration: number;
  levels: WaveformLevel[];
}

interface WaveformLevel {
  samplesPerBucket: number;
  bucketDuration: number;
  channels: Array<{
    min: Float32Array;
    max: Float32Array;
    rms: Float32Array;
    peak: Float32Array;
  }>;
}
```

Required levels:

- Extreme/sample-detail zoom: 32 and 64 samples per bucket.
- Close zoom: 128 samples per bucket.
- Normal timeline zoom: 512 samples per bucket.
- Long clip zoom: 2048 samples per bucket.
- Overview/media panel: 8192+ samples per bucket.

### Rendering

- Replace bar-only thumbnails with min/max filled waveforms.
- Render stereo/multi-channel as split lanes with consistent scaling.
- Overlay RMS/loudness, fades, volume automation, clipped ranges, silence ranges, and stale-analysis warnings.
- Select LOD by pixels-per-second and visible channel height.
- Avoid per-render slicing for large arrays; use cached visible windows and idle/background rasterization.
- Support hundreds of visible waveform clips without blocking timeline interaction.
- Repeated clips from the same source reuse source artifacts while processed variants are keyed by clip audio state hash.

Current implementation checkpoint:

- `WaveformPyramidGenerator` produces source waveform artifacts with min/max/RMS/peak payloads.
- `timelineWaveformPyramidCache` generates source pyramid artifacts during waveform generation, keeps a hot in-memory display cache, and can reload artifact payloads through `AudioArtifactStore`.
- `ClipWaveform` renders through `waveformLod`, selecting a pyramid level by timeline `pixelsPerSecond` when an artifact is available.
- The timeline renders only the visible waveform window, so deep zoom avoids browser canvas-size stretching and stays sharp at high pixels-per-second.
- Timeline ruler markers, clip rendering, and thumbnail filmstrips are viewport-windowed with overscan so deep zoom does not scale DOM work with full project duration.
- `waveformLod` caps generated columns, keeps explicit `pixelsPerSecond` for pyramid choice, and bounds display normalization for invalid/out-of-range inputs.
- Visible legacy waveform clips automatically request a source waveform-pyramid upgrade in detailed/high-zoom views.
- Legacy `clip.waveform: number[]` remains a compatibility fallback and is interpolated only when the user zooms past its stored thumbnail resolution.
- New audio/video-linked waveform generation paths attach the source waveform pyramid ref to `clip.audioState.sourceAnalysisRefs.waveformPyramidId`.

### Processed Waveforms

- Source waveform pyramids are generated from decoded media.
- Processed waveform pyramids are generated from the same `AudioGraphRenderer` descriptors used by live/offline/export paths.
- During interaction, the timeline may show a fast approximate processed waveform and then swap to a precise artifact when the background job completes.
- Processed waveform artifacts are invalidated by edit stack, effect stack, speed, pitch, clip source revision, track state, and relevant bus/master processors.

## Inline Spectral Canvas

The Inline Spectral Canvas is the expanded timeline view where sound becomes an image-like signal. It supports inspection, selection, editing, image layers, and export-parity rendering without switching into a separate editor window.

### Views

| View | Purpose |
|---|---|
| Waveform | Time-domain editing, cuts, fades, zero-crossing work. |
| Spectrogram | Frequency-over-time inspection with image-like detail. |
| Mel Spectrogram | Speech/music focused perceptual view. |
| Loudness | LUFS/RMS/peak/true-peak timeline. |
| Phase/Correlation | Stereo health and mono compatibility. |

### Spectrogram Tiles

```ts
interface SpectrogramTileSet {
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  fftSize: 1024 | 2048 | 4096 | 8192;
  hopSize: number;
  window: 'hann';
  frequencyScale: 'linear' | 'log' | 'mel';
  minDb: number;
  maxDb: number;
  tileWidthFrames: number;
  tileHeightBins: number;
  tiles: SpectrogramTileRef[];
}
```

Implementation requirements:

- Deterministic Hann-window STFT with documented normalization.
- Tiled storage with storage budgets, eviction, cancellation, and progressive availability.
- GPU texture rendering for pan/zoom.
- Coordinate-accurate time/frequency selection.
- Export parity for spectral edits.

### Image-In-Spectrum Workflows

Users can drop an image onto an expanded audio clip's spectral lane. The image becomes a time/frequency layer inside the timeline.

```ts
interface SpectralImageLayer {
  id: string;
  imageMediaFileId: string;
  timeStart: number;
  duration: number;
  frequencyMin: number;
  frequencyMax: number;
  opacity: number;
  blendMode: 'attenuate' | 'boost' | 'gate' | 'sidechain-mask' | 'replace';
  gainDb: number;
  featherTime: number;
  featherFrequency: number;
  keyframes?: SpectralImageLayerKeyframe[];
}
```

Required modes:

- `attenuate`: image luminance reduces spectral energy.
- `boost`: image luminance boosts selected frequencies.
- `gate`: image alpha opens/closes a spectral gate.
- `sidechain-mask`: another audio or image signal controls frequency-dependent gating.
- `replace`: DSP-based resynthesis replaces selected spectral regions with image-derived magnitude data while preserving or synthesizing phase according to the selected mode.

Image-to-spectrum replacement is part of the full target, but it must be implemented through deterministic DSP, not model-based generation. It must support preview, undo, bypass, bake/render, and export parity.

### Spectrogram As Visual Media

Audio analysis should also create visual signals:

- Turn any audio clip into a spectrogram texture clip.
- Use spectrogram textures as inputs for WebGPU effects.
- Allow audio-reactive visuals to sample waveform, frequency bands, beats, onsets, and loudness.
- Let the Node Workspace expose `audio -> spectrogramTexture`, `audio -> beatEvents`, and `audio -> frequencyBands`.

## Timeline Audio Detail Mode

Audio clips and linked audio sections should expand directly inside the timeline. The expanded state behaves like a detailed editor surface, but it keeps the user in the same timeline, with the same playhead, snapping, selection, and track context.

### Timeline Display Modes

- **Normal Timeline Mode:** compact video/audio editing with upgraded waveform thumbnails.
- **Expanded Audio Lane:** a clip or track expands vertically to show precise waveform, stereo lanes, region selections, markers, automation, and edit-stack controls.
- **Audio Focus Mode:** video tracks remain visible as context but become compact and visually subdued; audio tracks get more height, denser rulers, and detailed waveforms/spectrograms.
- **Inline Spectral Mode:** the expanded audio lane switches from waveform to spectrogram, mel spectrogram, loudness, phase/correlation, or frequency-band views.
- **Inspector/Mixer Dock:** selected parameters and bus controls can appear in docked panels, but the primary editing gestures stay on the timeline.

### Editing Tools

- Region selection with zero-cross snap.
- Cut, copy, paste, trim, insert silence, delete silence.
- Reverse, invert polarity, swap channels, mono sum, split stereo to mono.
- Seamless loop tool with crossfade preview.
- Region markers and named analysis markers.
- Per-channel selection.
- Spectral selection directly in the inline spectral lane.
- Edit stack inspector with enable/bypass, reorder, duplicate, delete, and bake/render.

### Non-Destructive Asset Flow

```text
Original RAW/audio.wav
  -> ClipAudioEditStack
     -> operation: trim/silence/reverse/repair/spectral-mask/spectral-resynthesis
     -> operation: bypassable/reorderable where compatible
     -> LiveAudioRenderer + OfflineAudioRenderer

Explicit bake/render:
  -> Derived audio MediaFile
  -> provenance recorded in project.json
  -> optional clip revision points to derived asset
```

Undo/redo changes the edit stack or clip revision. Bypass disables operations without deleting them. The original file is never modified.

## First-Class Audio Effects

Move current audio effects into a real registry and make it the single source of truth for UI, defaults, live playback, offline render, automation, export, and project migration.

```ts
interface AudioEffectDescriptor {
  id: string;
  name: string;
  category: 'gain' | 'eq' | 'dynamics' | 'space' | 'repair' | 'time' | 'analysis' | 'utility' | 'spectral';
  params: AudioEffectParam[];
  automation: 'none' | 'clip' | 'track' | 'sample-accurate';
  latencySamples: number;
  tailSeconds: number;
  channelBehavior: 'mono' | 'stereo' | 'multi-channel' | 'preserve';
  liveProcessor: LiveAudioProcessorFactory;
  offlineProcessor: OfflineAudioProcessorFactory;
  waveformProcessor?: OfflineAudioProcessorFactory;
  exportPreflight?: AudioEffectPreflightRule[];
}
```

Required processors:

- Volume/gain.
- Pan.
- 10-band EQ migrated from current implementation.
- Parametric EQ.
- Compressor.
- Hard limiter.
- Gate/expander.
- Peak/RMS/LUFS normalize.
- De-esser.
- Delay.
- Reverb.
- Distortion/saturation.
- Hum notch.
- De-click.
- Edit repair / splice smoothing.
- Basic non-neural noise reduction.
- Spectral gate.
- Spectral brush/mask.
- Image-to-spectrum processor.
- Utility processors: polarity invert, mono sum, channel swap, stereo split, phase/correlation meter.

Migration requirements:

- Existing `audio-volume` and `audio-eq` projects load identically.
- Opening the Volume tab must not dirty history just by creating missing effects. Use migration or lazy defaults instead.
- Live and offline outputs must match within defined tolerances.
- Effects with tails and latency must participate in export scheduling and waveform processing.

## Mixer, Bus, And Recording

Add a real audio bus system:

```text
Clip Processing Stack
  -> Track Bus
  -> Optional Send Bus
  -> Master Bus
  -> Output
```

Timeline track headers should expose compact controls for volume, pan, mute, solo, record arm, input monitor, and meters. Full bus work should be available in a docked Mixer view and in expanded timeline track controls, so users can stay timeline-first while still getting track FX stacks, sends, master controls, limiter, LUFS meter, true-peak warnings, and export preflight.

Recording requirements:

- Use `AudioWorklet` for low-latency capture when available.
- Avoid deprecated `ScriptProcessorNode` for new code except as an explicit fallback.
- Record into project media storage with recovery metadata.
- Create timeline clips on armed tracks.
- Generate source waveform/loudness artifacts after stop.
- Support punch-in/punch-out, cancel, no-input-device errors, permission failure, and input monitoring latency warnings.

## Repair And Assisted Workflows

These workflows are part of the full target and should use deterministic DSP and analysis first.

- Silence detection and silence removal.
- Hum detection and hum notch.
- De-click and splice smoothing.
- LUFS/peak/RMS analysis and match loudness.
- Beat, onset, and transient analysis.
- Transcript-aware selection only where transcripts already exist.
- Reduce filler words by transcript selection when transcript data already exists.
- Generate or loop room tone from nearby silence using DSP.
- Suggest EQ/compressor settings from measured loudness and spectral balance.
- Auto-detect hum frequency and apply notch.

Model-based features are not implemented here. If they return later, they must run through approved worker/WASM/native jobs and return derived assets or analysis artifacts instead of mutating timeline state directly.

## Node Workspace And AI/Custom Node Audio Context

Audio analysis and processing must become first-class Node Workspace signals, not side data hidden inside the timeline.

### Semantic Audio Ports

Audio-capable source nodes should expose semantic ports backed by existing generic signal types:

| Port | Type | Purpose |
|---|---|---|
| `audio` | `audio` | Time-domain audio signal for playback/export processing. |
| `waveform` | `curve` | Multi-resolution amplitude/min/max/RMS artifact. |
| `loudness` | `curve` | RMS, peak, LUFS, and true-peak analysis over time. |
| `spectrum` | `texture` | Spectrogram texture or tile set for visual/audio processing. |
| `frequencyBands` | `table` | Downsampled bands for node context, effects, and audio-reactive visuals. |
| `beats` | `event` | Beat grid, downbeats, tempo changes, and confidence values. |
| `onsets` | `event` | Transient/onset events for cuts, sync, and reactive effects. |
| `transcript` | `text` | Transcript and word timings where available. |
| `audioMetadata` | `metadata` | Sample rate, channels, codec, duration, analysis refs, and warnings. |

The graph should show an audio/spectral lane whenever source audio exists, even before audio effects are added. Missing analysis artifacts should appear as generate/refresh actions in the node inspector.

### Bounded Audio Context

```ts
interface AINodeAudioContext {
  source: {
    mediaFileId: string;
    clipId: string;
    linkedClipId?: string;
    duration: number;
    inPoint: number;
    outPoint: number;
    sampleRate?: number;
    channels?: number;
    codec?: string;
  };
  analysis: {
    waveformSummary?: WaveformSummary;
    loudnessSummary?: LoudnessSummary;
    spectralSummary?: SpectralSummary;
    beatSummary?: BeatSummary;
    transcriptSummary?: TranscriptSummary;
  };
  artifacts: {
    waveformPyramidId?: string;
    spectrogramTileSetIds?: string[];
    loudnessEnvelopeId?: string;
    beatGridId?: string;
    onsetMapId?: string;
    transcriptId?: string;
  };
  graph: {
    audioLaneNodes: string[];
    connectedAudioPorts: string[];
    availableSignalPorts: string[];
  };
}
```

Runtime rules:

- AI/custom nodes may produce effect settings, new analysis assets, masks, event curves, or generated code.
- AI/custom nodes must not mutate original media.
- Creating derived audio assets is allowed only through explicit user-run bake/render/repair jobs.
- Any node that changes audible output must define live and offline/export behavior.
- Heavy audio jobs run as approved worker/WASM/WebCodecs/FFmpeg/Native Helper jobs and return artifacts to the graph.
- Generated AI node code receives bounded data windows, summaries, and artifact refs, not full unbounded audio buffers.

## Export Requirements

Every audio feature must define export behavior before it ships.

Rules:

- Live and offline renderers must produce equivalent output within a defined tolerance.
- Effects with tails, such as reverb and delay, must report `tailSeconds`.
- Effects with latency must report `latencySamples`.
- Export scheduling must account for latency compensation, tails, sends, master limiter, nested composition mixdowns, and in/out range boundaries.
- Derived assets export as normal source media.
- Spectral edits and image-to-spectrum resynthesis render into audio before final muxing.
- Audio-only WAV export must keep working without WebCodecs audio encoding.
- Browser-compressed audio remains support-gated because AAC support varies by browser/platform.

Current checkpoint:

- `ClipAudioRenderService` is now the shared offline clip renderer for trim, reverse, speed/pitch, mute, and clip EQ/volume stacks.
- `ProcessedWaveformPyramidService` and `AudioExportPipeline` both call that shared renderer, so processed timeline waveforms and exported audio no longer use separate effect/speed paths for clip-local audio behavior.

## Multi-Agent Implementation Model

This feature is large enough to benefit from parallel agents, but only if each agent has a clear ownership boundary. Agents should work in parallel on disjoint file sets and merge at explicit contract checkpoints. Central schema, project save/load, timeline serialization, history, and node projection files need single ownership per wave.

### Coordination Rules

- Each agent owns a narrow workstream and a declared file set.
- Agents may read across the repo, but must not edit files owned by another active agent.
- Shared contract changes land before feature work that depends on them.
- Runtime behavior should stay backward-compatible until the relevant migration and tests land.
- Large audio bytes must not be stored in React/Zustand history snapshots or project JSON.
- Any workstream that changes persisted shape must include save/load and old-project compatibility tests.
- Any workstream that changes audible output must include live/offline/export equivalence tests.
- Any UI workstream must be behind feature flags until the schema and artifact contracts are stable.

### High-Conflict Files

These files should have one active owner at a time:

- `src/types/index.ts`
- `src/types/nodeGraph.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/services/project/types/*.ts`
- `src/stores/timeline/serializationUtils.ts`
- `src/stores/historyStore.ts`
- `src/hooks/useGlobalHistory.ts`
- `src/services/nodeGraph/clipGraphProjection.ts`
- `src/components/panels/properties/VolumeTab.tsx`
- `src/engine/audio/AudioEffectRenderer.ts`
- `src/services/audioRoutingManager.ts`

### Agent Task Contract

Every implementation agent should receive:

- **Objective:** the concrete feature slice to implement.
- **Owned files:** files the agent may edit.
- **Read-only context:** files the agent should inspect but not change.
- **Do not touch:** conflict files owned by another agent in the same wave.
- **Tests:** exact tests to add or run.
- **Handoff:** summary of changed files, behavior, risks, and follow-up blockers.

### Parallel Waves

The waves below are dependency gates, not MVP phases. Each wave should be integrated with tests before opening the next wave broadly.

| Wave | Parallel Agents | Can Run In Parallel | Integration Gate |
|---|---|---|---|
| 1 | Contract foundations | Schema/types, audio artifact facade, audio effect registry skeleton, feature flags/node metadata | Typecheck, focused unit tests, no runtime behavior change |
| 2 | Persistence/runtime foundations | Project serialization migration, history capture, decode-safe job runtime, artifact manifest tests | Old projects round-trip, artifact refs persist, worker jobs cancel/progress |
| 3 | Core audio behavior | AudioGraphRenderer, waveform pyramid generation, processed waveform invalidation, EQ/volume registry migration | Live/offline/export equivalence for legacy audio behavior |
| 4 | Timeline UI surfaces | Timeline audio detail mode, waveform renderer, Audio Focus Mode, mixer controls, node lane display | Screenshot/UI tests, no regressions in normal timeline mode |
| 5 | Spectral and repair workflows | Inline spectral canvas, image-in-spectrum layers, repair operations, recording, node audio analysis templates | Export parity, undo/redo, job cancellation, performance checks |
| 6 | Hardening | Cross-feature QA, docs, issue checklist, dev-bridge diagnostics, full regression suite | Build, lint, tests, targeted browser verification |

### Wave 1 Agent Ownership

These are the safest first parallel implementation slices.

| Agent | Owns | Must Avoid | Output |
|---|---|---|---|
| Schema Agent | `src/types/audio.ts`, exports from `src/types/index.ts`, optional audio fields in project/timeline/media type files | Runtime behavior, project save/load logic | JSON-safe audio schema types and compile-only compatibility |
| Artifact Agent | `src/services/audio/audioArtifactTypes.ts`, `src/services/audio/AudioArtifactStore.ts`, `src/services/audio/waveformPyramidManifest.ts`, audio artifact tests | New storage backend, timeline UI | Typed facade over Signal artifacts and manifest/payload tests |
| Effect Registry Agent | `src/engine/audio/AudioEffectRegistry.ts`, `src/engine/audio/index.ts`, registry tests | Rewriting `AudioEffectRenderer` or `audioRoutingManager` | Descriptor-only registry preserving `audio-volume` and `audio-eq` ids/defaults |
| Node/Flags Agent | `src/engine/featureFlags.ts`, `src/types/nodeGraph.ts`, focused Signal/Node contract tests | Clip projection runtime unless assigned in a later wave | Dormant flags and optional `NodeGraphPortMetadata` |

### Wave 2 Agent Ownership

Wave 2 starts after Wave 1 contracts pass typecheck.

| Agent | Owns | Must Avoid | Output |
|---|---|---|---|
| Project Migration Agent | `projectSave.ts`, `projectLoad.ts`, project type adapters, serialization tests | Artifact byte storage internals | Optional audio state persists without dropping legacy fields |
| History Agent | `historyStore.ts`, `useGlobalHistory.ts`, history tests | Timeline UI | Signal/audio artifact refs are captured without storing large bytes |
| Decode Runtime Agent | `AudioDecodeService`, worker job contracts, decode tests | Timeline rendering | Safe decode/job path with cancellation/progress and bounded browser fallback |
| Artifact Manifest Agent | waveform/spectrogram/loudness manifest helpers and tests | UI and export | Versioned binary manifest formats and stale-key helpers |

### Wave 3 Agent Ownership

Wave 3 starts after persistence and runtime contracts are stable.

| Agent | Owns | Must Avoid | Output |
|---|---|---|---|
| AudioGraph Agent | `AudioGraphRenderer`, graph descriptor types, export scheduling tests | Timeline UI | Shared clip/track/master descriptors for live/offline/export |
| Legacy Effects Agent | `AudioEffectRenderer`, `audioRoutingManager`, `VolumeTab`, EQ/volume tests | New effects beyond assigned scope | Registry-backed legacy EQ/volume behavior with no old-project regression |
| Waveform Analysis Agent | waveform pyramid generation, analysis job tests | ClipWaveform UI | Source waveform/loudness artifacts and cache invalidation |
| Processed Waveform Agent | processed waveform invalidation and graph-backed render tests | Spectral UI | Processed waveform artifacts keyed by clip audio state |

### Wave 4 Agent Ownership

Wave 4 can split UI once data contracts are stable.

| Agent | Owns | Must Avoid | Output |
|---|---|---|---|
| Timeline Detail Agent | expanded audio lanes, region selection UI, focus mode shell | Audio DSP internals | Timeline-first editing surface behind flags |
| Waveform UI Agent | `ClipWaveform` LOD renderer, diagnostics overlays, screenshot tests | Analysis generation internals | Artifact-backed waveform display |
| Mixer UI Agent | track controls, docked Mixer/Inspector UI, meter shell | Recording backend unless assigned | Track/master controls behind flags |
| Node Audio UI Agent | node audio lane projection, port badges, generate/refresh actions | AI prompt changes unless assigned | Audio lanes appear from source audio with artifact status |

### Wave 5 Agent Ownership

Wave 5 implements advanced workflows on top of stable timeline/audio contracts.

| Agent | Owns | Must Avoid | Output |
|---|---|---|---|
| Inline Spectral Agent | timeline spectral view, tiled render UI, time/frequency selection | Resynthesis DSP unless assigned | Spectrogram editing surface inside expanded timeline lanes |
| Image Spectrum Agent | spectral image layers, keyframes, mask/resynthesis DSP | General node runtime | Image-to-spectrum workflows with preview/export parity |
| Repair Agent | silence, hum, de-click, splice smoothing, loudness matching | Model-based audio features | Non-model repair operations through edit stack |
| Recording Agent | `AudioRecordingService`, device/error/recovery tests | Mixer UI unless assigned | Timeline recording, punch-in/out, waveform generation |
| AI/Custom Context Agent | bounded audio summaries in AI/custom-node context | Raw audio buffers | Audio-aware prompts/artifact refs without model-based editing |

### Merge Checkpoints

- **Checkpoint 1:** Wave 1 compiles and focused tests pass. No user-visible behavior should change except flags existing.
- **Checkpoint 2:** Old projects round-trip with legacy waveform/effects and new optional audio fields.
- **Checkpoint 3:** Legacy `audio-volume` and `audio-eq` produce equivalent live/offline/export behavior through the registry path.
- **Checkpoint 4:** Timeline can render artifact-backed source waveforms while legacy `clip.waveform` still works.
- **Checkpoint 5:** Expanded timeline lanes can be enabled without breaking normal video timeline editing.
- **Checkpoint 6:** Spectral, repair, recording, mixer, and node features all pass undo/save/load/export checks.

## Full Implementation Tracks

These tracks are not MVP phases. They are the dependency order for integrating the complete feature without corrupting project state, export parity, or history. The tracks map to the multi-agent waves above: each track can be split into agent-owned slices once its upstream contracts are in place.

### Track A: Schema, Storage, Migration, And History

- Add `AudioAnalysisArtifact`, `AudioDerivedAsset`, `ClipAudioState`, `TrackAudioState`, `MasterAudioState`, job state, and Node port metadata.
- Decide and implement derived audio storage with project constants, Native Helper/FSA support, relink, export, cleanup, and save/load.
- Reuse Signal artifacts / `Cache/artifacts` for large analysis payloads.
- Keep `Cache/waveforms` and `clip.waveform` as backward-compatible legacy inputs.
- Migrate `audio-volume` and `audio-eq` into registry-backed instances while preserving old project behavior.
- Extend history subscriptions or explicit captures for signal assets/artifacts, audio artifacts, track audio state, master audio state, and job completion refs.

### Track B: Decode-Safe Analysis Runtime

- Implement `AudioDecodeService`.
- Implement analysis job queueing, cancellation, progress, partial artifacts, stale checks, retries, and cleanup.
- Define binary manifest formats for waveform, spectrogram, loudness, beat/onset, and phase/correlation data.
- Add source fingerprinting, decoder versioning, analyzer versioning, and clip audio state hashing.

Current checkpoint:

- `AudioDecodeService` has cancellable runtime probing, terminal-state progress guards, bounded progress, stricter `AudioBuffer` validation, decoded PCM output limits, deterministic metadata cloning, and explicit failure codes for failed runtime probes and oversized decode output.

### Track C: AudioEffectRegistry And AudioGraphRenderer

- Build the registry descriptor model.
- Migrate current EQ/volume with equivalence tests.
- Add the full required processor set.
- Build shared live/offline/export graph descriptors.
- Add tail/latency scheduling and waveform-processing hooks.

Current checkpoint:

- `AudioEffectRegistry` describes `audio-volume` and `audio-eq` defaults/params.
- `AudioEffectRenderer` consumes registry defaults, skips disabled effects, and can render new `AudioEffectInstance` stacks through the legacy-compatible offline path.
- `AudioGraphRenderer` projects clip, track, and master effect chains into deterministic JSON-safe graph plans and includes legacy `clip.effects` audio EQ/volume entries for old/current clips without duplicating explicit `audioState.effectStack` entries.

### Track D: Waveform Pyramid And Timeline Rendering

- Generate source waveform pyramids and loudness artifacts.
- Generate processed waveform pyramids from `AudioGraphRenderer`.
- Upgrade `ClipWaveform` to artifact-backed LOD rendering.
- Add stereo/multi-channel rendering, fades, automation, clipping/silence diagnostics, and stale indicators.
- Validate long files, repeated clips, deep zoom, and hundreds of visible clips.

Current checkpoint:

- `audioAnalysisIdentity` creates deterministic processed-audio state hashes from clip timing/playback, source revision, enabled edit/effect/spectral stacks, and optional track/master graph identities while excluding payload-shaped fields.
- `WaveformPyramidGenerator` can now persist both source `waveform-pyramid` and processed `processed-waveform-pyramid` artifacts with distinct cache keys and compact project refs.
- Timeline clip edits that affect audio output clear only `audioState.processedAnalysisRefs`; `sourceAnalysisRefs` stay reusable for fallback display and future regeneration.
- `ProcessedWaveformPyramidService` renders trimmed clip audio through speed/reverse, mute, and clip EQ/volume stacks, writes processed waveform pyramid artifacts, primes the timeline cache, and keys results with legacy audio effects included in the clip audio-state identity.
- `ClipAudioRenderService` owns clip-local offline audio rendering and is shared by processed waveform generation and export.
- The timeline store exposes `generateProcessedWaveformForClip`; audio effect and speed edits invalidate stale processed refs, and visible audio clips schedule processed waveform jobs when their clip audio path needs one.
- `TimelineClip` now loads source and processed waveform pyramids independently, prefers a loaded processed artifact, and falls back to the source pyramid while processed artifacts are loading, missing, or stale.
- `ClipWaveform` remains a pure renderer and receives a `waveformVariant` hint for source/processed/legacy styling.

### Track E: Timeline Audio Detail Mode

- Build expanded audio clip/track surfaces inside the timeline.
- Add Audio Focus Mode that compacts/dims video context and gives audio lanes precise editing height.
- Add region selection, zero-cross snap, cut/copy/paste/trim/silence/reverse/invert/channel tools.
- Add edit stack inspector in the selected clip Properties panel, bypass/reorder, markers, and explicit bake/render.
- Integrate undo/redo, save/load, and export parity.

Current checkpoint:

- `audioFocusMode` is a timeline/project UI state. It compacts and subdues video tracks while expanding audio lanes inside the existing timeline.
- The View menu exposes Audio Focus alongside compact/detailed/spectral audio modes; no separate audio editor window is introduced.
- Audio clips in focus mode support direct inline region selection on the waveform area, with timeline/source range state and a waveform-valley snap fallback for zero-cross-safe edits.
- Region selections can now create non-destructive clip edit-stack operations for silence, insert silence, delete silence, paste, reverse, invert polarity, swap channels, and mono sum.
- Region copy/paste is stored as bounded timeline audio clipboard metadata; paste creates an edit-stack operation instead of mutating the source media.
- Audio edit-stack operations invalidate only processed analysis refs, keep source waveform refs reusable, can be bypassed, removed, cleared, or baked inline, and are blocked on locked tracks or during export.
- The selected clip Properties panel exposes an `Audio Edits` tab with the full stack, operation metadata, bypass/remove, clear, bake, and bake history.
- `ClipAudioRenderService` renders enabled edit-stack operations before clip reverse, speed/pitch, mute, and effects; processed waveforms and exports share that same path.
- Baking active audio edits renders the edit stack into a new WAV media source, resets the clip edit stack, writes source waveform refs for the baked media, and records bake provenance in `audioState.bakeHistory`.

### Track F: Inline Spectral Canvas And Image-In-Spectrum

- Generate and render tiled spectrogram/mel/phase artifacts inside expanded timeline lanes.
- Add time/frequency selection, spectral brush, and layer editing.
- Add image layers with attenuate, boost, gate, sidechain-mask, and replace/resynthesis modes.
- Add keyframes for spectral image layers.
- Integrate preview, bypass, bake/render, Node outputs, and export parity.

### Track G: Mixer, Bus, And Recording

- Add `TrackAudioState`, send buses, and `MasterAudioState` to timeline/project state.
- Add compact track controls, expanded timeline track controls, and docked Mixer view.
- Add meters, limiter, LUFS/true-peak monitoring, record arm, input monitor, and track/master FX stacks.
- Add `AudioRecordingService`, recording recovery, punch-in/out, and waveform generation.

### Track H: Node Workspace And Signal IR Integration

- Add semantic audio port metadata and artifact-backed refs.
- Show audio/spectral lanes whenever source audio exists.
- Add analysis nodes for waveform, spectrum, loudness, beat, onset, transcript, and metadata.
- Let visual effects sample audio textures and analysis tables.
- Let image clips drive spectral masks.
- Extend bounded AI/custom-node context with audio summaries and artifact refs.
- Enforce runtime boundaries so generated code cannot process unbounded raw audio.

Current checkpoint:

- Source nodes expose waveform, spectrum, loudness, beats, onsets, phase/correlation, transcript timing, and frequency summary ports with artifact metadata and generate actions.
- Processed analysis refs win over source refs for effective Node/AI context, spectrum refs are bounded, and runtime/generated AI context exposes artifact refs plus bounded waveform summaries without raw audio buffers.

### Track I: Repair And Assisted Workflows

- Implement silence removal, hum notch, de-click, splice smoothing, loudness matching, beat/onset/transient tools, room tone DSP, and rule-based settings suggestions.
- Route every repair through the non-destructive edit stack and explicit derived asset path.
- Add cancellation, preview, before/after comparison, and export parity.

### Track J: Documentation, Feature Flags, And Verification

- Add feature flags for `advancedAudio`, `timelineAudioDetailMode`, `inlineSpectralCanvas`, `audioFocusMode`, `waveformPyramid`, `audioEffectRegistry`, and `audioMixer`.
- Update `docs/Features/Audio.md`, `Timeline.md`, `Project-Persistence.md`, `Node-Workspace.md`, and `Signal-IR.md`.
- Add a dedicated `docs/Features/Audio-Workstation.md` after implementation starts.
- Keep old project compatibility documented.
- Build automated and screenshot checks before enabling the full feature by default.

## Verification Matrix

| Area | Required Checks |
|---|---|
| Schema/migration | Old projects with `clip.waveform`, `audio-volume`, `audio-eq`, linked audio, nested compositions, and serialized non-active compositions load and resave correctly. |
| History | Undo/redo for edit stacks, analysis refs, derived media refs, signal artifacts, track audio state, master state, and job completion refs. |
| Decode runtime | Small audio, large audio, long video-with-audio, unsupported codec fallback, cancellation, progress, and memory ceilings. |
| Waveform pyramid | Unit tests for min/max/RMS/peak, multi-channel data, cache invalidation, long-file LOD choice, binary manifests, and processed/source variants. |
| Clip waveform UI | Screenshot checks at zoom levels, stereo clips, fades, automation, diagnostics, repeated clips, and hundreds of visible clips. |
| Audio effects | Live/offline/export equivalence, automation, bypass, latency/tail, old EQ/volume migration, and inspector/default behavior without dirtying history. |
| Timeline audio detail mode | Expanded-lane region operations, zero-cross snap, edit stack reorder/bypass, bake/render, undo/redo, project reload, focus mode, and original file immutability. |
| Spectrogram | Deterministic tile generation, zoom/pan rendering, coordinate accuracy, storage budget, cancellation, and stale indicators. |
| Spectral image layers | Mask placement, keyframes, blend modes, replace/resynthesis, preview/export parity, invalid image handling, and undo/bypass. |
| Mixer/recording | Track volume/pan/mute/solo, sends, master limiter, meters, no input device, permission failure, stop/cancel, recovery, and waveform generation. |
| Repair workflows | Before/after preview, non-destructive operation creation, cancellation, fallback path, no UI freeze, and export parity. |
| Node integration | Audio lanes appear from source audio, artifact-backed ports resolve, stale warnings appear, generated nodes stay bounded, and visual nodes can sample audio artifacts. |
| Export | WAV, browser audio, FFmpeg/raw audio, video-with-audio, nested composition audio, in/out ranges, tails, latency, sends, master limiter, and spectral edits. |

## Resolved Planning Choices

- The main timeline is the primary audio editing surface. Compact controls live in normal timeline mode; expanded audio lanes and Audio Focus Mode provide detailed editing without opening a separate editor window.
- A docked Mixer/Inspector view supports full bus, send, meter, limiter, and track FX workflows, but it does not replace timeline-based editing.
- Analysis payloads should use artifact manifests and binary chunks. Raw JSON arrays are only legacy compatibility.
- Spectral image masks and replace/resynthesis should be keyframable in the full target.
- Source waveform/loudness can auto-generate when safe. Heavy spectrogram, beat/onset, and processed waveform jobs are on-demand or triggered by workflows, with background prefetch when an expanded timeline lane, inspector, mixer, or node needs them.
- Processed waveform display uses immediate approximation plus precise background artifacts.
- Node integration is not a late add-on. Schema and port metadata are designed up front so waveform/spectral artifacts are usable by the timeline, inline spectral lanes, export, and Node Workspace from the same contract.
