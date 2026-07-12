# Screen Capture Panel Plan (OBS-Style Recording, Browser-Only)

Status: planning (review loop complete)
Updated: 2026-07-12
Review: draft was reviewed 2026-07-12 by 2 Codex + 2 Claude read-only agents;
all findings are folded into this version.

## Goal

Add an OBS-like screen recording workflow to MasterSelects: a dockable
**Capture Panel** where the user picks a source (entire screen, single window,
or browser tab), optionally crops a region and scales the output, records with
microphone and system/tab audio, and gets the finished recording imported
straight into the Media Library (and optionally placed on the timeline).

Everything runs in the browser. The native helper is explicitly **not**
required for v1. Live streaming (RTMP/WHIP out) is explicitly out of scope.

## Confirmed Codebase Facts

The feature is mostly assembly of existing, verified building blocks. "Reuse"
below means reusing the *pattern or module named*, not blind 1:1 mirroring —
screen capture adds picker acquisition, preview ownership, pause/resume,
display-track termination, and surface switching that the audio domain never
needed.

| Building block | Where | What it gives us |
|---|---|---|
| Recording session patterns | `src/services/audio/AudioRecordingService.ts` + `src/services/audio/recording/*` | Injectable capture backend, chunk sink, storage planning, recovery ledger, idempotent commit. The capture service reuses these patterns; its state machine is its own (adds `paused`, source loss, surface switching). |
| Recovery blob storage | `src/services/audio/recording/recoveryPersistence.ts` (`artifactService.putIndexedDBArtifact`) | IndexedDB artifact chunks + localStorage session ledger. The producer id is hardcoded per domain, so capture gets its **own blob-store class** with `providerId: 'masterselects.capture.recording'` — same shape, not a shared parameterized class. |
| Workflow wiring pattern | `src/services/audio/timelineRecordingWorkflow.ts` | Start/stop/commit orchestration against stores; template for `captureRecordingWorkflow`. |
| WebCodecs encoder knowledge | `src/engine/export/VideoEncoderWrapper.ts`, `src/engine/export/codecHelpers.ts` | Codec strings, `isConfigSupported` fallback ladder (hardware → software), `encodeQueueSize` monitoring. **Not reused as-is**: the export wrapper prefers quality latency and schedules keyframes by frame index; live capture needs a small capture-specific encoder (realtime latency, time-based keyframes, VFR timestamps). |
| Muxing | `src/engine/export/MediaBunnyMuxerAdapter.ts` (`mediabunny` ^1.39.2) | MP4/WebM muxing. **Caveat:** the adapter queues every encoded packet internally until `finalize()` and uses `BufferTarget` + `fastStart: 'in-memory'` — memory grows for the whole recording. A live capture adapter must add packets incrementally with backpressure and use a streaming target (see Long Recordings). |
| Audio codec knowledge | `src/engine/audio/AudioEncoder.ts` (`AudioEncoderWrapper`, exported via `src/engine/audio/index.ts`) | AAC/Opus support probes (`isAACSupported`, `isOpusSupported`, `detectSupportedCodec`) and codec config knowledge. **Not reused as-is**: it encodes a complete offline `AudioBuffer`; live capture needs an incremental WebCodecs `AudioEncoder` fed with `AudioData`. |
| Media import | `src/stores/mediaStore/slices/fileImportSlice.ts` — `importFile(file, parentId, { forceCopyToProject, projectFileName })` | Full import pipeline: type classification, `getMediaInfo`, thumbnail, hash dedup, RAW copy, object URL, waveform/proxy kickoff. Recording gets thumbnails/waveforms/proxies from the normal pipeline — build nothing capture-specific there. `projectFileName` only names the on-disk RAW copy; **library folder placement is `parentId`** (see Commit Path). |
| Folder find-or-create pattern | `src/stores/mediaDownloadStore.ts` (`getOrCreateDownloadFolder`, ~line 207) | The canonical pattern for a named root folder: `folders.find(name, parentId===null)` else `createFolder(name)`. Capture copies this for a `Recordings` folder. |
| Timeline placement | `src/services/timelinePlacementCommands.ts`; `addClip(trackId, file, startTime, duration?, mediaFileId?, mediaTypeOverride?, options?)` (`src/stores/timeline/actions/clipActionTypes.ts`) | Target-track selection, compatible-track creation, and placement policy already exist — capture routes optional playhead placement through this flow instead of picking tracks itself. |
| Panel system | `src/types/dock.ts` (`PanelType`, `PANEL_CONFIGS`), `src/stores/dockStore/panelRegistry.ts` (`BUILT_IN_PANEL_TYPES`), `src/components/dock/DockPanelContent.tsx`, `src/components/common/toolbar/viewPanelConfig.ts` | Registering a panel is a **five-file** change plus the component (see Panel Registration). |
| `MediaStreamTrackProcessor` precedent | `src/engine/webcodecs/htmlVideoFrameSource.ts`, `src/engine/webCodecsPlayer/playerBase.ts` | Stream → `VideoFrame` extraction with support guards is an established pattern. |
| Synthetic-stream test precedent | `src/services/aiTools/handlers/smokes/thumbnailReload.ts` | Already synthesizes WebM via `canvas.captureStream()` + `MediaRecorder` with `isTypeSupported` MIME probing — the template for capture test fixtures. |
| Feature flags | `src/engine/featureFlags.ts` | New flag `screenCaptureWebCodecs` gates the Tier B pipeline. |
| Settings persistence | `src/stores/uiSettingsStore.ts` (`audioInputDeviceId`) | Correct home for capture preferences. It persists **without** `partialize`, so new fields persist automatically. Do not put capture prefs in `settingsStore` (explicit `partialize` allow-list — silent-drop trap) or in project schemas. |
| Observability | `src/services/logger.ts`, AI debug bridge (`src/services/aiTools/`) | Capture gets a `Logger.create('ScreenCapture')` module and a read-only bridge diagnostic (see Observability). |

