[Back to Features](./README.md)

# Screen Capture

MasterSelects can record a browser tab, application window, or display directly into the open project. Open **View → Panels → Screen Capture**, choose a preferred source type, and complete the browser's sharing picker. The browser remains the authority: the preference is a hint and never bypasses its permission UI.

## Recording flow

1. Open or create a project. Captures are copied into project storage, so recording is unavailable without one.
2. Choose **Prefer screen**, **Prefer window**, or **Prefer tab** and inspect the live preview.
3. Set frame rate, quality, cursor, captured audio, microphone, and optional timeline placement. Audio-input changes apply on the next source selection.
4. Press **Record**. Recording can be paused, resumed, or stopped. Using the browser's **Stop sharing** action also finalizes the session.
5. The result is imported into the root `Recordings` Media Library folder. With **Place recording on timeline** enabled, one placement history step is added; undo removes the clip without removing the imported media.

The panel reports storage warnings before recording and shows live elapsed time, estimated size, and audio meters. The debug bridge adds encoder pressure and dropped-frame telemetry. Captured tab muting only prevents local tab playback; it is not echo cancellation.

While capture is recording, a pulsing **REC** button appears immediately left of the Credits pill in the top toolbar. It remains visible without pulsing while paused, and opens the Capture panel when clicked.

## Capture tiers

The default compatibility tier uses `MediaRecorder`, selecting the first supported VP9, VP8, WebM, H.264/MP4, or MP4 MIME type. Timeslice blobs are written sequentially to capture-specific recovery artifacts and are not retained in memory.

The experimental WebCodecs tier is controlled by `flags.screenCaptureWebCodecs`. It provides crop and output scaling, H.264 video, AAC-with-Opus-fallback audio, a shared pause-aware A/V clock, time-based keyframes, encoder-pressure frame dropping, and fragmented MP4 output. Crop coordinates are mapped through the preview's letterboxing and aligned for 4:2:0 encoding. Scaling follows the Linux/Mesa canvas rules and uses the software timeline-canvas preference where required.

WebCodecs output is streamed through MediaBunny's positioned `StreamTarget` writes. Each `{position, data}` run is persisted before backpressure is released, so long sessions do not accumulate a complete MP4 in RAM. Current telemetry is available through the AI debug bridge's `getCaptureState` tool, including queued packet bytes, persisted artifact bytes, output bytes, encoder queue size, and dropped frames.

## Audio

Captured display/tab audio and the selected microphone are mixed once through a Web Audio graph. Separate gain/analyser routes feed a stereo recording bus without a speaker destination. The compatibility tier consumes the resulting stream directly. The WebCodecs tier taps the same bus through an AudioWorklet and incrementally encodes planar PCM. Pause intervals are removed from both media clocks, and a 100 ms wall-clock drift guard rebases anomalous timestamps.

Browser picker support varies. Tab capture is the most reliable source of captured audio; many window or display selections expose no audio track. The panel reports the track actually supplied rather than assuming audio from the requested constraints.

On import, a valid duration probed from the completed recording file remains authoritative for Source Monitor and timeline placement. The recorder clock is used only when file probing cannot provide a finite positive duration. When the clip loads, that imported duration also takes precedence over a shorter initial WebM duration reported by the browser, keeping linked video and audio clips at the full recording length.

## Recovery

Uncommitted sessions reappear in the panel after reload:

- MediaRecorder recovery concatenates persisted chunks in order. A truncated WebM/MP4 prefix is browser-dependent, so the UI labels this path **best-effort** and warns that it may be shorter than the session.
- WebCodecs recovery replays positioned runs in write order, with later writes overwriting earlier bytes, to reconstruct a fragmented MP4 prefix. Completed fragments remain structurally readable after interruption.

Recovery is durably marked committed before placement. Retrying a committed session cannot import or place a duplicate. Dismissing a recovery entry deletes its capture artifacts.

## Limits and safety

- Screen/window capture always requires browser permission and transient user activation.
- DRM, elevated windows, or platform compositor restrictions can produce black frames.
- Wayland capture uses the desktop portal and may deliver lower frame rates. The MediaRecorder tier remains the safe default on Linux.
- Crop and scale require the feature-flagged WebCodecs tier. Source dimension changes stop a cropped recording rather than silently changing its geometry.
- WebCodecs capture is blocked while an export is active and suspends automatic preview-quality resets for the session.
- There is no webcam overlay, scene switching, global hotkey, native-helper capture, or RTMP/WHIP streaming in this release.

## Diagnostics

Use `getCaptureState` through `POST /api/ai-tools` to read a runtime-safe snapshot. It contains no `MediaStream`, track, AudioContext, encoder, Blob, or other live handle. `getStats`, browser logs under the `ScreenCapture` module, and recovery-ledger summaries provide additional evidence for long-session and interruption testing.
