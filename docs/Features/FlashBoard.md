[Back to Index](./README.md)

# FlashBoard

FlashBoard is the AI generation runtime behind the Media Panel's bottom-right prompt tray. Its compact composer supports text-to-video, image-to-video, image generation, ElevenLabs text-to-speech, and Suno music generation, with direct import into the Media Pool. Projects persist the last selected model plus per-model generation settings. Prompt refinement treats START and END frame references as supplied video anchors and focuses on the motion between them instead of redescribing the images.

> **Status:** Implemented. The compact composer is active inside Media, queued, persisted with the project, and connected to the current AI provider catalog.

---

## What It Does

FlashBoard is not a separate model backend. It is a composer/runtime layer on top of the existing AI services:

- `piapi` for the PiAPI catalog
- `kieai` for Kie.ai Kling 3.0, Seedance 2.0, Seedance 2.0 Fast, and Nano Banana 2
- `cloud` for hosted Kling 3.0, hosted Seedance 2.0 / Fast, hosted Nano Banana 2, hosted ElevenLabs speech, and hosted Suno music
- `elevenlabs` for lower-level development compatibility; the Media generator tray uses hosted speech
- `suno` for lower-level development compatibility; the Media generator tray uses hosted Kie.ai-backed Suno generation
- compact chat for prompt discussion and editor actions through hosted OpenAI/Cloud in production, with Anthropic or local Lemonade still available only in non-production development; requests include the Media-chat system prompt, current timeline summary, and callable AI tools routed through the shared chat dispatcher

The Media Panel generator tray offers two collapsed launch actions: `Generate` opens the normal generation prompt, while `Chat` opens a separate chat prompt window with provider/model/temperature controls and OpenAI reasoning effort for GPT-5.x models. The generator tray uses hosted Cloud entries for Kie.ai-backed media; local/BYO Kie.ai keys do not replace that path. `Generate` remains the only action that queues media generation.

---

## Current Runtime Structure

FlashBoard is composed of:

- `MediaAIGenerativeTray` - Media Panel bottom-right expand/collapse shell
- `MediaAIGenerationQueue` - compact Media Panel preview cards for queued, processing, failed, and canceled generation nodes, including model/settings labels and local cancellation for running AI jobs
- `useFlashBoardRuntime` - board initialization plus queue/import callbacks
- `FlashBoardComposer` - provider/output selection, separate generate/chat prompt windows, ordered media reference cards, compact chat controls, text-to-speech or music editing, durations, aspect ratio, image size, multi-shot setup, audio voice settings, and Suno song controls

Boards are persisted inside the project state. The active board is restored on project load, generation metadata is serialized alongside the board state, and the prompt book keeps the project's generated and chat prompts available for review and copy. Prompt book generation pages group outputs by user prompt, show the Magic Wand prompt when one produced the final request, and preview generated images/videos directly on the page.

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
- Kie.ai Veo 3.1 and Runway video generation
- Kie.ai Topaz Video Upscale with required video reference input
- Kie.ai Nano Banana 2, Nano Banana Pro, Imagen 4, GPT Image 2, Flux 2, Seedream 5 Lite, Flux Kontext, Recraft, and Topaz image generation/edit/utility entries
- Cloud Kling 3.0 video
- Cloud Seedance 2.0 and Seedance 2.0 Fast video with image, video, and audio references
- Cloud Nano Banana 2 image generation
- Cloud ElevenLabs text-to-speech audio generation
- Cloud Suno music generation
- BYO catalog entries remain available for lower-level development compatibility, but the Media generator tray exposes the hosted Cloud path only

The compact composer exposes the richer FlashBoard catalog.

---

## Generation Flow

1. The user creates a draft node from the composer.
2. The store captures the current request on that node.
3. `FlashBoardJobService` queues the node.
4. The Media Panel queue renders a preview card with status and elapsed time while the job is queued or processing.
5. Jobs run with a concurrency cap of 3 overall, but only 1 Kie.ai job at a time.
6. The selected media service submits the remote task and polls until completion when the provider is asynchronous.
7. ElevenLabs audio jobs create speech through `/api/ai/audio` and return an audio `File` without remote polling.
8. Suno music and Suno Sounds jobs use Cloudflare `/api/ai/audio`, where the server calls Kie.ai with `KIEAI_API_KEY`, spends hosted credits, polls the task until a generated audio URL is available, then imports the downloaded audio. Suno Sounds uses the same audio import path after polling and does not expose the Suno Music lyrics/style/tuning controls.
9. On success, `FlashBoardMediaBridge` imports the asset into the Media Pool and marks the node complete.

Kie.ai Market video/image tasks are asynchronous. A successful create call only returns a `taskId`; FlashBoard polls `GET /api/v1/jobs/recordInfo?taskId=...` and maps Kie states such as `waiting`, `queuing`, `generating`, `success`, and `fail` into local job states. Running remote task IDs are persisted with the project; after reload, FlashBoard resumes polling resumable image/video/Suno jobs and imports the result if the provider finished while the app was closed. Flux Kontext, Veo, and Runway use dedicated Kie create/status endpoints because their result schemas differ from Market jobs. The local `canceled` state only means MasterSelects stopped tracking the node; Kie.ai does not currently expose a documented Market task cancel endpoint, so the Kie logs page and provider record responses remain the server-side source of truth.

Polling tolerates brief browser/network `Failed to fetch` interruptions before failing the job. Completed hosted Kie.ai results are downloaded through the authenticated `/api/ai/video?taskId=...&download=1` route instead of exposing temporary provider URLs directly to the browser. The media bridge also deduplicates repeated completion/import updates for the same generation record, so a slow download/import cannot create duplicate Media Pool items for one completed remote task.

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

The bridge stores generation metadata keyed by imported media file ID so project save/restore can round-trip the generated asset provenance. The imported asset can be dragged to the timeline or inserted directly at the playhead, and generated media items and timeline clips expose `Copy Prompt` in their context menus when prompt metadata exists. Audio nodes use the same external drag payload as Media Panel audio and route to audio tracks.

Media Panel image, video, and audio files can also be dragged onto the prompt composer to append them to the ordered reference strip or assign visible IN/OUT/REF/VID/AUD ghost slots, with a short ghost-to-card transition on drop. Right-clicking supported media files in Classic, Icons, or Board view toggles the same reference state and opens the generator tray. In Board view, right-button dragging media onto the expanded FlashBoard composer uses the highlighted ghost slot when one is targeted, otherwise appends references without moving the board item. Double-clicking a reference card opens that media in the Source Monitor.

---

## Access Rules

The prompt tray uses the hosted Cloud path:

- signed-in users see hosted Cloud models and hosted credit prices by default
- personal Kie.ai keys do not switch the Media generator tray to BYO mode
- production ignores personal provider keys for hosted AI generation/chat and uses Cloudflare secrets only
- matching Cloud models are selected and priced in MasterSelects credits

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
- `src/components/panels/media/MediaAIGenerationQueue.tsx`
- `src/components/panels/flashboard/useFlashBoardRuntime.ts`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/components/panels/flashboard/FlashBoard.css`
- `src/services/flashboard/FlashBoardJobService.ts`
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- `src/services/flashboard/FlashBoardPricing.ts`
- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/stores/flashboardStore/*`
