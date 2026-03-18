[← Back to Index](./README.md)

# AI Multicam Editor

Automatischer Multicam-Schnitt via LLM + Computer Vision Analyse.

> **Status:** Implemented. The core pipeline (analysis, transcription, EDL generation, timeline integration) is functional. Face detection is a placeholder (returns empty). Analysis runs on CPU via Canvas, not GPU compute shaders (see "Future: GPU Pipeline" below).

---

## Konzept

Das LLM bekommt keine Bilder, sondern nur extrahierte Metadaten als Kurven/Graphen plus Transcript. Basierend darauf erstellt es einen Schnittplan (EDL).

```
+-------------------------------------------------------------+
|                    Video Input (N Kameras)                    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|              CV Analysis (CPU-basiert, Canvas 2D)            |
|  +----------+ +----------+ +----------+ +----------+        |
|  | Bewegung | | Schaerfe | | Audio    | | Gesichter|        |
|  | (Canvas) | | (Canvas) | | (WebAudio)| (TODO)   |        |
|  +----------+ +----------+ +----------+ +----------+        |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                   Metadaten pro Zeitpunkt                    |
|  {                                                          |
|    timestamp: 00:00:05,                                     |
|    cameras: [                                               |
|      { id: "cam-1", motion: 0.1, sharpness: 0.8 },         |
|      { id: "cam-2", motion: 0.0, sharpness: 0.9 },         |
|    ],                                                       |
|    audio: { level: 0.7 },                                   |
|    transcript: "Also ich denke dass..."                     |
|  }                                                          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    LLM (Claude Sonnet 4)                     |
|  Input:  Metadata + Transcript + Edit Style Rules            |
|  Output: EDL (Edit Decision List) as JSON                    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                   Timeline Integration                       |
|  - Apply EDL directly to timeline tracks                     |
+-------------------------------------------------------------+
```

---

## Current Implementation

### Analysis Pipeline (`multicamAnalyzer.ts`)

The actual implementation uses CPU-based analysis via Canvas 2D (not WebGPU compute shaders):

**Motion Detection** — Frame-difference on luminance (CPU):
- Frames extracted at 320x180 resolution via `HTMLVideoElement` + `canvas.drawImage()`
- Every 4th pixel sampled for performance
- Luminance diff normalized to 0-1 range
- Sample interval: 500ms

**Sharpness Detection** — Laplacian variance (CPU):
- Same Canvas 2D frame extraction
- Laplacian kernel applied in JavaScript loop
- Variance of results → higher = sharper
- Normalized to 0-1 range

**Audio Analysis** — via `audioAnalyzer` service:
- RMS levels per sample interval
- Separate audio level map per camera

**Face Detection** — Placeholder:
- Returns empty array (`[]`)
- TODO: Implement with TensorFlow.js or similar

**Per-camera sequential analysis:**
- Cameras analyzed one at a time (not parallel)
- Progress callback per camera and overall
- Cancellation support via controller object
- UI yields every 10 frames to keep responsive

### Store (`multicamStore.ts`)

```typescript
interface MultiCamStore {
  // Cameras
  cameras: MultiCamSource[];
  masterCameraId: string | null;

  // Analysis
  analysis: MultiCamAnalysis | null;
  analysisStatus: 'idle' | 'analyzing' | 'complete' | 'error';
  analysisProgress: number;

  // Transcript
  transcript: TranscriptEntry[];
  transcriptStatus: 'idle' | 'loading-model' | 'generating' | 'complete' | 'error';

  // EDL
  edl: EditDecision[];
  edlStatus: 'idle' | 'generating' | 'complete' | 'error';

  // Settings
  editStyle: 'podcast' | 'interview' | 'music' | 'documentary' | 'custom';
  customPrompt: string;
  apiKeySet: boolean;

  // Actions
  addCamera(mediaFile: MediaFile): void;
  removeCamera(id: string): void;
  syncCameras(): Promise<void>;       // Audio-based sync via audioSync service
  analyzeAll(): Promise<void>;         // Run CV analysis
  generateTranscript(): Promise<void>; // Local Whisper transcription
  importTranscript(entries): void;     // Import existing transcript
  generateEDL(): Promise<void>;        // Claude API call
  applyEDLToTimeline(): void;          // Create clips from EDL
}
```

