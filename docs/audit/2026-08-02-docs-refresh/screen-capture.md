# Screen-Capture.md — audit 2026-08-02

## Verified (spot checks that held)

- The panel is a registered, lazy-loaded `capture` dock panel (`src/types/dock.ts`, `src/components/common/toolbar/viewPanelConfig.ts`, `src/components/dock/DockPanelContent.tsx`). It acquires display, window, or browser-tab sources through `getDisplayMedia` and watches the display video track for browser-side stopping (`src/services/capture/sourceAcquisition.ts`, `src/components/panels/capture/CapturePanel.tsx`).
- Recording requires an open project; completed recordings are force-copied into a root `Recordings` folder, with optional timeline placement and duration fallback only when the imported duration is not finite and positive (`src/components/panels/capture/CapturePanel.tsx`, `src/services/capture/recording/commitRecording.ts`).
- The MediaRecorder tier probes VP9, VP8, WebM, H.264/MP4, then MP4; it persists one-second chunks sequentially and awaits pending writes during pause and stop (`src/services/capture/recording/mediaRecorderBackend.ts`).
- The capture audio mix creates a stereo `MediaStreamAudioDestinationNode`, routes display and microphone audio through gain/analyser nodes, and the WebCodecs path taps the same bus through an AudioWorklet. The A/V clock removes pauses and applies a 100 ms drift guard (`src/services/capture/recording/audioMixing.ts`, `src/services/capture/recording/captureAudioEncoder.ts`, `src/services/capture/recording/syncClock.ts`).
- `getCaptureState` is a read-only AI-tool handler returning serializable service diagnostics and a recovery summary; the dev bridge documents `POST /api/ai-tools` (`src/services/aiTools/definitions/stats.ts`, `src/services/aiTools/handlers/capture.ts`, `src/services/aiTools/bridge.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “View → Panels → Screen Capture” and “Prefer screen/window/tab” → the menu item is **Capture** and the source buttons are **Screen**, **Window**, and **Browser tab** (`src/types/dock.ts`, `src/components/common/toolbar/ViewMenu.tsx`, `src/components/panels/capture/CapturePanel.tsx`).
- “Place recording on timeline” and “one placement history step” → the current label is **Place on timeline**; its placement is above the current edit, and the commit path takes an automatic import snapshot plus a placement snapshot on success (`src/components/panels/capture/CaptureSettings.tsx`, `src/services/capture/recording/commitRecording.ts`).
- The WebCodecs tier was described as an available experimental tier without its current release status → `flags.screenCaptureWebCodecs` is `false` by default in 2.4.4, so the default UI uses MediaRecorder and disables crop/scale (`src/engine/featureFlags.ts`, `src/components/panels/capture/CapturePanel.tsx`, `src/components/panels/capture/CaptureSettings.tsx`).
- “Completed fragments remain structurally readable after interruption” → restoration is offered only when a persisted run is marked recoverable; that marker is set by detecting `moof` and `mdat` bytes in a written run, not by structural validation (`src/services/capture/recording/captureMuxer.ts`, `src/services/capture/recording/webCodecsBackend.ts`, `src/components/panels/capture/CaptureControls.tsx`).

## Noteworthy / unusual

- The screen-capture panel is shipped, while `docs/ongoing/Screen-Capture-Panel-Plan.md` still says “Status: planning (review loop complete)”; that plan is stale rather than feature status ground truth.
- The user-facing Capture Panel calls the feature “Screen Capture,” but the dock/menu configuration calls it “Capture” (`src/components/panels/capture/CapturePanel.tsx`, `src/types/dock.ts`), creating intentional but potentially confusing naming drift.
- The recovery ledger is stored in localStorage while capture payloads use artifact storage; committed entries are removed during panel refresh and recovery artifacts are deleted after a successful commit (`src/services/capture/recording/recoveryPersistence.ts`, `src/components/panels/capture/CapturePanel.tsx`, `src/services/capture/recording/commitRecording.ts`).
- The experimental MP4 muxer has a 64 MB queued-packet safety limit and drops video frames once its queue reaches 75% of that limit (`src/services/capture/recording/captureMuxer.ts`, `src/services/capture/recording/captureVideoEncoder.ts`).
