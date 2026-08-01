# FlashBoard.md &mdash; audit 2026-08-02

## Verified (spot checks that held)

- The Media Panel embeds `MediaAIGenerativeTray`, `MediaAIGenerationQueue`, `FlashBoardComposer`, `useFlashBoardRuntime`, `FlashBoardJobService`, and `FlashBoardMediaBridge` at the documented paths under `src/components/panels/media/`, `src/components/panels/flashboard/`, and `src/services/flashboard/`.
- The generation lifecycle is `draft`, `queued`, `processing`, `completed`, `failed`, and `canceled` in `src/stores/flashboardStore/types.ts`; the queue renders those terminal and active states in `src/components/panels/media/MediaAIGenerationQueue.tsx`.
- Projects serialize the composer, generation records, prompt history, chat messages, and generation metadata in `src/services/project/projectSave.ts`, and hydrate them in `src/services/project/load/loadDockFlashboardHydration.ts`.
- AI-generated media is imported under `AI Gen / Video`, `AI Gen / Images`, or `AI Gen / Audio` and uses `application/x-media-file-id` for timeline dragging in `src/services/flashboard/FlashBoardMediaBridge.ts`.
- Hosted Suno uses `/api/ai/audio`, Kie polling, optional `streamAudioUrl`, and a stateless `/api/ai/suno/callback` acknowledgement route in `src/services/flashboard/FlashBoardProviderRunners.ts`, `functions/lib/kieai.ts`, and `functions/api/ai/suno/callback.ts`.

## Outdated or wrong (claim &rarr; reality, with file evidence)

- `piapi` and standalone `elevenlabs` are current FlashBoard services -> `FlashBoardService` is only `'cloud'`; the visible Media catalog filters to authenticated Cloud entries. Evidence: `src/stores/flashboardStore/types.ts`, `src/components/panels/flashboard/FlashBoardModelOptionsPlanner.ts`, `src/components/panels/media/MediaAIGenerativeTrayExpanded.tsx`.
- The collapsed tray has only `Generate` and `Chat` -> it also has `Downloads`. Evidence: `src/components/panels/media/MediaAIGenerativeTray.tsx`.
- FlashBoard restores a persisted active board and reference nodes -> the retired board-workspace state key list is empty and active records have only `kind: 'generation'`; reference media belongs to the composer request. Evidence: `src/stores/flashboardStore/types.ts`, `src/stores/flashboardStore/activeGenerationRecords.ts`.
- The catalog includes PiAPI providers and Seedance multimodal image/video/audio references -> the current Cloud-only catalog contains the listed Kie video, image, voice, music, and sound entries; Seedance generic multimodal references are explicitly disabled. Evidence: `src/services/flashboard/FlashBoardModelCatalog.ts`, `src/services/flashboard/seedanceReferenceRules.ts`.
- Overall generation concurrency is capped at 3 -> `FlashBoardJobService.maxConcurrent` is 100. Evidence: `src/services/flashboard/FlashBoardJobService.ts`.
- The Seedance section describes active audio-reference sync and a reference-mode Sound toggle -> requests with generic Seedance references fail validation and instruct users to use IN/OUT frames. Evidence: `src/services/flashboard/seedanceReferenceRules.ts`, `src/services/flashboard/FlashBoardProviderRunners.ts`.
- The Suno duration range was mojibake in the document -> `MIN_SUNO_DURATION` and `MAX_SUNO_DURATION` are 10 and 360 seconds. Evidence: `src/services/sunoContracts.ts`.

## Noteworthy / unusual

- `FlashBoardChatConfig.ts` exposes only the Kie provider to the UI, but retains an internal `kernel` model option; this aligns with the separate private kernel boundary and should not be presented as a local FlashBoard provider.
- The source map remains accurate, but it is intentionally selective: active supporting modules now include `FlashBoardProviderRunners.ts`, `FlashBoardChatConfig.ts`, and `seedanceReferenceRules.ts`.
- Job cancellation is deliberately local for a running provider task: `FlashBoardJobService.cancel()` aborts local tracking and warns that provider processing and billing may continue.