## Confirmed Platform Facts

- `getDisplayMedia()` covers all three source kinds through the mandatory
  browser picker (tab / window / monitor). Sites cannot enumerate windows or
  screens.
- `displaySurface` and `surfaceSwitching` are **hints, not guarantees**: the
  browser may reorder picker panes but must still let the user pick any
  surface. Panel buttons are therefore "Prefer screen / window / tab"; actual
  behavior always derives from `track.getSettings().displaySurface` on the
  returned track. `cursor` support is checked via `getCapabilities()` before
  offering a toggle.
- `getDisplayMedia()` requires a secure context, a fully active document, and
  **transient user activation** — the call must run directly in the record/
  select button's gesture handler and cannot be retried after async detours.
  Handle `NotAllowedError` (denied/canceled), `InvalidStateError`, and
  permissions-policy rejection with clear panel states.
- Window capture on Windows Chromium uses Windows Graphics Capture
  internally: occluded windows keep rendering; minimized windows do not
  deliver frames.
- Audio availability is **probed, never assumed**: request `audio: true`
  (with `systemAudio`/`windowAudio` hints where supported) and drive the UI
  from the audio tracks actually returned. Typical Chromium-on-Windows
  outcome: monitor → system audio, tab → tab audio, window → usually none
  (partial `windowAudio` support is appearing). The panel shows what it got,
  with mic as the always-available fallback.
- `suppressLocalAudioPlayback: true` mutes the captured tab **locally** — it
  is a "mute tab while recording" option, not an echo fix. Our mixing graph
  feeds a `MediaStreamAudioDestinationNode`, not the speakers, so it
  introduces no echo by itself. Default the constraint to `false`.
- The display video track fires `ended` when the user clicks the browser's
  own "Stop sharing" control. This is a **first-class stop path**: the
  service must finalize the recording idempotently even though mic/mixed
  audio tracks are still live (MediaRecorder does not stop on its own while
  any recorded track lives).
- `CaptureController.setFocusBehavior('no-focus-change')` (Chromium)
  prevents focus jumping to the captured surface on start.
- Region cropping without raster: `new VideoFrame(frame, { visibleRect })`
  shares the media resource and re-declares the visible rectangle. Crop
  offsets/sizes must be **chroma-aligned** (even values for 4:2:0 formats);
  unaligned rects are normalized, or the raster path is used. The encoder is
  configured with the cropped dimensions.
