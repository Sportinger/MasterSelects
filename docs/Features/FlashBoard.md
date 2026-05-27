[Back to Index](./README.md)

# FlashBoard

FlashBoard is the AI generation runtime behind the Media Panel's bottom-right prompt tray. Its compact composer supports text-to-video, image-to-video, image generation, ElevenLabs text-to-speech, and Suno music generation, with direct import into the Media Pool.

> **Status:** Implemented. The compact composer is active inside Media, queued, persisted with the project, and connected to the current AI provider catalog.

---

## What It Does

FlashBoard is not a separate model backend. It is a composer/runtime layer on top of the existing AI services:

- `piapi` for the PiAPI catalog
- `kieai` for Kie.ai Kling 3.0, Seedance 2.0, and Nano Banana 2
- `cloud` for hosted Kling 3.0, hosted Nano Banana 2, and hosted ElevenLabs speech
- `elevenlabs` for user-key text-to-speech audio generation
- `suno` for Kie.ai-backed Suno music generation using the user's Kie.ai key
- compact chat for prompt discussion and editor actions through OpenAI, Anthropic, or local Lemonade without creating a generation node; requests include the Media-chat system prompt, current timeline summary, and callable AI tools routed through the shared chat dispatcher

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
- Kie.ai Seedance 2.0 video with image, video, and audio references, including audio-driven lip-sync reference mode
- Kie.ai Nano Banana 2 image generation
- Cloud Kling 3.0 video
- Cloud Nano Banana 2 image generation
- Cloud ElevenLabs text-to-speech audio generation
- BYO ElevenLabs text-to-speech audio generation
- Suno music generation via Kie.ai

The compact composer exposes the richer FlashBoard catalog.

---

## Generation Flow

1. The user creates a draft node from the composer.
2. The store captures the current request on that node.
3. `FlashBoardJobService` queues the node.
4. The Media Panel queue renders a preview card with status and elapsed time while the job is queued or processing.
5. Jobs run with a concurrency cap of 3 overall, but only 1 Kie.ai job at a time.
6. The selected video/image service submits the remote task and polls until completion.
7. ElevenLabs audio jobs create speech directly and return an audio `File` without remote polling. BYO jobs call ElevenLabs from the browser with the user's local key; Cloud jobs call `/api/ai/audio` and spend hosted credits.
8. Suno music jobs call Kie.ai's Suno endpoints, poll the task until a generated audio URL is available, then import the downloaded audio.
9. On success, `FlashBoardMediaBridge` imports the asset into the Media Pool and marks the node complete.

Image generation is handled alongside video generation. The code path resolves previewable reference images from media files, including thumbnails for video sources or a captured frame when needed. The compact composer also accepts media-panel image, video, and audio references through right-click or drag-and-drop; Kie.ai jobs upload local files through Kie.ai file hosting and map them to provider-specific inputs such as Nano Banana `image_input`, Kling `kling_elements`, or Seedance multimodal reference URL arrays. Seedance 2.0 uses `reference_audio_urls` for audio-driven sync. Because Kie.ai treats Seedance first/last-frame mode and multimodal reference mode as mutually exclusive, any Seedance request with generic references sends IN/OUT images as image references with prompt guidance instead of `first_frame_url` / `last_frame_url`.

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
- a personal key is only used when the key exists and that provider is marked `Use as default instead of Cloud credits`
- if no personal key is marked as default, matching Cloud models are selected and priced in MasterSelects credits
- BYO-only providers such as PiAPI, EvoLink, BYO ElevenLabs, and Suno are only exposed when their backing personal key is enabled as default

Hosted generation requests are credit-backed and authenticated. There is no anonymous hosted generation path.
Hosted ElevenLabs speech is metered by text length. The client shows a preflight credit estimate from the selected text/model, and the Cloudflare route finalizes the charge from the ElevenLabs `x-character-count` response header when available.
Suno currently uses a Kie.ai key marked as default rather than a separate Suno key or hosted credit route.

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
