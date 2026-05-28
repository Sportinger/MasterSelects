# Stem Separation Clip Layer Plan

## Context

MasterSelects already has the browser-side pieces needed for model-based stem separation:

- `onnxruntime-web` is installed directly.
- SAM2 already runs ONNX inference in a Web Worker with WebGPU and WASM fallback.
- SAM2 already downloads large ONNX model files into OPFS.
- Audio analysis artifacts, clip audio state, processed waveform refs, cancellable audio jobs, and export-parity rendering already exist.

The stem separation feature should therefore reuse the existing MS patterns instead of becoming a separate tool. The desired product result is:

1. User right-clicks an audio-capable clip.
2. User chooses `Stem Separation`.
3. MS runs browser-only separation through ONNX/WebGPU when possible.
4. Separated stems appear as a small collapsible `Audio Layers` row directly under the clip.
5. Opening that dropdown reveals `Mix`, `Vocals`, `Drums`, `Bass`, and `Other`.
6. Clicking a stem in that dropdown solos that stem against the other stems.

This plan targets a non-native-helper implementation first. Native Helper/server acceleration can be added later as a fallback or pro path, but the baseline must work directly from the MS website.

Important codebase correction: the current timeline does not already have this exact clip layer/keyframe dropdown. Keyframe UI is track-expanded and selected-clip scoped. The implementation must generalize the current keyframe-expanded row system into a selected-clip detail area that can host a new compact dropdown row directly under the clip, and it must render even when a clip has stems but no keyframes.

## Product Decision

The primary UX is embedded stem layers on the original clip, not auto-created separate timeline tracks.

Separate tracks are useful for later export workflows, but they are too noisy as the default. The first-class MS behavior should feel like opening the audio layer stack of a clip:

- Original clip stays in place.
- Stems are stored as clip-local audio layers.
- The clip remains a single timeline object.
- Stem solo/mute/mix happens inside the clip-local `Audio Layers` dropdown under the clip.
- Export and preview use the same stem-mix state.

For video clips, stem state must live on the actual audible linked audio clip. A context-menu action on a video clip should resolve to its linked audio clip and optionally mirror progress/status on the video row. Do not store audible stem state only on a video clip, because the existing audio preview/export paths expect audio-owned clips.

## MVP Boundaries

The MVP is browser-only and clip-local.

In scope:

- Lazy model download from static model URLs.
- OPFS model cache.
- Worker-side ONNX inference through `onnxruntime-web`.
- WebGPU preference with WASM fallback.
- Four-stem clip layers for `Mix`, `Vocals`, `Drums`, `Bass`, and `Other`.
- Stem-local solo from a compact dropdown row under the selected clip.
- Preview and export parity for the selected stem mix.
- Project persistence through artifact refs, not embedded audio arrays.

Out of scope for MVP:

- Native Helper execution.
- Uploading source audio to a server.
- Auto-creating separate timeline tracks by default.
- SCNet as the default model.
- Region-only stem replacement.
- Per-stem waveform generation.
- Batch separating many clips.

## Target User Flow

### Entry Point

Add a right-click context menu action for audio-capable clips:

```text
Stem Separation...
```

Eligibility:

- Audio clips.
- Video clips with linked/source audio.
- Composition clips with resolvable audio mixdown, later phase.

Disabled state copy:

```text
Stem Separation requires source audio
```

### Separation Dialog

The first version can be compact:

- Model:
  - `Demucs HTDemucs Web` default, 4 stems, about 180.5 MB model.
  - `BS PolarFormer FP16` later, vocals/instrumental, about 108 MB model.
  - `SCNet XL IHF Experimental` later, after ONNX export validation.
- Range:
  - Whole clip.
  - Current audio region selection, if present.
- Stems:
  - Vocals.
  - Drums.
  - Bass.
  - Other.
- Output:
  - `Clip stem layers` default.
  - `Also create audio tracks` later optional.