- MediaRecorder output container/codec varies by browser (Chromium/Firefox:
  WebM flavors; Safari: MP4/H.264/AAC). Probe full MIME strings with
  `MediaRecorder.isTypeSupported()`, treat `recorder.mimeType` as
  authoritative, derive the file extension from it.
- **MediaRecorder timeslice blobs are not individually playable** and a
  crash-truncated prefix is not guaranteed playable — the spec only
  guarantees the concatenation of *all* blobs of a completed recording.
  Crash recovery for Tier A is therefore **best-effort** (see Recovery).
- Browser support tiers: Chromium ≥ 109 gets everything. Firefox has
  `getDisplayMedia` + `MediaRecorder` but no `MediaStreamTrackProcessor` and
  no `CaptureController` → Tier A only. Safari captures screens/windows and
  records via MediaRecorder (MP4) → Tier A, best-effort.

## App Security Context

- The app ships **cross-origin isolated**: COOP `same-origin` + COEP
  `credentialless` in dev (`vite.config.ts`) and production
  (`public/_headers`). No CSP or `Permissions-Policy` header exists, so
  `display-capture`/`microphone` are allowed by default at top level —
  nothing to change, but P1 includes a smoke that `getDisplayMedia` +
  `MediaStreamTrackProcessor` work under COEP `credentialless` in the real
  dev server.
- Cross-origin isolation makes `SharedArrayBuffer` available — an option for
  worker-side muxing later, not a v1 dependency.
- `index.html`'s `?reset=true` path wipes localStorage and selected
  IndexedDB databases: capture presets (localStorage via `uiSettingsStore`)
  are wiped by design; the recovery ledger goes with them, so orphaned
  recovery artifacts must be tolerated (garbage-collectable), never load-
  bearing.

## Product Shape (v1)

- New dockable **Capture Panel** (`PanelType: 'capture'`), initially listed
  under `WIP_PANEL_TYPES` (badged, like `multicam`) until the feature exits
  the flag.
- Source acquisition: "Prefer screen / window / tab" buttons → picker; live
  preview of the returned track; panel adapts to what was actually picked.
- Toggles: cursor (capability-gated), mic on/off + device select, capture
  audio on/off (shown only when the returned stream has an audio track).
- Region crop: drag rect over the live preview; output scale presets
  (100 % / 75 % / 50 % / custom + 1080p target); FPS (30/60) and bitrate
  presets. Crop/scale/MP4 require Tier B (flag + Chromium).
- Record / **pause** / stop with elapsed time, size estimate, and storage
  warnings. Browser-side "Stop sharing" finalizes cleanly.
- Recording requires an **open project** (RAW copy is a no-op otherwise);
  with no project open the panel explains and offers to create one.
- Result: file imported into a find-or-create root `Recordings` folder,
  named like `Screen Recording 2026-07-12 14-32-05.webm|.mp4` (extension
  from the actual MIME), optional setting to also place it on the timeline
  at the playhead via the standard placement flow.
