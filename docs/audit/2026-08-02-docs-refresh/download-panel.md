# Download-Panel.md — audit 2026-08-02

## Verified (spot checks that held)

- The active UI is the Downloads mode of the Media tray, not a standalone panel: `src/components/panels/media/MediaAIGenerativeTray.tsx` launches `download`, `MediaAIGenerativeTrayExpanded.tsx` renders `MediaDownloadComposer`, and `src/types/dock.ts` has no `download` or `youtube` `PanelType`.
- One pasted HTTP(S) URL is required before queueing and its helper format recommendations are shown before queueing: `src/components/panels/media/MediaDownloadComposer.tsx` calls `NativeHelperClient.listFormats` and rejects zero or multiple URLs.
- The Native Helper performs `yt-dlp` downloads, passes a selected `format_id`, streams progress, and retries bot-blocked requests with Chrome cookies: `src/services/nativeHelper/nativeHelperDownloadCommands.ts`, `tools/native-helper/src/download/ytdlp.rs`.
- File System Access downloads use `Downloads/<platform>/`, use sanitized titles, and look for existing files with supported media extensions: `src/services/project/domains/RawMediaService.ts`; the Media download queue uses that lookup only when no format is selected: `src/stores/mediaDownloadStore.ts`.
- Queue cards share the Media generation queue and support queued/downloading/ready/failed states and retry: `src/components/panels/media/MediaAIGenerationQueue.tsx`, `src/stores/mediaDownloadStore.ts`.
- The AI `listVideoFormats` and `downloadAndImportVideo` tools remain registered: `src/services/aiTools/definitions/youtube.ts`, `src/services/aiTools/handlers/index.ts`, `src/services/aiTools/handlers/youtube.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “The old `download` and `youtube` panel types are saved-layout migration targets” → neither is a current `PanelType`; the retirement ledger describes them as retired/deletion candidates. Evidence: `src/types/dock.ts`, `src/architecture/retiredPathLedger.ts`.
- “AI tools ... persist results in the legacy `youtubeStore` project payload” → searches write to `youtubeStore` in memory, but project save deletes `projectData.youtube` and project hydration resets the store. Evidence: `src/services/aiTools/handlers/youtube.ts`, `src/services/project/projectSave.ts`, `src/services/project/load/loadDockFlashboardHydration.ts`.
- “YouTube URLs use the oEmbed metadata path first” and “non-YouTube URL[s] ask the Native Helper” in the visible input flow → the prompt calls `NativeHelperClient.listFormats` for every single URL; oEmbed is only a later queue-metadata attempt for YouTube. Evidence: `src/components/panels/media/MediaDownloadComposer.tsx`, `src/stores/mediaDownloadStore.ts`.
- “A pending download clip is inserted ... at the current playhead” → the AI path uses an explicit `startTime` or appends after the occupied timeline; it does not read the current playhead. Evidence: `src/services/aiTools/handlers/youtube.ts` (`resolveYouTubeAppendPoint`).
- The codec-priority table (H.264, VP9, AV1, MP3) → helper recommendations skip AV1, choose up to six highest resolutions with H.264 preferred within each height, and add MP3 only if both an audio stream and `ffmpeg` exist. Video downloads are merged to MP4. Evidence: `tools/native-helper/src/download/ytdlp.rs` (`build_formats_response`, `run_download`).
- “Search without a YouTube API key is limited to pasted URLs/IDs” → AI YouTube search returns an error without a configured API key; the Media prompt accepts HTTP(S) URLs, not bare IDs. Evidence: `src/services/aiTools/handlers/youtube.ts`, `src/stores/mediaDownloadStore.ts`.
- The supported-platform table omits detected Dailymotion URLs. They are grouped in the Media panel as Dailymotion but saved under the File System Access `Downloads/Other/` folder because `RawMediaService` has no Dailymotion folder mapping. Evidence: `src/stores/mediaDownloadStore.ts`, `src/services/project/domains/RawMediaService.ts`.

## Noteworthy / unusual

- The download queue runs at most two jobs concurrently (`MAX_RUNNING_DOWNLOADS = 2`), a shipped capability the original document did not mention. Evidence: `src/stores/mediaDownloadStore.ts`.
- Native-backend download-folder save and duplicate lookup currently call the File System Access project-handle path, which is unavailable for the native backend; the resulting downloaded `File` is then imported with `forceCopyToProject` and routed into native `Raw/`. Evidence: `src/services/project/fileService/rawMediaRouting.ts`, `src/services/project/ProjectFileService.ts`, `src/stores/mediaDownloadStore.ts`, `src/stores/mediaStore/helpers/importPipeline.ts`.
- `cancelDownload` only marks client-side download state and contains a TODO to notify the Native Helper; the Media queue does not expose download cancellation. Evidence: `src/services/youtubeDownloader.ts`, `src/components/panels/media/MediaAIGenerationQueue.tsx`.
- The code still contains legacy YouTube terminology in store, timeline types, IDs, and tool handlers although the active UI is generic URL download. Evidence: `src/stores/youtubeStore.ts`, `src/stores/timeline/downloadClipSlice.ts`, `src/services/youtubeDownloader.ts`.
