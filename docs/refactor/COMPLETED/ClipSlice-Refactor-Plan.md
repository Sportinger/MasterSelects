# ClipSlice Refactoring Plan

**Target**: Reduce `src/stores/timeline/clipSlice.ts` from 2031 LOC to ~300 LOC main file with helpers below ~400 LOC each.

## Current Issues

### Giant Functions
| Function | Lines | Location |
|----------|-------|----------|
| `addClip` | 515 | 68-582 |
| `addCompClip` | 435 | 585-1018 |
| `completeDownload` | 265 | 1768-2030 |

### Duplicated Code (~510 LOC)
1. **File extensions** (lines 71-73) - Same as Timeline.tsx
2. **WebCodecsPlayer init** - Repeated 4x (lines 277-311, 681-707, 1914-1946)
3. **Audio track creation** - Repeated 3x (lines 793-814, 886-903, 951-966)
4. **Waveform generation pattern** - Repeated 4x
5. **Thumbnail generation** - Repeated 3x
6. **Error handling branch** - Copy-paste (lines 883-944 ≈ 947-1014)

### Logic Issues
1. Local `updateClip` helper (lines 108-114) duplicates the action (line 1342-1348)
2. Error/no-data branches in addCompClip are nearly identical (can merge)

---

## New Structure

```
src/stores/timeline/
├── clipSlice.ts                    # Coordinator (~300 LOC)
├── clip/
│   ├── addVideoClip.ts            # Video adding logic (~350 LOC)
│   ├── addAudioClip.ts            # Audio adding logic (~120 LOC)
│   ├── addImageClip.ts            # Image adding logic (~80 LOC)
│   ├── addCompClip.ts             # Composition clip (~350 LOC)
│   ├── completeDownload.ts        # YouTube download completion (~200 LOC)
│   └── clipManipulation.ts        # Move, trim, split (~200 LOC)
├── helpers/
│   ├── mediaTypeHelpers.ts        # File type detection (~40 LOC)
│   ├── webCodecsHelpers.ts        # WebCodecs initialization (~50 LOC)
│   ├── thumbnailHelpers.ts        # Thumbnail generation (~60 LOC)
│   ├── waveformHelpers.ts         # Waveform generation (~80 LOC)
│   └── audioTrackHelpers.ts       # Audio track creation (~50 LOC)
```

---

## Phase 1: Extract Helpers (Deduplicate ~510 LOC)

### Step 1.1: Create mediaTypeHelpers.ts

**File**: `src/stores/timeline/helpers/mediaTypeHelpers.ts`

```typescript
// Media type detection helpers - shared across clipSlice and Timeline.tsx

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'];
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'flv'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

export type MediaType = 'video' | 'audio' | 'image' | 'unknown';

export function detectMediaType(file: File): MediaType {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) {
    return 'video';
  }
  if (file.type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) {
    return 'audio';
  }
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) {
    return 'image';
  }
  return 'unknown';
}

export function isAudioFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext);
}

export function isVideoFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isImageFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext);
}

export function isProfessionalCodecFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop();
  // ProRes typically in .mov, DNxHD in .mxf or .mov
  return ext === 'mov' || ext === 'mxf';
}
```

### Step 1.2: Create webCodecsHelpers.ts

**File**: `src/stores/timeline/helpers/webCodecsHelpers.ts`

```typescript
// WebCodecs initialization helper - eliminates 4x duplication

import { WebCodecsPlayer } from '../../../engine/WebCodecsPlayer';

export interface WebCodecsInitResult {
  webCodecsPlayer: WebCodecsPlayer | null;
  error: Error | null;
}

/**
 * Initialize WebCodecsPlayer for hardware-accelerated video decoding.
 * Returns null if WebCodecs is not available or initialization fails.
 */
export async function initWebCodecsPlayer(
  video: HTMLVideoElement,
  fileName: string = 'video'
): Promise<WebCodecsPlayer | null> {
  const hasWebCodecs = 'VideoDecoder' in window && 'VideoFrame' in window;

  if (!hasWebCodecs) {
    return null;
  }

  try {
    console.log(`[WebCodecs] Initializing for ${fileName}...`);

    const webCodecsPlayer = new WebCodecsPlayer({
      loop: false,
      useSimpleMode: true,
      onError: (error) => {
        console.warn('[WebCodecs] Error:', error.message);
      },
    });

    webCodecsPlayer.attachToVideoElement(video);
    console.log(`[WebCodecs] Ready for ${fileName}`);

    return webCodecsPlayer;
  } catch (err) {
    console.warn('[WebCodecs] Init failed, using HTMLVideoElement:', err);
    return null;
  }
}

/**
 * Warm up video decoder by forcing a frame decode.
 * Eliminates "cold start" delay on first play.
 */
export async function warmUpVideoDecoder(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    // Skip if video is already playing or has been decoded
    if (video.readyState >= 3) { // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
      resolve();
      return;
    }

    // Use requestVideoFrameCallback if available (modern browsers)
    if ('requestVideoFrameCallback' in video) {
      const warmUp = () => {
        video.currentTime = 0.001; // Seek to first frame
        (video as any).requestVideoFrameCallback(() => {
          video.pause();
          resolve();
        });
        video.play().catch(() => resolve());
      };

      if (video.readyState >= 1) { // HAVE_METADATA
        warmUp();
      } else {
        video.addEventListener('loadedmetadata', warmUp, { once: true });
      }
    } else {
      // Fallback: wait for canplay event
      if (video.readyState >= 2) { // HAVE_CURRENT_DATA
        resolve();
        return;
      }
      video.addEventListener('canplay', () => resolve(), { once: true });
      video.currentTime = 0.001;
    }

    // Timeout fallback
    setTimeout(resolve, 500);
  });
}
```