- Crash recovery: unfinished sessions surface in the panel on next start —
  restore is **best-effort** for Tier A (chunk concatenation; playability
  depends on the browser's container writing), reliable for Tier B once
  fragmented output lands (P8).
- Undo contract: undoing an auto-placement removes the timeline clip but
  **keeps** the recording in the Media Library. The import itself is not
  part of any history batch.

Out of scope for v1: streaming, webcam overlay compositing, scene system,
global hotkeys, capture without picker, minimized-window capture, native
helper involvement, audio ducking/monitoring, **recording while an export is
running** (Tier B start is blocked while `isExporting`; Tier A shows a
warning).

## Architecture

New service domain `src/services/capture/` (all files under the 700 LOC
ceiling; test files listed in Work Packets):

```text
src/services/capture/
  ScreenCaptureService.ts        // session lifecycle, snapshot, subscribers (HMR-safe singleton)
  captureRecordingWorkflow.ts    // start/stop/commit orchestration for the panel
  sourceAcquisition.ts           // getDisplayMedia + getUserMedia, constraint building,
                                 // capability probing, CaptureController, error mapping
  captureLifecycle.ts            // single cleanup owner: stop/cancel/error/permission-denial/
                                 // track-ended/panel-unmount/HMR paths, idempotent teardown
  recording/
    sessionTypes.ts              // serializable session/config/result types (NO runtime handles)
    sessionStateMachine.ts       // idle → requesting-source → previewing → recording ↔ paused
                                 //   → stopping → complete | error; source-lost from any active state
    mediaRecorderBackend.ts      // Tier A: MIME probing, timeslice chunks -> sink, pause/resume,
                                 //   does NOT retain persisted chunks in memory
    webCodecsBackend.ts          // Tier B video: track processor -> transform -> encoder -> muxer
    captureVideoEncoder.ts       // capture-specific WebCodecs encoder: realtime latency,
                                 //   VFR timestamps, time-based keyframes (~1 s), backpressure
    captureAudioEncoder.ts       // Tier B audio: incremental WebCodecs AudioEncoder (AAC/Opus
                                 //   via existing probes), AudioData in, chunks -> muxer
    captureMuxer.ts              // live MediaBunny adapter: incremental packet add with
                                 //   backpressure, streaming-capable target (see Long Recordings)
    syncClock.ts                 // shared A/V zero point, pause rebasing, monotonicity guards
    frameTransform.ts            // chroma-aligned visibleRect crop; scale raster via platform-
                                 //   gated 2D canvas (main-thread, willReadFrequently on Linux)
    audioMixing.ts               // AudioContext graph: mic + display audio -> destination + meters
    storagePlanning.ts           // quota estimate + warnings (adapted from audio)
    recoveryPersistence.ts       // capture blob-store class (own producer id) + localStorage ledger
    commitRecording.ts           // Recordings folder find-or-create, importFile, measured-duration
                                 //   handling, optional placement, durable idempotency

src/components/panels/capture/
  CapturePanel.tsx               // panel shell (lazy-loaded from DockPanelContent)
  CapturePreview.tsx             // <video srcObject> preview + DOM/SVG crop overlay
  CaptureControls.tsx            // record/pause/stop, elapsed, meters, warnings, recovery list
  CaptureSettings.tsx            // fps/bitrate/scale/cursor/audio toggles
```

**Runtime-handle rule (explicit):** `MediaStream`s, tracks, `AudioContext` +
nodes, `MediaStreamTrackProcessor`, encoders, `VideoFrame`s, canvases, and
object URLs live only in private service/backend fields. Snapshots, Zustand
state, settings, session types, and recovery ledger entries carry only
serializable data and artifact references.

**Cleanup ownership:** `captureLifecycle.ts` is the single owner of teardown.
Every exit path — user stop, cancel, error, permission denial, display-track
`ended`, panel unmount, HMR dispose — funnels through one idempotent
`teardownSession()`. Closing or detaching the panel does **not** stop an
active recording (the HMR-safe service keeps running); the panel re-attaches
to the live session on remount.

### Two capture tiers

**Tier A — MediaRecorder (ships first, works everywhere).** The display
video track plus the mixed audio stream feed a `MediaRecorder` with
`timeslice`. MIME is probed (`isTypeSupported`), `recorder.mimeType` decides
the container and file extension. Each timeslice blob goes to the recovery
chunk sink and is **not** additionally retained in memory (the final file is
assembled from the persisted chunks). Pause/resume maps to
`MediaRecorder.pause()/resume()`. No crop/scale — what the user picked is
what is recorded.

**Tier B — WebCodecs pipeline (crop, scale, MP4; flag
`screenCaptureWebCodecs`; Chromium only).** `MediaStreamTrackProcessor`
yields `VideoFrame`s → `frameTransform` (chroma-aligned `visibleRect` crop;
raster scale only when scale ≠ 100 %) → `captureVideoEncoder` (realtime,
hardware-preferred via the `codecHelpers` ladder, time-based keyframes, VFR
timestamps from `syncClock`) → `captureMuxer`. Audio: `AudioWorklet` tap on
the mixed stream → `AudioData` → `captureAudioEncoder` → `captureMuxer`.
`syncClock` provides one zero point for both streams, subtracts paused time
from both, and enforces monotonic timestamps; dropped video frames never
shift the audio clock. Backpressure: when `encodeQueueSize` exceeds its
bound, video frames are dropped (VFR absorbs gaps) and a drop counter is
surfaced.

**Surface switching policy:** `surfaceSwitching: 'include'` is enabled for
Tier A. During a Tier B recording with an active crop, switching is not
requested; if the browser switches anyway or track settings change
dimensions, the crop is revalidated against the new dimensions and the
session either rasters into the fixed output size or stops with a clear
error — never silently mis-crops.

### Audio graph

One `AudioContext` graph mixes up to two inputs into a
`MediaStreamAudioDestinationNode`: mic via `getUserMedia({ audio: {
deviceId } })` (device from `uiSettingsStore.audioInputDeviceId`) and the
display audio track when the stream returned one. Per-input gain nodes feed
simple level meters. The mixed destination stream is consumed by Tier A's
MediaRecorder or Tier B's worklet tap. When MS itself plays audio during a
monitor capture, the recording contains it — the panel shows a hint, v1 does
not try to prevent it. An optional "mute captured tab" toggle maps to
`suppressLocalAudioPlayback: true`.

### Preview and crop overlay (Linux/Mesa rules)

Per `docs/Features/Linux-Mesa-GPU.md`, GPU canvas paths fail silently on
Mesa. The preview is a plain `<video srcObject>` element — no canvas. The
crop rectangle is a DOM/SVG overlay; its math maps overlay pixels to source
pixels via `videoWidth`/`videoHeight` and the **actual rendered content
rectangle under `object-fit`** (letterboxing-aware), recomputed on resize and
on source-dimension changes. The only raster surface in the feature is the
Tier B scale pass: a **main-thread** 2D canvas, `willReadFrequently: true`
on platforms where `prefersSoftwareTimelineCanvas()`-style detection flags
Mesa, clamped well below 8192 px, skipped entirely at 100 % scale. No worker
`OffscreenCanvas` in v1.

### Commit path (Media Library + timeline)

1. Duration comes from the session (`syncClock`/elapsed accounting), **not**
   from `getMediaInfo`: MediaRecorder WebM routinely reports
   `duration: Infinity` via `HTMLVideoElement.duration`, which would poison
   `MediaFile.duration`, bitrate estimates, and placement. `commitRecording`
   passes the measured duration to `addClip` and patches the imported
   `MediaFile.duration` when the probe returned garbage.
2. Find-or-create the root `Recordings` folder
   (`folders.find(name === 'Recordings' && parentId === null)` else
   `createFolder('Recordings')` — the `getOrCreateDownloadFolder` pattern),
   then `importFile(file, recordingsFolderId, { forceCopyToProject: true,
   projectFileName })`. Note the audio-recording precedent imports to root;
   the folder logic is net-new here.
3. Thumbnails, waveforms, and (for MP4) scrub proxies come from the normal
   import pipeline. **Tier A WebM gets no scrub proxy** (the proxy demuxer
   is MP4Box/ISO-BMFF-only) — accepted v1 limitation, documented in the
   panel help; Tier B MP4 is the path that unlocks proxies.
4. Optional timeline placement goes through the
   `timelinePlacementCommands.ts` flow (target-track selection, compatible-
   track creation, linked audio) at the current playhead, guarded for locked
   targets and no-video-track cases. Undo removes the placed clip, never the
   imported media; the async import is not enrolled in a history batch.
5. Commit idempotency is durable: the recovery ledger entry records the
   committed media-file id, so a reload between import and ledger cleanup
   does not double-import. Verify the import marks the project dirty /
   triggers autosave; if not, `commitRecording` calls `markDirty` itself.

### Performance coordination

- `src/services/performanceMonitor.ts` resets clip quality params after 5
  consecutive >100 ms frames — an encode spike during recording could
  silently downgrade the user's project. While a capture session is active,
  this auto-reset is suspended (or its threshold raised); restored on stop.
- Tier B start is blocked while `timeline` export is running
  (`exportEditLock.ts` / `isExporting`) — same hardware encoder and muxer
  stack; Tier A during export shows a warning.
- Backpressure via `encodeQueueSize` is net-new capture logic (there is no
  global encode budget to plug into) and is measured in the P6 gate with
  `getStats` while playback runs.

### Observability

- `Logger.create('ScreenCapture')` for the service, backends, and commit
  path.
- A read-only AI bridge diagnostic `getCaptureState` returning only
  serializable state: phase, selected surface, active tier, MIME/codec,
  dimensions, audio-track presence, elapsed seconds/bytes, encoder queue
  size, dropped frames, last error. No stream handles. Bridge smokes follow
  the standing rule: wait 5 s after any reload before reading state.

### Recovery (honest guarantees)

- Ledger + artifact chunks mirror the audio pattern (own blob-store class,
  capture producer id).
- **Tier A:** persisted timeslice chunks are concatenated on restore. The
  spec does not guarantee a truncated prefix plays; in practice Chromium
  WebM prefixes usually decode to the last written cluster. Recovery is
  presented as "Restore recording (may be shorter than the session)" —
  best-effort, verified per-browser in P8; a remux/repair pass (mediabunny
  read + rewrite) is the P8 upgrade if bare concatenation proves too flaky.
- **Tier B:** reliable interrupted-recording recovery requires fragmented
  MP4 output and positioned-write persistence — that is P8's core (see
  below). Until P8, Tier B recovery restores nothing; the duration guard
  keeps sessions short enough that this is acceptable behind the flag.