### Claude Service (`claudeService.ts`)

```typescript
// API
endpoint: 'https://api.anthropic.com/v1/messages'
model: 'claude-sonnet-4-20250514'
max_tokens: 4096

// Prompt includes:
// - Camera info (names, roles)
// - Edit style instructions (preset or custom)
// - Sampled analysis data (motion/sharpness per camera, max 100 entries)
// - Audio levels
// - Full transcript with timestamps and speakers
```

### Panel UI (`MultiCamPanel.tsx`)

Full workflow panel with:
- Camera cards (thumbnails, role selection, master badge)
- Add cameras from media panel
- Audio sync between cameras
- Analysis trigger with progress
- Transcript generation or import
- Edit style selection (podcast, interview, music, documentary, custom)
- EDL generation and manual editing
- Apply EDL to timeline

### API Key Management

The Claude API key for multicam is stored separately from other API keys:
- Uses `apiKeyManager` with encrypted IndexedDB storage (Web Crypto API)
- Legacy key ID: `claude-api-key`
- Checked on store initialization

---

## Data Structures (Actual)

```typescript
interface MultiCamSource {
  id: string;
  mediaFileId: string;
  name: string;
  role: 'wide' | 'closeup' | 'detail' | 'custom';
  syncOffset: number;   // ms, relative to master
  duration: number;      // ms
  thumbnailUrl?: string;
}

interface MultiCamAnalysis {
  projectDuration: number;  // ms
  sampleInterval: number;   // ms (500)
  cameras: CameraAnalysis[];
  audioLevels: { timestamp: number; level: number }[];
}

interface CameraAnalysis {
  cameraId: string;
  frames: FrameAnalysis[];
}

interface FrameAnalysis {
  timestamp: number;  // ms
  motion: number;     // 0-1
  sharpness: number;  // 0-1
  faces: DetectedFace[];  // Currently always empty
  audioLevel: number; // 0-1
}

interface EditDecision {
  id: string;
  start: number;      // ms
  end: number;         // ms
  cameraId: string;
  reason?: string;
  confidence?: number; // 0-1
}

interface TranscriptEntry {
  id: string;
  start: number;  // ms
  end: number;     // ms
  speaker: string;
  text: string;
}

type EditStyle = 'podcast' | 'interview' | 'music' | 'documentary' | 'custom';
```

---

## Edit Style Presets

| Style | Key Rules |
|-------|-----------|
| `podcast` | Cut to speaker, reaction shots sparingly, 3s min, avoid mid-sentence cuts |
| `interview` | Show interviewee primarily, interviewer for questions, 2s min |
| `music` | Cut on beat, motion-driven, 1-2s min, faster pacing |
| `documentary` | Long cuts (5+s), B-roll, wide establishing shots, follow narrative |
| `custom` | User-provided instructions |

---

## LLM Prompt Structure (Actual)

The prompt sent to Claude follows this structure:
```
You are an expert video editor. Generate an edit decision list (EDL) for a multicam video.

PROJECT INFORMATION:
- Total duration: MM:SS
- Number of cameras: N

CAMERAS:
  Camera 1 (id): "Name" - Role: wide/closeup/etc.

[Edit Style Instructions from preset]
[Optional custom instructions]

ANALYSIS DATA:
  Sample interval, per-camera avg motion/sharpness,
  Timeline data (motion/sharpness per camera at each timestamp)

TRANSCRIPT:
  [Timestamped speaker-attributed text]

OUTPUT FORMAT:
  JSON array of {start, end, cameraId, reason}
```

