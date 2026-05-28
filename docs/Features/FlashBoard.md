[Back to Index](./README.md)

# FlashBoard

FlashBoard is the AI generation runtime behind the Media Panel's bottom-right prompt tray. Its compact composer supports text-to-video, image-to-video, image generation, ElevenLabs text-to-speech, and Suno music generation, with direct import into the Media Pool.

> **Status:** Implemented. The compact composer is active inside Media, queued, persisted with the project, and connected to the current AI provider catalog.

---

## What It Does

FlashBoard is not a separate model backend. It is a composer/runtime layer on top of the existing AI services:

- `piapi` for the PiAPI catalog
- `kieai` for Kie.ai Kling 3.0, Seedance 2.0, Seedance 2.0 Fast, and Nano Banana 2
- `cloud` for hosted Kling 3.0, hosted Seedance 2.0 / Fast, hosted Nano Banana 2, hosted ElevenLabs speech, and hosted Suno music
- `elevenlabs` for development/BYO text-to-speech audio generation
- `suno` for development/BYO Kie.ai-backed Suno music generation
- compact chat for prompt discussion and editor actions through hosted OpenAI/Cloud in production, with Anthropic or local Lemonade still available only in non-production development; requests include the Media-chat system prompt, current timeline summary, and callable AI tools routed through the shared chat dispatcher

The Media Panel generator tray offers two collapsed launch actions: `Generate` opens the normal generation prompt, while `Chat` opens a separate chat prompt window with provider/model/temperature controls and OpenAI reasoning effort for GPT-5.x models. If only an ElevenLabs key is configured, the generation composer starts on the audio text-to-speech target. If Kie.ai or hosted cloud access is also available, the generation composer can still switch between video, image, and audio targets. `Generate` remains the only action that queues media generation.

---

## Current Runtime Structure

FlashBoard is composed of:

- `MediaAIGenerativeTray` - Media Panel bottom-right expand/collapse shell
- `MediaAIGenerationQueue` - compact Media Panel preview cards for queued, processing, failed, and canceled generation nodes
- `useFlashBoardRuntime` - board initialization plus queue/import callbacks
- `FlashBoardComposer` - provider/output selection, separate generate/chat prompt windows, ordered media reference cards, compact chat controls, text-to-speech or music editing, durations, aspect ratio, image size, multi-shot setup, audio voice settings, and Suno song controls

Boards are persisted inside the project state. The active board is restored on project load, and generation metadata is serialized alongside the board state.

---

## Node Lifecycle

Nodes move through the following states:

- `draft`
- `queued`
- `processing`
- `completed`
- `failed`
- `canceled`

There are two node kinds:

- `generation` - an actual AI request
- `reference` - a media reference used by generation requests or saved board state

Generation nodes can include:

- prompt
- provider and version
- output type (`video`, `image`, or `audio`)
- duration and aspect ratio
- optional start and end media
- optional reference media list
- optional multi-shot prompt sequence
- optional generated-video audio
- ElevenLabs voice id/name, language override, output format, and voice settings for audio nodes
- Suno custom/simple mode, instrumental/vocal mode, title, style, negative tags, vocal gender, and tuning weights for music nodes

---

## Provider Matrix

The composer uses the shared catalog from `FlashBoardModelCatalog`:

- PiAPI video providers from the shared PiAPI catalog
- Kie.ai Kling 3.0 video
- Kie.ai Seedance 2.0 and Seedance 2.0 Fast video with image, video, and audio references, including audio-driven lip-sync reference mode
- Kie.ai Nano Banana 2 image generation
- Cloud Kling 3.0 video
- Cloud Seedance 2.0 and Seedance 2.0 Fast video with image, video, and audio references
- Cloud Nano Banana 2 image generation
- Cloud ElevenLabs text-to-speech audio generation
- Cloud Suno music generation
- BYO ElevenLabs text-to-speech audio generation
- BYO Suno music generation via Kie.ai in development

The compact composer exposes the richer FlashBoard catalog.

---

## Generation Flow

1. The user creates a draft node from the composer.
2. The store captures the current request on that node.
3. `FlashBoardJobService` queues the node.
4. The Media Panel queue renders a preview card with status and elapsed time while the job is queued or processing.
5. Jobs run with a concurrency cap of 3 overall, but only 1 Kie.ai job at a time.
6. The selected video/image service submits the remote task and polls until completion.
7. ElevenLabs audio jobs create speech directly and return an audio `File` without remote polling. BYO development jobs call ElevenLabs from the browser with the user's local key; Cloud jobs call `/api/ai/audio` and spend hosted credits.
8. Suno music jobs use Cloudflare `/api/ai/audio` in production, where the server calls Kie.ai with `KIEAI_API_KEY`, spends hosted credits, polls the task until a generated audio URL is available, then imports the downloaded audio. Non-production BYO jobs can still call Kie.ai with the local default key.
9. On success, `FlashBoardMediaBridge` imports the asset into the Media Pool and marks the node complete.

