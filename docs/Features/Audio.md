# Audio

[← Back to Index](./README.md)

Audio processing with 10-band EQ, audio master clock, varispeed scrubbing, seamless cut transitions, and multicam synchronization.

---

## Table of Contents

- [Audio Master Clock](#audio-master-clock)
- [Varispeed Scrubbing](#varispeed-scrubbing)
- [Audio Tracks](#audio-tracks)
- [10-Band EQ](#10-band-eq)
- [Audio Routing](#audio-routing)
- [Audio Sync Runtime](#audio-sync-runtime)
- [Waveforms](#waveforms)
- [Audio Detection](#audio-detection)
- [Multicam Sync](#multicam-sync)
- [Transcription](#transcription)
- [Audio Manager](#audio-manager)
- [Multicam Panel](#multicam-panel)
- [Composition Audio Mixdown](#composition-audio-mixdown)
- [Audio Export](#audio-export)

---

## Audio Master Clock

The playhead follows audio timing for perfect sync, like Premiere Pro and DaVinci Resolve.

### How It Works
- Audio playback drives the timeline position
- Playhead syncs to `audioContext.currentTime`
- Gradual drift correction using playback rate adjustment
- Prevents audio glitches from hard seeks

### Benefits
- Perfect audio-video sync during playback
- No audio pops or clicks from constant re-syncing
- Professional-grade timing accuracy

### Implementation
```typescript
// Playhead follows audio instead of system time
currentTime = audioStartTime + (audioContext.currentTime - playbackStartTime)

// Gentle drift correction via playback rate
if (drift > threshold) {
  playbackRate = 1.0 + (drift * correctionFactor)
}
```

---

## Varispeed Scrubbing

Continuous audio playback with speed adjustment while scrubbing the timeline.

### Features
- **Continuous playback**: Audio plays at varying speeds during scrub
- **Direction-aware**: Plays forward or backward based on scrub direction
- **Speed-scaled**: Playback rate matches scrub speed
- **All clips**: Works with proxy and non-proxy video clips

### Experience
- Scrub slowly: Hear audio at reduced speed
- Scrub fast: Audio speeds up proportionally
- Stop scrubbing: Audio fades out smoothly

### Technical Details
```typescript
// Speed calculated from scrub velocity
const velocity = (newTime - prevTime) / deltaTime
const playbackRate = clamp(Math.abs(velocity), 0.25, 4.0)

// Time-based triggers for smooth audio
triggerInterval = Math.max(50, 200 / Math.abs(velocity))
```

### Scrub Implementation
The `AudioSyncHandler` manages scrub audio:
- Position change threshold of 0.005s prevents redundant triggers
- Short audio snippets play at scrub position with volume 0.8
- Timeout-based fadeout when scrubbing stops
- Video clips use `proxyFrameCache.playScrubAudio()` for scrub audio

---

## Audio Tracks

### Track Configuration
```typescript
interface TimelineTrack {
  type: 'video' | 'audio';
  muted: boolean;
  visible: boolean;
  solo: boolean;
}
```

### Default Setup
- 2 video tracks
- 1 audio track (at bottom)
- New audio tracks created automatically when needed (via `findOrCreateAudioTrack`)

### Track Controls
| Control | Function |
|---------|----------|
| **M** (Mute) | Silence track audio |
| **S** (Solo) | Only play this track |
| **Eye** | Toggle visibility |

### Auto Track Creation
When loading a video with audio, `findOrCreateAudioTrack()` in `audioTrackHelpers.ts`:
1. Tries a preferred track ID if provided
2. Finds the first audio track without clip overlap
3. Creates a new audio track if all existing ones overlap

---

## 10-Band EQ

### Frequencies
```
31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz
```

### Gain Range
- **-12dB to +12dB** per band
- Q factor: 1.4 (standard 10-band)

### Implementation
```typescript
// AudioManager chain (global)
Input -> EQ Band 0-9 -> Master Gain -> Output

// AudioRoutingManager chain (per-clip live EQ)
Source -> Gain -> EQ[0] -> EQ[1] -> ... -> EQ[9] -> Destination

// AudioManager methods
setEQBand(bandIndex, gainDB)  - Adjust single band
getEQBands()                   - Get all band values
setAllEQBands(gains)           - Set multiple at once
resetEQ()                      - Flatten to 0dB
```

### Keyframe Support
Each EQ band can be animated:
```typescript
// Effect parameters stored per-clip
{
  band31: 0, band62: 0, band125: 0, band250: 0, band500: 0,
  band1k: 0, band2k: 0, band4k: 0, band8k: 0, band16k: 0
}
```

### Live EQ via Web Audio
- Real-time equalization using Web Audio API
- Hear EQ changes instantly during playback
- Changes apply in real-time without needing to re-render
- Per-clip EQ handled by `AudioRoutingManager` (see below)

### Properties Panel - Volume Tab
When an audio clip is selected, the Properties panel shows the Volume tab:
- **Volume slider**: 0-200% (with keyframe toggle)
- **Keep Pitch checkbox**: Maintain original pitch when speed changes (default on)
- **10 vertical EQ sliders**: One per frequency band
- **Reset button**: Flattens all bands to 0dB
- **Keyframe toggles**: Per parameter for animation (single toggle for all bands)
- EQ effect is automatically added on first use

### Audio Tab for Video Clips
Video clips now have a dedicated **Audio** tab in the Properties panel:
- Volume controls and keyframes for linked audio
- Same EQ and volume controls as audio-only clips
- Accessible without selecting the linked audio clip separately

See [UI Panels - Properties Panel](./UI-Panels.md#properties-panel) for details.

---

## Audio Routing

### AudioRoutingManager

Per-clip real-time audio routing through Web Audio API for live EQ and volume during playback.

### Architecture
```
HTMLMediaElement -> MediaElementSourceNode -> GainNode -> EQ Filters -> Destination
```

### Key Design
- **Single shared AudioContext** across all routes
- **Lazy connection**: routes created on first `applyEffects()` call
- **Node caching**: `MediaElementSourceNode` can only be created once per element
- **Delta updates**: only updates gain/EQ values when they change (threshold: volume 0.001, EQ 0.01)
- **Conditional routing**: if no EQ is active, volume is set directly on the element (avoiding Web Audio overhead)

### API
```typescript
// Apply volume and EQ to a playing element (called per frame)
applyEffects(element, volume, eqGains: number[]) -> boolean

// Check if element has a route
hasRoute(element) -> boolean

// Remove route when element is no longer needed
removeRoute(element) -> void

// Clean up everything
dispose() -> void
```

### Source
- `src/services/audioRoutingManager.ts`

---

## Audio Sync Runtime

### AudioTrackSyncManager

Orchestrates all audio synchronization during playback. Called every frame from the layer builder.

### Responsibilities
1. **Audio track clips** -- sync `source.audioElement` to playhead
2. **Video clip audio** -- proxy audio and varispeed scrubbing
3. **Nested composition mixdown** -- sync `mixdownAudio` elements
4. **Inactive clip pausing** -- pause audio for clips not at playhead
5. **Audio handoff** -- seamless cut transitions (see below)
6. **Audio lookahead** -- pre-buffer upcoming clips
7. **Non-standard speed muting** -- mute all audio during reverse/fast-forward

### Seamless Audio Cut Transitions
When two sequential clips on the same audio track share the same source file and have continuous in/out points, the system reuses the previous clip's audio element instead of starting a cold new one. This eliminates the 100-400ms startup gap.

Detection criteria:
- Same `mediaFileId` between previous and current clip
- In/out point gap < 0.1s
- Previous element's `currentTime` within 0.5s of new clip's `inPoint`

### Audio Lookahead
Pre-buffers audio elements for clips starting within 1 second of the playhead:
- Seeks the audio element to `clip.inPoint` ahead of time
- Ensures the browser has decoded audio data ready at cut points
- Only active during normal playback (not scrubbing)

### AudioSyncHandler

Low-level audio element synchronization with per-element logic:

- **Drift correction**: re-sync if audio drifts > 0.3s from expected position
- **Drift tracking**: records drift for status display
- **Playback rate**: clamped to 0.25-4.0x range
- **Volume/EQ routing**: delegates to `AudioRoutingManager` when EQ is active, otherwise sets `element.volume` directly
- **Pitch preservation**: sets `element.preservesPitch` per clip setting
- **Master audio election**: first eligible playing element becomes master for playhead sync

### Source
- `src/services/layerBuilder/AudioTrackSyncManager.ts`
- `src/services/layerBuilder/AudioSyncHandler.ts`

---

## Speed and Pitch

### Speed Effect on Audio
Audio clips respect the clip's speed property (set on linked video or directly):
- **Live playback range**: 0.25x to 4x (browser `playbackRate` limitation)
- **Export range**: 0.1x to 10x (SoundTouch processing)
- **Playback rate**: Audio plays at the same speed as video
- **Sync**: Uses speed integration for keyframe-accurate timing

### Pitch Preservation
The `preservesPitch` property controls pitch behavior during speed changes:

| Setting | Behavior | Use Case |
|---------|----------|----------|
| **Keep Pitch ON** (default) | Maintains original pitch | Speech, music |
| **Keep Pitch OFF** | Pitch shifts with speed | Chipmunk effect, slowed audio |

```typescript
interface TimelineClip {
  speed?: number;           // Playback speed (default 1.0)
  preservesPitch?: boolean; // Keep pitch when speed changes (default true)
}
```

### Live Playback Implementation
Uses HTMLMediaElement's `playbackRate` and `preservesPitch` properties:
```typescript
audio.playbackRate = currentSpeed;  // 0.25 to 4.0
audio.preservesPitch = clip.preservesPitch !== false;
```

### Export Implementation
Uses **soundtouch-ts** for offline time-stretching:
- Constant speed: full-buffer SoundTouch processing
- Variable speed with keyframes: 100ms segment processing with trapezoidal speed integration
- Without pitch preservation: simple linear-interpolation resampling (faster)

See [UI Panels - Properties Panel](./UI-Panels.md#properties-panel) for details.

---

## Waveforms

### Generation
```typescript
generateWaveform(file, samplesPerSecond = 50, onProgress?)
generateWaveformFromBuffer(audioBuffer, samplesPerSecond = 50) // For pre-decoded buffers
```

- Uses Web Audio API (`decodeAudioData`)
- ~50 samples per second
- Peak-based values for visual clarity
- Normalized amplitude (0-1)
- Dynamic sample count (200-10000)
- Progress callback with partial normalized waveform every 5%

### Clip Integration
```typescript
interface TimelineClip {
  waveform?: number[];        // Amplitude values
  waveformGenerating?: boolean;
  waveformProgress?: number;  // 0-100
}
```

### Display
- Canvas-based rendering (optimized)
- Scales with zoom level
- Toggle: "Wave On/Off" in timeline controls
- Skipped for audio files >4GB, video files >500MB

### Source
- `src/stores/timeline/helpers/waveformHelpers.ts`

---

## Audio Detection

### Multi-Method Detection
`detectVideoAudio(file)` determines if a video file contains audio tracks. Uses multiple detection methods depending on container format:

| Method | Containers | How |
|--------|-----------|-----|
| **MP4Box** | MP4, MOV, M4V, 3GP | Parse audio track metadata |
| **HTMLVideoElement** | All browser-playable | `audioTracks` API or `webkitAudioDecodedByteCount` |
| **EBML parsing** | WebM, MKV | Scan for audio track type markers |

### Fallback Strategy
1. MP4Box for MP4-based containers (most reliable for positive detection)
2. If MP4Box returns non-positive, falls through to HTMLVideoElement
3. WebM/MKV-specific EBML header parsing
4. If all inconclusive, assumes audio exists (better safe than sorry)

### Source
- `src/stores/timeline/helpers/audioDetection.ts`

---

## Multicam Sync

### Algorithm
**Normalized cross-correlation** (Pearson coefficient):
- Search range: +/-10 seconds
- Uses downsampled audio fingerprints (2000Hz)
- Returns offset in milliseconds with confidence

### Methods

#### Two-File Sync
```typescript
findOffset(masterMediaFileId, targetMediaFileId, maxOffsetSeconds = 30)
// Returns: offset in ms (positive = target delayed)
```

#### Multicam Batch Sync
```typescript
syncMultipleClips(masterClip, targetClips, onProgress)
// Accounts for clip in-points and durations
// Returns: Map<clipId, offsetMs>
```

#### Legacy Sync (by media file ID)
```typescript
syncMultiple(masterMediaFileId, targetMediaFileIds, onProgress)
// Uses first 30s of full files
// Returns: Map<mediaFileId, offsetMs>
```

### Fingerprint Caching
- Cache key: `${mediaFileId}-${startTime}-${duration}`
- Prevents redundant processing
- `clearCache()` for manual cleanup

### Audio Analysis
```typescript
// RMS level analysis
analyzeLevels(mediaFileId, windowSizeMs = 100)

// Audio fingerprinting
generateFingerprint(mediaFileId, targetSampleRate = 2000, startTimeSeconds, maxDurationSeconds = 30)

// Peak at timestamp
getLevelAtTime(mediaFileId, timestampMs)
```

---

## Transcription

### Supported Providers

| Provider | Type | Features |
|----------|------|----------|
| **Local Whisper** | Browser | No API key needed |
| **OpenAI Whisper** | Cloud | Fast, accurate |
| **AssemblyAI** | Cloud | Speaker diarization |
| **Deepgram** | Cloud | Real-time capable |

### Languages Supported
`de, en, es, fr, it, pt, nl, pl, ru, ja, zh, ko`

### Clip Transcription
```typescript
// Transcribes trimmed portion only (inPoint to outPoint)
transcribeClip(clipId, options)

// Returns word-level transcript
interface TranscriptWord {
  id: string;
  start: number;   // seconds (relative to clip source)
  end: number;     // seconds
  text: string;
}
```

### Web Worker Support
- Transcription runs in background
- Doesn't block UI
- Progress callbacks (0-100%)

### Transcript Storage
```typescript
interface TimelineClip {
  transcript?: TranscriptWord[];
  transcriptStatus?: 'none' | 'transcribing' | 'ready' | 'error';
  transcriptProgress?: number;   // 0-100
  transcriptMessage?: string;    // Status message during transcription
}
```

---

## Audio Manager

### Web Audio API Integration
```typescript
class AudioManager {
  audioContext: AudioContext;
  masterGain: GainNode;
  eqFilters: BiquadFilterNode[]; // 10 bands
}
```

### Methods
```typescript
init()                           // Initialize AudioContext
connectMediaElement(element)     // Connect video/audio to EQ chain
disconnectMediaElement(element)  // Cleanup connection
setMasterVolume(volume)          // 0-1 range
getMasterVolume()                // Get current
setEQBand(bandIndex, gainDB)     // -12 to +12 dB
getEQBands()                     // Get all band values
setAllEQBands(gains)             // Set multiple at once
resetEQ()                        // Flatten to 0dB
getCurrentTime()                 // AudioContext time for sync
resume()                         // Resume suspended context
destroy()                        // Cleanup resources
```

### Audio Status Tracking
```typescript
interface AudioStatus {
  playing: number;       // Number of audio elements currently playing
  drift: number;         // Max audio drift from expected time in ms
  status: 'sync' | 'drift' | 'silent' | 'error';
}
```
The `AudioStatusTracker` is updated each frame by `AudioSyncHandler` and provides status for the stats display.

### Autoplay Policy
- Automatically resumes AudioContext when playback starts
- Handles browser autoplay restrictions

---

## Multicam Panel

### Features
- Add/remove camera sources
- **Master camera** designation for audio reference
- Camera **role assignment** (wide, close-up, detail, custom)
- Sync offset display per camera
- Camera reordering

### State Structure
```typescript
interface MultiCamSource {
  id: string;
  mediaFileId: string;
  name: string;
  role: 'wide' | 'closeup' | 'detail' | 'custom';
  syncOffset: number;  // ms, relative to master
  duration: number;    // ms
}
```

### EDL Generation
AI-powered edit decisions via Claude API:
```typescript
interface EditDecision {
  start: number;        // ms
  end: number;          // ms
  cameraId: string;
  reason?: string;
  confidence?: number;  // 0-1
}
```

---

## Composition Audio Mixdown

When nesting compositions, the inner composition's audio tracks are mixed down to a single buffer for use in the parent timeline.

### How It Works
- `CompositionAudioMixer` extracts and mixes all audio from a nested composition
- Extracts audio via `AudioExtractor`, trims to in/out points
- Mixes using `AudioMixer` with mute/solo and peak normalization at 48kHz stereo
- Generates a waveform from the mixed buffer for display
- Can create an `HTMLAudioElement` (WAV blob) for timeline playback
- Handles recursive nesting up to `MAX_NESTING_DEPTH`
- Also processes nested composition clips on video tracks for sub-composition audio

### Audio Extraction (services)
A separate `extractAudioFromVideo()` function in `src/services/audioExtractor.ts` uses **MP4Box.js** to extract raw audio tracks from video files without re-encoding. Creates ADTS-wrapped AAC files for browser playback.

### Source
- `src/services/compositionAudioMixer.ts`
- `src/services/audioExtractor.ts` (MP4Box-based audio extraction)

---

## Audio Export

Audio is exported alongside video with full effect processing.

### Export Pipeline
```
1. Extract audio from clips (AudioExtractor)
2. Trim to clip in/out points
3. Apply speed/pitch changes (TimeStretchProcessor)
4. Render EQ and volume with keyframes (AudioEffectRenderer)
5. Mix all tracks (AudioMixer)
6. Encode to AAC or Opus (AudioEncoder)
7. Mux with video
```

### Export Modes
- **`exportAudio()`** -- full pipeline, returns encoded chunks for muxing
- **`exportRawAudio()`** -- steps 1-5 only, returns raw `AudioBuffer` for external encoders (e.g., FFmpeg)

### Export Settings
| Setting | Options |
|---------|---------|
| **Sample Rate** | 48kHz (video standard), 44.1kHz (CD) |
| **Bitrate** | 128-320 kbps (AAC), 32-192 kbps (Opus) |
| **Codec** | AAC-LC (preferred), Opus (Linux fallback) |
| **Normalize** | Peak normalize (prevent clipping) |

### Audio Codec Support
| Codec | Container | Browser | Bitrate Range |
|-------|-----------|---------|---------------|
| **AAC-LC** (`mp4a.40.2`) | MP4 | Chrome, Safari, Edge | 64-320 kbps |
| **Opus** | WebM | Chrome, Firefox, Edge | 32-192 kbps |

Auto-detection prefers AAC, falls back to Opus if unsupported.

### Time Stretch Processing
- Uses **soundtouch-ts** for pitch-preserved tempo changes
- Speed range: 0.1x to 10x
- Handles keyframed speed values with 100ms segment processing
- Trapezoidal integration for accurate source-time mapping
- Without pitch preservation: linear-interpolation resampling (faster)

### Effect Rendering
- Offline rendering via `OfflineAudioContext`
- Sample-accurate keyframe automation
- 10-band EQ with animated gains per band
- Volume automation with bezier curve support (10-point sampling)
- Easing modes: linear, ease-in/out (exponential ramp), bezier, step/hold

### Track Handling
- Respects track mute/solo settings
- Overlapping clips sum correctly (via `OfflineAudioContext`)
- Resampling to target sample rate if source differs
- Mono to stereo conversion when needed
- Peak normalization with configurable headroom (default -1 dB)

### Cancellation
Export can be cancelled at any point via `audioExportPipeline.cancel()`.

See [Export](./Export.md) for full export documentation.

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`audioUtils.test.ts`](../../tests/unit/audioUtils.test.ts) | 43 | Volume, EQ, timing, speed |
| [`crossCorrelation.test.ts`](../../tests/unit/crossCorrelation.test.ts) | 45 | Audio sync cross-correlation |

Run tests: `npx vitest run`

---

## Not Implemented

- Audio compression/dynamics
- Reverb/delay effects
- Loudness normalization (LUFS)
- Noise reduction
- Audio spectrum analyzer display

---

## Related Features

- [Timeline](./Timeline.md) - Track management
- [AI Integration](./AI-Integration.md) - Transcript editing
- [Media Panel](./Media-Panel.md) - Audio import
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

*Source: `src/services/audioManager.ts`, `src/services/audioRoutingManager.ts`, `src/services/audioSync.ts`, `src/services/audioAnalyzer.ts`, `src/services/audioExtractor.ts`, `src/services/compositionAudioMixer.ts`, `src/services/layerBuilder/AudioSyncHandler.ts`, `src/services/layerBuilder/AudioTrackSyncManager.ts`, `src/stores/timeline/helpers/audioDetection.ts`, `src/stores/timeline/helpers/audioTrackHelpers.ts`, `src/stores/timeline/helpers/waveformHelpers.ts`, `src/engine/audio/`*