- The recovery list UI in the audio mixer is bespoke inline JSX
  (`AudioMixerPanel.tsx`), not a shared component. P4 builds the capture
  equivalent bespoke; extracting a shared recovery-list component is noted
  as optional debt, not assumed.

### Long recordings (P8 target architecture)

`mediabunny` 1.39's `StreamTarget` takes a `WritableStream<StreamTargetChunk>`
whose writes carry **byte positions** (not append-only blobs), and the
current adapter additionally queues every packet until `finalize()`. The
capture muxer therefore (a) adds encoded packets incrementally with
backpressure instead of queueing, (b) writes through a `StreamTarget` sink
that persists `{ position, data }` runs into the artifact store and can
reconstruct the file by ordered positional assembly, and (c) uses
`fastStart: 'fragmented'` so an unfinalized file is still a valid decodable
fMP4 prefix. Tier A's chunk handling (no in-memory retention) ships already
in P2. The memory gate is threshold-based, not "flat": sampled heap, queued
packet bytes, artifact bytes, and encoder queue size over a 10-minute
1080p30 session must stay under agreed ceilings (e.g. queued packet bytes
< 64 MB, heap growth < 150 MB).

## Panel Registration (exact checklist)

1. `src/types/dock.ts` — add `'capture'` to the `PanelType` union; add a
   `capture` entry to `PANEL_CONFIGS` (compile-forced: full
   `Record<PanelType, PanelConfig>`); add to `WIP_PANEL_TYPES` initially.
