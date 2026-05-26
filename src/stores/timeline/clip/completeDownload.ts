// YouTube download completion - extracted from completeDownload
// Handles converting pending download clips to actual video clips

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { requireMediaFileImportResult } from '../../mediaStore/helpers/importResult';
import { initWebCodecsPlayer, createAudioElement } from '../helpers/webCodecsHelpers';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';
import { updateClipById } from '../helpers/clipStateHelpers';
import { Logger } from '../../../services/logger';
import { generateTimelineWaveformAnalysisForFile } from '../../../services/audio/timelineWaveformPyramidCache';

const log = Logger.create('CompleteDownload');

export interface CompleteDownloadParams {
  clipId: string;
  file: File;
  clips: TimelineClip[];
  waveformsEnabled: boolean;
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
  updateDuration: () => void;
  invalidateCache: () => void;
  set: (state: { clips: TimelineClip[] }) => void;
  get: () => { clips: TimelineClip[] };
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
    log.warn('Clip not found or not pending', { clipId });
    return;
  }

  log.debug('Completing download', { clipId });

  // Create and load video element - track URL for cleanup
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  const url = blobUrlManager.create(clipId, file, 'video');
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
    video.load();
  });

  const naturalDuration = video.duration || 30;
  const initialThumbnails = clip.youtubeThumbnail ? [clip.youtubeThumbnail] : [];
  video.currentTime = 0;

  // Import to media store in YouTube folder
  const mediaStore = useMediaStore.getState();

  // Find or create YouTube folder
  let ytFolder = mediaStore.folders.find(f => f.name === 'YouTube' && f.parentId === null);
  if (!ytFolder) {
    ytFolder = mediaStore.createFolder('YouTube');
  }

  const mediaFile = requireMediaFileImportResult(
    await mediaStore.importFile(file, ytFolder.id),
    'YouTube download import',
  );

  // Find/create audio track
  const audioTrackId = findAvailableAudioTrack(clip.startTime, naturalDuration);
  const audioClipId = audioTrackId ? generateClipId('clip-audio-yt') : undefined;

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
      downloadSpeed: undefined,
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
    log.debug('Created linked audio clip', { audioClipId });
  }

  set({ clips: updatedClips });
  updateDuration();
  invalidateCache();

  log.debug('Download complete', { clipId, duration: naturalDuration });

  // Initialize WebCodecsPlayer
  const webCodecsPlayer = await initWebCodecsPlayer(video, file.name, file);
  if (webCodecsPlayer) {
    const currentClips = get().clips;
    const targetClip = currentClips.find((c: TimelineClip) => c.id === clipId);
    if (targetClip?.source) {
      set({
        clips: updateClipById(currentClips, clipId, {
          source: { ...targetClip.source, webCodecsPlayer }
        }),
      });
    }
  }

  // Load audio element for linked clip
  if (audioTrackId && audioClipId) {
    const audio = createAudioElement(file);
    // Share the same blob URL reference for the audio clip
    blobUrlManager.share(clipId, audioClipId, 'video');
    audio.src = url;

    set({
      clips: updateClipById(get().clips, audioClipId, {
        source: { type: 'audio' as const, audioElement: audio, naturalDuration, mediaFileId: mediaFile.id }
      }),
    });

    // Generate waveform in background
    if (waveformsEnabled) {
      generateWaveformAsync(audioClipId, file, mediaFile.id, get, set);
    }
  }

  // Generate source-based thumbnails (1 per second) in background
  if (mediaFile?.id) {
    import('../../../services/thumbnailCacheService').then(({ thumbnailCacheService }) => {
      thumbnailCacheService.generateForSource(mediaFile.id, video, naturalDuration, mediaFile.fileHash);
    });
  }
}

/**
 * Generate waveform asynchronously.
 */
async function generateWaveformAsync(
  audioClipId: string,
  file: File,
  mediaFileId: string,
  get: () => { clips: TimelineClip[] },
  set: (state: { clips: TimelineClip[] }) => void
): Promise<void> {
  set({ clips: updateClipById(get().clips, audioClipId, { waveformGenerating: true, waveformProgress: 0 }) });

  try {
    const analysis = await generateTimelineWaveformAnalysisForFile(file, {
      mediaFileId,
      onProgress: (progress, partialWaveform) => {
        set({ clips: updateClipById(get().clips, audioClipId, { waveformProgress: progress, waveform: partialWaveform }) });
      },
    });
    const currentClip = get().clips.find((clip) => clip.id === audioClipId);
    set({
      clips: updateClipById(get().clips, audioClipId, {
        waveform: analysis.waveform,
        ...(analysis.audioAnalysisRefs
          ? {
              audioState: {
                ...(currentClip?.audioState ?? {}),
                sourceAnalysisRefs: {
                  ...(currentClip?.audioState?.sourceAnalysisRefs ?? {}),
                  ...analysis.audioAnalysisRefs,
                },
              },
            }
          : {}),
        waveformGenerating: false,
        waveformProgress: 100,
      }),
    });
    log.debug('Waveform generated for audio clip');
  } catch (e) {
    log.warn('Waveform generation failed', e);
    set({ clips: updateClipById(get().clips, audioClipId, { waveformGenerating: false }) });
  }
}