### Step 1.3: Create audioTrackHelpers.ts

**File**: `src/stores/timeline/helpers/audioTrackHelpers.ts`

```typescript
// Audio track creation helper - eliminates 3x duplication

import type { TimelineTrack } from '../../../types';

export interface FindOrCreateAudioTrackResult {
  trackId: string;
  newTrack: TimelineTrack | null;
}

/**
 * Find existing audio track or create a new one.
 * Used for linked audio clips from video and composition clips.
 */
export function findOrCreateAudioTrack(
  tracks: TimelineTrack[],
  preferredId?: string
): FindOrCreateAudioTrackResult {
  // Try to use preferred track if provided
  if (preferredId) {
    const preferred = tracks.find(t => t.id === preferredId && t.type === 'audio');
    if (preferred) {
      return { trackId: preferred.id, newTrack: null };
    }
  }

  // Find first audio track
  const audioTracks = tracks.filter(t => t.type === 'audio');
  if (audioTracks.length > 0) {
    return { trackId: audioTracks[0].id, newTrack: null };
  }

  // Create new audio track
  const newTrackId = `track-${Date.now()}-audio`;
  const newTrack: TimelineTrack = {
    id: newTrackId,
    name: 'Audio 1',
    type: 'audio',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  };

  return { trackId: newTrackId, newTrack };
}

/**
 * Create an audio clip from a composition mixdown or as silent placeholder.
 */
export function createCompositionAudioClip(params: {
  clipId: string;
  trackId: string;
  compositionName: string;
  compositionId: string;
  startTime: number;
  duration: number;
  audioElement?: HTMLAudioElement;
  waveform?: number[];
  mixdownBuffer?: AudioBuffer;
  hasAudio?: boolean;
}): import('../../../types').TimelineClip {
  const { DEFAULT_TRANSFORM } = require('../constants');

  return {
    id: params.clipId,
    trackId: params.trackId,
    name: `${params.compositionName} (Audio)`,
    file: new File([], `${params.compositionName}-audio.wav`),
    startTime: params.startTime,
    duration: params.duration,
    inPoint: 0,
    outPoint: params.duration,
    source: {
      type: 'audio',
      audioElement: params.audioElement || document.createElement('audio'),
      naturalDuration: params.duration,
    },
    linkedClipId: undefined, // Set by caller
    waveform: params.waveform || new Array(Math.max(1, Math.floor(params.duration * 50))).fill(0),
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
    isComposition: true,
    compositionId: params.compositionId,
    mixdownBuffer: params.mixdownBuffer,
  };
}
```

### Step 1.4: Create thumbnailHelpers.ts

**File**: `src/stores/timeline/helpers/thumbnailHelpers.ts`

```typescript
// Thumbnail generation helper - eliminates 3x duplication

/**
 * Generate thumbnails from a video element.
 * Used for video clips and composition clips.
 */
export async function generateVideoThumbnails(
  video: HTMLVideoElement,
  duration: number,
  options: {
    maxCount?: number;
    width?: number;
    height?: number;
    quality?: number;
    intervalSeconds?: number;
  } = {}
): Promise<string[]> {
  const {
    maxCount = 10,
    width = 160,
    height = 90,
    quality = 0.6,
    intervalSeconds = 30,
  } = options;

  const thumbCount = Math.max(1, Math.min(maxCount, Math.ceil(duration / intervalSeconds)));
  const thumbnails: string[] = [];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.warn('[Thumbnails] Could not get canvas context');
    return thumbnails;
  }

  const originalTime = video.currentTime;

  for (let i = 0; i < thumbCount; i++) {
    const time = (i / thumbCount) * duration;
    video.currentTime = time;

    await new Promise<void>(resolve => {
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, width, height);
        thumbnails.push(canvas.toDataURL('image/jpeg', quality));
        resolve();
      };
    });
  }

  // Restore original time
  video.currentTime = originalTime;

  return thumbnails;
}

/**
 * Generate a single thumbnail from an image element.
 */
export function generateImageThumbnail(
  img: HTMLImageElement,
  options: {
    height?: number;
    quality?: number;
  } = {}
): string | null {
  const { height = 40, quality = 0.6 } = options;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  const thumbWidth = Math.round((img.width / img.height) * height);
  canvas.width = thumbWidth;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, thumbWidth, height);

  return canvas.toDataURL('image/jpeg', quality);
}
```

### Step 1.5: Create waveformHelpers.ts

**File**: `src/stores/timeline/helpers/waveformHelpers.ts`