Kie.ai Market video/image tasks are asynchronous. A successful create call only returns a `taskId`; FlashBoard polls `GET /api/v1/jobs/recordInfo?taskId=...` and maps Kie states such as `waiting`, `queuing`, `generating`, `success`, and `fail` into local job states. The local `canceled` state only means MasterSelects stopped tracking the node; Kie.ai does not currently expose a documented Market task cancel endpoint, so the Kie logs page and `recordInfo` response remain the server-side source of truth.

Image generation is handled alongside video generation. The code path resolves previewable reference images from media files, including thumbnails for video sources or a captured frame when needed. The compact composer also accepts media-panel image, video, and audio references through right-click or drag-and-drop; Kie.ai and Cloud Seedance jobs upload local files through Kie.ai file hosting and map them to provider-specific inputs such as Nano Banana `image_input`, Kling `kling_elements`, or Seedance multimodal reference URL arrays. Seedance 2.0 standard exposes 480p, 720p, and 1080p; Seedance 2.0 Fast exposes 480p and 720p. Both use `reference_audio_urls` for audio-driven sync. Because Kie.ai treats Seedance first/last-frame mode and multimodal reference mode as mutually exclusive, any Seedance request with generic references sends IN/OUT images as image references with prompt guidance instead of `first_frame_url` / `last_frame_url`.

The composer wand has Seedance-specific prompt-refiner guidance. When Seedance is selected it asks the refiner to write concise cinematic motion, camera, continuity, and final-state instructions; preserve explicit REF labels; and treat audio references as performance, speech, mouth-shape, rhythm, or timing drivers rather than background music. Seedance reference-to-video mode sends `generate_audio: false` because Kie.ai treats multimodal reference audio as an input driver, not the native audio-generation switch. The composer therefore hides the `Sound` toggle for Seedance while REF media is attached; the audio card itself controls the timing. Seedance audio references are only valid when paired with at least one visual IN/REF image or video anchor.

---

## Media And Timeline Integration

FlashBoard uses the same drag payload as the rest of the app:

- `application/x-media-file-id`

Completed assets are imported under:

- `AI Gen / Video`
- `AI Gen / Images`
- `AI Gen / Audio`

The bridge stores generation metadata keyed by imported media file ID so project save/restore can round-trip the generated asset provenance. The imported asset can be dragged to the timeline or inserted directly at the playhead. Audio nodes use the same external drag payload as Media Panel audio and route to audio tracks.

Media Panel image, video, and audio files can also be dragged onto the prompt composer to append them to the ordered reference strip. Right-clicking supported media files in Classic, Icons, or Board view toggles the same reference state and opens the generator tray.

---

## Access Rules

The prompt tray is Cloud-first by default:

- signed-in users see hosted Cloud models and hosted credit prices by default
- personal API-key providers stay hidden until the API-key settings section is unlocked with the internal shortcut
- production ignores personal provider keys for hosted AI generation/chat and uses Cloudflare secrets only
- in development, a personal key is only used when the key exists and that provider is marked `Use as default instead of Cloud credits`
- if no personal key is marked as default, matching Cloud models are selected and priced in MasterSelects credits
- BYO-only providers such as PiAPI, EvoLink, BYO ElevenLabs, and BYO Suno are only exposed in development when their backing personal key is enabled as default

Hosted generation requests are credit-backed and authenticated. There is no anonymous hosted generation path.
Hosted ElevenLabs speech is metered by text length. The client shows a preflight credit estimate from the selected text/model, and the Cloudflare route finalizes the charge from the ElevenLabs `x-character-count` response header when available.
Hosted Suno music uses the Cloudflare `KIEAI_API_KEY` secret and is charged as MasterSelects credits through `/api/ai/audio`. Compact hosted chat shows the per-model-round credit estimate; tool follow-up model rounds are charged separately.

---

## Limitations

- The composer does not add a new backend provider. It delegates to the existing AI services.
- Generated URLs are temporary, so imports force a local project copy.
- ElevenLabs text-to-speech returns an MP3 `File` directly and is copied into project storage during import.
- Suno music depends on Kie.ai's polling API and imports the first returned audio result.
- The composer is still bound by provider-specific feature support in the catalog.
- Some Kie.ai reference behaviors are model-specific: Nano Banana consumes image inputs, Kling consumes element references, and Seedance consumes separate image/video/audio reference arrays.

---

## Source Map

- `src/components/panels/media/MediaAIGenerativeTray.tsx`
- `src/components/panels/flashboard/useFlashBoardRuntime.ts`
- `src/components/panels/flashboard/FlashBoardWorkspace.tsx`
- `src/components/panels/flashboard/FlashBoardToolbar.tsx`
- `src/components/panels/flashboard/FlashBoardCanvas.tsx`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/services/flashboard/FlashBoardJobService.ts`
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- `src/services/flashboard/FlashBoardPricing.ts`
- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/stores/flashboardStore/*`