2. `src/stores/dockStore/panelRegistry.ts` — add to `BUILT_IN_PANEL_TYPES`
   (feeds `VALID_PANEL_TYPES`, which gates `showPanelType` and the persisted-
   layout normalizer — omitting this silently strips the panel from saved
   layouts).
3. `src/components/dock/DockPanelContent.tsx` — add `case 'capture'`
   returning the lazily imported `CapturePanel` (the switch has a silent
   `default`; a registry/render unit test guards the case).
4. `src/components/common/toolbar/viewPanelConfig.ts` — add `'capture'` to
   `VIEW_CORE_PANEL_TYPE_ORDER`; without this the View ▸ Panels menu never
   shows the panel (the tab-bar "+" menus derive from `PANEL_CONFIGS`
   automatically, the View menu does not).
5. `src/stores/uiSettingsStore.ts` — typed capture preference fields with
   defaults and setters (fps, bitrate preset, scale preset, cursor, audio
   defaults, auto-place-on-timeline).

Factory/default layouts are intentionally not touched (on-demand panel). No
keyboard-shortcut or command-palette wiring exists for panels; none is added.

## Work Packets

Rules of engagement: packets run sequentially unless stated (write sets
overlap by design inside the capture domain — one packet at a time owns it).
Workers run `npx tsc -b --pretty false` + scoped `rg` scans and report;
**the orchestrator runs the focused vitest suite after every packet** —
worker sandboxes cannot run vitest. Test files are part of each write set.
Real-picker flows cannot run headlessly (transient-activation requirement);
automated coverage targets state machine, chunk/recovery flow, crop math,
sync clock, and commit path via injected fakes (pattern:
`thumbnailReload.ts` synthetic streams). Chromium's
`--auto-select-desktop-capture-source` stays a local experiment, not a gate.

