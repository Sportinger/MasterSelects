# AI Integration

[← Back to Index](./README.md)

GPT-powered editing with 86 exported model tools across 16 exported definition groups, OpenAI/Cloud or local Lemonade chat providers, multi-provider AI video/image/audio generation, transcription, multicam EDL generation, browser-local SAM 2 segmentation, native-helper MatAnyone2 matting, and local MuScriptor music-to-MIDI.

---

## Table of Contents

- [FlashBoard Chat](#flashboard-chat)
- [Chat Providers](#chat-providers)
- [Lemonade Local Setup](#lemonade-local-setup)
- [Media Generator Tray](#media-generator-tray)
- [AI Segmentation and MatAnyone2](#ai-segmentation-and-matanyone2)
- [AI Editor Tools](#ai-editor-tools)
- [AI Visual Feedback System](#ai-visual-feedback-system)
- [AI Bridge Architecture](#ai-bridge-architecture)
- [Hosted AI Safety And Audit](#hosted-ai-safety-and-audit)
- [Transcription](#transcription)
- [Multicam EDL](#multicam-edl)
- [Configuration](#configuration)

---

## FlashBoard Chat

### Location
- Floating FlashBoard composer chat mode

### Features
- Interactive chat interface
- Compact provider and model menus for OpenAI/Cloud or Lemonade Local
- Conversation history
- Clear chat button
- Auto-scrolling
- Tool execution indicators

### Chat Providers

| Provider | Runtime | Configuration |
|---|---|---|
| `OpenAI / Cloud` | MasterSelects hosted chat when available, otherwise a user-supplied OpenAI API key | Preferences -> API Keys for BYO OpenAI key |
| `Lemonade Local` | OpenAI-compatible Lemonade Server running on the user's machine | Preferences -> General -> AI Features |

Lemonade defaults to `http://localhost:13305/api/v1` and sends chat completions to `/chat/completions`. The endpoint, model, and optional context size are stored in local settings, and the settings panel can check `/models` to verify the server and discover locally available models. Lemonade endpoints are restricted to loopback hosts (`localhost`, `127.0.0.1`, or `::1`) so timeline context and tool results are not sent to a remote URL by mistake.

The Lemonade integration is scoped to FlashBoard Chat. Transcription providers remain `local`, `openai`, `assemblyai`, and `deepgram`.

### Lemonade Local Setup

1. Install and start Lemonade Server locally.
2. Download a supported local chat model in Lemonade, for example `gemma4-it-e2b-FLM`.
3. Open Preferences -> General -> AI Features.
4. Set Chat Provider to `Lemonade Local`.
5. Keep the default endpoint `http://localhost:13305/api/v1` unless Lemonade is running on another loopback address.
6. Click `Check` to verify `/models` and populate the model menu with installed Lemonade models.
7. Open FlashBoard Chat and use the Lemonade model and `Ctx` buttons in the chat controls. `Auto` leaves Lemonade's current loaded context unchanged; concrete values reload the selected model through `/load` with `ctx_size`.

Manually imported Lemonade models may be exposed with a `user.` prefix, for example `user.gemma4-it-e2b-FLM`. The app treats `/models` as authoritative and uses the first available Lemonade model when the saved preset name is not present.

Lemonade is a provider, not an editor bridge. It can return OpenAI-compatible tool-call suggestions, but MasterSelects still applies the chat approval mode and routes execution through the shared AI tool dispatcher.

Because local FLM models have a smaller practical prompt budget than hosted models, Lemonade editor mode sends a compact high-use tool set instead of the full 86-tool catalog. The full exported catalog remains available to OpenAI/Cloud and to the local/native bridge.

Lemonade chat responses use the OpenAI-compatible SSE streaming endpoint, so text appears incrementally in FlashBoard Chat while the local model is generating. Tool calls are collected from the streamed deltas and executed after the assistant response finishes. The initial response timeout is 180 seconds and only covers reaching the SSE stream; once streaming starts, a 90-second idle timeout catches stalled local models without cutting off active long-running generations. Lemonade uses a shorter editor system prompt, compact tool results, and a lower completion-token limit than hosted models. Empty Lemonade streams include the model `finish_reason` when available, so output/context-limit stops are reported as actionable local-model errors instead of a generic empty response. If a local model still stalls after a tool result, MasterSelects times out the follow-up request and shows a deterministic tool-result summary instead of leaving the chat empty.

In Lemonade editor mode, each new user request is sent as a fresh tool-capable turn with the current timeline summary rather than replaying prior raw tool-call messages. This keeps small local FLM models from getting stuck on stale tool-call history while still allowing every new prompt to produce fresh tool calls.

FlashBoard Chat includes a `PromptBook` button for provider-specific system prompt overrides, generation prompts, generated media, chat history, and tool-call history. Prompts can be saved into the current project folder under `Prompts/*.prompt.json`, reloaded from the saved prompt list, reset to the built-in prompt, imported from a text/Markdown file, and exported as a `.txt` file. The active override and its `Send current MasterSelects context` setting are still mirrored in app settings so the chat can use them immediately. The old docked AI Chat panel is retired; the floating FlashBoard Chat is the primary AI editing surface.

The `Options` chat pill enables the Phase A multi-option prototype. In this mode the next request asks the provider for 2-3 text-only edit approaches and explicitly avoids tool execution. Parsed options appear with `Use` buttons; choosing one sends a normal edit request that applies the selected approach through the existing tool dispatcher. This bounds the prototype to one planning round plus one apply round, guarded by `flags.flashBoardChatEditOptions`.

### Available Models

OpenAI / Cloud:

```
GPT-5.2, GPT-5.2 Pro
GPT-5.1, GPT-5.1 Codex, GPT-5.1 Codex Mini
GPT-5, GPT-5 Mini, GPT-5 Nano
GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano
GPT-4o, GPT-4o Mini
o3, o4-mini, o3-pro (reasoning)
```

Default model: `gpt-5.1`

Lemonade Local presets:

```
gemma4-it-e2b-FLM
gemma3-1b-FLM
qwen3-0.6b-FLM
qwen3-4b-FLM
llama3.2-1b-FLM
```

Default Lemonade model: `gemma4-it-e2b-FLM`

### Editor Mode
When enabled:
- Includes timeline context in prompts
- Uses the exported AI tool catalog from `src/services/aiTools/definitions`
- The chat UI applies its own approval gate before calling mutating or sensitive tools
- AI can manipulate timeline directly

The current model-exposed surface is 86 exported tool definitions across 16 exported definition groups. `openComposition` and `searchVideos` are both mapped through the shared handler registry. There is also a `gaussian.ts` definition file, but it is not part of the exported `AI_TOOLS` array yet, so those tools are not currently exposed to the chat model.

In development, the same shared tool surface is also exposed in the browser console:

```javascript
window.aiTools.execute('splitClip', { clipId, time: 12.5 })
window.aiTools.list()
window.aiTools.status()
```

That console surface is dev-only. The Vite dev bridge and the Native Helper HTTP bridge both route into the same dispatcher, so chat, browser-console use, and external local agents all execute against the same shared tool registry.

---

## Media Generator Tray

### Location
- Bottom-right **Generate** tray inside the Media Panel
- Board view toolbar -> Generate

The old dock-level AI Generative tab is deprecated and removed from default and saved layouts. Generation is now launched from Media so generated results land directly beside imported assets.

### FlashBoard Prompt Mode
- Compact prompt composer for video, image, and audio generation
- The expanded AI tray is loaded lazily on hover/click interaction; the collapsed tray does not import the heavy FlashBoard runtime on idle startup.
- Active IN / OUT / REF assignments appear as removable media cards around the prompt box; image-to-video cards expose inline `IN`, `REF`, and `OUT` role controls
- Compact setting buttons such as model, aspect ratio, duration, image size, and mode open as inline submenus: the standard control row slides out, submenu pills stagger in, and the default row returns after selection
- Reference cards use pointer-proximity magnification in the compact Media tray, with previews scaling visually outside the tray without changing the prompt box height; crowded trays switch the reference cards into a vertical scroll strip
- Media Panel image, video, and audio files can be referenced by right-clicking them or dragging them onto the expanded prompt composer
- Kie.ai image generation includes Nano Banana 2, Nano Banana Pro, Imagen 4 Fast/Ultra, GPT Image 2, Flux 2 Pro, Seedream 5 Lite, and Flux Kontext Pro/Max through the shared async image-provider adapter. GPT Image 2 Edit, Flux 2 Pro Edit, Seedream 5 Lite Edit, Recraft Remove Background, Recraft Crisp Upscale, and Topaz Image Upscale require at least one reference image before generation is enabled.
- Kie.ai utility image/video models are exposed in the same Image and Video category chips. Recraft and Topaz image utilities can run without a prompt but require image input; Topaz Video Upscale can run without a prompt but requires a video reference and uses the mode button for `2x` / `4x`.
- Kie.ai video generation includes hosted Kling 3.0, Seedance 2.0 / Fast, Veo 3.1, and Runway through MasterSelects Cloud. Veo and Runway use their dedicated Kie endpoints and polling schemas rather than the generic Market `recordInfo` schema.
- The compact composer shows empty dashed capability slots for the selected video model's available inputs (`IN`, `OUT`, `REF`, `VID`, `AUD`) next to real reference cards. Resolution-capable models label their mode control with actual outputs such as `720p`, `1080p`, and `4K`; Runway hides `1080p` when `10s` is selected because Kie.ai does not allow that combination.
- Nano Banana 2 and Nano Banana Pro accept up to 14 ordered reference images through Kie.ai; Nano Banana 2 is also available through EvoLink. Kie.ai and Cloud Seedance 2.0 / Fast accept multimodal image/video/audio references and send audio references as `reference_audio_urls` for lip-sync / performance timing; the composer labels generic references as `REF 1`, `REF 2`, ... so prompts can refer to them explicitly
- Seedance 2.0 standard and Fast cannot combine strict `first_frame_url` / `last_frame_url` with multimodal references in the same Kie.ai request, so IN / OUT cards are converted to image references when REF media is present. Audio references are passed separately as input drivers through `reference_audio_urls`; adding one to Seedance automatically enables the `Sound` toggle so the Kie.ai request also sends `generate_audio: true`. Audio-only Seedance references are blocked locally because Seedance requires audio references to be paired with at least one image or video anchor.
- Suno Music and Suno Sounds are separate Music-category targets. Suno Music keeps the lyrics/style/negative-tags controls; Suno Sounds uses the normal prompt box plus the mode button for one-shot/loop sounds. Both run through hosted Cloud credits from the Media generator tray.
- The wand button in the composer refines the current prompt with GPT-5.5 through the hosted Cloudflare `/api/ai/chat` route by default. In non-production development it can still use a local OpenAI key when that key is explicitly marked as default; that BYO path streams real deltas into the Magic prompt while the original prompt stays available in a compact restore/dismiss box. The Original and Magic prompt boxes expand on focus for full reading/editing, and the Original text remains selectable for copying. The Magic prompt opens at full height briefly after refinement, then collapses to a compact scrollable height so the Generate controls stay anchored. Hosted refinement is non-streaming because `/api/ai/chat` does not expose prompt-refiner streaming. Suno Music, Suno Sounds, Nano Banana, GPT Image, Flux, Flux Kontext, Recraft/Topaz utilities, Seedream, Imagen, Kling, Seedance, Veo, and Runway targets use model-specific guidance so the refined prompt follows the selected model's input style and constraints.
- The collapsed Media tray shows separate `Chat` and `Generate` launch buttons. `Chat` opens a compact chat prompt window with OpenAI/Cloud model selection, OpenAI reasoning effort for GPT-5.x models, a visible per-round credit estimate, a provider-scoped `PromptBook`, and a temperature slider when the selected model accepts temperature. The selected reasoning effort is applied to BYO Responses and every hosted Chat Completions round. Non-production development can still expose Anthropic and Lemonade for local testing; Lemonade reuses the persisted AI provider/model/context-size settings and falls back to the first discovered local model when the saved preset is not installed. The selected OpenAI/Lemonade provider survives minimize/reopen, app restart, and HMR remount; Anthropic remains a development-only session selection.
- Compact chat requests include the Media-chat system prompt, current timeline summary by default, and callable AI tools. For visual questions and content-aware edits such as funny, highlight, storytelling, or scene-based cuts, the agent samples 3-8 timeline moments with `getFramesAtTimes`; captured frame grids are attached as real multimodal image inputs on OpenAI Cloud, OpenAI BYO, and Anthropic follow-up rounds instead of being reduced to text metadata. Transcript remixes convert source-word timestamps through the clip's placement, trim, speed, and reverse state, then continue from `splitClipAtTimes` through a fresh timeline read to `reorderClips` in the same turn because the split creates the IDs needed for the final arrangement. The PromptBook system-prompt editor can disable and save that live context per provider preset. Tool calls route through the shared `executeAIToolCalls(..., 'chat')` dispatcher; actions that require confirmation are denied in the compact flow and reported back to the model unless the approval mode allows them automatically. In chat mode, approval is toggled from the left `Auto` segment of the `Chat` split-button`; the main button area still sends the prompt.
- Queued and running generations appear as Media Panel preview cards with output type, status, elapsed timer, prompt, metadata, and progress when the provider reports it. The tray can keep 100 local jobs active; hosted Kie.ai task starts are globally paced through a Cloudflare Durable Object at 19 starts per 10 seconds, so image, video, and Suno bursts share one provider-safe lane instead of producing 429s.
- The tray reuses the FlashBoard queue/import runtime without showing the full node canvas

### Current Backends

The current generator stack is no longer best described as "PiAPI as one unified gateway". The active UI routes are:

| Backend | Where it is used | Notes |
|---------|------------------|-------|
| `Kie.ai` | Hosted FlashBoard media via MasterSelects Cloud | Video providers come from Kie.ai through `/api/ai/video`; image providers include Kie Market jobs plus dedicated Flux Kontext routes in the FlashBoard catalog |
| `EvoLink` | FlashBoard image generation | User-supplied key must be unlocked and marked as default; Nano Banana 2 uses EvoLink's async `gemini-3.1-flash-image-preview` task flow with up to 14 reference images |
| `MasterSelects Cloud` | FlashBoard production and hosted development | Hosted credits/account flow; production uses Cloudflare secrets only. FlashBoard uses hosted Kling/Seedance/Nano Banana through `/api/ai/video`, hosted ElevenLabs speech, OpenAI transcription, and Suno music through `/api/ai/audio`, and hosted OpenAI chat/refinement through `/api/ai/chat` |
| `ElevenLabs` | FlashBoard audio generation in development/BYO flows | User-supplied keys are development-only when explicitly unlocked and marked as default; production text-to-speech uses the Cloudflare `ELEVENLABS_API_KEY` secret |
| `Suno` | FlashBoard music and sound generation | Suno Music and Suno Sounds use the hosted Cloud path from the Media generator tray |
| `OpenAI` | FlashBoard prompt refinement and compact chat | Production uses the Cloudflare `OPENAI_API_KEY` secret and charges hosted credits per model round; development can still use BYO OpenAI when explicitly marked as default |
| `Anthropic` | FlashBoard compact chat in development/BYO flows | User-supplied Anthropic key must be unlocked and marked as default; used only for prompt discussion, not media generation |
| `Lemonade` | FlashBoard compact chat | Local loopback Lemonade Server; model list is discovered from `/models` when the chat controls are opened, and explicit context sizes are applied through `/load` with `ctx_size` before chat |
| `PiAPI` | Legacy compatibility and some catalog/pricing metadata | Still present in older history/key migration paths and FlashBoard pricing/catalog helpers, but not the primary runtime path the current panel describes |

The practical rule for the current branch is:
- Production is Cloudflare-secret-only for hosted AI. User-entered provider keys are hidden from production generation/chat paths.
- The Media generator tray is hosted Cloud only. Personal/BYO provider keys do not replace the Kie.ai-backed Cloud media path there.
- Cloud media pricing is shown in the Account dialog's scrollable price view only as MasterSelects Cloud credits. Its Change Plan action opens the full plan selector. Hosted Kie.ai media uses a `6x` vendor-credit conversion for margin after VAT, Stripe, and FX; BYO API-key pricing is intentionally not shown in that Cloud price list.
- Hosted compact chat charges by model round and allows each hosted model round to run for up to 180 seconds. If a tool call requires another hosted model follow-up, that follow-up request is charged separately; local tool execution itself is not a separate hosted charge unless the tool calls another hosted media route.
- Image generation providers implement the shared FlashBoard image-provider adapter, so adding another async image service is a catalog entry plus a provider adapter instead of another hardcoded job-service branch.
- ElevenLabs-only access opens the composer on the audio text-to-speech target.
- Service/provider labels in the tray reflect that active backend instead of a permanent PiAPI abstraction layer.
- BYO provider keys are stored through the encrypted local API-key path for development compatibility and are not persisted in Zustand localStorage. Hosted ElevenLabs uses the Cloudflare `ELEVENLABS_API_KEY` secret; hosted Suno uses the Cloudflare `KIEAI_API_KEY` secret. Both charge logged-in users by hosted credits.

### Timeline Integration
- FlashBoard generated media imports under `AI Gen / Video`, `AI Gen / Images`, or `AI Gen / Audio`
- Video/image clips are placed on video tracks; generated ElevenLabs speech and Suno music behave like normal imported audio and route to an audio track

---

## AI Segmentation and MatAnyone2

The panel combines two different mask sources:
- **SAM 2** runs locally in the browser for interactive segmentation and frame propagation
- **Paint** is a browser-only fallback that does not require a model download
- **MatAnyone2** is a separate native-helper-backed video matting step that consumes either mask source and produces a transparent foreground video plus an alpha sidecar

SAM 2 inference runs locally in the browser using ONNX Runtime with WebGPU acceleration. No API keys or cloud services are involved.

### Location
- Tab in dock panels alongside AI Chat and Scene Description
- View menu -> AI Segment

### One-Time Model Download
On first use, the panel prompts for a one-time model download:
- **Model:** SAM 2 Hiera Small (fp16 encoder + ONNX decoder)
- **Total size:** about 103 MB
- **Storage:** Cached in the browser's Origin Private File System (OPFS)
- **Progress:** Download progress bar shown in the panel
- After download, the model auto-loads into ONNX sessions

### Model Lifecycle

| Status | Description |
|--------|-------------|
| Not Downloaded | Panel shows download prompt |
| Downloading | Progress bar with percentage |
| Downloaded | Cached in OPFS, auto-loading |
| Loading | Creating ONNX inference sessions |
| Ready | Green status dot, ready for segmentation |
| Error | Red status dot with error message and retry button |

### Point-Based Segmentation
Once SAM 2 is ready and a clip is selected:

1. Activate segmentation mode
2. Left-click to place foreground points
3. Right-click to place background points
4. Each point triggers an immediate decode pass
5. Points are listed in the panel and can be removed individually

The Auto-Detect button places a center point and runs a full encode + decode cycle for a quick initial mask.

### Paint Mode
Paint mode is the simpler browser-local alternative:
- Works without SAM 2 or a model download
- Uses a dedicated canvas overlay on top of the preview
- Supports brush size and eraser mode
- Produces the mask blob that MatAnyone2 consumes in step 2

### Preview Overlay
When SAM 2 is active, the preview overlay shows:
- A semi-transparent blue mask visualization
- Green foreground and red background points
- A processing indicator while inference runs
- A crosshair cursor for point placement

### Display Settings

| Setting | Range | Description |
|---------|-------|-------------|
| Opacity | 0-100% | Transparency of the mask overlay |
| Feather | 0-50px | Edge softness of the mask |
| Invert Mask | On/Off | Swap foreground and background regions |

### Video Propagation
After creating a mask on the current frame, SAM 2 can propagate it forward:
- Forward propagates the mask up to 150 frames
- Progress bar and percentage are shown during propagation
- Stop cancels propagation at any time
- Each propagated frame is RLE-compressed and stored efficiently in memory

### MatAnyone2 Stage
MatAnyone2 is the second step in the workflow:
- Requires the Native Helper to be connected
- Runs only on an accessible NVIDIA CUDA GPU; setup and server start fail closed instead of falling back to CPU
- Uses either the painted mask or the SAM 2 live mask
- Converts composition-space paint/SAM2 masks back into raw source space, including source crop, aspect, scale, position, and 2D/3D rotation
- Starts on the exact source frame where the mask was created and renders only the remaining selected source range
- Preserves constant clip speed and aligns the imported result to the corresponding timeline time; reverse and variable-speed clips request a bake instead of producing a silently misaligned matte
- Writes the job mask and native-helper output into a project-local `MatAnyone2/` folder
- Encodes a real alpha plane in VP9/WebM; the separate alpha WebM remains a diagnostic/interop sidecar
- Imports the transparent foreground into Media Pool `AI Gen / Matting`
- Copies imported outputs into project `Raw/MatAnyone2/...` so generated mattes survive reloads and project moves
- Places the transparent foreground on a new video track aligned to the mask frame when using `Import to Timeline`
- Exposes progress, job state, and hard cancellation; cancel stops the MatAnyone2 sidecar process tree and returns the stage to installed/not-running
- Shows a helper-unavailable state when the Native Helper is not connected

The helper installs a tested MatAnyone2 upstream revision rather than an unpinned branch head. Setup repairs stale installs, honors an explicitly configured Python interpreter, drains sidecar output continuously, and waits for real health instead of trusting cached process state.

MatAnyone2 is distributed under the NTU S-Lab License 1.0. The setup UI surfaces its non-commercial-use terms; commercial use requires separate permission from the authors.

### Workflow
```
1. Open AI Segment panel
2. Choose Paint or SAM2 as the mask source
3. Download SAM 2 only if you want the browser segmentation path
4. Select a video clip in the timeline
5. Create or refine the mask
6. Start MatAnyone2 through the Native Helper
7. Import or inspect the generated matte result
8. Clear All to reset and start over
```

---

## Local Music-to-MIDI

Timeline audio and video clips with audible audio expose **Music to MIDI...** next to **Stem Separation...**. The action renders the processed audible clip range, stages a temporary WAV through the Native Helper, transcribes it with a persistent local MuScriptor model, maps instrument groups to General MIDI, and commits all generated tracks/clips as one undo step.

MuScriptor is not a stem separator: it emits editable note timing, pitch, and instrument classes. The runtime and model cache are isolated from MatAnyone2. Published model weights are gated under CC BY-NC 4.0, so setup presents the license requirement and uses a transient user-supplied HuggingFace token only for the selected model download.

See [MuScriptor Music-to-MIDI](./MuScriptor.md) for the complete runtime, mapping, license, and troubleshooting details.

---

## AI Editor Tools

### 86 Tools across 16 Exported Definition Groups

> **Note:** The 86-tool count is the model-exposed `AI_TOOLS` catalog. Bridge-only diagnostics can exist as handler/policy entries without being exposed to the chat model. Gaussian Splat tool definitions also exist in `src/services/aiTools/definitions/gaussian.ts`, but that file is not currently exported through `AI_TOOLS`.

The exported tool groups are:
- Timeline state and selection
- Clip editing
- Track tools
- Visual capture and preview
- Analysis and transcript
- Media panel and local files
- Batch operations
- YouTube and downloads
- Transform
- Effects
- Keyframes
- Playback
- Transitions
- Masks
- Stats and debug
- Node Workspace

The chat and bridge code call the shared dispatcher, so the same registry is used in-chat, through the Vite dev bridge, and through the Native Helper bridge. Approval behavior is enforced in the chat UI before execution, while the dispatcher policy is the actual execution gate.

### Local File And Batch Workflows

- `executeBatch` groups multiple actions under one undo point and shares a single visual stagger budget.
- Several clip tools default `withLinked: true`, so linked audio/video companions move, split, or delete together unless the caller opts out.
- `addMaskPathKeyframe` stores full `mask.{maskId}.path` snapshots, preserving vertex IDs so individual mask vertices can animate between keyframed shapes.
- Local filesystem tools such as `importLocalFiles` and `listLocalDirectory` run through the dev bridge in development or the Native Helper in production, and they still respect the file-access policy/allowed-root checks.

---

## AI Visual Feedback System

When the AI executes tools, the UI gives feedback so the user can see what is happening.

### Components

| File | Purpose |
|------|---------|
| `aiFeedback.ts` | Panel/tab switching, preview flashes, timeline marker animations |
| `executionState.ts` | Tracks whether an AI operation is active and manages stagger budget |
| `aiActionFeedbackSlice.ts` | Reactive state used by the UI for AI action feedback |

### Stagger Budget System

- A total budget is allocated per AI operation
- Visual delays share that budget so bulk actions feel deliberate
- Once the budget is exhausted, the remaining steps execute instantly

### Feedback Actions

| Action | Visual Effect |
|--------|--------------|
| `activateDockPanel()` | Switches to and focuses a dock tab |
| `openPropertiesTab()` | Opens a specific Properties tab |
| `selectClipAndOpenTab()` | Selects a clip and opens the relevant tab |
| `flashPreviewCanvas()` | Brief overlay flash on the preview |
| `animateMarker()` | Triggers a timeline marker animation |
| `animateKeyframe()` | Triggers a keyframe animation |

All feedback functions are guarded by `isAIExecutionActive()` so they only trigger during active AI tool execution.

Guided replay also renders semantic surface gestures. Custom mask creation and `addMaskPathKeyframe` resolve normalized vertices against the Preview panel, draw the path overlay, and animate the guided cursor through each vertex with click pulses before executing the semantic tool. Timeline edit tool calls can now be adapted into `TimelineEditOperation` replay descriptors, so compound split tools like `splitClipEvenly` derive their cursor path from the live clip timing and visit each generated cut point before the semantic tool executes. Media placement tool calls use the same pattern: `addClipSegment` animates a Media item into the Timeline with the real drop preview, while `importLocalFiles({ addToTimeline: true })` and `downloadAndImportVideo` move the guided cursor from Media/Downloads to the target Timeline time.

---

## AI Bridge Architecture

External AI agents can execute AI tools through local HTTP. Two bridge modes exist depending on the environment.

### Development (HMR Bridge)

In development, the Vite dev server proxies tool calls through HMR:

```
POST /api/ai-tools -> Vite server -> HMR WebSocket -> browser -> executeAITool() -> HMR -> HTTP response
```

- Implemented in `src/services/aiTools/bridge.ts`
- Uses `executeAITool(..., 'devBridge')` so the caller context is explicit
- Sends presence heartbeats and tab-targeting metadata through HMR
- Supports `_list` and `_status` meta-commands alongside tool execution
- Shares the dev bridge auth token and only accepts loopback browser origins
- `GET /api/ai-tools` reports bridge/tab status without auth; `GET /api/ai-tools/auth-check` validates the bearer token without dispatching a browser tool
- Dev-only browser helpers expose the same surface as `window.aiTools.execute()`, `window.aiTools.list()`, and `window.aiTools.status()`

### Production (Native Helper Bridge)

In production builds, the Rust native helper proxies HTTP to the app via WebSocket:

```
POST http://127.0.0.1:9877/api/ai-tools -> Native Helper -> WebSocket (9876) -> browser -> executeAITool()
```

- Native helper listens on HTTP port `9877` and WebSocket port `9876`
- The helper generates a random auth token at startup and validates it on both HTTP and WebSocket paths
- `GET /api/ai-tools` is status-only and does not require auth
- `POST /api/ai-tools` and `/ai-tools` require the bearer token
- `GET /startup-token` is localhost-only and lets the browser discover the current helper token
- Both modes converge at `executeToolInternal()` in `src/services/aiTools/handlers/index.ts`

---

## Hosted AI Safety And Audit

Hosted `/api/ai/chat`, `/api/ai/video`, and hosted generation paths in `/api/ai/audio` run a server-side OpenAI `omni-moderation-latest` preflight before provider calls. Flagged requests and moderation failures are blocked before credits are spent or provider jobs are created.

Async hosted media jobs that later fail at the provider status stage refund their original hosted credit charge once, update the failed usage event to zero credits, refresh the account balance, and show the user a failure dialog with the refunded credit amount and job ID.

Hosted AI requests are also logged best-effort into D1:

- Chat completions are recorded in `chat_logs` with model, request/response payloads, tool calls, token counts, credit cost, duration, and error state
- Chat, image/video generation, Suno, and ElevenLabs speech requests are recorded in `ai_audit_events`
- Audit fields include user ID, request ID, idempotency key, feature, provider, model, prompt/request payload, moderation status/categories, task ID when available, credit cost, status/error, user agent, and a salted IP hash
- BYO provider proxy requests are not audited as hosted AI requests because they use the user's own provider key path

Authenticated users can inspect that history through:

- `GET /api/ai/chat-history`
- `GET /api/ai/chat-history?id=<log-id>`

---

## Transcription

### 4 Providers

#### Local Whisper (Browser)
- Uses `@huggingface/transformers`
- Model selection is language-dependent: `Xenova/whisper-base.en` for English and `Xenova/whisper-base` for auto/multilingual
- No API key needed
- Dynamically imported on first use

#### OpenAI Whisper API
```
Endpoint: /v1/audio/transcriptions
Model: whisper-1
Format: verbose_json
Granularity: word
```
- Signed-in accounts always use the hosted OpenAI Whisper path through
  MasterSelects credits, currently 6 credits per minute rounded up to the next
  whole credit.
- On the plain Vite dev server, if the hosted `/api/ai/audio` route is not
  available, clip transcription falls back to the configured provider, or to
  local Whisper when no BYO provider key is configured.
- Backend-free dev-login mocks do not enable hosted AI; local hosted-AI testing
  with `.dev.vars` or environment secrets requires `npm run dev:full` or
  `npm run dev:api` beside `npm run dev`.
- Signed-out users can still use the configured local/BYO transcription
  provider selection.
- Timeline clip context menus show the active transcription provider in the
  `Transcribe (...)` label so the current model path is visible before work
  starts, and include `Transcription Settings...` directly below it for one-click
  provider changes from the editing workflow.

#### AssemblyAI
```
Upload: /v2/upload
Transcribe: /v2/transcript
Features: Speaker diarization
Polling: 2-minute timeout
```

#### Deepgram
```
Endpoint: /v1/listen
Model: nova-2
Features: Punctuation, speaker diarization
```

---

## Multicam EDL

### Claude API Integration
```typescript
// Endpoint
https://api.anthropic.com/v1/messages

// Model
claude-sonnet-4-20250514

// Max tokens
4096
```

### Edit Style Presets
| Style | Description |
|-------|-------------|
| `podcast` | Cut to speaker, reaction shots, 3s min |
| `interview` | Show speaker, cut for questions, 2s min |
| `music` | Beat-driven, fast pacing, 1-2s min |
| `documentary` | Long cuts, B-roll, wide establishing |
| `custom` | User-provided instructions |

### Multicam Panel
A dedicated `MultiCamPanel` component provides the workflow UI:
- Add cameras from the media panel
- Set a master camera for audio reference
- Audio-based sync between cameras
- CV analysis per camera
- Transcript generation via local Whisper
- EDL generation via Claude API
- Apply EDL directly to the timeline

---

## Configuration

### API Keys
Settings dialog -> API Keys:
- OpenAI API key
- Anthropic API key
- Kie.ai API key
- PiAPI key (legacy compatibility)
- Kling access and secret keys (legacy compatibility)
- AssemblyAI key
- Deepgram key
- YouTube Data API v3 key

Multicam panel -> Settings:
- Claude API key for multicam EDL generation

Hosted cloud access for chat/video does not use a user-entered API key in the desktop settings panel. It comes from the signed-in hosted account and credit balance.

### No API Key Required
- SAM 2 AI Segmentation runs entirely in the browser
- MatAnyone2 video matting and MuScriptor music-to-MIDI run locally through isolated Native Helper sidecars
- Local Whisper transcription runs in-browser

### Storage
API keys are stored encrypted in IndexedDB via Web Crypto API. SAM 2 model files are stored in OPFS. MatAnyone2 and MuScriptor runtime state and model files live in isolated Native Helper provider directories. MuScriptor's gated HuggingFace token is deliberately transient and is not added to the stored API-key set.

### Security Considerations
- Encryption at rest protects against casual inspection, not same-origin scripts or browser extensions
- The `.keys.enc` export/import path remains disabled
- Log output is redacted before buffering and before being exposed via the AI tool bridge
- Development AI bridge calls are loopback-only and tokened; the Native Helper bridge uses its own startup token
- Lemonade chat calls are treated as local-only provider calls and are restricted to loopback endpoints. The static Lemonade bearer header is compatibility metadata, not a MasterSelects auth boundary.

See [Security](./Security.md) for the full security model.

---

## Usage Examples

### Effective Prompts
```
"Move the selected clip to track 2"
"Trim the clip to just the talking parts"
"Remove all segments where motion > 0.7"
"Create a rough cut keeping only focused shots"
"Split at all the 'um' and 'uh' moments"
"Add a cross dissolve transition between all clips"
"Set opacity to 50% on the selected clip"
```

### Iterative Editing
1. Make AI edit
2. Preview result
3. Undo if needed
4. Refine prompt
5. Repeat

---

## Related Features

- [Timeline](./Timeline.md) - Editing interface
- [Audio](./Audio.md) - Multicam sync
- [Media Panel](./Media-Panel.md) - Organization
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

Tool definition integrity is covered by the unit tests in `tests/unit/aiToolDefinitions.test.ts`.

---

*Source: `src/main.tsx`, `src/components/panels/media/MediaAIGenerativeTray.tsx`, `src/components/panels/flashboard/FlashBoardComposer.tsx`, `src/components/panels/SAM2Panel.tsx`, `src/components/panels/MultiCamPanel.tsx`, `src/components/panels/SceneDescriptionPanel.tsx`, `src/components/preview/SAM2Overlay.tsx`, `src/services/sam2/SAM2Service.ts`, `src/services/sam2/SAM2ModelManager.ts`, `src/services/sam2/sam2Worker.ts`, `src/stores/sam2Store.ts`, `src/services/aiTools/`, `src/services/aiTools/aiFeedback.ts`, `src/services/aiTools/executionState.ts`, `src/services/aiTools/bridge.ts`, `src/services/sceneDescriber.ts`, `src/services/claudeService.ts`, `src/services/kieAiService.ts`, `src/services/cloudAiService.ts`, `src/services/flashboard/`, `src/stores/multicamStore.ts`, `src/services/multicamAnalyzer.ts`, `functions/api/ai/chat.ts`, `functions/api/ai/chat-history.ts`, `functions/lib/chatLog.ts`*