```typescript
// Waveform generation helper - centralizes waveform logic

import { generateWaveform as baseGenerateWaveform } from '../utils';

export interface WaveformGenerationOptions {
  samplesPerSecond?: number;
  onProgress?: (progress: number, partialWaveform: number[]) => void;
}

/**
 * Start waveform generation for a clip.
 * Returns a cleanup function to cancel if needed.
 */
export async function generateWaveformForFile(
  file: File,
  options: WaveformGenerationOptions = {}
): Promise<number[]> {
  const { samplesPerSecond = 50, onProgress } = options;

  console.log(`[Waveform] Starting generation for ${file.name}...`);

  const waveform = await baseGenerateWaveform(
    file,
    samplesPerSecond,
    onProgress
  );

  console.log(`[Waveform] Complete: ${waveform.length} samples for ${file.name}`);

  return waveform;
}

/**
 * Generate a flat (silent) waveform for a given duration.
 */
export function generateSilentWaveform(duration: number, samplesPerSecond: number = 50): number[] {
  return new Array(Math.max(1, Math.floor(duration * samplesPerSecond))).fill(0);
}

/**
 * Check if waveform generation should be skipped based on file size.
 */
export function shouldSkipWaveform(file: File, isAudioOnly: boolean = false): boolean {
  // Video files: skip if > 500MB
  // Audio-only files: can handle up to 4GB
  const threshold = isAudioOnly ? 4 * 1024 * 1024 * 1024 : 500 * 1024 * 1024;

  if (file.size > threshold) {
    console.log(`[Waveform] Skipping for large file (${(file.size / 1024 / 1024).toFixed(0)}MB): ${file.name}`);
    return true;
  }

  return false;
}
```

---

## Phase 2: Extract Clip Addition Logic

### Step 2.1: Create addVideoClip.ts

**File**: `src/stores/timeline/clip/addVideoClip.ts`

```typescript
// Video clip addition - extracted from addClip (lines 117-426)

import type { TimelineClip, TimelineTrack } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateThumbnails } from '../utils';
import { useMediaStore } from '../../mediaStore';
import { useSettingsStore } from '../../settingsStore';
import { NativeDecoder } from '../../../services/nativeHelper';
import { isProfessionalCodecFile } from '../helpers/mediaTypeHelpers';
import { initWebCodecsPlayer, warmUpVideoDecoder } from '../helpers/webCodecsHelpers';
import { shouldSkipWaveform, generateWaveformForFile } from '../helpers/waveformHelpers';

export interface AddVideoClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  tracks: TimelineTrack[];
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
}

export interface AddVideoClipResult {
  videoClip: TimelineClip;
  audioClip: TimelineClip | null;
}

export async function createVideoClipPlaceholders(
  params: AddVideoClipParams
): Promise<AddVideoClipResult> {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, findAvailableAudioTrack } = params;

  const clipId = `clip-${Date.now()}`;
  const audioTrackId = findAvailableAudioTrack(startTime, estimatedDuration);
  const audioClipId = audioTrackId ? `clip-audio-${Date.now()}` : undefined;

  const videoClip: TimelineClip = {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'video', naturalDuration: estimatedDuration, mediaFileId },
    linkedClipId: audioTrackId ? audioClipId : undefined,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };

  let audioClip: TimelineClip | null = null;
  if (audioTrackId && audioClipId) {
    audioClip = {
      id: audioClipId,
      trackId: audioTrackId,
      name: `${file.name} (Audio)`,
      file,
      startTime,
      duration: estimatedDuration,
      inPoint: 0,
      outPoint: estimatedDuration,
      source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
      linkedClipId: clipId,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: true,
    };
  }

  return { videoClip, audioClip };
}

export interface LoadVideoMediaParams {
  clipId: string;
  audioClipId?: string;
  file: File;
  mediaFileId?: string;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void;
}

export async function loadVideoMedia(params: LoadVideoMediaParams): Promise<void> {
  const {
    clipId, audioClipId, file, mediaFileId,
    thumbnailsEnabled, waveformsEnabled,
    updateClip, setClips
  } = params;

  // Check for professional codec (ProRes, DNxHD)
  const isProfessional = isProfessionalCodecFile(file);
  const { turboModeEnabled, nativeHelperConnected } = useSettingsStore.getState();
  const useNativeDecoder = isProfessional && turboModeEnabled && nativeHelperConnected;

  let nativeDecoder: NativeDecoder | null = null;
  let video: HTMLVideoElement | null = null;
  let naturalDuration = 5; // default estimate

  // Try Native Helper for professional codecs
  if (useNativeDecoder) {
    try {
      const mediaFile = mediaFileId
        ? useMediaStore.getState().files.find(f => f.id === mediaFileId)
        : null;
      let filePath = mediaFile?.absolutePath || (file as any).path;

      if (!filePath || !filePath.startsWith('/')) {
        filePath = `/home/admin/Desktop/${file.name}`;
      }

      console.log(`[Video] Opening ${file.name} with Native Helper`);
      nativeDecoder = await NativeDecoder.open(filePath);
      naturalDuration = nativeDecoder.duration;

      await nativeDecoder.seekToFrame(0);

      updateClip(clipId, {
        duration: naturalDuration,
        outPoint: naturalDuration,
        source: {
          type: 'video',
          naturalDuration,
          mediaFileId,
          nativeDecoder,
          filePath,
        },
        isLoading: false,
      });

      if (audioClipId) {
        updateClip(audioClipId, { duration: naturalDuration, outPoint: naturalDuration });
      }
    } catch (err) {
      console.warn(`[Video] Native Helper failed, falling back to browser:`, err);
      nativeDecoder = null;
    }
  }

  // Fallback to HTMLVideoElement
  if (!nativeDecoder) {
    video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';

    await new Promise<void>((resolve) => {
      video!.onloadedmetadata = () => resolve();
      video!.onerror = () => resolve();
    });

    naturalDuration = video.duration || 5;

    updateClip(clipId, {
      duration: naturalDuration,
      outPoint: naturalDuration,
      source: { type: 'video', videoElement: video, naturalDuration, mediaFileId },
      isLoading: false,
    });

    if (audioClipId) {
      updateClip(audioClipId, { duration: naturalDuration, outPoint: naturalDuration });
    }

    // Warm up decoder (non-blocking)
    warmUpVideoDecoder(video);

    // Initialize WebCodecsPlayer
    const webCodecsPlayer = await initWebCodecsPlayer(video, file.name);
    if (webCodecsPlayer) {
      setClips(clips => clips.map(c => {
        if (c.id !== clipId || !c.source) return c;
        return {
          ...c,
          source: { ...c.source, webCodecsPlayer },
        };
      }));
    }
  }

  // Generate thumbnails (non-blocking)
  const isLargeFile = shouldSkipWaveform(file);
  if (thumbnailsEnabled && !isLargeFile && video) {
    generateThumbnailsAsync(video, naturalDuration, clipId, setClips);
  }

  // Load audio for linked clip
  if (audioClipId && !nativeDecoder) {
    await loadLinkedAudio(file, audioClipId, naturalDuration, mediaFileId, waveformsEnabled, updateClip, setClips);
  }

  // Sync to media store
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(file.name)) {
    mediaStore.importFile(file);
  }
}

async function generateThumbnailsAsync(
  video: HTMLVideoElement,
  duration: number,
  clipId: string,
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void
): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) resolve();
      else {
        video.oncanplay = () => resolve();
        setTimeout(resolve, 2000);
      }
    });

    const thumbnails = await generateThumbnails(video, duration);
    setClips(clips => clips.map(c => c.id === clipId ? { ...c, thumbnails } : c));
    video.currentTime = 0;
  } catch (e) {
    console.warn('[Thumbnails] Failed:', e);
  }
}

async function loadLinkedAudio(
  file: File,
  audioClipId: string,
  naturalDuration: number,
  mediaFileId: string | undefined,
  waveformsEnabled: boolean,
  updateClip: (id: string, updates: Partial<TimelineClip>) => void,
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void
): Promise<void> {
  const audio = document.createElement('audio');
  audio.src = URL.createObjectURL(file);
  audio.preload = 'auto';

  updateClip(audioClipId, {
    source: { type: 'audio', audioElement: audio, naturalDuration, mediaFileId },
    isLoading: false,
  });

  // Generate waveform (non-blocking)
  if (waveformsEnabled && !shouldSkipWaveform(file)) {
    setClips(clips => clips.map(c =>
      c.id === audioClipId ? { ...c, waveformGenerating: true, waveformProgress: 0 } : c
    ));

    try {
      const waveform = await generateWaveformForFile(file);
      setClips(clips => clips.map(c =>
        c.id === audioClipId ? { ...c, waveform, waveformGenerating: false, waveformProgress: 100 } : c
      ));
    } catch (e) {
      console.warn('[Waveform] Failed:', e);
      setClips(clips => clips.map(c =>
        c.id === audioClipId ? { ...c, waveformGenerating: false } : c
      ));
    }
  }
}
```