- Cache:
  - Show cached/download status.
  - First use shows exact model download size.
- Action:
  - `Separate`.
  - `Cancel`.

No upload wording. This is local browser processing.

### Current Model Notes

As of 2026-05-28, the practical browser-first candidates are:

- `timcsy/demucs-web-onnx`: one `htdemucs_embedded.onnx` file, about 181 MB on Hugging Face. This stays the MVP default because the existing `demucs-web` project proves a browser integration path.
- `StemSplitio/htdemucs-onnx`: newer single-file HT-Demucs ONNX export, 316 MB fp32 or 166 MB fp16-stored weights, with documented browser `onnxruntime-web` usage and `[drums, bass, other, vocals]` output. Treat as an immediate evaluation candidate, not the first integration target.
- `bgkb/bs_polarformer`: vocals/instrumental ONNX model family, 211 MB fp32/WebGPU and 108 MB fp16/WebGPU files. Useful for a smaller voice-isolation mode after the 4-stem MVP.
- `ZFTurbo/Music-Source-Separation-Training` SCNet XL/IHF weights: strong PyTorch-side model family, but not a drop-in browser model. It remains an experimental spike until ONNX export, parity, WebGPU runtime, and memory behavior are proven.

Model catalog entries should include source URL, license/attribution note, expected byte size, output stem order, input sample rate, segment length, and backend compatibility.

### Progress

Show two progress phases:

1. Model download/cache:
   - `Downloading stem model 43 MB / 180 MB`
   - `Cached for future use`
2. Separation:
   - `Separating 3 / 12 chunks`
   - `WebGPU` or `WASM` backend badge
   - Cancel button

Progress should be visible in the selected-clip detail lane and in any modal/dialog that started the job.

### Result UI

When complete, the clip gains a small collapsed `Audio Layers` row directly under the clip. This row is the visible affordance for stems and should read as part of the clip, not as a separate track.

Collapsed example:

```text
[audio clip]
  Audio Layers  Mix
```

Expanded example:

```text
[audio clip]
  Audio Layers v
    Mix
    Vocals
    Drums
    Bass
    Other
```

If keyframe rows are also visible, they remain below the stem dropdown:

```text
[audio clip]
  Audio Layers v
    Mix
    Vocals
    Drums
    Bass
    Other

  Keyframes
    Volume
    EQ
    Speed
```

Click behavior:

- Clicking `Audio Layers` toggles the dropdown open/closed.
- Clicking `Vocals` solos vocals among the clip's stems.
- Clicking `Drums` solos drums among the clip's stems.
- Clicking `Mix` clears stem solo and plays the current stem mix.
- Re-clicking the active solo row clears solo and returns to `Mix`.

This is stem-local solo. It must not toggle timeline track solo.

Optional later row controls:

- Eye/speaker icon for enable/mute.
- Small gain control.
- `Extract to Track`.
- `Delete Stem Cache`.

## Implementation Scope

### Phase 0: Codebase Anchors

Use these existing pieces as templates or integration points:

- SAM2 worker:
  - `src/services/sam2/sam2Worker.ts`
  - ONNX import, `InferenceSession`, WebGPU/WASM fallback.
- SAM2 model cache:
  - `src/services/sam2/SAM2ModelManager.ts`
  - OPFS model file download, size validation, persistent storage request.
- SAM2 service:
  - `src/services/sam2/SAM2Service.ts`
  - worker lifecycle, HMR-safe singleton, status propagation.
- Audio artifacts:
  - `src/services/audio/AudioArtifactStore.ts`
  - manifest and payload refs.
- Audio jobs:
  - `src/services/audio/ClipAudioAnalysisJobService.ts`
  - cancellable queued background jobs.
- Audio render/export parity:
  - `src/services/audio/ClipAudioRenderService.ts`
  - all audible clip transforms must go through this path.
