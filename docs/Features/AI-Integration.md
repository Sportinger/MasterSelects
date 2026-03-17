# AI Integration

[← Back to Index](./README.md)

GPT-powered editing with 76 tools, multi-provider AI video generation, transcription, multicam EDL generation, and AI object segmentation.

---

## Table of Contents

- [AI Chat Panel](#ai-chat-panel)
- [AI Video Panel](#ai-video-panel)
- [AI Segmentation (SAM 2)](#ai-segmentation-sam-2)
- [AI Editor Tools](#ai-editor-tools)
- [Transcription](#transcription)
- [Multicam EDL](#multicam-edl)
- [Configuration](#configuration)

---

## AI Chat Panel

### Location
- Default tab in dock panels
- View menu → AI Chat

### Features
- Interactive chat interface
- Model selection dropdown
- Conversation history
- Clear chat button
- Auto-scrolling
- Tool execution indicators

### Available Models
```
GPT-5.2, GPT-5.2 Pro
GPT-5.1, GPT-5.1 Codex, GPT-5.1 Codex Mini
GPT-5, GPT-5 Mini, GPT-5 Nano
GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano
GPT-4o, GPT-4o Mini
o3, o4-mini, o3-pro (reasoning)
```

Default model: `gpt-5.1`

### Editor Mode
When enabled (default):
- Includes timeline context in prompts
- 76 editing tools available (74 fully functional; 2 have registration bugs -- see [Code Bugs](#code-bugs) note below)
- AI can manipulate timeline directly

---

## AI Video Panel

### Location
- Tab next to AI Chat in dock panels
- View menu → AI Video

### Panel Tabs
- **AI Video**: Generation interface
- **History**: List of all generated videos

### Supported Services
Uses **PiAPI** as a unified API gateway, supporting multiple AI video providers:

| Provider | Description | Text-to-Video | Image-to-Video |
|----------|-------------|:---:|:---:|
| **Kling AI** | High quality, native audio | Yes | Yes |
| **Luma Dream Machine** | Cinematic quality | Yes | Yes |
| **Hailuo (MiniMax)** | Fast generation | Yes | Yes |
| **Hunyuan** | Tencent model | Yes | Yes |
| **Wanx (Wan)** | Alibaba model | Yes | Yes |
| **SkyReels** | AI video generation | Yes | Yes |

Provider is selectable via a dropdown in the panel header.

### Generation Modes

#### Text-to-Video
Generate video from text prompts:
- Describe the scene, subjects, and actions
- Select aspect ratio (16:9, 9:16, 1:1)

#### Image-to-Video
Animate images:
- Drag & drop or click to upload start/end frames
- **Use Current Frame** button captures timeline preview
- Interactive image cropper with pan and zoom, locked to selected aspect ratio
- Optional end frame for guided animation (Kling only)
- Video morphs between frames

### Parameters

| Parameter | Options | Description |
|-----------|---------|-------------|
| **Provider** | Kling, Luma, Hailuo, Hunyuan, Wanx, SkyReels | AI video model provider |
| **Version** | Provider-specific (e.g. Kling: v2.6, v2.5, v2.1, v2.1-master, v1.6, v1.5) | Newer versions have better quality |
| **Duration** | Provider-specific (e.g. 5s, 10s) | Video length |
| **Aspect Ratio** | 16:9, 9:16, 1:1 | Output dimensions |
| **Quality** | Standard, Professional | Pro is slower but higher quality (providers with multiple modes) |
| **CFG Scale** | 0.0-1.0 | Prompt adherence strength (Kling only) |
| **Negative Prompt** | Text | What to avoid in generation |

### Timeline Integration
- **Add to Timeline** checkbox (enabled by default)
- Videos auto-import to "AI Video" folder in Media Panel
- Clips placed on empty or new video track at playhead

### Generation Queue
- Jobs appear in queue with status
- Status: Queued → Processing → Done/Failed
- Download generated videos directly
- Remove jobs from queue

### History Tab
- Persistent list of all generated videos (last 50, localStorage)
- Video thumbnails with play/pause
- Draggable to timeline
- "In Timeline" badge for added clips
- "+ Timeline" button to add manually

### API Authentication
PiAPI uses a single API key:
1. Get a key from [PiAPI](https://piapi.ai)
2. Enter the PiAPI key in Settings → API Keys
3. Account balance and estimated generation costs shown in the panel

### Task-Based Workflow
```
1. Submit generation request via PiAPI
2. Receive task ID
3. Poll for status updates
4. On completion:
   - Import video to "AI Video" folder
   - Optionally add clip to timeline
   - Add to history for later access
```

---

## AI Segmentation (SAM 2)

> **Status:** Work in progress (WIP badge in the panel tab)

### Overview
AI-powered object segmentation using Meta's **Segment Anything Model 2 (SAM 2)**. Click on objects in the preview to create precise masks, then optionally propagate those masks across video frames. All inference runs locally in the browser using ONNX Runtime with WebGPU acceleration — no API keys or cloud services required.

### Location
- Tab in dock panels alongside AI Chat and AI Video
- View menu → AI Segment

### One-Time Model Download
On first use, the panel prompts for a one-time model download:
- **Model:** SAM 2 Hiera Small (fp16 encoder + ONNX decoder)
- **Total size:** ~103 MB (encoder ~82 MB + decoder ~21 MB)
- **Storage:** Cached in the browser's Origin Private File System (OPFS) for persistent local storage
- **Progress:** Download progress bar shown in the panel
- After download, the model auto-loads into ONNX sessions for immediate use
- On subsequent visits, cached models are detected and loaded automatically

### Model Lifecycle

| Status | Description |
|--------|-------------|
| **Not Downloaded** | Panel shows download prompt |
| **Downloading** | Progress bar with percentage |
| **Downloaded** | Cached in OPFS, auto-loading |
| **Loading** | Creating ONNX inference sessions |
| **Ready** | Green status dot, ready for segmentation |
| **Error** | Red status dot with error message and retry button |

### Point-Based Segmentation
Once the model is ready and a clip is selected in the timeline:

1. **Activate** segmentation mode using the Activate button
2. **Left-click** on the preview canvas to place a **foreground point** (green) — marks regions to include in the mask
3. **Right-click** to place a **background point** (red) — marks regions to exclude from the mask
4. Each point triggers an immediate decode pass, updating the mask in real time
5. Points are listed in the panel with coordinates and can be individually removed

The **Auto-Detect** button places a center-point and runs a full encode + decode cycle, useful for quick initial segmentation of a prominent subject.

### Preview Overlay
When segmentation is active, a transparent overlay appears on top of the preview canvas:
- **Mask visualization:** Selected regions shown as a blue semi-transparent overlay
- **Point markers:** Foreground points shown as green dots, background points as red dots, each with a white border and center dot
- **Processing indicator:** Text overlay appears while the model is computing
- **Crosshair cursor:** Indicates the overlay is ready for point placement

### Display Settings

| Setting | Range | Description |
|---------|-------|-------------|
| **Opacity** | 0–100% | Transparency of the mask overlay |
| **Feather** | 0–50px | Edge softness of the mask |
| **Invert Mask** | On/Off | Swap foreground and background regions |

### Video Propagation
After creating a mask on the current frame, propagate it forward across subsequent frames:
- **Forward** button propagates the mask up to 150 frames (~5 seconds at 30fps)
- Progress bar and percentage shown during propagation
- **Stop** button to cancel propagation at any time
- Each propagated frame's mask is RLE-compressed and stored efficiently in memory
- Propagation uses the SAM 2 memory bank mechanism to track objects across frames

### Architecture
All heavy computation runs off the main thread to keep the UI responsive:
- **Web Worker** (`sam2Worker`) handles ONNX encoder and decoder inference
- **Encoder** runs with WebGPU acceleration (WASM fallback if WebGPU is unavailable in the worker)
- **Decoder** runs on WASM (small model, fast enough without GPU)
- **Message protocol:** Main thread sends encode/decode/propagate requests; worker responds with embeddings, masks, and progress updates
- **RLE compression** for storing per-frame masks efficiently (run-length encoding of binary mask data)

### Workflow
```
1. Open AI Segment panel
2. Download model (first time only, ~103 MB)
3. Select a video clip in the timeline
4. Click "Activate" to enable segmentation mode
5. Left-click objects to include, right-click to exclude
6. Adjust opacity/feather/invert as needed
7. Optionally propagate mask forward through video
8. Clear All to reset and start over
```

---

## AI Editor Tools

### 76 Tools across 15 Categories

> **Note:** Of 76 defined tools, 74 are fully functional. 2 tools have registration bugs: `openComposition` has an unregistered handler, and `searchVideos` has a name mismatch with the registered `searchYouTube` handler. See the codebase for details.

#### Timeline State (3 tools)
| Tool | Description |
|------|-------------|
| `getTimelineState` | Full timeline state (tracks, clips, playhead) |
| `setPlayhead` | Move playhead to time |
| `setInOutPoints` | Set in/out markers |

#### Clip Info (2 tools)
| Tool | Description |
|------|-------------|
| `getClipDetails` | Detailed clip info + analysis + transcript |
| `getClipsInTimeRange` | Find clips in time range |

#### Clip Editing (10 tools)
| Tool | Description |
|------|-------------|
| `splitClip` | Split at specific time |
| `splitClipEvenly` | Split into N equal parts |
| `splitClipAtTimes` | Split at multiple specific times |
| `deleteClip` | Delete single clip |
| `deleteClips` | Delete multiple clips |
| `moveClip` | Move to new position/track |
| `trimClip` | Adjust in/out points |
| `cutRangesFromClip` | Remove multiple sections |
| `reorderClips` | Reorder clips by ID list |
| `addClipSegment` | Add a segment of a source clip to timeline |

#### Selection (2 tools)
| Tool | Description |
|------|-------------|
| `selectClips` | Select clips by ID |
| `clearSelection` | Clear selection |

#### Track Tools (4 tools)
| Tool | Description |
|------|-------------|
| `createTrack` | Create video/audio track |
| `deleteTrack` | Delete track and clips |
| `setTrackVisibility` | Show/hide track |
| `setTrackMuted` | Mute/unmute track |

#### Visual Capture (3 tools)
| Tool | Description |
|------|-------------|
| `captureFrame` | Export PNG at time |
| `getCutPreviewQuad` | 4 frames before + 4 after a cut point |
| `getFramesAtTimes` | Grid image at multiple times |

#### Analysis & Transcript (6 tools)
| Tool | Description |
|------|-------------|
| `getClipAnalysis` | Motion/focus/brightness data |
| `getClipTranscript` | Word-level transcript |
| `findSilentSections` | Find silence gaps |
| `findLowQualitySections` | Find blurry sections |
| `startClipAnalysis` | Trigger background analysis |
| `startClipTranscription` | Trigger transcription |

#### Media Panel (10 tools)
| Tool | Description |
|------|-------------|
| `getMediaItems` | Files, compositions, folders |
| `createMediaFolder` | Create folder |
| `renameMediaItem` | Rename item |
| `deleteMediaItem` | Delete item |
| `moveMediaItems` | Move to folder |
| `createComposition` | Create new composition |
| `openComposition` | Open/switch to composition |
| `importLocalFiles` | Import files from local filesystem |
| `listLocalFiles` | List files in a local directory |
| `selectMediaItems` | Select in panel |

#### Batch Operations (1 tool)
| Tool | Description |
|------|-------------|
| `executeBatch` | Execute multiple tool calls as a single undo-able action |

#### YouTube / Downloads (4 tools)
| Tool | Description |
|------|-------------|
| `searchVideos` | Search YouTube for videos by keyword |
| `listVideoFormats` | List available formats for a video URL |
| `downloadAndImportVideo` | Download video and import to timeline |
| `getYouTubeVideos` | List videos in the Downloads panel |

#### Transform (1 tool)
| Tool | Description |
|------|-------------|
| `setTransform` | Set position, scale, rotation on a clip |

#### Effects (4 tools)
| Tool | Description |
|------|-------------|
| `listEffects` | List available GPU effects |
| `addEffect` | Add effect to clip |
| `removeEffect` | Remove effect from clip |
| `updateEffect` | Update effect parameters |

#### Keyframes (3 tools)
| Tool | Description |
|------|-------------|
| `getKeyframes` | Get keyframes for a clip property |
| `addKeyframe` | Add keyframe at time |
| `removeKeyframe` | Remove keyframe by ID |

#### Playback (8 tools)
| Tool | Description |
|------|-------------|
| `play` | Start playback |
| `pause` | Pause playback |
| `setClipSpeed` | Set clip playback speed |
| `undo` | Undo last action |
| `redo` | Redo last undone action |
| `addMarker` | Add timeline marker |
| `getMarkers` | Get all markers |
| `removeMarker` | Remove marker by ID |

#### Transitions (2 tools)
| Tool | Description |
|------|-------------|
| `addTransition` | Add transition between clips |
| `removeTransition` | Remove transition |

#### Masks (9 tools)
| Tool | Description |
|------|-------------|
| `getMasks` | Get masks on a clip |
| `addRectangleMask` | Add rectangle mask |
| `addEllipseMask` | Add ellipse mask |
| `addMask` | Add custom polygon mask |
| `removeMask` | Remove mask |
| `updateMask` | Update mask properties |
| `addVertex` | Add vertex to mask path |
| `removeVertex` | Remove vertex from mask path |
| `updateVertex` | Update vertex position |

#### Stats / Debug (4 tools)
| Tool | Description |
|------|-------------|
| `getStats` | Current performance stats |
| `getStatsHistory` | Historical stats data |
| `getLogs` | Get logger output |
| `getPlaybackTrace` | Get playback timing trace |

### Tool Execution Loop
```
1. User sends message
2. System builds prompt with timeline context
3. OpenAI API call with function calling
4. If tool_calls returned → execute sequentially
5. Collect results → send back to OpenAI
6. Loop until no tool_calls (max 50 iterations)
7. Display final response
```

### Undo Support
All AI edits are undoable with `Ctrl+Z`:
```typescript
// History tracking for batch operations
startBatch('AI: toolName')
// ... execute tools ...
endBatch()
```

---

## AI Visual Feedback System

When the AI executes tools, visual feedback is provided to the user so they can follow along with what the AI is doing.

### Components

| File | Purpose |
|------|---------|
| `aiFeedback.ts` | Visual feedback coordination -- panel/tab switching, preview canvas flash (shutter, undo/redo), timeline marker animations via CSS class toggling |
| `executionState.ts` | Execution state tracking -- tracks whether an AI operation is active, manages stagger budget |
| `aiActionFeedbackSlice.ts` | Timeline store slice that provides reactive state for AI action feedback in the UI |

### Stagger Budget System

To prevent overwhelming the user with instant bulk operations, AI tool execution uses a **stagger budget** system for smooth animations:

- A total budget (default 3000ms) is allocated per AI operation
- Visual delays (e.g., sequential split animations, batch step highlights) share this budget
- `consumeStaggerDelay(remainingSteps)` spreads the remaining budget evenly across remaining steps
- Once the budget is exhausted, remaining steps execute instantly (no unnecessary delays)
- Maximum per-step delay is capped at 1000ms

### Feedback Actions

| Action | Visual Effect |
|--------|--------------|
| `activateDockPanel()` | Switches to and focuses a specific panel tab in the dock |
| `openPropertiesTab()` | Opens a specific tab (transform, effects, masks, etc.) in the Properties panel |
| `selectClipAndOpenTab()` | Selects a clip and opens the relevant properties tab |
| `flashPreviewCanvas()` | Brief overlay flash on the preview (shutter for capture, undo/redo indicators) |
| `animateMarker()` | Triggers CSS animation on a timeline marker |
| `animateKeyframe()` | Triggers CSS animation on a keyframe indicator |

All feedback functions are guarded by `isAIExecutionActive()` -- they only trigger during active AI tool execution, never during normal user interactions.

---

## AI Bridge Architecture

External AI agents (e.g., Claude CLI) can execute AI tools via HTTP. Two bridge modes exist depending on the environment:

### Development (HMR Bridge)

In development, the Vite dev server proxies HTTP requests to the running app via HMR (Hot Module Replacement):

```
POST /api/ai-tools → Vite server → HMR WebSocket → browser → aiTools.execute() → HMR → HTTP response
```

- Implemented in `src/services/aiTools/bridge.ts`
- Uses `import.meta.hot.on('ai-tools:execute', ...)` to receive requests
- Uses `import.meta.hot.send('ai-tools:result', ...)` to return results
- Supports `_list` and `_status` meta-commands alongside tool execution

### Production (Native Helper Bridge)

In production builds (no HMR available), the Rust native helper proxies HTTP to the app via WebSocket:

```
POST http://127.0.0.1:9877/api/ai-tools → Native Helper → WebSocket (port 9876) → browser → aiTools.execute()
```

- Native helper listens on HTTP port 9877 and WebSocket port 9876
- Both modes converge at `executeToolInternal()` in `src/services/aiTools/handlers/index.ts`

---

## Scene Description

`sceneDescriber.ts` integrates with **Qwen3-VL** (local AI model) for automated scene analysis. The service communicates with a local Python server running Qwen3-VL for native video understanding with temporal reasoning.

- **Server:** `tools/qwen3vl-server/` -- Python server at `localhost:5555`
- **Start command:** `cd tools/qwen3vl-server && venv\Scripts\python.exe server.py --preload`
- **No API key required** -- runs entirely locally
- **UI:** AI Scene Description panel (`SceneDescriptionPanel.tsx`) and Analysis tab in Properties panel
- Produces time-coded scene segments with descriptions, synced to timeline playback

### Supporting Services

| Service | Purpose |
|---------|---------|
| `clipAnalyzer.ts` | Backend for AI clip analysis tools -- computes motion, focus, and brightness data per frame |
| `clipTranscriber.ts` | Backend for AI transcription tools -- manages transcription pipeline for clips |

---

## Transcription

### 4 Providers

#### Local Whisper (Browser)
- Uses `@huggingface/transformers`
- Model selection is language-dependent:
  - English: `Xenova/whisper-tiny.en`
  - Other languages: `onnx-community/whisper-tiny`
  - Legacy `whisperService.ts` still uses `Xenova/whisper-tiny`
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

### Transcript Format
```typescript
interface TranscriptEntry {
  id: string;
  start: number;   // ms
  end: number;     // ms
  text: string;
  speaker?: string; // For diarization
}
```

### Time Offset Handling
For trimmed clips:
```
Clip inPoint = 5000ms
Word timestamp = 3000ms (within trimmed audio)
Final timestamp = 3000 + 5000 = 8000ms (timeline time)
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
| `documentary` | Long cuts (5+s), B-roll, wide establishing |
| `custom` | User-provided instructions |

### EDL Format
```typescript
interface EditDecision {
  id: string;
  start: number;        // ms
  end: number;          // ms
  cameraId: string;
  reason?: string;
  confidence?: number;  // 0-1
}
```

### Input Data
Claude receives:
- Camera info (names, roles)
- Analysis data (motion, sharpness per camera at sampled intervals)
- Transcript with speaker identification
- Audio levels

### Multicam Panel
A dedicated `MultiCamPanel` component provides the full workflow UI:
- Add cameras from the media panel
- Set master camera for audio reference
- Audio-based sync between cameras
- CV analysis (motion, sharpness) per camera
- Transcript generation via local Whisper
- EDL generation via Claude API
- Apply EDL directly to the timeline

---

## Configuration

### API Keys
Settings dialog → API Keys:
- **OpenAI** API key (for AI chat + transcription)
- **PiAPI** key (for AI video generation — Kling, Luma, Hailuo, etc.)
- **Kling Access Key** (`klingAccessKey`) -- for direct Kling API access (alternative to PiAPI)
- **Kling Secret Key** (`klingSecretKey`) -- paired with the access key for Kling API authentication
- **AssemblyAI** key (transcription)
- **Deepgram** key (transcription)
- **YouTube** Data API v3 key (optional)

Multicam panel → Settings:
- **Claude** API key (for multicam EDL generation, stored separately via encrypted IndexedDB)

### No API Key Required
- **SAM 2 AI Segmentation** — runs entirely in the browser, no external service
- **Local Whisper transcription** — runs in-browser via @huggingface/transformers

### Storage
API keys stored encrypted in IndexedDB via Web Crypto API. SAM 2 model files stored in OPFS.

### Security Considerations

- **Encryption at rest:** Keys are encrypted in IndexedDB using a per-browser AES-256-GCM key generated via Web Crypto API. This protects against casual inspection (e.g., browsing IndexedDB in DevTools) but does **not** protect against same-origin scripts or browser extensions with storage access.
- **File export disabled:** The `.keys.enc` file export/import feature is disabled pending implementation of user-passphrase-based encryption. The previous implementation used a deterministic hardcoded passphrase, which provided only obfuscation. Keys must be re-entered on new machines.
- **Log redaction:** Log output is automatically scanned and redacted for common secret patterns (OpenAI keys, Bearer tokens, API key URL params, etc.) before being stored in the log buffer or sent via the AI tool bridge.
- **Dev bridge authentication:** The AI tool bridge in development mode (`POST /api/ai-tools`) runs only on localhost via the Vite HMR channel. In production, the native helper bridge authenticates via a random startup Bearer token.

See [Security](./Security.md) for the full security model documentation.

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
3. Undo if needed (`Ctrl+Z`)
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

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`aiToolDefinitions.test.ts`](../../tests/unit/aiToolDefinitions.test.ts) | 27 | Tool definitions, schemas, MODIFYING_TOOLS, enums |

Run tests: `npx vitest run`

---

*Source: `src/components/panels/AIChatPanel.tsx`, `src/components/panels/AIVideoPanel.tsx`, `src/components/panels/SAM2Panel.tsx`, `src/components/panels/MultiCamPanel.tsx`, `src/components/panels/SceneDescriptionPanel.tsx`, `src/components/preview/SAM2Overlay.tsx`, `src/services/sam2/SAM2Service.ts`, `src/services/sam2/SAM2ModelManager.ts`, `src/services/sam2/sam2Worker.ts`, `src/stores/sam2Store.ts`, `src/services/aiTools/` (directory), `src/services/aiTools/aiFeedback.ts`, `src/services/aiTools/executionState.ts`, `src/services/aiTools/bridge.ts`, `src/services/sceneDescriber.ts`, `src/services/claudeService.ts`, `src/services/piApiService.ts`, `src/stores/multicamStore.ts`, `src/services/multicamAnalyzer.ts`*