### Step 2.2: Create addAudioClip.ts

**File**: `src/stores/timeline/clip/addAudioClip.ts`

```typescript
// Audio clip addition - extracted from addClip (lines 429-521)

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { shouldSkipWaveform, generateWaveformForFile } from '../helpers/waveformHelpers';

export interface AddAudioClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  waveformsEnabled: boolean;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void;
}

export function createAudioClipPlaceholder(
  trackId: string,
  file: File,
  startTime: number,
  estimatedDuration: number,
  mediaFileId?: string
): TimelineClip {
  const clipId = `clip-${Date.now()}`;

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export async function loadAudioMedia(params: AddAudioClipParams): Promise<string> {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, waveformsEnabled, updateClip, setClips } = params;

  const clip = createAudioClipPlaceholder(trackId, file, startTime, estimatedDuration, mediaFileId);

  // Load audio metadata
  const audio = document.createElement('audio');
  audio.src = URL.createObjectURL(file);
  audio.preload = 'metadata';

  await new Promise<void>((resolve) => {
    audio.onloadedmetadata = () => resolve();
    audio.onerror = () => resolve();
  });

  const naturalDuration = audio.duration || estimatedDuration;
  const isLargeFile = shouldSkipWaveform(file, true);

  // Mark ready
  updateClip(clip.id, {
    duration: naturalDuration,
    outPoint: naturalDuration,
    source: { type: 'audio', audioElement: audio, naturalDuration, mediaFileId },
    isLoading: false,
    waveformGenerating: waveformsEnabled && !isLargeFile,
    waveformProgress: 0,
  });

  // Generate waveform (non-blocking)
  if (waveformsEnabled && !isLargeFile) {
    (async () => {
      try {
        const waveform = await generateWaveformForFile(file);
        updateClip(clip.id, { waveform, waveformGenerating: false, waveformProgress: 100 });
      } catch (e) {
        console.warn('[Waveform] Failed:', e);
        updateClip(clip.id, { waveformGenerating: false });
      }
    })();
  }

  // Sync to media store
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(file.name)) {
    mediaStore.importFile(file);
  }

  return clip.id;
}
```

