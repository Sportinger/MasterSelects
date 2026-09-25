# AI Integration

[← Back to Index](./README.md)

Model-powered editing through the private hosted-agent kernel and shared public editor tool catalog, plus multi-provider AI video/image/audio generation, local scene description, transcription, browser-local SAM 2 segmentation, native-helper MatAnyone2 matting, and local MuScriptor music-to-MIDI.

---

## Table of Contents

- [FlashBoard Chat](#flashboard-chat)
- [Chat Providers](#chat-providers)
- [Media Generator Tray](#media-generator-tray)
- [AI Segmentation and MatAnyone2](#ai-segmentation-and-matanyone2)
- [AI Editor Tools](#ai-editor-tools)
- [AI Visual Feedback System](#ai-visual-feedback-system)
- [AI Bridge Architecture](#ai-bridge-architecture)
- [Hosted AI Safety And Audit](#hosted-ai-safety-and-audit)
- [Transcription](#transcription)
- [Scene Description](#scene-description)
- [Configuration](#configuration)

---

## FlashBoard Chat

> **Two explicit runtimes:** `Codex Direct` is the default in development and
> production and reaches the isolated Codex app-server through authenticated
> same-origin relays. `Fast` uses Hosted Agent V2 through the kernel-owned
> `/api/kernel/normal/*` boundary. In both cases, the browser retains atomic
> tool validation, policy, confirmation, transactions, undo, and execution.
> See [Kernel Client](./Kernel-Client.md) for routes and lifecycles.

### Location
- Floating FlashBoard composer chat mode

### Features
- Interactive chat interface
- Development and production default to `Codex Direct`: one resumable Codex thread controls the live editor through the complete approved MasterSelects tool surface
- The same Direct conversation and active run remain visible when switching between `/chat` and the editor layout
- Compact Model menu with exactly `Fast` and `Codex Direct`; Direct is the default and Logic is neither shown nor requested by the UI
- The separate `Story` product workflow remains available from the prompt-path menu
- Conversation history
- Clear chat button
- Auto-scrolling
- Tool execution indicators

### Chat Providers

| Provider | Runtime | Configuration |
|---|---|---|
| `MasterSelects Hosted Agent` | Cloudflare edge plus private kernel; the server owns the actual provider/model route | Signed-in account with Hosted Agent V2 enabled |

Hosted chat keeps all provider and kernel credentials off the browser. The
browser has no provider-key setting, credential header, or direct provider
fallback. Production Direct and Fast both require the signed-in session;
unavailable access fails closed with a visible account, capability, credit, or
service error.

`Codex Direct` connects through the same-origin `/api/direct-codex/ws` WebSocket
route. In production Cloudflare validates the Origin and signed-in session,
binds the authenticated principal, and relays to the private kernel's bounded
`/kernel/direct-codex/ws` endpoint; that endpoint alone reaches the loopback
Codex app-server. In `dev:full`, the same public path resolves to the local
relay. Its opaque thread ID is retained in tab-scoped session storage, so
subsequent prompts resume the Codex context without resending the visible
transcript. The active workspace conversation ID binds the `/chat` and
floating editor projections, while a shared run owner prevents layout unmounts
from aborting the turn. Explicit Stop/New actions still interrupt or reset the
session.

Transcription modes are
`local`, `openai`, `assemblyai`, `deepgram`, and the `hybrid` Deepgram + OpenAI
fusion path.

FlashBoard Chat includes a `PromptBook` button for provider-specific system prompt overrides, generation prompts, generated media, chat history, and tool-call history. Prompts can be saved into the current project folder under `Prompts/*.prompt.json`, reloaded from the saved prompt list, reset to the built-in prompt, imported from a text/Markdown file, and exported as a `.txt` file. The active override and its `Send current MasterSelects context` setting are mirrored in app settings so the chat can use them immediately. The floating FlashBoard Chat is the primary AI editing surface.

### Hosted route choices

The editor does not expose raw provider names, product-model IDs, or the old
Very Fast/Fast/Slow class selector. Its Model menu contains two choices within
the Auto path: `Codex Direct`, the default resumable app-server session, and
`Fast`, which requests the hosted Standard backend through the Normal Path.
The private kernel may retain Logic as an internal compatibility capability,
but the product UI neither renders nor requests it. The edge and private kernel
remain authoritative for availability, authentication, billing policy, and
the actual backend mapping.

### Editor Mode
For Hosted V2 editor work:
- Includes timeline context in prompts
- Builds the pinned, versioned atomic editor-tool catalog from
  `src/services/aiTools/editorToolCatalog`
- Validates operation plans, revisions, results, and settlement bindings before
  they reach the shared dispatcher
- Applies the normal public policy, authorization, confirmation, transaction,
  and undo rules; the private kernel does not mutate the timeline directly

The Hosted V2 catalog and per-round batch are bounded by the versioned public
contract. The legacy Kie V1 request builder retains its separate 128-tool cap,
but that compatibility transport has no private production target.

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

Generation launches from Media so generated results land directly beside imported assets.

### FlashBoard Prompt Mode
- Compact prompt composer for video, image, and audio generation
- The expanded AI tray is loaded lazily on hover/click interaction; the collapsed tray does not import the heavy FlashBoard runtime on idle startup.
- Active IN / OUT / REF assignments appear as removable media cards around the prompt box; image-to-video cards expose inline `IN`, `REF`, and `OUT` role controls
- Compact setting buttons such as model, aspect ratio, duration, image size, and mode open as inline submenus: the standard control row slides out, submenu pills stagger in, and the default row returns after selection
- Reference cards use pointer-proximity magnification in the compact Media tray, with previews scaling visually outside the tray without changing the prompt box height; crowded trays switch the reference cards into a vertical scroll strip
- Media Panel image, video, and audio files can be referenced by right-clicking them or dragging them onto the expanded prompt composer
- Hosted Kie.ai-backed image generation includes Nano Banana 2, Nano Banana Pro, GPT Image 2, Flux 2 Pro, Seedream 5 Lite, and Flux Kontext Pro/Max through the shared async image-provider adapter. GPT Image 2 Edit, Flux 2 Pro Edit, Seedream 5 Lite Edit, Recraft Remove Background, Recraft Crisp Upscale, and Topaz Image Upscale require at least one reference image before generation is enabled.
- Kie.ai utility image/video models are exposed in the same Image and Video category chips. Recraft and Topaz image utilities can run without a prompt but require image input; Topaz Video Upscale can run without a prompt but requires a video reference and uses the mode button for `2x` / `4x`.
- Kie.ai video generation includes hosted Kling 3.0, Seedance 2.0 / Fast, Veo 3.1, and Runway through MasterSelects Cloud. Veo and Runway use their dedicated Kie endpoints and polling schemas rather than the generic Market `recordInfo` schema.
- The compact composer shows empty dashed capability slots for the selected video model's available inputs (`IN`, `OUT`, `REF`, `VID`, `AUD`) next to real reference cards. Resolution-capable models label their mode control with actual outputs such as `720p`, `1080p`, and `4K`; Runway hides `1080p` when `10s` is selected because Kie.ai does not allow that combination.
- Nano Banana 2 and Nano Banana Pro accept up to 14 ordered reference images through the hosted Kie.ai route. Kie.ai and Cloud Seedance 2.0 / Fast accept multimodal image/video/audio references and send audio references as `reference_audio_urls` for lip-sync / performance timing; the composer labels generic references as `REF 1`, `REF 2`, ... so prompts can refer to them explicitly
- Seedance 2.0 standard and Fast cannot combine strict `first_frame_url` / `last_frame_url` with multimodal references in the same Kie.ai request, so IN / OUT cards are converted to image references when REF media is present. Audio references are passed separately as input drivers through `reference_audio_urls`; adding one to Seedance automatically enables the `Sound` toggle so the Kie.ai request also sends `generate_audio: true`. Audio-only Seedance references are blocked locally because Seedance requires audio references to be paired with at least one image or video anchor.
- Suno Music and Suno Sounds are separate Music-category targets. Suno Music keeps the lyrics/style/negative-tags controls; Suno Sounds uses the normal prompt box plus the mode button for one-shot/loop sounds. Both run through hosted Cloud credits from the Media generator tray.
- The wand button in the composer refines the current prompt with GPT 5.6 Luna through the hosted Kie.ai route. It requires hosted access and has no direct-key fallback. The Original and Magic prompt boxes expand on focus for full reading/editing, and the Original text remains selectable for copying. The Magic prompt opens at full height briefly after refinement, then collapses to a compact scrollable height so the Generate controls stay anchored. Suno Music, Suno Sounds, Nano Banana, GPT Image, Flux, Flux Kontext, Recraft/Topaz utilities, Seedream, Imagen, Kling, Seedance, Veo, and Runway targets use model-specific guidance so the refined prompt follows the selected model's input style and constraints.
- The collapsed Media tray shows separate `Chat` and `Generate` launch buttons. `Chat` opens a compact hosted-chat prompt window with model selection, reasoning effort for supported GPT models, a visible per-round credit estimate, a prompt-history view, and a temperature slider when the selected model accepts temperature. The selected hosted model survives minimize/reopen, app restart, and HMR remount.
- Compact chat requests include the fixed Media-chat prompt, current timeline summary, and callable editor tools. After a hosted-agent tool batch changes the timeline, the editor automatically captures one current preview frame and returns it as a validated multimodal tool result; explicit `getFramesAtTimes` remains available for comparing 3-8 moments. For visual questions and content-aware edits such as funny, highlight, storytelling, or scene-based cuts, captured frame grids are returned to the hosted provider as real multimodal image inputs instead of being reduced to text metadata. Transcript remixes convert source-word timestamps through the clip's placement, trim, speed, and reverse state, then continue from `splitClipAtTimes` through a fresh timeline read to `reorderClips` in the same turn because the split creates the IDs needed for the final arrangement. Tool calls route through the shared dispatcher and approval policy.
- Queued and running generations appear as Media Panel preview cards with output type, status, elapsed timer, prompt, metadata, and progress when the provider reports it. The tray can keep 100 local jobs active; hosted Kie.ai task starts are globally paced through a Cloudflare Durable Object at 19 starts per 10 seconds, so image, video, and Suno bursts share one provider-safe lane instead of producing 429s.
- The tray reuses the FlashBoard queue/import runtime without showing the full node canvas

### Backends

| Backend | Where it is used | Notes |
|---------|------------------|-------|
| `Private kernel` | Compact editor chat and deterministic intent compilation | Owns provider/model routing and orchestration. It returns bounded operation plans; it does not mutate browser state directly. |
| `Kie.ai` | Server-side provider for hosted FlashBoard media and other explicitly managed Cloud generation paths | Browser requests enter authenticated MasterSelects Cloud routes; provider keys never enter client settings or storage. It is not the public owner of editor-agent orchestration. |
| `MasterSelects Cloud` | FlashBoard production and hosted development | Owns hosted account/credit flow, signed-in `/api/kernel/*` relays, D1 turn lifecycle, service assertions, and server secrets. Media remains on `/api/ai/*`; editor chat uses the single `/api/kernel/normal/*` route family. |
| `ElevenLabs` | Hosted FlashBoard speech generation | The provider credential stays in the hosted service; browser requests use MasterSelects Cloud credits |
| `Suno` | FlashBoard music and sound generation | Suno Music and Suno Sounds use the hosted Cloud path from the Media generator tray |
| `OpenAI` | Hosted moderation and transcription; may also be selected privately by the kernel | Public browser code does not own the hosted-agent provider selection or credentials. |

Hosted AI behavior:
- Hosted AI is server-secret-only. Browser-supplied provider credentials are rejected.
- The Media generator tray routes supported media through MasterSelects Cloud.
- Cloud media pricing is shown in the Account dialog's scrollable price view only as MasterSelects Cloud credits. Its Change Plan action opens the full plan selector. Hosted Kie.ai media uses a `6x` vendor-credit conversion for margin after VAT, Stripe, and FX.
- Hosted compact chat charges by model round and allows each hosted model round to run for up to 180 seconds. If a tool call requires another hosted model follow-up, that follow-up request is charged separately; local tool execution itself is not a separate hosted charge unless the tool calls another hosted media route.
- Image generation providers implement the shared FlashBoard image-provider adapter, so adding another async image service is a catalog entry plus a provider adapter instead of another hardcoded job-service branch.
- ElevenLabs-only access opens the composer on the audio text-to-speech target.
- Service/provider labels in the tray reflect the active backend.
- Hosted ElevenLabs and Suno credentials stay server-side. Both charge logged-in users by hosted credits.

### Timeline Integration
- FlashBoard generated media imports under `AI Gen / Video`, `AI Gen / Images`, or `AI Gen / Audio`
- Video/image clips are placed on video tracks; generated ElevenLabs speech and Suno music behave like normal imported audio and route to an audio track

---

## AI Segmentation and MatAnyone2

### Browser Roto (SAM 2.1)

**AI Segment → Browser Roto** is independent of the Native Helper. It uses the
full SAM 2.1 Hiera-Tiny video export: image encoder, mask decoder, memory encoder,
memory attention and temporal object pointers. The pinned model download is
190,072,872 bytes, SHA-256 verified and cached in the browser. WebGPU is required.
The ONNX conversion is from `square-zero-labs/sam2.1-tiny-video-onnx`, revision
`3b2984dd865f6e9d2cc6aed0be6a5a5c2eb352ce` (Apache-2.0).

1. Select a video clip and open **AI Segment > Browser Roto**. **Edit in Preview**
   is enabled initially: click directly on the object in the main Preview. The
   corresponding source frame loads automatically. **Use current frame** is also
   available, and **Detail preview** opens an optional raw-source view.
2. Click **Include** points on the object and **Exclude** points on unwanted
   regions. Right-click or Ctrl/Command-click also excludes. **Undo point** revises
   the current selection. The first inference downloads and loads the model if needed.
3. Set **Track range (s)** and track forward or backward. Both passes start from
   a user-authored reference. Source frame timestamps, including variable frame
   durations, determine the stored masks.
4. Navigate with the source-frame buttons or **Source time → Go to source time**.
   Add points on a problem frame and rerun the relevant direction. Existing user
   anchors reinitialize the model when reached; masks outside the pass are kept.
5. The main Preview shows the blue mask at the current playhead, accounting for
   clip position, scale, rotation, anchor and source crop. Tracking pauses playback
   and moves the playhead to each computed source frame, so the video and blue
   selection advance in the main Preview. Scrub to inspect tracked
   frames, then click to correct. Selection is disabled during playback, processing
   or on a locked track. **Edit in Preview** returns normal Preview interactions
   when turned off; the overlay is never included in composition exports.
   Use **Detail preview > Zoom** (Fit, 200%, 400%) and scroll for precise points.
   **Mask edges** adjusts expansion/shrinkage and edge softness in mask-resolution
   pixels. Both controls are reversible; preview and exports use the same alpha.
   Keyboard users can move the canvas cursor with arrow keys (Shift: ten pixels)
   and press Enter to add a point, or Ctrl/Command+Enter to exclude.
6. Inspect **Selection overlay**, **Mask**, **Cutout**, or **Source**, then choose
   **Mask video to Media**. The grayscale H.264 video is copied into the project;
   white selects the object. Its filename/status records the source-time origin.
   **Cutout to Media** instead exports source RGB with a VP9/WebM alpha sidecar in
   the container. Both exports exclude source audio and clip effects and use source
   timing; position or retime the imported asset to match an edited timeline clip.
7. **Convert to clip mask** creates an animated, editable mask under
   **Properties > Masks**, with held path keyframes at composition frame times.
   Source trims, reverse playback and speed curves are baked into those times.
   The mask intersects existing clip masks and is empty outside tracked coverage.
   Conversion preserves pixel contours, holes and disconnected regions as one
   path with retraced connecting segments; edge softness becomes editable mask
   feathering and can differ slightly from the bitmap preview. The new mask is
   saved with the project and conversion is one undo step. Later tracking changes
   do not update it automatically. Conversion is limited to 18,000 output frames
   and 300,000 stored vertices; use a shorter clip or mask-video export above that.

The source preview is limited to a 1024-pixel edge. Segmentation retains holes
and disconnected regions, but produces binary membership rather than estimated
hair/transparency alpha. Edge softness is geometric feathering, not learned
matting. Image-warping effects are not inverted by the main Preview selection;
use the raw Detail preview for those clips. The H.264 mask video is lossy. Masks, correction points and edge settings
survive panel and clip switches in the same editor tab; inactive decoders are
released. Export or convert to a clip mask before reloading, closing the editor
or changing projects. Converted clip masks remain in the saved project.
Replacing a source or changing its trim resets that clip's session. **Clear clip
masks** frees its mask memory explicitly. The shared mask budget is 256 MiB;
tracking stops at the budget without silently evicting other clips. Each pass covers
up to 30 source seconds. Export refuses coverage gaps. **Stop rotoscoping** stops
the worker, retaining completed masks and the verified model cache. A subsequent
operation reloads cached models. Existing MatAnyone2 matting remains on its own tab.

### MatAnyone2 workflow (legacy SAM 2 and Paint selection)

The **MatAnyone2** tab combines two different mask sources:
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

### Tool Registry (parity-gated)

The exported registry holds 190 tool definitions. Hosted chat uses
the policy-eligible definitions, prioritized and capped at 128; the dev bridge
can additionally reach explicitly registered diagnostics-only tools.
`tests/unit/aiToolRegistryParity.test.ts` checks coverage; non-chat asymmetries are explicit.

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
- Motion Design shapes, ordered appearances, gradients, and Grid Replicator
- Flock clips (GPU swarm simulation graphs)

The chat and bridge code call the shared dispatcher, so the same registry is used in-chat, through the Vite dev bridge, and through the Native Helper bridge. Approval behavior is enforced in the chat UI before execution, while the dispatcher policy is the actual execution gate.

### Motion Design Tools

- `getMotionCapabilities` reports only renderer-backed primitives, appearances,
  blend modes, limits, and optional clip-specific property descriptors.
- `getMotionDesign` returns the full editable Motion definition, ordered
  appearances, stable appearance/gradient-stop ids, and effective Grid state.
- `createMotionShapeClip` creates rectangle, ellipse, polygon, or star clips with
  their primitive-specific dimensions.
- `updateMotionAppearances` retains its compact primary fill/stroke patch and also
  accepts atomic add, update, remove, move, duplicate, and visibility operations
  for ordered fills, strokes, and linear/radial gradients.
- `updateMotionProperties` animates registry-backed shape, appearance, gradient,
  and Grid values; `configureMotionReplicator` owns the bounded Grid shortcut.

### Flock Clip Tools

Atomic operations over a Flock clip's single authoritative `FlockDefinition`
(the same graph the Properties panel and the Node Workspace Flock view edit).
All mutating tools run inside the standard AI history batch (one undo step).

- `listFlockOperators` returns typed operator ports and parameter descriptors
  plus the built-in presets; `getFlockClip` returns a bounded summary (nodes,
  edges, exposed controls with their keyframe paths, compile diagnostics and
  runtime status such as state, alive count, step, memory and cache) and never
  particle arrays.
- `createFlockClip` and `applyFlockPreset` create or replace a graph from the
  presets (`free-swarm`, `krill-cloud`, `vortex`, `follow-path`,
  `technical-network`, `shrimp-pullback`, `violet-filaments`).
- `addFlockNode` adds one operator and optionally wires it in the same
  all-or-nothing step; `updateFlockNode`, `removeFlockNodes`,
  `connectFlockPorts`, `disconnectFlockEdge`, `exposeFlockParam` and
  `unexposeFlockParam` cover the rest of graph authoring with the same typed
  port, cycle and parameter validation as the UI.
- Flock parameters animate with the generic `addKeyframe` tool using
  `flock.node.<nodeId>.<param>[.x|.y|.z|.r|.g|.b]`. Those keyframes are stored
  in simulation source time: `time` stays clip-local and is converted, an
  explicit `sourceTime` targets a source second directly, and `getKeyframes`
  reports both `time` (source) and `clipLocalTime`.
- `scheduleFlockPrecompute` / `cancelFlockPrecompute` drive range precompute
  (poll `getFlockClip` → `runtime.cache.precomputeProgress`).
- `sampleFlockParticles` is a dev-bridge/console-only diagnostic returning at most
  256 particles; it is not offered to chat or the kernel catalog.

### Local File And Batch Workflows

- `executeBatch` groups multiple actions under one undo point and shares a single visual stagger budget.
- A batch action can consume data returned by a successful earlier action with `{"$batchResult":{"action":0,"path":"clipId"}}`. References are backward-only, resolve recursively inside argument objects/arrays, reject missing or unsafe paths, and make create-then-edit constructions possible without model-invented ids.
- Several clip tools default `withLinked: true`, so linked audio/video companions move, split, or delete together unless the caller opts out.
- `addMaskPathKeyframe` stores full `mask.{maskId}.path` snapshots, preserving vertex IDs so individual mask vertices can animate between keyframed shapes.
- Local filesystem tools such as `importLocalFiles` and `listLocalDirectory` run through the dev bridge in development or the Native Helper in production, and they still respect the file-access policy/allowed-root checks.

### Audio Intelligence Tools

- `startClipAudioIntelligence` starts background VAD, transcript alignment,
  speech-marker, prosody, and room-tone analysis. Its optional `features` list
  runs a subset; otherwise all five stages run.
- `getSpeechMarkers` returns bounded, pageable breaths, fillers, repetitions,
  false starts, and long pauses with source/timeline mappings and confidence.
- `findSilentSections` uses persisted voice activity first, live RMS second,
  and transcript gaps last. Every successful response includes
  `detectionSource` so an agent does not confuse model evidence with a fallback.
- Speech-marker text exposed through `getTimelineAnalysis` follows the existing
  `includeText` redaction and explicit external-data consent. Marker kind,
  timing, confidence, and counts remain available without text.

See [Audio Intelligence](./Audio-Intelligence.md) for artifacts, UI lanes,
kernel evidence, and editing behavior.

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

Guided replay also renders semantic surface gestures. Custom mask creation and `addMaskPathKeyframe` resolve normalized vertices against the Preview panel, draw the path overlay, and animate the guided cursor through each vertex with click pulses before executing the semantic tool. Timeline edit tool calls are adapted into `TimelineEditOperation` replay descriptors, so compound split tools like `splitClipEvenly` derive their cursor path from the live clip timing and visit each generated cut point before the semantic tool executes. Media placement tool calls use the same pattern: `addClipSegment` animates a Media item into the Timeline with the real drop preview, while `importLocalFiles({ addToTimeline: true })` and `downloadAndImportVideo` move the guided cursor from Media/Downloads to the target Timeline time.

---

## Development Agent Control

External agents can execute reviewed editor tools only in a local development session. The agent/model runtime is self-hosted and connects through the MCP adapter; MasterSelects does not bundle a second model harness.

### Development HMR bridge and MCP adapter

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
- `npm run mcp` exposes the reviewed tool set to a local MCP client with explicit confirm/dry-run, idempotency, and timeout controls
- Production builds and the Native Helper do not expose an external-agent tool bridge

---

## Hosted AI Safety And Audit

Hosted `/api/ai/chat`, `/api/ai/video`, and hosted generation paths in `/api/ai/audio` run a server-side OpenAI `omni-moderation-latest` preflight before provider calls. Flagged requests and moderation failures are blocked before credits are spent or provider jobs are created.

Async hosted media jobs that fail during provider status processing refund their original hosted credit charge once, update the failed usage event to zero credits, refresh the account balance, and show the user a failure dialog with the refunded credit amount and job ID.

Hosted AI requests are also logged best-effort into D1:

- Chat completions are recorded in `chat_logs` with model, request/response payloads, tool calls, token counts, credit cost, duration, and error state
- Chat, image/video generation, Suno, and ElevenLabs speech requests are recorded in `ai_audit_events`
- Audit fields include user ID, request ID, idempotency key, feature, provider, model, prompt/request payload, moderation status/categories, task ID when available, credit cost, status/error, user agent, and a salted IP hash
- Hosted AI routes reject browser-supplied provider credentials; there is no BYO provider-key path

Authenticated users can inspect that history through:

- `GET /api/ai/chat-history`
- `GET /api/ai/chat-history?id=<log-id>`

---

## Transcription

### Provider modes

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
- Signed-in accounts can choose hosted OpenAI Whisper or Deepgram through
  MasterSelects credits. OpenAI costs 6 credits per minute and Deepgram costs
  13 credits per minute; both are rounded up to the next whole credit.
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
Model: nova-3
Features: Smart formatting, word timestamps/confidence, automatic language detection, speaker diarization v2
```

- Signed-in Deepgram requests use the Cloudflare `DEEPGRAM_API_KEY` secret and
  the Nova-3 model, so the key never reaches the browser. Signed-out BYO
  requests use the same Nova-3 quality settings with the locally stored key.
- Both paths request `diarize_model=latest`, currently Deepgram's v2 batch
  diarizer, which enables diarization by itself, plus utterance detection.
  Per-word
  speaker labels, transcription confidence, speaker
  confidence, and source-relative word timestamps are retained in the
  MasterSelects transcript. An explicitly selected language is sent as a
  language hint; `auto` enables Deepgram language detection.

#### Best Quality: Deepgram Text + OpenAI Speakers

Best Quality extracts each audio range once and runs Deepgram Nova-3 and OpenAI
`gpt-4o-transcribe-diarize` in parallel. Provider ownership is fixed and fully
deterministic:

- Deepgram owns the exact transcript text, word timestamps, punctuation, and
  per-word confidence. OpenAI text never replaces or challenges a Deepgram word.
- OpenAI owns the speaker partition. Its timestamped diarized segments are
  projected onto Deepgram words by word-center time, and speaker labels are
  canonicalized by first appearance (`Speaker 1`, `Speaker 2`, ...).
- If OpenAI diarization is unavailable, the completed Deepgram speaker labels
  remain as the fallback.

There is no provider-disagreement queue, red conflict state, or transcript
review agent in this mode. The result is ready automatically when both provider
responses have been combined. Project transcript artifacts retain both raw
provider runs and deterministic speaker-assignment patches for provenance, but
the displayed words stay purely Deepgram.

Signed-out Best Quality use requires both Deepgram and OpenAI keys. Signed-in use
routes both transcription requests through hosted credits; Kie.ai is not part of
this pipeline. The live header shows Deepgram, OpenAI, and speaker application as
three compact stages. One abort controller owns the complete run and is
forwarded to direct provider fetches and hosted Cloudflare requests. Cancelling
restores the pre-run transcript/artifact snapshot and prevents late responses
from overwriting a newer run.

---

## Scene Description

AI Scene Description is available for selected video clips in the Scene
Description panel and the Properties analysis tab. It uses the local
Qwen3-VL Python server at `http://localhost:5555`, not a hosted chat provider.
The service analyzes the selected source range, stores scene segments with the
project's media artifacts when a project is open, and supports cancellation and
clearing descriptions.

---

## Configuration

### Integration Credential
Settings dialog -> Integrations supports only the optional YouTube Data API v3 key.

Hosted cloud access for chat/video does not use a user-entered API key in the desktop settings panel. It comes from the signed-in hosted account and credit balance. Kie.ai is server-managed only.

### No API Key Required
- SAM 2 AI Segmentation runs entirely in the browser
- MatAnyone2 video matting and MuScriptor music-to-MIDI run locally through isolated Native Helper sidecars
- Local Whisper transcription runs in-browser

### Storage
The optional YouTube key is stored encrypted in IndexedDB via Web Crypto API. AI provider credentials are not stored in the browser or project. SAM 2 model files are stored in OPFS. MatAnyone2 and MuScriptor runtime state and model files live in isolated Native Helper provider directories. MuScriptor's gated HuggingFace token is deliberately transient.

### Security Considerations
- Encryption at rest protects against casual inspection, not same-origin scripts or browser extensions
- Project files contain no AI provider-key sidecar
- Log output is redacted before buffering and before being exposed via the AI tool bridge
- Development agent-control calls are loopback-only and tokened; the Native Helper does not forward editor tools

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
- [Audio](./Audio.md) - Manual Timeline audio sync
- [Media Panel](./Media-Panel.md) - Organization
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

Tool definition integrity is covered by the unit tests in `tests/unit/aiToolDefinitions.test.ts`.

---

*Source: `src/main.tsx`, `src/components/panels/media/MediaAIGenerativeTray.tsx`, `src/components/panels/flashboard/FlashBoardComposer.tsx`, `src/components/panels/SAM2Panel.tsx`, `src/components/panels/SceneDescriptionPanel.tsx`, `src/components/preview/SAM2Overlay.tsx`, `src/services/sam2/SAM2Service.ts`, `src/services/sam2/SAM2ModelManager.ts`, `src/services/sam2/sam2Worker.ts`, `src/stores/sam2Store.ts`, `src/services/aiTools/`, `src/services/aiTools/aiFeedback.ts`, `src/services/aiTools/executionState.ts`, `src/services/aiTools/bridge.ts`, `src/services/sceneDescriber.ts`, `src/services/cloudAiService.ts`, `src/services/flashboard/`, `functions/api/ai/chat.ts`, `functions/api/ai/chat-history.ts`, `functions/lib/chatLog.ts`*