---

## Audio Sync

Camera synchronization uses the `audioSync` service:
- Cross-correlation of audio waveforms
- Master camera set to offset 0
- Other cameras get calculated offset in ms
- Manual offset adjustment also supported

---

## Implemented Features (Checklist)

- [x] Camera management (add, remove, reorder, roles)
- [x] Master camera selection
- [x] Audio-based camera sync
- [x] Motion detection (CPU, frame-difference)
- [x] Sharpness detection (CPU, Laplacian variance)
- [x] Audio level analysis
- [x] Local Whisper transcription (via `@huggingface/transformers`)
- [x] Transcript import
- [x] Claude API EDL generation
- [x] 5 edit style presets + custom
- [x] EDL manual editing (update, insert, remove decisions)
- [x] Apply EDL to timeline (create clips with correct in/out points and sync offsets)
- [x] Cancellation support for analysis
- [x] API key encrypted storage
- [x] Full panel UI

## Not Yet Implemented

- [ ] Face detection (placeholder returns empty array)
- [ ] WebGPU compute shader analysis (currently CPU-based)
- [ ] Premiere XML export
- [ ] DaVinci Resolve EDL export
- [ ] Face clustering / speaker-to-camera mapping
- [ ] Chunked processing for long videos
- [ ] Beat detection for music edits

---

## Future: GPU Pipeline (Design)

The original design envisioned WebGPU compute shaders for analysis. This remains a future optimization:

### Motion Detection (WebGPU Compute Shader)
```wgsl
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let prev = textureLoad(prevFrame, id.xy, 0);
    let curr = textureLoad(currFrame, id.xy, 0);
    let prevLum = dot(prev.rgb, vec3(0.299, 0.587, 0.114));
    let currLum = dot(curr.rgb, vec3(0.299, 0.587, 0.114));
    let diff = abs(currLum - prevLum);
    atomicAdd(&result, diff);
}
```

### Sharpness Detection (WebGPU Compute Shader)
```wgsl
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let c = textureLoad(frame, id.xy, 0).rgb;
    let t = textureLoad(frame, id.xy + vec2(0, -1), 0).rgb;
    let b = textureLoad(frame, id.xy + vec2(0, 1), 0).rgb;
    let l = textureLoad(frame, id.xy + vec2(-1, 0), 0).rgb;
    let r = textureLoad(frame, id.xy + vec2(1, 0), 0).rgb;
    let lap = 4.0 * c - t - b - l - r;
    let lum = dot(lap, vec3(0.299, 0.587, 0.114));
    atomicAdd(&variance, lum * lum);
    atomicAdd(&count, 1u);
}
```

### Face Detection
Would use TensorFlow.js with WebGPU backend (BlazeFace model, ~190KB).

---

## Dependencies (Current)

```
@huggingface/transformers  — Local Whisper transcription
audioSync service          — Cross-correlation for camera sync
audioAnalyzer service      — Audio level analysis
claudeService              — Claude API for EDL generation
apiKeyManager              — Encrypted key storage
```

No TensorFlow.js dependencies currently required (face detection not implemented).

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`crossCorrelation.test.ts`](../../tests/unit/crossCorrelation.test.ts) | 45 | Audio sync cross-correlation |

Run tests: `npx vitest run`

---

## Related Documents

- [AI Integration](./AI-Integration.md) -- AI tools and OpenAI function calling
- [Audio](./Audio.md) -- Audio processing, cross-correlation sync

---

*Source: `src/stores/multicamStore.ts`, `src/services/multicamAnalyzer.ts`, `src/services/claudeService.ts`, `src/services/audioSync.ts`, `src/services/audioAnalyzer.ts`, `src/services/whisperService.ts`, `src/services/apiKeyManager.ts`, `src/components/panels/MultiCamPanel.tsx`, `src/components/timeline/MulticamDialog.tsx`*