### Step 2.3: Create addImageClip.ts

**File**: `src/stores/timeline/clip/addImageClip.ts`

```typescript
// Image clip addition - extracted from addClip (lines 524-581)

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { generateImageThumbnail } from '../helpers/thumbnailHelpers';

export function createImageClipPlaceholder(
  trackId: string,
  file: File,
  startTime: number,
  estimatedDuration: number
): TimelineClip {
  const clipId = `clip-${Date.now()}`;

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'image', naturalDuration: estimatedDuration },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export async function loadImageMedia(
  clip: TimelineClip,
  updateClip: (id: string, updates: Partial<TimelineClip>) => void
): Promise<void> {
  const img = new Image();
  img.src = URL.createObjectURL(clip.file);

  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });

  // Generate thumbnail
  const thumbnail = generateImageThumbnail(img);
  const thumbnails = thumbnail ? [thumbnail] : [];

  updateClip(clip.id, {
    source: { type: 'image', imageElement: img, naturalDuration: clip.duration },
    thumbnails,
    isLoading: false,
  });

  // Sync to media store
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(clip.file.name)) {
    mediaStore.importFile(clip.file);
  }
}
```

---

## Phase 3: Extract addCompClip and completeDownload

### Step 3.1: Create addCompClip.ts

**File**: `src/stores/timeline/clip/addCompClip.ts`

This file extracts lines 585-1018 from clipSlice.ts. Key improvements:
- Merge duplicate error handling branches (lines 883-944 ≈ 947-1014)
- Use helper functions for audio track creation
- Use helper for WebCodecs initialization

