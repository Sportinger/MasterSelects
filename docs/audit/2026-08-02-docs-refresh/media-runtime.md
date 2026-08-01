# Media-Runtime.md — audit 2026-08-02

## Verified (spot checks that held)

- The documented modules exist: `src/services/mediaRuntime/registry.ts`, `types.ts`, `clipBindings.ts`, and `runtimePlayback.ts`, plus `src/services/layerPlaybackManager.ts`.
- `MediaSourceRuntimeDescriptor` accepts `mediaFileId`, `File`, file name/size/last-modified metadata, file hash, and file path (`src/services/mediaRuntime/types.ts:36-46`).
- The four documented decode-session policies are exact: `interactive`, `background`, `export`, and `ram-preview` (`src/services/mediaRuntime/contracts.ts:5-9`). Sessions retain current time, access time, current-frame timestamp, and an optional frame provider (`src/services/mediaRuntime/types.ts:116-127`).
- Frame providers expose time, play/pause/seek, full/simple-mode checks, current-frame access, and optional debug information (`src/services/mediaRuntime/types.ts:60-106`).
- The registry caches cloneable frames, limits the source cache to 12 entries, releases cached frames on eviction, and uses insertion-order refresh as approximate LRU (`src/services/mediaRuntime/registry.ts:36-49`, `219-290`).
- Shared preview/scrub session-key helpers are used by preview and layer-building code, and only share when one active clip occupies the track and a full-mode provider is available (`src/services/mediaRuntime/runtimePlayback.ts:212-285`; `src/services/layerBuilder/VideoSyncManager.ts:281-284`; `src/services/layerBuilder/layerBuilderVideoSources.ts:99-102`).

## Outdated or wrong (claim → reality, with file evidence)

- “one runtime is retained per underlying source” → the registry retains one runtime per *resolved source ID*, not necessarily per underlying file. Source-ID resolution prioritizes `mediaFileId` over hash/path/file metadata, so separate media-file IDs can produce separate runtimes for the same file (`src/services/mediaRuntime/registry.ts:484-503`, `506-527`).
- “multiple sessions can … reuse a shared frame provider” → shared preview/scrub logic derives a common interactive session key and reuses that session’s provider; the registry itself stores one provider per session and can also read a nearby frame from a sibling session (`src/services/mediaRuntime/runtimePlayback.ts:234-285`, `389-416`; `src/services/mediaRuntime/registry.ts:374-414`).
- “slot/background layers bind clip sources through `bindSourceRuntimeForOwner(...)`” and “`layerPlaybackManager` updates runtime playback time as the slot layer runs” → the binding calls are in `slotDeckManager` for prepared video, audio, and image clips. `layerPlaybackManager` adopts an already prepared deck and handles session/runtime release; it contains no `updateRuntimePlaybackTime` call (`src/services/slotDeckManager.ts:235-241`, `316-322`, `356-362`; `src/services/layerPlaybackManager.ts:96-116`, `207-251`).
- “optional warm-slot decks can later adopt” understates the shipped implementation → warm-deck preparation/adoption is implemented but gated by `flags.useWarmSlotDecks`, which defaults to `false` (`src/services/layerPlaybackManager.ts:96-116`; `src/engine/featureFlags.ts:10`).

## Noteworthy / unusual

- The runtime domain is broader than the document described: it owns object-URL, media-element, and scrub-audio lease managers (`src/services/mediaRuntime/objectUrlLeases.ts`, `mediaElementLeases.ts`, `scrubAudioLeases.ts`) and has a persisted-state guard (`src/services/mediaRuntime/persistedStateGuard.ts`). Existing timeline helpers remain explicitly marked as legacy facades for some of these leases (`src/stores/timeline/helpers/blobUrlManager.ts:14`).
- `liveInputRuntime.ts` is a shipped media-runtime responsibility: it manages display capture, camera, and composition-feedback streams and is used by the media panel, properties panel, timeline placement, and layer builder (`src/services/mediaRuntime/liveInputRuntime.ts:71-105`, `147-310`; `src/components/panels/MediaPanel.tsx:205`; `src/services/timelinePlacementCommands.ts:603-605`).
- Full WebCodecs playback and warm slot decks are both disabled by default. `runtimePlayback.ts` can create a worker WebCodecs frame provider only when the render host supports it and the caller opts in; the separate main-thread helper also returns `null` while `useFullWebCodecsPlayback` is false (`src/services/mediaRuntime/runtimePlayback.ts:118-128`, `419-549`; `src/services/mediaRuntime/webCodecsPlayback.ts:141-205`; `src/engine/featureFlags.ts:7-10`).
- The registry, lease owners, and live-input runtime preserve their instances through Vite HMR (`src/services/mediaRuntime/registry.ts:603-618`; `src/services/mediaRuntime/liveInputRuntime.ts:313-332`; `src/services/mediaRuntime/objectUrlLeases.ts:286-302`).