| # | Packet | Write set (exact) | Gates (orchestrator-verified) |
|---|---|---|---|
| P1 | Domain skeleton: session types, state machine (incl. `paused`, source-lost), service shell with injectable backend, lifecycle/teardown owner, storage planning, logger module | `src/services/capture/ScreenCaptureService.ts`, `captureLifecycle.ts`, `recording/sessionTypes.ts`, `recording/sessionStateMachine.ts`, `recording/storagePlanning.ts`, `src/services/capture/__tests__/sessionStateMachine.test.ts`, `__tests__/screenCaptureService.test.ts` | vitest: state transitions incl. pause accounting, source-lost from every active phase, idempotent teardown, no runtime handles in snapshots (type-level check) |
| P2 | Tier A backend: MIME probing, timeslice → recovery chunk sink (no in-memory chunk retention), pause/resume, capture blob-store class + ledger | `recording/mediaRecorderBackend.ts`, `recording/recoveryPersistence.ts`, `__tests__/mediaRecorderBackend.test.ts`, `__tests__/recoveryPersistence.test.ts` | vitest with injected fake MediaRecorder/streams: chunk flow, MIME fallback, pause, memory (chunks released after persist), ledger round-trip |
| P3 | Commit path: Recordings folder find-or-create, measured-duration handling + `MediaFile.duration` patch, `importFile` wiring, optional placement via `timelinePlacementCommands`, undo contract, durable idempotency, dirty-marking | `recording/commitRecording.ts`, `captureRecordingWorkflow.ts`, `__tests__/commitRecording.test.ts` | vitest: folder reuse on second commit, duplicate-commit guard across simulated reload, placement + single undo step removes clip but not media, WebM `Infinity`-duration case |
| P4 | Capture Panel UI + registration (5-file checklist above) + source acquisition + lifecycle wiring (`ended` → finalize) + Tier A recovery list UI + settings fields | `src/components/panels/capture/*` (4 files), `src/services/capture/sourceAcquisition.ts`, `src/types/dock.ts`, `src/stores/dockStore/panelRegistry.ts`, `src/components/dock/DockPanelContent.tsx`, `src/components/common/toolbar/viewPanelConfig.ts`, `src/stores/uiSettingsStore.ts`, `__tests__/sourceAcquisition.test.ts`, panel registry/render test | vitest: registration completeness (panel opens from View menu + tab-bar menu), acquisition error mapping (denied/canceled/invalid-state). Manual smoke (Chromium): record screen/window/tab; browser "Stop sharing" finalizes; file lands in `Recordings` and plays; Firefox degrades to Tier A cleanly |
| P5 | Audio: mixing graph, device select, capture-audio probing + honest hints, meters, mute-captured-tab option | `recording/audioMixing.ts`, `CaptureSettings.tsx`, `CaptureControls.tsx`, `__tests__/audioMixing.test.ts` | vitest: graph wiring with fake tracks, meter levels. Manual smoke: tab capture with tab audio + mic; window capture shows probed no-audio hint |
| P6 | Tier B video: `frameTransform` (aligned crop, platform-gated scale raster), `captureVideoEncoder`, `captureMuxer` (incremental add + backpressure, in-memory target with duration guard), crop overlay UI (object-fit-aware mapping), tier selection, `screenCaptureWebCodecs` flag, export-contention guard, performanceMonitor suspension | `recording/webCodecsBackend.ts`, `recording/captureVideoEncoder.ts`, `recording/captureMuxer.ts`, `recording/frameTransform.ts`, `recording/syncClock.ts` (video side), `CapturePreview.tsx`, `src/engine/featureFlags.ts`, perf-monitor touchpoint, `__tests__/frameTransform.test.ts`, `__tests__/syncClock.test.ts`, `__tests__/captureMuxer.test.ts` | vitest: chroma alignment incl. odd rects, letterbox crop mapping, time-based keyframes, backpressure drop counting. Manual smoke: cropped 50 % recording has correct dimensions; `getStats` during playback+capture shows no runaway; blocked while exporting |
| P7 | Tier B audio + A/V sync: worklet tap, `captureAudioEncoder`, shared zero point, pause rebasing, drift guard | `recording/captureAudioEncoder.ts`, `recording/audioMixing.ts` (tap), `recording/syncClock.ts` (audio side), `recording/webCodecsBackend.ts` (mux wiring), `__tests__/captureAudioEncoder.test.ts`, sync tests extension | vitest: A/V offset stays 0 across simulated pause/resume and video drops; monotonic timestamps. Manual smoke: 2-min tab recording with music stays in sync incl. one pause |
| P8 | Long-recording hardening: `StreamTarget` positioned-write sink → artifact store, `fastStart: 'fragmented'`, Tier B interrupted-recovery, Tier A recovery verification (+ remux/repair pass if concatenation is too flaky), remove duration guard, threshold-based memory gate | `recording/captureMuxer.ts`, `recording/recoveryPersistence.ts`, `recording/mediaRecorderBackend.ts` (retention audit), recovery UI wiring, `__tests__/captureMuxer.streaming.test.ts`, `__tests__/recoveryReassembly.test.ts` | vitest: positional reassembly byte-exact; fragmented prefix decodes. Manual: 10-min 1080p30 session within memory ceilings (queued packet bytes < 64 MB, heap growth < 150 MB, sampled via `getStats`/heap snapshots); kill-tab mid-recording restores a playable file (Tier B), best-effort banner (Tier A) |
| P9 | Observability + docs + release: `getCaptureState` bridge diagnostic, `docs/Features/Screen-Capture.md`, `docs/Features/README.md` entry, then the **normal release chain**: version bump (`src/version.ts`, `src/changelog-data.json`, `package.json`, `package-lock.json`), `npm run build` + `lint` + `test`, `Security Checks` green on the pushed HEAD | bridge handler files, `docs/Features/*`, version/changelog files | Full chain green; bridge diagnostic returns serializable state during an active session; plan file moves to `docs/completed/plans/` with archive banner |

