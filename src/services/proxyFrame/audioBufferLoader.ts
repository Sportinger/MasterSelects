// Decoded audio buffer loading for scrub and live source playback: multi-source
// ArrayBuffer resolution, decode bookkeeping, and LRU cache limits.

import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';
import { fileSystemService } from '../fileSystemService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from '../project/mediaSourceResolver';
import { useMediaStore } from '../../stores/mediaStore';
import { estimateAudioBufferBytes } from './runtimeResources';

const log = Logger.create('ProxyFrameCache');

export const MAX_AUDIO_BUFFER_CACHE_BYTES = 1536 * 1024 * 1024;
export const MAX_AUDIO_BUFFER_CACHE_ENTRIES = 16;
const AUDIO_BUFFER_RETRY_COOLDOWN_MS = 3000;
const SCRUB_AUDIO_WARM_BACKOFF_MS = 5000;

type StoreMediaFile = ReturnType<typeof useMediaStore.getState>['files'][number];

export interface AudioBufferLoadState {
  // Track loading state to prevent duplicate loads
  loading: Set<string>;
  // Next allowed load retry time for source-not-found/decode retry cooldowns.
  retryTime: Map<string, number>;
  // Next allowed opportunistic scrub warmup time, separate from demand loads.
  nextAllowedWarmAt: Map<string, number>;
  // Warm backoff diagnostics are intentionally logged once per file.
  warmBackoffLogged: Set<string>;
  // Track files with no audio
  failed: Set<string>;
}

export function createAudioBufferLoadState(): AudioBufferLoadState {
  return {
    loading: new Set(),
    retryTime: new Map(),
    nextAllowedWarmAt: new Map(),
    warmBackoffLogged: new Set(),
    failed: new Set(),
  };
}

export function hasUsableAudioProxy(
  mediaFile: { hasProxyAudio?: boolean; audioProxyStatus?: string } | undefined
): boolean {
  return mediaFile?.hasProxyAudio === true || mediaFile?.audioProxyStatus === 'ready';
}

export function touchAudioBufferCacheEntry(
  audioBufferCache: Map<string, AudioBuffer>,
  mediaFileId: string,
  buffer: AudioBuffer,
): void {
  audioBufferCache.delete(mediaFileId);
  audioBufferCache.set(mediaFileId, buffer);
}

export function enforceAudioBufferCacheLimit(
  audioBufferCache: Map<string, AudioBuffer>,
  releaseAudioBufferResource: (mediaFileId: string) => void,
  onEvictAudioBuffer?: (mediaFileId: string) => void,
): void {
  let totalBytes = 0;
  for (const buffer of audioBufferCache.values()) {
    totalBytes += estimateAudioBufferBytes(buffer);
  }

  while (
    audioBufferCache.size > 1 &&
    (audioBufferCache.size > MAX_AUDIO_BUFFER_CACHE_ENTRIES || totalBytes > MAX_AUDIO_BUFFER_CACHE_BYTES)
  ) {
    const oldest = audioBufferCache.entries().next().value as [string, AudioBuffer] | undefined;
    if (!oldest) break;
    audioBufferCache.delete(oldest[0]);
    releaseAudioBufferResource(oldest[0]);
    onEvictAudioBuffer?.(oldest[0]);
    totalBytes -= estimateAudioBufferBytes(oldest[1]);
    log.debug(`Evicted decoded audio buffer from cache: ${oldest[0]}`);
  }
}

export function canWarmScrubAudioBuffer(
  state: AudioBufferLoadState,
  mediaFileId: string,
  now = performance.now(),
): boolean {
  const nextAllowedWarmAt = state.nextAllowedWarmAt.get(mediaFileId);
  return !nextAllowedWarmAt || now >= nextAllowedWarmAt;
}

