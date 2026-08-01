[Back to Index](./README.md)

# FlashBoard

FlashBoard is the AI generation runtime behind the Media Panel's bottom-right prompt tray. Its compact composer supports text-to-video, image-to-video, image generation, ElevenLabs text-to-speech, and Suno music generation, with direct import into the Media Pool. Projects persist the last selected model plus per-model generation settings. Prompt refinement treats START and END frame references as supplied video anchors and focuses on the motion between them instead of redescribing the images.

## What It Does

FlashBoard is not a separate model backend. It is a composer/runtime layer on top of the existing AI services:

- `cloud` for the hosted Kie.ai video, image, Suno, ElevenLabs, and chat routes
- compact chat for prompt discussion and editor actions through managed Kie.ai. Requests include the Media-chat system prompt, current timeline summary, and callable AI tools routed through the shared chat dispatcher. Hosted chat requires a signed-in hosted session and uses the hosted agent client (see `docs/Features/Kernel-Client.md`)

The Media Panel generator tray offers three collapsed launch actions: `Chat`, `Generate`, and `Downloads`. `Generate` opens the normal generation prompt, while `Chat` opens a separate chat prompt window with provider/model controls, Claude temperature controls, and reasoning effort for Kie.ai GPT models. The chat model menu includes GPT 5.6 Terra/Luna/Sol, GPT 5.5/5.4, Claude Opus 4.8, Claude Sonnet 5, and chat-only Claude Fable 5. The generator tray exposes media generation only as signed-in hosted Cloud entries. `Generate` remains the action that queues media generation.

---

## Current Runtime Structure

FlashBoard is composed of:

- `MediaAIGenerativeTray` - Media Panel bottom-right expand/collapse shell
- `MediaAIGenerationQueue` - compact Media Panel preview cards for queued, processing, failed, and canceled generation nodes, including model/settings labels and local cancellation for running AI jobs
- `useFlashBoardRuntime` - active-generation initialization plus queue/import callbacks
- `FlashBoardComposer` - provider/output selection, separate generate/chat prompt windows, ordered media reference cards, compact chat controls, text-to-speech or music editing, durations, aspect ratio, image size, multi-shot setup, audio voice settings, and Suno song controls

The project persists the composer state, active generation records, generation metadata, prompt history, and chat messages. Pending resumable remote jobs are restored on project load. The prompt book keeps the project's generated and chat prompts available for review and copy. Prompt book generation pages group outputs by user prompt, show the Magic Wand prompt when one produced the final request, and preview generated images/videos directly on the page.

The prompt book is presented as a "magic book": it opens with a one-shot fall-open animation, page navigation flips a blank textured overlay sheet across the spread, a short glitter burst accompanies opening and turning, and the pages carry a static paper-grain texture over a leather cover body. All effects are transform/opacity-only CSS animations that are time-boxed and removed from the DOM afterwards (the idle book is fully static), they are skipped entirely under `prefers-reduced-motion` and in the single-column mobile layout, and the animation state lives in `promptBookAnimations.ts` / `PromptBookSparkles.tsx` next to the book component.

---

## Node Lifecycle

Nodes move through the following states:

- `draft`
- `queued`
- `processing`
- `completed`
- `failed`
- `canceled`

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
- Suno simple/custom and instrumental/vocal state inferred from the expanded composer sections, plus internally derived title, style, negative tags, vocal gender, tuning weights, and optional V5.5 duration for music nodes

---

## Provider Matrix

The composer uses the hosted Cloud catalog from `FlashBoardModelCatalog`:

- Kling, Seedance 2.0, Seedance 2.0 Fast, Veo 3.1, Runway, and Topaz Video Upscale video entries
- Nano Banana 2/Pro, GPT Image 2 and GPT Image 2 Edit, Flux 2 Pro and Flux 2 Pro Edit, Seedream 5 Lite and Seedream 5 Lite Edit, Flux Kontext Pro/Max, Recraft utilities, and Topaz Image Upscale image entries
- ElevenLabs text-to-speech, Suno music, and Suno Sounds audio entries

Seedance 2.0 entries support exact IN/OUT frame inputs only.

The compact composer exposes the richer FlashBoard catalog.

---

## Generation Flow

1. The user creates a draft generation record from the composer.
2. The store captures the current request on that record.
3. `FlashBoardJobService` queues the record.
4. The Media Panel queue renders a preview card with status and elapsed time while the job is queued or processing.
5. Jobs run through the in-memory queue, whose current overall concurrency limit is 100.
6. The selected media service submits the remote task and polls until completion when the provider is asynchronous.
7. ElevenLabs audio jobs create speech through `/api/ai/audio` and return an audio `File` without remote polling.
8. Suno music and Suno Sounds jobs use Cloudflare `/api/ai/audio`, where the server calls Kie.ai with `KIEAI_API_KEY`, spends hosted credits, and polls the task. At Kie.ai `FIRST_SUCCESS`, every currently available Suno result is exposed in the running generation card with cover art and an inline player using `streamAudioUrl`. Polling continues until the full job completes.
9. On success, `FlashBoardMediaBridge` downloads and imports every returned Suno track into the Media Pool, records each result by stable provider output ID, and marks the generation complete only after all returned audio assets are mapped. Partial import retries skip tracks that were already imported. Other providers retain their single-asset path.