```typescript
// Composition clip addition - extracted from addCompClip

import type { TimelineClip, TimelineTrack } from '../../../types';
import type { Composition } from '../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateThumbnails } from '../utils';
import { useMediaStore } from '../../mediaStore';
import { initWebCodecsPlayer } from '../helpers/webCodecsHelpers';
import { findOrCreateAudioTrack, createCompositionAudioClip } from '../helpers/audioTrackHelpers';
import { generateSilentWaveform } from '../helpers/waveformHelpers';

export interface AddCompClipParams {
  trackId: string;
  composition: Composition;
  startTime: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  thumbnailsEnabled: boolean;
  findNonOverlappingPosition: (clipId: string, startTime: number, trackId: string, duration: number) => number;
  updateDuration: () => void;
  set: (state: any) => void;
  get: () => any;
}

export function createCompClipPlaceholder(
  params: Pick<AddCompClipParams, 'trackId' | 'composition' | 'startTime' | 'findNonOverlappingPosition'>
): TimelineClip {
  const { trackId, composition, startTime, findNonOverlappingPosition } = params;

  const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const compDuration = composition.timelineData?.duration ?? composition.duration;
  const finalStartTime = findNonOverlappingPosition(clipId, startTime, trackId, compDuration);

  return {
    id: clipId,
    trackId,
    name: composition.name,
    file: new File([], composition.name),
    startTime: finalStartTime,
    duration: compDuration,
    inPoint: 0,
    outPoint: compDuration,
    source: { type: 'video', naturalDuration: compDuration },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
    isComposition: true,
    compositionId: composition.id,
    nestedClips: [],
    nestedTracks: [],
  };
}

export async function loadNestedClips(
  compClipId: string,
  composition: Composition,
  get: () => any,
  set: (state: any) => void
): Promise<TimelineClip[]> {
  if (!composition.timelineData) return [];

  const mediaStore = useMediaStore.getState();
  const nestedClips: TimelineClip[] = [];

  for (const serializedClip of composition.timelineData.clips) {
    const mediaFile = mediaStore.files.find(f => f.id === serializedClip.mediaFileId);
    if (!mediaFile?.file) {
      console.warn('[Nested Comp] Could not find media file:', serializedClip.name);
      continue;
    }

    const nestedClip: TimelineClip = {
      id: `nested-${compClipId}-${serializedClip.id}`,
      trackId: serializedClip.trackId,
      name: serializedClip.name,
      file: mediaFile.file,
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: null,
      thumbnails: serializedClip.thumbnails,
      linkedClipId: serializedClip.linkedClipId,
      waveform: serializedClip.waveform,
      transform: serializedClip.transform,
      effects: serializedClip.effects || [],
      masks: serializedClip.masks || [],
      isLoading: true,
    };

    nestedClips.push(nestedClip);

    // Load media async
    const type = serializedClip.sourceType;
    const fileUrl = URL.createObjectURL(mediaFile.file);

    if (type === 'video') {
      loadVideoNestedClip(nestedClip, fileUrl, mediaFile.file.name, get, set);
    } else if (type === 'audio') {
      loadAudioNestedClip(nestedClip, fileUrl);
    } else if (type === 'image') {
      loadImageNestedClip(nestedClip, fileUrl, get, set);
    }
  }

  return nestedClips;
}

function loadVideoNestedClip(
  nestedClip: TimelineClip,
  fileUrl: string,
  fileName: string,
  get: () => any,
  set: (state: any) => void
): void {
  const video = document.createElement('video');
  video.src = fileUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  video.addEventListener('canplaythrough', async () => {
    nestedClip.source = {
      type: 'video',
      videoElement: video,
      naturalDuration: video.duration,
    };
    nestedClip.isLoading = false;

    // Initialize WebCodecsPlayer
    const webCodecsPlayer = await initWebCodecsPlayer(video, fileName);
    if (webCodecsPlayer) {
      nestedClip.source = { ...nestedClip.source, webCodecsPlayer };
    }

    // Trigger re-render
    set({ clips: [...get().clips] });
  }, { once: true });
}

function loadAudioNestedClip(nestedClip: TimelineClip, fileUrl: string): void {
  const audio = document.createElement('audio');
  audio.src = fileUrl;
  audio.preload = 'auto';

  audio.addEventListener('canplaythrough', () => {
    nestedClip.source = {
      type: 'audio',
      audioElement: audio,
      naturalDuration: audio.duration,
    };
    nestedClip.isLoading = false;
  }, { once: true });
}

function loadImageNestedClip(
  nestedClip: TimelineClip,
  fileUrl: string,
  get: () => any,
  set: (state: any) => void
): void {
  const img = new Image();
  img.src = fileUrl;

  img.addEventListener('load', () => {
    nestedClip.source = { type: 'image', imageElement: img };
    nestedClip.isLoading = false;
    set({ clips: [...get().clips] });
  }, { once: true });
}

/**
 * Create linked audio clip for composition (with or without actual audio).
 * MERGED from 3 duplicate branches in original code.
 */
export async function createCompLinkedAudioClip(
  compClipId: string,
  composition: Composition,
  compClipStartTime: number,
  compDuration: number,
  tracks: TimelineTrack[],
  set: (state: any) => void,
  get: () => any
): Promise<void> {
  const { compositionAudioMixer } = await import('../../../services/compositionAudioMixer');

  // Mark as generating
  set({
    clips: get().clips.map((c: TimelineClip) =>
      c.id === compClipId ? { ...c, mixdownGenerating: true } : c
    ),
  });

  let hasAudio = false;
  let mixdownAudio: HTMLAudioElement | undefined;
  let waveform: number[] = [];
  let mixdownBuffer: AudioBuffer | undefined;
  let audioDuration = compDuration;

  try {
    console.log(`[Nested Comp] Generating audio mixdown for ${composition.name}...`);
    const mixdownResult = await compositionAudioMixer.mixdownComposition(composition.id);

    if (mixdownResult?.hasAudio) {
      hasAudio = true;
      mixdownAudio = compositionAudioMixer.createAudioElement(mixdownResult.buffer);
      mixdownAudio.preload = 'auto';
      waveform = mixdownResult.waveform;
      mixdownBuffer = mixdownResult.buffer;
      audioDuration = mixdownResult.duration;
    }
  } catch (e) {
    console.error('[Nested Comp] Failed to generate audio mixdown:', e);
  }

  // Find or create audio track
  const { trackId: audioTrackId, newTrack } = findOrCreateAudioTrack(tracks);
  if (newTrack) {
    set({ tracks: [...get().tracks, newTrack] });
  }

  // Create audio clip
  const audioClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-audio`;
  const audioClip = createCompositionAudioClip({
    clipId: audioClipId,
    trackId: audioTrackId,
    compositionName: composition.name,
    compositionId: composition.id,
    startTime: compClipStartTime,
    duration: compDuration,
    audioElement: mixdownAudio || document.createElement('audio'),
    waveform: waveform.length > 0 ? waveform : generateSilentWaveform(compDuration),
    mixdownBuffer,
    hasAudio,
  });
  audioClip.linkedClipId = compClipId;

  // Update comp clip and add audio clip
  const clipsAfter = get().clips;
  set({
    clips: [
      ...clipsAfter.map((c: TimelineClip) =>
        c.id === compClipId
          ? { ...c, linkedClipId: audioClipId, mixdownGenerating: false, hasMixdownAudio: hasAudio }
          : c
      ),
      audioClip,
    ],
  });

  console.log(`[Nested Comp] Created linked audio clip for ${composition.name} (hasAudio: ${hasAudio})`);
}
```

### Step 3.2: Create completeDownload.ts

**File**: `src/stores/timeline/clip/completeDownload.ts`

```typescript
// YouTube download completion - extracted from completeDownload (lines 1768-2030)

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { initWebCodecsPlayer } from '../helpers/webCodecsHelpers';
import { generateVideoThumbnails } from '../helpers/thumbnailHelpers';
import { generateWaveformForFile } from '../helpers/waveformHelpers';

export interface CompleteDownloadParams {
  clipId: string;
  file: File;
  clips: TimelineClip[];
  waveformsEnabled: boolean;
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
  updateDuration: () => void;
  invalidateCache: () => void;
  set: (state: any) => void;
  get: () => any;
}