export function deferScrubAudioBufferWarmup(
  state: AudioBufferLoadState,
  mediaFileId: string,
  reason: string,
  now = performance.now(),
): void {
  state.nextAllowedWarmAt.set(mediaFileId, now + SCRUB_AUDIO_WARM_BACKOFF_MS);
  if (state.warmBackoffLogged.has(mediaFileId)) return;
  state.warmBackoffLogged.add(mediaFileId);
  log.debug('Deferring scrub audio buffer warmups', {
    mediaFileId,
    reason,
    cooldownMs: SCRUB_AUDIO_WARM_BACKOFF_MS,
  });
}

// Resolve raw audio bytes for a media file, trying every available source.
async function resolveAudioArrayBuffer(
  mediaFileId: string,
  mediaFile: StoreMediaFile | undefined,
  storageKey: string,
  videoElementSrc?: string,
): Promise<ArrayBuffer | null> {
  let arrayBuffer: ArrayBuffer | null = null;

  // Try 1: Session audio proxy URL (used before a project exists)
  if (mediaFile?.audioProxyUrl) {
    log.debug(`Loading from session audio proxy: ${mediaFileId}`);
    try {
      const response = await fetch(mediaFile.audioProxyUrl);
      arrayBuffer = await response.arrayBuffer();
    } catch (e) {
      log.warn('Failed to fetch session audio proxy URL', e);
    }
  }

  // Try 2: Project audio proxy file (PCM WAV for predictable scrubbing)
  if (!arrayBuffer) {
    const audioFile = await projectFileService.getProxyAudio(storageKey);
    if (audioFile) {
      log.debug(`Loading from proxy audio: ${mediaFileId}`);
      arrayBuffer = await audioFile.arrayBuffer();
    }
  }

  // Try 3: Project-local RAW media file
  if (!arrayBuffer) {
    const projectHandle = await getStoredProjectFileHandle(mediaFileId);
    if (projectHandle) {
      log.debug(`Loading from project RAW handle: ${mediaFileId}`);
      try {
        const file = await projectHandle.getFile();
        arrayBuffer = await file.arrayBuffer();
      } catch (e) {
        log.warn('Failed to read project RAW handle', e);
      }
    }
  }

  if (!arrayBuffer && projectFileService.isProjectOpen()) {
    for (const candidatePath of getProjectRawPathCandidates({
      mediaFileId,
      projectPath: mediaFile?.projectPath,
      filePath: mediaFile?.filePath,
      name: mediaFile?.name,
    })) {
      log.debug(`Loading from project RAW path: ${mediaFileId} (${candidatePath})`);
      try {
        const result = await projectFileService.getFileFromRaw(candidatePath);
        if (result) {
          arrayBuffer = await result.file.arrayBuffer();
          break;
        }
      } catch (e) {
        log.warn('Failed to read project RAW path', e);
      }
    }
  }

  // Try 4: Original video file URL (extract audio from video)
  if (!arrayBuffer && mediaFile?.url) {
    log.debug(`Loading from video URL: ${mediaFileId}`);
    try {
      const response = await fetch(mediaFile.url);
      arrayBuffer = await response.arrayBuffer();
    } catch (e) {
      log.warn('Failed to fetch video URL', e);
    }
  }

  // Try 5: File handle (if available)
  if (!arrayBuffer) {
    const fileHandle = fileSystemService.getFileHandle(mediaFileId);
    if (fileHandle) {
      log.debug(`Loading from file handle: ${mediaFileId}`);
      try {
        const file = await fileHandle.getFile();
        arrayBuffer = await file.arrayBuffer();
      } catch (e) {
        log.warn('Failed to read file handle', e);
      }
    }
  }

  // Try 6: Direct File object from media store (e.g. YouTube downloads)
  if (!arrayBuffer && mediaFile?.file) {
    log.debug(`Loading from File object: ${mediaFileId}`);
    try {
      arrayBuffer = await mediaFile.file.arrayBuffer();
    } catch (e) {
      log.warn('Failed to read File object', e);
    }
  }

  // Try 7: Video element's current source URL (guaranteed valid if video is playing)
  if (!arrayBuffer && videoElementSrc) {
    log.debug(`Loading from video element src: ${mediaFileId}`);
    try {
      const response = await fetch(videoElementSrc);
      arrayBuffer = await response.arrayBuffer();
    } catch (e) {
      log.warn('Failed to fetch video element src', e);
    }
  }

  return arrayBuffer;
}

