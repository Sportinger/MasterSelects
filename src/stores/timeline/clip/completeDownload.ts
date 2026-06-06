// YouTube download completion - extracted from completeDownload
// Handles converting pending download clips to actual video clips

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { requireMediaFileImportResult } from '../../mediaStore/helpers/importResult';
import {
  createVideoElement,
  releaseTemporaryMediaElement,
  waitForVideoMetadata,
} from '../helpers/webCodecsHelpers';
import { generateClipId } from '../helpers/idGenerator';
import { updateClipById } from '../helpers/clipStateHelpers';
import { Logger } from '../../../services/logger';
import {
  SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES,
  SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND,
  generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress,
  mapSourceWaveformPyramidProgress,
} from '../../../services/audio/timelineWaveformPyramidCache';

const log = Logger.create('CompleteDownload');

function getUsableDuration(duration: number | undefined): number | undefined {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? duration
    : undefined;
}

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

  let naturalDuration = getUsableDuration(mediaFile.duration);
  if (!naturalDuration) {
    const metadataVideo = createVideoElement(file);
    try {
      await waitForVideoMetadata(metadataVideo, 8000);
      naturalDuration = getUsableDuration(metadataVideo.duration);
    } finally {
      releaseTemporaryMediaElement(metadataVideo);
    }
  }
  naturalDuration ??= 30;
  const initialThumbnails = clip.youtubeThumbnail ? [clip.youtubeThumbnail] : [];

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

  // Generate waveform in background for the linked audio clip.
  if (audioTrackId && audioClipId) {
    if (waveformsEnabled) {
      generateWaveformAsync(audioClipId, file, mediaFile.id, get, set);
    }
  }

  // Generate source-based thumbnails (1 per second) in background
  if (mediaFile?.id) {
    import('../../../services/thumbnailCacheService').then(({ thumbnailCacheService }) => {
      const sourceUrl = mediaFile.url || URL.createObjectURL(file);
      const shouldRevokeSourceUrl = !mediaFile.url;
      thumbnailCacheService
        .generateForSourceUrl(mediaFile.id, sourceUrl, naturalDuration, mediaFile.fileHash)
        .finally(() => {
          if (shouldRevokeSourceUrl) {
            URL.revokeObjectURL(sourceUrl);
          }
        });
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
      includePyramid: true,
      samplesPerSecond: SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND,
      maxPreviewSamples: SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES,
      onProgress: (progress, partialWaveform) => {
        set({
          clips: updateClipById(get().clips, audioClipId, {
            waveformProgress: mapSourceWaveformPreviewProgress(progress),
            waveform: partialWaveform,
          }),
        });
      },
      onPyramidProgress: (progress) => {
        set({
          clips: updateClipById(get().clips, audioClipId, {
            waveformProgress: mapSourceWaveformPyramidProgress(progress),
          }),
        });
      },
    });
    const currentClip = get().clips.find((clip) => clip.id === audioClipId);
    set({
      clips: updateClipById(get().clips, audioClipId, {
        waveform: analysis.waveform,
        waveformChannels: analysis.waveformChannels,
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