export async function completeDownload(params: CompleteDownloadParams): Promise<void> {
  const { clipId, file, clips, waveformsEnabled, findAvailableAudioTrack, updateDuration, invalidateCache, set, get } = params;

  const clip = clips.find(c => c.id === clipId);
  if (!clip?.isPendingDownload) {
    console.warn('[Timeline] Clip not found or not pending:', clipId);
    return;
  }

  console.log(`[Timeline] Completing download for: ${clipId}`);

  // Create and load video element
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  const url = URL.createObjectURL(file);
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
    video.load();
  });

  const naturalDuration = video.duration || 30;
  const initialThumbnails = clip.youtubeThumbnail ? [clip.youtubeThumbnail] : [];
  video.currentTime = 0;

  // Import to media store
  const mediaStore = useMediaStore.getState();
  const mediaFile = await mediaStore.importFile(file);

  // Find/create audio track
  const audioTrackId = findAvailableAudioTrack(clip.startTime, naturalDuration);
  const audioClipId = audioTrackId ? `clip-audio-yt-${Date.now()}` : undefined;

  // Update video clip
  const updatedClips = clips.map(c => {
    if (c.id !== clipId) return c;
    return {
      ...c,
      file,
      duration: naturalDuration,
      outPoint: naturalDuration,
      source: {
        type: 'video' as const,
        videoElement: video,
        naturalDuration,
        mediaFileId: mediaFile.id,
      },
      mediaFileId: mediaFile.id,
      linkedClipId: audioClipId,
      thumbnails: initialThumbnails,
      isPendingDownload: false,
      downloadProgress: undefined,
      youtubeVideoId: undefined,
      youtubeThumbnail: undefined,
    };
  });

  // Create linked audio clip
  if (audioTrackId && audioClipId) {
    const audioClip: TimelineClip = {
      id: audioClipId,
      trackId: audioTrackId,
      name: `${clip.name} (Audio)`,
      file,
      startTime: clip.startTime,
      duration: naturalDuration,
      inPoint: 0,
      outPoint: naturalDuration,
      source: { type: 'audio', naturalDuration, mediaFileId: mediaFile.id },
      mediaFileId: mediaFile.id,
      linkedClipId: clipId,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };
    updatedClips.push(audioClip);
  }

  set({ clips: updatedClips });
  updateDuration();
  invalidateCache();

  // Initialize WebCodecsPlayer
  const webCodecsPlayer = await initWebCodecsPlayer(video, 'YouTube download');
  if (webCodecsPlayer) {
    set({
      clips: get().clips.map((c: TimelineClip) => {
        if (c.id !== clipId || !c.source) return c;
        return { ...c, source: { ...c.source, webCodecsPlayer } };
      }),
    });
  }

  // Load audio element for linked clip
  if (audioTrackId && audioClipId) {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    set({
      clips: get().clips.map((c: TimelineClip) =>
        c.id === audioClipId
          ? { ...c, source: { type: 'audio' as const, audioElement: audio, naturalDuration, mediaFileId: mediaFile.id } }
          : c
      ),
    });

    // Generate waveform
    if (waveformsEnabled) {
      set({
        clips: get().clips.map((c: TimelineClip) =>
          c.id === audioClipId ? { ...c, waveformGenerating: true, waveformProgress: 0 } : c
        ),
      });

      try {
        const waveform = await generateWaveformForFile(file);
        set({
          clips: get().clips.map((c: TimelineClip) =>
            c.id === audioClipId ? { ...c, waveform, waveformGenerating: false } : c
          ),
        });
      } catch (e) {
        console.warn('[Waveform] Failed:', e);
        set({
          clips: get().clips.map((c: TimelineClip) =>
            c.id === audioClipId ? { ...c, waveformGenerating: false } : c
          ),
        });
      }
    }
  }

  // Generate real thumbnails in background
  setTimeout(async () => {
    try {
      const thumbnails = await generateVideoThumbnails(video, naturalDuration);
      set({
        clips: get().clips.map((c: TimelineClip) =>
          c.id === clipId ? { ...c, thumbnails } : c
        ),
      });
    } catch (e) {
      console.warn('[Thumbnails] Failed:', e);
    }
  }, 100);
}
```

---

## Phase 4: Update Main clipSlice.ts

The main file becomes a thin coordinator that imports and delegates to the extracted modules.

**File**: `src/stores/timeline/clipSlice.ts` (updated)

```typescript
// Clip-related actions slice - Coordinator
// Delegates to specialized modules in ./clip/ and ./helpers/

import type { TimelineClip, TextClipProperties } from '../../types';
import type { ClipActions, SliceCreator, Composition } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_TEXT_PROPERTIES, DEFAULT_TEXT_DURATION } from './constants';
import { generateWaveform, getDefaultEffectParams } from './utils';
import { textRenderer } from '../../services/textRenderer';
import { googleFontsService } from '../../services/googleFontsService';

// Import extracted modules
import { detectMediaType } from './helpers/mediaTypeHelpers';
import { createVideoClipPlaceholders, loadVideoMedia } from './clip/addVideoClip';
import { createAudioClipPlaceholder, loadAudioMedia } from './clip/addAudioClip';
import { createImageClipPlaceholder, loadImageMedia } from './clip/addImageClip';
import { createCompClipPlaceholder, loadNestedClips, createCompLinkedAudioClip } from './clip/addCompClip';
import { completeDownload as completeDownloadImpl } from './clip/completeDownload';