- Live preview audio:
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`
  - `src/services/layerBuilder/AudioSyncHandler.ts`
  - this path currently syncs live audio separately from offline render/export.
- Timeline context menu:
  - `src/components/timeline/TimelineContextMenu.tsx`
  - add the right-click entry.
- Timeline selected-clip detail rows:
  - `src/components/timeline/Timeline.tsx`
  - `src/components/timeline/TimelineHeader.tsx`
  - `src/components/timeline/TimelineTrack.tsx`
  - `src/stores/timeline/keyframeSlice.ts`
  - `src/stores/timeline/constants.ts`
  - current height and expansion logic is keyframe-specific and must be generalized.
- Audio edit and spectral layer patterns:
  - `src/stores/timeline/audioEditSlice.ts`
  - existing clip-local audio state mutation and processed-analysis invalidation.
- Project audio persistence:
  - `src/services/audio/projectAudioState.ts`
  - `src/services/project/projectSave.ts`
  - stem artifact refs must be indexed so saved projects can restore them.
- Feature flags:
  - `src/engine/featureFlags.ts`
  - existing flags are runtime-toggled through `window.__ENGINE_FLAGS__`.

Implementation should avoid editing unrelated current work in `Timeline.tsx` or `TimelineTracks.css` unless the stem UI requires it. Those files may already contain unrelated local changes in the working tree.

### Phase 1: Stem Data Contracts

Extend audio types:

```ts
export type AudioStemKind =
  | 'mix'
  | 'vocals'
  | 'drums'
  | 'bass'
  | 'other'
  | 'instrumental'
  | 'dialogue'
  | 'music'
  | 'sfx';
```

Add stem artifact kind:

```ts
export type AudioAnalysisArtifactKind =
  | ExistingKinds
  | 'stem-separation';
```

Add clip-local state:

```ts
export interface ClipAudioStemLayer {
  id: string;
  kind: AudioStemKind;
  label: string;
  analysisArtifactId: string;
  manifestArtifactId: string;
  payloadRef: AudioSignalArtifactRef;
  enabled: boolean;
  gainDb: number;
  phaseAligned: boolean;
  modelId: string;
  sourceFingerprint: string;
}

export interface ClipAudioStemState {
  activeSetId: string;
  modelId: string;
  modelVersion: string;
  createdAt: number;
  sourceFingerprint: string;
  range: { start: number; end: number };
  sampleRate: number;
  channelCount: number;
  stems: ClipAudioStemLayer[];
  soloStemId?: string;
  mixMode: 'original' | 'stems' | 'hybrid';
}
```

Extend `ClipAudioState`:

```ts
export interface ClipAudioState {
  // existing fields...
  stemSeparation?: ClipAudioStemState;
}
```

State semantics:

- `soloStemId` means only that stem is audible.
- `soloStemId` is clip-local and must not affect track solo.
- `mixMode: 'original'` uses original source audio.
- `mixMode: 'stems'` uses enabled stems.
- `mixMode: 'hybrid'` is reserved for later original-plus-stem blending.

Artifact ids must be explicit:

- `analysisArtifactId` is the logical stem-separation artifact id.
- `manifestArtifactId` is the stored manifest artifact ref used with `AudioArtifactStore.getAnalysisArtifact`.
- `payloadRef` points to the actual stem audio payload.

MVP default after separation:

- `mixMode: 'stems'`
- all stems enabled
- no solo
- gain `0 dB`

Transient job/model download state must not be stored in `clip.audioState.stemSeparation`. Persistent clip state stores completed stem layers and mix settings only. Active download, model cache status, current chunk progress, errors, and cancellation state should live in a transient timeline/service job map.

### Phase 2: Model Manager

Create:

```text
src/services/audio/stemSeparation/StemModelManager.ts
src/services/audio/stemSeparation/modelCatalog.ts
```

Responsibilities:

- Define available models and sizes.
- Download ONNX files by model id.
- Store model files in OPFS.
- Validate cached file size and version.
- Request persistent browser storage.
- Expose cache status for UI.
- Clear cache per model.
- Accept `AbortSignal` for cancellable model downloads. SAM2 is a useful template but its current download helper does not support cancellation, so stem separation should improve that pattern rather than copy it exactly.

Initial catalog:

```ts
{
  id: 'demucs-htdemucs-web',
  label: 'Demucs HTDemucs Web',
  stems: ['drums', 'bass', 'other', 'vocals'],
  inputSampleRate: 44100,
  outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
  files: [{
    name: 'htdemucs_embedded.onnx',
    sizeBytes: 180_534_758,
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
  }],
}
```

Later catalog entries:

- `htdemucs-onnx-fp16weights`
- `bs-polarformer-webgpu-fp16`
- `scnet-xl-ihf-onnx-experimental`

Do not expose a model in the production dropdown until the catalog includes a tested input tensor spec, output tensor spec, stem order, browser backend support, and a known-good chunk/overlap plan.

### Phase 3: Worker Runtime

Create:

```text
src/services/audio/stemSeparation/stemSeparationWorker.ts
src/services/audio/stemSeparation/types.ts
```

Worker message protocol:

```ts
type StemSeparationWorkerRequest =
  | { type: 'load-model'; modelId: string; modelBuffers: ArrayBuffer[] }
  | { type: 'separate'; jobId: string; input: StemSeparationInput }
  | { type: 'cancel'; jobId: string }
  | { type: 'dispose-model' };