Kie.ai Market video/image tasks are asynchronous. A successful create call only returns a `taskId`; FlashBoard polls `GET /api/v1/jobs/recordInfo?taskId=...` and maps Kie states such as `waiting`, `queuing`, `generating`, `success`, and `fail` into local job states. Running remote task IDs are persisted with the project; after reload, FlashBoard resumes polling resumable image/video/Suno jobs and imports the result if the provider finished while the app was closed. Flux Kontext, Veo, and Runway use dedicated Kie create/status endpoints because their result schemas differ from Market jobs. The local `canceled` state only means MasterSelects stopped tracking the node; Kie.ai does not currently expose a documented Market task cancel endpoint, so the Kie logs page and provider record responses remain the server-side source of truth.

Polling tolerates brief browser/network `Failed to fetch` interruptions before failing the job. Completed hosted Kie.ai results are downloaded through authenticated application routes or the provider result URL appropriate to that model instead of remaining dependent on temporary preview URLs. The media bridge deduplicates repeated completion/import updates per generation output, so a slow or retried multi-track import does not create duplicate Media Pool items.

Kie.ai requires a reachable Suno callback URL in addition to polling. `/api/ai/suno/callback` is a stateless acknowledgement endpoint that prevents provider `CALLBACK_EXCEPTION` failures; polling remains the authoritative state path. The callback performs no project or billing mutation.

Suno controls follow the provider request matrix. The composer shows the available sections directly instead of a separate four-way mode selector: collapsing a section disables it and removes its values from the provider request. The panel itself has no inner scrollbar, so every enabled field remains visible.

- simple mode keeps the song-description section expanded and the custom-controls section collapsed; it sends only the description
- custom instrumental mode expands custom controls, collapses lyrics, derives the provider-required title internally from the style, and disables vocal controls
- custom vocal mode expands both sections, derives the provider-required title internally, and enables lyrics, style, negative tags, vocal gender, and tuning weights
- the duration slider is available only for custom `V5_5` music and clamps whole seconds to Kie.ai's documented 10–360 second range
- the small Magic Wand lives inside the active dark input: inside lyrics/song description for vocal modes and inside style for instrumental mode

Image generation is handled alongside video generation. The code path resolves previewable reference images from media files, including thumbnails for video sources or a captured frame when needed. The compact composer accepts Media Panel image, video, and audio references through right-click or drag-and-drop; supported hosted routes resolve and upload those inputs server-side. Seedance 2.0 standard exposes 480p, 720p, and 1080p; Seedance 2.0 Fast exposes 480p and 720p. Seedance uses the IN and OUT frame slots for its exact first/last-frame mode.

The composer wand has Seedance-specific prompt-refiner guidance. When Seedance is selected it asks the refiner to write concise cinematic motion, camera, continuity, and final-state instructions while preserving explicit reference labels.

---

## Media And Timeline Integration

FlashBoard uses the same drag payload as the rest of the app:

- `application/x-media-file-id`

Completed assets are imported under:

- `AI Gen / Video`
- `AI Gen / Images`
- `AI Gen / Audio`

The bridge stores generation metadata keyed by imported media file ID so project save/restore can round-trip the generated asset provenance. The imported asset can be dragged to the timeline or inserted directly at the playhead, and generated media items and timeline clips expose `Copy Prompt` in their context menus when prompt metadata exists. Audio nodes use the same external drag payload as Media Panel audio and route to audio tracks.

Media Panel image, video, and audio files can also be dragged onto the prompt composer to append them to the ordered reference strip or assign visible IN/OUT/REF/VID/AUD ghost slots, with a short ghost-to-card transition on drop. The tray keeps its reference strip in the left column; on narrow layouts it hides that strip while retaining the selection, so the composer remains fully visible. Right-clicking supported media files in Classic, Icons, or Board view toggles the same reference state and opens the generator tray. In Board view, right-button dragging media onto the expanded FlashBoard composer uses the highlighted ghost slot when one is targeted, otherwise appends references without moving the board item. Double-clicking a reference card opens that media in the Source Monitor.

---

## Access Rules

The prompt tray uses the hosted Cloud path:

- signed-in users see hosted Cloud models and hosted credit prices by default
- Kie.ai has no browser-stored key or direct client route
- hosted AI generation/chat uses Cloudflare secrets only
- matching Cloud models are selected and priced in MasterSelects credits

Hosted generation requests are credit-backed and authenticated. There is no anonymous hosted generation path.
Hosted ElevenLabs speech is metered by text length. The client shows a preflight credit estimate from the selected text/model, and the Cloudflare route finalizes the charge from the ElevenLabs `x-character-count` response header when available.
Hosted Suno music uses the Cloudflare `KIEAI_API_KEY` secret and is charged as MasterSelects credits through `/api/ai/audio`. Compact hosted chat shows the per-model-round credit estimate; tool follow-up model rounds are charged separately.

---

## Limitations

- The composer delegates to the existing AI services.
- Generated URLs are temporary, so imports force a local project copy.
- ElevenLabs text-to-speech returns an MP3 `File` directly and is copied into project storage during import.
- Suno music depends on Kie.ai's polling API. Kie.ai commonly returns multiple variations but does not contractually guarantee an exact count, so FlashBoard accepts and imports an arbitrary number of returned tracks.
- Suno covers and streaming URLs are treated as optional provider data. Completed playback prefers the imported project-local audio before falling back to provider URLs.
- Feature support is provider-specific in the catalog.
- Reference behavior remains model-specific: Nano Banana accepts image references, Kling accepts image/video references, and Seedance currently accepts exact IN/OUT frame inputs only.

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