export const createClipSlice: SliceCreator<ClipActions> = (set, get) => ({
  addClip: async (trackId, file, startTime, providedDuration, mediaFileId) => {
    const mediaType = detectMediaType(file);
    const estimatedDuration = providedDuration ?? 5;
    const { tracks, clips, updateDuration, findAvailableAudioTrack, thumbnailsEnabled, waveformsEnabled, invalidateCache } = get();

    // Validate track
    const targetTrack = tracks.find(t => t.id === trackId);
    if (!targetTrack) return;

    // Validate track type
    if ((mediaType === 'video' || mediaType === 'image') && targetTrack.type !== 'video') return;
    if (mediaType === 'audio' && targetTrack.type !== 'audio') return;

    console.log(`[Timeline] Adding ${mediaType}: ${file.name}`);

    // Helper to update clip
    const updateClip = (id: string, updates: Partial<TimelineClip>) => {
      set({ clips: get().clips.map(c => c.id === id ? { ...c, ...updates } : c) });
      get().updateDuration();
    };
    const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
      set({ clips: updater(get().clips) });
    };

    if (mediaType === 'video') {
      const { videoClip, audioClip } = await createVideoClipPlaceholders({
        trackId, file, startTime, estimatedDuration, mediaFileId,
        tracks, findAvailableAudioTrack, thumbnailsEnabled, waveformsEnabled,
      });

      set({ clips: [...clips, videoClip, ...(audioClip ? [audioClip] : [])] });
      updateDuration();

      await loadVideoMedia({
        clipId: videoClip.id,
        audioClipId: audioClip?.id,
        file, mediaFileId, thumbnailsEnabled, waveformsEnabled,
        updateClip, setClips,
      });

      invalidateCache();
      return;
    }

    if (mediaType === 'audio') {
      const audioClip = createAudioClipPlaceholder(trackId, file, startTime, estimatedDuration, mediaFileId);
      set({ clips: [...clips, audioClip] });
      updateDuration();

      await loadAudioMedia({
        trackId, file, startTime, estimatedDuration, mediaFileId, waveformsEnabled,
        updateClip, setClips,
      });

      invalidateCache();
      return;
    }

    if (mediaType === 'image') {
      const imageClip = createImageClipPlaceholder(trackId, file, startTime, estimatedDuration);
      set({ clips: [...clips, imageClip] });
      updateDuration();

      await loadImageMedia(imageClip, updateClip);
      invalidateCache();
    }
  },

  addCompClip: async (trackId, composition: Composition, startTime) => {
    const { clips, tracks, updateDuration, findNonOverlappingPosition, thumbnailsEnabled, invalidateCache } = get();

    const compClip = createCompClipPlaceholder({ trackId, composition, startTime, findNonOverlappingPosition });
    set({ clips: [...clips, compClip] });
    updateDuration();

    // Load nested clips
    const nestedClips = await loadNestedClips(compClip.id, composition, get, set);
    const nestedTracks = composition.timelineData?.tracks || [];

    set({
      clips: get().clips.map(c =>
        c.id === compClip.id ? { ...c, nestedClips, nestedTracks, isLoading: false } : c
      ),
    });

    // Generate thumbnails (if enabled and has video)
    // ... (thumbnail generation logic)

    // Create linked audio clip
    await createCompLinkedAudioClip(
      compClip.id, composition, compClip.startTime,
      composition.timelineData?.duration ?? composition.duration,
      get().tracks, set, get
    );

    invalidateCache();
  },

  // ... rest of actions remain similar but use imported helpers where appropriate

  removeClip: (id) => { /* unchanged - 63 LOC */ },
  moveClip: (id, newStartTime, newTrackId, skipLinked, skipGroup) => { /* unchanged - 106 LOC */ },
  trimClip: (id, inPoint, outPoint) => { /* unchanged - 16 LOC */ },
  splitClip: (clipId, splitTime) => { /* unchanged - 86 LOC */ },
  splitClipAtPlayhead: () => { /* unchanged - 37 LOC */ },

  updateClip: (id, updates) => {
    set({ clips: get().clips.map(c => c.id === id ? { ...c, ...updates } : c) });
    get().updateDuration();
  },

  // ... remaining actions (effects, text clips, parenting, etc.)
  // These are already small enough (<50 LOC each) and don't need extraction

  completeDownload: async (clipId, file) => {
    await completeDownloadImpl({
      clipId, file,
      clips: get().clips,
      waveformsEnabled: get().waveformsEnabled,
      findAvailableAudioTrack: get().findAvailableAudioTrack,
      updateDuration: get().updateDuration,
      invalidateCache: get().invalidateCache,
      set, get,
    });
  },

  // ... remaining small actions stay inline
});
```

---

## Validation Commands

After each phase, run:

```bash
# TypeScript check
npx tsc --noEmit

# Build test
npm run build

# Lint check
npm run lint
```

---

## Rollback

If issues occur, revert:
```bash
git checkout src/stores/timeline/clipSlice.ts
rm -rf src/stores/timeline/clip
rm -rf src/stores/timeline/helpers
```

---

## Notes for AI Agent

1. **Order matters**: Create helpers first (Phase 1), then extracted modules (Phase 2-3), then update main file (Phase 4)

2. **Logic improvement**: Remove local `updateClip` helper in addClip - the main `updateClip` action does the same thing

3. **Merge duplicate branches**: In addCompClip, the error handler (lines 883-944) and no-data handler (lines 947-1014) are nearly identical - merge into single helper

4. **Import fixes**: After extraction, update any imports in other files that use clipSlice functions

5. **Test focus**: The most complex extraction is `addCompClip` - test nested composition thoroughly

6. **Type exports**: Ensure helper types are exported if needed by other modules

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| clipSlice.ts LOC | 2031 | ~300 |
| Largest file | clipSlice.ts (2031) | addCompClip.ts (~350) |
| Duplicate code | ~510 LOC | ~0 LOC |
| Files | 1 | 12 |