P1–P4 ship the usable Tier A feature (record screen/window/tab → Media
Library, recovery best-effort). P5 completes v1 audio. P6–P8 deliver the
OBS-style crop/scale tier behind the flag. P9 is the release boundary —
feature docs are written when the first user-visible slice ships, not only
at the end.

## Risks And Open Questions

- **Tier A recovery playability** is browser-dependent (spec gives no
  truncated-prefix guarantee). P8 verifies per-browser and adds remux/repair
  if needed; until then recovery is labeled best-effort.
- **Encode pressure during editing:** measured, not assumed — P6's gate runs
  capture during active playback and watches `getStats`. Frame dropping is
  the designed relief valve.
- **`windowAudio` variability:** window-capture audio may start working on
  newer Chromium; the probe-based UI needs no change when it does.
- **COEP `credentialless` interaction** with capture APIs is expected fine
  top-level in Chromium but is explicitly smoked in P1's environment check.
- **Window picker scope:** DRM/elevated windows can come out black —
  platform limitation, documented, not chased.
- **Wayland/Linux:** `getDisplayMedia` goes through xdg-desktop-portal;
  works, frame rates can be lower. Tier A is the safe default there.
- **MediaBunny fragmented-MP4 + positioned-write recovery** (P8) is the
  riskiest integration; if it stalls, the fallback is Tier B with a hard
  session-length cap and Tier A for long recordings.

## Future (Explicit Non-Goals For v1)

- Webcam overlay + scene compositing. Natural second step: live MediaStream
  layers inside a normal composition, recorded through the existing
  render/export path ("everything is a signal").
- Native helper capture (window enumeration without picker, global hotkeys,
  minimized windows, direct-to-disk) — only if browser limits actually bite.
- Streaming out (RTMP/WHIP).
- Shared recovery-list UI component extracted from audio + capture (debt
  note, not a packet).
