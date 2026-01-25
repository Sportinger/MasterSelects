// YouTube download completion - extracted from completeDownload
// Handles converting pending download clips to actual video clips

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { initWebCodecsPlayer, createAudioElement } from '../helpers/webCodecsHelpers';
import { generateDownloadThumbnails } from '../helpers/thumbnailHelpers';
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

/**
 * Complete a pending YouTube download - convert to actual video clip.
 */
export async function completeDownload(params: CompleteDownloadParams): Promise<void> {
  const {
    clipId,
    file,
    clips,
    waveformsEnabled,
    findAvailableAudioTrack,
    updateDuration,
    invalidateCache,
    set,
    get,
  } = params;

  const clip = clips.find(c => c.id === clipId);
  if (!clip?.isPendingDownload) {
    console.warn('[Download] Clip not found or not pending:', clipId);
    return;
  }

  console.log(`[Download] Completing download for: ${clipId}`);

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
    console.log(`[Download] Created linked audio clip: ${audioClipId}`);
  }

  set({ clips: updatedClips });
  updateDuration();
  invalidateCache();

  console.log(`[Download] Complete: ${clipId}, duration: ${naturalDuration}s`);

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
    const audio = createAudioElement(file);
    // Reuse the same blob URL
    audio.src = url;

    set({
      clips: get().clips.map((c: TimelineClip) =>
        c.id === audioClipId
          ? { ...c, source: { type: 'audio' as const, audioElement: audio, naturalDuration, mediaFileId: mediaFile.id } }
          : c
      ),
    });

    // Generate waveform in background
    if (waveformsEnabled) {
      generateWaveformAsync(audioClipId, file, get, set);
    }
  }

  // Generate real thumbnails in background
  generateThumbnailsAsync(clipId, video, naturalDuration, get, set);
}

/**
 * Generate waveform asynchronously.
 */
async function generateWaveformAsync(
  audioClipId: string,
  file: File,
  get: () => any,
  set: (state: any) => void
): Promise<void> {
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
    console.log(`[Download] Waveform generated for audio clip`);
  } catch (e) {
    console.warn('[Download] Waveform generation failed:', e);
    set({
      clips: get().clips.map((c: TimelineClip) =>
        c.id === audioClipId ? { ...c, waveformGenerating: false } : c
      ),
    });
  }
}

/**
 * Generate thumbnails asynchronously.
 */
async function generateThumbnailsAsync(
  clipId: string,
  video: HTMLVideoElement,
  duration: number,
  get: () => any,
  set: (state: any) => void
): Promise<void> {
  // Small delay to let video element settle
  await new Promise(r => setTimeout(r, 100));

  try {
    const thumbnails = await generateDownloadThumbnails(video, duration);
    video.currentTime = 0;
    set({
      clips: get().clips.map((c: TimelineClip) =>
        c.id === clipId ? { ...c, thumbnails } : c
      ),
    });
    console.log(`[Download] Generated ${thumbnails.length} thumbnails`);
  } catch (e) {
    console.warn('[Download] Thumbnail generation failed:', e);
  }
}
