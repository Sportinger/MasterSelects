# AI Integration

[← Back to Index](./README.md)

GPT-powered editing with 79 exported tools across 15 exported definition groups, OpenAI/Cloud or local Lemonade chat providers, multi-provider AI video generation, transcription, multicam EDL generation, browser-local SAM 2 segmentation, and native-helper MatAnyone2 matting.

---

## Table of Contents

- [AI Chat Panel](#ai-chat-panel)
- [Chat Providers](#chat-providers)
- [Lemonade Local Setup](#lemonade-local-setup)
- [AI Video Panel](#ai-video-panel)
- [AI Segmentation and MatAnyone2](#ai-segmentation-and-matanyone2)
- [AI Editor Tools](#ai-editor-tools)
- [AI Visual Feedback System](#ai-visual-feedback-system)
- [AI Bridge Architecture](#ai-bridge-architecture)
- [Hosted Chat Logging](#hosted-chat-logging)
- [Transcription](#transcription)
- [Multicam EDL](#multicam-edl)
- [Configuration](#configuration)

---

## AI Chat Panel

### Location
- Default tab in dock panels
- View menu -> AI Chat

### Features
- Interactive chat interface
- Provider selection for OpenAI/Cloud or Lemonade Local
- Model selection dropdown
- Conversation history
- Clear chat button
- Auto-scrolling
- Tool execution indicators

### Chat Providers

| Provider | Runtime | Configuration |
|---|---|---|
| `OpenAI / Cloud` | MasterSelects hosted chat when available, otherwise a user-supplied OpenAI API key | Preferences -> API Keys for BYO OpenAI key |
| `Lemonade Local` | OpenAI-compatible Lemonade Server running on the user's machine | Preferences -> General -> AI Features |

Lemonade defaults to `http://localhost:13305/api/v1` and sends chat completions to `/chat/completions`. The endpoint and model are stored in local settings, and the settings panel can check `/models` to verify the server and discover locally available models. Lemonade endpoints are restricted to loopback hosts (`localhost`, `127.0.0.1`, or `::1`) so timeline context and tool results are not sent to a remote URL by mistake.

The Lemonade integration is scoped to AI Chat. Transcription providers remain `local`, `openai`, `assemblyai`, and `deepgram`.

### Lemonade Local Setup

1. Install and start Lemonade Server locally.
2. Download a supported local chat model in Lemonade, for example `gemma4-it-e2b-FLM`.
3. Open Preferences -> General -> AI Features.
4. Set Chat Provider to `Lemonade Local`.
5. Keep the default endpoint `http://localhost:13305/api/v1` unless Lemonade is running on another loopback address.
6. Click `Check` to verify `/models` and populate the model dropdown with installed Lemonade models.
7. Open AI Chat and use the Lemonade model selector in the panel header.

Manually imported Lemonade models may be exposed with a `user.` prefix, for example `user.gemma4-it-e2b-FLM`. The app treats `/models` as authoritative and uses the first available Lemonade model when the saved preset name is not present.

Lemonade is a provider, not an editor bridge. It can return OpenAI-compatible tool-call suggestions, but MasterSelects still applies the chat approval mode and routes execution through the shared AI tool dispatcher.

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

The current tool surface is 79 exported tool definitions across 15 exported definition groups. Two dispatch gaps remain in the shared registry:
- `openComposition` is defined and policy-registered, but the handler registry still does not map it
- `searchVideos` is the definition name, while the dispatcher still exposes the handler as `searchYouTube`

There is also a `gaussian.ts` definition file, but it is not part of the exported `AI_TOOLS` array yet, so those tools are not currently exposed to the chat model.

In development, the same shared tool surface is also exposed in the browser console:

```javascript
window.aiTools.execute('splitClip', { clipId, time: 12.5 })
window.aiTools.list()
window.aiTools.status()
```

That console surface is dev-only. The Vite dev bridge and the Native Helper HTTP bridge both route into the same dispatcher, so chat, browser-console use, and external local agents all execute against the same shared tool registry.

---

## AI Video Panel

### Location
- Tab next to AI Chat in dock panels
- View menu -> AI Video

### Panel Tabs
- **AI Video**: Generation interface
- **History**: List of generated videos

### Board Mode
- Board workspace for arranging prompts, reference frames, and generated results on a canvas
- Right-click empty space to create a draft or add the current preview frame as a reference node
- Left-drag pans the canvas everywhere, including over nodes
- Right-drag node moves with smooth edge auto-pan
- Right-drag empty canvas starts a marquee selection, and right-dragging a selected node moves the whole selection
- Double-click a node to center and fit it with padding
- Active IN / OUT / REF assignments appear as removable color badges around the prompt box
- Hovering a prompt-box badge strongly emphasizes the linked board node for as long as the badge is hovered
- Nano Banana 2 accepts up to 14 ordered reference images; the composer labels them as `REF 1`, `REF 2`, ... so prompts can refer to them explicitly
- IN / OUT / REF outlines scale with zoom and use a stronger glow so references stay readable while navigating the board

### Current Backends

The current AI Video stack is no longer best described as "PiAPI as one unified gateway". The active UI routes are:

| Backend | Where it is used | Notes |
|---------|------------------|-------|
| `Kie.ai` | Classic generator and FlashBoard | Current provider list comes from `getKieAiProviders()`; user-supplied key in Settings |
| `MasterSelects Cloud` | Classic generator and FlashBoard when hosted access is available | Hosted credits/account flow; board mode resolves to hosted Kling when no local Kie key is present |
| `PiAPI` | Legacy compatibility and some catalog/pricing metadata | Still present in older history/key migration paths and FlashBoard pricing/catalog helpers, but not the primary runtime path the current panel describes |

The practical rule for the current branch is:
- Classic mode uses Kie.ai or hosted cloud, depending on available credentials.
- Board mode uses Kie.ai by default, and falls back to hosted cloud when the user is signed in but has no local Kie.ai key.
- Service/provider labels in the panel reflect that active backend instead of a permanent PiAPI abstraction layer.

### Timeline Integration
- Add to Timeline is enabled by default
- Generated clips auto-import to the `AI Video` folder
- Clips are placed on an empty or new video track at the playhead

---

## AI Segmentation and MatAnyone2

> **Status:** Work in progress

The panel combines two different mask sources:
- **SAM 2** runs locally in the browser for interactive segmentation and frame propagation
- **Paint** is a browser-only fallback that does not require a model download
- **MatAnyone2** is a separate native-helper-backed video matting step that consumes either mask source and produces the alpha matte output

SAM 2 inference runs locally in the browser using ONNX Runtime with WebGPU acceleration. No API keys or cloud services are involved.

### Location
- Tab in dock panels alongside AI Chat and AI Video
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
- Uses either the painted mask or the SAM 2 live mask
- Writes a mask PNG next to the selected video file, then launches the native-helper matting job
- Produces the alpha matte output and exposes progress, job state, and cancellation
- Shows a helper-unavailable state when the Native Helper is not connected

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

## AI Editor Tools

### 79 Tools across 15 Exported Definition Groups

> **Note:** `openComposition` and `searchVideos` are still the two current dispatch gaps. They are defined and appear in the policy registry, but the shared handler registry does not map them yet. Gaussian Splat tool definitions also exist in `src/services/aiTools/definitions/gaussian.ts`, but that file is not currently exported through `AI_TOOLS`.

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

The chat and bridge code call the shared dispatcher, so the same registry is used in-chat, through the Vite dev bridge, and through the Native Helper bridge. Approval behavior is enforced in the chat UI before execution, while the dispatcher policy is the actual execution gate.

### Local File And Batch Workflows

- `executeBatch` groups multiple actions under one undo point and shares a single visual stagger budget.
- Several clip tools default `withLinked: true`, so linked audio/video companions move, split, or delete together unless the caller opts out.
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

## Hosted Chat Logging

Hosted `/api/ai/chat` requests are logged best-effort into the D1 `chat_logs` table:

- Successful and failed chat completions are both recorded
- Stored fields include model, request/response payloads, tool calls, token counts, credit cost, duration, and error state
- Logging is non-blocking; failures to write logs do not fail the chat response

Authenticated users can inspect that history through:

- `GET /api/ai/chat-history`
- `GET /api/ai/chat-history?id=<log-id>`

---

## Transcription

### 4 Providers

#### Local Whisper (Browser)
- Uses `@huggingface/transformers`
- Model selection is language-dependent
- No API key needed
- Dynamically imported on first use

#### OpenAI Whisper API
```
Endpoint: /v1/audio/transcriptions
Model: whisper-1
Format: verbose_json
Granularity: word
```

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
- Local Whisper transcription runs in-browser

### Storage
API keys are stored encrypted in IndexedDB via Web Crypto API. SAM 2 model files are stored in OPFS. MatAnyone2 runtime state and its model/files live in the Native Helper and the local file system.

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

*Source: `src/main.tsx`, `src/components/panels/AIChatPanel.tsx`, `src/components/panels/AIVideoPanel.tsx`, `src/components/panels/SAM2Panel.tsx`, `src/components/panels/MultiCamPanel.tsx`, `src/components/panels/SceneDescriptionPanel.tsx`, `src/components/preview/SAM2Overlay.tsx`, `src/services/sam2/SAM2Service.ts`, `src/services/sam2/SAM2ModelManager.ts`, `src/services/sam2/sam2Worker.ts`, `src/stores/sam2Store.ts`, `src/services/aiTools/`, `src/services/aiTools/aiFeedback.ts`, `src/services/aiTools/executionState.ts`, `src/services/aiTools/bridge.ts`, `src/services/sceneDescriber.ts`, `src/services/claudeService.ts`, `src/services/kieAiService.ts`, `src/services/cloudAiService.ts`, `src/services/flashboard/`, `src/stores/multicamStore.ts`, `src/services/multicamAnalyzer.ts`, `functions/api/ai/chat.ts`, `functions/api/ai/chat-history.ts`, `functions/lib/chatLog.ts`*
