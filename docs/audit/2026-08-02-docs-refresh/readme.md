# README.md — audit 2026-08-02

## Verified (spot checks that held)

- The source-map paths exist: `src/components/`, `src/components/timeline/`, `src/components/preview/`, `src/components/outputManager/`, `src/components/panels/`, `src/stores/`, `src/stores/mediaStore/`, `src/engine/`, `src/effects/`, `src/shaders/`, `src/transitions/`, `src/services/`, and `tools/native-helper/`.
- The core implementation claims are supported by code: `src/engine/WebGPUEngine.ts` owns WebGPU render targets; `src/services/project/core/ProjectCoreService.ts` reads/writes `project.json` and creates backups; `src/services/capture/ScreenCaptureService.ts` and `src/components/panels/capture/CaptureControls.tsx` implement capture controls; and `src/types/liveInput.ts` plus `src/services/liveInputTimeline.ts` support live timeline sources.
- Nested compositions, transition, keyframe, mask, audio, 3D/splat, Lottie/Rive, and export areas all have corresponding implementation directories or modules under `src/` and current feature documents.
- `openComposition` and `searchVideos` are both public definitions and dispatched handlers: `src/services/aiTools/definitions/media.ts`, `src/services/aiTools/definitions/youtube.ts`, and `src/services/aiTools/handlers/index.ts`.
- The Rust Native Helper remains present at `tools/native-helper/`, with WebSocket/HTTP servers and yt-dlp support in `tools/native-helper/src/main.rs`, `server.rs`, `http_server.rs`, and `download/ytdlp.rs`.

## Outdated or wrong (claim → reality, with file evidence)

- “`staging` branch” → the checked-out repository branch is `master` (`git branch --show-current`). Updated.
- “Version 2.0.6 | May 2026” and both later “current version 2.0.6” lines → version is `2.4.4` in `package.json` and `src/version.ts`. Updated.
- “OpenAI/Cloud or local Lemonade chat” / stack reference to “local Lemonade chat” → hosted chat defaults to Kie.ai in `functions/api/ai/chat.ts`; Lemonade settings are explicitly retired in `src/stores/settingsStore.ts`. Updated to hosted Kie.ai chat.
- “86 exported model tools” → `src/services/aiTools/definitions/index.ts` currently spreads 21 definition sets; their concrete definitions total 169 tools. Gaussian debug definitions in `definitions/gaussian.ts` are still not included. Updated.
- Screen Capture documentation says WebCodecs crop/scale recording is available → `src/engine/featureFlags.ts` sets `screenCaptureWebCodecs: false`, and `src/services/capture/recording/webCodecsBackend.ts` rejects use while disabled. Updated both index descriptions to identify it as disabled.
- Three index links are dead: `./Color-Correction-Professional-Plan.md`, `./Guided-Action-Runtime-Plan.md`, and `../cloudflare-hosted-ai-setup.md` do not exist. Removed from the index.
- The AI stack names EvoLink and PiAPI-compatible catalog paths, but the current client/server sources provide no active implementation reference beyond rejected legacy API-key handling in `functions/lib/noByok.ts`. Removed from the stack summary.

## Noteworthy / unusual

- Storyboard scene cards and MIDI tracks/clips are shipped in the client (`src/stores/storyboardStore/`, `src/services/storyboard/`, `src/stores/timeline/midiClipSlice.ts`, and `src/components/timeline/utils/trackContextMenu.ts`) but were omitted from the overview; added a concise highlight.
- Audio-synced multicam assembly and queued source-media batch export are also shipped (`src/components/timeline/MulticamDialog.tsx`, `src/components/timeline/utils/clipContextMenu.ts`, `src/components/export/ExportPanel.tsx`, and `src/components/export/batch/BatchExportQueue.tsx`) but had no overview mention; added one.
- FlashBoard’s old board-workspace state is explicitly classified as retired (`src/stores/flashboardStore/types.ts`), while the active generation tray/chat remains under `src/components/panels/flashboard/` and `src/services/flashboard/`.
- The repository contains `src/services/kernelClient/`, but the kernel server is not present here; the source map now labels the client boundary rather than implying a server implementation.
- The 2.4.4 changelog notice in `src/version.ts` calls out resumable parallel cloud transcription, faster nested-composition playback, waveform-first audio compositions, FAST-export preparation, and safer frame capture; these are significant current capabilities not called out by the prior v2.0.6 index.