type StemSeparationWorkerResponse =
  | { type: 'model-ready'; modelId: string; backend: 'webgpu' | 'wasm' }
  | { type: 'progress'; jobId: string; phase: string; progress: number; message?: string }
  | { type: 'result'; jobId: string; stems: StemSeparationWorkerStemResult[] }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId?: string; error: string };
```

Worker responsibilities:

- Import `onnxruntime-web`.
- Prefer WebGPU when `navigator.gpu` exists in worker.
- Always keep WASM fallback.
- Create `InferenceSession`.
- Resample input to model sample rate.
- Chunk audio.
- Run model per chunk.
- Overlap/add output.
- Return transferable `Float32Array` stem buffers.

Do not create WAV files inside the worker in MVP. Return raw PCM; main-side service converts to artifacts and UI-ready buffers.

### Phase 4: Shared Stem Audio Resolver

Create:

```text
src/services/audio/stemSeparation/StemAudioSourceResolver.ts
```

This is required before UI wiring because export and live preview currently use different audio paths.

Responsibilities:

- Resolve a clip's effective stem mix to an `AudioBuffer`.
- Load stem payload refs from `AudioArtifactStore`.
- Decode payloads using explicit manifest metadata.
- Apply `soloStemId`, enabled flags, and per-stem gain.
- Cache decoded stem buffers by `manifestArtifactId` and source fingerprint.
- Expose a common API for both offline render/export and live preview playback.

The live preview path cannot rely only on `ClipAudioRenderService`. Normal preview currently syncs `HTMLAudioElement`/Web Audio routes directly, so stem solo needs a preview-time buffer/source replacement path as well.

### Phase 5: Audio Service

Create:

```text
src/services/audio/stemSeparation/StemSeparationService.ts
```

Responsibilities:

- Resolve clip source audio through the same source path used by audio analysis.
- Load/download model through `StemModelManager`.
- Start worker job.
- Connect worker progress to timeline clip job state.
- Store resulting stems through `AudioArtifactStore`.
- Patch `clip.audioState.stemSeparation`.
- Clear processed waveform/spectrogram refs after stem state changes.
- Generate or queue stem waveform previews later.
- If the command starts from a video clip, resolve and mutate the linked audio clip.

Reuse `prepareClipAudioAnalysisInput(...)` where possible for source resolution and source fingerprinting. Avoid adding a second ad hoc decode path.

### Phase 6: Timeline Store Actions

Extend timeline actions:

```ts
startClipStemSeparation: (
  clipId: string,
  options?: StartClipStemSeparationOptions,
) => Promise<string | null>;

