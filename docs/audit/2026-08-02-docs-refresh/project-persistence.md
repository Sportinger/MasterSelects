# Project-Persistence.md — audit 2026-08-02

## Verified (spot checks that held)

- `project.json`, `project.autosave.json`, `.keys.enc`, `Raw/`, `Downloads/`, `Proxy/`, `Audio Proxies/`, `Cache/`, `Analysis/`, `Transcripts/`, `Renders/`, and `Backups/` are current project-folder concepts. Evidence: `src/services/project/core/constants.ts`, `src/services/project/core/projectCorePersistence.ts`, `src/services/project/core/ProjectCoreService.ts`.
- The FSA handle store is named `fsHandles`; recent projects are capped at 12 and use browser storage plus FSA handle records. Evidence: `src/services/projectDb/stores.ts`, `src/services/project/recentProjects.ts`.
- Continuous save is the default, debounced by one second; interval mode creates a backup before saving and defaults to five minutes. Evidence: `src/stores/settingsStore.ts`, `src/services/project/projectLifecycle.ts`, `src/components/common/Toolbar.tsx`.
- Backup retention is 20 files, ordered by modification time for both backends. Evidence: `src/services/project/core/constants.ts`, `src/services/project/core/ProjectCoreService.ts`, `src/services/project/core/NativeProjectCoreService.ts`.
- Current project loading prefers a newer, meaningful `project.autosave.json`; the document's warning that unload writes are best-effort is accurate. Evidence: `src/services/project/core/autosaveRecovery.ts`, `src/services/project/core/projectCorePersistence.ts`, `src/services/project/projectLifecycle.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Native Helper (Firefox)” / Firefox-only framing → Native persistence is selected when FSA is unavailable and the helper is available; the Welcome Overlay explicitly uses that capability test, not a Firefox-only branch. Evidence: `src/components/common/WelcomeOverlay.tsx`, `src/services/project/ProjectFileService.ts`.
- The initial-folder list and `PROJECT_FOLDERS` example were incomplete → current constants also create `Raw/Baked Audio`, `Audio Proxies`, `Cache/face-thumbnails`, `Cache/splats`, `Prompts`, and `AI/Chat`. Evidence: `src/services/project/core/constants.ts`.
- `ProjectFile` showed `youtube?: ProjectYouTubeState` and said the YouTube panel is saved → current save removes `youtube`; the actual root fields include `signals`, `audio`, `flashboard`, `storyboard`, and generated-item arrays. Evidence: `src/services/project/types/project.types.ts`, `src/services/project/projectSave.ts`.
- Automatic dirty marking listed YouTube state but omitted active persisted sources → current lifecycle subscribes to MIDI, FlashBoard, storyboard, export, dock, media, and timeline state; no YouTube subscription exists. Evidence: `src/services/project/projectLifecycle.ts`.
- UI-state coverage omitted media-board state, audio/timeline display controls, and project history → all are defined in `ProjectUIState` and serialized on save. Evidence: `src/services/project/types/project.types.ts`, `src/services/project/projectSave.ts`.
- “Reload All” in the Media Panel → the current control is `Relink (n)` and opens `RelinkDialog`; individual missing items still use a reload path. Evidence: `src/components/panels/media/panel/MediaPanelHeader.tsx`, `src/components/panels/media/panel/MediaPanelOverlayMounts.tsx`, `src/components/panels/media/panel/useMediaPanelSelectionCommands.ts`.
- Storage comparison called proxy frames “legacy” → proxy frames remain an active IndexedDB store and project proxy service. Evidence: `src/services/projectDb/stores.ts`, `src/services/project/domains/ProxyStorageService.ts`.
- The test table claimed exact counts of 86 and 16 → repository test declarations do not match those stale figures (27 in `serialization.test.ts`, 73 in `historyStore.test.ts` as counted by `rg`); the document now avoids unsupported counts. Evidence: `tests/unit/serialization.test.ts`, `tests/stores/historyStore.test.ts`.

## Noteworthy / unusual

- FlashBoard chat has an additional project-folder persistence channel: `AI/Chat/history.json`, with `history.autosave.json` if the primary journal write fails. This is separate from the FlashBoard state embedded in `project.json`. Evidence: `src/services/project/flashBoardChatProjectJournal.ts`, `src/services/project/projectSave.ts`.
- Both FSA and Native core services refuse an empty overwrite when a recoverable autosave contains meaningful content; this defensive behavior is more than the document's swap-write explanation. Evidence: `src/services/project/core/ProjectCoreService.ts`, `src/services/project/core/NativeProjectCoreService.ts`, `src/services/project/core/autosaveRecovery.ts`.
- The document's architecture tree is intentionally partial: the live service now also contains `fileService/`, `load/`, `relink/`, and `storyboard/` submodules. Evidence: `src/services/project/fileService/`, `src/services/project/load/`, `src/services/project/relink/`, `src/services/project/storyboard/`.
- The displayed “Back to Index” label is mojibake (`[ƒÅ? Back to Index]`) in the source document; its relative link still points to `./README.md`.