// Load and decode an AudioBuffer for a media file (cache miss path).
// Works with BOTH proxy audio AND original video files.
export async function loadAudioBufferForScrub(args: {
  state: AudioBufferLoadState;
  mediaFileId: string;
  videoElementSrc?: string;
  getAudioContext: () => AudioContext;
  cacheDecodedAudioBuffer: (mediaFileId: string, buffer: AudioBuffer) => boolean;
  onDecodedAudioBufferNotRetained?: (mediaFileId: string) => void;
}): Promise<AudioBuffer | null> {
  const {
    state,
    mediaFileId,
    videoElementSrc,
    getAudioContext,
    cacheDecodedAudioBuffer,
    onDecodedAudioBufferNotRetained,
  } = args;

  const mediaStore = useMediaStore.getState();
  const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);

  // Skip files that have no audio (failed decoding = audio doesn't exist)
  if (state.failed.has(mediaFileId) && !hasUsableAudioProxy(mediaFile)) {
    return null;
  }

  // Check if already loading
  if (state.loading.has(mediaFileId)) {
    return null; // Loading in progress
  }

  // Cooldown for "source not found" - retry after 3 seconds (source may become available)
  const now = performance.now();
  const nextAllowedAttemptAt = state.retryTime.get(mediaFileId);
  if (nextAllowedAttemptAt && now < nextAllowedAttemptAt) {
    return null;
  }

  state.loading.add(mediaFileId);

  try {
    const storageKey = mediaFile?.audioProxyStorageKey || mediaFile?.fileHash || mediaFileId;
    const arrayBuffer = await resolveAudioArrayBuffer(mediaFileId, mediaFile, storageKey, videoElementSrc);

    if (!arrayBuffer) {
      log.warn(`No audio source found for ${mediaFileId}`);
      // Use cooldown instead of permanent failure - source may become available later
      state.retryTime.set(mediaFileId, performance.now() + AUDIO_BUFFER_RETRY_COOLDOWN_MS);
      state.loading.delete(mediaFileId);
      return null;
    }

    // Decode to AudioBuffer
    const audioContext = getAudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); // Clone to avoid detached buffer

    const retained = cacheDecodedAudioBuffer(mediaFileId, audioBuffer);
    if (!retained) {
      onDecodedAudioBufferNotRetained?.(mediaFileId);
    }
    state.failed.delete(mediaFileId);
    state.loading.delete(mediaFileId);
    state.retryTime.delete(mediaFileId);
    log.debug(
      `Decoded ${mediaFileId}: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch${retained ? '' : ' (not cached)'}`
    );

    return audioBuffer;
  } catch (e) {
    state.loading.delete(mediaFileId);
    const errorName = e instanceof Error ? e.name : undefined;
    const errorMessage = e instanceof Error ? e.message : String(e);
    // Only permanently blacklist for actual "no audio track" decode errors (EncodingError).
    // Context-related errors (InvalidStateError from closed context) should use retry cooldown
    // so the buffer can be decoded on a new/resumed context.
    if (errorName === 'EncodingError') {
      state.failed.add(mediaFileId);
      log.debug(`No audio track in ${mediaFileId}`);
    } else {
      state.retryTime.set(mediaFileId, performance.now() + AUDIO_BUFFER_RETRY_COOLDOWN_MS);
      log.debug(`Audio decode error for ${mediaFileId} (will retry): ${errorMessage}`);
    }
    return null;
  }
}