cancelClipStemSeparation: (clipId: string) => void;

setClipStemSolo: (clipId: string, stemId: string | null) => void;

setClipStemEnabled: (clipId: string, stemId: string, enabled: boolean) => void;

setClipStemGain: (clipId: string, stemId: string, gainDb: number) => void;

clearClipStemSeparation: (clipId: string) => void;

toggleClipStemLayerDropdown: (clipId: string) => void;

setClipStemLayerDropdownOpen: (clipId: string, open: boolean) => void;
```

History:

- Starting the job does not create an undo point.
- Completing the job creates one undo point: `Separate stems`.
- Solo/mute/gain changes create small undoable state changes.
- Cancel does not dirty the project unless partial state was committed.
- Dropdown open/closed state is UI-only and should not dirty the project.

Store shape:

- Persistent stem state lives under `clip.audioState.stemSeparation`.
- Active jobs live in a transient stem job map keyed by the audible audio clip id.
- Dropdown open/closed state lives in transient timeline UI state, for example `expandedClipStemLayerIds: Set<string>`.

### Phase 7: Right-Click Context Menu

In `TimelineContextMenu.tsx`:

- Detect audio-capable clips with a shared helper, not just `clip.source?.type === 'audio'`.
- For linked video clips, resolve `linkedClipId` to the audible audio clip before starting separation.
- Add `Stem Separation...` near `Generate Waveform`.
- Disable while a stem job is active.
- Open dialog or start directly with defaults if `Shift` modifier is used later.

Menu labels:

```text
Stem Separation...
Separating Stems... 42%
Regenerate Stems...
```

MVP can skip a full modal if needed:

- First click opens a compact confirmation/progress dialog.
- Later versions can use a richer model/settings panel.

### Phase 8: Clip Stem Dropdown UI

The user-facing result lives in a compact dropdown row directly under the selected clip. It uses the same expanded-track/detail-row infrastructure as keyframes, but it is its own clip-local layer control.

The visible row should align to the clip, not just the full track. In the timeline lane, the dropdown header and expanded stem rows should use the selected clip's `left` and `width` from `timeToPixel(clip.startTime)` and `timeToPixel(clip.duration)`, so the control reads as attached to that clip.

Add a `ClipStemLayerDropdown` component:

```text
src/components/timeline/components/ClipStemLayerDropdown.tsx
```

It receives:

- `clipId`
- `stemSeparation`
- active job state
- dropdown open/closed state
- callbacks for solo, mute, gain, clear

Display rules:

- Show only when clip has `audioState.stemSeparation` or active stem job.
- Render as one small collapsed row under the clip by default.
- Expanded state reveals the stem rows below that header.
- Place the expanded stem rows above keyframe rows in the selected-clip detail lane.
- Use the selected clip's timeline x-position and width for the dropdown body.
- Render matching left-column labels in `TimelineHeader.tsx` only if the existing detail-row layout needs a header-side label; the primary visible affordance is under the clip.
- Keep the header and stem rows compact.
- Avoid changing clip height unpredictably; use stable row heights.
- Make the dropdown header and expanded stem rows contribute to expanded track height even when the selected clip has no keyframes.
- Generalize keyframe-specific helpers such as `trackHasKeyframes` / expanded height gating into broader selected-clip detail helpers, or add a parallel stem-detail height path.

Suggested layout constants:

```ts
export const STEM_LAYER_DROPDOWN_HEADER_HEIGHT = 18;
export const STEM_LAYER_ROW_HEIGHT = 18;
```

Suggested refactor:

- Rename or wrap `TrackPropertyTracks` into a broader `TrackDetailRows` concept.
- Add a parallel `TrackStemLayerRows` section before keyframe rows.
- Update `getExpandedTrackHeight(...)` to add:
  - header height when a selected clip has stems or an active stem job.
  - row height times visible stem rows when the dropdown is open.
  - curve-editor/keyframe heights as today.
- Update `trackHasKeyframes(...)` usage or add a new `trackHasClipDetailRows(...)` helper so the expand affordance is active for stems-only clips.

Interaction:

- Click dropdown header: open/close `Audio Layers`.
- Click row label: solo that stem.
- Click active solo row again: clear solo.
- Click `Mix`: clear solo.
- Speaker icon later: enable/mute stem.
- Gain control later: adjust gain.

State mapping:

```ts
const activeSoloStemId = clip.audioState?.stemSeparation?.soloStemId;
```

Visual states:

- Collapsed header shows the current audible state: `Mix`, `Vocals solo`, `Drums solo`, etc.
- Active solo row: highlighted.
- Muted/disabled row: dimmed.
- Missing artifact: warning badge.
- Active job: progress row.

### Phase 9: Playback, Preview, And Export

`StemAudioSourceResolver` is the shared authority for stem audibility. `ClipAudioRenderService` must call it for offline render/export, and the live preview audio sync layer must call the same resolver for playback.

Add early render phase:

```ts
export type ClipAudioRenderPhase =
  | 'stem-mix'
  | ExistingPhases;
