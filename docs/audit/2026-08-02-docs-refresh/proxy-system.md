# Proxy-System.md — audit 2026-08-02

## Verified (spot checks that held)

- The active generator is `ProxyGeneratorWebCodecs` in `src/services/proxyGenerator.ts`; it demuxes with MP4Box, configures WebCodecs from `avcC`, `hvcC`, `vpcC`, or `av1C`, and encodes JPEGs through `src/workers/proxyFrameEncodeWorker.ts` when Dedicated Workers are available.
- The documented settings match `src/services/proxyGeneration/constants.ts`: 1280 px maximum width, 30 fps, 30-sample decode batches, JPEG quality 0.82, an eight-worker maximum, and two reserved hardware threads.
- `src/stores/mediaStore/slices/proxySlice.ts` enables the queue when proxy mode turns on, handles one `currentlyGeneratingProxyId` at a time, restarts the queue after completion, and starts the queue after a video import through `src/stores/mediaStore/slices/fileImport/placeholderLifecycle.ts`.
- The 98% completion threshold is implemented by `src/stores/mediaStore/helpers/proxyCompleteness.ts`; `mp4-all-intra` is explicitly treated as incomplete by `src/stores/mediaStore/slices/proxySlice.ts`.
- Pack storage, index fields, legacy JPEG/WebP reads, and WAV/M4A audio fallbacks match `src/services/project/domains/ProxyStorageService.ts` and `src/services/project/domains/proxyStorage/proxyPackIndex.ts`.
- Cache and warmup claims hold: `src/services/proxyFrame/frameCacheOps.ts` caps legacy image frames at 900, `src/services/proxyFrame/preloadScheduler.ts` uses a 90-frame scrub range and 16 parallel loads, and `src/stores/timeline/proxyCacheSlice.ts` seeks nested-composition video elements in 0.5-second steps.

## Outdated or wrong (claim → reality, with file evidence)

- `Proxy/{mediaId}/` storage layout → video proxy directories are keyed by `mediaFile.fileHash || mediaFileId`, so the accurate layout is `Proxy/{storageKey}/`. Evidence: `src/stores/mediaStore/slices/proxySlice.ts` and `src/services/project/domains/ProxyStorageService.ts`.
- The pipeline described Dedicated Workers as unconditional → `src/services/proxyGenerator.ts` falls back to a main-thread `OffscreenCanvas` pool when Dedicated Workers are unavailable. Evidence: `src/services/proxyGeneration/workerCapabilities.ts` and `src/services/proxyGenerator.ts`.
- “all-intra MP4 proxy path remains ... for quick reactivation” → MP4 proxy types and storage methods remain, but no active MP4 generator or playback path was found; the JPEG render paths explicitly exclude `mp4-all-intra`. Evidence: `src/stores/mediaStore/types.ts`, `src/services/project/domains/ProxyStorageService.ts`, `src/components/timeline/utils/layerSyncProxyFrames.ts`, and `src/services/compositionRender/layerEvaluation.ts`.
- Audio location described only as the project audio-proxy folder → current exact folder name is `Audio Proxies/`, with a sanitized storage-key filename. Evidence: `src/services/project/core/constants.ts` and `src/services/project/domains/ProxyStorageService.ts`.
- “Proxies are stored inside the project folder” without backend qualification → image proxy-frame operations require an FSA project handle; the Native Helper delegates audio proxy operations but has no image-frame equivalent. Evidence: `src/services/project/fileService/artifactStorageDelegates.ts` and `src/services/project/fileService/nativeBackend.ts`.

## Noteworthy / unusual

- Proxy generation now feeds scene-cut analysis in the same decode pass when no current analysis exists; the feature doc did not mention it. Evidence: `src/services/proxyGenerator.ts` and `src/stores/mediaStore/slices/proxySlice.ts`.
- The repository still contains an IndexedDB `PROXY_FRAMES` store and CRUD helpers, but active JPEG playback deliberately reads only the project folder and has no IndexedDB fallback. Evidence: `src/services/projectDB.ts`, `src/services/projectDb/proxyFrames.ts`, and `src/services/proxyFrame/proxyStorageSources.ts`.
- JPEG proxy frames can be used while generation is in progress once progress is non-zero, rather than only after the final ready state. Evidence: `src/components/timeline/utils/layerSyncProxyFrames.ts`.