```

Stem render behavior:

1. If no `clip.audioState.stemSeparation`, render original source as today.
2. If `mixMode === 'original'`, render original source as today.
3. If `soloStemId` exists, load only that stem payload and render it.
4. If no solo, mix all enabled stems with their gain.
5. Continue through existing edit stack, speed, mute, and effects.

Important ordering:

- Stem source replacement should happen before clip edit stack.
- Region edits, repair, speed, and effects should apply to the selected stem mix.
- Export and preview should sound the same.

Artifact loading:

- Add a small stem payload resolver service that reads `AudioArtifactStore` payloads into `AudioBuffer`.
- Cache decoded stem buffers by `manifestArtifactId` and source fingerprint.

Live preview parity:

- Add a preview-time stem source path in the live audio sync/routing layer.
- It should use `StemAudioSourceResolver`, not route-level mute/volume only.
- A route setting alone cannot solo one separated stem from the original mixed `HTMLAudioElement`.
- Add tests proving preview and export use the same stem mix for solo/enabled/gain state.

### Phase 10: Waveform And Visual Feedback

MVP:

- Existing waveform may remain source waveform.
- Stem solo state changes audio immediately but does not require instant waveform regeneration.

Phase 2:

- Generate per-stem waveform mini previews.
- Show a small waveform strip per stem row.
- When a stem is soloed, clip waveform can switch to that stem's waveform.

Use existing waveform artifact infrastructure rather than storing new arrays on the clip.

### Phase 11: Model Progression

#### MVP Model

Use `demucs-web` style HTDemucs ONNX first.

Reasons:

- Known browser/WebGPU path.
- Existing model file is available.
- Four-stem output matches requested UI.
- Payload size is acceptable for opt-in lazy download.

#### Better Voice Mode

Add BS PolarFormer FP16 after MVP.

Reasons:

- Smaller FP16 payload around 108 MB.
- Useful for `Vocals`/`Instrumental` and speech cleanup workflows.
- Better fit for transcript and dialogue isolation than full 4-stem music separation.

#### SCNet XL IHF Experimental

Treat as a separate technical spike:

1. Run PyTorch checkpoint locally.
2. Export ONNX.
3. Compare ONNX output against PyTorch.
4. Try FP16.
5. Test in `onnxruntime-web` with WebGPU.
6. Only then expose behind an experimental flag.

Do not block the product feature on SCNet.

## Storage And Cache

Model files:

- OPFS under `stem-separation-models/{modelId}/`.
- Size/version validation before reuse.
- User-facing clear-cache action later.

Stem outputs:

- Store through `AudioArtifactStore`.
- Manifest kind: `stem-separation`.
- Payload MIME: prefer WAV for MVP, or define a versioned `audio/vnd.masterselects.pcm-f32` payload with explicit sample rate/channel/sample layout metadata.
- Project state stores refs only, not raw audio arrays.
- Each stem manifest must record `modelId`, `modelVersion`, `sourceFingerprint`, source range, sample rate, channel count, stem kind, stem order, payload encoding, duration, and normalization policy.
- If using PCM F32 payloads instead of WAV, add a small decoder/encoder helper and tests before wiring UI.

Project save/load:

- Stem refs are collected by project audio state by extending `projectAudioState` collection beyond `sourceAnalysisRefs`, `processedAnalysisRefs`, and `bakeHistory`.
- Missing artifacts show recoverable UI:
  - `Stem cache missing`
  - `Regenerate`

Artifact and identity requirements:

- Both `src/types/audio.ts` and `src/services/audio/audioArtifactTypes.ts` must accept the new `stem-separation` kind.
- Include stem state in audio analysis identity when `mixMode`, `soloStemId`, enabled flags, gain, or stem source refs affect processed waveform/spectrogram/loudness output.
- Update audio graph route/source descriptors so live audio routing can detect stem-state changes.

## Feature Flags

Add flags:

```ts
stemSeparation: false,
stemSeparationWebGPU: true,
stemSeparationClipLayers: true,
stemSeparationExperimentalModels: false,
```

Initial dev flow:

- Hide UI unless `stemSeparation` is true.
- Allow service tests without UI flag.
- Keep experimental SCNet hidden behind `stemSeparationExperimentalModels`.

## Testing Plan

### Unit Tests

- Model catalog sizes and ids.
- OPFS cache state with mocked storage.
- Source fingerprint identity.
- Stem state reducers:
  - solo stem.
  - clear solo.
  - enable/mute stem.
  - gain changes.
  - clear stem separation.
- Manifest serialization.
- Missing-artifact handling.

Likely test files:

- `tests/unit/audio/stemModelManager.test.ts`
- `tests/unit/audio/stemAudioSourceResolver.test.ts`
- `tests/unit/audio/stemSeparationWorkerProtocol.test.ts`
- `tests/unit/audio/audioAnalysisIdentity.test.ts`
- `tests/unit/audio/projectAudioState.test.ts`
- `tests/stores/timeline/stemSeparationSlice.test.ts`

### Worker Tests

Use a fake ONNX adapter for normal tests:

- load model.
- chunk plan.
- progress messages.
- cancellation.
- transferable result buffers.
- error propagation.

Real model tests should be opt-in:

```text
RUN_STEM_MODEL_TESTS=1
```

### Integration Tests

- Right-click eligible audio clip shows `Stem Separation...`.
- Non-audio clip hides or disables the action.
- Linked video clip resolves to the audible linked audio clip before separation starts.
- Start separation writes active job state.
- Completion writes `clip.audioState.stemSeparation`.
- A compact `Audio Layers` dropdown row appears directly under the clip.
- Opening the dropdown shows stem rows in the selected-clip detail area.
- The dropdown renders even when the selected clip has no keyframes.
- Dropdown x/width align to the selected clip, not the full track width.
- Clicking a stem row sets `soloStemId`.
- Clicking `Mix` clears `soloStemId`.
- Undo after completion removes stem state.
- Redo restores stem state.

### Audio Render Tests

With synthetic stem buffers:

- No solo mixes enabled stems.
- Solo vocals renders only vocals.
- Disabled stems are excluded.
- Gain is applied.
- Existing edit stack still applies after stem mix.
- Muted clip remains silent.
- Export render equals preview render for the same stem state.
- Live preview stem solo matches export stem solo.

### Browser QA

- Chrome/Edge WebGPU.
- WASM fallback.
- Model download cancel.
- Separation cancel mid-job.
- Reload after cached model.
- Reload after completed stems.
- Missing OPFS stem artifact after cache clear.
- Long clip memory behavior.
- WebGPU device lost behavior.

### Verification Commands

Minimum implementation gate:

```text
npm run test -- tests/unit/audio/stemModelManager.test.ts tests/unit/audio/stemAudioSourceResolver.test.ts tests/stores/timeline/stemSeparationSlice.test.ts
npm run test -- tests/unit/audio/clipAudioRenderService.test.ts tests/unit/audio/projectAudioState.test.ts tests/unit/audio/audioAnalysisIdentity.test.ts
npm run build
```

Real model gate, opt-in:

```text
RUN_STEM_MODEL_TESTS=1 npm run test -- tests/unit/audio/stemSeparationRealModel.test.ts
```

## Acceptance Criteria

MVP is done when:

- User can right-click an audio-capable clip and start stem separation.
- Starting from a linked video clip mutates the linked audible audio clip.
- Model download is lazy and clearly shown.
- Separation runs in a worker without freezing the UI.
- MVP runs without Native Helper or server upload.
- The completed clip shows a compact `Audio Layers` dropdown row directly under the clip.
- The dropdown aligns to the selected clip's horizontal position and width.
- Opening the dropdown shows `Mix`, `Vocals`, `Drums`, `Bass`, `Other`, even if the clip has no keyframes.
- Clicking any stem solos it against the other stems.
- Clicking the active solo stem or `Mix` returns to full stem mix.
- Preview playback respects stem solo.
- Export respects stem solo.
- Stems persist through project save/load as artifact refs.
- Missing cached stems produce a clear regenerate path.

## Open Decisions

- Whether a solo click should be undoable. Recommendation: yes, because it affects export output.
- Whether the default post-separation playback should be original or stem mix. Recommendation: `stems`, because that verifies separation immediately and makes solo predictable.
- Whether generated stems should also appear in Media Panel. Recommendation: no for MVP; keep them clip-local until user chooses `Extract to Track`.
- Whether region-only separation should replace only that source range or create partial stem layers. Recommendation: whole clip first, selected region second.
- Whether to call the UI command `Stem Separation`, `Separate Stems`, or `Split Stems`. Recommendation: `Stem Separation...` in menu, `Separate` as dialog action.

## External References Checked

- `demucs-web` ONNX model file: https://huggingface.co/timcsy/demucs-web-onnx/tree/main
- StemSplit HT-Demucs ONNX exports and browser notes: https://huggingface.co/StemSplitio/htdemucs-onnx
- BS PolarFormer ONNX/WebGPU model files: https://huggingface.co/bgkb/bs_polarformer/tree/main
- ZFTurbo source-separation training repo and SCNet family: https://github.com/ZFTurbo/Music-Source-Separation-Training

## Implementation Order

1. Add types, model catalog, and feature flags.
2. Add `StemModelManager` by adapting the SAM2 OPFS model manager pattern, with download cancellation.
3. Add worker protocol and fake-model worker path.
4. Add `StemAudioSourceResolver`.
5. Add `StemSeparationService` and timeline actions.
6. Store fake stems as audio artifacts and patch clip audio state on the audible audio clip.
7. Extend project audio artifact indexing, audio artifact kind unions, and audio analysis identity.
8. Add context menu entry and minimal progress UI.
9. Add transient dropdown UI state and generalized selected-clip detail-row height helpers.
10. Add `ClipStemLayerDropdown` under the selected clip and align it to the clip's x/width.
11. Wire stem solo state into `ClipAudioRenderService`.
12. Wire stem solo state into live preview audio sync/routing through the shared resolver.
13. Add synthetic render and live-preview parity tests.
14. Run `npm run build` and targeted Vitest gates.
15. Add real Demucs ONNX adapter.
16. Run browser QA and performance measurements.
17. Evaluate `StemSplitio/htdemucs-onnx` fp16weights as a possible replacement/default.
18. Add optional extract-to-tracks command.
19. Start SCNet ONNX spike separately.
